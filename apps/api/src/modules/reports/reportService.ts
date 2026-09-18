import { createRequire } from 'node:module';
import type { ItemStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { db } from '../../db.js';
import { WorkflowError } from '../workflow/workflowService.js';

const require = createRequire(import.meta.url);
const fontPath = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');

type ReportKind = 'short' | 'full';

const statusLabels: Record<ItemStatus, string> = {
  PENDING: 'Ожидает',
  ASSIGNED: 'Назначено',
  ACTIVE: 'В работе',
  PICKED: 'Собрано',
  NOT_FOUND: 'Не найдено',
  SKIPPED: 'Пропущено',
};

export async function createOrderReport(orderId: string, kind: ReportKind, orderUrl: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        orderBy: { sortIndex: 'asc' },
        include: { assignedWorker: { select: { id: true, name: true } } },
      },
    },
  });
  if (!order) throw new WorkflowError('Заказ не найден', 404);
  if (!['COMPLETED', 'REVIEW_REQUIRED', 'CLOSED'].includes(order.status)) {
    throw new WorkflowError('Отчёт доступен только после завершения сборки', 409);
  }

  const picked = order.items.filter((item) => item.status === 'PICKED').length;
  const notFound = order.items.filter((item) => item.status === 'NOT_FOUND').length;
  const skipped = order.items.filter((item) => item.status === 'SKIPPED').length;
  const problems = order.items.filter(
    (item) => item.status === 'NOT_FOUND' || item.status === 'SKIPPED' || item.pickType === 'REVIEW',
  );
  const endAt = order.closedAt ?? order.completedAt;
  const duration =
    order.startedAt && endAt ? formatDuration(endAt.getTime() - order.startedAt.getTime()) : '—';
  const qr = await QRCode.toBuffer(orderUrl, { width: 180, margin: 1, errorCorrectionLevel: 'M' });

  const doc = new PDFDocument({
    size: 'A4',
    margin: 38,
    bufferPages: true,
    info: { Title: `Лист сборки ${order.documentNumber}` },
  });
  doc.registerFont('Report', fontPath);
  doc.font('Report');
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  title(doc, kind === 'short' ? 'ЛИСТ СБОРКИ' : 'ПОЛНЫЙ ОТЧЁТ ПО СБОРКЕ');
  doc.fontSize(17).text(`Документ №${order.documentNumber} от ${formatDate(order.documentDate)}`);
  doc.moveDown(0.35).fontSize(10).fillColor('#4a5b53').text(`Склад: ${order.warehouse}`);
  doc.text(
    `Начало: ${formatDateTime(order.startedAt)}   Конец: ${formatDateTime(endAt)}   Общее время: ${duration}`,
  );
  doc.moveDown(0.8);
  summaryRow(doc, [
    ['Всего', order.items.length],
    ['Собрано', picked],
    ['Не найдено', notFound],
    ['Пропущено', skipped],
  ]);

  heading(doc, 'Статистика сборщиков');
  const workerStats = new Map<string, { name: string; total: number; picked: number; problems: number }>();
  for (const item of order.items) {
    const key = item.assignedWorker?.id ?? 'none';
    const current = workerStats.get(key) ?? {
      name: item.assignedWorker?.name ?? 'Не назначено',
      total: 0,
      picked: 0,
      problems: 0,
    };
    current.total += 1;
    current.picked += item.status === 'PICKED' ? 1 : 0;
    current.problems += ['NOT_FOUND', 'SKIPPED'].includes(item.status) ? 1 : 0;
    workerStats.set(key, current);
  }
  for (const worker of workerStats.values()) {
    doc
      .fontSize(9)
      .fillColor('#152820')
      .text(`${worker.name}: ${worker.picked}/${worker.total}, проблем: ${worker.problems}`);
  }

  if (kind === 'full') {
    heading(doc, 'Все товарные позиции');
    tableHeader(doc);
    for (const item of order.items) {
      ensureSpace(doc, 38, tableHeader);
      const y = doc.y;
      const pickType = item.pickType === 'PACKAGE' ? 'УПАК' : item.pickType === 'PIECE' ? 'ШТ' : 'ПРОВЕРИТЬ';
      doc.fontSize(7.4).fillColor('#152820');
      doc.text(String(item.sourceLine), 38, y, { width: 26 });
      doc.text(item.name, 66, y, { width: 190, height: 30, ellipsis: true });
      doc.text(item.barcode ?? '—', 260, y, { width: 76 });
      doc.text(`${numberValue(item.pickQuantity)} ${pickType}`, 338, y, { width: 60 });
      doc.text(item.assignedWorker?.name ?? '—', 400, y, { width: 68, height: 30, ellipsis: true });
      doc.text(statusLabels[item.status], 470, y, { width: 62 });
      doc.text(item.pickedAt ? formatTime(item.pickedAt) : '—', 534, y, { width: 25 });
      doc
        .moveTo(38, y + 32)
        .lineTo(557, y + 32)
        .strokeColor('#d5dcd5')
        .stroke();
      doc.y = y + 36;
    }
  }

  ensureSpace(doc, 180);
  heading(doc, 'Проблемные позиции');
  if (problems.length === 0) {
    doc.fontSize(9).fillColor('#37725e').text('Проблемных позиций нет.');
  } else {
    for (const item of problems) {
      ensureSpace(doc, 30);
      doc
        .fontSize(9)
        .fillColor('#8b3f36')
        .text(
          `${item.sourceLine}. ${item.name} — ${statusLabels[item.status]}${item.reviewComment ? ` (${item.reviewComment})` : ''}`,
        );
    }
  }

  ensureSpace(doc, 105);
  doc
    .moveDown(1.2)
    .fillColor('#152820')
    .fontSize(10)
    .text('Проверил: ______________________________    Дата: ______________');
  doc.image(qr, 467, doc.y + 8, { width: 72 });
  doc
    .fontSize(7)
    .fillColor('#697970')
    .text(`Карточка заказа: ${orderUrl}`, 38, doc.y + 28, { width: 410 });

  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    doc.switchToPage(index);
    doc
      .font('Report')
      .fontSize(7)
      .fillColor('#697970')
      .text(`Страница ${index + 1} из ${pages.count}`, 470, 790, {
        width: 85,
        align: 'right',
        lineBreak: false,
      });
  }
  doc.end();
  return completed;
}

