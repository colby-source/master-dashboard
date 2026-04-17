import crypto from 'crypto';
import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';
import { scoreDeal, type ScoringContext } from './intelligence/deal-scorer';
import { buildMarketPrice } from './intelligence/price-engine';
import { expandQuery } from './intelligence/query-expander';
import { CraigslistScraper } from './scrapers/craigslist-scraper';
import { FacebookMarketplaceScraper } from './scrapers/facebook-marketplace-scraper';
import { BidspotterScraper } from './scrapers/bidspotter-scraper';
import { Future4200Scraper } from './scrapers/future4200-scraper';
import { GovDealsScraper } from './scrapers/govdeals-scraper';
import { EbayScraper } from './scrapers/ebay-scraper';
import { LabXScraper } from './scrapers/labx-scraper';
import { MachinioScraper } from './scrapers/machinio-scraper';
import { RitchieBrosScraper } from './scrapers/ritchie-bros-scraper';
import { IronPlanetScraper } from './scrapers/ironplanet-scraper';
import { PurpleWaveScraper } from './scrapers/purple-wave-scraper';
import { BigIronScraper } from './scrapers/bigiron-scraper';
import { ProxibidScraper } from './scrapers/proxibid-scraper';
import { MachineryTraderScraper } from './scrapers/machinery-trader-scraper';
import { EquipmentTraderScraper } from './scrapers/equipment-trader-scraper';
import { Property420Scraper } from './scrapers/property420-scraper';
import { UrthFyreScraper } from './scrapers/urth-fyre-scraper';
import { HilcoScraper } from './scrapers/hilco-scraper';
import { RedditScraper } from './scrapers/reddit-scraper';
import { ScraperOrchestrator } from './scrapers/orchestrator';
import type { DealScore, Listing, SearchQuery } from './types';

const log = createLogger('equipment-finder-service');

export interface RankedListing {
  listing: Listing;
  dealScore: DealScore;
}

export interface EquipmentSearchResult {
  query: SearchQuery;
  ranked: RankedListing[];
  totalFound: number;
  sourcesSearched: string[];
  marketSummary: string;
  durationMs: number;
}

class EquipmentFinderService {
  private orchestrator: ScraperOrchestrator | null = null;

  private getOrchestrator(): ScraperOrchestrator {
    if (this.orchestrator) return this.orchestrator;
    const o = new ScraperOrchestrator();

    // Apify-backed scrapers (require APIFY_API_KEY)
    if (config.apifyApiKey) {
      o.register(new CraigslistScraper());
      o.register(new FacebookMarketplaceScraper());
    } else {
      log.warn('APIFY_API_KEY not set — Apify scrapers disabled');
    }

    // HTTP/HTML scrapers — always available, no external service required
    o.register(new BidspotterScraper());
    o.register(new Future4200Scraper());
    o.register(new GovDealsScraper());
    o.register(new EbayScraper());
    o.register(new LabXScraper());
    o.register(new MachinioScraper());
    o.register(new RitchieBrosScraper());
    o.register(new IronPlanetScraper());
    o.register(new PurpleWaveScraper());
    o.register(new BigIronScraper());
    o.register(new ProxibidScraper());
    o.register(new MachineryTraderScraper());
    o.register(new EquipmentTraderScraper());
    o.register(new Property420Scraper());
    o.register(new UrthFyreScraper());
    o.register(new HilcoScraper());
    o.register(new RedditScraper());

    this.orchestrator = o;
    return o;
  }

  get registeredSources(): string[] {
    return this.getOrchestrator().registeredSources;
  }

