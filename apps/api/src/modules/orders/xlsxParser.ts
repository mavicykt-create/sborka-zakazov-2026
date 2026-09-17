import ExcelJS from 'exceljs';
import type { ParsedOrder, ParsedOrderItem, PickType } from './types.js';

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && 'text' in (v as Record<string, unknown>)) {
    return String((v as { text: unknown }).text ?? '').trim();
  }
  return String(v).trim();
}

function num(v: unknown): number | null {
  const s = text(v).replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function normalizeGroupKey(name: string): string {
  return (name.trim().match(/^[^\p{L}\p{N}]*(\S+)/u)?.[1] ?? 'БЕЗ_ГРУППЫ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLocaleUpperCase('ru-RU');
}

function pickType(packageQuantity: number | null, pieceQuantity: number | null): { type: PickType; quantity: number } {
  if ((packageQuantity ?? 0) > 0) return { type: 'PACKAGE', quantity: packageQuantity! };
  if ((pieceQuantity ?? 0) > 0) return { type: 'PIECE', quantity: pieceQuantity! };
  return { type: 'REVIEW', quantity: 0 };
}

function parseDocumentHeader(value: string): { number: string; date: string } | null {
  // Example: "Товарный чек № 12293 от 10 сентября 2026 г."
  const m = value.match(/№\s*([^\s]+)\s+от\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})/iu);
  if (!m) return null;
  const months: Record<string, string> = {
    января: '01', февраля: '02', марта: '03', апреля: '04', мая: '05', июня: '06',
    июля: '07', августа: '08', сентября: '09', октября: '10', ноября: '11', декабря: '12'
  };
  const month = months[m[3].toLocaleLowerCase('ru-RU')];
  if (!month) return null;
  return { number: m[1], date: `${m[4]}-${month}-${m[2].padStart(2, '0')}` };
}

export async function parseOrderXlsx(buffer: Buffer): Promise<ParsedOrder> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('В XLSX нет листов');

  let headerRow = 0;
  let numberCol = 0;
  let barcodeCol = 0;
  let productCol = 0;
  let quantityStartCol = 0;
  let priceCol = 0;
  let documentNumber = '';
  let documentDate = '';
  let warehouse = '';

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = text(cell.value);
      const doc = parseDocumentHeader(value);
      if (doc && !documentNumber) {
        documentNumber = doc.number;
        documentDate = doc.date;
      }
      if (/^№$/u.test(value)) numberCol = colNumber;
      if (/код\s*\/\s*штрихкод/iu.test(value)) barcodeCol = colNumber;
      if (/^товар$/iu.test(value)) productCol = colNumber;
      if (/^количество$/iu.test(value)) quantityStartCol = colNumber;
      if (/^цена$/iu.test(value)) priceCol = colNumber;
      if (numberCol && barcodeCol && productCol && quantityStartCol && priceCol && !headerRow) headerRow = rowNumber;
    });
  });

  if (!headerRow || !productCol || !quantityStartCol || !priceCol) {
    throw new Error('Не удалось найти заголовки Товар/Количество/Цена');
  }

  // Warehouse: first useful textual cell above header that is not the document title.
  for (let r = 1; r < headerRow; r++) {
    const row = sheet.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = text(cell.value);
      if (v && !/товарный чек/iu.test(v) && !warehouse) warehouse = v;
    });
  }

  if (!documentNumber || !documentDate) throw new Error('Не удалось определить номер или дату документа');
  if (!warehouse) warehouse = 'Не определён';

  // Two quantity columns are detected by density of numeric values between "Количество" and "Цена".
  const candidates: Array<{ col: number; count: number }> = [];
  for (let c = quantityStartCol; c < priceCol; c++) {
    let count = 0;
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      if (num(row.getCell(numberCol).value) != null && text(row.getCell(productCol).value) && num(row.getCell(c).value) != null) count++;
    }
    if (count > 0) candidates.push({ col: c, count });
  }
  candidates.sort((a, b) => b.count - a.count || a.col - b.col);
  const quantityCols = candidates.slice(0, 2).map(x => x.col).sort((a, b) => a - b);
  if (quantityCols.length < 1) throw new Error('Не удалось найти колонки количества');
  const packageCol = quantityCols[0];
  const pieceCol = quantityCols[1] ?? 0;

  const parsed: ParsedOrderItem[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const sourceLine = num(row.getCell(numberCol).value);
    const name = text(row.getCell(productCol).value);
    if (sourceLine == null || !name) continue;

    const packageQuantity = num(row.getCell(packageCol).value);
    const pieceQuantity = pieceCol ? num(row.getCell(pieceCol).value) : null;
    const pick = pickType(packageQuantity, pieceQuantity);
    parsed.push({
      sourceLine,
      barcode: barcodeCol ? text(row.getCell(barcodeCol).value) || null : null,
      name,
      groupKey: normalizeGroupKey(name),
      packageQuantity,
      pieceQuantity,
      pickType: pick.type,
      pickQuantity: pick.quantity,
      sortIndex: 0
    });
  }

  parsed.sort((a, b) =>
    a.groupKey.localeCompare(b.groupKey, 'ru') || a.name.localeCompare(b.name, 'ru') || a.sourceLine - b.sourceLine
  );
  parsed.forEach((item, i) => { item.sortIndex = i + 1; });

  const warnings = parsed.filter(x => x.pickType === 'REVIEW').map(x => `Строка ${x.sourceLine}: не определено количество`);
  return { documentNumber, documentDate, warehouse, items: parsed, warnings };
}