function title(doc: PDFKit.PDFDocument, value: string) {
  doc.fontSize(10).fillColor('#be6c28').text('СБОРКА ЗАКАЗОВ 2026', { characterSpacing: 1.1 });
  doc.moveDown(0.25).fontSize(23).fillColor('#173f34').text(value);
  doc.moveDown(0.55);
}

function heading(doc: PDFKit.PDFDocument, value: string) {
  ensureSpace(doc, 36);
  doc.x = 38;
  doc.moveDown(0.8).fontSize(12).fillColor('#173f34').text(value, 38, doc.y, { width: 519 });
  doc.x = 38;
  doc.moveDown(0.35);
}

function summaryRow(doc: PDFKit.PDFDocument, values: Array<[string, number]>) {
  const startX = 38;
  const width = 126;
  const y = doc.y;
  for (const [index, [label, value]] of values.entries()) {
    const x = startX + index * (width + 5);
    doc.roundedRect(x, y, width, 44, 5).fillAndStroke('#edf4ef', '#d5dcd5');
    doc
      .fillColor('#697970')
      .fontSize(8)
      .text(label, x + 9, y + 7, { width: width - 18 });
    doc
      .fillColor('#173f34')
      .fontSize(16)
      .text(String(value), x + 9, y + 20, { width: width - 18 });
  }
  doc.y = y + 48;
}

function tableHeader(doc: PDFKit.PDFDocument) {
  const y = doc.y;
  doc.rect(38, y, 519, 18).fill('#173f34');
  doc.fillColor('#ffffff').fontSize(6.8);
  doc.text('№', 38, y + 5, { width: 26 });
  doc.text('Товар', 66, y + 5, { width: 190 });
  doc.text('Штрихкод', 260, y + 5, { width: 76 });
  doc.text('Отбор', 338, y + 5, { width: 60 });
  doc.text('Сборщик', 400, y + 5, { width: 68 });
  doc.text('Статус', 470, y + 5, { width: 62 });
  doc.text('Время', 534, y + 5, { width: 25 });
  doc.y = y + 22;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number, onNewPage?: (doc: PDFKit.PDFDocument) => void) {
  if (doc.y + needed <= 790) return;
  doc.addPage();
  doc.font('Report');
  if (onNewPage) onNewPage(doc);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Yakutsk' }).format(value);
}

function formatDateTime(value: Date | null) {
  return value
    ? new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Yakutsk',
      }).format(value)
    : '—';
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Yakutsk',
  }).format(value);
}

function formatDuration(milliseconds: number) {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

function numberValue(value: { toString(): string }) {
  return String(Number(value.toString()));
}
