/**
 * Merge + dedupe GPC top-tier scrape outputs (SEC Form 4 + FEC donors)
 * against each other AND against existing enrichment-batches CSVs.
 *
 * Goal: compute the TRUE unique-new-prospect count so we can budget enrichment accurately.
 *
 * Output:
 *   data/gpc-top-tier/merged-to-enrich.csv    — unique new records (not in existing leads)
 *   data/gpc-top-tier/merge-report.json        — dedupe stats by source
 *
 * Run: npx tsx scripts/merge-gpc-top-tier.ts
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '..', 'data', 'gpc-top-tier');
const ENRICHMENT_DIR = path.join(__dirname, '..', 'data', 'enrichment-batches');
const OUT_CSV = path.join(DATA_DIR, 'merged-to-enrich.csv');
const OUT_REPORT = path.join(DATA_DIR, 'merge-report.json');

// Existing lead files to dedupe against (biggest/most-enriched first)
const EXISTING_LEAD_CSVS = [
  'gpf2-first-send-INSTANTLY-READY.csv',
  'batch-1-linkedin-scrape.csv',
  'source-linkedin-scrape-clean.csv',
  'gpf2-claude-evaluated.csv',
  'batch-7-irs-foundations.csv',
  'batch-3-amf-enriched.csv',
];

// ── Normalization ───────────────────────────────────────────
const CORP_SUFFIX_RE = /\b(inc|incorporated|llc|l\.l\.c|lp|l\.p|ltd|limited|corp|corporation|co|company|group|holdings|holding|capital|partners|management|mgmt|llc\.|the)\b\.?/gi;

function normName(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function normCompany(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[.,&]/g, ' ')
    .replace(CORP_SUFFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

function personKey(first: string, last: string, company: string): string {
  return `${normName(first)}|${normName(last)}|${normCompany(company)}`;
}

function personKeyLoose(first: string, last: string): string {
  // Looser key: just first+last. Used to catch people who appear at diff companies
  return `${normName(first)}|${normName(last)}`;
}

// ── CSV parser (minimal, handles quotes) ────────────────────
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else { cur += c; }
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') { inQuotes = true; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out;
}

function readCsvAsObjects(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const obj: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = (cells[j] || '').trim();
    rows.push(obj);
  }
  return rows;
}

// ── Load existing leads into a Set of keys ──────────────────
function loadExistingKeys(): { strict: Set<string>; loose: Set<string>; fileCounts: Record<string, number> } {
  const strict = new Set<string>();
  const loose = new Set<string>();
  const fileCounts: Record<string, number> = {};

  for (const file of EXISTING_LEAD_CSVS) {
    const full = path.join(ENRICHMENT_DIR, file);
    const rows = readCsvAsObjects(full);
    if (rows.length === 0) continue;

    let added = 0;
    for (const r of rows) {
      const first = r.first_name || r.firstName || r['First Name'] || '';
      const last = r.last_name || r.lastName || r['Last Name'] || '';
      const company = r.company || r.company_name || r.companyName || r['Company'] || r.employer || '';
      if (!first || !last) continue;
      const k1 = personKey(first, last, company);
      const k2 = personKeyLoose(first, last);
      if (!strict.has(k1)) { strict.add(k1); added++; }
      loose.add(k2);
    }
    fileCounts[file] = rows.length;
    console.log(`  loaded ${file}: ${rows.length} rows (+${added} new keys)`);
  }

  return { strict, loose, fileCounts };
}

// ── Load SEC Form 4 + dedupe internally ─────────────────────
interface MergedRecord {
  source: 'sec-form-4' | 'fec';
  first_name: string;
  last_name: string;
  company: string;
  title: string;
  city: string;
  state: string;
  signal: string;
  signal_dollar_value: number;
  signal_date: string;
  ticker_or_domain: string;
  source_url: string;
}

function loadSecForm4(): MergedRecord[] {
  const file = fs.readdirSync(path.join(DATA_DIR, 'sec-form-4'))
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .pop();
  if (!file) return [];
  const lines = fs.readFileSync(path.join(DATA_DIR, 'sec-form-4', file), 'utf8')
    .split('\n').filter((l) => l.length > 0);

  const byPerson = new Map<string, MergedRecord>();
  for (const line of lines) {
    const r = JSON.parse(line);
    // Split reporterName — formats: "Last, First Middle", "LAST FIRST MIDDLE", "First Last"
    const name = (r.reporterName || '').trim();
    let first = '', last = '';
    if (name.includes(',')) {
      const [ln, rest] = name.split(',');
      last = ln.trim();
      first = (rest || '').trim().split(/\s+/)[0];
    } else {
      const parts = name.split(/\s+/);
      if (parts.length >= 2) {
        // Assume all-caps = LAST FIRST...; mixed case = First Last
        if (name === name.toUpperCase()) {
          last = parts[0];
          first = parts[1];
        } else {
          first = parts[0];
          last = parts[parts.length - 1];
        }
      }
    }
    if (!first || !last) continue;

    const role = r.officerTitle ||
      (r.isDirector ? 'Director' : (r.isTenPercentOwner ? '10% Owner' : 'Insider'));

    const key = personKey(first, last, r.issuerName || '');
    const dollar = r.maxTransactionUsd || 0;
    const existing = byPerson.get(key);
    if (!existing || dollar > existing.signal_dollar_value) {
      byPerson.set(key, {
        source: 'sec-form-4',
        first_name: first,
        last_name: last,
        company: r.issuerName || '',
        title: role,
        city: '',
        state: '',
        signal: `Stock transaction ${r.transactions?.[0]?.transactionCode || ''}`,
        signal_dollar_value: dollar,
        signal_date: r.transactions?.[0]?.transactionDate || r.filedAt || '',
        ticker_or_domain: r.issuerTicker || '',
        source_url: r.sourceUrl || '',
      });
    }
  }
  return [...byPerson.values()];
}

function loadFec(): MergedRecord[] {
  const file = fs.readdirSync(path.join(DATA_DIR, 'fec'))
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .pop();
  if (!file) return [];
  const lines = fs.readFileSync(path.join(DATA_DIR, 'fec', file), 'utf8')
    .split('\n').filter((l) => l.length > 0);

  return lines.map((line) => {
    const r = JSON.parse(line);
    return {
      source: 'fec' as const,
      first_name: r.first_name,
      last_name: r.last_name,
      company: r.employer,
      title: r.occupation,
      city: r.city,
      state: r.state,
      signal: `Political donor, ${r.num_contributions} contribs, ${r.cycles?.join('+') || ''} cycle`,
      signal_dollar_value: r.total_contributions_usd,
      signal_date: r.last_contribution_date,
      ticker_or_domain: '',
      source_url: r.source_urls?.[0] || '',
    };
  });
}

// ── CSV writer ──────────────────────────────────────────────
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(records: MergedRecord[], outPath: string): void {
  const header = ['source','first_name','last_name','company','title','city','state','signal','signal_dollar_value','signal_date','ticker_or_domain','source_url'];
  const rows = [header.join(',')];
  for (const r of records) {
    rows.push(header.map((h) => csvEscape((r as any)[h])).join(','));
  }
  fs.writeFileSync(outPath, rows.join('\n'), 'utf8');
}

// ── Main ────────────────────────────────────────────────────
function main() {
  console.log('Loading existing GPC leads for dedupe...');
  const existing = loadExistingKeys();
  console.log(`  Total strict keys in existing pool: ${existing.strict.size}`);
  console.log(`  Total loose keys in existing pool:  ${existing.loose.size}`);

  console.log('\nLoading SEC Form 4...');
  const sec = loadSecForm4();
  console.log(`  SEC Form 4 unique people: ${sec.length}`);

  console.log('\nLoading FEC donors...');
  const fec = loadFec();
  console.log(`  FEC donors: ${fec.length}`);

  console.log('\nCross-deduping SEC vs FEC vs existing...');
  const seen = new Set<string>();
  const merged: MergedRecord[] = [];
  let dupSec = 0, dupFec = 0, existingMatches = 0;

  // Prefer FEC first (more signal for RE/PE fit), then SEC
  for (const r of [...fec, ...sec]) {
    const k1 = personKey(r.first_name, r.last_name, r.company);
    const k2 = personKeyLoose(r.first_name, r.last_name);
    if (seen.has(k1)) {
      if (r.source === 'sec-form-4') dupSec++; else dupFec++;
      continue;
    }
    if (existing.strict.has(k1) || existing.loose.has(k2)) {
      existingMatches++;
      continue;
    }
    seen.add(k1);
    merged.push(r);
  }

  console.log(`\nResults:`);
  console.log(`  SEC internal duplicates skipped: ${dupSec}`);
  console.log(`  FEC internal duplicates skipped: ${dupFec}`);
  console.log(`  Matches in existing GPC leads:   ${existingMatches}`);
  console.log(`  UNIQUE NEW RECORDS TO ENRICH:    ${merged.length}`);

  writeCsv(merged, OUT_CSV);

  const bySource: Record<string, number> = {};
  for (const r of merged) bySource[r.source] = (bySource[r.source] || 0) + 1;
  const byState: Record<string, number> = {};
  for (const r of merged) if (r.state) byState[r.state] = (byState[r.state] || 0) + 1;

  const report = {
    run_at: new Date().toISOString(),
    existing_leads_files: existing.fileCounts,
    existing_strict_keys: existing.strict.size,
    existing_loose_keys: existing.loose.size,
    raw_sec_unique_people: sec.length,
    raw_fec_donors: fec.length,
    internal_duplicates_sec: dupSec,
    internal_duplicates_fec: dupFec,
    existing_matches: existingMatches,
    unique_new_to_enrich: merged.length,
    by_source: bySource,
    top_states: Object.fromEntries(Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 15)),
    output_csv: OUT_CSV,
  };
  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nCSV:    ${OUT_CSV}`);
  console.log(`Report: ${OUT_REPORT}`);
}

main();
