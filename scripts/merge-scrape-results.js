// Merge all state scrape JSON files into a single combined file
// Only includes actual scrape files (state names), not phase/analysis files
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');

// Only state scrape files — exclude phase/analysis files
const stateFiles = fs.readdirSync(dataDir)
  .filter(f => f.endsWith('.json'))
  .filter(f => {
    // Exclude pipeline/analysis files
    if (f.startsWith('phase')) return false;
    if (f.startsWith('enrichment')) return false;
    if (f.includes('progress')) return false;
    if (f.includes('combined')) return false;
    if (f.includes('companies')) return false;
    if (f.includes('scored')) return false;
    if (f.includes('researched')) return false;
    if (f.includes('qualified')) return false;
    if (f.includes('rejected')) return false;
    return true;
  });

console.log(`Found ${stateFiles.length} state files\n`);

const allLeads = [];
for (const file of stateFiles) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'));
    if (Array.isArray(data) && data.length > 0 && data[0].firstName) {
      allLeads.push(...data);
      console.log(`  ${file}: ${data.length} leads`);
    }
  } catch {
    // Skip
  }
}

console.log(`\nTotal raw leads: ${allLeads.length}`);

// Deduplicate
const seen = new Set();
const unique = allLeads.filter(lead => {
  const fn = (lead.firstName || '').toLowerCase();
  const ln = (lead.lastName || '').toLowerCase();
  const co = (lead.company || '').toLowerCase();
  const url = (lead.linkedInUrl || '').toLowerCase().replace(/\/$/, '');
  const key = url || `${fn}-${ln}-${co}`;
  if (!key || seen.has(key)) return false;
  seen.add(key);
  if (url && fn) seen.add(`${fn}-${ln}-${co}`);
  return true;
});

console.log(`After deduplication: ${unique.length}`);

const outJson = path.join(dataDir, 'family-office-leads-combined.json');
fs.writeFileSync(outJson, JSON.stringify(unique, null, 2));
console.log(`\nSaved: ${outJson}`);
