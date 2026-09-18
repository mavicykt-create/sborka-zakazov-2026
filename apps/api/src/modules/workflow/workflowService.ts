import type { EventType, ItemStatus, Prisma, ShiftStatus } from '@prisma/client';
import { db } from '../../db.js';
import { hashPassword } from '../auth/password.js';
import { distributeItems } from './distribution.js';
import {
  assertItemTransition,
  isFinalItemStatus,
  previousStatusForUndo,
  type WorkflowItemStatus,
} from './statusTransitions.js';

type DbClient = Prisma.TransactionClient | typeof db;

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

const publicWorkerSelect = {
  id: true,
  login: true,
  name: true,
  isActive: true,
  shiftStatus: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { assignedItems: true } },
} satisfies Prisma.WorkerSelect;

const assignedWorkerSelect = {
  id: true,
  login: true,
  name: true,
  isActive: true,
  shiftStatus: true,
} satisfies Prisma.WorkerSelect;

const finalStatuses: ItemStatus[] = ['PICKED', 'NOT_FOUND', 'SKIPPED'];
const unfinishedStatuses: ItemStatus[] = ['PENDING', 'ASSIGNED', 'ACTIVE'];

export interface CreateWorkerInput {
  login: string;
  password: string;
  name: string;
  isActive?: boolean;
  shiftStatus?: ShiftStatus;
}

export interface UpdateWorkerInput {
  login?: string;
  password?: string;
  name?: string;
  isActive?: boolean;
  shiftStatus?: ShiftStatus;
}

export async function listWorkers() {
  return db.worker.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], select: publicWorkerSelect });
}

export async function createWorker(input: CreateWorkerInput) {
  const isActive = input.isActive ?? true;
  return db.worker.create({
    data: {
      login: input.login.trim().toLowerCase(),
      passwordHash: await hashPassword(input.password),
      name: input.name.trim(),
      isActive,
      shiftStatus: isActive ? (input.shiftStatus ?? 'AVAILABLE') : 'OFF_SHIFT',
    },
    select: publicWorkerSelect,
  });
}

export async function updateWorker(id: string, input: UpdateWorkerInput) {
  const worker = await db.worker.findUnique({ where: { id } });
  if (!worker) throw new WorkflowError('Сборщик не найден', 404);

  const shouldStop = input.isActive === false || input.shiftStatus === 'OFF_SHIFT';
  if (shouldStop) {
    const unfinished = await db.orderItem.count({
      where: { assignedWorkerId: id, status: { in: ['ASSIGNED', 'ACTIVE'] } },
    });
    if (unfinished > 0) {
      throw new WorkflowError('Сначала перераспределите незавершённые позиции сборщика', 409);
    }
  }

  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  const isActive = input.isActive ?? worker.isActive;
  return db.worker.update({
    where: { id },
    data: {
      login: input.login?.trim().toLowerCase(),
      passwordHash,
      name: input.name?.trim(),
      isActive,
      shiftStatus: isActive ? input.shiftStatus : 'OFF_SHIFT',
    },
    select: publicWorkerSelect,
  });
}

export async function listOrdersWithProgress() {
  const orders = await db.order.findMany({
    orderBy: { createdAt: 'desc' },
    include: { items: { select: { status: true } } },
  });

  return orders.map(({ items, ...order }) => ({
    ...order,
    _count: { items: items.length },
    progress: buildProgress(items),
  }));
}

export async function getOrderDetails(orderId: string, client: DbClient = db) {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        orderBy: { sortIndex: 'asc' },
        include: { assignedWorker: { select: assignedWorkerSelect } },
      },
    },
  });
  if (!order) throw new WorkflowError('Заказ не найден', 404);

  return {
    ...order,
    _count: { items: order.items.length },
    progress: buildProgress(order.items),
  };
}

function buildProgress(items: Array<{ status: ItemStatus }>) {
  const summary = {
    PENDING: 0,
    ASSIGNED: 0,
    ACTIVE: 0,
    PICKED: 0,
    NOT_FOUND: 0,
    SKIPPED: 0,
  } satisfies Record<ItemStatus, number>;
  for (const item of items) summary[item.status] += 1;
  const completed = summary.PICKED + summary.NOT_FOUND + summary.SKIPPED;
  return {
    total: items.length,
    completed,
    percent: items.length ? Math.round((completed / items.length) * 100) : 0,
    summary,
  };
}

