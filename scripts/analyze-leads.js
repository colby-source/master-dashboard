const data = require('../data/family-office-scrape/family-office-leads-combined.json');
const companies = new Map();

for (const lead of data) {
  const co = (lead.company || '').trim();
  if (co === '') continue;
  if (!companies.has(co)) companies.set(co, []);
  companies.get(co).push(lead);
}

console.log('Total leads:', data.length);
console.log('Unique companies:', companies.size);

const sorted = [...companies.entries()].sort((a, b) => b[1].length - a[1].length);

console.log('\nTop 30 companies by lead count:');
for (const [co, leads] of sorted.slice(0, 30)) {
  const titles = leads.map(l => l.title).slice(0, 3).join(' | ');
  console.log(`  ${leads.length}x  ${co}  ->  ${titles}`);
}

const singles = sorted.filter(([, l]) => l.length === 1).length;
console.log('\nCompanies with 1 lead:', singles);
console.log('Companies with 2+ leads:', companies.size - singles);

// Title analysis
const titleKeywords = {};
const keywords = ['CEO', 'CIO', 'CFO', 'COO', 'CTO', 'Founder', 'Owner', 'Partner', 'Principal',
  'Managing Director', 'Director', 'VP', 'Vice President', 'President', 'Head of',
  'Trustee', 'Allocations', 'Investments', 'Portfolio', 'Family'];

for (const lead of data) {
  const t = (lead.title || '').toLowerCase();
  for (const kw of keywords) {
    if (t.includes(kw.toLowerCase())) {
      titleKeywords[kw] = (titleKeywords[kw] || 0) + 1;
    }
  }
}

console.log('\nTitle keyword distribution:');
const sortedKw = Object.entries(titleKeywords).sort((a, b) => b[1] - a[1]);
for (const [kw, count] of sortedKw) {
  console.log(`  ${kw}: ${count}`);
}

// Company name keyword analysis (identify obvious non-fits)
const coKeywords = {};
const coKws = ['Family Office', 'Capital', 'Wealth', 'Advisory', 'Ventures', 'Investment',
  'Partners', 'Holdings', 'Real Estate', 'Properties', 'Management', 'Financial',
  'Trust', 'Fund', 'Asset', 'Equity', 'Morgan Stanley', 'Merrill', 'UBS', 'JPMorgan',
  'Goldman', 'Wells Fargo', 'Edward Jones', 'Raymond James', 'Fidelity', 'Schwab'];

for (const [co] of sorted) {
  const c = co.toLowerCase();
  for (const kw of coKws) {
    if (c.includes(kw.toLowerCase())) {
      coKeywords[kw] = (coKeywords[kw] || 0) + 1;
    }
  }
}

console.log('\nCompany name keyword distribution:');
const sortedCoKw = Object.entries(coKeywords).sort((a, b) => b[1] - a[1]);
for (const [kw, count] of sortedCoKw) {
  console.log(`  ${kw}: ${count}`);
}
