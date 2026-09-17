import crypto from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import { ZodError, z } from 'zod';
import { db } from './db.js';
import type { ParsedOrder } from './modules/orders/types.js';
import { parseOrderXlsx } from './modules/orders/xlsxParser.js';
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
      return reply.code(400).send({ error: 'Нужен файл .xlsx' });
    }

    const buffer = await file.toBuffer();
    const sourceHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const existingByHash = await db.order.findUnique({ where: { sourceHash } });
    if (existingByHash) {
      return reply.code(200).send({ duplicate: true, order: await getOrderDetails(existingByHash.id) });
    }

    let parsed: ParsedOrder;
    try {
      parsed = await parseOrderXlsx(buffer);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'неизвестная ошибка';
      return reply.code(400).send({ error: `Ошибка импорта XLSX: ${reason}` });
    }
    const documentDate = new Date(`${parsed.documentDate}T00:00:00.000Z`);

    const existing = await db.order.findFirst({
      where: { documentNumber: parsed.documentNumber, documentDate, warehouse: parsed.warehouse },
    });
    if (existing) return reply.code(200).send({ duplicate: true, order: await getOrderDetails(existing.id) });

    const order = await db.order.create({
      data: {
        documentNumber: parsed.documentNumber,
        documentDate,
        warehouse: parsed.warehouse,
        sourceHash,
        status: parsed.warnings.length ? 'REVIEW_REQUIRED' : 'NEW',
        items: {
          create: parsed.items.map((item) => ({
            sourceLine: item.sourceLine,
            barcode: item.barcode,
            name: item.name,
            groupKey: item.groupKey,
            packageQuantity: item.packageQuantity,
            pieceQuantity: item.pieceQuantity,
            pickType: item.pickType,
            pickQuantity: item.pickQuantity,
            sortIndex: item.sortIndex,
          })),
        },
      },
    });

    return reply.code(201).send({
      duplicate: false,
      warnings: parsed.warnings,
      order: await getOrderDetails(order.id),
    });
  });

  app.get('/api/orders', listOrdersWithProgress);
  app.get<{ Params: { id: string } }>('/api/orders/:id', async (request) =>
    getOrderDetails(request.params.id),
  );
  app.get<{ Params: { id: string } }>('/api/orders/:id/events', async (request) =>
    getOrderEvents(request.params.id),
  );
  app.post<{ Params: { id: string }; Body: unknown }>('/api/orders/:id/assign', async (request) => {
    const body = assignmentSchema.parse(request.body);
    return assignOrder(request.params.id, body.workerIds);
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/api/orders/:id/reassign', async (request) => {
    const body = assignmentSchema.parse(request.body);
    return assignOrder(request.params.id, body.workerIds, true);
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
