import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import { ZodError, z } from 'zod';
import { db } from './db.js';
import { getAnalytics } from './modules/analytics/analyticsService.js';
import { getDashboard, getPublicSettings } from './modules/dashboard/dashboardService.js';
import { importOrderXlsx, listImportAttempts, recordImportFailure } from './modules/orders/importService.js';
import { createOrderReport } from './modules/reports/reportService.js';
import {
  closeOrder,
  getOrderEventsPage,
  listOrderHistory,
  listProblems,
  resolveProblem,
  reviewItem,
} from './modules/workflow/reviewService.js';
import {
  assignOrder,
  changeItemStatus,
  createWorker,
  getOrderDetails,
  getOrderEvents,
  listOrdersWithProgress,
  listWorkers,
  undoItemStatus,
  updateWorker,
  WorkflowError,
} from './modules/workflow/workflowService.js';

const shiftStatusSchema = z.enum(['OFF_SHIFT', 'AVAILABLE', 'BUSY']);
const createWorkerSchema = z.object({
  login: z.string().trim().min(3).max(40),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(2).max(100),
  isActive: z.boolean().optional(),
  shiftStatus: shiftStatusSchema.optional(),
});
const updateWorkerSchema = createWorkerSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'Не переданы изменения',
});
const assignmentSchema = z.object({ workerIds: z.array(z.string().min(1)).min(1) });
const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'PICKED', 'NOT_FOUND', 'SKIPPED']),
  workerId: z.string().optional(),
  deviceAt: z.string().datetime().optional(),
});
const undoSchema = z.object({
  workerId: z.string().optional(),
  deviceAt: z.string().datetime().optional(),
});
const reviewSchema = z.object({
  pickType: z.enum(['PACKAGE', 'PIECE']),
  pickQuantity: z.coerce.number().positive(),
  comment: z.string().trim().min(3).max(500),
  reviewedBy: z.string().trim().min(2).max(100).default('Администратор'),
});
const resolveProblemSchema = z.object({
  action: z.enum(['CONFIRM', 'RETURN_TO_WORK']),
  comment: z.string().trim().min(3).max(500),
  reviewedBy: z.string().trim().min(2).max(100).default('Администратор'),
  workerId: z.string().optional(),
});
const closeOrderSchema = z.object({
  reviewedBy: z.string().trim().min(2).max(100).default('Администратор'),
  comment: z.string().trim().max(500).optional(),
});
const problemQuerySchema = z.object({
  orderId: z.string().optional(),
  type: z.enum(['REVIEW', 'NOT_FOUND', 'SKIPPED']).optional(),
  resolution: z.enum(['UNRESOLVED', 'CONFIRMED', 'RESOLVED', 'ALL']).optional(),
});
const historyQuerySchema = z.object({
  query: z.string().trim().optional(),
  status: z.enum(['COMPLETED', 'CLOSED', 'REVIEW_REQUIRED']).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
const eventTypeSchema = z.enum([
  'ORDER_ASSIGNED',
  'ORDER_STARTED',
  'ORDER_COMPLETED',
  'ITEM_ASSIGNED',
  'ITEM_REASSIGNED',
  'ITEM_ACTIVE',
  'ITEM_PICKED',
  'ITEM_NOT_FOUND',
  'ITEM_SKIPPED',
  'ITEM_UNDONE',
  'ITEM_REVIEWED',
  'PROBLEM_CONFIRMED',
  'PROBLEM_RETURNED',
  'ORDER_CLOSED',
]);
const eventQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  type: eventTypeSchema.optional(),
  workerId: z.string().optional(),
  itemId: z.string().optional(),
  paginated: z.enum(['true', 'false']).optional(),
});
const importQuerySchema = z.object({
  status: z.enum(['SUCCESS', 'DUPLICATE', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const analyticsQuerySchema = z.object({
  days: z.coerce
    .number()
    .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
    .default(30),
});

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cors, { origin: process.env.ADMIN_ORIGIN ?? true });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: `Ошибка валидации: ${details}` });
    }
    if (error instanceof WorkflowError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.code(409).send({ error: 'Запись с такими уникальными данными уже существует' });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  app.get('/health', async (_request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { ok: true, service: 'assembly-orders-2026', database: 'connected' };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ ok: false, service: 'assembly-orders-2026', database: 'unavailable' });
    }
  });

  app.post('/api/orders/import-xlsx', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Файл не передан' });
    if (!file.filename.toLowerCase().endsWith('.xlsx')) {
      await recordImportFailure(file.filename, 'Нужен файл .xlsx');
      return reply.code(400).send({ error: 'Нужен файл .xlsx' });
    }

    const result = await importOrderXlsx(file.filename, await file.toBuffer());
    return reply.code(result.duplicate ? 200 : 201).send(result);
  });

  app.get('/api/dashboard', getDashboard);
  app.get<{ Querystring: unknown }>('/api/analytics', async (request) => {
    const query = analyticsQuerySchema.parse(request.query);
    return getAnalytics(query.days);
  });
  app.get('/api/settings', getPublicSettings);
  app.get<{ Querystring: unknown }>('/api/imports', async (request) =>
    listImportAttempts(importQuerySchema.parse(request.query)),
  );
  app.get('/api/orders', listOrdersWithProgress);
  app.get<{ Querystring: unknown }>('/api/orders/history', async (request) => {
    const query = historyQuerySchema.parse(request.query);
    return listOrderHistory({
      query: query.query,
      status: query.status,
      from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined,
      to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
    });
  });
  app.get<{ Querystring: unknown }>('/api/problems', async (request) =>
    listProblems(problemQuerySchema.parse(request.query)),
  );
  app.get<{ Params: { id: string } }>('/api/orders/:id', async (request) =>
    getOrderDetails(request.params.id),
  );
  app.get<{ Params: { id: string }; Querystring: unknown }>('/api/orders/:id/events', async (request) => {
    const query = eventQuerySchema.parse(request.query);
    if (query.paginated !== 'true' && Object.keys(request.query as object).length === 0) {
      return getOrderEvents(request.params.id);
    }
    return getOrderEventsPage(request.params.id, query);
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/api/orders/:id/assign', async (request) => {
    const body = assignmentSchema.parse(request.body);
    return assignOrder(request.params.id, body.workerIds);
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/api/orders/:id/reassign', async (request) => {
    const body = assignmentSchema.parse(request.body);
    return assignOrder(request.params.id, body.workerIds, true);
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/api/orders/:id/close', async (request) => {
    const body = closeOrderSchema.parse(request.body ?? {});
    return closeOrder(request.params.id, body.reviewedBy, body.comment);
  });
  app.get<{ Params: { id: string } }>('/api/orders/:id/reports/short.pdf', async (request, reply) => {
    const url = `${process.env.ADMIN_PUBLIC_URL ?? 'http://localhost:5173'}?order=${encodeURIComponent(request.params.id)}`;
    const report = await createOrderReport(request.params.id, 'short', url);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="assembly-${request.params.id}-short.pdf"`)
      .send(report);
  });
  app.get<{ Params: { id: string } }>('/api/orders/:id/reports/full.pdf', async (request, reply) => {
    const url = `${process.env.ADMIN_PUBLIC_URL ?? 'http://localhost:5173'}?order=${encodeURIComponent(request.params.id)}`;
    const report = await createOrderReport(request.params.id, 'full', url);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="assembly-${request.params.id}-full.pdf"`)
      .send(report);
  });

  app.get('/api/workers', listWorkers);
  app.post<{ Body: unknown }>('/api/workers', async (request, reply) => {
    const worker = await createWorker(createWorkerSchema.parse(request.body));
    return reply.code(201).send(worker);
  });
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/workers/:id', async (request) =>
    updateWorker(request.params.id, updateWorkerSchema.parse(request.body)),
  );

  app.patch<{ Params: { id: string }; Body: unknown }>('/api/order-items/:id/status', async (request) => {
    const body = statusSchema.parse(request.body);
    return changeItemStatus(
      request.params.id,
      body.status,
      body.workerId,
      body.deviceAt ? new Date(body.deviceAt) : undefined,
    );
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/api/order-items/:id/undo', async (request) => {
    const body = undoSchema.parse(request.body ?? {});
    return undoItemStatus(
      request.params.id,
      body.workerId,
      body.deviceAt ? new Date(body.deviceAt) : undefined,
    );
  });
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/order-items/:id/review', async (request) =>
    reviewItem(request.params.id, reviewSchema.parse(request.body)),
  );
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/order-items/:id/resolve-problem',
    async (request) => resolveProblem(request.params.id, resolveProblemSchema.parse(request.body)),
  );

  return app;
}

async function start() {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ port, host: '0.0.0.0' });
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entrypoint) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
