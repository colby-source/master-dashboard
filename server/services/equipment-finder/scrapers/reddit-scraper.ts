import type { Listing, ListingSource } from '../types';
import type { ScraperConfig, ScraperResult } from './base';
import {
  HtmlEquipmentScraper,
  detectState,
  inferCategory,
  inferCondition,
  makeListingId,
  parseMoney,
} from './html-base';

/**
 * Reddit — free public JSON endpoint at /search.json.
 * Targets subreddits where equipment gets flipped or liquidation-posted.
 */
export class RedditScraper extends HtmlEquipmentScraper {
  readonly source: ListingSource = 'reddit';
  readonly name = 'Reddit';

  private readonly base = 'https://www.reddit.com';
  private readonly subreddits = [
    'r/HeavyEquipment',
    'r/skidsteer',
    'r/forklifts',
    'r/SmallBusiness',
    'r/CannabisExtracts',
    'r/labrats',
  ];

  async search(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const errors: string[] = [];
    const listings: Listing[] = [];
    const cap = config.maxResults ?? 40;

    const q = `${encodeURIComponent(config.query)}+(for+sale+OR+selling+OR+fs)`;
    const url = `${this.base}/search.json?q=${q}&sort=new&limit=50`;
    const data = await this.fetchJson<RedditSearchResponse>(url, {
      headers: { 'User-Agent': this.userAgent },
    });
    if (!data?.data?.children) return this.emptyResult(start, [`no reddit data for ${url}`]);

    for (const child of data.data.children) {
      if (listings.length >= cap) break;
      const post = child.data;
      if (!post?.title) continue;

      const text = `${post.title} ${post.selftext || ''}`;
      // Skip discussion / WTB posts
      if (/\bwtb\b|\bwant to buy\b|\bquestion\b/i.test(post.title)) continue;

      const price = parseMoney(text.match(/\$([\d,]+(?:\.\d+)?)/)?.[1]);
      const state = detectState(text);

      listings.push({
        id: makeListingId(this.source, String(post.id)),
        source: this.source,
        sourceId: String(post.id),
        sourceUrl: post.url || `${this.base}${post.permalink}`,
        title: post.title,
        description: (post.selftext || '').substring(0, 1500),
        category: inferCategory(post.title, post.selftext || ''),
        price,
        isAuction: false,
        condition: inferCondition(text),
        location: state ? { latitude: 0, longitude: 0, state } : undefined,
        seller: { isDealer: false, name: post.author, sellerUrl: `${this.base}/u/${post.author}` },
        imageUrls: [],
        imageCount: 0,
        listedDate: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
        daysOnMarket: post.created_utc ? Math.floor((Date.now() / 1000 - post.created_utc) / 86_400) : undefined,
        scrapedAt: new Date().toISOString(),
        rawData: { subreddit: post.subreddit, score: post.score },
      });
    }

    return this.finish(start, listings, errors);
  }
}

interface RedditSearchResponse {
  data?: {
    children?: Array<{
      data?: {
        id: string;
        title: string;
        selftext?: string;
        url?: string;
        permalink?: string;
        author?: string;
        subreddit?: string;
        score?: number;
        created_utc?: number;
      };
    }>;
  };
}
