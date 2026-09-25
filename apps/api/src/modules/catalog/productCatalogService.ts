const DEFAULT_FEED_URL = 'https://milku.ru/site1/export-google-whatsp/';
const CACHE_TTL_MS = 10 * 60 * 1000;

export type ProductCatalogEntry = {
  code: string;
  title: string;
  imageUrl: string;
  productUrl: string | null;
  gtin: string | null;
};

let cachedAt = 0;
let cachedEntries = new Map<string, ProductCatalogEntry>();
let pendingLoad: Promise<Map<string, ProductCatalogEntry>> | null = null;

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .trim();
}

function tag(item: string, name: string) {
  const match = item.match(new RegExp(`<g:${name}>([\\s\\S]*?)<\\/g:${name}>`, 'iu'));
  return match ? decodeXml(match[1]) : '';
}

function safeMilkuUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'milku.ru' || url.hostname.endsWith('.milku.ru'))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function parseProductFeed(xml: string) {
  const entries = new Map<string, ProductCatalogEntry>();
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/giu)) {
    const item = match[1];
    const code = tag(item, 'id');
    const imageUrl = safeMilkuUrl(tag(item, 'image_link'));
    if (!code || !imageUrl) continue;
    const entry: ProductCatalogEntry = {
      code,
      title: tag(item, 'title') || code,
      imageUrl,
      productUrl: safeMilkuUrl(tag(item, 'link')),
      gtin: tag(item, 'gtin') || null,
    };
    const numeric = /^\d+$/u.test(code) ? String(Number(code)) : code;
    for (const variant of new Set([code, numeric, code.padStart(4, '0')])) entries.set(variant, entry);
  }
  return entries;
}

async function loadProductFeed(fetchImpl: typeof fetch) {
  const feedUrl = process.env.PRODUCT_FEED_URL || DEFAULT_FEED_URL;
  const response = await fetchImpl(feedUrl, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Каталог товаров вернул HTTP ${response.status}`);
  return parseProductFeed(await response.text());
}

export async function getProductCatalog(fetchImpl: typeof fetch = fetch) {
  if (cachedEntries.size && Date.now() - cachedAt < CACHE_TTL_MS) return cachedEntries;
  if (!pendingLoad) {
    pendingLoad = loadProductFeed(fetchImpl)
      .then((entries) => {
        cachedEntries = entries;
        cachedAt = Date.now();
        return entries;
      })
      .finally(() => {
        pendingLoad = null;
      });
  }
  return pendingLoad;
}

export async function findProductsByCode(codes: Array<string | null>, fetchImpl: typeof fetch = fetch) {
  try {
    const catalog = await getProductCatalog(fetchImpl);
    return new Map(
      codes
        .filter((code): code is string => Boolean(code))
        .map((code) => [code, catalog.get(code) ?? catalog.get(String(Number(code))) ?? null]),
    );
  } catch {
    return new Map(codes.filter((code): code is string => Boolean(code)).map((code) => [code, null]));
  }
}

export function resetProductCatalogCache() {
  cachedAt = 0;
  cachedEntries = new Map();
  pendingLoad = null;
}
