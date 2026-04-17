import { createLogger } from '../../../utils/logger';
import { effectivePrice, type Listing } from '../types';
import type { EquipmentScraper, ScraperConfig, ScraperResult } from './base';

const log = createLogger('equipment-orchestrator');

export interface OrchestratorResult {
  listings: Listing[];
  totalBeforeDedup: number;
  totalAfterDedup: number;
  sourceResults: ScraperResult[];
  durationMs: number;
}

export class ScraperOrchestrator {
  private scrapers: EquipmentScraper[] = [];

  register(scraper: EquipmentScraper): void {
    this.scrapers.push(scraper);
  }

  get registeredSources(): string[] {
    return this.scrapers.map((s) => s.source);
  }

  async searchAll(config: ScraperConfig, sources?: string[]): Promise<OrchestratorResult> {
    const start = Date.now();
    const active = sources?.length
      ? this.scrapers.filter((s) => sources.includes(s.source))
      : this.scrapers;

    if (active.length === 0) {
      log.warn('No scrapers registered or none matched requested sources');
      return {
        listings: [],
        totalBeforeDedup: 0,
        totalAfterDedup: 0,
        sourceResults: [],
        durationMs: 0,
      };
    }

    const settled = await Promise.allSettled(active.map((s) => s.search(config)));
    const sourceResults: ScraperResult[] = settled.map((r, idx) => {
      if (r.status === 'fulfilled') return r.value;
      log.error('scraper rejected', {
        source: active[idx].source,
        error: String(r.reason),
      });
      return {
        source: active[idx].source,
        listings: [],
        totalFound: 0,
        errors: [`Scraper rejected: ${String(r.reason)}`],
        durationMs: 0,
      };
    });

    const allListings = sourceResults.flatMap((r) => r.listings);
    const deduped = deduplicate(allListings);

    return {
      listings: deduped,
      totalBeforeDedup: allListings.length,
      totalAfterDedup: deduped.length,
      sourceResults,
      durationMs: Date.now() - start,
    };
  }
}

function fingerprint(l: Listing): string {
  return [
    (l.make || '').toLowerCase().trim(),
    (l.model || '').toLowerCase().trim(),
    String(l.year || ''),
    String(l.hours || ''),
    (l.serialNumber || '').toUpperCase().trim(),
  ].join('|');
}

function deduplicate(listings: Listing[]): Listing[] {
  if (!listings.length) return [];

  const seenKeys = new Set<string>();
  const seenSerials = new Set<string>();
  const unique: Listing[] = [];

  for (const l of listings) {
    const key = `${l.source}:${l.sourceId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    if (l.serialNumber) {
      const s = l.serialNumber.toUpperCase().trim();
      if (seenSerials.has(s)) continue;
      seenSerials.add(s);
    }

    if (isFuzzyDuplicate(l, unique)) continue;
    unique.push(l);
  }

  return unique;
}

function isFuzzyDuplicate(candidate: Listing, existing: Listing[]): boolean {
  if (!candidate.make || !candidate.model) return false;
  const candFp = fingerprint(candidate);

  for (const other of existing) {
    if (!other.make || !other.model) continue;
    if (candidate.make.toLowerCase() !== other.make.toLowerCase()) continue;

    const sim = stringSimilarity(candFp, fingerprint(other));
    if (sim < 80) continue;

    const candPrice = effectivePrice(candidate);
    const otherPrice = effectivePrice(other);
    if (candPrice && otherPrice) {
      const avg = (candPrice + otherPrice) / 2;
      if (avg > 0 && Math.abs(candPrice - otherPrice) / avg > 0.15) continue;
    }

    return true;
  }
  return false;
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 100;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const dist = levenshtein(a, b);
  return ((maxLen - dist) / maxLen) * 100;
}

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) dp[i] = [i];
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1;
    }
  }
  return dp[a.length][b.length];
}
