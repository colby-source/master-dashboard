import type { Listing, ListingCondition, ListingSource } from '../types';
import type { ScraperConfig } from './base';
import {
  ApifyEquipmentScraper,
  inferCategory,
  makeListingId,
  parseInteger,
  parsePrice,
} from './apify-base';

export class FacebookMarketplaceScraper extends ApifyEquipmentScraper {
  readonly source: ListingSource = 'facebook_marketplace';
  readonly name = 'Facebook Marketplace';
  readonly actorId = 'apify/facebook-marketplace-scraper';

  buildInput(config: ScraperConfig): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      searchQueries: [config.query],
      maxItems: config.maxResults ?? 100,
      country: 'US',
    };
    if (config.zipCode) payload.location = config.zipCode;
    if (config.radiusMiles) payload.radius = config.radiusMiles;
    if (config.priceMin) payload.minPrice = Math.round(config.priceMin);
    if (config.priceMax) payload.maxPrice = Math.round(config.priceMax);
    return payload;
  }

  normalizeItem(raw: any): Listing | null {
    const title = raw?.marketplace_listing_title || raw?.title;
    if (!title) return null;

    const sourceId = String(raw.id || raw.listingId || '');
    if (!sourceId) return null;

    const priceInfo = raw.listing_price && typeof raw.listing_price === 'object' ? raw.listing_price : {};
    const price = parsePrice(priceInfo.amount ?? raw.price);

    const loc = raw.location && typeof raw.location === 'object' ? raw.location : {};
    const geo = loc.reverse_geocode && typeof loc.reverse_geocode === 'object' ? loc.reverse_geocode : {};
    const location =
      loc.latitude !== undefined && loc.longitude !== undefined
        ? {
            latitude: Number(loc.latitude),
            longitude: Number(loc.longitude),
            city: geo.city,
            state: geo.state,
          }
        : undefined;

    const sellerRaw = raw.seller || raw.marketplace_listing_seller || {};
    const seller = sellerRaw
      ? {
          name: sellerRaw.name,
          isDealer: !!sellerRaw.is_business,
          sellerUrl: sellerRaw.profile_url,
        }
      : undefined;

    const photos = Array.isArray(raw.listing_photos) ? raw.listing_photos : [];
    const imageUrls = photos.map((p: any) => p?.uri).filter(Boolean);

    return {
      id: makeListingId(this.source, sourceId),
      source: this.source,
      sourceId,
      sourceUrl: raw.listing_url || raw.url || '',
      title,
      description: raw.description || raw.redacted_description || '',
      category: inferCategory(title, raw.description || ''),
      make: raw.custom_title || undefined,
      year: parseInteger(raw.year),
      hours: parseInteger(raw.hours),
      price,
      isAuction: false,
      condition: parseFbCondition(raw.condition),
      location,
      seller,
      imageUrls,
      imageCount: imageUrls.length,
      scrapedAt: new Date().toISOString(),
      rawData: raw,
    };
  }
}

function parseFbCondition(v: unknown): ListingCondition {
  if (!v || typeof v !== 'string') return 'unknown';
  const m: Record<string, ListingCondition> = {
    NEW: 'new',
    USED_LIKE_NEW: 'like_new',
    USED_GOOD: 'good',
    USED_FAIR: 'fair',
  };
  return m[v.toUpperCase()] || 'unknown';
}
