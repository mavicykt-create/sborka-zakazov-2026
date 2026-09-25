import { createHash, randomBytes } from 'node:crypto';
import type { EventType, Prisma } from '@prisma/client';
import { db } from '../../db.js';
import { verifyPassword } from '../auth/password.js';
import { findProductsByCode } from '../catalog/productCatalogService.js';
import { WorkflowError } from '../workflow/workflowService.js';

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const finalEventTypes: EventType[] = ['ITEM_PICKED', 'ITEM_NOT_FOUND', 'ITEM_SKIPPED', 'ITEM_UNDONE'];

const pickerWorkerSelect = {
  id: true,
  login: true,
  name: true,
  isActive: true,
  shiftStatus: true,
} satisfies Prisma.WorkerSelect;

const pickerItemSelect = {
  id: true,
  orderId: true,
  sourceLine: true,
  sortIndex: true,
  groupKey: true,
  name: true,
  barcode: true,
  packageQuantity: true,
  pieceQuantity: true,
  pickType: true,
  pickQuantity: true,
  status: true,
  assignedAt: true,
  pickedAt: true,
  order: {
    select: {
      id: true,
      documentNumber: true,
      documentDate: true,
      status: true,
    },
  },
} satisfies Prisma.OrderItemSelect;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function parseBearerToken(authorization?: string) {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new WorkflowError('Требуется вход сборщика', 401);
  return match[1];
}

export async function loginPicker(login: string, password: string) {
  const worker = await db.worker.findUnique({ where: { login: login.trim().toLowerCase() } });
  const passwordMatches = worker ? await verifyPassword(password, worker.passwordHash) : false;
  if (!worker || !passwordMatches) throw new WorkflowError('Неверный логин или пароль', 401);
  if (!worker.isActive) throw new WorkflowError('Учётная запись сборщика отключена', 403);

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await db.$transaction([
    db.workerSession.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
    db.workerSession.create({
      data: { tokenHash: hashToken(token), workerId: worker.id, expiresAt },
    }),
  ]);

  return {
    token,
    expiresAt,
    worker: {
      id: worker.id,
      login: worker.login,
      name: worker.name,
      isActive: worker.isActive,
      shiftStatus: worker.shiftStatus,
    },
  };
}

export async function authenticatePicker(authorization?: string) {
  const token = parseBearerToken(authorization);
  const session = await db.workerSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { worker: { select: pickerWorkerSelect } },
  });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await db.workerSession.delete({ where: { id: session.id } });
    throw new WorkflowError('Сессия истекла, войдите снова', 401);
  }
  if (!session.worker.isActive) throw new WorkflowError('Учётная запись сборщика отключена', 403);

  await db.workerSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  return { token, expiresAt: session.expiresAt, worker: session.worker };
}

export async function logoutPicker(authorization?: string) {
  const token = parseBearerToken(authorization);
  await db.workerSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  return { ok: true };
}

export async function getPickerQueue(workerId: string) {
  const worker = await db.worker.findUnique({ where: { id: workerId }, select: pickerWorkerSelect });
  if (!worker) throw new WorkflowError('Сборщик не найден', 404);

  const [items, latestOutcome] = await Promise.all([
    db.orderItem.findMany({
      where: {
        assignedWorkerId: workerId,
        status: { in: ['ASSIGNED', 'ACTIVE'] },
        order: { status: { notIn: ['CLOSED', 'CANCELLED'] } },
      },
      orderBy: [{ order: { createdAt: 'asc' } }, { sortIndex: 'asc' }],
      select: pickerItemSelect,
    }),
    db.orderEvent.findFirst({
      where: { workerId, type: { in: finalEventTypes }, order: { status: { not: 'CLOSED' } } },
      orderBy: [{ serverAt: 'desc' }, { id: 'desc' }],
      select: { type: true, serverAt: true, item: { select: pickerItemSelect } },
    }),
  ]);

  const active = items.filter((item) => item.status === 'ACTIVE').length;
  return {
    worker,
    summary: { total: items.length, active, waiting: items.length - active },
    items,
    lastCompleted:
      latestOutcome && latestOutcome.type !== 'ITEM_UNDONE' && latestOutcome.item
        ? { ...latestOutcome.item, eventType: latestOutcome.type, completedAt: latestOutcome.serverAt }
        : null,
  };
}

function valueNumber(value: Prisma.Decimal | null) {
  return value == null ? 0 : Number(value);
}

