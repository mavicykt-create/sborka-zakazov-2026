import crypto from 'node:crypto';
import { type EmailOrderImport as EmailOrderImportRecord, Prisma } from '@prisma/client';
import { db } from '../../db.js';
import { parseOrderXlsx } from '../orders/xlsxParser.js';
import { getOrderDetails, WorkflowError } from '../workflow/workflowService.js';

export type EmailAttachmentInput = {
  sourceKey: string;
  provider: 'GMAIL' | 'MANUAL';
  messageId: string;
  sender: string;
  subject: string;
  receivedAt: Date;
  attachmentId?: string;
  attachmentName: string;
  buffer: Buffer;
  orderNumber?: string | null;
  orderTotal?: number | null;
};

function decimalNumber(value: Prisma.Decimal | number | null | undefined) {
  return value == null ? null : Number(value);
}

function sameNumber(left: Prisma.Decimal | number | null, right: number | null) {
  const a = decimalNumber(left);
  return a == null && right == null ? true : a != null && right != null && Math.abs(a - right) < 0.0005;
}

async function markDuplicate(emailImport: EmailOrderImportRecord, orderId: string | null) {
  const updated = await db.emailOrderImport.update({
    where: { id: emailImport.id },
    data: { status: 'DUPLICATE', orderId },
  });
  return {
    alreadyProcessed: false,
    duplicate: true,
    updated: false,
    emailImport: updated,
    order: orderId ? await getOrderDetails(orderId) : null,
  };
}

