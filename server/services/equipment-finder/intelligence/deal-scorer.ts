import {
  dealTierFromScore,
  effectivePrice,
  type DealScore,
  type DealSignal,
  type Listing,
  type MarketPrice,
  type SignalDetail,
} from '../types';
import { analyzeHidden } from './hidden-deal-finder';
import { analyzePrice, type PriceAnalysis } from './price-engine';
import { analyzeUrgency, type UrgencyAnalysis } from './urgency-detector';

export interface ScoringContext {
  marketPrice: MarketPrice | null;
  buyerState?: string;
  buyerZip?: string;
}

export function scoreDeal(listing: Listing, context: ScoringContext): DealScore {
  const signals: SignalDetail[] = [];

  // 1. Price (0-35)
  const priceA = analyzePrice(listing, context.marketPrice);
  if (priceA.isSteal) {
    signals.push({
      signal: 'deep_discount',
      points: priceA.priceScore,
      explanation: priceA.explanation,
    });
  } else if (priceA.isBelowMarket) {
    signals.push({
      signal: 'below_market',
      points: priceA.priceScore,
      explanation: priceA.explanation,
    });
  }

  // 2. Urgency (0-20)
  const urgencyA = analyzeUrgency(listing.title, listing.description);
  for (const sig of urgencyA.signals) {
    signals.push({
      signal: sig,
      points: urgencyA.urgencyScore / Math.max(urgencyA.signals.length, 1),
      explanation: urgencyA.explanation,
    });
  }

  // 3. Hidden (0-15)
  const hiddenA = analyzeHidden(listing);
  for (const sig of hiddenA.signals) {
    signals.push({
      signal: sig,
      points: hiddenA.hiddenScore / Math.max(hiddenA.signals.length, 1),
      explanation: hiddenA.explanation,
    });
  }

  // 4. Quality (0-15)
  const { score: qualityScore, signals: qSignals } = scoreQuality(listing);
  signals.push(...qSignals);

  // 5. Geo (0-10)
  const { score: geoScore, signals: gSignals } = scoreGeo(listing, context);
  signals.push(...gSignals);

  // 6. Seller (0-5)
  const { score: sellerScore, signals: sSignals } = scoreSeller(listing);
  signals.push(...sSignals);

  // 7. Auction urgency bonus
  const auctionBonus = auctionEndingBonus(listing);
  if (auctionBonus > 0) {
    signals.push({
      signal: 'auction_ending_soon',
      points: auctionBonus,
      explanation: 'Auction closes within 24 hours — act now',
    });
  }

  const total = Math.min(
    100,
    priceA.priceScore +
      urgencyA.urgencyScore +
      hiddenA.hiddenScore +
      qualityScore +
      geoScore +
      sellerScore +
      auctionBonus,
  );
  const tier = dealTierFromScore(total);

  return {
    listingId: listing.id,
    score: Math.round(total * 10) / 10,
    tier,
    priceScore: round1(priceA.priceScore),
    urgencyScore: round1(urgencyA.urgencyScore),
    hiddenScore: round1(hiddenA.hiddenScore),
    qualityScore: round1(qualityScore),
    geoScore: round1(geoScore),
    sellerScore: round1(sellerScore),
    signals,
    summary: buildSummary(listing, priceA, tier),
    suggestedAction: suggestedAction(listing, tier, urgencyA),
    negotiationNotes: negotiationNotes(listing, priceA, urgencyA),
    marketAvgPrice: context.marketPrice?.avgPrice,
    priceVsMarketPct: priceA.priceVsMarketPct,
    comparableCount: context.marketPrice?.sampleSize || 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function scoreQuality(listing: Listing): { score: number; signals: SignalDetail[] } {
  const signals: SignalDetail[] = [];
  let score = 0;

  const CONDITION_POINTS: Record<string, number> = {
    new: 15,
    like_new: 13,
    excellent: 11,
    good: 8,
    fair: 4,
    poor: 1,
    salvage: 0,
    parts_only: 0,
    unknown: 5,
  };
  score += CONDITION_POINTS[listing.condition] ?? 5;

  // Low-hours bonus
  if (listing.hours && listing.year) {
    const age = new Date().getFullYear() - listing.year;
    const expected = age * 500;
    if (expected > 0 && listing.hours < expected * 0.6) {
      score += 3;
      signals.push({
        signal: 'low_hours',
        points: 3,
        explanation: `${listing.hours} hrs is low for a ${age}-yr-old machine`,
      });
    }
  }

  return { score: Math.min(score, 15), signals };
}

function scoreGeo(
  listing: Listing,
  context: ScoringContext,
): { score: number; signals: SignalDetail[] } {
  const signals: SignalDetail[] = [];
  let score = 0;

  if (!context.marketPrice || !listing.location?.state) {
    return { score: 0, signals };
  }

  const state = listing.location.state.toUpperCase();
  if (context.marketPrice.cheapestStates.includes(state)) {
    score += 6;
    signals.push({
      signal: 'geo_arbitrage',
      points: 6,
      explanation: `${state} is among the cheapest states for this equipment`,
    });
  }
  if (context.marketPrice.regionalSpreadPct > 20) score += 4;

  return { score: Math.min(score, 10), signals };
}

function scoreSeller(listing: Listing): { score: number; signals: SignalDetail[] } {
  const signals: SignalDetail[] = [];
  let score = 0;

  if (!listing.seller) return { score: 0, signals };

  if (!listing.seller.isDealer) {
    score += 3;
    signals.push({
      signal: 'private_seller',
      points: 3,
      explanation: 'Private seller — typically more flexible on price',
    });
  }

  if (listing.source === 'govdeals') {
    score += 2;
    signals.push({
      signal: 'government_surplus',
      points: 2,
      explanation: 'Government surplus — documented maintenance history',
    });
  }

  return { score: Math.min(score, 5), signals };
}

function auctionEndingBonus(listing: Listing): number {
  if (!listing.isAuction || !listing.auctionEndTime) return 0;
  const hours = (new Date(listing.auctionEndTime).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hours > 0 && hours < 6) return 5;
  if (hours > 0 && hours < 24) return 3;
  if (hours > 0 && hours < 48) return 1.5;
  return 0;
}

function buildSummary(listing: Listing, priceA: PriceAnalysis, tier: string): string {
  const equipment = [listing.year, listing.make, listing.model].filter(Boolean).join(' ') || listing.title;
  const price = effectivePrice(listing);
  const priceStr = price ? `$${Math.round(price).toLocaleString()}` : 'no price listed';
  const intro: Record<string, string> = {
    steal: 'STEAL',
    great_deal: 'Great deal',
    good_deal: 'Good deal',
    fair: 'Market price',
    overpriced: 'Overpriced',
    avoid: 'Avoid',
  };
  return `${intro[tier] || 'Deal'}: ${equipment} at ${priceStr}. ${priceA.explanation}`;
}

function suggestedAction(listing: Listing, tier: string, urgency: UrgencyAnalysis): string {
  if (tier === 'steal') {
    return listing.isAuction
      ? 'ACT NOW. Place aggressive bid — steal-tier auction rarely stays open.'
      : 'ACT NOW. Contact seller today. Bring cash or financing pre-approved.';
  }
  if (tier === 'great_deal') {
    if (urgency.signals.includes('business_closing')) {
      return 'Strong buy. Make offer below ask — seller needs to move equipment fast.';
    }
    return 'Strong buy. Reach out today, inspect within 48 hours.';
  }
  if (tier === 'good_deal') return 'Worth pursuing. Inspect and negotiate — room below asking price.';
  if (tier === 'fair') return 'Market price. Inspect thoroughly; only buy if condition is above spec.';
  if (tier === 'overpriced') return 'Skip or counter with 20%+ below ask. Better deals exist.';
  return 'Avoid. Too many negative signals for the price.';
}

function negotiationNotes(listing: Listing, priceA: PriceAnalysis, urgency: UrgencyAnalysis): string {
  const price = effectivePrice(listing);
  if (!price) return 'No listed price — anchor low in initial conversation.';

  const leverage: string[] = [];
  let discount = 5;

  if (listing.daysOnMarket && listing.daysOnMarket >= 60) {
    leverage.push(`${listing.daysOnMarket} days on market`);
    discount = Math.max(discount, 12);
  }
  if (urgency.signals.includes('bankruptcy')) {
    leverage.push('bankruptcy sale');
    discount = Math.max(discount, 20);
  }
  if (urgency.signals.includes('business_closing')) {
    leverage.push('business closing');
    discount = Math.max(discount, 15);
  }
  if (urgency.signals.includes('divorce_estate')) {
    leverage.push('estate/divorce');
    discount = Math.max(discount, 12);
  }
  if (listing.imageCount <= 2) {
    leverage.push('low visibility listing');
    discount = Math.max(discount, 8);
  }

  const target = price * (1 - discount / 100);
  const leverageStr = leverage.length ? leverage.join(', ') : 'standard negotiation';
  return `Target offer: $${Math.round(target).toLocaleString()} (${discount}% below ask). Leverage: ${leverageStr}.`;
}

// Re-export types used by callers
export type { DealScore, MarketPrice };
