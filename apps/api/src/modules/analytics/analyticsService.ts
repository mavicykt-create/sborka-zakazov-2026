import type { EventType } from '@prisma/client';
import { db } from '../../db.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const outcomeTypes = ['ITEM_PICKED', 'ITEM_NOT_FOUND', 'ITEM_SKIPPED'] as const satisfies EventType[];
const analyticsEventTypes = [...outcomeTypes, 'ITEM_UNDONE'] as const satisfies EventType[];

type OutcomeType = (typeof outcomeTypes)[number];
type AnalyticsEventType = (typeof analyticsEventTypes)[number];

type AnalyticsEvent = {
  itemId: string | null;
  workerId: string | null;
  type: AnalyticsEventType;
  serverAt: Date;
  worker: { id: string; name: string } | null;
};

export type DailyAnalytics = {
  date: string;
  ordersCreated: number;
  ordersCompleted: number;
  picked: number;
  problems: number;
};

export function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function buildDailyRange(from: Date, days: number): DailyAnalytics[] {
  return Array.from({ length: days }, (_, index) => ({
    date: dateKey(new Date(from.getTime() + index * DAY_MS)),
    ordersCreated: 0,
    ordersCompleted: 0,
    picked: 0,
    problems: 0,
  }));
}

function isOutcome(event: AnalyticsEvent): event is AnalyticsEvent & { type: OutcomeType } {
  return (outcomeTypes as readonly EventType[]).includes(event.type);
}

export function latestOutcomes(events: AnalyticsEvent[]) {
  const outcomes = new Map<string, AnalyticsEvent>();
  for (const event of events) {
    if (!event.itemId) continue;
    const previous = outcomes.get(event.itemId);
    if (!previous || event.serverAt >= previous.serverAt) outcomes.set(event.itemId, event);
  }
  return [...outcomes.values()].filter(isOutcome);
}

export async function getAnalytics(days: 7 | 30 | 90) {
  const to = new Date();
  const from = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - (days - 1) * DAY_MS,
  );

  const [orders, outcomeEvents] = await Promise.all([
    db.order.findMany({
      where: {
        OR: [
          { createdAt: { gte: from, lte: to } },
          { completedAt: { gte: from, lte: to } },
          { closedAt: { gte: from, lte: to } },
        ],
      },
      select: {
        id: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        closedAt: true,
      },
    }),
    db.orderEvent.findMany({
      where: {
        type: { in: [...analyticsEventTypes] },
        serverAt: { gte: from, lte: to },
        itemId: { not: null },
      },
      orderBy: { serverAt: 'asc' },
      select: {
        itemId: true,
        workerId: true,
        type: true,
        serverAt: true,
        worker: { select: { id: true, name: true } },
      },
    }),
  ]);

  const outcomes = latestOutcomes(outcomeEvents as AnalyticsEvent[]);
  const daily = buildDailyRange(from, days);
  const dailyByDate = new Map(daily.map((entry) => [entry.date, entry]));

  let ordersCreated = 0;
  let ordersCompleted = 0;
  let ordersClosed = 0;
  const cycleMinutes: number[] = [];

  for (const order of orders) {
    if (order.createdAt >= from && order.createdAt <= to) {
      ordersCreated += 1;
      const entry = dailyByDate.get(dateKey(order.createdAt));
      if (entry) entry.ordersCreated += 1;
    }
    if (order.completedAt && order.completedAt >= from && order.completedAt <= to) {
      ordersCompleted += 1;
      const entry = dailyByDate.get(dateKey(order.completedAt));
      if (entry) entry.ordersCompleted += 1;
      if (order.startedAt && order.completedAt >= order.startedAt) {
        cycleMinutes.push((order.completedAt.getTime() - order.startedAt.getTime()) / 60_000);
      }
    }
    if (order.closedAt && order.closedAt >= from && order.closedAt <= to) ordersClosed += 1;
  }

  const workerMap = new Map<
    string,
    { id: string; name: string; handled: number; picked: number; notFound: number; skipped: number }
  >();
  let picked = 0;
  let notFound = 0;
  let skipped = 0;

  for (const event of outcomes) {
    if (event.type === 'ITEM_PICKED') picked += 1;
    if (event.type === 'ITEM_NOT_FOUND') notFound += 1;
    if (event.type === 'ITEM_SKIPPED') skipped += 1;

    const entry = dailyByDate.get(dateKey(event.serverAt));
    if (entry) {
      if (event.type === 'ITEM_PICKED') entry.picked += 1;
      else entry.problems += 1;
    }

    if (!event.workerId || !event.worker) continue;
    const worker = workerMap.get(event.workerId) ?? {
      id: event.worker.id,
      name: event.worker.name,
      handled: 0,
      picked: 0,
      notFound: 0,
      skipped: 0,
    };
    worker.handled += 1;
    if (event.type === 'ITEM_PICKED') worker.picked += 1;
    if (event.type === 'ITEM_NOT_FOUND') worker.notFound += 1;
    if (event.type === 'ITEM_SKIPPED') worker.skipped += 1;
    workerMap.set(event.workerId, worker);
  }

  const handled = outcomes.length;
  const averageCycleMinutes = cycleMinutes.length
    ? Math.round(cycleMinutes.reduce((sum, value) => sum + value, 0) / cycleMinutes.length)
    : null;

  return {
    generatedAt: to,
    period: { days, from, to },
    summary: {
      ordersCreated,
      ordersCompleted,
      ordersClosed,
      handled,
      picked,
      notFound,
      skipped,
      successRate: handled ? Math.round((picked / handled) * 1000) / 10 : 0,
      averageCycleMinutes,
    },
    daily,
    workers: [...workerMap.values()]
      .map((worker) => ({
        ...worker,
        successRate: worker.handled ? Math.round((worker.picked / worker.handled) * 1000) / 10 : 0,
      }))
      .sort((left, right) => right.picked - left.picked || left.name.localeCompare(right.name, 'ru')),
  };
}
