import { beforeEach, describe, expect, it } from 'vitest';
import {
  findProductsByCode,
  parseProductFeed,
  resetProductCatalogCache,
} from '../src/modules/catalog/productCatalogService.js';

const feed = `<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel><item>
  <g:title>ПЕЧЕНЬЕ СЕКРЕТ Милки Вей</g:title>
  <g:link>https://milku.ru/product/1032/</g:link>
  <g:id>0955</g:id>
  <g:image_link>https://milku.ru/storage/photo/original/c/qgr90bmcr0sql53.png</g:image_link>
  <g:gtin>5056357904923</g:gtin>
</item></channel></rss>`;

describe('milku.ru product feed', () => {
  beforeEach(resetProductCatalogCache);

  it('maps product codes to trusted images and keeps leading zeroes', () => {
    const entries = parseProductFeed(feed);
    expect(entries.get('0955')).toMatchObject({
      code: '0955',
      imageUrl: 'https://milku.ru/storage/photo/original/c/qgr90bmcr0sql53.png',
    });
    expect(entries.get('955')).toEqual(entries.get('0955'));
  });

  it('ignores image hosts outside milku.ru', () => {
    expect(
      parseProductFeed(feed.replace('https://milku.ru/storage', 'https://example.com/storage')).size,
    ).toBe(0);
  });

  it('returns only requested product entries', async () => {
    const fetchImpl = (async () => new Response(feed, { status: 200 })) as typeof fetch;
    const products = await findProductsByCode(['0955', '0000'], fetchImpl);
    expect(products.get('0955')?.gtin).toBe('5056357904923');
    expect(products.get('0000')).toBeNull();
  });
});
