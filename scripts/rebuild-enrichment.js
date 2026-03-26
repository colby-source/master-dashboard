const fs = require('fs');
const dir = 'c:/Users/colby/Repos/master-dashboard/data/family-office-scrape';

// Load all data
const qualified = JSON.parse(fs.readFileSync(dir + '/phase1-qualified.json'));
const rejected = JSON.parse(fs.readFileSync(dir + '/phase1-rejected.json'));
const final = JSON.parse(fs.readFileSync(dir + '/phase3-final-leads.json'));
const phase2 = JSON.parse(fs.readFileSync(dir + '/phase2-scored.json'));
const researched = JSON.parse(fs.readFileSync(dir + '/phase3-researched.json'));
const gatekeepers = JSON.parse(fs.readFileSync(dir + '/gatekeepers-final.json'));

console.log('=== LOADING DATA ===');
console.log('Phase 1 qualified:', qualified.length);
console.log('Phase 1 rejected:', rejected.length);
console.log('Phase 3 final leads:', final.length);
console.log('Gatekeepers:', gatekeepers.length);

// ============================================================
// STEP 1: Re-evaluate Phase 1 rejects
// Only exclude TRUE institutional employees (big banks, big 4 accounting, etc.)
// ============================================================

const institutionalCompanies = [
  // Big banks / wirehouses
  'j.p. morgan', 'jpmorgan', 'goldman sachs', 'morgan stanley', 'bank of america',
  'merrill lynch', 'wells fargo', 'citibank', 'citigroup', 'citi ', 'barclays',
  'hsbc', 'deutsche bank', 'credit suisse', 'ubs ', 'bnp paribas', 'societe generale',
  // Asset managers (huge institutional)
  'blackrock', 'vanguard', 'fidelity investments', 'state street', 'invesco',
  'franklin templeton', 't. rowe price', 'pimco', 'schroders',
  // Big 4 / large accounting
  'deloitte', 'pricewaterhousecoopers', 'pwc', 'ernst & young', 'kpmg',
  'grant thornton', 'rsm ', 'bdo usa', 'eisneramper', 'crowe ',
  // Custodians
  'charles schwab', 'td ameritrade', 'pershing', 'bny mellon',
  // Insurance giants
  'metlife', 'prudential financial', 'aig ', 'allstate', 'state farm',
];

// Titles that indicate someone who CAN'T allocate (even at non-institutional firms)
const excludeTitles = [
  'human resources', ' hr ', 'recruiter', 'talent acquisition',
  'janitor', 'custodian', 'receptionist', 'intern ',
  'art director', 'graphic design', 'web developer', 'software engineer',
  'it manager', 'it director', 'information technology',
  'compliance officer', 'compliance director', // can't allocate, just enforce rules
];

// Titles that indicate someone who CAN allocate or influence allocation
const keepTitles = [
  'managing director', 'partner', 'principal', 'founder', 'president', 'ceo',
  'chief investment', 'cio', 'cfo', 'chief financial', 'portfolio manager',
  'head of', 'director of investments', 'director of real estate',
  'family office', 'private wealth', 'private client', 'wealth management',
  'investment officer', 'investment director', 'investment manager',
  'vice president', 'senior vice president', 'svp', 'evp',
  'advisor', 'adviser', 'consultant', 'trustee', 'chairman', 'board',
  'private bank', 'private capital', 'allocat',
];

let recovered = [];
let trueInstitutional = [];

rejected.forEach(lead => {
  const company = (lead.company || '').toLowerCase();
  const title = (lead.title || '').toLowerCase();

  // Check if company is a big institution
  const isInstitutional = institutionalCompanies.some(inst => company.includes(inst));

  // Check if title is clearly non-investment
  const isExcludedTitle = excludeTitles.some(t => title.includes(t));

  // Check if title indicates investment decision-maker
  const isKeepTitle = keepTitles.some(t => title.includes(t));

  if (isInstitutional && !isKeepTitle) {
    // Institutional employee without investment title — skip
    trueInstitutional.push(lead);
  } else if (isExcludedTitle && !isKeepTitle) {
    // Non-investment role — skip
    trueInstitutional.push(lead);
  } else {
    // Everyone else gets recovered
    recovered.push(lead);
  }
});

console.log('\n=== PHASE 1 RE-EVALUATION ===');
console.log('True institutional (excluded):', trueInstitutional.length);
console.log('Recovered leads:', recovered.length);

// Sample recovered
console.log('\nSample recovered from Phase 1 rejects:');
recovered.sort(() => Math.random() - 0.5).slice(0, 15).forEach(l => {
  console.log('  ' + (l.title || '').substring(0, 60) + ' @ ' + l.company);
});

// Sample excluded
console.log('\nSample still excluded (institutional):');
trueInstitutional.sort(() => Math.random() - 0.5).slice(0, 15).forEach(l => {
  console.log('  ' + (l.title || '').substring(0, 60) + ' @ ' + l.company);
});

// ============================================================
// STEP 2: Rebuild enrichment candidates from ALL sources
// Include anyone who could potentially invest in GPC
// ============================================================

// Build a set of all leads we already have in final
const finalSet = new Set(final.map(l => (l.fullName || '') + '|' + (l.company || '')));

