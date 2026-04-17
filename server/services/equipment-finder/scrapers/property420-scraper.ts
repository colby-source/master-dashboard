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
} from './html-base';

/**
 * 420Equipment (sister-site of 420Property) — cannabis-specific equipment marketplace.
 * Search: https://www.420equipment.com/?s=<query>
 */
export class Property420Scraper extends HtmlEquipmentScraper {
  readonly source: ListingSource = 'property420';
  readonly name = '420Equipment / 420Property';

  private readonly base = 'https://www.420equipment.com';

  async search(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const url = `${this.base}/?s=${encodeURIComponent(config.query)}`;
    const $ = await this.fetchHtml(url);
    if (!$) return this.emptyResult(start, [`search page unreachable: ${url}`]);

    const listings: Listing[] = [];
    const cap = config.maxResults ?? 30;

    $('a[href*="/listing/"], article a').each((_, el) => {
      if (listings.length >= cap) return false;
      const href = absolutize(this.base, $(el).attr('href'))?.split('?')[0];
      if (!href || !href.includes('/listing/')) return;
      const card = $(el).closest('article, li, div');
      const title = (card.find('h2, h3').first().text() || $(el).text() || '').trim();
      if (!title || title.length < 5) return;

      const text = card.text().replace(/\s+/g, ' ').trim();
      const price = parseMoney(text.match(/\$([\d,]+(?:\.\d+)?)/)?.[1]);
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
        price,
        isAuction: false,
        condition: inferCondition(text),
        location: state ? { latitude: 0, longitude: 0, state } : undefined,
        seller: { isDealer: false },
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
