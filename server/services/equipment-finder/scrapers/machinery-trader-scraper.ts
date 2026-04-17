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
 * MachineryTrader — dealer network for heavy equipment.
 * Search: https://www.machinerytrader.com/search?keyword=<query>
 */
export class MachineryTraderScraper extends HtmlEquipmentScraper {
  readonly source: ListingSource = 'machinery_trader';
  readonly name = 'MachineryTrader';

  private readonly base = 'https://www.machinerytrader.com';

  async search(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const url = `${this.base}/listings/search?Keyword=${encodeURIComponent(config.query)}`;
    const $ = await this.fetchHtml(url);
    if (!$) return this.emptyResult(start, [`search page unreachable: ${url}`]);

    const listings: Listing[] = [];
    const cap = config.maxResults ?? 40;

    $('a[href*="/listing/"]').each((_, el) => {
      if (listings.length >= cap) return false;
      const href = absolutize(this.base, $(el).attr('href'))?.split('?')[0];
      if (!href) return;
      const card = $(el).closest('article, li, div');
      const title = (card.find('h2, h3').first().text() || $(el).text() || '').trim();
      if (!title || title.length < 5) return;

      const text = card.text().replace(/\s+/g, ' ').trim();
      const price = parseMoney(text.match(/\$([\d,]+(?:\.\d+)?)/)?.[1]);
      const hours = parseMoney(text.match(/([\d,]+)\s*(?:hrs|hours)/i)?.[1]);
      const state = detectState(text);
      const sourceId = href.replace(/^.*\/listing\//, '').replace(/\/.*/, '') || href;

      listings.push({
        id: makeListingId(this.source, sourceId),
        source: this.source,
        sourceId,
        sourceUrl: href,
        title,
        description: text.substring(0, 1000),
        category: inferCategory(title, text),
        year: parseYear(text),
        hours,
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
