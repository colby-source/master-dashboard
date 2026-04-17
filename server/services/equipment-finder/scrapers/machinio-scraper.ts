import type { Listing, ListingSource } from '../types';
import type { ScraperConfig, ScraperResult } from './base';
import {
  HtmlEquipmentScraper,
  absolutize,
  detectState,
  inferCategory,
  inferCondition,
  makeListingId,
  parseMoney,
  parseYear,
} from './html-base';

/**
 * Machinio aggregates industrial & lab equipment dealer listings.
 * Search: https://www.machinio.com/search?q=<query>
 */
export class MachinioScraper extends HtmlEquipmentScraper {
  readonly source: ListingSource = 'machinio';
  readonly name = 'Machinio';

  private readonly base = 'https://www.machinio.com';

  async search(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const url = `${this.base}/search?q=${encodeURIComponent(config.query)}`;
    const $ = await this.fetchHtml(url);
    if (!$) return this.emptyResult(start, [`search page unreachable: ${url}`]);

    const listings: Listing[] = [];
    const cap = config.maxResults ?? 40;

    $('a[href*="/listing/"], a[href*="/listings/"]').each((_, el) => {
      if (listings.length >= cap) return false;
      const href = absolutize(this.base, $(el).attr('href'))?.split('?')[0];
      if (!href) return;
      const card = $(el).closest('article, li, div[class*="listing"], div[class*="result"]');
      const title = (card.find('h2, h3').first().text() || $(el).text() || '').trim();
      if (!title || title.length < 5) return;

      const text = card.text().replace(/\s+/g, ' ').trim();
      const price = parseMoney(text.match(/(?:USD|US\$|\$)\s*([\d,]+)/)?.[1]);
      const state = detectState(text);
      const sourceId = href.replace(/^.*\/listing(?:s)?\//, '').replace(/\/.*/, '') || href;

      listings.push({
        id: makeListingId(this.source, sourceId),
        source: this.source,
        sourceId,
        sourceUrl: href,
        title,
        description: text.substring(0, 1000),
        category: inferCategory(title, text),
        year: parseYear(text),
        price,
        isAuction: false,
        condition: inferCondition(text),
        location: state ? { latitude: 0, longitude: 0, state } : undefined,
        seller: { isDealer: true },
        imageUrls: [],
        imageCount: 0,
        scrapedAt: new Date().toISOString(),
        rawData: { via: 'html' },
      });
      return undefined;
    });

    return this.finish(start, listings);
  }
}
