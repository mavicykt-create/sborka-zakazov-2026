import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { determinePickType, normalizeGroupKey, parseOrderXlsx } from '../src/modules/orders/xlsxParser.js';

describe('parseOrderXlsx', () => {
  it('parses the real sample order', async () => {
    const path = fileURLToPath(new URL('../../../test-data/sample-order-12293.xlsx', import.meta.url));
    const buffer = await readFile(path);
    const order = await parseOrderXlsx(buffer);

    expect(order.documentNumber).toBe('12293');
    expect(order.documentDate).toBe('2026-09-10');
    expect(order.warehouse).toBe('Основной склад');
    expect(order.items).toHaveLength(48);

    const firstSourceItem = order.items.find((x) => x.sourceLine === 1);
    expect(firstSourceItem).toBeDefined();
    if (!firstSourceItem) throw new Error('Первая товарная строка не найдена');
    expect(firstSourceItem.name).toBe('КОФЕ MONARCH 3В1 крепкий 10/24 13гр');
    expect(firstSourceItem.barcode).toBe('4607001773207');
    expect(firstSourceItem.packageQuantity).toBe(1);
    expect(firstSourceItem.pieceQuantity).toBe(24);
    expect(firstSourceItem.pickType).toBe('PACKAGE');
    expect(firstSourceItem.groupKey).toBe('КОФЕ');

    expect(order.items.every((item, index) => item.sortIndex === index + 1)).toBe(true);
    expect(order.items.every((item) => item.pickType === 'PACKAGE')).toBe(true);
    expect(order.warnings).toEqual([]);

    const sortedAgain = [...order.items].sort(
      (a, b) =>
        a.groupKey.localeCompare(b.groupKey, 'ru') ||
        a.name.localeCompare(b.name, 'ru') ||
        a.sourceLine - b.sourceLine,
    );
    expect(order.items.map((item) => item.sourceLine)).toEqual(sortedAgain.map((item) => item.sourceLine));
  });

  it('accepts the current email receipt with a plain Code column and total', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Лист_1');
    sheet.getCell('B1').value = 'Товарный чек № 13183 от 25 сентября 2026 г.';
    sheet.getCell('B3').value = 'Поставщик:';
    sheet.getCell('G3').value = 'ИП Поставщик';
    sheet.getCell('G5').value = 'Основной склад';
    sheet.getCell('B7').value = 'Покупатель:';
    sheet.getCell('B9').value = '№';
    sheet.getCell('D9').value = 'Код';
    sheet.getCell('H9').value = 'Товар';
    sheet.getCell('AB9').value = 'Количество';
    sheet.getCell('AE9').value = 'Цена';
    sheet.getCell('B10').value = 1;
    sheet.getCell('D10').value = '0263';
    sheet.getCell('H10').value = 'ПЧН Милка ВАФЛИ ЧОКО ВАФЕР 30гр 4/30';
    sheet.getCell('AB10').value = 1;
    sheet.getCell('AC10').value = 30;
    sheet.getCell('AE10').value = 1907.4;
    sheet.getCell('AE13').value = 'Итого:';
    sheet.getCell('AF13').value = 1907.4;

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const order = await parseOrderXlsx(buffer);

    expect(order).toMatchObject({
      documentNumber: '13183',
      warehouse: 'Основной склад',
      orderTotal: 1907.4,
    });
    expect(order.items[0]).toMatchObject({ barcode: '0263', packageQuantity: 1, pieceQuantity: 30 });
  });

  it('normalizes the first meaningful word for grouping', () => {
    expect(normalizeGroupKey('  --- кофе Arabica')).toBe('КОФЕ');
    expect(normalizeGroupKey('... ЖК Мармелад')).toBe('ЖК');
  });

  it('selects package, piece or review according to quantities', () => {
    expect(determinePickType(2, 24)).toEqual({ type: 'PACKAGE', quantity: 2 });
    expect(determinePickType(0, 7)).toEqual({ type: 'PIECE', quantity: 7 });
    expect(determinePickType(null, null)).toEqual({ type: 'REVIEW', quantity: 0 });
  });
});