export async function assignOrder(orderId: string, requestedWorkerIds: string[], reassign = false) {
  const workerIds = [...new Set(requestedWorkerIds)];
  if (workerIds.length === 0) throw new WorkflowError('Выберите хотя бы одного сборщика');

  return db.$transaction(
    async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: { orderBy: { sortIndex: 'asc' } } },
      });
      if (!order) throw new WorkflowError('Заказ не найден', 404);
      if (order.status === 'COMPLETED' || order.status === 'CLOSED') {
        throw new WorkflowError('Завершённый заказ нельзя распределить', 409);
      }

      const workers = await tx.worker.findMany({
        where: { id: { in: workerIds } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      if (workers.length !== workerIds.length) throw new WorkflowError('Один из сборщиков не найден', 404);

      const currentWorkerIds = new Set(order.items.map((item) => item.assignedWorkerId).filter(Boolean));
      const unavailable = workers.find(
        (worker) =>
          !worker.isActive ||
          worker.shiftStatus === 'OFF_SHIFT' ||
          (!reassign && worker.shiftStatus !== 'AVAILABLE') ||
          (reassign && worker.shiftStatus === 'BUSY' && !currentWorkerIds.has(worker.id)),
      );
      if (unavailable) {
        throw new WorkflowError(`Сборщик «${unavailable.name}» недоступен для назначения`, 409);
      }

      const items = reassign
        ? order.items.filter((item) => unfinishedStatuses.includes(item.status))
        : order.items;
      if (items.length === 0) throw new WorkflowError('Нет незавершённых позиций для распределения', 409);
      if (!reassign && items.some((item) => item.status !== 'PENDING')) {
        throw new WorkflowError('Заказ уже распределён; используйте перераспределение', 409);
      }

      const assignments = distributeItems(
        items.map((item) => item.id),
        workers.map((worker) => worker.id),
      );
      const previousByItem = new Map(items.map((item) => [item.id, item.assignedWorkerId]));
      const now = new Date();

      for (const assignment of assignments) {
        await tx.orderItem.update({
          where: { id: assignment.itemId },
          data: {
            assignedWorkerId: assignment.workerId,
            assignedAt: now,
            status: 'ASSIGNED',
            pickedAt: null,
          },
        });
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: order.startedAt ? 'PICKING' : 'ASSIGNED', completedAt: null },
      });
      await tx.worker.updateMany({
        where: { id: { in: workers.map((worker) => worker.id) } },
        data: { shiftStatus: 'BUSY' },
      });

      await tx.orderEvent.createMany({
        data: assignments.map((assignment) => ({
          orderId,
          itemId: assignment.itemId,
          workerId: assignment.workerId,
          type: reassign ? ('ITEM_REASSIGNED' as const) : ('ITEM_ASSIGNED' as const),
          metadata: reassign ? { previousWorkerId: previousByItem.get(assignment.itemId) } : undefined,
        })),
      });
      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'ORDER_ASSIGNED',
          metadata: {
            workerIds: workers.map((worker) => worker.id),
            reassign,
            itemCount: assignments.length,
          },
        },
      });

      const previousWorkers = [...currentWorkerIds].filter((id): id is string => typeof id === 'string');
      await refreshWorkerStatuses(
        tx,
        previousWorkers.filter((id) => !workerIds.includes(id)),
      );
      return getOrderDetails(orderId, tx);
    },
    { isolationLevel: 'Serializable' },
  );
}

