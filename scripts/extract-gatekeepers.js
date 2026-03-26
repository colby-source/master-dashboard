// Extract service providers, advisors, consultants, and gatekeepers from Phase 2 scored data
// These are companies that SERVE family offices — not direct investors, but potential referral partners
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');

const scored = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase2-scored.json'), 'utf-8'));

// Gatekeeper keywords — companies that advise, serve, or connect family offices
const gatekeeperPatterns = [
  'advisor', 'advisors', 'advisory',
  'consultant', 'consultants', 'consulting',
  'services', 'service',
  'resource', 'resources',
  'alliance', 'association', 'network', 'networking',
  'summit', 'conference', 'forum', 'event',
  'law', 'legal', 'attorney',
  'accounting', 'tax',
  'broker', 'brokerage',
  'placement', 'placement agent',
  'fundraising', 'capital raising',
  'intermediary', 'intermediaries',
  'matchmaking',
  'concierge',
  'administrator', 'administration',
  'compliance',
  'governance',
  'outsourced cio', 'ocio',
  'wealth planning',
  'estate planning',
  'philanthropy', 'philanthropic',
  'foundation services',
];

// Also check AI reasoning for service provider signals
const reasoningSignals = [
  'service provider', 'advisor', 'consultant', 'broker',
  'not an investor', 'not an investment', 'not deploying capital',
  'intermediary', 'networking', 'conference', 'event',
  'law firm', 'legal', 'advisory firm',
  'placement agent', 'capital raising',
  'serves family offices', 'serving family offices',
  'administrator', 'administration',
];

const gatekeepers = [];
const seen = new Set();

for (const company of scored) {
  const name = (company.company || '').toLowerCase();
  const reasoning = (company.reasoning || '').toLowerCase();
  const category = (company.category || '').toLowerCase();

  // Skip if already a high scorer (real investor)
  if (company.score >= 7) continue;

  let isGatekeeper = false;
  let matchedSignals = [];

  // Check company name
  for (const pattern of gatekeeperPatterns) {
    if (name.includes(pattern)) {
      isGatekeeper = true;
      matchedSignals.push(`name:${pattern}`);
    }
  }

  // Check AI reasoning
  for (const signal of reasoningSignals) {
    if (reasoning.includes(signal)) {
      isGatekeeper = true;
      matchedSignals.push(`reasoning:${signal}`);
    }
  }

  // Check if categorized as non_investor but has family office / real estate in name
  if (category === 'non_investor' && (name.includes('family') || name.includes('real estate') || name.includes('wealth'))) {
    isGatekeeper = true;
    matchedSignals.push('category:non_investor+relevant_name');
  }

  if (isGatekeeper && !seen.has(name)) {
    seen.add(name);
    gatekeepers.push({
      company: company.company,
      originalScore: company.score,
      originalCategory: company.category,
      originalReasoning: company.reasoning,
      matchedSignals: [...new Set(matchedSignals)],
    });
  }
}

// Sort by number of signals (most likely gatekeepers first)
gatekeepers.sort((a, b) => b.matchedSignals.length - a.matchedSignals.length);

console.log(`Found ${gatekeepers.length} potential gatekeepers/service providers\n`);

// Show distribution
const byScore = {};
for (const g of gatekeepers) {
  const bucket = g.originalScore <= 2 ? '1-2' : g.originalScore <= 4 ? '3-4' : '5-6';
  byScore[bucket] = (byScore[bucket] || 0) + 1;
}
console.log('By original score:', byScore);

// Show samples
console.log('\nTop 15 samples:');
gatekeepers.slice(0, 15).forEach(g => {
  console.log(`  [${g.originalScore}] ${g.company} — ${g.originalReasoning}`);
  console.log(`       Signals: ${g.matchedSignals.join(', ')}`);
});

// Save for rescoring
const outPath = path.join(dataDir, 'gatekeepers-to-rescore.json');
fs.writeFileSync(outPath, JSON.stringify(gatekeepers, null, 2));
console.log(`\nSaved: ${outPath}`);
