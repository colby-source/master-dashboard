import { effectivePrice, type Listing, type MarketPrice, type PriceComparable } from '../types';

export interface PriceAnalysis {
  listingPrice?: number;
  marketPrice: MarketPrice | null;
  priceVsMarketPct?: number;
  priceScore: number; // 0-35
  isBelowMarket: boolean;
  isSteal: boolean;
  explanation: string;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function buildMarketPrice(
  equipmentType: string,
  make: string,
  model: string,
  comparables: Listing[],
): MarketPrice | null {
  const prices: number[] = [];
  for (const c of comparables) {
    const p = effectivePrice(c);
    if (p && p > 0) prices.push(p);
  }
  if (prices.length < 3) return null;

  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  const avg = mean(sorted);
  const med = median(sorted);
  const sd = stdDev(sorted);
  const p10 = sorted[Math.max(0, Math.floor(n * 0.1) - 1)];
  const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))];

  const years = comparables.map((c) => c.year).filter((y): y is number => typeof y === 'number');

  // Regional analysis
  const statePrices = new Map<string, number[]>();
  for (const l of comparables) {
    const p = effectivePrice(l);
    if (!p || !l.location?.state) continue;
    const arr = statePrices.get(l.location.state) || [];
    arr.push(p);
    statePrices.set(l.location.state, arr);
  }

  const stateAvgs: Array<[string, number]> = [];
  for (const [state, prices] of statePrices.entries()) {
    if (prices.length >= 2) stateAvgs.push([state, mean(prices)]);
  }
  stateAvgs.sort((a, b) => a[1] - b[1]);
  const cheapestStates = stateAvgs.slice(0, 3).map(([s]) => s);
  const mostExpensiveStates = [...stateAvgs].slice(-3).reverse().map(([s]) => s);

  let regionalSpread = 0;
  if (stateAvgs.length >= 2) {
    const low = stateAvgs[0][1];
    const high = stateAvgs[stateAvgs.length - 1][1];
    regionalSpread = low > 0 ? ((high - low) / low) * 100 : 0;
  }

  const priceComparables: PriceComparable[] = comparables
    .filter((l) => effectivePrice(l))
    .slice(0, 50)
    .map((l) => ({
      source: l.source,
      sourceUrl: l.sourceUrl,
      price: effectivePrice(l)!,
      make: l.make || '',
      model: l.model || '',
      year: l.year,
      hours: l.hours,
      condition: l.condition,
      locationState: l.location?.state || '',
    }));

  return {
    equipmentType,
    make,
    model,
    yearRange: years.length ? `${Math.min(...years)}-${Math.max(...years)}` : '',
    avgPrice: avg,
    medianPrice: med,
    lowPrice: p10,
    highPrice: p90,
    priceStdDev: sd,
    sampleSize: n,
    comparables: priceComparables,
    cheapestStates,
    mostExpensiveStates,
    regionalSpreadPct: regionalSpread,
  };
}

export function pricePosition(market: MarketPrice, price: number): number {
  if (market.avgPrice <= 0) return 0;
  return ((price - market.avgPrice) / market.avgPrice) * 100;
}

export function analyzePrice(listing: Listing, market: MarketPrice | null): PriceAnalysis {
  const price = effectivePrice(listing);

  if (price === undefined || price <= 0) {
    return {
      listingPrice: undefined,
      marketPrice: market,
      priceVsMarketPct: undefined,
      priceScore: 5,
      isBelowMarket: false,
      isSteal: false,
      explanation: 'No price listed — contact seller for quote.',
    };
  }

  if (!market || market.avgPrice <= 0) {
    return {
      listingPrice: price,
      marketPrice: null,
      priceVsMarketPct: undefined,
      priceScore: 10,
      isBelowMarket: false,
      isSteal: false,
      explanation: 'Insufficient market data to compare price.',
    };
  }

  const vs = pricePosition(market, price);
  const isBelow = vs <= -10;
  const isSteal = market.lowPrice > 0 && price <= market.lowPrice;

  let score: number;
  if (vs <= -50) score = 35;
  else if (vs <= -30) score = 30 + ((vs + 30) / -20) * 5;
  else if (vs <= -10) score = 18 + ((vs + 10) / -20) * 12;
  else if (vs <= 0) score = 12 + (vs / -10) * 6;
  else if (vs <= 25) score = Math.max(0, 12 - (vs / 25) * 12);
  else score = 0;

  return {
    listingPrice: price,
    marketPrice: market,
    priceVsMarketPct: vs,
    priceScore: score,
    isBelowMarket: isBelow,
    isSteal,
    explanation: explain(price, market, vs, isSteal),
  };
}

function explain(price: number, market: MarketPrice, vs: number, isSteal: boolean): string {
  const priceStr = `$${Math.round(price).toLocaleString()}`;
  const avgStr = `$${Math.round(market.avgPrice).toLocaleString()}`;
  if (isSteal) return `${priceStr} is at/below 10th percentile. Market avg: ${avgStr}. STEAL.`;
  if (vs <= -20) return `${priceStr} is ${Math.abs(vs).toFixed(0)}% below market avg (${avgStr}). Strong deal.`;
  if (vs <= -10) return `${priceStr} is ${Math.abs(vs).toFixed(0)}% below market avg (${avgStr}). Good deal.`;
  if (vs <= 5) return `${priceStr} is close to market avg (${avgStr}). Fair price.`;
  if (vs <= 15) return `${priceStr} is ${vs.toFixed(0)}% above market avg (${avgStr}). Some negotiation room.`;
  return `${priceStr} is ${vs.toFixed(0)}% above market avg (${avgStr}). Overpriced.`;
}
