import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { getDb, queryAll, queryOne, runSql, saveDb } from '../db';
import { createLogger } from '../utils/logger';
const log = createLogger('ad-library-service');

// ── Types ──────────────────────────────────────────────────────

export interface AdLibraryAd {
  id: string;
  page_id: string;
  page_name: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_captions?: string[];
  ad_creative_link_descriptions?: string[];
  ad_snapshot_url?: string;
  ad_creation_time?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  publisher_platforms?: string[];
  languages?: string[];
  currency?: string;
  funding_entity?: string;
  impressions?: { lower_bound: string; upper_bound: string };
  spend?: { lower_bound: string; upper_bound: string };
}

export interface CompetitorAd {
  id: number;
  ad_library_id: string;
  page_id: string;
  page_name: string;
  creative_body: string | null;
  creative_link_title: string | null;
  creative_link_description: string | null;
  snapshot_url: string | null;
  platforms: string | null;
  delivery_start: string | null;
  delivery_stop: string | null;
  days_active: number;
  winner_score: number;
  analysis_json: string | null;
  search_term: string;
  scraped_image_url: string | null;
  created_at: string;
}

export interface SearchParams {
  search_terms: string;
  ad_reached_countries?: string[];
  ad_type?: string;
  ad_active_status?: string;
  limit?: number;
  media_type?: string;
  publisher_platforms?: string[];
  search_type?: string;
}

// ── Default search terms for real estate fund competitor discovery ──

export const DEFAULT_SEARCH_TERMS = [
  'real estate fund',
  'real estate investment fund',
  'accredited investor real estate',
  'preferred return real estate',
  'build to rent investment',
  'affordable housing fund',
  'private equity real estate',
  '1031 exchange fund',
  'multifamily investment fund',
  'real estate syndication',
  'passive real estate income',
  'section 8 investment',
  'LIHTC investment',
  'real estate LP fund',
  'real estate limited partnership',
];

// ── Ad Library API fields ──

const AD_LIBRARY_FIELDS = [
  'id',
  'ad_creation_time',
  'ad_creative_bodies',
  'ad_creative_link_captions',
  'ad_creative_link_descriptions',
  'ad_creative_link_titles',
  'ad_delivery_start_time',
  'ad_delivery_stop_time',
  'ad_snapshot_url',
  'currency',
  'funding_entity',
  'impressions',
  'languages',
  'page_id',
  'page_name',
  'publisher_platforms',
  'spend',
].join(',');

