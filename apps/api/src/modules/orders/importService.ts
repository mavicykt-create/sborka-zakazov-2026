import crypto from 'node:crypto';
import { type ImportStatus, Prisma } from '@prisma/client';
import { db } from '../../db.js';
import { getOrderDetails, WorkflowError } from '../workflow/workflowService.js';
import type { ParsedOrder } from './types.js';
import { parseOrderXlsx } from './xlsxParser.js';

export interface ImportOrderResult {
  duplicate: boolean;
  warnings?: string[];
  order: Awaited<ReturnType<typeof getOrderDetails>>;
}

export async function importOrderXlsx(filename: string, buffer: Buffer): Promise<ImportOrderResult> {
  const sourceHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const existingByHash = await db.order.findUnique({ where: { sourceHash } });
  if (existingByHash) return recordDuplicate(filename, sourceHash, existingByHash.id);

  let parsed: ParsedOrder;
  try {
    parsed = await parseOrderXlsx(buffer);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'неизвестная ошибка';
    await recordImportFailure(filename, reason, sourceHash);
    throw new WorkflowError(`Ошибка импорта XLSX: ${reason}`, 400);
  }

  const documentDate = new Date(`${parsed.documentDate}T00:00:00.000Z`);
  const existing = await db.order.findFirst({
    where: { documentNumber: parsed.documentNumber, documentDate, warehouse: parsed.warehouse },
  });
  if (existing) return recordDuplicate(filename, sourceHash, existing.id, parsed);

  try {
    const order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
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
      await tx.importAttempt.create({
        data: {
          filename,
          sourceHash,
          status: 'SUCCESS',
          orderId: created.id,
          documentNumber: parsed.documentNumber,
          documentDate,
          warehouse: parsed.warehouse,
          itemCount: parsed.items.length,
          warnings: parsed.warnings,
        },
      });
      return created;
    });

    return { duplicate: false, warnings: parsed.warnings, order: await getOrderDetails(order.id) };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const concurrent = await db.order.findFirst({
      where: {
        OR: [
          { sourceHash },
          { documentNumber: parsed.documentNumber, documentDate, warehouse: parsed.warehouse },
        ],
      },
    });
    if (!concurrent) throw error;
    return recordDuplicate(filename, sourceHash, concurrent.id, parsed);
  }
}

export async function recordImportFailure(filename: string, errorMessage: string, sourceHash?: string) {
  return db.importAttempt.create({
    data: { filename, sourceHash, status: 'FAILED', errorMessage },
  });
}

async function recordDuplicate(
  filename: string,
  sourceHash: string,
  orderId: string,
  parsed?: ParsedOrder,
): Promise<ImportOrderResult> {
  const order = await getOrderDetails(orderId);
  await db.importAttempt.create({
    data: {
      filename,
      sourceHash,
      status: 'DUPLICATE',
      orderId,
      documentNumber: parsed?.documentNumber ?? order.documentNumber,
      documentDate: parsed ? new Date(`${parsed.documentDate}T00:00:00.000Z`) : order.documentDate,
      warehouse: parsed?.warehouse ?? order.warehouse,
      itemCount: parsed?.items.length ?? order.items.length,
      warnings: parsed?.warnings,
    },
  });
  return { duplicate: true, order };
}

export async function listImportAttempts(filters: { status?: ImportStatus; limit: number }) {
  return db.importAttempt.findMany({
    where: { status: filters.status },
    take: filters.limit,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      filename: true,
      status: true,
      orderId: true,
      documentNumber: true,
      documentDate: true,
      warehouse: true,
      itemCount: true,
      warnings: true,
      errorMessage: true,
      createdAt: true,
    },
  });
}
