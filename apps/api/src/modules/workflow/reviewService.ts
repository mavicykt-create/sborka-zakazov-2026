import type { EventType, ItemStatus, PickType, Prisma, ProblemResolution } from '@prisma/client';
import { db } from '../../db.js';
import { getOrderDetails, WorkflowError } from './workflowService.js';

const finalStatuses: ItemStatus[] = ['PICKED', 'NOT_FOUND', 'SKIPPED'];

const workerSelect = {
  id: true,
  login: true,
  name: true,
  isActive: true,
  shiftStatus: true,
} satisfies Prisma.WorkerSelect;

export interface ReviewItemInput {
  pickType: Exclude<PickType, 'REVIEW'>;
  pickQuantity: number;
  comment: string;
  reviewedBy: string;
}

export interface ResolveProblemInput {
  action: 'CONFIRM' | 'RETURN_TO_WORK';
  comment: string;
  reviewedBy: string;
  workerId?: string;
}

function unresolvedProblemWhere(orderId?: string): Prisma.OrderItemWhereInput {
  return {
    orderId,
    OR: [
      {
        AND: [
          { pickType: 'REVIEW' },
          { OR: [{ problemResolution: null }, { problemResolution: { not: 'RESOLVED' } }] },
        ],
      },
      {
        AND: [
          { status: { in: ['NOT_FOUND', 'SKIPPED'] } },
          { OR: [{ problemResolution: null }, { problemResolution: { not: 'CONFIRMED' } }] },
        ],
      },
    ],
  };
}

export async function reviewItem(itemId: string, input: ReviewItemInput) {
  return db.$transaction(async (tx) => {
    const item = await tx.orderItem.findUnique({ where: { id: itemId }, include: { order: true } });
    if (!item) throw new WorkflowError('Позиция не найдена', 404);
    if (item.order.status === 'CLOSED' || item.order.status === 'CANCELLED') {
      throw new WorkflowError('Закрытый или отменённый заказ нельзя изменять', 409);
    }
    if (item.pickType !== 'REVIEW') throw new WorkflowError('Тип отбора этой позиции уже определён', 409);
    if (input.pickQuantity <= 0) throw new WorkflowError('Количество отбора должно быть больше нуля');

    const now = new Date();
    await tx.orderItem.update({
      where: { id: itemId },
      data: {
        pickType: input.pickType,
        pickQuantity: input.pickQuantity,
        problemResolution: 'RESOLVED',
        reviewComment: input.comment,
        reviewedBy: input.reviewedBy,
        reviewedAt: now,
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: item.orderId,
        itemId,
        workerId: item.assignedWorkerId,
        type: 'ITEM_REVIEWED',
        metadata: {
          reviewedBy: input.reviewedBy,
          comment: input.comment,
          previousPickType: item.pickType,
          nextPickType: input.pickType,
          previousPickQuantity: item.pickQuantity.toString(),
          nextPickQuantity: input.pickQuantity,
        },
      },
    });
    return getOrderDetails(item.orderId, tx);
  });
}

export async function resolveProblem(itemId: string, input: ResolveProblemInput) {
  return db.$transaction(async (tx) => {
    const item = await tx.orderItem.findUnique({ where: { id: itemId }, include: { order: true } });
    if (!item) throw new WorkflowError('Позиция не найдена', 404);
    if (item.order.status === 'CLOSED' || item.order.status === 'CANCELLED') {
      throw new WorkflowError('Закрытый или отменённый заказ нельзя изменять', 409);
    }
    if (!['NOT_FOUND', 'SKIPPED'].includes(item.status)) {
      throw new WorkflowError('У позиции нет проблемы, которую можно подтвердить или вернуть в работу', 409);
    }

    const now = new Date();
    if (input.action === 'CONFIRM') {
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          problemResolution: 'CONFIRMED',
          reviewComment: input.comment,
          reviewedBy: input.reviewedBy,
          reviewedAt: now,
        },
      });
      await createReviewEvent(tx, item, 'PROBLEM_CONFIRMED', input, {
        status: item.status,
        resolution: 'CONFIRMED',
      });
      return getOrderDetails(item.orderId, tx);
    }

    if (!input.workerId) throw new WorkflowError('Выберите сборщика для возврата позиции в работу');
    const worker = await tx.worker.findUnique({ where: { id: input.workerId } });
    if (!worker) throw new WorkflowError('Сборщик не найден', 404);
    if (!worker.isActive || worker.shiftStatus === 'OFF_SHIFT') {
      throw new WorkflowError(`Сборщик «${worker.name}» недоступен`, 409);
    }

    await tx.orderItem.update({
      where: { id: itemId },
      data: {
        status: 'ASSIGNED',
        assignedWorkerId: worker.id,
        assignedAt: now,
        pickedAt: null,
        problemResolution: null,
        reviewComment: input.comment,
        reviewedBy: input.reviewedBy,
        reviewedAt: now,
      },
    });
    await tx.order.update({
      where: { id: item.orderId },
      data: { status: item.order.startedAt ? 'PICKING' : 'ASSIGNED', completedAt: null },
    });
    await tx.worker.update({ where: { id: worker.id }, data: { shiftStatus: 'BUSY' } });
    await createReviewEvent(tx, item, 'PROBLEM_RETURNED', input, {
      previousStatus: item.status,
      nextStatus: 'ASSIGNED',
      previousWorkerId: item.assignedWorkerId,
      nextWorkerId: worker.id,
    });
    return getOrderDetails(item.orderId, tx);
  });
}