export async function importEmailAttachment(input: EmailAttachmentInput) {
  const existing = await db.emailOrderImport.findUnique({ where: { sourceKey: input.sourceKey } });
  if (existing) {
    return {
      alreadyProcessed: true,
      emailImport: existing,
      order: existing.orderId ? await getOrderDetails(existing.orderId) : null,
      duplicate: existing.status === 'DUPLICATE',
      updated: existing.status === 'UPDATED',
    };
  }

  const attachmentHash = crypto.createHash('sha256').update(input.buffer).digest('hex');
  let emailImport: EmailOrderImportRecord;
  try {
    emailImport = await db.emailOrderImport.create({
      data: {
        sourceKey: input.sourceKey,
        provider: input.provider,
        messageId: input.messageId,
        sender: input.sender,
        subject: input.subject,
        receivedAt: input.receivedAt,
        attachmentId: input.attachmentId,
        attachmentName: input.attachmentName,
        attachmentHash,
        orderTotal: input.orderTotal,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const concurrent = await db.emailOrderImport.findUnique({ where: { sourceKey: input.sourceKey } });
    if (!concurrent) throw error;
    return {
      alreadyProcessed: true,
      emailImport: concurrent,
      order: concurrent.orderId ? await getOrderDetails(concurrent.orderId) : null,
      duplicate: concurrent.status === 'DUPLICATE',
      updated: concurrent.status === 'UPDATED',
    };
  }

  if (!input.attachmentName.toLowerCase().endsWith('.xlsx')) {
    const failed = await db.emailOrderImport.update({
      where: { id: emailImport.id },
      data: { status: 'FAILED', errorMessage: 'В письме нужен файл .xlsx' },
    });
    throw new WorkflowError(`Файл ${failed.attachmentName}: нужен формат .xlsx`, 400);
  }

  try {
    const priorAttachment = await db.emailOrderImport.findFirst({
      where: {
        id: { not: emailImport.id },
        attachmentHash,
        status: { in: ['IMPORTED', 'UPDATED', 'DUPLICATE'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (priorAttachment) return markDuplicate(emailImport, priorAttachment.orderId);

    const parsed = await parseOrderXlsx(input.buffer);
    if (input.orderNumber && input.orderNumber !== parsed.documentNumber) {
      throw new WorkflowError(
        `В теме письма заказ №${input.orderNumber}, а во вложении №${parsed.documentNumber}`,
        400,
      );
    }

    const documentDate = new Date(`${parsed.documentDate}T00:00:00.000Z`);
    const orderTotal = input.orderTotal ?? parsed.orderTotal;
    const result = await db.$transaction(
      async (tx) => {
        let order = await tx.order.findFirst({
          where: {
            OR: [
              { sourceSystem: 'GMAIL', sourceId: parsed.documentNumber },
              { documentNumber: parsed.documentNumber, documentDate, warehouse: parsed.warehouse },
              { sourceHash: attachmentHash },
            ],
          },
          include: { items: true },
        });

        if (!order) {
          const previousOrders = await tx.order.findMany({
            where: {
              sourceSystem: 'GMAIL',
              documentNumber: { not: parsed.documentNumber },
              status: { notIn: ['CLOSED', 'CANCELLED'] },
            },
            include: { items: { select: { assignedWorkerId: true } } },
          });
          const previousWorkerIds = new Set<string>();
          for (const previous of previousOrders) {
            for (const item of previous.items) {
              if (item.assignedWorkerId) previousWorkerIds.add(item.assignedWorkerId);
            }
            await tx.orderItem.updateMany({
              where: { orderId: previous.id, status: { in: ['PENDING', 'ASSIGNED', 'ACTIVE'] } },
              data: { status: 'SKIPPED', pickedAt: input.receivedAt },
            });
            await tx.order.update({
              where: { id: previous.id },
              data: {
                status: 'CLOSED',
                completedAt: previous.completedAt ?? input.receivedAt,
                closedAt: input.receivedAt,
              },
            });
            await tx.orderEvent.create({
              data: {
                orderId: previous.id,
                type: 'ORDER_CLOSED',
                metadata: { reason: 'NEW_EMAIL_ORDER', nextDocumentNumber: parsed.documentNumber },
              },
            });
          }
          for (const workerId of previousWorkerIds) {
            const unfinished = await tx.orderItem.count({
              where: { assignedWorkerId: workerId, status: { in: ['ASSIGNED', 'ACTIVE'] } },
            });
            if (!unfinished) {
              await tx.worker.updateMany({
                where: { id: workerId, isActive: true, shiftStatus: 'BUSY' },
                data: { shiftStatus: 'AVAILABLE' },
              });
            }
          }

          order = await tx.order.create({
            data: {
              documentNumber: parsed.documentNumber,
              documentDate,
              warehouse: parsed.warehouse,
              sourceHash: attachmentHash,
              sourceSystem: input.provider === 'GMAIL' ? 'GMAIL' : 'EMAIL_MANUAL',
              sourceId: parsed.documentNumber,
              sourceRevision: input.receivedAt.toISOString(),
              orderTotal,
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
            include: { items: true },
          });
          return { orderId: order.id, updated: false };
        }

        const previousTotal = decimalNumber(order.orderTotal);
        const incomingByLine = new Map(parsed.items.map((item) => [item.sourceLine, item]));
        const changedLines: number[] = [];
        for (const current of order.items) {
          const incoming = incomingByLine.get(current.sourceLine);
          if (!incoming) {
            changedLines.push(current.sourceLine);
            await tx.orderItem.delete({ where: { id: current.id } });
            continue;
          }
          incomingByLine.delete(current.sourceLine);
          const changed =
            current.barcode !== incoming.barcode ||
            current.name !== incoming.name ||
            !sameNumber(current.packageQuantity, incoming.packageQuantity) ||
            !sameNumber(current.pieceQuantity, incoming.pieceQuantity) ||
            current.pickType !== incoming.pickType ||
            !sameNumber(current.pickQuantity, incoming.pickQuantity);
          if (changed) changedLines.push(current.sourceLine);
          await tx.orderItem.update({
            where: { id: current.id },
            data: {
              barcode: incoming.barcode,
              name: incoming.name,
              groupKey: incoming.groupKey,
              packageQuantity: incoming.packageQuantity,
              pieceQuantity: incoming.pieceQuantity,
              pickType: incoming.pickType,
              pickQuantity: incoming.pickQuantity,
              sortIndex: incoming.sortIndex,
              ...(changed
                ? {
                    status: current.assignedWorkerId ? ('ASSIGNED' as const) : ('PENDING' as const),
                    pickedAt: null,
                    problemResolution: null,
                    reviewComment: null,
                    reviewedBy: null,
                    reviewedAt: null,
                  }
                : {}),
            },
          });
        }
        for (const item of incomingByLine.values()) {
          changedLines.push(item.sourceLine);
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              sourceLine: item.sourceLine,
              barcode: item.barcode,
              name: item.name,
              groupKey: item.groupKey,
              packageQuantity: item.packageQuantity,
              pieceQuantity: item.pieceQuantity,
              pickType: item.pickType,
              pickQuantity: item.pickQuantity,
              sortIndex: item.sortIndex,
            },
          });
        }

        const totalChanged = !sameNumber(order.orderTotal, orderTotal);
        const wasUpdated = changedLines.length > 0 || totalChanged || order.sourceHash !== attachmentHash;
        const hasAssignments = await tx.orderItem.count({
          where: { orderId: order.id, assignedWorkerId: { not: null } },
        });
        await tx.order.update({
          where: { id: order.id },
          data: {
            documentDate,
            warehouse: parsed.warehouse,
            sourceHash: attachmentHash,
            sourceSystem: input.provider === 'GMAIL' ? 'GMAIL' : order.sourceSystem || 'EMAIL_MANUAL',
            sourceId: parsed.documentNumber,
            sourceRevision: input.receivedAt.toISOString(),
            orderTotal,
            ...(wasUpdated
              ? {
                  status: hasAssignments
                    ? order.startedAt
                      ? ('PICKING' as const)
                      : ('ASSIGNED' as const)
                    : ('NEW' as const),
                  completedAt: null,
                  closedAt: null,
                }
              : {}),
          },
        });
        if (wasUpdated) {
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              type: 'SOURCE_UPDATED',
              metadata: {
                previousTotal,
                newTotal: orderTotal,
                previousLineCount: order.items.length,
                newLineCount: parsed.items.length,
                changedLines,
              },
            },
          });
        }
        return { orderId: order.id, updated: wasUpdated };
      },
      { isolationLevel: 'Serializable' },
    );

    const updatedImport = await db.emailOrderImport.update({
      where: { id: emailImport.id },
      data: {
        status: result.updated ? 'UPDATED' : 'IMPORTED',
        orderId: result.orderId,
        orderTotal,
        errorMessage: null,
      },
    });
    return {
      duplicate: false,
      updated: result.updated,
      alreadyProcessed: false,
      warnings: parsed.warnings,
      emailImport: updatedImport,
      order: await getOrderDetails(result.orderId),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось импортировать вложение';
    await db.emailOrderImport.update({
      where: { id: emailImport.id },
      data: { status: 'FAILED', errorMessage: message },
    });
    throw error;
  }
}

export async function importManualEmailAttachment(input: {
  sender?: string;
  subject?: string;
  receivedAt?: Date;
  filename: string;
  buffer: Buffer;
}) {
  const id = crypto.randomUUID();
  return importEmailAttachment({
    sourceKey: `manual:${id}`,
    provider: 'MANUAL',
    messageId: `manual-${id}`,
    sender: input.sender?.trim() || 'Ручная проверка',
    subject: input.subject?.trim() || 'Заказ из email',
    receivedAt: input.receivedAt ?? new Date(),
    attachmentName: input.filename,
    buffer: input.buffer,
  });
}

export async function listEmailOrderImports(limit = 50) {
  return db.emailOrderImport.findMany({
    take: limit,
    orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      provider: true,
      messageId: true,
      sender: true,
      subject: true,
      receivedAt: true,
      attachmentName: true,
      status: true,
      orderId: true,
      orderTotal: true,
      errorMessage: true,
      createdAt: true,
      order: {
        select: {
          documentNumber: true,
          warehouse: true,
          status: true,
          orderTotal: true,
          _count: { select: { items: true } },
        },
      },
    },
  });
}