  async search(
    rawQuery: string,
    opts: { topN?: number; minScore?: number; sources?: string[] } = {},
  ): Promise<EquipmentSearchResult> {
    const start = Date.now();
    const orchestrator = this.getOrchestrator();

    // 1. Expand query via Claude
    const query = await expandQuery(rawQuery);

    // 2. Scrape all sources
    const scraped = await orchestrator.searchAll(
      {
        query: query.equipmentType || query.rawQuery,
        maxResults: 200,
        zipCode: query.zipCode,
        radiusMiles: query.radiusMiles,
        priceMin: query.priceMin,
        priceMax: query.priceMax,
        yearMin: query.yearMin,
        yearMax: query.yearMax,
      },
      opts.sources,
    );

    const allListings = scraped.listings;

    // 3. Build market price baseline from current results
    const market =
      allListings.length >= 5
        ? buildMarketPrice(
            query.equipmentType || 'equipment',
            query.make || '',
            query.model || '',
            allListings,
          )
        : null;

    const ctx: ScoringContext = { marketPrice: market };

    // 4. Score every listing
    const ranked: RankedListing[] = [];
    for (const listing of allListings) {
      try {
        const dealScore = scoreDeal(listing, ctx);
        if (dealScore.score >= (opts.minScore ?? 0)) {
          ranked.push({ listing, dealScore });
        }
      } catch (err) {
        log.error('scoring failed', { listingId: listing.id, error: String(err) });
      }
    }

    ranked.sort((a, b) => b.dealScore.score - a.dealScore.score);
    const top = ranked.slice(0, opts.topN ?? 10);

    // 5. Persist results + history
    await this.persistResults(allListings, ranked.map((r) => r.dealScore));
    await this.logSearch(query, allListings.length, top[0]?.dealScore.score, scraped.sourceResults.map((r) => r.source), Date.now() - start);

    return {
      query,
      ranked: top,
      totalFound: allListings.length,
      sourcesSearched: scraped.sourceResults.map((r) => r.source),
      marketSummary: buildMarketSummary(query, allListings, ranked),
      durationMs: Date.now() - start,
    };
  }

  private async persistResults(listings: Listing[], scores: DealScore[]): Promise<void> {
    try {
      for (const l of listings) {
        runSql(
          `INSERT INTO equipment_listings
           (id, source, source_id, source_url, title, description, category, make, model, year, hours, mileage, serial_number,
            price, is_auction, auction_end_time, current_bid, buy_now_price, condition,
            location_city, location_state, location_zip, location_lat, location_lng,
            seller_name, seller_is_dealer, seller_url,
            image_urls, image_count, listed_date, days_on_market, scraped_at, last_seen_at, raw_data,
            starting_bid, buyer_premium_pct, lot_number, auction_house, bidding_opens_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source, source_id) DO UPDATE SET
             title = excluded.title,
             description = excluded.description,
             price = excluded.price,
             current_bid = excluded.current_bid,
             image_count = excluded.image_count,
             days_on_market = excluded.days_on_market,
             last_seen_at = excluded.last_seen_at,
             auction_end_time = excluded.auction_end_time,
             starting_bid = excluded.starting_bid`,
          [
            l.id,
            l.source,
            l.sourceId,
            l.sourceUrl,
            l.title,
            l.description,
            l.category,
            l.make ?? null,
            l.model ?? null,
            l.year ?? null,
            l.hours ?? null,
            l.mileage ?? null,
            l.serialNumber ?? null,
            l.price ?? null,
            l.isAuction ? 1 : 0,
            l.auctionEndTime ?? null,
            l.currentBid ?? null,
            l.buyNowPrice ?? null,
            l.condition,
            l.location?.city ?? null,
            l.location?.state ?? null,
            l.location?.zipCode ?? null,
            l.location?.latitude ?? null,
            l.location?.longitude ?? null,
            l.seller?.name ?? null,
            l.seller?.isDealer ? 1 : 0,
            l.seller?.sellerUrl ?? null,
            JSON.stringify(l.imageUrls),
            l.imageCount,
            l.listedDate ?? null,
            l.daysOnMarket ?? null,
            l.scrapedAt,
            new Date().toISOString(),
            l.rawData ? JSON.stringify(l.rawData) : null,
            l.startingBid ?? null,
            l.buyerPremiumPct ?? null,
            l.lotNumber ?? null,
            l.auctionHouse ?? null,
            l.biddingOpensAt ?? null,
          ],
        );
      }

      for (const s of scores) {
        runSql(
          `INSERT INTO equipment_deal_scores
           (listing_id, score, tier, price_score, urgency_score, hidden_score, quality_score, geo_score, seller_score,
            price_vs_market_pct, market_avg_price, comparable_count, signals, summary, suggested_action, negotiation_notes, scored_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(listing_id) DO UPDATE SET
             score = excluded.score,
             tier = excluded.tier,
             signals = excluded.signals,
             summary = excluded.summary,
             suggested_action = excluded.suggested_action,
             negotiation_notes = excluded.negotiation_notes,
             scored_at = excluded.scored_at`,
          [
            s.listingId,
            s.score,
            s.tier,
            s.priceScore,
            s.urgencyScore,
            s.hiddenScore,
            s.qualityScore,
            s.geoScore,
            s.sellerScore,
            s.priceVsMarketPct ?? null,
            s.marketAvgPrice ?? null,
            s.comparableCount,
            JSON.stringify(s.signals),
            s.summary,
            s.suggestedAction,
            s.negotiationNotes,
            new Date().toISOString(),
          ],
        );
      }
      saveDb();
    } catch (err) {
      log.error('persist failed', { error: String(err) });
    }
  }

