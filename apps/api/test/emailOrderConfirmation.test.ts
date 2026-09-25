import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    order: { findFirst: vi.fn(), update: vi.fn() },
    orderEvent: { create: vi.fn() },
    orderItem: { count: vi.fn() },
    worker: { updateMany: vi.fn() },
  };
  return { tx, transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
});

vi.mock('../src/db.js', () => ({ db: { $transaction: mocks.transaction } }));

import { confirmEmailOrder } from '../src/modules/email/emailOrderService.js';

describe('email order closure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('closes a fully picked order only after the confirmation email', async () => {
    mocks.tx.order.findFirst.mockResolvedValue({
      id: 'order-1',
      status: 'COMPLETED',
      completedAt: new Date('2026-09-26T08:00:00Z'),
      emailConfirmedAt: null,
      items: [{ status: 'PICKED', assignedWorkerId: null }],
    });
    const receivedAt = new Date('2026-09-26T08:05:00Z');

    const result = await confirmEmailOrder('13183', receivedAt, 'message-1');

    expect(result).toEqual({ matched: true, closed: true, alreadyConfirmed: false });
    expect(mocks.tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({ status: 'CLOSED', emailConfirmedAt: receivedAt, closedAt: receivedAt }),
    });
    expect(mocks.tx.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'ORDER_CLOSED' }),
    });
  });

  it('remembers an early confirmation without closing an unfinished order', async () => {
    mocks.tx.order.findFirst.mockResolvedValue({
      id: 'order-2',
      status: 'PICKING',
      completedAt: null,
      emailConfirmedAt: null,
      items: [{ status: 'ACTIVE', assignedWorkerId: null }],
    });
    const receivedAt = new Date('2026-09-26T08:05:00Z');

    const result = await confirmEmailOrder('13184', receivedAt, 'message-2');

    expect(result).toEqual({ matched: true, closed: false, alreadyConfirmed: false });
    expect(mocks.tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-2' },
      data: { emailConfirmedAt: receivedAt },
    });
    expect(mocks.tx.orderEvent.create).not.toHaveBeenCalled();
  });
});