class AdLibraryService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.metaBaseUrl,
      timeout: 30000,
    });
  }

  get available(): boolean {
    return !!config.metaAccessToken;
  }

  // ── Search Ad Library ───────────────────────────────────────

  async searchAds(params: SearchParams): Promise<AdLibraryAd[]> {
    if (!this.available) throw new Error('Meta access token not configured');

    const queryParams: Record<string, any> = {
      access_token: config.metaAccessToken,
      search_terms: params.search_terms,
      ad_reached_countries: JSON.stringify(params.ad_reached_countries || ['US']),
      ad_type: params.ad_type || 'ALL',
      fields: AD_LIBRARY_FIELDS,
      limit: params.limit || 50,
    };

    if (params.ad_active_status) queryParams.ad_active_status = params.ad_active_status;
    if (params.media_type) queryParams.media_type = params.media_type;
    if (params.search_type) queryParams.search_type = params.search_type;
    if (params.publisher_platforms) {
      queryParams.publisher_platforms = JSON.stringify(params.publisher_platforms);
    }

    try {
      const { data } = await this.client.get('/ads_archive', { params: queryParams });
      return data?.data ?? [];
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      log.error('[AdLibrary] searchAds error:', msg);
      throw new Error(`Ad Library search failed: ${msg}`, { cause: err });
    }
  }

  // ── Paginated search (follows cursor) ───────────────────────

  async searchAdsPaginated(params: SearchParams, maxPages = 5): Promise<AdLibraryAd[]> {
    if (!this.available) throw new Error('Meta access token not configured');

    const allAds: AdLibraryAd[] = [];
    let nextUrl: string | null = null;
    let page = 0;

    const queryParams: Record<string, any> = {
      access_token: config.metaAccessToken,
      search_terms: params.search_terms,
      ad_reached_countries: JSON.stringify(params.ad_reached_countries || ['US']),
      ad_type: params.ad_type || 'ALL',
      fields: AD_LIBRARY_FIELDS,
      limit: Math.min(params.limit || 50, 50),
    };

    if (params.ad_active_status) queryParams.ad_active_status = params.ad_active_status;
    if (params.search_type) queryParams.search_type = params.search_type;

    while (page < maxPages) {
      try {
        const response: any = nextUrl
          ? await axios.get(nextUrl, { timeout: 30000 })
          : await this.client.get('/ads_archive', { params: queryParams });

        const ads = response.data?.data ?? [];
        allAds.push(...ads);

        nextUrl = response.data?.paging?.next ?? null;
        if (!nextUrl || ads.length === 0) break;
        page++;
      } catch (err: any) {
        log.error('[AdLibrary] pagination error:', err.response?.data?.error?.message || err.message);
        break;
      }
    }

    return allAds;
  }

  // ── Search by page IDs (monitor specific competitors) ───────

  async searchByPageIds(pageIds: string[], limit = 50): Promise<AdLibraryAd[]> {
    if (!this.available) throw new Error('Meta access token not configured');

    try {
      const { data } = await this.client.get('/ads_archive', {
        params: {
          access_token: config.metaAccessToken,
          search_page_ids: JSON.stringify(pageIds.slice(0, 10)), // Max 10 page IDs
          ad_reached_countries: JSON.stringify(['US']),
          ad_type: 'ALL',
          fields: AD_LIBRARY_FIELDS,
          limit,
        },
      });
      return data?.data ?? [];
    } catch (err: any) {
      log.error('[AdLibrary] searchByPageIds error:', err.response?.data?.error?.message || err.message);
      throw new Error(`Page search failed: ${err.response?.data?.error?.message || err.message}`, { cause: err });
    }
  }

  // ── Store ads in database ───────────────────────────────────

  async storeAds(ads: AdLibraryAd[], searchTerm: string): Promise<number> {
    await getDb();
    let stored = 0;

    for (const ad of ads) {
      const existing = queryOne(
        'SELECT id FROM competitor_ads WHERE ad_library_id = ?',
        [ad.id]
      );

      const body = ad.ad_creative_bodies?.join('\n') || null;
      const title = ad.ad_creative_link_titles?.join(' | ') || null;
      const desc = ad.ad_creative_link_descriptions?.join(' | ') || null;
      const platforms = ad.publisher_platforms?.join(',') || null;
      const deliveryStart = ad.ad_delivery_start_time || null;
      const deliveryStop = ad.ad_delivery_stop_time || null;

      // Calculate days active
      const startDate = deliveryStart ? new Date(deliveryStart) : null;
      const endDate = deliveryStop ? new Date(deliveryStop) : new Date();
      const daysActive = startDate
        ? Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      if (existing) {
        // Update existing record
        runSql(
          `UPDATE competitor_ads SET
            creative_body = ?, creative_link_title = ?, creative_link_description = ?,
            snapshot_url = ?, platforms = ?, delivery_start = ?, delivery_stop = ?,
            days_active = ?, updated_at = datetime('now')
          WHERE ad_library_id = ?`,
          [body, title, desc, ad.ad_snapshot_url || null, platforms, deliveryStart, deliveryStop, daysActive, ad.id]
        );
      } else {
        runSql(
          `INSERT INTO competitor_ads (
            ad_library_id, page_id, page_name, creative_body, creative_link_title,
            creative_link_description, snapshot_url, platforms, delivery_start,
            delivery_stop, days_active, search_term
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ad.id, ad.page_id, ad.page_name, body, title, desc,
            ad.ad_snapshot_url || null, platforms, deliveryStart, deliveryStop,
            daysActive, searchTerm,
          ]
        );
        stored++;
      }
    }

    saveDb();
    return stored;
  }

  // ── Query stored ads ────────────────────────────────────────

  getStoredAds(opts: {
    limit?: number;
    offset?: number;
    sortBy?: string;
    searchTerm?: string;
    minScore?: number;
    activeOnly?: boolean;
  } = {}): { ads: CompetitorAd[]; total: number } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (opts.searchTerm) {
      conditions.push('search_term = ?');
      params.push(opts.searchTerm);
    }
    if (opts.minScore !== undefined) {
      conditions.push('winner_score >= ?');
      params.push(opts.minScore);
    }
    if (opts.activeOnly) {
      conditions.push('delivery_stop IS NULL');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortCol = opts.sortBy || 'winner_score';
    const validSorts = ['winner_score', 'days_active', 'created_at', 'page_name'];
    const sort = validSorts.includes(sortCol) ? sortCol : 'winner_score';

    const total = queryOne(`SELECT COUNT(*) as count FROM competitor_ads ${where}`, params)?.count || 0;

    const limit = opts.limit || 50;
    const offset = opts.offset || 0;
    const ads = queryAll(
      `SELECT * FROM competitor_ads ${where} ORDER BY ${sort} DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { ads, total };
  }

  // ── Get competitor pages (grouped) ──────────────────────────

  getCompetitorPages(): any[] {
    return queryAll(`
      SELECT
        page_id,
        page_name,
        COUNT(*) as total_ads,
        SUM(CASE WHEN delivery_stop IS NULL THEN 1 ELSE 0 END) as active_ads,
        MAX(days_active) as longest_running,
        AVG(winner_score) as avg_score,
        GROUP_CONCAT(DISTINCT platforms) as all_platforms,
        MIN(delivery_start) as first_seen,
        MAX(created_at) as last_scraped
      FROM competitor_ads
      GROUP BY page_id, page_name
      ORDER BY avg_score DESC
    `);
  }

  // ── Get single ad with analysis ─────────────────────────────

  getAdById(id: number): CompetitorAd | null {
    return queryOne('SELECT * FROM competitor_ads WHERE id = ?', [id]);
  }

  // ── Update ad analysis ──────────────────────────────────────

  updateAdAnalysis(id: number, analysis: any, score: number): void {
    runSql(
      'UPDATE competitor_ads SET analysis_json = ?, winner_score = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [JSON.stringify(analysis), score, id]
    );
    saveDb();
  }

  // ── Delete old ads ──────────────────────────────────────────

  pruneOldAds(daysOld = 180): number {
    const result = queryOne(
      'SELECT COUNT(*) as count FROM competitor_ads WHERE created_at < datetime(\'now\', ? || \' days\')',
      [-daysOld]
    );
    runSql(
      'DELETE FROM competitor_ads WHERE created_at < datetime(\'now\', ? || \' days\')',
      [-daysOld]
    );
    saveDb();
    return result?.count || 0;
  }
}

export const adLibraryService = new AdLibraryService();
