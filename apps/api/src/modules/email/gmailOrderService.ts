import { WorkflowError } from '../workflow/workflowService.js';
import { parseEmailOrderMetadata } from './emailMetadata.js';
import { importEmailAttachment } from './emailOrderService.js';

export { parseEmailOrderMetadata } from './emailMetadata.js';

type Environment = NodeJS.ProcessEnv;

type GmailPart = {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; data?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  snippet?: string;
  payload?: GmailPart & { headers?: Array<{ name: string; value: string }> };
  internalDate?: string;
};

export type GmailConfiguration = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  user: string;
  query: string;
  intervalMs: number;
};

export function getGmailStatus(environment: Environment = process.env) {
  const required = {
    GMAIL_CLIENT_ID: environment.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: environment.GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN: environment.GMAIL_REFRESH_TOKEN,
  };
  const missingSettings = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const intervalMs = parseInterval(environment.GMAIL_POLL_INTERVAL_MS);
  return {
    provider: 'GMAIL' as const,
    configured: missingSettings.length === 0,
    automatic: missingSettings.length === 0 && intervalMs > 0,
    mailbox: environment.GMAIL_USER || 'me',
    query: environment.GMAIL_QUERY || 'is:unread has:attachment filename:xlsx',
    intervalSeconds: Math.round(intervalMs / 1000),
    missingSettings,
  };
}

export function getGmailConfiguration(environment: Environment = process.env): GmailConfiguration {
  const status = getGmailStatus(environment);
  const clientId = environment.GMAIL_CLIENT_ID;
  const clientSecret = environment.GMAIL_CLIENT_SECRET;
  const refreshToken = environment.GMAIL_REFRESH_TOKEN;
  if (!status.configured || !clientId || !clientSecret || !refreshToken) {
    throw new WorkflowError('Gmail ещё не подключён к сервису', 409);
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    user: environment.GMAIL_USER || 'me',
    query: status.query,
    intervalMs: status.intervalSeconds * 1000,
  };
}

function parseInterval(raw?: string) {
  const value = Number(raw ?? 5_000);
  return Number.isFinite(value) && value >= 5_000 ? Math.round(value) : 5_000;
}

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function header(message: GmailMessage, name: string) {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}

function findXlsxParts(part?: GmailPart): GmailPart[] {
  if (!part) return [];
  const current = part.filename?.toLowerCase().endsWith('.xlsx') ? [part] : [];
  return [...current, ...(part.parts?.flatMap(findXlsxParts) ?? [])];
}

function messageText(part?: GmailPart): string {
  if (!part) return '';
  const own =
    part.body?.data && (!part.mimeType || part.mimeType === 'text/plain' || part.mimeType === 'text/html')
      ? decodeBase64Url(part.body.data).toString('utf8')
      : '';
  return [own, ...(part.parts?.map(messageText) ?? [])]
    .join(' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

async function gmailJson<T>(fetchImpl: typeof fetch, url: string, init: RequestInit, description: string) {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new WorkflowError(
      `${description}: Gmail вернул HTTP ${response.status}${details ? ` — ${details}` : ''}`,
      502,
    );
  }
  return (await response.json()) as T;
}

async function accessToken(config: GmailConfiguration, fetchImpl: typeof fetch) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  });
  const result = await gmailJson<{ access_token?: string }>(
    fetchImpl,
    'https://oauth2.googleapis.com/token',
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
    'Не удалось обновить доступ к Gmail',
  );
  if (!result.access_token) throw new WorkflowError('Gmail не выдал токен доступа', 502);
  return result.access_token;
}

export async function syncGmailOrders(
  config: GmailConfiguration = getGmailConfiguration(),
  fetchImpl: typeof fetch = fetch,
) {
  const token = await accessToken(config, fetchImpl);
  const user = encodeURIComponent(config.user);
  const authorization = { Authorization: `Bearer ${token}` };
  const list = await gmailJson<{ messages?: Array<{ id: string }> }>(
    fetchImpl,
    `https://gmail.googleapis.com/gmail/v1/users/${user}/messages?q=${encodeURIComponent(config.query)}&maxResults=50`,
    { headers: authorization },
    'Не удалось получить письма',
  );

  const summary = {
    messages: list.messages?.length ?? 0,
    attachments: 0,
    imported: 0,
    updated: 0,
    duplicates: 0,
    failed: 0,
  };
  for (const item of list.messages ?? []) {
    const message = await gmailJson<GmailMessage>(
      fetchImpl,
      `https://gmail.googleapis.com/gmail/v1/users/${user}/messages/${encodeURIComponent(item.id)}?format=full`,
      { headers: authorization },
      'Не удалось прочитать письмо',
    );
    const parts = findXlsxParts(message.payload);
    const subject = header(message, 'Subject') || 'Без темы';
    const metadata = parseEmailOrderMetadata(
      subject,
      `${message.snippet || ''} ${messageText(message.payload)}`,
      parts[0]?.filename,
    );
    for (const part of parts) {
      summary.attachments += 1;
      try {
        let buffer: Buffer;
        if (part.body?.data) {
          buffer = decodeBase64Url(part.body.data);
        } else if (part.body?.attachmentId) {
          const attachment = await gmailJson<{ data: string }>(
            fetchImpl,
            `https://gmail.googleapis.com/gmail/v1/users/${user}/messages/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
            { headers: authorization },
            'Не удалось скачать вложение',
          );
          buffer = decodeBase64Url(attachment.data);
        } else {
          throw new WorkflowError('Gmail не передал содержимое вложения', 502);
        }
        const result = await importEmailAttachment({
          sourceKey: `gmail:${item.id}:${part.body?.attachmentId || part.filename}`,
          provider: 'GMAIL',
          messageId: item.id,
          sender: header(message, 'From') || 'Неизвестный отправитель',
          subject,
          receivedAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(),
          attachmentId: part.body?.attachmentId,
          attachmentName: part.filename || 'attachment.xlsx',
          buffer,
          orderNumber: metadata.orderNumber,
          orderTotal: metadata.orderTotal,
        });
        if (result.duplicate || result.alreadyProcessed) summary.duplicates += 1;
        else if (result.updated) summary.updated += 1;
        else summary.imported += 1;
      } catch {
        summary.failed += 1;
      }
    }
    if (parts.length) {
      await gmailJson(
        fetchImpl,
        `https://gmail.googleapis.com/gmail/v1/users/${user}/messages/${encodeURIComponent(item.id)}/modify`,
        {
          method: 'POST',
          headers: { ...authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
        },
        'Не удалось отметить письмо обработанным',
      );
    }
  }
  return summary;
}
