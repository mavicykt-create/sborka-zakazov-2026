import { describe, expect, it } from 'vitest';
import {
  getGmailConfiguration,
  getGmailStatus,
  parseEmailOrderMetadata,
} from '../src/modules/email/gmailOrderService.js';

describe('Gmail order configuration', () => {
  it('reports missing OAuth settings without exposing their values', () => {
    const status = getGmailStatus({ GMAIL_USER: 'orders@example.ru' });

    expect(status).toMatchObject({
      configured: false,
      automatic: false,
      mailbox: 'orders@example.ru',
      intervalSeconds: 5,
    });
    expect(status.missingSettings).toEqual(['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']);
    expect(JSON.stringify(status)).not.toContain('secret-value');
  });

  it('builds a safe polling configuration from complete OAuth settings', () => {
    const environment = {
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: 'refresh-token',
      GMAIL_USER: 'orders@example.ru',
      GMAIL_QUERY: 'is:unread from:partner@example.ru filename:xlsx',
      GMAIL_POLL_INTERVAL_MS: '30000',
    };

    expect(getGmailStatus(environment)).toMatchObject({
      configured: true,
      automatic: true,
      intervalSeconds: 30,
    });
    expect(getGmailConfiguration(environment)).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      user: 'orders@example.ru',
      query: 'is:unread from:partner@example.ru filename:xlsx',
      intervalMs: 30000,
    });
  });

  it('refuses to start a sync until OAuth is configured', () => {
    expect(() => getGmailConfiguration({})).toThrow('Gmail ещё не подключён');
  });

  it('extracts the order number and Russian money amount from the email', () => {
    expect(parseEmailOrderMetadata('ЗАКАЗ №13183', '№13183 Сумма 5 342,16')).toEqual({
      orderNumber: '13183',
      orderTotal: 5342.16,
    });
  });

  it('falls back to the attachment number', () => {
    expect(parseEmailOrderMetadata('Документы', '', 'Товарный чек № НФ-13183 от 25.09.2026.xlsx')).toEqual({
      orderNumber: '13183',
      orderTotal: null,
    });
  });
});
