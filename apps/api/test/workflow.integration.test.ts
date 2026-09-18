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
  const importFilenames = ['sample-order-12293.xlsx', 'broken-order.xlsx'];

  beforeAll(async () => {
    app = await buildApp();
    await db.order.deleteMany({ where: { documentNumber: '12293', warehouse: 'Основной склад' } });
    await db.importAttempt.deleteMany({ where: { filename: { in: importFilenames } } });
    await db.worker.deleteMany({ where: { login: { in: [...logins, 'it-off-shift'] } } });
  });

  afterAll(async () => {
    await db.order.deleteMany({ where: { documentNumber: '12293', warehouse: 'Основной склад' } });
    await db.importAttempt.deleteMany({ where: { filename: { in: importFilenames } } });
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

    const duplicateForm = new FormData();
    duplicateForm.append('file', new Blob([file]), 'sample-order-12293.xlsx');
    const duplicateSerialized = new Request('http://localhost', { method: 'POST', body: duplicateForm });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/orders/import-xlsx',
      headers: Object.fromEntries(duplicateSerialized.headers.entries()),
      payload: Buffer.from(await duplicateSerialized.arrayBuffer()),
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json<{ duplicate: boolean }>().duplicate).toBe(true);

    const brokenForm = new FormData();
    brokenForm.append('file', new Blob([Buffer.from('not an xlsx workbook')]), 'broken-order.xlsx');
    const brokenSerialized = new Request('http://localhost', { method: 'POST', body: brokenForm });
    const broken = await app.inject({
      method: 'POST',
      url: '/api/orders/import-xlsx',
      headers: Object.fromEntries(brokenSerialized.headers.entries()),
      payload: Buffer.from(await brokenSerialized.arrayBuffer()),
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json<{ error: string }>().error).toContain('Ошибка импорта XLSX');

    const importLog = await app.inject({ method: 'GET', url: '/api/imports?limit=10' });
    expect(importLog.statusCode).toBe(200);
    expect(importLog.json<Array<{ status: string }>>().map((attempt) => attempt.status)).toEqual(
      expect.arrayContaining(['SUCCESS', 'DUPLICATE', 'FAILED']),
    );
    const failedImports = await app.inject({ method: 'GET', url: '/api/imports?status=FAILED&limit=10' });
    expect(failedImports.statusCode).toBe(200);
    const failedImportLog = failedImports.json<Array<{ status: string }>>();
    expect(failedImportLog.length).toBeGreaterThan(0);
    expect(failedImportLog.every((attempt) => attempt.status === 'FAILED')).toBe(true);

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json<{ imports: { failed24h: number } }>().imports.failed24h).toBeGreaterThanOrEqual(1);
    expect(dashboard.body).not.toContain('passwordHash');

    const reviewTarget = importedOrder.items[1] as { id: string };
    await db.orderItem.update({ where: { id: reviewTarget.id }, data: { pickType: 'REVIEW' } });
    const reviewed = await app.inject({
      method: 'PATCH',
      url: `/api/order-items/${reviewTarget.id}/review`,
      payload: {
        pickType: 'PIECE',
        pickQuantity: 7,
        comment: 'Количество проверено по товару',
        reviewedBy: 'Интеграционный тест',
      },
    });
    expect(reviewed.statusCode).toBe(200);
    expect(
      reviewed
        .json<{ items: Array<{ id: string; pickType: string; problemResolution: string | null }> }>()
        .items.find((item) => item.id === reviewTarget.id),
    ).toMatchObject({ pickType: 'PIECE', problemResolution: 'RESOLVED' });

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

    const problemItem = assignedOrder.items[0];
    const undone = await app.inject({
      method: 'POST',
      url: `/api/order-items/${problemItem.id}/undo`,
      payload: { workerId: problemItem.assignedWorkerId },
    });
    expect(undone.statusCode).toBe(200);
    const notFound = await app.inject({
      method: 'PATCH',
      url: `/api/order-items/${problemItem.id}/status`,
      payload: { status: 'NOT_FOUND', workerId: problemItem.assignedWorkerId },
    });
    expect(notFound.statusCode).toBe(200);
    expect(notFound.json<{ status: string }>().status).toBe('REVIEW_REQUIRED');

    const rejectedClose = await app.inject({
      method: 'POST',
      url: `/api/orders/${importedOrder.id}/close`,
      payload: { reviewedBy: 'Интеграционный тест' },
    });
    expect(rejectedClose.statusCode).toBe(409);

    const problems = await app.inject({ method: 'GET', url: `/api/problems?orderId=${importedOrder.id}` });
    expect(problems.statusCode).toBe(200);
    expect(problems.json<Array<{ id: string }>>()).toHaveLength(1);

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/order-items/${problemItem.id}/resolve-problem`,
      payload: {
        action: 'CONFIRM',
        comment: 'Фактическое отсутствие подтверждено',
        reviewedBy: 'Интеграционный тест',
      },
    });
    expect(confirmed.statusCode).toBe(200);

    const closed = await app.inject({
      method: 'POST',
      url: `/api/orders/${importedOrder.id}/close`,
      payload: { reviewedBy: 'Интеграционный тест', comment: 'Заказ проверен' },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json<{ status: string; closedAt: string }>().status).toBe('CLOSED');
    expect(closed.json<{ closedAt: string }>().closedAt).toBeTruthy();

    const rejectedUndo = await app.inject({
      method: 'POST',
      url: `/api/order-items/${problemItem.id}/undo`,
      payload: { workerId: problemItem.assignedWorkerId },
    });
    expect(rejectedUndo.statusCode).toBe(409);

    const unresolved = await app.inject({ method: 'GET', url: `/api/problems?orderId=${importedOrder.id}` });
    expect(unresolved.json<unknown[]>()).toHaveLength(0);
    const history = await app.inject({ method: 'GET', url: '/api/orders/history?status=CLOSED&query=12293' });
    expect(history.json<Array<{ id: string }>>().some((order) => order.id === importedOrder.id)).toBe(true);
    const audit = await app.inject({
      method: 'GET',
      url: `/api/orders/${importedOrder.id}/events?paginated=true&pageSize=100`,
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json<{ items: Array<{ type: string }> }>().items.map((event) => event.type)).toContain(
      'ORDER_CLOSED',
    );

    for (const kind of ['short', 'full']) {
      const report = await app.inject({
        method: 'GET',
        url: `/api/orders/${importedOrder.id}/reports/${kind}.pdf`,
      });
      expect(report.statusCode).toBe(200);
      expect(report.headers['content-type']).toContain('application/pdf');
      expect(report.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      expect(report.rawPayload.length).toBeGreaterThan(5_000);
    }
  }, 180_000);
});
