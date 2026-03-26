// Reclassify gatekeepers — move allocators back to main LP pipeline
// Only true service-only companies stay as separate campaign
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');

const gatekeepers = JSON.parse(fs.readFileSync(path.join(dataDir, 'gatekeepers-final.json'), 'utf-8'));
const phase3Companies = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase3-companies.json'), 'utf-8'));
const phase2Scored = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase2-scored.json'), 'utf-8'));

// Types that CAN allocate capital (should be in main LP pipeline)
const allocatorTypes = [
  'mfo',                  // Multi-family offices — allocate for multiple families
  'ocio',                 // Outsourced CIO — literally make allocation decisions
  'fund_of_funds',        // Buy into RE funds as core business
  'fo_network',           // Many are actually MFOs or can allocate
  'wealth_advisor_uhnw',  // UHNW advisors influence/make allocation decisions
  'ria',                  // RIAs with alts practice allocate client capital
  'investment_consultant', // Advise on allocations, many have discretion
];

// Types that are separate campaign (service providers, paid relationships)
const separateCampaignTypes = [
  'placement_agent',      // You'd pay them a fee — different relationship
  'conference',           // Event sponsorship, not LP relationship
  'legal',                // Law firms
  'accounting',           // Accounting firms
];

// Reclassify
const backToLP = [];
const separateCampaign = [];
const notUseful = [];

for (const gk of gatekeepers) {
  const type = gk.gatekeeperType || '';
  const score = gk.gatekeeperScore || 0;

  if (allocatorTypes.includes(type) && score >= 5) {
    backToLP.push(gk);
  } else if (separateCampaignTypes.includes(type) && score >= 5) {
    separateCampaign.push(gk);
  } else if (type === 'wealth_advisor_hnw' && score >= 7) {
    // High-scoring HNW advisors may still have UHNW clients
    backToLP.push(gk);
  } else if (type === 're_broker' && score >= 7) {
    // RE brokers who know RE investors well
    backToLP.push(gk);
  } else if (type === 'fo_services' && score >= 7) {
    // FO service providers with deep FO relationships
    separateCampaign.push(gk);
  } else if (score <= 4) {
    notUseful.push(gk);
  } else {
    // Moderate scores, keep as separate outreach
    separateCampaign.push(gk);
  }
}

console.log('=== RECLASSIFICATION ===\n');
console.log(`Back to main LP pipeline: ${backToLP.length}`);
console.log(`Separate campaign (placement agents, services): ${separateCampaign.length}`);
console.log(`Not useful: ${notUseful.length}`);

// Break down what's going back to LP
const lpByType = {};
backToLP.forEach(g => { lpByType[g.gatekeeperType] = (lpByType[g.gatekeeperType] || 0) + 1; });
console.log('\nBack to LP breakdown:', lpByType);

const sepByType = {};
separateCampaign.forEach(g => { sepByType[g.gatekeeperType] = (sepByType[g.gatekeeperType] || 0) + 1; });
console.log('Separate campaign breakdown:', sepByType);

// Add allocator gatekeepers back to Phase 3 companies list
const existingP3Names = new Set(phase3Companies.map(c => c.company.toLowerCase()));
const p2Map = new Map();
for (const r of phase2Scored) {
  p2Map.set((r.company || '').toLowerCase(), r);
}

let added = 0;
for (const gk of backToLP) {
  const nameLower = (gk.company || '').toLowerCase();
  if (existingP3Names.has(nameLower)) continue;

  // Create Phase 3 entry with boosted score based on gatekeeper analysis
  phase3Companies.push({
    company: gk.company,
    aiScore: Math.max(gk.gatekeeperScore, (p2Map.get(nameLower) || {}).score || 0),
    aiCategory: gk.gatekeeperType,
    aiReasoning: gk.reasoning,
    gatekeeperScore: gk.gatekeeperScore,
    gatekeeperType: gk.gatekeeperType,
    referralPotential: gk.referralPotential,
    isAllocator: true,
    leadCount: 0,
    sampleLeads: [],
    states: [],
  });
  added++;
}

phase3Companies.sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0));

console.log(`\nAdded ${added} allocator companies to Phase 3 (${phase3Companies.length} total now)`);

// Save updated Phase 3
fs.writeFileSync(path.join(dataDir, 'phase3-companies.json'), JSON.stringify(phase3Companies, null, 2));

// Save separate campaign list (placement agents + services)
fs.writeFileSync(path.join(dataDir, 'separate-campaign-partners.json'), JSON.stringify(separateCampaign, null, 2));
console.log(`Saved separate campaign: ${separateCampaign.length} companies`);

// Show separate campaign highlights
console.log('\n=== SEPARATE CAMPAIGN (placement agents, paid services) ===');
separateCampaign.filter(g => g.gatekeeperType === 'placement_agent').forEach(g => {
  console.log(`  [${g.gatekeeperScore}] ${g.company} (${g.gatekeeperType}) — ${g.reasoning}`);
});
