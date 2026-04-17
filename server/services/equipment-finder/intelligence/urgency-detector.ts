import type { DealSignal } from '../types';

export interface UrgencyAnalysis {
  signals: DealSignal[];
  urgencyScore: number; // 0-20
  matchedPhrases: string[];
  explanation: string;
}

// Signal → (patterns, weight)
const PATTERNS: Array<[DealSignal, RegExp[], number]> = [
  ['bankruptcy', [
    /\b(bankrupt(?:cy)?|chapter\s*(?:7|11|13))\b/i,
    /\btrustee\s+sale\b/i,
    /\breceiver(?:ship)?\b/i,
  ], 8.0],
  ['business_closing', [
    /\bgoing\s+out\s+of\s+business\b/i,
    /\bbusiness\s+(?:closing|closed|shutdown|shutting\s+down)\b/i,
    /\bshop\s+(?:closing|closed)\b/i,
    /\bliquidation\b/i,
    /\bretiring\b/i,
    /\bfinal\s+liquidation\b/i,
  ], 7.0],
  ['divorce_estate', [
    /\bdivorce\b/i,
    /\bestate\s+sale\b/i,
    /\bdeceased\b/i,
    /\bpassed\s+away\b/i,
    /\bsettling\s+estate\b/i,
  ], 6.0],
  ['moving', [
    /\b(moving|relocating)\s+(must\s+sell|sale|soon)\b/i,
    /\bmoving\s+out\s+of\s+(state|country)\b/i,
  ], 4.0],
  ['price_drop', [
    /\bprice\s+(?:drop(?:ped)?|reduced|lowered)\b/i,
    /\bwas\s+\$[\d,]+\s+now\s+\$[\d,]+\b/i,
  ], 4.0],
  ['must_sell', [
    /\bmust\s+(?:sell|go)\b/i,
    /\b(?:make|bring)\s+(?:me\s+)?(?:an\s+)?offer\b/i,
    /\b(?:obo|o\.?b\.?o\.?)\b/i,
    /\ball\s+offers\s+considered\b/i,
    /\bnegotiable\b/i,
    /\bneed\s+gone\b/i,
    /\btake(?:\s+the)?\s+best\s+offer\b/i,
    /\burgent\s+sale\b/i,
    /\bpriced\s+to\s+sell\b/i,
    /\breduced(?:\s+price)?\b/i,
  ], 3.0],
];

export function analyzeUrgency(title: string, description = ''): UrgencyAnalysis {
  const text = `${title} ${description}`;
  const signals: DealSignal[] = [];
  const matched: string[] = [];
  let score = 0;

  for (const [signal, patterns, weight] of PATTERNS) {
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m) {
        signals.push(signal);
        matched.push(m[0]);
        score += weight;
        break; // One match per signal
      }
    }
  }

  score = Math.min(score, 20);

  return {
    signals,
    urgencyScore: score,
    matchedPhrases: matched,
    explanation: buildExplanation(signals),
  };
}

function buildExplanation(signals: DealSignal[]): string {
  if (signals.length === 0) return 'No urgency signals detected.';
  const parts: string[] = [];
  if (signals.includes('bankruptcy')) parts.push('Bankruptcy/trustee sale — strong leverage');
  if (signals.includes('business_closing')) parts.push('Business closing/liquidation — seller exiting');
  if (signals.includes('divorce_estate')) parts.push('Divorce/estate — typically below-market pricing');
  if (signals.includes('moving')) parts.push('Seller relocating — deadline pressure');
  if (signals.includes('price_drop')) parts.push('Price already reduced — more room to negotiate');
  if (
    signals.includes('must_sell') &&
    !signals.includes('bankruptcy') &&
    !signals.includes('business_closing')
  ) {
    parts.push('Explicit urgency language — open to offers');
  }
  return parts.length ? parts.join(' | ') : 'Urgency signals present.';
}
