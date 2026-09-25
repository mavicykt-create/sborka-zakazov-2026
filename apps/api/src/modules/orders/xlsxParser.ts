import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { ParsedOrder, ParsedOrderItem, PickType } from './types.js';

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in (v as Record<string, unknown>)) {
    const richText = (v as { richText: Array<{ text?: unknown }> }).richText;
    return richText
      .map((part) => String(part.text ?? ''))
      .join('')
      .trim();
  }
  if (typeof v === 'object' && 'text' in (v as Record<string, unknown>)) {
    return String((v as { text: unknown }).text ?? '').trim();
  }
  return String(v).trim();
}

function cellText(cell: ExcelJS.Cell): string {
  return text(cell.value);
}

function num(v: unknown): number | null {
  if (v && typeof v === 'object' && 'result' in v) return num((v as { result: unknown }).result);
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

export function determinePickType(
  packageQuantity: number | null,
  pieceQuantity: number | null,
): { type: PickType; quantity: number } {
  if (packageQuantity != null && packageQuantity > 0) return { type: 'PACKAGE', quantity: packageQuantity };
  if (pieceQuantity != null && pieceQuantity > 0) return { type: 'PIECE', quantity: pieceQuantity };
  return { type: 'REVIEW', quantity: 0 };
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  // Some 1C exports contain VML/header drawings that ExcelJS cannot reconcile.
  // They are irrelevant for import, so remove only visual parts before reading values.
  const zip = await JSZip.loadAsync(buffer);
  for (const path of Object.keys(zip.files)) {
    if (path.startsWith('xl/drawings/') || path.startsWith('xl/media/')) zip.remove(path);
  }

  const valuesOnlyBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(valuesOnlyBuffer as never, { ignoreNodes: ['drawing', 'picture'] });
  return workbook;
}

function parseDocumentHeader(value: string): { number: string; date: string } | null {
  // Example: "Товарный чек № 12293 от 10 сентября 2026 г."
  const m = value.match(/№\s*([^\s]+)\s+от\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})/iu);
  if (!m) return null;
  const months: Record<string, string> = {
    января: '01',
    февраля: '02',
    марта: '03',
    апреля: '04',
    мая: '05',
    июня: '06',
    июля: '07',
    августа: '08',
    сентября: '09',
    октября: '10',
    ноября: '11',
    декабря: '12',
  };
  const month = months[m[3].toLocaleLowerCase('ru-RU')];
  if (!month) return null;
  return { number: m[1], date: `${m[4]}-${month}-${m[2].padStart(2, '0')}` };
}

