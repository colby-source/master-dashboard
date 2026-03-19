import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { queryOne, runSql } from '../db';
import { trackApiCall } from './spend-tracker';

export interface AnymailfinderPersonResult {
  email: string | null;
  email_status: 'valid' | 'risky' | 'not_found' | 'blacklisted';
  valid_email: string | null;
}

export interface AnymailfinderCompanyResult {
  email_status: string;
  emails: string[];
  valid_emails: string[];
}

export interface AnymailfinderVerifyResult {
  email: string;
  email_status: 'valid' | 'risky' | 'invalid';
}

const CACHE_TTL_DAYS = 30; // Anymailfinder caches 30 days on their side too

class AnymailfinderClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.anymailfinderBaseUrl,
      headers: {
        'Authorization': config.anymailfinderApiKey,
        'Content-Type': 'application/json',
      },
      timeout: 180000, // Anymailfinder recommends 180s — real-time SMTP checks
    });
  }

  get available(): boolean {
    return !!config.anymailfinderApiKey;
  }

  /**
   * Find a person's email by name + domain/company.
   * Costs 1 credit only when a valid email is found.
   */
  async findPersonEmail(params: {
    domain?: string;
    company_name?: string;
    full_name?: string;
    first_name?: string;
    last_name?: string;
  }): Promise<AnymailfinderPersonResult | null> {
    if (!this.available) return null;

    const nameKey = (params.full_name || `${params.first_name}_${params.last_name}`).toLowerCase();
    const domainKey = (params.domain || params.company_name || '').toLowerCase();
    const cacheKey = `amf:person:${domainKey}:${nameKey}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.client.post('/find-email/person', params);

      const result: AnymailfinderPersonResult = {
        email: data.email || null,
        email_status: data.email_status || 'not_found',
        valid_email: data.valid_email || null,
      };

      // Cache all results (even not_found — saves API calls)
      this.setCache(cacheKey, 'anymailfinder', result);
      trackApiCall('anymailfinder', 'find_person_email', 0, 1);
      return result;
    } catch (err: any) {
      console.error('[Anymailfinder] findPersonEmail error:', err.response?.data?.message || err.message);
      return null;
    }
  }

  /**
   * Find up to 20 emails at a company domain.
   * Costs 1 credit per valid result.
   */
  async findCompanyEmails(params: {
    domain?: string;
    company_name?: string;
    email_type?: 'any' | 'generic' | 'personal';
  }): Promise<AnymailfinderCompanyResult | null> {
    if (!this.available) return null;

    const domainKey = (params.domain || params.company_name || '').toLowerCase();
    const typeKey = params.email_type || 'any';
    const cacheKey = `amf:company:${domainKey}:${typeKey}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.client.post('/find-email/company', params);

      const result: AnymailfinderCompanyResult = {
        email_status: data.email_status || 'not_found',
        emails: data.emails || [],
        valid_emails: data.valid_emails || [],
      };

      this.setCache(cacheKey, 'anymailfinder', result);
      trackApiCall('anymailfinder', 'find_company_emails', 0, 1);
      return result;
    } catch (err: any) {
      console.error('[Anymailfinder] findCompanyEmails error:', err.response?.data?.message || err.message);
      return null;
    }
  }

  /**
   * Verify if an email is deliverable.
   * Costs 0.2 credits per check.
   */
  async verifyEmail(email: string): Promise<AnymailfinderVerifyResult | null> {
    if (!this.available) return null;

    const cacheKey = `amf:verify:${email.toLowerCase()}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.client.post('/verify-email', { email });

      const result: AnymailfinderVerifyResult = {
        email,
        email_status: data.email_status || 'risky',
      };

      this.setCache(cacheKey, 'anymailfinder', result);
      trackApiCall('anymailfinder', 'verify_email', 0, 0);
      return result;
    } catch (err: any) {
      console.error('[Anymailfinder] verifyEmail error:', err.response?.data?.message || err.message);
      return null;
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
      console.error('[Anymailfinder] Cache write error:', err.message);
    }
  }
}

export const anymailfinderClient = new AnymailfinderClient();
