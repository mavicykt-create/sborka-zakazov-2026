import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import { ZodError, z } from 'zod';
import { validateProductionEnvironment } from './config.js';
import { db } from './db.js';
import { getAnalytics } from './modules/analytics/analyticsService.js';
import { getDashboard, getPublicSettings } from './modules/dashboard/dashboardService.js';
import { importOrderXlsx, listImportAttempts, recordImportFailure } from './modules/orders/importService.js';
import {
  assertPickerCanWork,
  authenticatePicker,
  getPickerQueue,
  loginPicker,
  logoutPicker,
} from './modules/picker/pickerService.js';
import { createOrderReport } from './modules/reports/reportService.js';
import {
  SpeechProviderError,
  SpeechTextValidationError,
  YandexSpeechKitService,
} from './modules/speech/yandexSpeechKitService.js';
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
const pickerLoginSchema = z.object({
  login: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
});
const pickerStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'PICKED', 'NOT_FOUND', 'SKIPPED']),
  deviceAt: z.string().datetime().optional(),
});
const pickerUndoSchema = z.object({ deviceAt: z.string().datetime().optional() });
const pickerSpeechSchema = z.object({ text: z.string() }).strict();

type BuildAppOptions = {
  speechKitService?: YandexSpeechKitService;
  authenticatePicker?: typeof authenticatePicker;
  frontendRoot?: string | false;
};

export const DEFAULT_FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../admin/dist');

function isBackendPath(url: string): boolean {
  const pathname = url.split('?')[0];
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/health' ||
    pathname.startsWith('/health/')
  );
}

export async function buildApp(options: BuildAppOptions = {}) {
  const speechKitService = options.speechKitService ?? new YandexSpeechKitService();
  const authenticatePickerRequest = options.authenticatePicker ?? authenticatePicker;
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cors, { origin: process.env.ADMIN_ORIGIN ?? true });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: `Ошибка валидации: ${details}` });
    }
    if (error instanceof WorkflowError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof SpeechTextValidationError || error instanceof SpeechProviderError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.code(409).send({ error: 'Запись с такими уникальными данными уже существует' });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  app.get('/health', async () => ({ ok: true, service: 'assembly-orders-2026' }));

  app.get('/health/ready', async (_request, reply) => {
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

  app.post<{ Body: unknown }>('/api/picker/login', async (request) => {
    const body = pickerLoginSchema.parse(request.body);
    return loginPicker(body.login, body.password);
  });
  app.post('/api/picker/logout', async (request) => logoutPicker(request.headers.authorization));
  app.get('/api/picker/me', async (request) => {
    const session = await authenticatePicker(request.headers.authorization);
    return { worker: session.worker, expiresAt: session.expiresAt };
  });
  app.get('/api/picker/queue', async (request) => {
    const session = await authenticatePicker(request.headers.authorization);
    return getPickerQueue(session.worker.id);
  });
  app.get('/api/picker/speech/settings', async (request) => {
    await authenticatePickerRequest(request.headers.authorization);
    return speechKitService.getPublicSettings();
  });
  app.post<{ Body: unknown }>('/api/picker/speech', async (request, reply) => {
    await authenticatePickerRequest(request.headers.authorization);
    const body = pickerSpeechSchema.parse(request.body);
    const result = await speechKitService.synthesize(body.text);
    return reply
      .header('Content-Type', result.contentType)
      .header('Cache-Control', 'private, max-age=300')
      .header('X-Speech-Cache', result.cacheHit ? 'HIT' : 'MISS')
      .send(result.audio);
  });
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/picker/items/:id/status', async (request) => {
    const session = await authenticatePicker(request.headers.authorization);
    assertPickerCanWork(session.worker);
    const body = pickerStatusSchema.parse(request.body);
    return changeItemStatus(
      request.params.id,
      body.status,
      session.worker.id,
      body.deviceAt ? new Date(body.deviceAt) : undefined,
    );
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/api/picker/items/:id/undo', async (request) => {
    const session = await authenticatePicker(request.headers.authorization);
    assertPickerCanWork(session.worker);
    const body = pickerUndoSchema.parse(request.body ?? {});
    return undoItemStatus(
      request.params.id,
      session.worker.id,
      body.deviceAt ? new Date(body.deviceAt) : undefined,
    );
  });

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

  const frontendRoot = options.frontendRoot === undefined ? DEFAULT_FRONTEND_ROOT : options.frontendRoot;
  if (frontendRoot && existsSync(join(frontendRoot, 'index.html'))) {
    await app.register(fastifyStatic, { root: frontendRoot, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (isBackendPath(request.url) || (request.method !== 'GET' && request.method !== 'HEAD')) {
        return reply.code(404).send({ error: 'Маршрут не найден' });
      }
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    });
  }

  return app;
}

async function start() {
  validateProductionEnvironment();
  if (process.env.NODE_ENV === 'production' && !existsSync(join(DEFAULT_FRONTEND_ROOT, 'index.html'))) {
    throw new Error(`Production frontend build is missing: ${DEFAULT_FRONTEND_ROOT}`);
  }
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
