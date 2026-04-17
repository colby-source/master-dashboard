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

interface DiscourseSearchHit {
  topics?: Array<{
    id: number;
    title: string;
    slug: string;
    posts_count: number;
    views?: number;
    last_posted_at?: string;
    created_at?: string;
    category_id?: number;
  }>;
  posts?: Array<{
    id: number;
    topic_id: number;
    topic_slug?: string;
    blurb?: string;
    username?: string;
    created_at?: string;
  }>;
}

/**
 * Future4200 is the largest cannabis extraction community forum.
 * Discourse-powered — we use the public `/search.json` endpoint.
 * Classifieds live under the "Equipment For Sale" (id 52) and related categories.
 */
export class Future4200Scraper extends HtmlEquipmentScraper {
  readonly source: ListingSource = 'future4200';
  readonly name = 'Future4200 (cannabis equipment forum)';

  private readonly base = 'https://future4200.com';
  // categories that typically contain classifieds
  private readonly classifiedCategoryIds = new Set([9, 28, 36, 37, 38, 52]);

  async search(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const errors: string[] = [];

    const q = encodeURIComponent(config.query);
    const url = `${this.base}/search.json?q=${q}&order=latest`;
    const data = await this.fetchJson<DiscourseSearchHit>(url);
    if (!data) return this.emptyResult(start, [`search unreachable: ${url}`]);

    const topics = (data.topics || []).filter((t) => !t.category_id || this.classifiedCategoryIds.has(t.category_id));
    const blurbByTopic = new Map<number, string>();
    for (const p of data.posts || []) {
      if (p.blurb && !blurbByTopic.has(p.topic_id)) blurbByTopic.set(p.topic_id, p.blurb);
    }

    const listings: Listing[] = [];
    const cap = config.maxResults ?? 30;

    for (const t of topics.slice(0, cap)) {
      try {
        const blurb = blurbByTopic.get(t.id) || '';
        const listing = this.buildListing(t, blurb);
        if (listing) listings.push(listing);
      } catch (err) {
        errors.push(`topic ${t.id}: ${String(err)}`);
      }
    }

    return this.finish(start, listings, errors);
  }

  private buildListing(
    topic: NonNullable<DiscourseSearchHit['topics']>[number],
    blurb: string,
  ): Listing | null {
    if (!topic.title) return null;
    const topicUrl = `${this.base}/t/${topic.slug}/${topic.id}`;
    const sourceId = String(topic.id);

    // Price extraction: look for "$12,500" or "Price: 12500"
    const price = parseMoney(blurb.match(/Price\/?M?S?R?P?[:\s]*\$?([\d,]+)/i)?.[1])
      ?? parseMoney(blurb.match(/\$([\d,]+(?:\.\d+)?)/)?.[1]);

    // State detection
    const state = detectState(`${topic.title} ${blurb}`);

    // isAuction: forum classifieds are private sale, not auction
    const titleLow = topic.title.toLowerCase();
    const isSold = /\bsold\b/.test(titleLow);
    const isWtb = /\bwtb\b/.test(titleLow);
    if (isWtb) return null; // buyers' wants, not sellers

    const daysOnMarket = topic.created_at
      ? Math.floor((Date.now() - new Date(topic.created_at).getTime()) / 86_400_000)
      : undefined;

    return {
      id: makeListingId(this.source, sourceId),
      source: this.source,
      sourceId,
      sourceUrl: topicUrl,
      title: topic.title,
      description: blurb.substring(0, 2000),
      category: inferCategory(topic.title, blurb),
      price: isSold ? undefined : price,
      isAuction: false,
      condition: inferCondition(blurb),
      location: state ? { latitude: 0, longitude: 0, state } : undefined,
      seller: { isDealer: false, sellerUrl: topicUrl },
      imageUrls: [],
      imageCount: 0,
      listedDate: topic.created_at,
      daysOnMarket,
      scrapedAt: new Date().toISOString(),
      rawData: { topicId: topic.id, postsCount: topic.posts_count, lastPosted: topic.last_posted_at },
    };
  }
}
