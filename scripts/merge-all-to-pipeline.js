// Merge ALL gatekeepers with score >= 5 back into the main Phase 3 pipeline
// Anyone who could help get investment — direct LP, allocator, placement agent, advisor, anyone
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');

const gatekeepers = JSON.parse(fs.readFileSync(path.join(dataDir, 'gatekeepers-final.json'), 'utf-8'));
const phase3Companies = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase3-companies.json'), 'utf-8'));

const existingP3Names = new Set(phase3Companies.map(c => c.company.toLowerCase()));

let added = 0;
for (const gk of gatekeepers) {
  const score = gk.gatekeeperScore || 0;
  if (score < 5) continue;

  const nameLower = (gk.company || '').toLowerCase();
  if (existingP3Names.has(nameLower)) continue;

  phase3Companies.push({
    company: gk.company,
    aiScore: score,
    aiCategory: gk.gatekeeperType,
    aiReasoning: gk.reasoning,
    gatekeeperScore: score,
    gatekeeperType: gk.gatekeeperType,
    referralPotential: gk.referralPotential,
    isGatekeeper: true,
    leadCount: 0,
    sampleLeads: [],
    states: [],
  });
  existingP3Names.add(nameLower);
  added++;
}

phase3Companies.sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0));

fs.writeFileSync(path.join(dataDir, 'phase3-companies.json'), JSON.stringify(phase3Companies, null, 2));

console.log(`Added ${added} more companies to Phase 3`);
console.log(`Total Phase 3 companies: ${phase3Companies.length}`);
console.log(`\nGatekeeper breakdown of additions:`);
const byType = {};
gatekeepers.filter(g => (g.gatekeeperScore || 0) >= 5).forEach(g => {
  byType[g.gatekeeperType] = (byType[g.gatekeeperType] || 0) + 1;
});
Object.entries(byType).sort((a,b) => b[1]-a[1]).forEach(([t,c]) => console.log(`  ${t}: ${c}`));
