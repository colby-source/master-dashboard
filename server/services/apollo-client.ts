import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { queryOne, runSql } from '../db';
import { trackApiCall } from './spend-tracker';

export interface ApolloPersonResult {
  id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  email_status: string;
  linkedin_url: string;
  title: string;
  headline: string;
  seniority: string;
  departments: string[];
  organization_name: string;
  organization_industry: string;
  organization_size: string;
  organization_website: string;
  organization_linkedin_url: string;
  organization_founded_year: number;
  organization_estimated_num_employees: number;
  location: string;
  city: string;
  state: string;
  country: string;
  phone_numbers: string[];
  employment_history: any[];
  raw: any;
}

export interface ApolloOrgResult {
  id: string;
  name: string;
  website: string;
  industry: string;
  estimated_num_employees: number;
  founded_year: number;
  linkedin_url: string;
  description: string;
  annual_revenue: number | null;
  total_funding: number | null;
  keywords: string[];
  location: string;
  raw: any;
}

const CACHE_TTL_DAYS = 30;

class ApolloClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.apolloBaseUrl,
      headers: {
        'x-api-key': config.apolloApiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  get available(): boolean {
    return !!config.apolloApiKey;
  }

  async enrichPerson(params: {
    email?: string;
    first_name?: string;
    last_name?: string;
    domain?: string;
    linkedin_url?: string;
    organization_name?: string;
  }): Promise<ApolloPersonResult | null> {
    if (!this.available) return null;

    const cacheKey = `apollo:person:${(params.email || params.linkedin_url || `${params.first_name}_${params.last_name}_${params.domain}`).toLowerCase()}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.client.post('/people/match', params);
      const person = data.person;
      if (!person) return null;

      const org = person.organization || {};
      const phones: string[] = [];
      if (person.phone_numbers) {
        for (const p of person.phone_numbers) {
          if (p.sanitized_number) phones.push(p.sanitized_number);
        }
      }

      const result: ApolloPersonResult = {
        id: person.id || '',
        full_name: person.name || '',
        first_name: person.first_name || '',
        last_name: person.last_name || '',
        email: person.email || '',
        email_status: person.email_status || '',
        linkedin_url: person.linkedin_url || '',
        title: person.title || '',
        headline: person.headline || '',
        seniority: person.seniority || '',
        departments: person.departments || [],
        organization_name: org.name || '',
        organization_industry: org.industry || '',
        organization_size: org.estimated_num_employees
          ? `${org.estimated_num_employees} employees`
          : '',
        organization_website: org.website_url || org.primary_domain || '',
        organization_linkedin_url: org.linkedin_url || '',
        organization_founded_year: org.founded_year || 0,
        organization_estimated_num_employees: org.estimated_num_employees || 0,
        location: [person.city, person.state, person.country].filter(Boolean).join(', '),
        city: person.city || '',
        state: person.state || '',
        country: person.country || '',
        phone_numbers: phones,
        employment_history: person.employment_history || [],
        raw: data,
      };

      this.setCache(cacheKey, 'apollo', result);
      trackApiCall('apollo', 'enrich_person', 0, 1);
      return result;
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 404 || status === 422) {
        console.log(`[Apollo] No person match for ${JSON.stringify(params)}`);
        return null;
      }
      if (status === 429) {
        console.warn('[Apollo] Rate limited — 600 calls/hour max');
        return null;
      }
      console.error('[Apollo] enrichPerson error:', err.message);
      return null;
    }
  }

  async enrichOrganization(params: {
    domain?: string;
    name?: string;
  }): Promise<ApolloOrgResult | null> {
    if (!this.available) return null;

    const cacheKey = `apollo:org:${(params.domain || params.name || '').toLowerCase()}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.client.get('/organizations/enrich', {
        params,
      });
      const org = data.organization;
      if (!org) return null;

      const result: ApolloOrgResult = {
        id: org.id || '',
        name: org.name || '',
        website: org.website_url || org.primary_domain || '',
        industry: org.industry || '',
        estimated_num_employees: org.estimated_num_employees || 0,
        founded_year: org.founded_year || 0,
        linkedin_url: org.linkedin_url || '',
        description: org.short_description || '',
        annual_revenue: org.annual_revenue || null,
        total_funding: org.total_funding || null,
        keywords: org.keywords || [],
        location: [org.city, org.state, org.country].filter(Boolean).join(', '),
        raw: data,
      };

      this.setCache(cacheKey, 'apollo', result);
      trackApiCall('apollo', 'enrich_organization', 0, 1);
      return result;
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 404 || status === 422) {
        console.log(`[Apollo] No org match for ${JSON.stringify(params)}`);
        return null;
      }
      if (status === 429) {
        console.warn('[Apollo] Rate limited — 600 calls/hour max');
        return null;
      }
      console.error('[Apollo] enrichOrganization error:', err.message);
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
      console.error('[Apollo] Cache write error:', err.message);
    }
  }
}

export const apolloClient = new ApolloClient();
