import { describe, expect, it } from 'vitest';
import { getGmailConfiguration, getGmailStatus } from '../src/modules/email/gmailOrderService.js';

describe('Gmail order configuration', () => {
  it('reports missing OAuth settings without exposing their values', () => {
    const status = getGmailStatus({ GMAIL_USER: 'orders@example.ru' });

    expect(status).toMatchObject({
      configured: false,
      automatic: false,
      mailbox: 'orders@example.ru',
      intervalSeconds: 60,
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
});
