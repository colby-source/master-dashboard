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
 * GovDeals — government / educational surplus auctions.
 * Public search: https://www.govdeals.com/search?searchShortDescription=<q>
 *
 * HTML-only. Selectors were tuned against the live site but GovDeals changes
 * layout occasionally; if parsing returns nothing, re-verify selectors against
 * a current page render.
 */
export class GovDealsScraper extends HtmlEquipmentScraper {
  readonly source: ListingSource = 'govdeals';
  readonly name = 'GovDeals (government surplus auctions)';

  private readonly base = 'https://www.govdeals.com';

  async search(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const url = `${this.base}/search?searchShortDescription=${encodeURIComponent(config.query)}`;
    const $ = await this.fetchHtml(url);
    if (!$) return this.emptyResult(start, [`search page unreachable: ${url}`]);

    const listings: Listing[] = [];
    const errors: string[] = [];
    const cap = config.maxResults ?? 40;

    $('a[href*="/asset/"], a[href*="/item/"]').each((idx, el) => {
      if (listings.length >= cap) return false;
      try {
        const href = absolutize(this.base, $(el).attr('href'));
        if (!href) return;

        const card = $(el).closest('[class*="card"], article, li');
        const title = ($(el).text() || card.find('h2, h3').first().text() || '').trim();
        if (!title || title.length < 5) return;

        const text = card.text().replace(/\s+/g, ' ').trim();
        const currentBid = parseMoney(text.match(/(?:Current|High)\s+bid[^\d]*\$?([\d,]+)/i)?.[1]);
        const startingBid = parseMoney(text.match(/(?:Opening|Starting)\s+bid[^\d]*\$?([\d,]+)/i)?.[1]);
        const state = detectState(text);
        const endTimeMatch = text.match(/(Ends?|Closes?)\s+([A-Za-z0-9:,\-/ ]{6,40})/i);

        const m = href.match(/\/(?:asset|item)\/(\d+)/);
        const sourceId = m ? m[1] : href;

        listings.push({
          id: makeListingId(this.source, sourceId),
          source: this.source,
          sourceId,
          sourceUrl: href,
          title,
          description: text.substring(0, 1500),
          category: inferCategory(title, text),
          isAuction: true,
          currentBid,
          startingBid,
          auctionEndTime: endTimeMatch?.[2],
          condition: inferCondition(text),
          location: state ? { latitude: 0, longitude: 0, state } : undefined,
          seller: { isDealer: true, name: 'Government Surplus' },
          imageUrls: [],
          imageCount: 0,
          scrapedAt: new Date().toISOString(),
          rawData: { index: idx },
        });
      } catch (err) {
        errors.push(`parse: ${String(err)}`);
      }
      return undefined;
    });

    return this.finish(start, listings, errors);
  }
}
