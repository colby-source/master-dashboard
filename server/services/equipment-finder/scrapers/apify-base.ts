import crypto from 'crypto';
import { apifyService } from '../../apify-service';
import { createLogger } from '../../../utils/logger';
import type { Listing, ListingSource } from '../types';
import type { EquipmentScraper, ScraperConfig, ScraperResult } from './base';

const log = createLogger('equipment-scraper-apify');

/**
 * Base for Apify-backed equipment scrapers.
 * Subclasses provide actorId + input-builder + item-normalizer.
 */
export abstract class ApifyEquipmentScraper implements EquipmentScraper {
  abstract readonly source: ListingSource;
  abstract readonly name: string;
  abstract readonly actorId: string;

  abstract buildInput(config: ScraperConfig): Record<string, unknown>;
  abstract normalizeItem(raw: any): Listing | null;

  async search(config: ScraperConfig): Promise<ScraperResult> {
    const start = Date.now();
    const errors: string[] = [];
    const listings: Listing[] = [];

    try {
      const input = this.buildInput(config);
      const run = await apifyService.runActorSync(this.actorId, input, {
        timeout: config.timeoutSeconds ?? 120,
        memory: 512,
      });

      if (!run || run.status !== 'SUCCEEDED') {
        errors.push(`Actor run failed: ${run?.status || 'UNKNOWN'}`);
        return { source: this.source, listings, totalFound: 0, errors, durationMs: Date.now() - start };
      }

      const items = await apifyService.getDatasetItems(run.defaultDatasetId, {
        limit: config.maxResults ?? 100,
      });

      for (const raw of items || []) {
        try {
          const listing = this.normalizeItem(raw);
          if (listing) listings.push(listing);
        } catch (err) {
          errors.push(`Normalize failed: ${String(err)}`);
        }
      }
    } catch (err) {
      log.error('apify scraper failed', { source: this.source, error: String(err) });
      errors.push(`Apify scrape failed: ${String(err)}`);
    }

    return {
      source: this.source,
      listings,
      totalFound: listings.length,
      errors,
      durationMs: Date.now() - start,
    };
  }
}

export function makeListingId(source: ListingSource, sourceId: string): string {
  return crypto.createHash('md5').update(`${source}:${sourceId}`).digest('hex');
}

export function parsePrice(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,]/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function parseInteger(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') {
    const cleaned = v.replace(/,/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n) : undefined;
  }
  return undefined;
}

export function extractYear(text: string): number | undefined {
  const match = text.match(/\b(19[8-9]\d|20[0-2]\d)\b/);
  return match ? Number(match[1]) : undefined;
}

import type { EquipmentCategory } from '../types';

const CATEGORY_KEYWORDS: Array<[EquipmentCategory, string[]]> = [
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
