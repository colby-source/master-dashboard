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
 * Scraper for Bidspotter.com — the platform behind A2C Auctions, Aaron Industrial
 * Solutions, and Heritage Global Partners cannabis/lab auctions.
 *
 * Strategy: hit the site-wide lot search (`/en-us/search/lots?q=…`), then walk
 * each lot detail page for structured bid + location data.
 */
export class BidspotterScraper extends HtmlEquipmentScraper {
  readonly source: ListingSource = 'bidspotter';
  readonly name = 'Bidspotter (A2C / Aaron / Heritage Global)';

  private readonly base = 'https://www.bidspotter.com';

  async search(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const errors: string[] = [];

    const searchUrl = `${this.base}/en-us/search/lots?q=${encodeURIComponent(config.query)}`;
    const $list = await this.fetchHtml(searchUrl);
    if (!$list) return this.emptyResult(start, [`search page unreachable: ${searchUrl}`]);

    const lotLinks = new Set<string>();
    $list('a[href*="/lot-"]').each((_, el) => {
      const href = $list(el).attr('href');
      const abs = absolutize(this.base, href);
      if (abs && /\/lot-[a-f0-9-]{8,}/.test(abs)) lotLinks.add(abs.split('?')[0]);
    });

    const maxLots = Math.min(config.maxResults ?? 60, lotLinks.size);
    const urls = [...lotLinks].slice(0, maxLots);
    const listings: Listing[] = [];

    // sequential to keep the site happy; can batch later
    for (const url of urls) {
      try {
        const listing = await this.parseLotPage(url);
        if (listing) listings.push(listing);
      } catch (err) {
        errors.push(`lot ${url}: ${String(err)}`);
      }
    }

    return this.finish(start, listings, errors);
  }

  private async parseLotPage(url: string): Promise<Listing | null> {
    const $ = await this.fetchHtml(url);
    if (!$) return null;

    const title = ($('h1').first().text() || $('title').text() || '').trim();
    if (!title || title.length < 5) return null;

    const body = $('body').text().replace(/\s+/g, ' ').trim();

    // Lot number (usually "LOT 038A")
    const lotNumber = body.match(/\bLOT\s+([0-9A-Z]+)\b/)?.[1];

    // Location (e.g. "Lot Location: Menifee, California")
    const locMatch = body.match(/Lot Location[:\s]+([A-Za-z .'-]+),\s*([A-Za-z ]+)/);
    const city = locMatch?.[1]?.trim();
    const stateFull = locMatch?.[2]?.trim();
    const state = stateFull ? detectState(stateFull) : detectState(body);

    // Bid data
    const currentBid = parseMoney(body.match(/Current bid[^\d]*\$?([\d,]+)/)?.[1]);
    const startingBid = parseMoney(body.match(/(?:Starting|Opening) bid[^\d]*\$?([\d,]+)/)?.[1]);
    const buyerPremiumPct = parseMoney(body.match(/Buyer's premium\s*([\d.]+)%/)?.[1]);

    // End / open times
    const biddingOpens = body.match(/Bidding opens[:\s]+([A-Z][a-z]{2} \d{1,2},? \d{4}[^A-Za-z]*[\dapmAPM: ]+[A-Z]{2,3})/)?.[1];
    const ends = body.match(/Ends?(?:\s*from)?[:\s]+([A-Z][a-z]{2} \d{1,2},? \d{4}[^A-Za-z]*[\dapmAPM: ]+[A-Z]{2,3})/)?.[1];

    // Auctioneer — e.g. "A2C Auctions", "Heritage Global Partners"
    const auctioneer = $('*:contains("Auctioneer:")').last().next().text().trim()
      || body.match(/Auctioneer[:\s]+([A-Z][A-Za-z &]+)/)?.[1];

    // description block
    const desc =
      $('[class*="description"]').text().trim().substring(0, 2000) ||
      body.substring(0, 2000);

    const imgs: string[] = [];
    $('img[src]').each((_, el) => {
      const src = absolutize(this.base, $(el).attr('src'));
      if (src && /bidspotter|auction|catalogue|lot/i.test(src) && !imgs.includes(src)) imgs.push(src);
    });

    const sourceId = url.replace(/^.*\/lot-/, 'lot-').split('?')[0];

    return {
      id: makeListingId(this.source, sourceId),
      source: this.source,
      sourceId,
      sourceUrl: url,
      title,
      description: desc,
      category: inferCategory(title, desc),
      price: undefined,
      isAuction: true,
      auctionEndTime: ends ? safeIso(ends) : undefined,
      biddingOpensAt: biddingOpens ? safeIso(biddingOpens) : undefined,
      currentBid,
      startingBid,
      buyerPremiumPct,
      lotNumber,
      auctionHouse: auctioneer?.trim() || undefined,
      condition: inferCondition(desc),
      location:
        city || state
          ? { latitude: 0, longitude: 0, city, state }
          : undefined,
      seller: auctioneer ? { name: auctioneer.trim(), isDealer: true } : { isDealer: true },
      imageUrls: imgs.slice(0, 10),
      imageCount: imgs.length,
      scrapedAt: new Date().toISOString(),
      rawData: { url },
    };
  }
}

function safeIso(text: string): string | undefined {
  const cleaned = text.replace(/CT|CST|CDT/, 'GMT-0500').replace(/ET|EST|EDT/, 'GMT-0400').replace(/PT|PST|PDT/, 'GMT-0800').replace(/MT|MST|MDT/, 'GMT-0700');
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
