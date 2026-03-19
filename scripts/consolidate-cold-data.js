const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
// CONSOLIDATE, CLEAN & BATCH ALL GRANITE PARK COLD DATA
// ═══════════════════════════════════════════════════════════

const BASE = path.join('C:', 'Users', 'colby', 'OneDrive', 'Documents', 'Data', 'Granite Park', 'Fund - Marc', 'Marketing', 'Data', 'Cold Data - Email Campaign');
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'cold-batches');

// Simple CSV parser that handles quoted fields
function parseCSV(text, delimiter = ',') {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];

  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const row = [];
    let field = '';
    let inQuotes = false;
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inQuotes) {
        if (ch === '"' && line[j + 1] === '"') { field += '"'; j++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === delimiter) { row.push(field.trim()); field = ''; }
        else { field += ch; }
      }
    }
    row.push(field.trim());
    results.push(row);
  }
  return results;
}

// Normalize a header name to a canonical field
function mapHeader(h) {
  const lower = h.toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/^_+/, '');
  if (/^email$|^emailaddress$|^valid_email|^business_?email/.test(lower)) return 'email';
  if (/^firstname|^first_name|^contact_first/.test(lower)) return 'first_name';
  if (/^lastname|^last_name|^contact_last/.test(lower)) return 'last_name';
  if (/^name$|^fullname|^full_name|^person_name|^contact_name|^contactperson|^sponsorship_contact_name/.test(lower)) return 'full_name';
  if (/^company|^companyname|^company_name|^org|^organization|^firm_name/.test(lower)) return 'company';
  if (/^title|^jobtitle|^job_title|^result_title|^contact_title|^sponsorship_contact_title/.test(lower)) return 'title';
  if (/^phone|^phonenumber|^phone_number|^cell|^direct|^business_phone|^sponsorship_contact_phone|^firmphone|^org_phone/.test(lower)) return 'phone';
  if (/^city/.test(lower)) return 'city';
  if (/^state|^addr_state/.test(lower)) return 'state';
  if (/^website|^web$/.test(lower)) return 'website';
  if (/^linkedin|^profileurl|^linkedin_url/.test(lower)) return 'linkedin';
  if (/^segment/.test(lower)) return 'segment';
  if (/^grade/.test(lower)) return 'grade';
  if (/^email_status/.test(lower)) return 'email_status';
  if (/^source/.test(lower)) return 'source';
  return null;
}

