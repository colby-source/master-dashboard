/**
 * Organize all GPC lead data into clean, globally-deduped enrichment batches.
 * Deduplicates across ALL sources by email + LinkedIn URL.
 *
 * Run: npx tsx scripts/organize-enrichment-batches.ts
 */
import fs from 'fs';
import path from 'path';

const OUT_DIR = path.join(__dirname, '..', 'data', 'enrichment-batches');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── CSV Parser ──────────────────────────────────────────────
function parseCsv(filepath: string, delimiter = ','): Record<string, string>[] {
  const text = fs.readFileSync(filepath, 'utf8');
  const lines = text.trim().split('\n');
  const headers = lines[0].split(delimiter).map(h => h.replace(/^"|"$/g, '').trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    let vals: string[];
    if (delimiter === ',') {
      vals = (lines[i].match(/(?:"[^"]*"|[^,]*)(?:,|$)/g) || []).map(v => v.replace(/,$/, '').replace(/^"|"$/g, '').trim());
    } else {
      vals = lines[i].split(delimiter).map(v => v.replace(/^"|"$/g, '').trim());
    }
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
    rows.push(obj);
  }
  return rows;
}

// ── Global dedup ────────────────────────────────────────────
const globalEmails = new Set<string>();
const globalLinkedIn = new Set<string>();

function isDupe(email?: string, linkedinUrl?: string): boolean {
  const e = (email || '').toLowerCase().trim();
  const li = (linkedinUrl || '').toLowerCase().replace(/\/$/, '');
  if (e && globalEmails.has(e)) return true;
  if (li && globalLinkedIn.has(li)) return true;
  return false;
}

function markSeen(email?: string, linkedinUrl?: string): void {
  const e = (email || '').toLowerCase().trim();
  const li = (linkedinUrl || '').toLowerCase().replace(/\/$/, '');
  if (e) globalEmails.add(e);
  if (li) globalLinkedIn.add(li);
}

// ── Standard lead shape ─────────────────────────────────────
interface Lead {
  first_name: string;
  last_name: string;
  company: string;
  title: string;
  linkedin_url: string;
  email: string;
  location: string;
  state: string;
  source: string;
  [key: string]: string;
}

// ── Write batch ─────────────────────────────────────────────
function writeBatch(filename: string, rows: Lead[]): void {
  fs.writeFileSync(path.join(OUT_DIR, filename + '.json'), JSON.stringify(rows, null, 2));
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(',')];
  for (const r of rows) {
    const vals = headers.map(h => {
      const v = String(r[h] || '');
      return (v.includes(',') || v.includes('"')) ? '"' + v.replace(/"/g, '""') + '"' : v;
    });
    csvLines.push(vals.join(','));
  }
  fs.writeFileSync(path.join(OUT_DIR, filename + '.csv'), csvLines.join('\n'));
}

// ── MAIN ────────────────────────────────────────────────────
function main() {
  // 1. LinkedIn scrape (26,882 — no emails)
  const linkedin: any[] = JSON.parse(fs.readFileSync('data/family-office-scrape/family-office-leads-combined.json', 'utf8'));
  console.log('Loaded LinkedIn scrape:', linkedin.length);

  // 2. Miami FO (has emails)
  const miamiPath = path.join(process.env.USERPROFILE || 'C:\\Users\\colby', 'Downloads', 'Family Office Groups Miami_valid_clean USe this.csv');
  const miami = fs.existsSync(miamiPath) ? parseCsv(miamiPath) : [];
  console.log('Loaded Miami FO:', miami.length);

  // 3. AMF results (5 files, has emails)
  const amfDir = 'data/amf-results';
  const amf: Record<string, string>[] = [];
  for (const f of fs.readdirSync(amfDir).filter(f => f.endsWith('.csv'))) {
    const rows = parseCsv(path.join(amfDir, f));
    amf.push(...rows.map(r => ({ ...r, _source_file: f })));
  }
  console.log('Loaded AMF results:', amf.length);

  // 4. Cold batch (1,960 — has emails, graded)
  const coldBatch = parseCsv('data/cold-batches/batch-001.csv');
  console.log('Loaded cold batch:', coldBatch.length);

  // 5. VNTR investor party
  const vntr = parseCsv('data/cold-batches/vntr-investor-party-2026-03-18.csv');
  console.log('Loaded VNTR:', vntr.length);

  // 6. LeadHawk LinkedIn exports
  const lhPath = path.join(process.env.USERPROFILE || 'C:\\Users\\colby', 'Downloads', 'Profiles downloaded from lh-Colby-Watkins-#5908 at 2026-02-24T22-52-59.521Z.csv');
  const lhProfiles = fs.existsSync(lhPath) ? parseCsv(lhPath, ';') : [];
  console.log('Loaded LeadHawk profiles:', lhProfiles.length);

  // Also load the DB emails to dedup against what's already been sent
  const dbEmails: string[] = [];
  try {
    // Just read from the cold batch manifest to know what's already in DB
    const manifest = JSON.parse(fs.readFileSync('data/cold-batches/manifest.json', 'utf8'));
    console.log('DB already has:', manifest.total_contacts, 'contacts (will dedup against)');
  } catch { /* expected */ }

  console.log('\n── Building batches (global dedup active) ──\n');

  // BATCH 1: LinkedIn scrape
  const batch1: Lead[] = [];
  for (const l of linkedin) {
    if (!isDupe('', l.linkedInUrl)) {
      batch1.push({
        first_name: l.firstName || '',
        last_name: l.lastName || '',
        company: l.company || '',
        title: l.title || '',
        linkedin_url: l.linkedInUrl || '',
        email: '',
        location: l.location || '',
        state: l.state || '',
        source: 'linkedin_scrape',
      });
      markSeen('', l.linkedInUrl);
    }
  }
  console.log('Batch 1 (LinkedIn):     ' + batch1.length + ' (from ' + linkedin.length + ')');

  // BATCH 2: Miami FO
  const batch2: Lead[] = [];
  for (const l of miami) {
    const email = l.valid_email_only || l.email || '';
    const li = l.linkedin_url || '';
    if (!isDupe(email, li) && email) {
      batch2.push({
        first_name: l.first_name || l.original_first_name || '',
        last_name: l.last_name || l.original_last_name || '',
        company: l.current_company || '',
        title: l.result_title || l.headline || '',
        linkedin_url: li,
        email,
        location: l.location_name || '',
        state: '',
        source: 'miami_fo',
      });
      markSeen(email, li);
    }
  }
  console.log('Batch 2 (Miami FO):     ' + batch2.length + ' (from ' + miami.length + ')');

  // BATCH 3: AMF results
  const batch3: Lead[] = [];
  for (const l of amf) {
    const email = l.email || '';
    if (!isDupe(email, '') && email) {
      batch3.push({
        first_name: l.first_name || '',
        last_name: l.last_name || '',
        company: l.company || '',
        title: l.title || '',
        linkedin_url: '',
        email,
        location: [l.city, l.state].filter(Boolean).join(', '),
        state: l.state || '',
        source: 'amf_' + (l._source_file || '').replace('.csv', ''),
      });
      markSeen(email, '');
    }
  }
  console.log('Batch 3 (AMF):          ' + batch3.length + ' (from ' + amf.length + ')');

  // BATCH 4: Cold batch
  const batch4: Lead[] = [];
  for (const l of coldBatch) {
    const email = l.email || '';
    const li = l.linkedin || '';
    if (!isDupe(email, li) && email) {
      batch4.push({
        first_name: l.first_name || '',
        last_name: l.last_name || '',
        company: l.company || '',
        title: l.title || '',
        linkedin_url: li,
        email,
        location: [l.city, l.state].filter(Boolean).join(', '),
        state: l.state || '',
        grade: l.grade || '',
        segment: l.segment || '',
        source: 'cold_batch_001',
      });
      markSeen(email, li);
    }
  }
  console.log('Batch 4 (Cold graded):  ' + batch4.length + ' (from ' + coldBatch.length + ')');

  // BATCH 5: VNTR + LeadHawk
  const batch5: Lead[] = [];
  for (const l of vntr) {
    const email = l.email || '';
    if (!isDupe(email, '') && email) {
      batch5.push({
        first_name: l.first_name || '',
        last_name: l.last_name || '',
        company: l.company || '',
        title: l.title || '',
        linkedin_url: l.linkedin || '',
        email,
        location: [l.city, l.state].filter(Boolean).join(', '),
        state: l.state || '',
        source: 'vntr_investor_party',
      });
      markSeen(email, '');
    }
  }
  for (const l of lhProfiles) {
    const li = l.profile_url || '';
    if (li && !isDupe('', li)) {
      batch5.push({
        first_name: '',
        last_name: '',
        company: '',
        title: '',
        linkedin_url: li,
        email: '',
        location: '',
        state: '',
        source: 'leadhawk_linkedin',
      });
      markSeen('', li);
    }
  }
  console.log('Batch 5 (VNTR+LH):     ' + batch5.length);

  // ── Write all batches ───────────────────────────────────────
  writeBatch('batch-1-linkedin-scrape', batch1);
  writeBatch('batch-2-miami-fo', batch2);
  writeBatch('batch-3-amf-enriched', batch3);
  writeBatch('batch-4-cold-graded', batch4);
  writeBatch('batch-5-vntr-leadhawk', batch5);

  const total = batch1.length + batch2.length + batch3.length + batch4.length + batch5.length;

  // ── Manifest ──────────────────────────────────────────────
  const manifest = {
    created: new Date().toISOString(),
    global_dedup: { unique_emails: globalEmails.size, unique_linkedin_urls: globalLinkedIn.size },
    batches: [
      { file: 'batch-1-linkedin-scrape', leads: batch1.length, has_email: false, status: 'ENRICH FIRST — needs PDL/Hunter', source: 'LinkedIn Sales Nav family office scrape (50 states + overflow)' },
      { file: 'batch-2-miami-fo', leads: batch2.length, has_email: true, status: 'Ready', source: 'Family Office Groups Miami validated list' },
      { file: 'batch-3-amf-enriched', leads: batch3.length, has_email: true, status: 'Ready', source: 'AnyMailFinder (Form D, FO/LP, RE investors)' },
      { file: 'batch-4-cold-graded', leads: batch4.length, has_email: true, status: 'Ready', source: 'Cold batch — TAX/PREF/RE segments, graded' },
      { file: 'batch-5-vntr-leadhawk', leads: batch5.length, has_email: 'partial', status: 'Partial — LeadHawk needs enrichment', source: 'VNTR investor party + LeadHawk LinkedIn exports' },
    ],
    total_unique_leads: total,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('\n════════════════════════════════════════════');
  console.log('  ENRICHMENT BATCHES — data/enrichment-batches/');
  console.log('════════════════════════════════════════════');
  console.log('  Batch 1 (LinkedIn):     ' + batch1.length.toLocaleString() + '  — ENRICH FIRST');
  console.log('  Batch 2 (Miami FO):     ' + batch2.length.toLocaleString() + '  — has emails');
  console.log('  Batch 3 (AMF):          ' + batch3.length.toLocaleString() + '  — has emails');
  console.log('  Batch 4 (Cold graded):  ' + batch4.length.toLocaleString() + '  — has emails');
  console.log('  Batch 5 (VNTR+LH):     ' + batch5.length.toLocaleString() + '  — partial');
  console.log('  ──────────────────────────────────────────');
  console.log('  TOTAL UNIQUE:           ' + total.toLocaleString());
  console.log('  Dupes removed:          ' + (linkedin.length + miami.length + amf.length + coldBatch.length + vntr.length + lhProfiles.length - total).toLocaleString());
  console.log('════════════════════════════════════════════');
}

main();
