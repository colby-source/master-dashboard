// Core types for Equipment Finder

export type ListingSource =
  | 'craigslist'
  | 'facebook_marketplace'
  | 'ebay'
  | 'machinery_trader'
  | 'equipment_trader'
  | 'ritchie_bros'
  | 'iron_planet'
  | 'govdeals'
  | 'auction_time'
  | 'purple_wave'
  | 'bigiron'
  | 'proxibid'
  | 'bidspotter'
  | 'hilco_global'
  | 'reddit'
  | 'forum'
  | 'future4200'
  | 'labx'
  | 'machinio'
  | 'property420'
  | 'urth_fyre'
  | 'dealer_website'
  | 'liquidation'
  | 'other';

export type ListingCondition =
  | 'new'
  | 'like_new'
  | 'excellent'
  | 'good'
  | 'fair'
  | 'poor'
  | 'salvage'
  | 'parts_only'
  | 'unknown';

export type EquipmentCategory =
  | 'excavator'
  | 'bulldozer'
  | 'loader'
  | 'backhoe'
  | 'skid_steer'
  | 'crane'
  | 'forklift'
  | 'dump_truck'
  | 'semi_truck'
  | 'trailer'
  | 'generator'
  | 'compressor'
  | 'concrete'
  | 'paving'
  | 'agriculture'
  | 'forestry'
  | 'mining'
  | 'manufacturing'
  | 'vehicle'
  | 'recirculating_chiller'
  | 'lab_chiller'
  | 'extraction_system'
  | 'rotovap'
  | 'centrifuge'
  | 'vacuum_oven'
  | 'short_path'
  | 'jacketed_reactor'
  | 'freeze_dryer'
  | 'cold_trap'
  | 'other';

export interface GeoLocation {
  latitude: number;
  longitude: number;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface SellerInfo {
  name?: string;
  phone?: string;
  email?: string;
  isDealer: boolean;
  sellerUrl?: string;
  listingCount?: number;
}

export interface Listing {
  id: string;
  source: ListingSource;
  sourceId: string;
  sourceUrl: string;

  title: string;
  description: string;
  category: EquipmentCategory;
  make?: string;
  model?: string;
  year?: number;
  hours?: number;
  mileage?: number;
  serialNumber?: string;

  price?: number;
  isAuction: boolean;
  auctionEndTime?: string;
  currentBid?: number;
  buyNowPrice?: number;
  startingBid?: number;
  buyerPremiumPct?: number;
  lotNumber?: string;
  auctionHouse?: string;
  biddingOpensAt?: string;

  condition: ListingCondition;

  location?: GeoLocation;
  seller?: SellerInfo;

  imageUrls: string[];
  imageCount: number;

  listedDate?: string;
  daysOnMarket?: number;
  scrapedAt: string;

  rawData?: unknown;
}

export type DealSignal =
  | 'below_market'
  | 'deep_discount'
  | 'price_drop'
  | 'must_sell'
  | 'bankruptcy'
  | 'business_closing'
  | 'divorce_estate'
  | 'moving'
  | 'auction_ending_soon'
  | 'long_listed'
  | 'poor_title'
  | 'misspelled'
  | 'wrong_category'
  | 'no_images'
  | 'buried_listing'
  | 'low_hours'
  | 'one_owner'
  | 'recent_service'
  | 'attachments_included'
  | 'geo_arbitrage'
  | 'rural_listing'
  | 'private_seller'
  | 'fleet_disposal'
  | 'government_surplus';

export type DealTier =
  | 'steal'
  | 'great_deal'
  | 'good_deal'
  | 'fair'
  | 'overpriced'
  | 'avoid';

export interface SignalDetail {
  signal: DealSignal;
  points: number;
  explanation: string;
}

export interface DealScore {
  listingId: string;
  score: number;
  tier: DealTier;
  priceScore: number;
  urgencyScore: number;
  hiddenScore: number;
  qualityScore: number;
  geoScore: number;
  sellerScore: number;
  signals: SignalDetail[];
  summary: string;
  suggestedAction: string;
  negotiationNotes: string;
  marketAvgPrice?: number;
  priceVsMarketPct?: number;
  comparableCount: number;
}

export interface PriceComparable {
  source: string;
  sourceUrl: string;
  price: number;
  make: string;
  model: string;
  year?: number;
  hours?: number;
  condition: string;
  locationState: string;
}

export interface MarketPrice {
  equipmentType: string;
  make: string;
  model: string;
  yearRange: string;
  avgPrice: number;
  medianPrice: number;
  lowPrice: number;
  highPrice: number;
  priceStdDev: number;
  sampleSize: number;
  comparables: PriceComparable[];
  cheapestStates: string[];
  mostExpensiveStates: string[];
  regionalSpreadPct: number;
}

export interface SearchQuery {
  rawQuery: string;
  equipmentType?: string;
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  priceMin?: number;
  priceMax?: number;
  hoursMax?: number;
  mileageMax?: number;
  conditionMin?: string;
  zipCode?: string;
  radiusMiles?: number;
  expandedTerms: string[];
  makeVariations: string[];
  misspellingVariants: string[];
  sources: ListingSource[];
}

export function dealTierFromScore(score: number): DealTier {
  if (score >= 90) return 'steal';
  if (score >= 75) return 'great_deal';
  if (score >= 60) return 'good_deal';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'overpriced';
  return 'avoid';
}

export function effectivePrice(l: Listing): number | undefined {
  if (l.price && l.price > 0) return l.price;
  if (l.buyNowPrice && l.buyNowPrice > 0) return l.buyNowPrice;
  if (l.currentBid && l.currentBid > 0) return l.currentBid;
  return undefined;
}
