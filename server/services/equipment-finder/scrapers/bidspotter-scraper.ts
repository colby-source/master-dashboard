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
import { playwrightFetcher } from './playwright-fetcher';

/**
 * Scraper for Bidspotter.com — the platform behind A2C Auctions, Aaron Industrial
 * Solutions, and Heritage Global Partners cannabis/lab auctions.
 *
 * Bidspotter's site-wide `/en-us/search/lots` endpoint actively blocks
 * non-browser clients (ECONNRESET), but individual catalog pages render fine.
 *
 * Strategy:
 *   1. Discover current A2C catalog via a2cauctions.com homepage.
 *   2. Walk the catalog listing page — it exposes all lots inline.
 *   3. Filter lot titles by query tokens locally.
 *   4. Visit each matching lot for bid / location details.
 */
export class BidspotterScraper extends HtmlEquipmentScraper {
  readonly source: ListingSource = 'bidspotter';
  readonly name = 'Bidspotter (A2C / Aaron / Heritage Global)';

  private readonly bidspotterBase = 'https://www.bidspotter.com';
  // Known consignor landing pages — each exposes their current catalog link.
  private readonly consignorPages = [
    'https://www.a2cauctions.com/',
    'https://www.a2cequipmentsolutions.com/',
  ];

  async search(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const errors: string[] = [];
    const tokens = tokenize(config.query);
    const catalogUrls = new Set<string>();

    // Phase 1: discover current catalog URLs via consignor homepages
    for (const home of this.consignorPages) {
      const $home = await this.fetchHtml(home);
      if (!$home) continue;
      $home('a[href*="catalogue-id"]').each((_, el) => {
        const href = absolutize(this.bidspotterBase, $home(el).attr('href'));
        if (href && /\/catalogue-id-[a-z0-9-]+/.test(href) && !href.includes('/lot-')) {
          catalogUrls.add(href.split('?')[0]);
        }
      });
    }

    if (catalogUrls.size === 0) {
      return this.emptyResult(start, ['no active consignor catalogs discovered']);
    }

    // Phase 2: walk each catalog page via headless Chrome.
    // Bidspotter blocks raw axios with ECONNRESET; a real browser works.
    const matchingLots: { url: string; title: string }[] = [];
    for (const catalogUrl of catalogUrls) {
      const $cat = await playwrightFetcher.fetchHtml(catalogUrl, {
        waitForSelector: 'a[href*="/lot-"]',
        timeoutMs: 30_000,
      });
      if (!$cat) {
        errors.push(`catalog page unreachable: ${catalogUrl}`);
        continue;
      }
      $cat('a[href*="/lot-"]').each((_, el) => {
        const href = absolutize(this.bidspotterBase, $cat(el).attr('href'))?.split('?')[0];
        if (!href || !/\/lot-[a-f0-9-]{8,}/.test(href)) return;
        const title = ($cat(el).text() || '').trim();
        if (title.length < 5) return;
        if (!queryMatches(title, tokens)) return;
        matchingLots.push({ url: href, title });
      });
    }

    // Phase 3: fetch lot details via headless Chrome (same bot-block)
    const cap = Math.min(config.maxResults ?? 40, matchingLots.length);
    const listings: Listing[] = [];
    for (const { url } of matchingLots.slice(0, cap)) {
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
    const $ = await playwrightFetcher.fetchHtml(url, { timeoutMs: 20_000 });
    if (!$) return null;

    const title = ($('h1').first().text() || $('title').text() || '').trim();
    if (!title || title.length < 5) return null;

    const body = $('body').text().replace(/\s+/g, ' ').trim();

    const lotNumber = body.match(/\bLOT\s+([0-9A-Z]+)\b/)?.[1];

    const locMatch = body.match(/Lot Location[:\s]+([A-Za-z .'-]+),\s*([A-Za-z ]+)/);
    const city = locMatch?.[1]?.trim();
    const stateFull = locMatch?.[2]?.trim();
    const state = stateFull ? detectState(stateFull) : detectState(body);

    const currentBid = parseMoney(body.match(/Current bid[^\d]*\$?([\d,]+)/)?.[1]);
    const startingBid = parseMoney(body.match(/(?:Starting|Opening) bid[^\d]*\$?([\d,]+)/)?.[1]);
    const buyerPremiumPct = parseMoney(body.match(/Buyer's premium\s*([\d.]+)%/)?.[1]);

    const biddingOpens = body.match(
      /Bidding opens[:\s]+([A-Z][a-z]{2} \d{1,2},? \d{4}[^A-Za-z]*[\dapmAPM: ]+[A-Z]{2,3})/,
    )?.[1];
    const ends = body.match(
      /Ends?(?:\s*from)?[:\s]+([A-Z][a-z]{2} \d{1,2},? \d{4}[^A-Za-z]*[\dapmAPM: ]+[A-Z]{2,3})/,
    )?.[1];

    const auctioneer =
      $('*:contains("Auctioneer:")').last().next().text().trim() ||
      body.match(/Auctioneer[:\s]+([A-Z][A-Za-z &]+)/)?.[1];

    const desc =
      $('[class*="description"]').text().trim().substring(0, 2000) || body.substring(0, 2000);

    const imgs: string[] = [];
    $('img[src]').each((_, el) => {
      const src = absolutize(this.bidspotterBase, $(el).attr('src'));
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
        city || state ? { latitude: 0, longitude: 0, city, state } : undefined,
      seller: auctioneer ? { name: auctioneer.trim(), isDealer: true } : { isDealer: true },
      imageUrls: imgs.slice(0, 10),
      imageCount: imgs.length,
      scrapedAt: new Date().toISOString(),
      rawData: { url },
    };
  }
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length >= 3);
}

function queryMatches(title: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const lower = title.toLowerCase();
  // require at least one token hit — catalogs are already niche (cannabis/lab)
  return tokens.some((t) => lower.includes(t));
}

function safeIso(text: string): string | undefined {
  const cleaned = text
    .replace(/CT|CST|CDT/, 'GMT-0500')
    .replace(/ET|EST|EDT/, 'GMT-0400')
    .replace(/PT|PST|PDT/, 'GMT-0800')
    .replace(/MT|MST|MDT/, 'GMT-0700');
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
