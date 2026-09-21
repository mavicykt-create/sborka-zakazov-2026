import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../db.js';
import { normalizeGroupKey } from '../orders/xlsxParser.js';
import { getOrderDetails, WorkflowError } from '../workflow/workflowService.js';

const quantitySchema = z.coerce.number().finite().positive().max(999_999_999);
const optionalQuantitySchema = z.coerce.number().finite().nonnegative().max(999_999_999).optional();

export const oneCExpenseInvoiceSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(100),
    revision: z.string().trim().min(1).max(100).optional(),
    posted: z.boolean().default(true),
    documentNumber: z.string().trim().min(1).max(100),
    documentDate: z.string().date(),
    warehouse: z.string().trim().min(1).max(300),
    customer: z.string().trim().max(300).optional(),
    items: z
      .array(
        z
          .object({
            lineNumber: z.coerce.number().int().positive().max(100_000),
            productId: z.string().trim().max(100).optional(),
            sku: z.string().trim().max(100).optional(),
            barcode: z.string().trim().max(100).optional(),
            name: z.string().trim().min(1).max(500),
            quantity: quantitySchema,
            unit: z.string().trim().max(100).optional(),
            pickType: z.enum(['PACKAGE', 'PIECE']).optional(),
            packageQuantity: optionalQuantitySchema,
            pieceQuantity: optionalQuantitySchema,
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.posted && value.items.length === 0) {
      context.addIssue({ code: 'custom', path: ['items'], message: 'В проведённой накладной нет товаров' });
    }
    const duplicateLines = value.items
      .map((item) => item.lineNumber)
      .filter((line, index, lines) => lines.indexOf(line) !== index);
    if (duplicateLines.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: `Повторяются номера строк: ${[...new Set(duplicateLines)].join(', ')}`,
      });
    }
  });

export type OneCExpenseInvoice = z.infer<typeof oneCExpenseInvoiceSchema>;

export class OneCAuthError extends Error {
  readonly statusCode = 401;
}

export function authenticateOneC(authorization: string | undefined, expectedToken: string | undefined): void {
  const configured = expectedToken?.trim();
  if (!configured) throw new WorkflowError('Обмен с 1С ещё не настроен на сервере', 503);

  const prefix = 'Bearer ';
  const received = authorization?.startsWith(prefix) ? authorization.slice(prefix.length).trim() : '';
  const expectedBytes = Buffer.from(configured);
  const receivedBytes = Buffer.from(received);
  if (
    receivedBytes.length !== expectedBytes.length ||
    !crypto.timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    throw new OneCAuthError('Неверный ключ обмена с 1С');
  }
}

