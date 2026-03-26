// Extract TRUE gatekeepers — companies that specifically serve family offices or RE investors
// Not generic accounting/tax firms, only those with direct FO/RE connection
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');
const scored = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase2-scored.json'), 'utf-8'));

// Must have at least one of these in company name OR reasoning to be a gatekeeper
const foReConnection = [
  'family office', 'family offices',
  'family wealth',
  'real estate',
  'wealth management', 'wealth advisory',
  'private wealth',
  'uhnw', 'ultra high net worth', 'high net worth',
  'endowment', 'foundation',
  'institutional',
  'alternative investment',
  'alternatives',
  'private capital',
  'capital advisory',
  'placement agent',
  'fund placement',
  'capital raising',
  'investor relations',
  'asset allocation',
  'investment consulting',
  'investment advisory',
  'ocio', 'outsourced cio',
  'fund of funds',
  'multi-family office', 'multi family office', 'mfo',
];

// Service/gatekeeper role indicators
const serviceRole = [
  'advisor', 'advisory', 'advisors',
  'consultant', 'consulting',
  'services', 'service provider',
  'broker', 'brokerage',
  'intermediary',
  'placement',
  'network', 'networking', 'alliance',
  'summit', 'conference', 'forum',
  'law', 'legal', 'attorney',
  'administration', 'administrator',
  'concierge',
  'governance',
  'compliance',
  'platform',
  'matchmaking',
  'resource group',
];

const gatekeepers = [];
const seen = new Set();

for (const company of scored) {
  const name = (company.company || '').toLowerCase();
  const reasoning = (company.reasoning || '').toLowerCase();
  const combined = name + ' ' + reasoning;

  // Skip high scorers (already tagged as real investors)
  if (company.score >= 7) continue;

  // Must have FO/RE connection
  const hasFoReConnection = foReConnection.some(p => combined.includes(p));
  if (!hasFoReConnection) continue;

  // Must have service/gatekeeper role indicator
  const hasServiceRole = serviceRole.some(p => combined.includes(p));
  if (!hasServiceRole) continue;

  if (seen.has(name)) continue;
  seen.add(name);

  const foSignals = foReConnection.filter(p => combined.includes(p));
  const roleSignals = serviceRole.filter(p => combined.includes(p));

  gatekeepers.push({
    company: company.company,
    originalScore: company.score,
    originalCategory: company.category,
    originalReasoning: company.reasoning,
    foConnection: foSignals,
    serviceRole: roleSignals,
  });
}

gatekeepers.sort((a, b) => (b.foConnection.length + b.serviceRole.length) - (a.foConnection.length + a.serviceRole.length));

console.log(`Found ${gatekeepers.length} true gatekeepers/service providers\n`);

const byScore = { '1-2': 0, '3-4': 0, '5-6': 0 };
for (const g of gatekeepers) {
  const bucket = g.originalScore <= 2 ? '1-2' : g.originalScore <= 4 ? '3-4' : '5-6';
  byScore[bucket]++;
}
console.log('By original score:', byScore);

console.log('\nSamples:');
gatekeepers.slice(0, 20).forEach(g => {
  console.log(`  [${g.originalScore}] ${g.company}`);
  console.log(`       FO/RE: ${g.foConnection.join(', ')}`);
  console.log(`       Role: ${g.serviceRole.join(', ')}`);
});

const outPath = path.join(dataDir, 'gatekeepers-to-rescore.json');
fs.writeFileSync(outPath, JSON.stringify(gatekeepers, null, 2));
console.log(`\nSaved: ${outPath}`);
