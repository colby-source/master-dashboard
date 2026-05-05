import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { queryOne, runSql } from '../db';
import { trackApiCall } from './spend-tracker';
import { createLogger } from '../utils/logger';
const log = createLogger('millionverifier-client');

export interface MillionVerifierResult {
  email: string;
  quality: 'good' | 'catch_all' | 'unknown' | 'bad' | 'disposable';
  result: string;
  free: boolean;
  role: boolean;
  subresult: string;
}

const CACHE_TTL_DAYS = 30;

class MillionVerifierClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.millionverifierBaseUrl,
      timeout: 30000,
    });
  }

  get available(): boolean {
    return !!config.millionverifierApiKey;
  }

  /**
   * Verify a single email address.
   * Returns quality: good, catch_all, unknown, bad, disposable.
   */
  async verifyEmail(email: string): Promise<MillionVerifierResult | null> {
    if (!this.available) return null;

    const cacheKey = `mv:verify:${email.toLowerCase()}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.client.get('/', {
        params: {
          api: config.millionverifierApiKey,
          email,
        },
      });

      const result: MillionVerifierResult = {
        email,
        quality: this.mapQuality(data.quality || data.result),
        result: data.result || '',
        free: data.free === true || data.free === 'true',
        role: data.role === true || data.role === 'true',
        subresult: data.subresult || '',
      };

      this.setCache(cacheKey, 'millionverifier', result);
      trackApiCall('millionverifier', 'verify_email', 0);
      return result;
    } catch (err: any) {
      if (err.response?.status === 429) {
        log.warn('[MillionVerifier] Rate limited — 160 req/sec max');
        return null;
      }
      if (err.response?.status === 401) {
        log.error('[MillionVerifier] Invalid API key');
        return null;
      }
      log.error('[MillionVerifier] verifyEmail error:', err.message);
      return null;
    }
  }

  /**
   * Check if email is valid (good or catch_all).
   */
  isValid(result: MillionVerifierResult): boolean {
    return result.quality === 'good' || result.quality === 'catch_all';
  }

  /**
   * Check if email is definitely bad.
   */
  isInvalid(result: MillionVerifierResult): boolean {
    return result.quality === 'bad' || result.quality === 'disposable';
  }

  private mapQuality(raw: string): MillionVerifierResult['quality'] {
    const normalized = (raw || '').toLowerCase();
    if (normalized === 'good' || normalized === 'ok') return 'good';
    if (normalized === 'catch_all' || normalized === 'catch-all') return 'catch_all';
    if (normalized === 'bad' || normalized === 'invalid') return 'bad';
    if (normalized === 'disposable') return 'disposable';
    return 'unknown';
  }

  private getCache(key: string): any | null {
    try {
      const row = queryOne(
        `SELECT response_data FROM enrichment_cache WHERE cache_key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
        [key]
      );
      if (row) return JSON.parse(row.response_data);
    } catch {
      // cache miss
    }
    return null;
  }

  private setCache(key: string, provider: string, data: any): void {
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);
      runSql(
        `INSERT OR REPLACE INTO enrichment_cache (cache_key, provider, response_data, expires_at) VALUES (?, ?, ?, ?)`,
        [key, provider, JSON.stringify(data), expiresAt.toISOString()]
      );
    } catch (err: any) {
      log.error('[MillionVerifier] Cache write error:', err.message);
    }
  }
}

export const millionverifierClient = new MillionVerifierClient();
