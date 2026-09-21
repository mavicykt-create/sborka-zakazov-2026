import { describe, expect, it } from 'vitest';
import {
  authenticateOneC,
  OneCAuthError,
  oneCExpenseInvoiceSchema,
} from '../src/modules/integrations/oneCExchangeService.js';

describe('1C expense invoice exchange', () => {
  const invoice = {
    sourceId: '16e9a5f4-7e0e-4d65-91ee-64f3a7b64c38',
    revision: '2026-09-22T11:45:00',
    posted: true,
    documentNumber: 'РН-000123',
    documentDate: '2026-09-22',
    warehouse: 'Основной склад',
    customer: 'Тестовый покупатель',
    items: [
      {
        lineNumber: 1,
        productId: 'a9bbf73c-2d1e-4727-8704-534cc70a989e',
        sku: '10101',
        barcode: '4600000000001',
        name: 'Товар',
        quantity: 2,
        unit: 'шт',
        pickType: 'PIECE',
      },
    ],
  };

  it('accepts a posted UNF expense invoice', () => {
    expect(oneCExpenseInvoiceSchema.parse(invoice)).toEqual(invoice);
  });

  it('requires goods for a posted invoice but permits an unposted notification', () => {
    expect(() => oneCExpenseInvoiceSchema.parse({ ...invoice, items: [] })).toThrow('нет товаров');
    expect(oneCExpenseInvoiceSchema.parse({ ...invoice, posted: false, items: [] }).posted).toBe(false);
  });

  it('rejects repeated line numbers', () => {
    expect(() =>
      oneCExpenseInvoiceSchema.parse({ ...invoice, items: [invoice.items[0], invoice.items[0]] }),
    ).toThrow('Повторяются номера строк');
  });

  it('uses a constant-time bearer token check', () => {
    const token = 'x'.repeat(48);
    expect(() => authenticateOneC(`Bearer ${token}`, token)).not.toThrow();
    expect(() => authenticateOneC('Bearer wrong', token)).toThrow(OneCAuthError);
    expect(() => authenticateOneC(undefined, token)).toThrow(OneCAuthError);
  });
});
