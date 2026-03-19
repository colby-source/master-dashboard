import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { queryOne, runSql } from '../db';
import { trackApiCall } from './spend-tracker';

export interface HunterVerifyResult {
  email: string;
  status: 'valid' | 'invalid' | 'accept_all' | 'webmail' | 'disposable' | 'unknown';
  score: number;
  regexp: boolean;
  gibberish: boolean;
  disposable: boolean;
  webmail: boolean;
  mx_records: boolean;
  smtp_server: boolean;
  smtp_check: boolean;
  accept_all: boolean;
  block: boolean;
  sources: number;
}

export interface HunterFindResult {
  email: string;
  first_name: string;
  last_name: string;
  position: string;
  company: string;
  score: number;
  domain: string;
  sources: any[];
}

const CACHE_TTL_DAYS = 7;

class HunterClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.hunterBaseUrl,
      timeout: 30000,
    });
  }

  get available(): boolean {
    return !!config.hunterApiKey;
  }

  async verifyEmail(email: string): Promise<HunterVerifyResult | null> {
    if (!this.available) return null;

    const cacheKey = `hunter:verify:${email.toLowerCase()}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.client.get('/email-verifier', {
        params: { email, api_key: config.hunterApiKey },
      });

      const result: HunterVerifyResult = {
        email: data.data?.email || email,
        status: data.data?.status || 'unknown',
        score: data.data?.score || 0,
        regexp: data.data?.regexp ?? false,
        gibberish: data.data?.gibberish ?? false,
        disposable: data.data?.disposable ?? false,
        webmail: data.data?.webmail ?? false,
        mx_records: data.data?.mx_records ?? false,
        smtp_server: data.data?.smtp_server ?? false,
        smtp_check: data.data?.smtp_check ?? false,
        accept_all: data.data?.accept_all ?? false,
        block: data.data?.block ?? false,
        sources: data.data?.sources || 0,
      };

      this.setCache(cacheKey, 'hunter', result);
      trackApiCall('hunter', 'verify_email', 1);
      return result;
    } catch (err: any) {
      console.error('[Hunter] verifyEmail error:', err.message);
      return null;
    }
  }

  async findEmail(domain: string, firstName: string, lastName: string): Promise<HunterFindResult | null> {
    if (!this.available) return null;

    const cacheKey = `hunter:find:${domain.toLowerCase()}:${firstName.toLowerCase()}:${lastName.toLowerCase()}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.client.get('/email-finder', {
        params: {
          domain,
          first_name: firstName,
          last_name: lastName,
          api_key: config.hunterApiKey,
        },
      });

      const result: HunterFindResult = {
        email: data.data?.email || '',
        first_name: data.data?.first_name || firstName,
        last_name: data.data?.last_name || lastName,
        position: data.data?.position || '',
        company: data.data?.company || '',
        score: data.data?.score || 0,
        domain: data.data?.domain || domain,
        sources: data.data?.sources || [],
      };

      if (result.email) {
        this.setCache(cacheKey, 'hunter', result);
        trackApiCall('hunter', 'find_email', 3);
      }
      return result.email ? result : null;
    } catch (err: any) {
      console.error('[Hunter] findEmail error:', err.message);
      return null;
    }
  }

  async domainSearch(domain: string, limit = 10): Promise<any[]> {
    if (!this.available) return [];

    try {
      const { data } = await this.client.get('/domain-search', {
        params: { domain, limit, api_key: config.hunterApiKey },
      });
      return data.data?.emails || [];
    } catch (err: any) {
      console.error('[Hunter] domainSearch error:', err.message);
      return [];
    }
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
      console.error('[Hunter] Cache write error:', err.message);
    }
  }
}

export const hunterClient = new HunterClient();
