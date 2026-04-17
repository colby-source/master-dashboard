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
 * BigIron — unreserved online farm & industrial auctions.
 * Search: https://www.bigiron.com/Search?q=<query>
 */
export class BigIronScraper extends HtmlEquipmentScraper {
  readonly source: ListingSource = 'bigiron';
  readonly name = 'BigIron';

  private readonly base = 'https://www.bigiron.com';

  async search(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const url = `${this.base}/Search?q=${encodeURIComponent(config.query)}`;
    const $ = await this.fetchHtml(url);
    if (!$) return this.emptyResult(start, [`search page unreachable: ${url}`]);

    const listings: Listing[] = [];
    const cap = config.maxResults ?? 40;

    $('a[href*="/lot/"], a[href*="/Detail/"]').each((_, el) => {
      if (listings.length >= cap) return false;
      const href = absolutize(this.base, $(el).attr('href'))?.split('?')[0];
      if (!href) return;
      const card = $(el).closest('article, li, div');
      const title = (card.find('h2, h3').first().text() || $(el).text() || '').trim();
      if (!title || title.length < 5) return;

      const text = card.text().replace(/\s+/g, ' ').trim();
      const currentBid = parseMoney(text.match(/Current bid[^\d]*\$?([\d,]+)/i)?.[1]);
      const state = detectState(text);
      const sourceId = href.replace(/^.*\/(?:lot|Detail)\//, '').replace(/\/.*/, '') || href;

      listings.push({
        id: makeListingId(this.source, sourceId),
        source: this.source,
        sourceId,
        sourceUrl: href,
        title,
        description: text.substring(0, 1000),
        category: inferCategory(title, text),
        year: parseYear(text),
        isAuction: true,
        currentBid,
        condition: inferCondition(text),
        location: state ? { latitude: 0, longitude: 0, state } : undefined,
        seller: { isDealer: true, name: 'BigIron' },
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
