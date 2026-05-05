import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { queryOne, runSql } from '../db';
import { trackApiCall } from './spend-tracker';
import { createLogger } from '../utils/logger';
const log = createLogger('pdl-client');

export interface PdlPersonResult {
  id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  linkedin_url: string;
  job_title: string;
  job_title_role: string;
  job_title_levels: string[];
  job_company_name: string;
  job_company_industry: string;
  job_company_size: string;
  job_company_website: string;
  job_company_location_name: string;
  location_name: string;
  location_country: string;
  location_region: string;
  location_locality: string;
  phone_numbers: string[];
  personal_emails: string[];
  work_email: string;
  industry: string;
  interests: string[];
  skills: string[];
  experience: any[];
  education: any[];
  inferred_salary: string;
  inferred_years_experience: number;
  gender: string;
  birth_year: number;
  raw: any;
}

export interface PdlCompanyResult {
  id: string;
  name: string;
  website: string;
  industry: string;
  size: string;
  employee_count: number;
  founded: number;
  location: string;
  description: string;
  linkedin_url: string;
  type: string;
  tags: string[];
  raw: any;
}

const CACHE_TTL_DAYS = 30;

class PdlClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.pdlBaseUrl,
      headers: {
        'X-Api-Key': config.pdlApiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  get available(): boolean {
    return !!config.pdlApiKey;
  }

  async enrichPerson(email: string): Promise<PdlPersonResult | null> {
    if (!this.available) return null;

    const cacheKey = `pdl:person:${email.toLowerCase()}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.client.get('/person/enrich', {
        params: { email, pretty: true },
      });

      const result: PdlPersonResult = {
        id: data.id || '',
        full_name: data.full_name || '',
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        email: data.work_email || data.recommended_personal_email || email,
        linkedin_url: data.linkedin_url || '',
        job_title: data.job_title || '',
        job_title_role: data.job_title_role || '',
        job_title_levels: data.job_title_levels || [],
        job_company_name: data.job_company_name || '',
        job_company_industry: data.job_company_industry || '',
        job_company_size: data.job_company_size || '',
        job_company_website: data.job_company_website || '',
        job_company_location_name: data.job_company_location_name || '',
        location_name: data.location_name || '',
        location_country: data.location_country || '',
        location_region: data.location_region || '',
        location_locality: data.location_locality || '',
        phone_numbers: data.phone_numbers || [],
        personal_emails: data.personal_emails || [],
        work_email: data.work_email || '',
        industry: data.industry || '',
        interests: data.interests || [],
        skills: data.skills || [],
        experience: data.experience || [],
        education: data.education || [],
        inferred_salary: data.inferred_salary || '',
        inferred_years_experience: data.inferred_years_experience || 0,
        gender: data.gender || '',
        birth_year: data.birth_year || 0,
        raw: data,
      };

      this.setCache(cacheKey, 'pdl', result);
      trackApiCall('pdl', 'enrich_person', 28);
      return result;
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 404) {
        log.info(`[PDL] No person found for ${email}`);
        return null;
      }
      if (status === 402) {
        log.error('[PDL] Credits exhausted');
        return null;
      }
      log.error('[PDL] enrichPerson error:', err.message);
      return null;
    }
  }

  async enrichCompany(domain: string): Promise<PdlCompanyResult | null> {
    if (!this.available) return null;

    const cacheKey = `pdl:company:${domain.toLowerCase()}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.client.get('/company/enrich', {
        params: { website: domain, pretty: true },
      });

      const result: PdlCompanyResult = {
        id: data.id || '',
        name: data.name || '',
        website: data.website || domain,
        industry: data.industry || '',
        size: data.size || '',
        employee_count: data.employee_count || 0,
        founded: data.founded || 0,
        location: data.location?.name || '',
        description: data.summary || '',
        linkedin_url: data.linkedin_url || '',
        type: data.type || '',
        tags: data.tags || [],
        raw: data,
      };

      this.setCache(cacheKey, 'pdl', result);
      trackApiCall('pdl', 'enrich_company', 10);
      return result;
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 404) {
        log.info(`[PDL] No company found for ${domain}`);
        return null;
      }
      log.error('[PDL] enrichCompany error:', err.message);
      return null;
    }
  }

  private getCache(key: string): any | null {
    try {
      const row = queryOne(
        `SELECT response_data FROM enrichment_cache WHERE cache_key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
        [key]
      );
      if (row) {
        return JSON.parse(row.response_data);
      }
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
      log.error('[PDL] Cache write error:', err.message);
    }
  }
}

export const pdlClient = new PdlClient();
