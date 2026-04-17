import type { Listing, ListingSource } from '../types';
import type { ScraperConfig } from './base';
import {
  ApifyEquipmentScraper,
  extractYear,
  inferCategory,
  makeListingId,
  parseInteger,
  parsePrice,
} from './apify-base';

export class CraigslistScraper extends ApifyEquipmentScraper {
  readonly source: ListingSource = 'craigslist';
  readonly name = 'Craigslist';
  readonly actorId = 'ivanvs/craigslist-scraper';

  buildInput(config: ScraperConfig): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      keywords: config.query,
      maxItems: config.maxResults ?? 100,
      section: 'heavy-equipment',
    };
    if (config.zipCode) payload.zipCode = config.zipCode;
    if (config.radiusMiles) payload.searchDistance = config.radiusMiles;
    if (config.priceMin) payload.minPrice = Math.round(config.priceMin);
    if (config.priceMax) payload.maxPrice = Math.round(config.priceMax);
    return payload;
  }

  normalizeItem(raw: any): Listing | null {
    const title = raw?.title || raw?.name;
    if (!title) return null;

    const sourceId = String(raw.id || raw.postingId || raw.url || '');
    if (!sourceId) return null;

    const attrs = typeof raw.attributes === 'object' ? raw.attributes : {};
    const price = parsePrice(raw.price);

    let postedAt: string | undefined;
    let daysOnMarket: number | undefined;
    if (raw.postedAt) {
      try {
        const d = new Date(raw.postedAt);
        if (!Number.isNaN(d.getTime())) {
          postedAt = d.toISOString();
          daysOnMarket = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
        }
      } catch {
        /* ignore */
      }
    }

    const imgs: string[] = Array.isArray(raw.images) ? raw.images : [];

    const loc = raw.location && typeof raw.location === 'object' ? raw.location : {};

    return {
      id: makeListingId(this.source, sourceId),
      source: this.source,
      sourceId,
      sourceUrl: raw.url || '',
      title,
      description: raw.description || raw.body || '',
      category: inferCategory(title, raw.description || ''),
      make: attrs.make || undefined,
      model: attrs.model || undefined,
      year: parseInteger(attrs.year),
      hours: parseInteger(attrs.hours),
      price,
      isAuction: false,
      condition: parseCondition(attrs.condition),
      location:
        loc.latitude !== undefined && loc.longitude !== undefined
          ? {
              latitude: Number(loc.latitude),
              longitude: Number(loc.longitude),
              city: loc.city,
              state: loc.state || loc.region,
              zipCode: loc.postalCode || loc.zip,
            }
          : undefined,
      seller: { isDealer: false },
      imageUrls: imgs,
      imageCount: imgs.length,
      listedDate: postedAt,
      daysOnMarket,
      scrapedAt: new Date().toISOString(),
      rawData: raw,
    };
  }
}

function parseCondition(v: unknown): Listing['condition'] {
  if (!v || typeof v !== 'string') return 'unknown';
  const m: Record<string, Listing['condition']> = {
    new: 'new',
    'like new': 'like_new',
    excellent: 'excellent',
    good: 'good',
    fair: 'fair',
    salvage: 'salvage',
    'parts only': 'parts_only',
  };
  return m[v.toLowerCase().trim()] || 'unknown';
}

// Helper also used from ebay
export { extractYear };