export async function getAssemblyBoard(workerId: string) {
  const worker = await db.worker.findUnique({ where: { id: workerId }, select: pickerWorkerSelect });
  if (!worker) throw new WorkflowError('Сборщик не найден', 404);
  const orders = await db.order.findMany({
    where: { sourceSystem: { in: ['GMAIL', 'EMAIL_MANUAL'] } },
    take: 8,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    include: { items: { orderBy: { sortIndex: 'asc' } } },
  });
  const codes = orders.flatMap((order) => order.items.map((item) => item.barcode));
  const products = await findProductsByCode(codes);
  return {
    worker,
    generatedAt: new Date().toISOString(),
    orders: orders.map(({ items, ...order }) => {
      const picked = items.filter((item) => item.status === 'PICKED');
      return {
        ...order,
        orderTotal: order.orderTotal == null ? null : Number(order.orderTotal),
        summary: {
          lineCount: items.length,
          packageCount: items.reduce((sum, item) => sum + valueNumber(item.packageQuantity), 0),
          pieceCount: items.reduce((sum, item) => sum + valueNumber(item.pieceQuantity), 0),
          pickedLines: picked.length,
          pickedPackages: picked.reduce((sum, item) => sum + valueNumber(item.packageQuantity), 0),
          pickedPieces: picked.reduce((sum, item) => sum + valueNumber(item.pieceQuantity), 0),
        },
        items: items.map((item) => {
          const product = item.barcode ? products.get(item.barcode) : null;
          return {
            ...item,
            packageQuantity: item.packageQuantity == null ? null : Number(item.packageQuantity),
            pieceQuantity: item.pieceQuantity == null ? null : Number(item.pieceQuantity),
            pickQuantity: Number(item.pickQuantity),
            imageUrl: product?.imageUrl ?? null,
            productUrl: product?.productUrl ?? null,
            catalogTitle: product?.title ?? null,
          };
        }),
      };
    }),
  };
}

export async function claimAssemblyOrder(orderId: string, workerId: string) {
  return db.$transaction(async (tx) => {
    const [worker, order] = await Promise.all([
      tx.worker.findUnique({ where: { id: workerId } }),
      tx.order.findUnique({ where: { id: orderId }, include: { items: true } }),
    ]);
    if (!worker) throw new WorkflowError('Сборщик не найден', 404);
    if (!worker.isActive || worker.shiftStatus === 'OFF_SHIFT') {
      throw new WorkflowError('Смена закрыта. Обратитесь к администратору', 409);
    }
    if (!order) throw new WorkflowError('Заказ не найден', 404);
    if (!['GMAIL', 'EMAIL_MANUAL'].includes(order.sourceSystem ?? '')) {
      throw new WorkflowError('Это не заказ из email', 409);
    }
    if (['CLOSED', 'CANCELLED'].includes(order.status)) throw new WorkflowError('Заказ уже закрыт', 409);
    const anotherWorker = order.items.find(
      (item) =>
        item.assignedWorkerId &&
        item.assignedWorkerId !== workerId &&
        ['ASSIGNED', 'ACTIVE'].includes(item.status),
    );
    if (anotherWorker) throw new WorkflowError('Заказ уже собирает другой сотрудник', 409);

    const now = new Date();
    const assignable = order.items.filter(
      (item) =>
        item.status === 'PENDING' || (item.assignedWorkerId === workerId && item.status === 'ASSIGNED'),
    );
    for (const item of assignable) {
      if (item.status !== 'PENDING') continue;
      await tx.orderItem.update({
        where: { id: item.id },
        data: { assignedWorkerId: workerId, assignedAt: now, status: 'ASSIGNED' },
      });
      await tx.orderEvent.create({
        data: { orderId, itemId: item.id, workerId, type: 'ITEM_ASSIGNED', metadata: { emailBoard: true } },
      });
    }
    await tx.order.update({
      where: { id: orderId },
      data: { status: order.startedAt ? 'PICKING' : 'ASSIGNED', completedAt: null, closedAt: null },
    });
    await tx.worker.update({ where: { id: workerId }, data: { shiftStatus: 'BUSY' } });
    if (assignable.some((item) => item.status === 'PENDING')) {
      await tx.orderEvent.create({
        data: { orderId, workerId, type: 'ORDER_ASSIGNED', metadata: { emailBoard: true } },
      });
    }
    return { ok: true };
  });
}

export function assertPickerCanWork(worker: { shiftStatus: string }) {
  if (worker.shiftStatus === 'OFF_SHIFT') {
    throw new WorkflowError('Смена закрыта. Обратитесь к администратору', 409);
  }
}