// Files to process — ordered by quality/priority (higher priority = kept on dedup)
const FILES = [
  // Already enriched / verified — highest priority
  { file: 'Instantly_FINAL_READY.csv', priority: 10 },
  { file: 'Instantly_Upload_AA_Plus.csv', priority: 10 },
  { file: 'Verified_Emails.csv', priority: 9 },
  { file: 'Verified_PREF.csv', priority: 9 },
  { file: 'Verified_RE.csv', priority: 9 },
  { file: 'Verified_TAX.csv', priority: 9 },
  { file: 'FO_RE_Enrichment_Upload_Clean.csv', priority: 8 },
  { file: 'FO_RE_Instantly_Upload.csv', priority: 8 },

  // Enriched lists
  { file: 'Consolidated_All_Emails.csv', priority: 7 },
  { file: 'FO_RE_Campaign_Master.csv', priority: 7 },
  { file: 'FO_RE_Enrichment_Upload.csv', priority: 6 },
  { file: 'National_LP_Master_List.csv', priority: 7 },
  { file: 'GFOIS_Enriched_With_Emails.csv', priority: 6 },
  { file: 'GFOIS_Miami_2026_Contacts_Enriched.csv', priority: 6 },
  { file: 'GFOIS_Miami_2026_Contacts.csv', priority: 5 },
  { file: 'Family_Office_RE_Investors_Master.csv', priority: 6 },

  // Master lists (big, may have dupes of above)
  { file: 'Master_Lead_List_v1.csv', priority: 5 },
  { file: 'Master_Lead_List_FO_LP.csv', priority: 4 },
  { file: 'Master_Lead_List_20K.csv', priority: 3 },

  // SEC/Form D data
  { file: 'SEC_FormD_Leads.csv', priority: 4 },
  { file: 'SEC_FormD_Historical_Leads.csv', priority: 3 },
  { file: 'SEC_13DG_Leads.csv', priority: 4 },
  { file: path.join('SEC_RE_Investors', 'FormD_RE_Contacts.csv'), priority: 4 },
  { file: path.join('SEC_RE_Investors', 'RE_Investor_Master_List.csv'), priority: 4 },
  { file: path.join('SEC_RE_Investors', 'NMHC_Top50_Enriched.csv'), priority: 5 },
  { file: path.join('SEC_RE_Investors', 'NMHC_Top50_Outreach.csv'), priority: 5 },
  { file: path.join('SEC_RE_Investors', 'NMHC_Top50_Contacts.csv'), priority: 4 },
  { file: path.join('SEC_RE_Investors', '13F_REIT_Holders.csv'), priority: 3 },

  // RIA data (firm-level, may lack personal emails)
  { file: path.join('SEC_IAPD', 'RIA_National_All.csv'), priority: 3 },
  { file: path.join('SEC_IAPD', 'RIA_National_TopTargets.csv'), priority: 4 },
  { file: path.join('SEC_IAPD', 'RIA_Firms_FL_TX_LA_NC.csv'), priority: 3 },

  // Raw contacts
  { file: 'FO_Contacts_Raw.csv', priority: 2 },
  { file: 'leads_pref.csv', priority: 5 },
  { file: 'leads_re.csv', priority: 5 },
  { file: 'leads_tax.csv', priority: 5 },

  // Sponsor databases
  { file: 'CSV Sponsor Database.csv', priority: 2 },

  // Instantly-ready segmented
  { file: 'Instantly_Ready_PREF.csv', priority: 8 },
  { file: 'Instantly_Ready_RE.csv', priority: 8 },
  { file: 'Instantly_Ready_TAX.csv', priority: 8 },
];

// ═══════════════════════════════════════════════════════════
// STEP 1: INGEST ALL FILES
// ═══════════════════════════════════════════════════════════

const allContacts = []; // { email, first_name, last_name, company, title, phone, city, state, website, linkedin, segment, grade, email_status, source_file, priority }
let totalIngested = 0;
let skippedNoEmail = 0;

console.log('=== INGESTING FILES ===\n');

