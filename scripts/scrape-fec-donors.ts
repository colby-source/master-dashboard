/**
 * FEC Donor Scraper — Individuals with $25K+ federal political contributions
 *
 * Pipeline:
 * 1. Query FEC Schedule A for itemized individual contributions
 * 2. Filter: min_amount >= 25000, exclude retired/self/homemaker employer
 * 3. Aggregate by donor (name + occupation + employer) across cycles
 * 4. Emit one row per unique donor with cycle totals + most recent contribution
 * 5. Output to data/gpc-top-tier/fec/
 *
 * Cost: $0 — FEC OpenData API is free.
 * API key: set FEC_API_KEY in .env (free at api.data.gov, 1,000 req/hr).
 *          Falls back to DEMO_KEY (30 req/hr, enough for --test only).
 *
 * Run:
 *   npx tsx scripts/scrape-fec-donors.ts                    # current cycle (2025-2026)
 *   npx tsx scripts/scrape-fec-donors.ts --cycles=2024,2026 # multiple cycles
 *   npx tsx scripts/scrape-fec-donors.ts --test             # 2 pages, no dedupe
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import 'dotenv/config';

// ── Config ──────────────────────────────────────────────────
const OUT_DIR = path.join(__dirname, '..', 'data', 'gpc-top-tier', 'fec');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const MIN_AMOUNT = 25_000;
const EXCLUDED_EMPLOYER_REGEX = /^(retired|self|self[- ]?employed|homemaker|none|n\/?a|not\s+employed|unemployed|information\s+requested)$/i;
const EXCLUDED_OCCUPATION_REGEX = /^(retired|homemaker|unemployed|student|none|n\/?a|information\s+requested)$/i;

const API_KEY = process.env.FEC_API_KEY || 'DEMO_KEY';
const PER_PAGE = 100;
const REQ_DELAY_MS = API_KEY === 'DEMO_KEY' ? 2500 : 150; // respect 30/hr demo vs 1000/hr real
const USER_AGENT = 'GPC-Research research@granitepark.com';

const args = process.argv.slice(2);
const isTest = args.includes('--test');
const cyclesArg = args.find(a => a.startsWith('--cycles='));
const CYCLES = cyclesArg
  ? cyclesArg.split('=')[1].split(',').map((s) => parseInt(s.trim()))
  : [2026]; // default: current cycle
const PAGE_CAP = isTest ? 2 : Number.MAX_SAFE_INTEGER;

// ── HTTP helper ─────────────────────────────────────────────
async function httpGetJson(url: string): Promise<any> {
  await sleep(REQ_DELAY_MS);
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    }, (res) => {
      if (res.statusCode === 429) {
        return reject(new Error(`HTTP 429 rate-limited — use a real FEC_API_KEY`));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('timeout')));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── FEC types ───────────────────────────────────────────────
interface FecContribution {
  contributor_name: string;
  contributor_first_name?: string;
  contributor_middle_name?: string;
  contributor_last_name?: string;
  contributor_prefix?: string;
  contributor_suffix?: string;
  contributor_employer: string;
  contributor_occupation: string;
  contributor_city: string;
  contributor_state: string;
  contributor_zip: string;
  contribution_receipt_amount: number;
  contribution_receipt_date: string;
  committee_name: string;
  committee_id: string;
  two_year_transaction_period: number;
  link_id: string;
}

// ── Paginated fetch ─────────────────────────────────────────
async function fetchCycleDonors(cycle: number): Promise<FecContribution[]> {
  const all: FecContribution[] = [];
  const base = new URL('https://api.open.fec.gov/v1/schedules/schedule_a/');
  base.searchParams.set('api_key', API_KEY);
  base.searchParams.set('two_year_transaction_period', String(cycle));
  base.searchParams.set('min_amount', String(MIN_AMOUNT));
  base.searchParams.set('is_individual', 'true');
  base.searchParams.set('per_page', String(PER_PAGE));
  base.searchParams.set('sort', '-contribution_receipt_date');

  let lastIndexes: Record<string, unknown> = {};
  let page = 0;

  while (page < PAGE_CAP) {
    const url = new URL(base.toString());
    // FEC pagination: pass through whatever keys the prior response gave us.
    // Keys vary by sort order — `last_index` + `last_contribution_receipt_date` when sorting by date.
    for (const [k, v] of Object.entries(lastIndexes)) {
      if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }

    let data: any;
    try {
      data = await httpGetJson(url.toString());
    } catch (err) {
      console.warn(`\n  FEC page fetch failed at page ${page}: ${err instanceof Error ? err.message : err}`);
      break;
    }

    const results: FecContribution[] = data.results || [];
    if (results.length === 0) break;
    all.push(...results);

    const pagination = data.pagination;
    if (!pagination?.last_indexes) break;
    lastIndexes = pagination.last_indexes;
    page++;

    process.stdout.write(`\r  Cycle ${cycle}: page ${page}, ${all.length} contributions fetched`);
  }
  console.log();
  return all;
}

// ── Donor aggregation ───────────────────────────────────────
interface DonorRecord {
  donor_key: string;
  full_name: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  prefix: string;
  suffix: string;
  employer: string;
  occupation: string;
  city: string;
  state: string;
  zip_prefix: string;
  total_contributions_usd: number;
  num_contributions: number;
  num_recipients: number;
  cycles: number[];
  first_contribution_date: string;
  last_contribution_date: string;
  last_committee_name: string;
  last_contribution_amount: number;
  recipients_sample: string[];
  source_urls: string[];
}

function normalizeKey(s: string): string {
  return (s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function dedupeByDonor(contribs: FecContribution[]): DonorRecord[] {
  const map = new Map<string, DonorRecord>();

  for (const c of contribs) {
    const employer = (c.contributor_employer || '').trim();
    const occupation = (c.contributor_occupation || '').trim();

    if (!employer || EXCLUDED_EMPLOYER_REGEX.test(employer)) continue;
    if (!occupation || EXCLUDED_OCCUPATION_REGEX.test(occupation)) continue;

    const first = (c.contributor_first_name || '').trim();
    const last = (c.contributor_last_name || '').trim();
    if (!first || !last) continue;

    const key = [
      normalizeKey(first),
      normalizeKey(last),
      normalizeKey(employer),
      normalizeKey(c.contributor_state || ''),
    ].join('|');

    const existing = map.get(key);
    const amount = Number(c.contribution_receipt_amount || 0);
    const date = c.contribution_receipt_date || '';

    if (!existing) {
      map.set(key, {
        donor_key: key,
        full_name: c.contributor_name || `${first} ${last}`,
        first_name: first,
        last_name: last,
        middle_name: c.contributor_middle_name || '',
        prefix: c.contributor_prefix || '',
        suffix: c.contributor_suffix || '',
        employer,
        occupation,
        city: c.contributor_city || '',
        state: c.contributor_state || '',
        zip_prefix: (c.contributor_zip || '').slice(0, 5),
        total_contributions_usd: amount,
        num_contributions: 1,
        num_recipients: 1,
        cycles: [c.two_year_transaction_period],
        first_contribution_date: date,
        last_contribution_date: date,
        last_committee_name: c.committee_name || '',
        last_contribution_amount: amount,
        recipients_sample: [c.committee_name || ''].filter(Boolean),
        source_urls: [`https://www.fec.gov/data/receipts/?contributor_name=${encodeURIComponent(first + ' ' + last)}`],
      });
    } else {
      existing.total_contributions_usd += amount;
      existing.num_contributions += 1;
      if (!existing.cycles.includes(c.two_year_transaction_period)) {
        existing.cycles.push(c.two_year_transaction_period);
      }
      if (date > existing.last_contribution_date) {
        existing.last_contribution_date = date;
        existing.last_committee_name = c.committee_name || existing.last_committee_name;
        existing.last_contribution_amount = amount;
      }
      if (date && (existing.first_contribution_date === '' || date < existing.first_contribution_date)) {
        existing.first_contribution_date = date;
      }
      if (c.committee_name && !existing.recipients_sample.includes(c.committee_name) && existing.recipients_sample.length < 10) {
        existing.recipients_sample.push(c.committee_name);
        existing.num_recipients += 1;
      }
    }
  }

  return [...map.values()].sort((a, b) => b.total_contributions_usd - a.total_contributions_usd);
}

// ── CSV writer ──────────────────────────────────────────────
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(records: DonorRecord[], outPath: string): void {
  const header = [
    'first_name', 'last_name', 'middle_name', 'prefix', 'suffix',
    'employer', 'occupation', 'city', 'state', 'zip_prefix',
    'total_contributions_usd', 'num_contributions', 'num_recipients', 'cycles',
    'first_contribution_date', 'last_contribution_date',
    'last_committee_name', 'last_contribution_amount',
    'recipients_sample', 'donor_key',
  ];
  const rows = [header.join(',')];
  for (const r of records) {
    rows.push([
      r.first_name, r.last_name, r.middle_name, r.prefix, r.suffix,
      r.employer, r.occupation, r.city, r.state, r.zip_prefix,
      r.total_contributions_usd, r.num_contributions, r.num_recipients, r.cycles,
      r.first_contribution_date, r.last_contribution_date,
      r.last_committee_name, r.last_contribution_amount,
      r.recipients_sample, r.donor_key,
    ].map(csvEscape).join(','));
  }
  fs.writeFileSync(outPath, rows.join('\n'), 'utf8');
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  console.log(`FEC donor scraper — cycles ${CYCLES.join(',')}, min $${MIN_AMOUNT.toLocaleString()}${isTest ? ' (TEST)' : ''}`);
  if (API_KEY === 'DEMO_KEY') {
    console.log(`  WARNING: using DEMO_KEY (30 req/hr). Set FEC_API_KEY in .env for full run.`);
    console.log(`           Free at https://api.data.gov/signup/`);
  }

  const allContribs: FecContribution[] = [];
  for (const cycle of CYCLES) {
    const contribs = await fetchCycleDonors(cycle);
    allContribs.push(...contribs);
  }

  console.log(`  Total raw contributions: ${allContribs.length}`);
  const donors = dedupeByDonor(allContribs);
  console.log(`  Unique qualifying donors (after employer/occupation filter): ${donors.length}`);

  const stamp = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(OUT_DIR, `fec-donors-${stamp}.jsonl`);
  const csvPath = path.join(OUT_DIR, `fec-donors-${stamp}.csv`);
  const summaryPath = path.join(OUT_DIR, `fec-donors-${stamp}-summary.json`);

  fs.writeFileSync(jsonPath, donors.map((d) => JSON.stringify(d)).join('\n'), 'utf8');
  writeCsv(donors, csvPath);

  const occupationTally: Record<string, number> = {};
  for (const d of donors) {
    const occ = d.occupation.toUpperCase().trim();
    occupationTally[occ] = (occupationTally[occ] ?? 0) + 1;
  }
  const employerTally: Record<string, number> = {};
  for (const d of donors) {
    const emp = d.employer.toUpperCase().trim();
    employerTally[emp] = (employerTally[emp] ?? 0) + 1;
  }

  const summary = {
    run_at: new Date().toISOString(),
    cycles: CYCLES,
    min_amount_usd: MIN_AMOUNT,
    raw_contributions: allContribs.length,
    unique_donors: donors.length,
    total_dollars: donors.reduce((s, d) => s + d.total_contributions_usd, 0),
    top_occupations: Object.fromEntries(
      Object.entries(occupationTally).sort((a, b) => b[1] - a[1]).slice(0, 25),
    ),
    top_employers: Object.fromEntries(
      Object.entries(employerTally).sort((a, b) => b[1] - a[1]).slice(0, 25),
    ),
    top_states: (() => {
      const t: Record<string, number> = {};
      for (const d of donors) t[d.state] = (t[d.state] ?? 0) + 1;
      return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 15));
    })(),
    outputs: { jsonl: jsonPath, csv: csvPath },
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\nDone.`);
  console.log(`  Raw contributions:  ${allContribs.length}`);
  console.log(`  Unique donors:      ${donors.length}`);
  console.log(`  Total dollars:      $${summary.total_dollars.toLocaleString()}`);
  console.log(`  JSONL: ${jsonPath}`);
  console.log(`  CSV:   ${csvPath}`);
  console.log(`  Summary: ${summaryPath}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
