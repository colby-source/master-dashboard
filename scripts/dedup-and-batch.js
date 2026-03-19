const fs = require('fs');
const path = require('path');

// Paths
const amfResultsDir = path.join(__dirname, '..', 'data', 'amf-results');
const coldDataDir = 'C:\\Users\\colby\\OneDrive\\Documents\\Data\\Granite Park\\Fund - Marc\\Marketing\\Data\\Cold Data - Email Campaign';
const outputDir = path.join(coldDataDir, 'Enrichment_Batches');

// AMF result files (skip the old test file)
const amfFiles = [
  'amf-found-fo_lp-1773859579494.csv',
  'amf-found-formd_re-1773865009478.csv',
  'amf-found-formd_leads-1773938038844.csv',
  'amf-found-re_investor-1773941100080.csv',
];

// Existing cold data files that have emails we should dedup against
const existingEmailFiles = [
  'Consolidated_All_Emails.csv',
  'Verified_Emails.csv',
  'Verified_PREF.csv',
  'Verified_RE.csv',
  'Verified_TAX.csv',
  'Instantly_FINAL_READY.csv',
  'Instantly_Ready_PREF.csv',
  'Instantly_Ready_RE.csv',
  'Instantly_Ready_TAX.csv',
  'FO_RE_Campaign_Master.csv',
  'FO_RE_Enrichment_Upload.csv',
  'FO_RE_Enrichment_Upload_Clean.csv',
  'GFOIS_Enriched_With_Emails.csv',
];

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (vals.length > 0) {
      const row = {};
      headers.forEach((h, idx) => { row[h.trim().toLowerCase()] = (vals[idx] || '').trim(); });
      rows.push(row);
    }
  }
  return { headers: headers.map(h => h.trim().toLowerCase()), rows };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

function escapeCSV(val) {
  if (!val) return '';
  val = String(val);
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

// Step 1: Collect all existing emails for dedup
console.log('=== Step 1: Collecting existing emails for dedup ===');
const existingEmails = new Set();

for (const file of existingEmailFiles) {
  const filePath = path.join(coldDataDir, file);
  if (!fs.existsSync(filePath)) {
    console.log(`  Skip (not found): ${file}`);
    continue;
  }
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    const { headers, rows } = parseCSV(text);
    const emailCol = headers.find(h => h === 'email' || h === 'email_address' || h === 'e-mail');
    if (!emailCol) {
      console.log(`  Skip (no email column): ${file}`);
      continue;
    }
    let count = 0;
    for (const row of rows) {
      const email = (row[emailCol] || '').toLowerCase().trim();
      if (email && email.includes('@')) {
        existingEmails.add(email);
        count++;
      }
    }
    console.log(`  ${file}: ${count} emails`);
  } catch (err) {
    console.log(`  Error reading ${file}: ${err.message}`);
  }
}
console.log(`  Total existing emails: ${existingEmails.size}`);

// Step 2: Load all AMF results
console.log('\n=== Step 2: Loading AMF results ===');
const allLeads = [];
const seenEmails = new Set();

for (const file of amfFiles) {
  const filePath = path.join(amfResultsDir, file);
  if (!fs.existsSync(filePath)) {
    console.log(`  Skip (not found): ${file}`);
    continue;
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  const { rows } = parseCSV(text);
  let added = 0, dupSelf = 0, dupExisting = 0, noEmail = 0;

  for (const row of rows) {
    const email = (row.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) { noEmail++; continue; }
    if (seenEmails.has(email)) { dupSelf++; continue; }
    if (existingEmails.has(email)) { dupExisting++; continue; }
    seenEmails.add(email);
    allLeads.push(row);
    added++;
  }
  console.log(`  ${file}: ${rows.length} total, ${added} new, ${dupSelf} dup(self), ${dupExisting} dup(existing), ${noEmail} no-email`);
}

console.log(`\n  Total unique new leads: ${allLeads.length}`);

// Step 3: Save consolidated file to Cold Data
console.log('\n=== Step 3: Saving consolidated file ===');
const consolidatedPath = path.join(coldDataDir, 'AMF_Found_Emails_All.csv');
const outHeaders = ['first_name', 'last_name', 'email', 'company', 'title', 'phone', 'city', 'state', 'source', 'grade', 'email_status'];
const headerLine = outHeaders.join(',');

const allLines = [headerLine];
for (const row of allLeads) {
  allLines.push(outHeaders.map(h => escapeCSV(row[h])).join(','));
}
fs.writeFileSync(consolidatedPath, allLines.join('\n'), 'utf-8');
console.log(`  Saved: ${consolidatedPath} (${allLeads.length} leads)`);

// Step 4: Create batches of 2000
console.log('\n=== Step 4: Creating batches of 2,000 ===');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const BATCH_SIZE = 2000;
const totalBatches = Math.ceil(allLeads.length / BATCH_SIZE);

for (let i = 0; i < totalBatches; i++) {
  const start = i * BATCH_SIZE;
  const end = Math.min(start + BATCH_SIZE, allLeads.length);
  const batch = allLeads.slice(start, end);
  const batchNum = String(i + 1).padStart(2, '0');
  const batchFile = path.join(outputDir, `batch_${batchNum}_${batch.length}_leads.csv`);

  const lines = [headerLine];
  for (const row of batch) {
    lines.push(outHeaders.map(h => escapeCSV(row[h])).join(','));
  }
  fs.writeFileSync(batchFile, lines.join('\n'), 'utf-8');
  console.log(`  Batch ${batchNum}: ${batch.length} leads → ${path.basename(batchFile)}`);
}

console.log(`\n=== Done ===`);
console.log(`  Consolidated: ${consolidatedPath}`);
console.log(`  Batches: ${outputDir} (${totalBatches} files × ${BATCH_SIZE} leads)`);
console.log(`  Ready to feed into enrichment pipeline one batch at a time.`);
