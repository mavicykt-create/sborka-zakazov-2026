import { getGmailConfiguration, getGmailStatus, syncGmailOrders } from './gmailOrderService.js';
import { getImapConfiguration, getImapStatus, syncImapOrders } from './imapOrderService.js';

type Environment = NodeJS.ProcessEnv;

function prefersImap(environment: Environment) {
  return Boolean(environment.IMAP_USER || environment.IMAP_PASSWORD || environment.IMAP_HOST);
}

export function getEmailConnectionStatus(environment: Environment = process.env) {
  const imap = getImapStatus(environment);
  const gmail = getGmailStatus(environment);
  if (imap.configured || prefersImap(environment) || !gmail.configured) return imap;
  return gmail;
}

export function getEmailPollInterval(environment: Environment = process.env) {
  return getEmailConnectionStatus(environment).intervalSeconds * 1000;
}

export async function syncEmailOrders(environment: Environment = process.env) {
  const imap = getImapStatus(environment);
  if (imap.configured || prefersImap(environment)) return syncImapOrders(getImapConfiguration(environment));
  return syncGmailOrders(getGmailConfiguration(environment));
}
