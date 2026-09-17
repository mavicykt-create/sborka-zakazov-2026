import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { buildApp } from '../src/server.js';

const runDatabaseTests = process.env.RUN_DB_TESTS === '1';

describe.runIf(runDatabaseTests)('warehouse workflow integration', () => {
  let app: FastifyInstance;
  const logins = ['it-anna', 'it-boris', 'it-vera'];

  beforeAll(async () => {
    app = await buildApp();
    await db.order.deleteMany({ where: { documentNumber: '12293', warehouse: 'Основной склад' } });
    await db.worker.deleteMany({ where: { login: { in: [...logins, 'it-off-shift'] } } });
  });

  afterAll(async () => {
    await db.order.deleteMany({ where: { documentNumber: '12293', warehouse: 'Основной склад' } });
    await db.worker.deleteMany({ where: { login: { in: [...logins, 'it-off-shift'] } } });
    await app.close();
    await db.$disconnect();
  });

  it('imports, assigns 16/16/16, completes and audits the real order', async () => {
    const workers = [];
    for (const [index, login] of logins.entries()) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/workers',
        payload: {
          login,
          password: 'integration-pass-123',
          name: `Тестовый сборщик ${index + 1}`,
          shiftStatus: 'AVAILABLE',
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.body).not.toContain('passwordHash');
      workers.push(response.json<{ id: string }>());
    }

    const offShift = await app.inject({
      method: 'POST',
      url: '/api/workers',
      payload: {
        login: 'it-off-shift',
        password: 'integration-pass-123',
        name: 'Сборщик вне смены',
        shiftStatus: 'OFF_SHIFT',
      },
    });
    expect(offShift.statusCode).toBe(201);

    const path = fileURLToPath(new URL('../../../test-data/sample-order-12293.xlsx', import.meta.url));
    const file = await readFile(path);
    const form = new FormData();
    form.append('file', new Blob([file]), 'sample-order-12293.xlsx');
    const serialized = new Request('http://localhost', { method: 'POST', body: form });
    const imported = await app.inject({
      method: 'POST',
      url: '/api/orders/import-xlsx',
      headers: Object.fromEntries(serialized.headers.entries()),
      payload: Buffer.from(await serialized.arrayBuffer()),
    });
    expect(imported.statusCode).toBe(201);
    const importedOrder = imported.json<{ order: { id: string; items: unknown[] } }>().order;
    expect(importedOrder.items).toHaveLength(48);

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/orders/${importedOrder.id}/assign`,
      payload: { workerIds: [offShift.json<{ id: string }>().id] },
    });
    expect(rejected.statusCode).toBe(409);

    const assigned = await app.inject({
      method: 'POST',
      url: `/api/orders/${importedOrder.id}/assign`,
      payload: { workerIds: workers.map((worker) => worker.id) },
    });
    expect(assigned.statusCode).toBe(200);
    const assignedOrder = assigned.json<{
      items: Array<{ id: string; assignedWorkerId: string; status: string }>;
    }>();
    const counts = assignedOrder.items.reduce<Record<string, number>>((result, item) => {
      result[item.assignedWorkerId] = (result[item.assignedWorkerId] ?? 0) + 1;
      return result;
    }, {});
    expect(Object.values(counts).sort()).toEqual([16, 16, 16]);
    expect(assignedOrder.items.every((item) => item.status === 'ASSIGNED')).toBe(true);

    for (const item of assignedOrder.items) {
      const active = await app.inject({
        method: 'PATCH',
        url: `/api/order-items/${item.id}/status`,
        payload: { status: 'ACTIVE', workerId: item.assignedWorkerId },
      });
      expect(active.statusCode).toBe(200);
      const picked = await app.inject({
        method: 'PATCH',
        url: `/api/order-items/${item.id}/status`,
        payload: { status: 'PICKED', workerId: item.assignedWorkerId },
      });
      expect(picked.statusCode).toBe(200);
    }

    const completed = await app.inject({ method: 'GET', url: `/api/orders/${importedOrder.id}` });
    expect(completed.statusCode).toBe(200);
    expect(completed.json<{ status: string; progress: { completed: number } }>().status).toBe('COMPLETED');
    expect(completed.json<{ progress: { completed: number } }>().progress.completed).toBe(48);

    const events = await app.inject({ method: 'GET', url: `/api/orders/${importedOrder.id}/events` });
    expect(events.statusCode).toBe(200);
    const eventTypes = events.json<Array<{ type: string }>>().map((event) => event.type);
    expect(eventTypes).toContain('ORDER_ASSIGNED');
    expect(eventTypes).toContain('ORDER_STARTED');
    expect(eventTypes).toContain('ORDER_COMPLETED');
    expect(eventTypes.filter((type) => type === 'ITEM_PICKED')).toHaveLength(48);
  }, 120_000);
});
