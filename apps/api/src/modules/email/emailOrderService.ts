import crypto from 'node:crypto';
import { type EmailOrderImport as EmailOrderImportRecord, Prisma } from '@prisma/client';
import { db } from '../../db.js';
import { importOrderXlsx } from '../orders/importService.js';
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
};

export async function importEmailAttachment(input: EmailAttachmentInput) {
  const existing = await db.emailOrderImport.findUnique({ where: { sourceKey: input.sourceKey } });
  if (existing) {
    return {
      alreadyProcessed: true,
      emailImport: existing,
      order: existing.orderId ? await getOrderDetails(existing.orderId) : null,
      duplicate: existing.status === 'DUPLICATE',
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
    const result = await importOrderXlsx(input.attachmentName, input.buffer);
    const updated = await db.emailOrderImport.update({
      where: { id: emailImport.id },
      data: {
        status: result.duplicate ? 'DUPLICATE' : 'IMPORTED',
        orderId: result.order.id,
        errorMessage: null,
      },
    });
    return { ...result, alreadyProcessed: false, emailImport: updated };
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
      errorMessage: true,
      createdAt: true,
      order: {
        select: { documentNumber: true, warehouse: true, status: true, _count: { select: { items: true } } },
      },
    },
  });
}