export async function changeItemStatus(
  itemId: string,
  nextStatus: WorkflowItemStatus,
  workerId?: string,
  deviceAt?: Date,
) {
  return db.$transaction(async (tx) => {
    const item = await tx.orderItem.findUnique({ where: { id: itemId }, include: { order: true } });
    if (!item) throw new WorkflowError('Позиция не найдена', 404);
    if (item.order.status === 'CLOSED') throw new WorkflowError('Закрытый заказ нельзя изменять', 409);
    if (!item.assignedWorkerId) throw new WorkflowError('Позиция не назначена сборщику', 409);
    if (workerId && workerId !== item.assignedWorkerId) {
      throw new WorkflowError('Позиция назначена другому сборщику', 403);
    }

    try {
      assertItemTransition(item.status, nextStatus);
    } catch (error) {
      throw new WorkflowError(error instanceof Error ? error.message : 'Недопустимый переход статуса', 409);
    }

    const now = new Date();
    const isFinal = isFinalItemStatus(nextStatus);
    await tx.orderItem.update({
      where: { id: itemId },
      data: { status: nextStatus, pickedAt: isFinal ? now : null },
    });

    if (!item.order.startedAt && nextStatus === 'ACTIVE') {
      await tx.order.update({ where: { id: item.orderId }, data: { status: 'PICKING', startedAt: now } });
      await tx.orderEvent.create({
        data: { orderId: item.orderId, workerId: item.assignedWorkerId, type: 'ORDER_STARTED' },
      });
    } else if (item.order.status === 'ASSIGNED') {
      await tx.order.update({ where: { id: item.orderId }, data: { status: 'PICKING' } });
    }

    const eventByStatus: Partial<Record<WorkflowItemStatus, EventType>> = {
      ACTIVE: 'ITEM_ACTIVE',
      PICKED: 'ITEM_PICKED',
      NOT_FOUND: 'ITEM_NOT_FOUND',
      SKIPPED: 'ITEM_SKIPPED',
    };
    const eventType = eventByStatus[nextStatus];
    if (!eventType) throw new WorkflowError('Этот статус нельзя установить вручную', 409);
    await tx.orderEvent.create({
      data: {
        orderId: item.orderId,
        itemId,
        workerId: item.assignedWorkerId,
        type: eventType,
        deviceAt,
        metadata: { previousStatus: item.status, nextStatus },
      },
    });

    const remaining = await tx.orderItem.count({
      where: { orderId: item.orderId, status: { notIn: finalStatuses } },
    });
    if (remaining === 0) {
      const problemCount = await tx.orderItem.count({
        where: {
          orderId: item.orderId,
          OR: [{ status: { in: ['NOT_FOUND', 'SKIPPED'] } }, { pickType: 'REVIEW' }],
        },
      });
      const finalOrderStatus = problemCount > 0 ? 'REVIEW_REQUIRED' : 'COMPLETED';
      await tx.order.update({
        where: { id: item.orderId },
        data: { status: finalOrderStatus, completedAt: now },
      });
      await tx.orderEvent.create({
        data: {
          orderId: item.orderId,
          type: 'ORDER_COMPLETED',
          metadata: { finalStatus: finalOrderStatus, problemCount },
        },
      });
      const orderWorkers = await tx.orderItem.findMany({
        where: { orderId: item.orderId, assignedWorkerId: { not: null } },
        distinct: ['assignedWorkerId'],
        select: { assignedWorkerId: true },
      });
      await refreshWorkerStatuses(
        tx,
        orderWorkers.map((entry) => entry.assignedWorkerId).filter((id): id is string => Boolean(id)),
      );
    }

    return getOrderDetails(item.orderId, tx);
  });
}

export async function undoItemStatus(itemId: string, workerId?: string, deviceAt?: Date) {
  return db.$transaction(async (tx) => {
    const item = await tx.orderItem.findUnique({ where: { id: itemId }, include: { order: true } });
    if (!item) throw new WorkflowError('Позиция не найдена', 404);
    if (item.order.status === 'CLOSED') throw new WorkflowError('Закрытый заказ нельзя изменять', 409);
    if (!item.assignedWorkerId) throw new WorkflowError('Позиция не назначена сборщику', 409);
    if (workerId && workerId !== item.assignedWorkerId) {
      throw new WorkflowError('Позиция назначена другому сборщику', 403);
    }

    let previous: WorkflowItemStatus;
    try {
      previous = previousStatusForUndo(item.status);
    } catch (error) {
      throw new WorkflowError(error instanceof Error ? error.message : 'Действие нельзя отменить', 409);
    }

    await tx.orderItem.update({ where: { id: itemId }, data: { status: previous, pickedAt: null } });
    await tx.order.update({
      where: { id: item.orderId },
      data: { status: item.order.startedAt ? 'PICKING' : 'ASSIGNED', completedAt: null },
    });
    await tx.worker.update({ where: { id: item.assignedWorkerId }, data: { shiftStatus: 'BUSY' } });
    await tx.orderEvent.create({
      data: {
        orderId: item.orderId,
        itemId,
        workerId: item.assignedWorkerId,
        type: 'ITEM_UNDONE',
        deviceAt,
        metadata: { fromStatus: item.status, toStatus: previous },
      },
    });
    return getOrderDetails(item.orderId, tx);
  });
}

export async function getOrderEvents(orderId: string) {
  const exists = await db.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!exists) throw new WorkflowError('Заказ не найден', 404);
  return db.orderEvent.findMany({
    where: { orderId },
    orderBy: [{ serverAt: 'desc' }, { id: 'desc' }],
    include: {
      worker: { select: assignedWorkerSelect },
      item: { select: { id: true, name: true, sourceLine: true } },
    },
  });
}

async function refreshWorkerStatuses(tx: Prisma.TransactionClient, workerIds: string[]) {
  for (const workerId of [...new Set(workerIds)]) {
    const unfinished = await tx.orderItem.count({
      where: { assignedWorkerId: workerId, status: { in: ['ASSIGNED', 'ACTIVE'] } },
    });
    if (unfinished === 0) {
      await tx.worker.updateMany({
        where: { id: workerId, isActive: true, shiftStatus: 'BUSY' },
        data: { shiftStatus: 'AVAILABLE' },
      });
    }
  }
}
