import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { createLogger } from '../../../utils/logger';
import type { EquipmentCategory, Listing, ListingCondition, ListingSource } from '../types';
import type { EquipmentScraper, ScraperConfig, ScraperResult } from './base';

/**
 * Base class for scrapers that fetch raw HTML or JSON over HTTPS.
 * Subclasses override `search()` OR implement `buildUrl()` + `parsePage()`.
 */
export abstract class HtmlEquipmentScraper implements EquipmentScraper {
  abstract readonly source: ListingSource;
  abstract readonly name: string;

  protected readonly userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
  protected readonly defaultTimeoutMs = 20_000;
  protected readonly log = createLogger(`scraper-${this.constructor.name}`);

  abstract search(config: ScraperConfig): Promise<ScraperResult>;

  protected async fetchHtml(url: string, opts: AxiosRequestConfig = {}): Promise<cheerio.CheerioAPI | null> {
    const res = await this.fetchRaw(url, { ...opts, responseType: 'text' });
    if (!res) return null;
    try {
      return cheerio.load(String(res.data));
    } catch (err) {
      this.log.warn('cheerio parse failed', { url, error: String(err) });
      return null;
    }
  }

  protected async fetchJson<T = unknown>(url: string, opts: AxiosRequestConfig = {}): Promise<T | null> {
    const res = await this.fetchRaw(url, {
      ...opts,
      responseType: 'json',
      headers: { Accept: 'application/json', ...(opts.headers || {}) },
    });
    if (!res) return null;
    return res.data as T;
  }

  protected async fetchRaw(url: string, opts: AxiosRequestConfig = {}): Promise<AxiosResponse | null> {
    try {
      return await axios({
        url,
        method: opts.method || 'GET',
        timeout: opts.timeout || this.defaultTimeoutMs,
        headers: {
          'User-Agent': this.userAgent,
          'Accept-Language': 'en-US,en;q=0.9',
          ...(opts.headers || {}),
        },
        params: opts.params,
        data: opts.data,
        responseType: opts.responseType,
        validateStatus: (s) => s < 500,
        maxRedirects: 5,
      });
    } catch (err) {
      this.log.warn('http fetch failed', { url, error: String(err) });
      return null;
    }
  }

  protected emptyResult(start: number, errors: string[] = []): ScraperResult {
    return {
      source: this.source,
      listings: [],
      totalFound: 0,
      errors,
      durationMs: Date.now() - start,
    };
  }

  protected finish(start: number, listings: Listing[], errors: string[] = []): ScraperResult {
    return {
      source: this.source,
      listings,
      totalFound: listings.length,
      errors,
      durationMs: Date.now() - start,
    };
  }
}

// ----- shared helpers -----

export function makeListingId(source: ListingSource, sourceId: string): string {
  return crypto.createHash('md5').update(`${source}:${sourceId}`).digest('hex');
}

