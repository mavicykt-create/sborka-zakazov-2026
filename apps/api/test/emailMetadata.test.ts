import { describe, expect, it } from 'vitest';
import { isEmailOrderConfirmation, parseEmailOrderMetadata } from '../src/modules/email/emailMetadata.js';

describe('email order confirmation', () => {
  it('recognizes a confirmation with an order number', () => {
    expect(isEmailOrderConfirmation('Заказ №13183 оформлен', '')).toBe(true);
    expect(parseEmailOrderMetadata('Заказ 13183 оформлен', '')).toMatchObject({ orderNumber: '13183' });
  });

  it('does not treat a new or updated order as confirmation', () => {
    expect(isEmailOrderConfirmation('Новый заказ №13183', 'Сумма изменилась')).toBe(false);
  });
});
