import { describe, expect, it } from 'vitest';
import { buildDailyRange, latestOutcomes } from '../src/modules/analytics/analyticsService.js';

describe('analytics aggregation', () => {
  it('builds a continuous UTC day range including empty days', () => {
    expect(buildDailyRange(new Date('2026-09-16T00:00:00.000Z'), 3)).toEqual([
      { date: '2026-09-16', ordersCreated: 0, ordersCompleted: 0, picked: 0, problems: 0 },
      { date: '2026-09-17', ordersCreated: 0, ordersCompleted: 0, picked: 0, problems: 0 },
      { date: '2026-09-18', ordersCreated: 0, ordersCompleted: 0, picked: 0, problems: 0 },
    ]);
  });

  it('keeps only the latest outcome for each item', () => {
    const events = [
      {
        itemId: 'item-1',
        workerId: 'worker-1',
        type: 'ITEM_PICKED' as const,
        serverAt: new Date('2026-09-18T09:00:00.000Z'),
        worker: { id: 'worker-1', name: 'Анна' },
      },
      {
        itemId: 'item-2',
        workerId: 'worker-2',
        type: 'ITEM_PICKED' as const,
        serverAt: new Date('2026-09-18T09:01:00.000Z'),
        worker: { id: 'worker-2', name: 'Борис' },
      },
      {
        itemId: 'item-1',
        workerId: 'worker-1',
        type: 'ITEM_NOT_FOUND' as const,
        serverAt: new Date('2026-09-18T09:02:00.000Z'),
        worker: { id: 'worker-1', name: 'Анна' },
      },
      {
        itemId: 'item-3',
        workerId: 'worker-1',
        type: 'ITEM_PICKED' as const,
        serverAt: new Date('2026-09-18T09:03:00.000Z'),
        worker: { id: 'worker-1', name: 'Анна' },
      },
      {
        itemId: 'item-3',
        workerId: 'worker-1',
        type: 'ITEM_UNDONE' as const,
        serverAt: new Date('2026-09-18T09:04:00.000Z'),
        worker: { id: 'worker-1', name: 'Анна' },
      },
    ];

    expect(latestOutcomes(events)).toMatchObject([
      { itemId: 'item-1', type: 'ITEM_NOT_FOUND' },
      { itemId: 'item-2', type: 'ITEM_PICKED' },
    ]);
  });
});