// From Phase 3 final leads: include everyone EXCEPT:
// - webCategory === 'not_investor' with low score
// - webCategory === 'defunct'
// - combinedScore < 10 AND no positive web signal
const fromFinal = final.filter(l => {
  const combined = l.combinedScore || 0;
  const webCat = l.webCategory || '';
  const webScore = l.webScore || 0;

  // Always exclude defunct
  if (webCat === 'defunct') return false;

  // If web research confirmed not an investor AND score is very low, skip
  if (webCat === 'not_investor' && webScore <= 2 && combined < 15) return false;

  // Everyone else could potentially invest
  return true;
});

console.log('\n=== STEP 2: REBUILD FROM FINAL ===');
console.log('From Phase 3 final (after removing only defunct + confirmed-not-investor-low-score):', fromFinal.length);

// ============================================================
// STEP 3: Add recovered Phase 1 rejects
// ============================================================

// Merge recovered leads (they won't have Phase 2/3 scores)
const allLeads = [...fromFinal];
const existingKeys = new Set(allLeads.map(l => ((l.fullName || l.firstName + ' ' + l.lastName) + '|' + l.company).toLowerCase()));

let addedFromRejects = 0;
recovered.forEach(l => {
  const key = ((l.fullName || l.firstName + ' ' + l.lastName) + '|' + l.company).toLowerCase();
  if (!existingKeys.has(key)) {
    allLeads.push({
      ...l,
      source: 'recovered_from_phase1_reject',
      combinedScore: 15, // baseline score — they passed broad filter
      phase2Score: null,
      webScore: null,
      webCategory: null,
    });
    existingKeys.add(key);
    addedFromRejects++;
  }
});

console.log('Added from Phase 1 rejects:', addedFromRejects);

// ============================================================
// STEP 4: Add gatekeepers with score >= 5
// ============================================================

let addedGatekeepers = 0;
gatekeepers.forEach(g => {
  if ((g.gatekeeperScore || 0) < 5) return;
  // Check all leads for this company
  const companyLeads = qualified.filter(l => l.company === g.company);
  companyLeads.forEach(l => {
    const key = ((l.fullName || l.firstName + ' ' + l.lastName) + '|' + l.company).toLowerCase();
    if (!existingKeys.has(key)) {
      allLeads.push({
        ...l,
        source: 'gatekeeper',
        gatekeeperScore: g.gatekeeperScore,
        gatekeeperType: g.type,
        combinedScore: Math.max(g.gatekeeperScore * 5, 25),
      });
      existingKeys.add(key);
      addedGatekeepers++;
    }
  });
});

console.log('Added gatekeeper leads:', addedGatekeepers);

// ============================================================
// STEP 5: Summary and save
// ============================================================

// Sort by combined score descending
allLeads.sort((a, b) => (b.combinedScore || 0) - (a.combinedScore || 0));

// Tier breakdown
const tiers = { elite: [], high: [], medium: [], low: [], baseline: [] };
allLeads.forEach(l => {
  const s = l.combinedScore || 0;
  if (s >= 80) tiers.elite.push(l);
  else if (s >= 50) tiers.high.push(l);
  else if (s >= 30) tiers.medium.push(l);
  else if (s >= 15) tiers.low.push(l);
  else tiers.baseline.push(l);
});

const uniqueCompanies = new Set(allLeads.map(l => l.company)).size;

console.log('\n=== FINAL ENRICHMENT CANDIDATES ===');
console.log('Total leads:', allLeads.length);
console.log('Unique companies:', uniqueCompanies);
console.log('\nTier breakdown:');
console.log('  Elite (80+):', tiers.elite.length);
console.log('  High (50-79):', tiers.high.length);
console.log('  Medium (30-49):', tiers.medium.length);
console.log('  Low (15-29):', tiers.low.length);
console.log('  Baseline (<15):', tiers.baseline.length);

// Source breakdown
const sources = {};
allLeads.forEach(l => {
  const src = l.source || 'original_pipeline';
  sources[src] = (sources[src] || 0) + 1;
});
console.log('\nSource breakdown:');
Object.entries(sources).sort((a,b) => b[1] - a[1]).forEach(([k,v]) => console.log('  ' + v + ' — ' + k));

// Web category breakdown (for those that have it)
const cats = {};
allLeads.forEach(l => {
  const cat = l.webCategory || 'no_web_data';
  cats[cat] = (cats[cat] || 0) + 1;
});
console.log('\nWeb category breakdown:');
Object.entries(cats).sort((a,b) => b[1] - a[1]).forEach(([k,v]) => console.log('  ' + v + ' — ' + k));

// Save
fs.writeFileSync(dir + '/enrichment-candidates-expanded.json', JSON.stringify(allLeads, null, 2));
console.log('\nSaved: enrichment-candidates-expanded.json');

// Also save a summary
const summary = {
  generated: new Date().toISOString(),
  totalLeads: allLeads.length,
  uniqueCompanies,
  tiers: {
    elite: tiers.elite.length,
    high: tiers.high.length,
    medium: tiers.medium.length,
    low: tiers.low.length,
    baseline: tiers.baseline.length,
  },
  sources,
  webCategories: cats,
  previousEnrichmentCount: 2312,
  expansionFactor: (allLeads.length / 2312).toFixed(1) + 'x',
};
fs.writeFileSync(dir + '/enrichment-summary.json', JSON.stringify(summary, null, 2));
console.log('Saved: enrichment-summary.json');
