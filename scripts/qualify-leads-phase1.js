// Phase 1: Free keyword filtering — remove obvious non-fits
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');
const data = require(path.join(dataDir, 'family-office-leads-combined.json'));

// === REJECT LISTS ===

// Big banks, wirehouses, accounting firms, insurance — NOT family offices
const rejectCompanies = [
  'morgan stanley', 'fidelity investments', 'fidelity', 'ubs', 'j.p. morgan',
  'jpmorgan', 'jp morgan', 'goldman sachs', 'merrill lynch', 'bank of america',
  'wells fargo', 'raymond james', 'edward jones', 'charles schwab', 'schwab',
  'citigroup', 'citi', 'barclays', 'credit suisse', 'deutsche bank',
  'hsbc', 'bnp paribas', 'societe generale',
  // Accounting / consulting firms
  'pwc', 'pricewaterhousecoopers', 'deloitte', 'kpmg', 'ernst & young', 'ey',
  'rsm us', 'baker tilly', 'bdo', 'grant thornton', 'cbiz', 'crowe',
  'marcum', 'eisneramper', 'cohnreznick', 'withum',
  // Insurance
  'new york life', 'northwestern mutual', 'mass mutual', 'massmutual',
  'prudential', 'aig', 'metlife', 'allstate', 'state farm',
  // Custodians
  'northern trust', 'northern trust corporation', 'bny mellon', 'state street',
  // Large asset managers (not family offices)
  'blackrock', 'vanguard', 'pimco', 'invesco', 'franklin templeton',
  't. rowe price', 'nuveen',
  // Tech companies (clearly wrong)
  'microsoft', 'google', 'amazon', 'apple', 'meta', 'salesforce', 'oracle',
  'ibm', 'cisco', 'intel', 'nvidia',
];

// Title patterns that indicate non-decision-makers or wrong roles
const rejectTitlePatterns = [
  'intern', 'assistant', 'coordinator', 'receptionist', 'secretary',
  'customer service', 'support specialist', 'data entry',
  'marketing specialist', 'social media', 'graphic design',
  'recruiter', 'talent acquisition', 'human resources', 'hr manager',
  'software engineer', 'developer', 'programmer', 'devops',
  'accountant', 'bookkeeper', 'tax preparer', 'auditor',
  'paralegal', 'legal assistant',
];

// === SCORING ===

// Company name signals for GOOD fit
const goodCompanySignals = {
  'family office': 10,
  'single family office': 12,
  'multi family office': 8,
  'private family office': 12,
  'real estate': 8,
  'properties': 5,
  'realty': 5,
  'housing': 8,
  'multifamily': 9,
  'multi-family': 9,
  'residential': 6,
  'capital': 3,
  'holdings': 4,
  'investment': 3,
  'private equity': 5,
  'asset management': 3,
  'wealth': 2,
  'trust': 2,
  'fund': 3,
  'partners': 2,
  'equity': 3,
};

// Company name signals for BAD fit (not hard reject, but lower score)
const badCompanySignals = {
  'venture': -3,
  'ventures': -3,
  'biotech': -5,
  'pharma': -5,
  'crypto': -5,
  'blockchain': -5,
  'saas': -5,
  'software': -4,
  'tech fund': -5,
  'fintech': -4,
  'insurtech': -5,
  'media': -2,
  'entertainment': -2,
  'sports': -2,
  'hedge fund': -1,
  'quantitative': -3,
  'algorithmic': -3,
};

// Title signals for decision-makers
const goodTitleSignals = {
  'chief investment officer': 10,
  'cio': 8,
  'head of investments': 9,
  'head of allocations': 10,
  'head of real estate': 10,
  'director of investments': 9,
  'vp of investments': 8,
  'principal': 7,
  'managing partner': 8,
  'managing director': 6,
  'partner': 5,
  'founder': 7,
  'co-founder': 7,
  'owner': 6,
  'president': 5,
  'ceo': 5,
  'cfo': 4,
  'coo': 3,
  'trustee': 6,
  'family member': 8,
  'beneficiary': 5,
  'portfolio manager': 6,
  'investment officer': 7,
  'investment director': 8,
  'investment manager': 6,
  'wealth advisor': 2,
  'family wealth': 4,
  'family office director': 9,
  'family office manager': 7,
  'allocations': 9,
  'real estate': 6,
  'director': 3,
  'vice president': 3,
  'senior vice president': 4,
};

function isRejectedCompany(company) {
  const lower = company.toLowerCase();
  return rejectCompanies.some(rc => lower === rc || lower.startsWith(rc + ' ') || lower.includes(rc));
}

function isRejectedTitle(title) {
  const lower = title.toLowerCase();
  return rejectTitlePatterns.some(rt => lower.includes(rt));
}