export async function parseOrderXlsx(buffer: Buffer): Promise<ParsedOrder> {
  let workbook: ExcelJS.Workbook;
  try {
    workbook = await loadWorkbook(buffer);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'неизвестная ошибка';
    throw new Error(`Не удалось прочитать XLSX: ${reason}`);
  }
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
  let orderTotal: number | null = null;

  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = cellText(cell);
      const doc = parseDocumentHeader(value);
      if (doc && !documentNumber) {
        documentNumber = doc.number;
        documentDate = doc.date;
      }
    });
  });

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    let rowNumberCol = 0;
    let rowBarcodeCol = 0;
    let rowProductCol = 0;
    let rowQuantityStartCol = 0;
    let rowPriceCol = 0;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = cellText(cell).replace(/\s+/gu, ' ');
      // Merged header cells repeat the master's value in ExcelJS. Keep the
      // leftmost column, which is the actual data/master column.
      if (!rowNumberCol && /^№$/u.test(value)) rowNumberCol = colNumber;
      if (!rowBarcodeCol && /^(?:код|артикул|код\s*\/\s*штрихкод)$/iu.test(value)) {
        rowBarcodeCol = colNumber;
      }
      if (!rowProductCol && /^товар$/iu.test(value)) rowProductCol = colNumber;
      if (!rowQuantityStartCol && /^количество$/iu.test(value)) rowQuantityStartCol = colNumber;
      if (!rowPriceCol && /^цена$/iu.test(value)) rowPriceCol = colNumber;
    });

    if (!headerRow && rowNumberCol && rowBarcodeCol && rowProductCol && rowQuantityStartCol && rowPriceCol) {
      headerRow = rowNumber;
      numberCol = rowNumberCol;
      barcodeCol = rowBarcodeCol;
      productCol = rowProductCol;
      quantityStartCol = rowQuantityStartCol;
      priceCol = rowPriceCol;
    }
  });

  if (!headerRow || !productCol || !quantityStartCol || !priceCol) {
    throw new Error('Не удалось найти заголовки Товар/Количество/Цена');
  }

  // Prefer an explicit warehouse cell. 1C layouts often contain supplier and
  // customer blocks before it, so the first arbitrary text cell is unreliable.
  for (let r = 1; r < headerRow; r++) {
    const row = sheet.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cellText(cell);
      if (v && /склад/iu.test(v) && !/поставщик|покупатель/iu.test(v) && !warehouse) warehouse = v;
    });
  }

  if (!documentNumber || !documentDate) throw new Error('Не удалось определить номер или дату документа');
  if (!warehouse) warehouse = 'Не определён';

  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (orderTotal != null || !/^итого\s*:?$/iu.test(cellText(cell))) return;
      for (let column = colNumber + 1; column <= row.cellCount; column += 1) {
        const value = num(row.getCell(column).value);
        if (value != null) {
          orderTotal = value;
          break;
        }
      }
    });
  });

  // 1C exports merge each quantity cell. Structural starts keep both columns
  // discoverable even when one of them is empty for every product.
  const candidates = new Map<number, { numericCount: number; layoutCount: number }>();
  for (let c = quantityStartCol; c < priceCol; c++) {
    candidates.set(c, { numericCount: 0, layoutCount: 0 });
  }
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (num(row.getCell(numberCol).value) == null || !cellText(row.getCell(productCol))) continue;

    for (let c = quantityStartCol; c < priceCol; c++) {
      const cell = row.getCell(c);
      const candidate = candidates.get(c);
      if (!candidate) continue;
      if (num(cell.value) != null) candidate.numericCount++;
      if (cell.isMerged && cell.master === cell) candidate.layoutCount++;
    }
  }

  const quantityCols = [...candidates.entries()]
    .filter(([, score]) => score.numericCount > 0 || score.layoutCount > 0)
    .sort(
      (a, b) => b[1].layoutCount - a[1].layoutCount || b[1].numericCount - a[1].numericCount || a[0] - b[0],
    )
    .slice(0, 2)
    .map(([col]) => col)
    .sort((a, b) => a - b);

  if (!quantityCols.length) {
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      if (num(row.getCell(numberCol).value) != null && cellText(row.getCell(productCol))) {
        throw new Error('Не удалось найти колонки количества');
      }
    }
    throw new Error('В документе нет товарных строк');
  }
  const packageCol = quantityCols[0];
  const pieceCol = quantityCols[1] ?? 0;

  const parsed: ParsedOrderItem[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const sourceLine = num(row.getCell(numberCol).value);
    const name = cellText(row.getCell(productCol));
    if (sourceLine == null || !Number.isInteger(sourceLine) || !name) continue;

    const packageQuantity = num(row.getCell(packageCol).value);
    const pieceQuantity = pieceCol ? num(row.getCell(pieceCol).value) : null;
    const pick = determinePickType(packageQuantity, pieceQuantity);
    parsed.push({
      sourceLine,
      barcode: barcodeCol ? cellText(row.getCell(barcodeCol)) || null : null,
      name,
      groupKey: normalizeGroupKey(name),
      packageQuantity,
      pieceQuantity,
      pickType: pick.type,
      pickQuantity: pick.quantity,
      sortIndex: 0,
    });
  }

  if (!parsed.length) throw new Error('В документе нет товарных строк');
  const duplicateLines = parsed.filter(
    (item, index) => parsed.findIndex((other) => other.sourceLine === item.sourceLine) !== index,
  );
  if (duplicateLines.length) {
    throw new Error(
      `Повторяются номера товарных строк: ${[...new Set(duplicateLines.map((item) => item.sourceLine))].join(', ')}`,
    );
  }

  parsed.sort(
    (a, b) =>
      a.groupKey.localeCompare(b.groupKey, 'ru') ||
      a.name.localeCompare(b.name, 'ru') ||
      a.sourceLine - b.sourceLine,
  );
  parsed.forEach((item, i) => {
    item.sortIndex = i + 1;
  });

  const warnings = parsed
    .filter((x) => x.pickType === 'REVIEW')
    .map((x) => `Строка ${x.sourceLine}: не определено количество`);
  return { documentNumber, documentDate, warehouse, orderTotal, items: parsed, warnings };
}
