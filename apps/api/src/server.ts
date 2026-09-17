import crypto from 'node:crypto';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { db } from './db.js';
import type { ParsedOrder } from './modules/orders/types.js';
import { parseOrderXlsx } from './modules/orders/xlsxParser.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: process.env.ADMIN_ORIGIN ?? true });
await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

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
  if (!file.filename.toLowerCase().endsWith('.xlsx'))
    return reply.code(400).send({ error: 'Нужен файл .xlsx' });

  const buffer = await file.toBuffer();
  const sourceHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const existingByHash = await db.order.findUnique({ where: { sourceHash }, include: { items: true } });
  if (existingByHash) return reply.code(200).send({ duplicate: true, order: existingByHash });

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
    include: { items: { orderBy: { sortIndex: 'asc' } } },
  });
  if (existing) return reply.code(200).send({ duplicate: true, order: existing });

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
    include: { items: { orderBy: { sortIndex: 'asc' } } },
  });

  return reply.code(201).send({ duplicate: false, warnings: parsed.warnings, order });
});

app.get('/api/orders', async () =>
  db.order.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { items: true } } },
  }),
);

app.get<{ Params: { id: string } }>('/api/orders/:id', async (request, reply) => {
  const order = await db.order.findUnique({
    where: { id: request.params.id },
    include: { items: { orderBy: { sortIndex: 'asc' } } },
  });
  if (!order) return reply.code(404).send({ error: 'Заказ не найден' });
  return order;
});

const port = Number(process.env.PORT ?? 8080);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
