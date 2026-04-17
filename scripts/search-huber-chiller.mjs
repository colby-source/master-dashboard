// Throwaway harness to run the new Equipment Finder scrapers directly.
// Uses the built output from `npm run build` (dist/server/).
import { equipmentFinderService } from '../dist/server/services/equipment-finder/equipment-finder-service.js';

const query = process.argv[2] || 'huber unistat 815 -80 recirculating chiller cannabis';
console.log(`\n[SEARCH] "${query}"\n`);

const start = Date.now();
try {
  const result = await equipmentFinderService.search(query, {
    topN: 20,
    minScore: 20,
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Query parsed: type=${result.query.equipmentType} make=${result.query.make}`);
  console.log(`Sources searched: ${result.sourcesSearched.join(', ')}`);
  console.log(`Total found: ${result.totalFound}`);
  console.log(`Duration: ${(Date.now() - start) / 1000}s`);
  console.log(`Market: ${result.marketSummary}`);
  console.log(`\n=== TOP ${result.ranked.length} RANKED ===`);

  for (const r of result.ranked) {
    const l = r.listing;
    const d = r.dealScore;
    const price =
      l.price ? `$${l.price.toLocaleString()}` :
      l.currentBid ? `bid $${l.currentBid.toLocaleString()}` :
      l.startingBid ? `open $${l.startingBid.toLocaleString()}` :
      '—';
    const loc = l.location?.state || '—';
    console.log(
      `\n[${d.score.toFixed(0)} ${d.tier}] ${l.source} | ${price} | ${loc} ` +
      `${l.isAuction ? '(AUCTION' + (l.auctionEndTime ? ` ends ${l.auctionEndTime}` : '') + ')' : ''}`,
    );
    console.log(`  ${l.title.substring(0, 150)}`);
    console.log(`  ${l.sourceUrl}`);
    if (d.signals.length) console.log(`  signals: ${d.signals.map((s) => s.signal).join(', ')}`);
    if (d.summary) console.log(`  → ${d.summary}`);
  }
} catch (err) {
  console.error('[ERROR]', err);
  process.exit(1);
}
process.exit(0);
