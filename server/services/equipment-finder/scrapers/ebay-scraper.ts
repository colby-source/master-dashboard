import type { Listing, ListingSource } from '../types';
import type { ScraperConfig, ScraperResult } from './base';
import { createLogger } from '../../../utils/logger';
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
 * eBay scraper with two modes:
 *  1. Browse API (if EBAY_APP_ID + EBAY_CERT_ID env vars are set) — preferred.
 *  2. HTML search fallback — works without credentials but is brittle.
 */
export class EbayScraper extends HtmlEquipmentScraper {
  readonly source: ListingSource = 'ebay';
  readonly name = 'eBay';

  private readonly htmlBase = 'https://www.ebay.com';
  private readonly apiBase = 'https://api.ebay.com/buy/browse/v1';
  private readonly appId = process.env.EBAY_APP_ID;
  private readonly certId = process.env.EBAY_CERT_ID;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  async search(config: ScraperConfig): Promise<ScraperResult> {
    if (this.appId && this.certId) {
      const apiResult = await this.searchViaApi(config).catch((err) => {
        this.log.warn('eBay API failed, falling back to HTML', { error: String(err) });
        return null;
      });
      if (apiResult && apiResult.listings.length > 0) return apiResult;
    }
    return this.searchViaHtml(config);
  }

  // ---------- Browse API ----------
  private async searchViaApi(config: ScraperConfig): Promise<ScraperResult | null> {
    const start = Date.now();
    const token = await this.ensureToken();
    if (!token) return null;

    const params = new URLSearchParams({
      q: config.query,
      limit: String(Math.min(config.maxResults ?? 50, 100)),
    });
    if (config.priceMin || config.priceMax) {
      const minP = config.priceMin ?? 0;
      const maxP = config.priceMax ?? 999999;
      params.set('filter', `price:[${minP}..${maxP}],priceCurrency:USD`);
    }

    const url = `${this.apiBase}/item_summary/search?${params}`;
    const data = await this.fetchJson<{ itemSummaries?: EbayItem[] }>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });
    if (!data) return null;

    const items = data.itemSummaries || [];
    const listings = items.map((it) => this.buildFromApi(it)).filter((x): x is Listing => x !== null);
    return this.finish(start, listings);
  }

  private async ensureToken(): Promise<string | null> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) return this.cachedToken.value;
    if (!this.appId || !this.certId) return null;

    const auth = Buffer.from(`${this.appId}:${this.certId}`).toString('base64');
    const res = await this.fetchRaw('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    });
    if (!res || res.status !== 200) return null;
    const body: any = res.data;
    const token = body?.access_token;
    if (!token) return null;
    this.cachedToken = { value: token, expiresAt: now + (body.expires_in ?? 7200) * 1000 };
    return token;
  }

  private buildFromApi(it: EbayItem): Listing | null {
    if (!it?.itemId || !it?.title) return null;
    const price = parseMoney(it.price?.value);
    const buyNow = it.buyingOptions?.includes('FIXED_PRICE') ? price : undefined;
    const isAuction = !!it.buyingOptions?.includes('AUCTION');
    const bid = isAuction ? price : undefined;
    const state = detectState(it.itemLocation?.country === 'US' ? `${it.itemLocation?.postalCode ?? ''}` : '') ?? undefined;

    return {
      id: makeListingId(this.source, it.itemId),
      source: this.source,
      sourceId: it.itemId,
      sourceUrl: it.itemWebUrl || `https://www.ebay.com/itm/${it.itemId}`,
      title: it.title,
      description: it.shortDescription || it.title,
      category: inferCategory(it.title, it.shortDescription || ''),
      price: buyNow,
      isAuction,
      currentBid: bid,
      buyNowPrice: buyNow,
      auctionEndTime: it.itemEndDate,
      condition: mapEbayCondition(it.condition),
      location: state ? { latitude: 0, longitude: 0, state, zipCode: it.itemLocation?.postalCode } : undefined,
      seller: {
        name: it.seller?.username,
        isDealer: (it.seller?.feedbackScore ?? 0) > 100,
      },
      imageUrls: it.image?.imageUrl ? [it.image.imageUrl] : [],
      imageCount: it.image?.imageUrl ? 1 : 0,
      scrapedAt: new Date().toISOString(),
      rawData: it as any,
    };
  }

  // ---------- HTML fallback ----------
  private async searchViaHtml(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const url = `${this.htmlBase}/sch/i.html?_nkw=${encodeURIComponent(config.query)}&_sop=15`;
    const $ = await this.fetchHtml(url);
    if (!$) return this.emptyResult(start, [`html page unreachable: ${url}`]);

    const listings: Listing[] = [];
    const errors: string[] = [];
    const cap = config.maxResults ?? 40;

    $('a[href*="/itm/"]').each((_, el) => {
      if (listings.length >= cap) return false;
      const href = absolutize(this.htmlBase, $(el).attr('href'))?.split('?')[0];
      if (!href) return;
      const card = $(el).closest('li, div');
      const title = (card.find('[role="heading"], h3').first().text() || $(el).text() || '').trim();
      if (!title || title.length < 5 || /shop on ebay/i.test(title)) return;

      const text = card.text().replace(/\s+/g, ' ').trim();
      const price = parseMoney(text.match(/\$([\d,]+(?:\.\d+)?)/)?.[1]);

      const itemIdMatch = href.match(/\/itm\/(\d+)/);
      const sourceId = itemIdMatch?.[1] || href;

      listings.push({
        id: makeListingId(this.source, sourceId),
        source: this.source,
        sourceId,
        sourceUrl: href,
        title,
        description: text.substring(0, 1000),
        category: inferCategory(title, text),
        price,
        isAuction: /bid/i.test(text),
        currentBid: /bid/i.test(text) ? price : undefined,
        buyNowPrice: /buy it now/i.test(text) ? price : undefined,
        condition: inferCondition(text),
        seller: { isDealer: false },
        imageUrls: [],
        imageCount: 0,
        scrapedAt: new Date().toISOString(),
        rawData: { via: 'html' },
      });
      return undefined;
    });

    return this.finish(start, listings, errors);
  }
}

interface EbayItem {
  itemId: string;
  title: string;
  shortDescription?: string;
  price?: { value: string; currency: string };
  itemWebUrl?: string;
  buyingOptions?: string[];
  itemEndDate?: string;
  condition?: string;
  itemLocation?: { country?: string; postalCode?: string };
  seller?: { username?: string; feedbackScore?: number };
  image?: { imageUrl: string };
}

function mapEbayCondition(v?: string): Listing['condition'] {
  if (!v) return 'unknown';
  const l = v.toLowerCase();
  if (l.includes('new')) return 'new';
  if (l.includes('refurbished')) return 'like_new';
  if (l.includes('excellent')) return 'excellent';
  if (l.includes('good')) return 'good';
  if (l.includes('fair')) return 'fair';
  if (l.includes('parts')) return 'parts_only';
  return 'unknown';
}

const _log = createLogger('ebay-scraper');
