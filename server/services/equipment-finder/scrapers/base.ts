import type { Listing, ListingSource } from '../types';

export interface ScraperConfig {
  query: string;
  maxResults?: number;
  zipCode?: string;
  radiusMiles?: number;
  priceMin?: number;
  priceMax?: number;
  yearMin?: number;
  yearMax?: number;
  timeoutSeconds?: number;
}

export interface ScraperResult {
  source: ListingSource;
  listings: Listing[];
  totalFound: number;
  errors: string[];
  durationMs: number;
}

export interface EquipmentScraper {
  readonly source: ListingSource;
  readonly name: string;
  search(config: ScraperConfig): Promise<ScraperResult>;
}