function sourceHash(input: OneCExpenseInvoice): string {
  const canonical = {
    ...input,
    items: [...input.items].sort((a, b) => a.lineNumber - b.lineNumber),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function itemData(input: OneCExpenseInvoice) {
  return [...input.items]
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((item, index) => {
      const packageQuantity = item.packageQuantity ?? (item.pickType === 'PACKAGE' ? item.quantity : null);
      const pieceQuantity = item.pieceQuantity ?? (item.pickType !== 'PACKAGE' ? item.quantity : null);
      const pickType = packageQuantity && packageQuantity > 0 ? 'PACKAGE' : 'PIECE';
      const pickQuantity =
        pickType === 'PACKAGE' ? (packageQuantity ?? item.quantity) : (pieceQuantity ?? item.quantity);
      return {
        sourceLine: item.lineNumber,
        barcode: item.barcode || item.sku || null,
        name: item.name,
        groupKey: normalizeGroupKey(item.name),
        packageQuantity,
        pieceQuantity,
        pickType: pickType as 'PACKAGE' | 'PIECE',
        pickQuantity,
        sortIndex: index + 1,
      };
    })
    .sort(
      (a, b) =>
        a.groupKey.localeCompare(b.groupKey, 'ru') ||
        a.name.localeCompare(b.name, 'ru') ||
        a.sourceLine - b.sourceLine,
    )
    .map((item, index) => ({ ...item, sortIndex: index + 1 }));
}

function importFilename(input: OneCExpenseInvoice): string {
  return `1С УНФ — Расходная накладная ${input.documentNumber}`;
}

export async function importExpenseInvoiceFromOneC(input: OneCExpenseInvoice) {
  const documentDate = new Date(`${input.documentDate}T00:00:00.000Z`);
  const hash = sourceHash(input);

  const result = await db.$transaction(
    async (tx) => {
      const existing = await tx.order.findFirst({
        where: {
          OR: [
            { sourceSystem: '1C_UNF', sourceId: input.sourceId },
            { documentNumber: input.documentNumber, documentDate, warehouse: input.warehouse },
          ],
        },
        include: { items: true },
      });

      if (existing?.sourceHash === hash) {
        await tx.importAttempt.create({
          data: {
            filename: importFilename(input),
            sourceHash: hash,
            status: 'DUPLICATE',
            orderId: existing.id,
            documentNumber: input.documentNumber,
            documentDate,
            warehouse: input.warehouse,
            itemCount: input.items.length,
          },
        });
        return {
          orderId: existing.id,
          duplicate: true,
          updated: false,
          cancelled: existing.status === 'CANCELLED',
        };
      }

      if (existing) {
        const canSynchronize =
          ['NEW', 'READY', 'REVIEW_REQUIRED', 'CANCELLED'].includes(existing.status) &&
          existing.items.every((item) => item.status === 'PENDING' && !item.assignedWorkerId);
        if (!canSynchronize) {
          throw new WorkflowError(
            'Накладная уже передана в сборку. Изменение из 1С остановлено и требует проверки администратора',
            409,
          );
        }

        const status = input.posted ? 'NEW' : 'CANCELLED';
        await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
        await tx.order.update({
          where: { id: existing.id },
          data: {
            documentNumber: input.documentNumber,
            documentDate,
            warehouse: input.warehouse,
            sourceHash: hash,
            sourceSystem: '1C_UNF',
            sourceId: input.sourceId,
            sourceRevision: input.revision,
            sourceCustomer: input.customer,
            sourcePosted: input.posted,
            status,
            startedAt: null,
            completedAt: null,
            closedAt: null,
            items: input.posted ? { create: itemData(input) } : undefined,
            events: {
              create: {
                type: input.posted ? 'SOURCE_UPDATED' : 'SOURCE_CANCELLED',
                metadata: { sourceSystem: '1C_UNF', revision: input.revision },
              },
            },
          },
        });
        await tx.importAttempt.create({
          data: {
            filename: importFilename(input),
            sourceHash: hash,
            status: 'SUCCESS',
            orderId: existing.id,
            documentNumber: input.documentNumber,
            documentDate,
            warehouse: input.warehouse,
            itemCount: input.items.length,
            warnings: input.posted ? undefined : ['Проведение накладной отменено в 1С'],
          },
        });
        return { orderId: existing.id, duplicate: false, updated: true, cancelled: !input.posted };
      }

      if (!input.posted) {
        return { orderId: null, duplicate: false, updated: false, cancelled: true };
      }

      const created = await tx.order.create({
        data: {
          documentNumber: input.documentNumber,
          documentDate,
          warehouse: input.warehouse,
          sourceHash: hash,
          sourceSystem: '1C_UNF',
          sourceId: input.sourceId,
          sourceRevision: input.revision,
          sourceCustomer: input.customer,
          sourcePosted: true,
          status: 'NEW',
          items: { create: itemData(input) },
        },
      });
      await tx.importAttempt.create({
        data: {
          filename: importFilename(input),
          sourceHash: hash,
          status: 'SUCCESS',
          orderId: created.id,
          documentNumber: input.documentNumber,
          documentDate,
          warehouse: input.warehouse,
          itemCount: input.items.length,
        },
      });
      return { orderId: created.id, duplicate: false, updated: false, cancelled: false };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  return {
    duplicate: result.duplicate,
    updated: result.updated,
    cancelled: result.cancelled,
    order: result.orderId ? await getOrderDetails(result.orderId) : null,
  };
}
