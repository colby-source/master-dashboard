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
 * IronPlanet (Ritchie Bros subsidiary) — online heavy-equipment auctions.
 * Search: https://www.ironplanet.com/search?q=<query>
 */
export class IronPlanetScraper extends HtmlEquipmentScraper {
  readonly source: ListingSource = 'iron_planet';
  readonly name = 'IronPlanet';

  private readonly base = 'https://www.ironplanet.com';

  async search(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const url = `${this.base}/search?q=${encodeURIComponent(config.query)}`;
    const $ = await this.fetchHtml(url);
    if (!$) return this.emptyResult(start, [`search page unreachable: ${url}`]);

    const listings: Listing[] = [];
    const cap = config.maxResults ?? 40;

    $('a[href*="/Equipment/"], a[href*="/lot/"]').each((_, el) => {
      if (listings.length >= cap) return false;
      const href = absolutize(this.base, $(el).attr('href'))?.split('?')[0];
      if (!href) return;
      const card = $(el).closest('article, li, div[class*="lot"], div[class*="result"]');
      const title = (card.find('h2, h3').first().text() || $(el).text() || '').trim();
      if (!title || title.length < 5) return;

      const text = card.text().replace(/\s+/g, ' ').trim();
      const currentBid = parseMoney(text.match(/(?:Current|High)\s+bid[^\d]*\$?([\d,]+)/i)?.[1]);
      const state = detectState(text);
      const endMatch = text.match(/(Ends?|Closes?)\s+([A-Za-z0-9:,\-/ ]{6,50})/i);
      const sourceId = href.replace(/^.*\/(?:Equipment|lot)\//, '').replace(/\/.*/, '') || href;

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
        auctionEndTime: endMatch?.[2],
        condition: inferCondition(text),
        location: state ? { latitude: 0, longitude: 0, state } : undefined,
        seller: { isDealer: true, name: 'IronPlanet' },
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