  private async logSearch(
    query: SearchQuery,
    totalFound: number,
    topScore: number | undefined,
    sources: string[],
    durationMs: number,
  ): Promise<void> {
    try {
      runSql(
        `INSERT INTO equipment_search_history (id, raw_query, parsed_query, total_found, top_score, sources_searched, duration_ms, searched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          query.rawQuery,
          JSON.stringify(query),
          totalFound,
          topScore ?? null,
          JSON.stringify(sources),
          durationMs,
          new Date().toISOString(),
        ],
      );
      saveDb();
    } catch (err) {
      log.error('log search failed', { error: String(err) });
    }
  }

  getRecentSearches(limit = 20): any[] {
    return queryAll(
      `SELECT id, raw_query, total_found, top_score, sources_searched, duration_ms, searched_at
       FROM equipment_search_history
       ORDER BY searched_at DESC
       LIMIT ?`,
      [limit],
    );
  }

  getTopCachedDeals(limit = 20): any[] {
    return queryAll(
      `SELECT l.*, d.score, d.tier, d.summary, d.suggested_action, d.negotiation_notes, d.price_vs_market_pct, d.signals
       FROM equipment_listings l
       JOIN equipment_deal_scores d ON d.listing_id = l.id
       ORDER BY d.score DESC
       LIMIT ?`,
      [limit],
    );
  }
}

function buildMarketSummary(query: SearchQuery, listings: Listing[], ranked: RankedListing[]): string {
  const priced = listings
    .map((l) => (l.price && l.price > 0 ? l.price : l.currentBid && l.currentBid > 0 ? l.currentBid : undefined))
    .filter((p): p is number => p !== undefined);
  if (!priced.length) return `Found ${listings.length} listings — none had prices listed.`;

  const avg = priced.reduce((a, b) => a + b, 0) / priced.length;
  const low = Math.min(...priced);
  const high = Math.max(...priced);
  const steals = ranked.filter((r) => r.dealScore.tier === 'steal').length;
  const great = ranked.filter((r) => r.dealScore.tier === 'great_deal').length;

  let out = `Found ${listings.length} ${query.equipmentType || 'listings'}. `;
  out += `Price range: $${Math.round(low).toLocaleString()}–$${Math.round(high).toLocaleString()}. Avg: $${Math.round(avg).toLocaleString()}. `;
  if (steals > 0) out += `🔥 ${steals} STEALS identified. `;
  if (great > 0) out += `${great} great deals. `;
  return out.trim();
}

export const equipmentFinderService = new EquipmentFinderService();