export function parseMoney(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return undefined;
  const m = v.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function parseIntSafe(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return Math.round(v);
  if (typeof v !== 'string') return undefined;
  const cleaned = v.replace(/[^\d-]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

export function parseYear(v: unknown): number | undefined {
  if (typeof v === 'number' && v >= 1900 && v <= 2100) return Math.round(v);
  if (typeof v !== 'string') return undefined;
  const m = v.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  return m ? Number(m[1]) : undefined;
}

export function absolutize(base: string, href: string | undefined | null): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

const CATEGORY_KEYWORDS: Array<[EquipmentCategory, string[]]> = [
  ['recirculating_chiller', ['recirculating chiller', 'recirc chiller', 'dlsb', 'koolant koolers', 'huber unistat', 'julabo fp', 'julabo presto', 'polyscience']],
  ['lab_chiller', ['unichiller', 'huber cc', 'huber minichiller', 'ministat', 'kiss e', 'koolant']],
  ['extraction_system', ['extractiontek', 'mep 30', 'mep-30', 'mep 70', 'mep-70', 'mep xt', 'px1', 'px10', 'precision extraction', 'bho extract', 'hydrocarbon extract', 'closed loop', 'closed-loop', 'co2 extract', 'ethanol extract']],
  ['rotovap', ['rotovap', 'rotary evaporator', 'rotary evap', 'heidolph hei-vap', 'solventvap']],
  ['centrifuge', ['centrifuge', 'delta separations cup']],
  ['vacuum_oven', ['vacuum oven', 'cvo-5', 'cascade sciences']],
  ['short_path', ['short path', 'kdt-6', 'cdu-1000', 'wiped film', 'molecular distillation']],
  ['jacketed_reactor', ['jacketed reactor', 'glass reactor', 'r-20l', 'r-50l', 'r-100l']],
  ['freeze_dryer', ['freeze dryer', 'lyophilizer']],
  ['cold_trap', ['cold trap']],
  ['excavator', ['excavator', 'trackhoe', 'track hoe', 'digger']],
  ['bulldozer', ['bulldozer', 'dozer', 'crawler tractor']],
  ['loader', ['wheel loader', 'front loader', 'payloader']],
  ['backhoe', ['backhoe', 'back hoe']],
  ['skid_steer', ['skid steer', 'bobcat', 'skidsteer']],
  ['crane', ['crane', 'boom truck']],
  ['forklift', ['forklift', 'lift truck']],
  ['dump_truck', ['dump truck']],
  ['semi_truck', ['semi', 'tractor trailer', 'freightliner', 'peterbilt', 'kenworth']],
  ['generator', ['generator', 'genset']],
  ['compressor', ['compressor']],
];

export function inferCategory(title: string, description = ''): EquipmentCategory {
  const text = `${title} ${description}`.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => text.includes(kw))) return category;
  }
  return 'other';
}

export function inferCondition(text: string): ListingCondition {
  const lower = text.toLowerCase();
  if (/\bnew\b|unused|open[- ]box/.test(lower)) return 'new';
  if (/like new|lightly used|barely used/.test(lower)) return 'like_new';
  if (/excellent|mint/.test(lower)) return 'excellent';
  if (/\bgood\b|well[- ]maintained/.test(lower)) return 'good';
  if (/\bfair\b/.test(lower)) return 'fair';
  if (/salvage/.test(lower)) return 'salvage';
  if (/parts only|for parts|parts\/repair/.test(lower)) return 'parts_only';
  if (/\bpoor\b|damaged|broken/.test(lower)) return 'poor';
  return 'unknown';
}

/** US state detection from free-form text (e.g. "Menifee, CA" → CA). */
export function detectState(text: string): string | undefined {
  const m = text.match(/\b([A-Z]{2})\b(?:\s*\d{5})?/);
  if (m && US_STATES.has(m[1])) return m[1];
  for (const [full, abbr] of STATE_NAMES) {
    if (new RegExp(`\\b${full}\\b`, 'i').test(text)) return abbr;
  }
  return undefined;
}

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

const STATE_NAMES: Array<[string, string]> = [
  ['Alabama','AL'],['Alaska','AK'],['Arizona','AZ'],['Arkansas','AR'],['California','CA'],
  ['Colorado','CO'],['Connecticut','CT'],['Delaware','DE'],['Florida','FL'],['Georgia','GA'],
  ['Hawaii','HI'],['Idaho','ID'],['Illinois','IL'],['Indiana','IN'],['Iowa','IA'],
  ['Kansas','KS'],['Kentucky','KY'],['Louisiana','LA'],['Maine','ME'],['Maryland','MD'],
  ['Massachusetts','MA'],['Michigan','MI'],['Minnesota','MN'],['Mississippi','MS'],['Missouri','MO'],
  ['Montana','MT'],['Nebraska','NE'],['Nevada','NV'],['New Hampshire','NH'],['New Jersey','NJ'],
  ['New Mexico','NM'],['New York','NY'],['North Carolina','NC'],['North Dakota','ND'],['Ohio','OH'],
  ['Oklahoma','OK'],['Oregon','OR'],['Pennsylvania','PA'],['Rhode Island','RI'],['South Carolina','SC'],
  ['South Dakota','SD'],['Tennessee','TN'],['Texas','TX'],['Utah','UT'],['Vermont','VT'],
  ['Virginia','VA'],['Washington','WA'],['West Virginia','WV'],['Wisconsin','WI'],['Wyoming','WY'],
];
