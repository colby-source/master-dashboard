// Phase 1 for overflow leads only — runs keyword filtering on new leads
// and APPENDS results to existing phase1-qualified.json and phase1-rejected.json
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');
const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'overflow-new-leads.json'), 'utf-8'));

// === REJECT LISTS (same as phase1) ===
const rejectCompanies = [
  'morgan stanley', 'fidelity investments', 'fidelity', 'ubs', 'j.p. morgan',
  'jpmorgan', 'jp morgan', 'goldman sachs', 'merrill lynch', 'bank of america',
  'wells fargo', 'raymond james', 'edward jones', 'charles schwab', 'schwab',
  'citigroup', 'citi', 'barclays', 'credit suisse', 'deutsche bank',
  'hsbc', 'bnp paribas', 'societe generale',
  'pwc', 'pricewaterhousecoopers', 'deloitte', 'kpmg', 'ernst & young', 'ey',
  'rsm us', 'baker tilly', 'bdo', 'grant thornton', 'cbiz', 'crowe',
  'marcum', 'eisneramper', 'cohnreznick', 'withum',
  'new york life', 'northwestern mutual', 'mass mutual', 'massmutual',
  'prudential', 'aig', 'metlife', 'allstate', 'state farm',
  'northern trust', 'northern trust corporation', 'bny mellon', 'state street',
  'blackrock', 'vanguard', 'pimco', 'invesco', 'franklin templeton',
  't. rowe price', 'nuveen',
  'microsoft', 'google', 'amazon', 'apple', 'meta', 'salesforce', 'oracle',
  'ibm', 'cisco', 'intel', 'nvidia',
];

const rejectTitlePatterns = [
  'intern', 'assistant', 'coordinator', 'receptionist', 'secretary',
  'customer service', 'support specialist', 'data entry',
  'marketing specialist', 'social media', 'graphic design',
  'recruiter', 'talent acquisition', 'human resources', 'hr manager',
  'software engineer', 'developer', 'programmer', 'devops',
  'accountant', 'bookkeeper', 'tax preparer', 'auditor',
  'paralegal', 'legal assistant',
];

const goodCompanySignals = {
  'family office': 10, 'single family office': 12, 'multi family office': 8,
  'private family office': 12, 'real estate': 8, 'properties': 5, 'realty': 5,
  'housing': 8, 'multifamily': 9, 'multi-family': 9, 'residential': 6,
  'capital': 3, 'holdings': 4, 'investment': 3, 'private equity': 5,
  'asset management': 3, 'wealth': 2, 'trust': 2, 'fund': 3,
  'partners': 2, 'equity': 3,
};

const badCompanySignals = {
  'venture': -3, 'ventures': -3, 'biotech': -5, 'pharma': -5,
  'crypto': -5, 'blockchain': -5, 'saas': -5, 'software': -4,
  'tech fund': -5, 'fintech': -4, 'insurtech': -5, 'media': -2,
  'entertainment': -2, 'sports': -2, 'hedge fund': -1,
  'quantitative': -3, 'algorithmic': -3,
};

const goodTitleSignals = {
  'chief investment officer': 10, 'cio': 8, 'head of investments': 9,
  'head of allocations': 10, 'head of real estate': 10,
  'director of investments': 9, 'vp of investments': 8, 'principal': 7,
  'managing partner': 8, 'managing director': 6, 'partner': 5,
  'founder': 7, 'co-founder': 7, 'owner': 6, 'president': 5,
  'ceo': 5, 'cfo': 4, 'coo': 3, 'trustee': 6, 'family member': 8,
  'beneficiary': 5, 'portfolio manager': 6, 'investment officer': 7,
  'investment director': 8, 'investment manager': 6, 'wealth advisor': 2,
  'family wealth': 4, 'family office director': 9, 'family office manager': 7,
  'allocations': 9, 'real estate': 6, 'director': 3, 'vice president': 3,
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
    if (lower.includes(signal)) score += points;
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

  if (isRejectedCompany(company)) {
    rejected.push({ ...lead, rejectReason: 'company_blacklist' });
    continue;
  }
  if (isRejectedTitle(title)) {
    rejected.push({ ...lead, rejectReason: 'title_blacklist' });
    continue;
  }

  const companyScore = scoreCompany(company);
  const titleScore = scoreTitle(title);
  const totalScore = companyScore + titleScore;

  qualified.push({ ...lead, companyScore, titleScore, totalScore });
}

