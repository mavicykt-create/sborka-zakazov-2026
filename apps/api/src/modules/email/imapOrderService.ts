import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import { simpleParser } from 'mailparser';
import { WorkflowError } from '../workflow/workflowService.js';
import { isEmailOrderConfirmation, parseEmailOrderMetadata } from './emailMetadata.js';
import { confirmEmailOrder, importEmailAttachment } from './emailOrderService.js';

type Environment = NodeJS.ProcessEnv;

export type ImapConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  sender?: string;
  unseenOnly: boolean;
  lookbackMs: number;
  intervalMs: number;
};

function parseInterval(raw?: string) {
  const value = Number(raw ?? 5_000);
  return Number.isFinite(value) && value >= 5_000 ? Math.round(value) : 5_000;
}

function parsePort(raw?: string) {
  const value = Number(raw ?? 993);
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : 993;
}

function parseLookback(raw?: string) {
  const value = Number(raw ?? 15);
  const minutes = Number.isFinite(value) && value >= 1 && value <= 10_080 ? value : 15;
  return Math.round(minutes * 60_000);
}

function parseBoolean(raw: string | undefined, fallback: boolean) {
  if (raw == null || raw === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(raw.trim().toLowerCase());
}

export function getImapStatus(environment: Environment = process.env) {
  const required = {
    IMAP_USER: environment.IMAP_USER,
    IMAP_PASSWORD: environment.IMAP_PASSWORD,
  };
  const missingSettings = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const intervalMs = parseInterval(environment.IMAP_POLL_INTERVAL_MS);
  return {
    provider: 'YANDEX_IMAP' as const,
    configured: missingSettings.length === 0,
    automatic: missingSettings.length === 0 && intervalMs > 0,
    mailbox: environment.IMAP_USER || 'mail@sladkayaplaneta.ru',
    query: environment.IMAP_SENDER
      ? `${parseBoolean(environment.IMAP_UNSEEN_ONLY, true) ? 'Непрочитанные' : 'Последние'} письма с XLSX от ${environment.IMAP_SENDER}`
      : `${parseBoolean(environment.IMAP_UNSEEN_ONLY, true) ? 'Непрочитанные' : 'Последние'} письма с XLSX`,
    intervalSeconds: Math.round(intervalMs / 1000),
    missingSettings,
  };
}

export function getImapConfiguration(environment: Environment = process.env): ImapConfiguration {
  const status = getImapStatus(environment);
  const user = environment.IMAP_USER;
  const password = environment.IMAP_PASSWORD;
  if (!status.configured || !user || !password) {
    throw new WorkflowError('Яндекс Почта ещё не подключена к сервису', 409);
  }
  return {
    host: environment.IMAP_HOST || 'imap.yandex.com',
    port: parsePort(environment.IMAP_PORT),
    secure: parseBoolean(environment.IMAP_SECURE, true),
    user,
    password,
    mailbox: environment.IMAP_MAILBOX || 'INBOX',
    sender: environment.IMAP_SENDER || undefined,
    unseenOnly: parseBoolean(environment.IMAP_UNSEEN_ONLY, true),
    lookbackMs: parseLookback(environment.IMAP_LOOKBACK_MINUTES),
    intervalMs: status.intervalSeconds * 1000,
  };
}

export async function parseImapMessage(source: Buffer) {
  const parsed = await simpleParser(source);
  const subject = parsed.subject || 'Без темы';
  const html = typeof parsed.html === 'string' ? parsed.html : '';
  const text = `${parsed.text || ''} ${html.replace(/<[^>]+>/gu, ' ')}`.replace(/\s+/gu, ' ').trim();
  const attachments = parsed.attachments.filter((item) => item.filename?.toLowerCase().endsWith('.xlsx'));
  const metadata = parseEmailOrderMetadata(subject, text, attachments[0]?.filename);
  return {
    subject,
    text,
    messageId: parsed.messageId,
    sender: parsed.from?.text || 'Неизвестный отправитель',
    receivedAt: parsed.date,
    attachments,
    metadata,
    confirmation: isEmailOrderConfirmation(subject, text),
  };
}

async function resolveMailbox(client: ImapFlow, requested: string) {
  if (!['SENT', 'AUTO_SENT'].includes(requested.trim().toUpperCase())) return requested;
  const mailboxes = await client.list();
  return mailboxes.find((mailbox) => mailbox.specialUse === '\\Sent')?.path || 'Sent';
}

export async function syncImapOrders(
  config: ImapConfiguration = getImapConfiguration(),
  createClient: (options: ImapFlowOptions) => ImapFlow = (options) => new ImapFlow(options),
) {
  const client = createClient({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    connectionTimeout: 30_000,
  });
  const summary = {
    messages: 0,
    attachments: 0,
    imported: 0,
    updated: 0,
    duplicates: 0,
    confirmed: 0,
    failed: 0,
  };

  try {
    await client.connect();
    const mailbox = await resolveMailbox(client, config.mailbox);
    const lock = await client.getMailboxLock(mailbox);
    try {
      const search = config.sender
        ? config.unseenOnly
          ? { seen: false, from: config.sender }
          : { all: true, from: config.sender }
        : config.unseenOnly
          ? { seen: false }
          : { all: true };
      const unseen = (await client.search(search, { uid: true })) || [];
      const uids = Array.isArray(unseen) ? unseen.slice(-50) : [];
      const messages = uids.length
        ? await client.fetchAll(uids, { uid: true, source: true, internalDate: true }, { uid: true })
        : [];
      const cutoff = config.unseenOnly ? null : Date.now() - config.lookbackMs;

      for (const message of messages) {
        if (cutoff && message.internalDate && new Date(message.internalDate).getTime() < cutoff) continue;
        summary.messages += 1;
        if (!message.source) {
          summary.failed += 1;
          continue;
        }
        let parsed: Awaited<ReturnType<typeof parseImapMessage>>;
        try {
          parsed = await parseImapMessage(message.source);
        } catch {
          summary.failed += 1;
          continue;
        }
        const receivedAt =
          parsed.receivedAt || (message.internalDate ? new Date(message.internalDate) : new Date());
        for (const [index, attachment] of parsed.attachments.entries()) {
          summary.attachments += 1;
          try {
            const result = await importEmailAttachment({
              sourceKey: `imap:${config.host}:${mailbox}:${message.uid}:${index}`,
              provider: 'YANDEX_IMAP',
              messageId: parsed.messageId || `${mailbox}:${message.uid}`,
              sender: parsed.sender,
              subject: parsed.subject,
              receivedAt,
              attachmentId: `${message.uid}:${index}`,
              attachmentName: attachment.filename || `attachment-${index + 1}.xlsx`,
              buffer: attachment.content,
              orderNumber: parsed.metadata.orderNumber,
              orderTotal: parsed.metadata.orderTotal,
            });
            if (result.duplicate || result.alreadyProcessed) summary.duplicates += 1;
            else if (result.updated) summary.updated += 1;
            else summary.imported += 1;
          } catch {
            summary.failed += 1;
          }
        }
        let confirmationMatched = false;
        if (parsed.confirmation && parsed.metadata.orderNumber) {
          const confirmation = await confirmEmailOrder(
            parsed.metadata.orderNumber,
            receivedAt,
            parsed.messageId || `${mailbox}:${message.uid}`,
          );
          confirmationMatched = confirmation.matched;
          if (confirmation.matched && !confirmation.alreadyConfirmed) summary.confirmed += 1;
        }
        if (config.unseenOnly && (parsed.attachments.length || confirmationMatched)) {
          await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
        }
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkflowError(`Не удалось проверить Яндекс Почту по IMAP: ${message}`, 502);
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
  }
  return summary;
}
