import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseOrderXlsx } from '../src/modules/orders/xlsxParser.js';

describe('parseOrderXlsx', () => {
  it('parses the real sample order', async () => {
    const path = resolve(process.cwd(), '../../test-data/sample-order-12293.xlsx');
    const buffer = await readFile(path);
    const order = await parseOrderXlsx(buffer);

    expect(order.documentNumber).toBe('12293');
    expect(order.documentDate).toBe('2026-09-10');
    expect(order.warehouse).toBe('Основной склад');
    expect(order.items).toHaveLength(48);

    const firstSourceItem = order.items.find(x => x.sourceLine === 1)!;
    expect(firstSourceItem.name).toBe('КОФЕ MONARCH 3В1 крепкий 10/24 13гр');
    expect(firstSourceItem.barcode).toBe('4607001773207');
    expect(firstSourceItem.packageQuantity).toBe(1);
    expect(firstSourceItem.pieceQuantity).toBe(24);
    expect(firstSourceItem.pickType).toBe('PACKAGE');
    expect(firstSourceItem.groupKey).toBe('КОФЕ');
  });
});