function scoreCompany(company) {
  const lower = company.toLowerCase();
  let score = 0;
  for (const [signal, points] of Object.entries(goodCompanySignals)) {
    if (lower.includes(signal)) score += points;
  }
  for (const [signal, points] of Object.entries(badCompanySignals)) {
    if (lower.includes(signal)) score += points; // points are negative
  }
  return score;
}

function scoreTitle(title) {
  const lower = title.toLowerCase();
  let score = 0;
  for (const [signal, points] of Object.entries(goodTitleSignals)) {
    if (lower.includes(signal)) score += points;
  }
  return score;
}

// === PROCESS ===

const rejected = [];
const qualified = [];

for (const lead of data) {
  const company = (lead.company || '').trim();
  const title = (lead.title || '').trim();

  // Hard reject
  if (isRejectedCompany(company)) {
    rejected.push({ ...lead, rejectReason: 'company_blacklist' });
    continue;
  }
  if (isRejectedTitle(title)) {
    rejected.push({ ...lead, rejectReason: 'title_blacklist' });
    continue;
  }

  // Score
  const companyScore = scoreCompany(company);
  const titleScore = scoreTitle(title);
  const totalScore = companyScore + titleScore;

  qualified.push({
    ...lead,
    companyScore,
    titleScore,
    totalScore,
  });
}

// Sort by total score descending
qualified.sort((a, b) => b.totalScore - a.totalScore);

// === GROUP BY COMPANY ===
const companyMap = new Map();
for (const lead of qualified) {
  const co = lead.company.trim();
  if (!companyMap.has(co)) {
    companyMap.set(co, { leads: [], bestCompanyScore: lead.companyScore });
  }
  companyMap.get(co).leads.push(lead);
}

// === OUTPUT ===
console.log('=== PHASE 1: KEYWORD FILTERING RESULTS ===\n');
console.log(`Total leads: ${data.length}`);
console.log(`Rejected: ${rejected.length}`);
console.log(`Qualified: ${qualified.length}`);
console.log(`Unique qualified companies: ${companyMap.size}`);

// Rejection breakdown
const rejectReasons = {};
for (const r of rejected) {
  rejectReasons[r.rejectReason] = (rejectReasons[r.rejectReason] || 0) + 1;
}
console.log('\nRejection breakdown:');
for (const [reason, count] of Object.entries(rejectReasons)) {
  console.log(`  ${reason}: ${count}`);
}

// Score distribution
const tiers = {
  'Tier A (score 15+)': qualified.filter(l => l.totalScore >= 15),
  'Tier B (score 8-14)': qualified.filter(l => l.totalScore >= 8 && l.totalScore < 15),
  'Tier C (score 3-7)': qualified.filter(l => l.totalScore >= 3 && l.totalScore < 8),
  'Tier D (score 0-2)': qualified.filter(l => l.totalScore >= 0 && l.totalScore < 3),
  'Tier F (score < 0)': qualified.filter(l => l.totalScore < 0),
};

console.log('\nScore distribution:');
for (const [tier, leads] of Object.entries(tiers)) {
  const uniqueCos = new Set(leads.map(l => l.company)).size;
  console.log(`  ${tier}: ${leads.length} leads (${uniqueCos} companies)`);
}

// Sample from each tier
for (const [tier, leads] of Object.entries(tiers)) {
  console.log(`\n--- ${tier} samples ---`);
  const samples = leads.slice(0, 5);
  for (const s of samples) {
    console.log(`  [${s.totalScore}] ${s.firstName} ${s.lastName} | ${s.title} @ ${s.company}`);
  }
}

// === SAVE ===
const outputPath = path.join(dataDir, 'phase1-qualified.json');
fs.writeFileSync(outputPath, JSON.stringify(qualified, null, 2));
console.log(`\nSaved: ${outputPath} (${qualified.length} leads)`);

// Save unique companies for Phase 2
const companiesForPhase2 = [...companyMap.entries()].map(([name, data]) => ({
  company: name,
  companyScore: data.bestCompanyScore,
  leadCount: data.leads.length,
  sampleTitles: data.leads.slice(0, 3).map(l => l.title),
  states: [...new Set(data.leads.map(l => l.state))],
})).sort((a, b) => b.companyScore - a.companyScore);

const companiesPath = path.join(dataDir, 'phase2-companies.json');
fs.writeFileSync(companiesPath, JSON.stringify(companiesForPhase2, null, 2));
console.log(`Saved: ${companiesPath} (${companiesForPhase2.length} unique companies for Phase 2)`);

// Save rejected for review
const rejectedPath = path.join(dataDir, 'phase1-rejected.json');
fs.writeFileSync(rejectedPath, JSON.stringify(rejected, null, 2));
console.log(`Saved: ${rejectedPath} (${rejected.length} rejected leads)`);
