import { describe, expect, it } from 'vitest';
import {
  getImapConfiguration,
  getImapStatus,
  parseImapMessage,
} from '../src/modules/email/imapOrderService.js';
import { getEmailConnectionStatus } from '../src/modules/email/mailboxOrderService.js';

describe('Yandex IMAP order configuration', () => {
  it('reports only the missing login and app password', () => {
    const status = getImapStatus({});

    expect(status).toMatchObject({
      provider: 'YANDEX_IMAP',
      configured: false,
      automatic: false,
      mailbox: 'mail@sladkayaplaneta.ru',
      intervalSeconds: 5,
    });
    expect(status.missingSettings).toEqual(['IMAP_USER', 'IMAP_PASSWORD']);
  });

  it('builds the secure Yandex IMAP defaults without exposing the password in status', () => {
    const environment = {
      IMAP_USER: 'mail@sladkayaplaneta.ru',
      IMAP_PASSWORD: 'app-password',
      IMAP_POLL_INTERVAL_MS: '10000',
    };

    expect(getImapConfiguration(environment)).toEqual({
      host: 'imap.yandex.com',
      port: 993,
      secure: true,
      user: 'mail@sladkayaplaneta.ru',
      password: 'app-password',
      mailbox: 'INBOX',
      sender: undefined,
      intervalMs: 10000,
    });
    expect(JSON.stringify(getImapStatus(environment))).not.toContain('app-password');
  });

  it('prefers configured IMAP over Gmail OAuth', () => {
    const status = getEmailConnectionStatus({
      IMAP_USER: 'mail@sladkayaplaneta.ru',
      IMAP_PASSWORD: 'app-password',
      GMAIL_CLIENT_ID: 'client',
      GMAIL_CLIENT_SECRET: 'secret',
      GMAIL_REFRESH_TOKEN: 'refresh',
    });

    expect(status.provider).toBe('YANDEX_IMAP');
  });

  it('parses an XLSX attachment and order metadata from a MIME message', async () => {
    const source = Buffer.from(
      [
        'From: Сладкая планета <mail@sladkayaplaneta.ru>',
        'To: mail@sladkayaplaneta.ru',
        'Subject: Заказ №13183, сумма 5 342,16',
        'Message-ID: <order-13183@example.ru>',
        'Date: Fri, 25 Sep 2026 10:00:00 +0900',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="order-boundary"',
        '',
        '--order-boundary',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Новый заказ поступил.',
        '--order-boundary',
        'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition: attachment; filename="order-13183.xlsx"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('xlsx-test').toString('base64'),
        '--order-boundary--',
        '',
      ].join('\r\n'),
    );

    const parsed = await parseImapMessage(source);

    expect(parsed.sender).toContain('mail@sladkayaplaneta.ru');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.filename).toBe('order-13183.xlsx');
    expect(parsed.metadata).toEqual({ orderNumber: '13183', orderTotal: 5342.16 });
  });
});