for (const entry of FILES) {
  const filePath = path.join(BASE, entry.file);
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP (not found): ${entry.file}`);
    continue;
  }

  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''); // strip BOM
  const rows = parseCSV(raw);
  if (rows.length < 2) {
    console.log(`  SKIP (empty): ${entry.file}`);
    continue;
  }

  const headers = rows[0];
  const colMap = {};
  headers.forEach((h, i) => {
    const mapped = mapHeader(h);
    if (mapped && !(mapped in colMap)) colMap[mapped] = i;
  });

  let fileCount = 0;
  let fileSkipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;

    const get = (field) => (colMap[field] !== undefined ? (row[colMap[field]] || '').trim() : '');

    let email = get('email').toLowerCase();
    let firstName = get('first_name');
    let lastName = get('last_name');

    // If we have full_name but not first/last, split it
    if (!firstName && !lastName && get('full_name')) {
      const parts = get('full_name').split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }

    // Skip rows with no email
    if (!email || !email.includes('@')) {
      fileSkipped++;
      continue;
    }

    allContacts.push({
      email,
      first_name: firstName,
      last_name: lastName,
      company: get('company'),
      title: get('title'),
      phone: get('phone'),
      city: get('city'),
      state: get('state'),
      website: get('website'),
      linkedin: get('linkedin'),
      segment: get('segment'),
      grade: get('grade'),
      email_status: get('email_status'),
      source_file: entry.file,
      priority: entry.priority,
    });
    fileCount++;
  }

  totalIngested += fileCount;
  skippedNoEmail += fileSkipped;
  console.log(`  ${entry.file}: ${fileCount} contacts (${fileSkipped} skipped, no email)`);
}

console.log(`\nTotal ingested: ${totalIngested}`);
console.log(`Skipped (no email): ${skippedNoEmail}`);

// ═══════════════════════════════════════════════════════════
// STEP 2: DEDUPLICATE BY EMAIL (keep highest priority)
// ═══════════════════════════════════════════════════════════

console.log('\n=== DEDUPLICATING BY EMAIL ===\n');

const emailMap = new Map();
for (const contact of allContacts) {
  const existing = emailMap.get(contact.email);
  if (!existing || contact.priority > existing.priority) {
    // Keep the higher priority record, but merge missing fields from lower priority
    if (existing) {
      for (const key of ['first_name', 'last_name', 'company', 'title', 'phone', 'city', 'state', 'website', 'linkedin', 'segment', 'grade']) {
        if (!contact[key] && existing[key]) {
          contact[key] = existing[key];
        }
      }
    }
    emailMap.set(contact.email, contact);
  } else {
    // Merge missing fields into existing higher-priority record
    for (const key of ['first_name', 'last_name', 'company', 'title', 'phone', 'city', 'state', 'website', 'linkedin', 'segment', 'grade']) {
      if (!existing[key] && contact[key]) {
        existing[key] = contact[key];
      }
    }
  }
}

const emailDeduped = Array.from(emailMap.values());
console.log(`After email dedup: ${emailDeduped.length} unique contacts (removed ${totalIngested - emailDeduped.length} dupes)`);

// ═══════════════════════════════════════════════════════════
// STEP 2b: DEDUPLICATE BY NAME + COMPANY (catch same person, different email)
// ═══════════════════════════════════════════════════════════

console.log('\n=== DEDUPLICATING BY NAME + COMPANY ===\n');

const nameCompanyMap = new Map();
let removedNameCompanyDupes = 0;

for (const contact of emailDeduped) {
  const fn = (contact.first_name || '').toLowerCase().trim();
  const ln = (contact.last_name || '').toLowerCase().trim();
  const co = (contact.company || '').toLowerCase().trim().replace(/[.,\s]+(llc|inc|corp|ltd|lp|llp|co)\.?$/i, '').trim();

  // Only dedupe if we have a meaningful name + company
  if (fn.length >= 2 && ln.length >= 2 && co.length >= 2) {
    const key = `${fn}|${ln}|${co}`;
    const existing = nameCompanyMap.get(key);
    if (!existing || contact.priority > existing.priority) {
      if (existing) removedNameCompanyDupes++;
      nameCompanyMap.set(key, contact);
    } else {
      removedNameCompanyDupes++;
    }
  } else {
    // No meaningful name+company combo — keep by using unique key
    nameCompanyMap.set(`_solo_${contact.email}`, contact);
  }
}

const deduped = Array.from(nameCompanyMap.values());
console.log(`After name+company dedup: ${deduped.length} unique contacts (removed ${removedNameCompanyDupes} name+company dupes)`);

// ═══════════════════════════════════════════════════════════
// STEP 3: CLEAN JUNK (same logic as dedupe-clean.js)
// ═══════════════════════════════════════════════════════════

console.log('\n=== CLEANING JUNK ===\n');

const junkFirstNames = new Set([
  'senior', 'executive', 'assistant', 'associate', 'managing',
  'meet', 'read', 'view', 'learn', 'click', 'our', 'the', 'about',
  'contact', 'team', 'everyone', 'founded', 'community',
  'bio', 'here', 'more', 'info', 'see', 'discover', 'explore', 'get',
  'founders', 'founder', 'there', 'hi', 'hello', 'dear',
  'vice', 'president', 'director', 'chief', 'board', 'management',
  'leadership', 'office', 'investor', 'relations', 'committee',
  'counsel', 'compliance', 'operations', 'analyst', 'general',
  'investment', 'portfolio', 'advisory', 'partner', 'principal',
  'chairman', 'founding', 'n/a', 'na', 'none', 'test', 'unknown',
]);

const junkLastNames = new Set([
  'vice', 'team', 'bio', 'more', 'leadership', 'read',
  'here', 'us', 'chairman', 'committee', 'relations',
  'ventures', 'advisors', 'advisory', 'investments',
  'president', 'officer', 'counsel', 'partner', 'capital',
  'fund', 'group', 'management', 'associates', 'global',
  'equity', 'wealth', 'asset', 'securities', 'financial',
  'n/a', 'na', 'none', 'test', 'unknown',
]);

const genericEmailPrefixes = [
  'info@', 'hello@', 'contact@', 'team@', 'careers@', 'jobs@',
  'hr@', 'press@', 'media@', 'office@', 'general@', 'admin@',
  'support@', 'feedback@', 'ninfo@', 'enquiries@', 'enquiry@',
  'sales@', 'marketing@', 'billing@', 'accounting@', 'reception@',
  'frontdesk@', 'webmaster@',
];
const genericEmailPatterns = ['noreply', 'no-reply', 'donotreply', 'do-not-reply'];

let cleaned = [];
let removedJunkFirst = 0;
let removedJunkLast = 0;
let removedGenericEmail = 0;
let removedNoName = 0;
let removedInvalidEmail = 0;

for (const c of deduped) {
  const fn = (c.first_name || '').toLowerCase().trim();
  const ln = (c.last_name || '').toLowerCase().trim();
  const email = c.email.toLowerCase();

  // Remove invalid emails
  if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    removedInvalidEmail++;
    continue;
  }

  // Remove generic emails
  if (genericEmailPrefixes.some(p => email.startsWith(p)) ||
      genericEmailPatterns.some(p => email.includes(p))) {
    removedGenericEmail++;
    continue;
  }

  // Remove junk first names
  if (fn && junkFirstNames.has(fn)) {
    removedJunkFirst++;
    continue;
  }

  // Remove junk last names
  if (ln && junkLastNames.has(ln)) {
    removedJunkLast++;
    continue;
  }

  // Remove contacts with no name at all
  if (!fn && !ln) {
    removedNoName++;
    continue;
  }

  cleaned.push(c);
}

console.log(`Removed junk first names: ${removedJunkFirst}`);
console.log(`Removed junk last names: ${removedJunkLast}`);
console.log(`Removed generic emails: ${removedGenericEmail}`);
console.log(`Removed invalid emails: ${removedInvalidEmail}`);
console.log(`Removed no-name contacts: ${removedNoName}`);
console.log(`After cleaning: ${cleaned.length} contacts`);

// ═══════════════════════════════════════════════════════════
// STEP 4: REMOVE CONTACTS ALREADY IN THE DB
// ═══════════════════════════════════════════════════════════

console.log('\n=== REMOVING ALREADY-IN-DB CONTACTS ===\n');

const dbEmails = new Set();
const dbPath = path.join(__dirname, '..', 'data', 'master-dashboard.db');
let removedAlreadyInDB = 0;

try {
  const initSqlJs = require('sql.js');
  const SQL = await (async () => initSqlJs())();  // won't work at top level
} catch (e) {
  // We'll handle this in the async wrapper below
}

// We need to make this async for sql.js
const initSqlJs = require('sql.js');
const sqlPromise = initSqlJs();

sqlPromise.then(SQL => {
  if (fs.existsSync(dbPath)) {
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const result = db.exec('SELECT LOWER(email) FROM enrichment_leads WHERE email IS NOT NULL');
    if (result.length) {
      result[0].values.forEach(r => dbEmails.add(r[0]));
    }
    console.log(`Found ${dbEmails.size} emails already in DB`);
  }

  const beforeDB = cleaned.length;
  cleaned = cleaned.filter(c => {
    if (dbEmails.has(c.email)) {
      removedAlreadyInDB++;
      return false;
    }
    return true;
  });
  console.log(`Removed already in DB: ${removedAlreadyInDB}`);
  console.log(`After DB dedup: ${cleaned.length} contacts`);

  // ═══════════════════════════════════════════════════════════
  // STEP 5: SPLIT INTO 2K BATCHES & SAVE
  // ═══════════════════════════════════════════════════════════

  console.log('\n=== CREATING BATCHES ===\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Clean out old batches
  const oldFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('batch-'));
  oldFiles.forEach(f => fs.unlinkSync(path.join(OUTPUT_DIR, f)));

  const BATCH_SIZE = 2000;
  const csvHeader = 'first_name,last_name,email,company,title,phone,city,state,website,linkedin,segment,grade,email_status,source_file';

  const escapeCSV = (val) => {
    if (!val) return '';
    val = String(val);
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  };

  const totalBatches = Math.ceil(cleaned.length / BATCH_SIZE);

  for (let i = 0; i < totalBatches; i++) {
    const batch = cleaned.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const batchNum = String(i + 1).padStart(3, '0');
    const fileName = `batch-${batchNum}.csv`;

    const lines = [csvHeader];
    for (const c of batch) {
      lines.push([
        escapeCSV(c.first_name),
        escapeCSV(c.last_name),
        escapeCSV(c.email),
        escapeCSV(c.company),
        escapeCSV(c.title),
        escapeCSV(c.phone),
        escapeCSV(c.city),
        escapeCSV(c.state),
        escapeCSV(c.website),
        escapeCSV(c.linkedin),
        escapeCSV(c.segment),
        escapeCSV(c.grade),
        escapeCSV(c.email_status),
        escapeCSV(c.source_file),
      ].join(','));
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, fileName), lines.join('\n'), 'utf-8');
    console.log(`  ${fileName}: ${batch.length} contacts`);
  }

  // Also save a summary/manifest
  const segmentCounts = {};
  const gradeCounts = {};
  const sourceCounts = {};
  for (const c of cleaned) {
    segmentCounts[c.segment || 'unknown'] = (segmentCounts[c.segment || 'unknown'] || 0) + 1;
    gradeCounts[c.grade || 'ungraded'] = (gradeCounts[c.grade || 'ungraded'] || 0) + 1;
    sourceCounts[c.source_file || 'unknown'] = (sourceCounts[c.source_file || 'unknown'] || 0) + 1;
  }

  const manifest = {
    created: new Date().toISOString(),
    total_contacts: cleaned.length,
    total_batches: totalBatches,
    batch_size: BATCH_SIZE,
    removed: {
      email_duplicates: totalIngested - emailDeduped.length,
      name_company_duplicates: removedNameCompanyDupes,
      junk_first_names: removedJunkFirst,
      junk_last_names: removedJunkLast,
      generic_emails: removedGenericEmail,
      invalid_emails: removedInvalidEmail,
      no_name: removedNoName,
      already_in_db: removedAlreadyInDB,
    },
    by_segment: segmentCounts,
    by_grade: gradeCounts,
    by_source_file: sourceCounts,
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );

  console.log(`\n========================================`);
  console.log(`=== COMPLETE ===`);
  console.log(`========================================`);
  console.log(`Total ingested:    ${totalIngested}`);
  console.log(`After dedup:       ${deduped.length}`);
  console.log(`After cleaning:    ${cleaned.length}`);
  console.log(`Batches created:   ${totalBatches} (${BATCH_SIZE} each)`);
  console.log(`Output directory:  ${OUTPUT_DIR}`);
  console.log(`\nSegment breakdown:`);
  Object.entries(segmentCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log(`\nGrade breakdown:`);
  Object.entries(gradeCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
});