qualified.sort((a, b) => b.totalScore - a.totalScore);

console.log('=== PHASE 1 (OVERFLOW BATCH) ===\n');
console.log(`New leads processed: ${data.length}`);
console.log(`Rejected: ${rejected.length}`);
console.log(`Qualified: ${qualified.length}`);

// Score distribution
const tiers = {
  'Tier A (15+)': qualified.filter(l => l.totalScore >= 15),
  'Tier B (8-14)': qualified.filter(l => l.totalScore >= 8 && l.totalScore < 15),
  'Tier C (3-7)': qualified.filter(l => l.totalScore >= 3 && l.totalScore < 8),
  'Tier D (0-2)': qualified.filter(l => l.totalScore >= 0 && l.totalScore < 3),
  'Tier F (<0)': qualified.filter(l => l.totalScore < 0),
};

console.log('\nScore distribution:');
for (const [tier, leads] of Object.entries(tiers)) {
  console.log(`  ${tier}: ${leads.length} leads`);
}

// Merge with existing Phase 1 results
const existingQ = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase1-qualified.json'), 'utf-8'));
const existingR = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase1-rejected.json'), 'utf-8'));

const mergedQ = [...existingQ, ...qualified].sort((a, b) => b.totalScore - a.totalScore);
const mergedR = [...existingR, ...rejected];

fs.writeFileSync(path.join(dataDir, 'phase1-qualified.json'), JSON.stringify(mergedQ, null, 2));
fs.writeFileSync(path.join(dataDir, 'phase1-rejected.json'), JSON.stringify(mergedR, null, 2));

console.log(`\nMerged totals:`);
console.log(`  Qualified: ${mergedQ.length} (was ${existingQ.length}, +${qualified.length})`);
console.log(`  Rejected: ${mergedR.length} (was ${existingR.length}, +${rejected.length})`);

// Extract NEW companies that aren't already in Phase 2
const existingP2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase2-companies.json'), 'utf-8'));
const existingCoNames = new Set(existingP2.map(c => c.company.toLowerCase()));

const newCompanyMap = new Map();
for (const lead of qualified) {
  const co = lead.company.trim();
  if (existingCoNames.has(co.toLowerCase())) continue;
  if (!newCompanyMap.has(co)) {
    newCompanyMap.set(co, { leads: [], bestCompanyScore: lead.companyScore });
  }
  newCompanyMap.get(co).leads.push(lead);
}

const newCompaniesForPhase2 = [...newCompanyMap.entries()].map(([name, d]) => ({
  company: name,
  companyScore: d.bestCompanyScore,
  leadCount: d.leads.length,
  sampleTitles: d.leads.slice(0, 3).map(l => l.title),
  states: [...new Set(d.leads.map(l => l.state))],
})).sort((a, b) => b.companyScore - a.companyScore);

const newCosPath = path.join(dataDir, 'overflow-phase2-companies.json');
fs.writeFileSync(newCosPath, JSON.stringify(newCompaniesForPhase2, null, 2));
console.log(`\nNew companies for Phase 2: ${newCompaniesForPhase2.length}`);
console.log(`(Already in Phase 2: ${qualified.length > 0 ? qualified.filter(l => existingCoNames.has(l.company.toLowerCase().trim())).length : 0} leads at known companies)`);
console.log(`Saved: ${newCosPath}`);
