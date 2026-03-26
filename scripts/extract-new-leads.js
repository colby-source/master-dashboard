// Extract leads from combined file that haven't been through Phase 1 yet
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');

const combined = JSON.parse(fs.readFileSync(path.join(dataDir, 'family-office-leads-combined.json'), 'utf-8'));
const phase1q = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase1-qualified.json'), 'utf-8'));
const phase1r = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase1-rejected.json'), 'utf-8'));

const processed = new Set();
[...phase1q, ...phase1r].forEach(l => {
  const url = (l.linkedInUrl || '').toLowerCase().replace(/\/$/, '');
  const key = url || ((l.firstName || '') + (l.lastName || '') + (l.company || '')).toLowerCase();
  processed.add(key);
});

const newLeads = combined.filter(l => {
  const url = (l.linkedInUrl || '').toLowerCase().replace(/\/$/, '');
  const key = url || ((l.firstName || '') + (l.lastName || '') + (l.company || '')).toLowerCase();
  return !processed.has(key);
});

console.log('Total combined:', combined.length);
console.log('Already processed:', processed.size);
console.log('New leads to process:', newLeads.length);

fs.writeFileSync(path.join(dataDir, 'overflow-new-leads.json'), JSON.stringify(newLeads, null, 2));
console.log('Saved to overflow-new-leads.json');