async function createReviewEvent(
  tx: Prisma.TransactionClient,
  item: { id: string; orderId: string; assignedWorkerId: string | null },
  type: EventType,
  input: ResolveProblemInput,
  details: Prisma.InputJsonObject,
) {
  await tx.orderEvent.create({
    data: {
      orderId: item.orderId,
      itemId: item.id,
      workerId: input.workerId ?? item.assignedWorkerId,
      type,
      metadata: { reviewedBy: input.reviewedBy, comment: input.comment, ...details },
    },
  });
}

export async function closeOrder(orderId: string, reviewedBy: string, comment?: string) {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new WorkflowError('Заказ не найден', 404);
    if (order.status === 'CLOSED') return getOrderDetails(orderId, tx);
    if (!['COMPLETED', 'REVIEW_REQUIRED'].includes(order.status)) {
      throw new WorkflowError('Закрыть можно только завершённый заказ', 409);
    }
    if (order.items.some((item) => !finalStatuses.includes(item.status))) {
      throw new WorkflowError('В заказе остаются незавершённые позиции', 409);
    }
    const unresolved = await tx.orderItem.count({ where: unresolvedProblemWhere(orderId) });
    if (unresolved > 0) {
      throw new WorkflowError(`Сначала решите проблемные позиции: ${unresolved}`, 409);
    }

    const now = new Date();
    const workerIds = [
      ...new Set(order.items.map((item) => item.assignedWorkerId).filter((id): id is string => Boolean(id))),
    ];
    await tx.order.update({ where: { id: orderId }, data: { status: 'CLOSED', closedAt: now } });
    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'ORDER_CLOSED',
        metadata: { reviewedBy, comment: comment ?? null, closedAt: now.toISOString() },
      },
    });
    for (const workerId of workerIds) {
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
    return getOrderDetails(orderId, tx);
  });
}

export interface ProblemFilters {
  orderId?: string;
  type?: 'REVIEW' | 'NOT_FOUND' | 'SKIPPED';
  resolution?: 'UNRESOLVED' | ProblemResolution | 'ALL';
}

export async function listProblems(filters: ProblemFilters = {}) {
  const typeWhere: Prisma.OrderItemWhereInput =
    filters.type === 'REVIEW'
      ? { pickType: 'REVIEW' }
      : filters.type
        ? { status: filters.type }
        : { OR: [{ pickType: 'REVIEW' }, { status: { in: ['NOT_FOUND', 'SKIPPED'] } }] };
  const resolutionWhere: Prisma.OrderItemWhereInput =
    filters.resolution === 'ALL'
      ? {}
      : filters.resolution === 'CONFIRMED' || filters.resolution === 'RESOLVED'
        ? { problemResolution: filters.resolution }
        : unresolvedProblemWhere();

  return db.orderItem.findMany({
    where: {
      orderId: filters.orderId,
      order: { status: { notIn: ['CLOSED', 'CANCELLED'] } },
      AND: [typeWhere, resolutionWhere],
    },
    orderBy: [{ order: { createdAt: 'desc' } }, { sortIndex: 'asc' }],
    include: {
      assignedWorker: { select: workerSelect },
      order: {
        select: { id: true, documentNumber: true, documentDate: true, warehouse: true, status: true },
      },
    },
  });
}

export interface HistoryFilters {
  query?: string;
  status?: 'COMPLETED' | 'CLOSED' | 'REVIEW_REQUIRED';
  from?: Date;
  to?: Date;
}

export async function listOrderHistory(filters: HistoryFilters = {}) {
  const orders = await db.order.findMany({
    where: {
      status: filters.status ?? { in: ['COMPLETED', 'REVIEW_REQUIRED', 'CLOSED'] },
      documentNumber: filters.query ? { contains: filters.query, mode: 'insensitive' } : undefined,
      createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
    },
    orderBy: [{ closedAt: 'desc' }, { completedAt: 'desc' }, { createdAt: 'desc' }],
    include: { items: { select: { status: true } } },
  });
  return orders.map(({ items, ...order }) => {
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
      ...order,
      _count: { items: items.length },
      progress: {
        total: items.length,
        completed,
        percent: items.length ? Math.round((completed / items.length) * 100) : 0,
        summary,
      },
    };
  });
}

export interface EventFilters {
  page: number;
  pageSize: number;
  type?: EventType;
  workerId?: string;
  itemId?: string;
}

export async function getOrderEventsPage(orderId: string, filters: EventFilters) {
  const exists = await db.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!exists) throw new WorkflowError('Заказ не найден', 404);
  const where: Prisma.OrderEventWhereInput = {
    orderId,
    type: filters.type,
    workerId: filters.workerId,
    itemId: filters.itemId,
  };
  const [items, total] = await db.$transaction([
    db.orderEvent.findMany({
      where,
      orderBy: [{ serverAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        worker: { select: workerSelect },
        item: { select: { id: true, name: true, sourceLine: true } },
      },
    }),
    db.orderEvent.count({ where }),
  ]);
  return { items, total, page: filters.page, pageSize: filters.pageSize };
}
