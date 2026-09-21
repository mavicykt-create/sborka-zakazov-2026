import type { Prisma } from '@prisma/client';
import { db } from '../../db.js';

const unresolvedProblemWhere = {
  OR: [
    { pickType: 'REVIEW' as const },
    { status: { in: ['NOT_FOUND', 'SKIPPED'] }, problemResolution: null },
  ],
} satisfies Prisma.OrderItemWhereInput;

export async function getDashboard() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    newOrders,
    inProgress,
    ready,
    problemItems,
    failedImports,
    workers,
    recentOrders,
    problems,
    imports,
  ] = await Promise.all([
    db.order.count({ where: { status: { in: ['NEW', 'READY'] } } }),
    db.order.count({ where: { status: { in: ['ASSIGNED', 'PICKING'] } } }),
    db.order.count({ where: { status: 'COMPLETED' } }),
    db.orderItem.count({ where: unresolvedProblemWhere }),
    db.importAttempt.count({ where: { status: 'FAILED', createdAt: { gte: since } } }),
    db.worker.groupBy({ by: ['shiftStatus'], _count: { _all: true }, where: { isActive: true } }),
    db.order.findMany({
      where: { status: { notIn: ['CLOSED', 'CANCELLED'] } },
      take: 6,
      orderBy: { createdAt: 'desc' },
      include: { items: { select: { status: true } } },
    }),
    db.orderItem.findMany({
      where: unresolvedProblemWhere,
      take: 6,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        pickType: true,
        updatedAt: true,
        order: { select: { id: true, documentNumber: true } },
      },
    }),
    db.importAttempt.findMany({
      take: 6,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        filename: true,
        status: true,
        orderId: true,
        documentNumber: true,
        itemCount: true,
        errorMessage: true,
        createdAt: true,
      },
    }),
  ]);

  const workerCounts = { AVAILABLE: 0, BUSY: 0, OFF_SHIFT: 0 };
  for (const group of workers) workerCounts[group.shiftStatus] = group._count._all;

  return {
    generatedAt: new Date(),
    orders: { new: newOrders, inProgress, ready },
    items: { problems: problemItems },
    imports: { failed24h: failedImports, recent: imports },
    workers: workerCounts,
    recentOrders: recentOrders.map(({ items, ...order }) => ({
      ...order,
      itemCount: items.length,
      completedCount: items.filter((item) => ['PICKED', 'NOT_FOUND', 'SKIPPED'].includes(item.status)).length,
    })),
    attention: { problems },
  };
}

export async function getPublicSettings() {
  await db.$queryRaw`SELECT 1`;
  return {
    service: 'assembly-orders-2026',
    version: '0.1.0',
    database: 'connected',
    acceptedFormats: ['.xlsx'],
    maxUploadMb: 15,
    duplicateProtection: ['SHA-256 файла', 'номер + дата + склад'],
    terminalUrl: process.env.ADMIN_PUBLIC_URL ?? 'http://localhost:5173',
    serverTime: new Date(),
  };
}
