/**
 * SEC Form 4 Scraper — Public-company insiders with recent stock liquidity events
 *
 * Pipeline:
 * 1. Walk EDGAR daily-index files for the past N days
 * 2. Pick out all Form 4 filings
 * 3. Download each Form 4 XML doc
 * 4. Parse out reporter name, role, issuer (ticker + CIK + company name),
 *    transaction code, transaction value, filing date
 * 5. Filter to sales/awards ≥ MIN_TRANSACTION_USD
 * 6. Output to data/gpc-top-tier/sec-form-4/
 *
 * Cost: $0 — SEC EDGAR is free and public.
 * SEC courtesy: 10 req/sec max, descriptive User-Agent required.
 *
 * Run:
 *   npx tsx scripts/scrape-sec-form-4.ts               # 180 days, full run
 *   npx tsx scripts/scrape-sec-form-4.ts --days=7      # last 7 days
 *   npx tsx scripts/scrape-sec-form-4.ts --test        # last 1 day, cap 50 filings
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import { XMLParser } from 'fast-xml-parser';

// ── Config ──────────────────────────────────────────────────
const OUT_DIR = path.join(__dirname, '..', 'data', 'gpc-top-tier', 'sec-form-4');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const MIN_TRANSACTION_USD = 500_000;
const USER_AGENT = 'GPC-Research research@granitepark.com';
const REQ_DELAY_MS = 120; // ~8 req/sec, under SEC 10/sec limit
const MAX_CONCURRENT_XML = 5;

const args = process.argv.slice(2);
const isTest = args.includes('--test');
const daysArg = args.find(a => a.startsWith('--days='));
const DAYS = isTest ? 1 : (daysArg ? parseInt(daysArg.split('=')[1]) : 180);
const FILING_CAP = isTest ? 50 : Number.MAX_SAFE_INTEGER;

// ── HTTP helper ─────────────────────────────────────────────
async function httpGetOnce(url: string): Promise<string> {
  await sleep(REQ_DELAY_MS);
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (loc) return httpGetOnce(loc).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
  });
}

async function httpGet(url: string, maxRetries = 3): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await httpGetOnce(url);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Non-retryable: 404 → let caller handle (e.g. holiday index)
      if (msg.includes('HTTP 404')) throw err;
      // Retryable: 429, 500-599, timeouts, connection resets — exponential backoff
      const isRetryable = msg.includes('HTTP 429') ||
        msg.includes('HTTP 5') ||
        msg.includes('timeout') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT');
      if (!isRetryable) throw err;
      const backoff = 1000 * Math.pow(2, attempt);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Date helpers ────────────────────────────────────────────
function formatYMD(d: Date): { year: number; quarter: number; ymd: string } {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const quarter = Math.ceil(month / 3);
  const ymd = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  return { year, quarter, ymd };
}

function walkBusinessDays(days: number): Date[] {
  const out: Date[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let cursor = new Date(today);
  // Start from yesterday since today's index may not be posted
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (out.length < days) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

// ── EDGAR daily index ───────────────────────────────────────
interface IndexEntry {
  formType: string;
  companyName: string;
  cik: string;
  dateFiled: string;
  filename: string;
}

const INDEX_ROW_RE = /^(.+?)\s{2,}(4|4\/A)\s{2,}(\d+)\s+(\d{8})\s+(edgar\/data\/\S+)$/;

function parseCompanyIdx(text: string): IndexEntry[] {
  const lines = text.split('\n');
  const out: IndexEntry[] = [];
  let seenHeader = false;
  for (const line of lines) {
    if (line.startsWith('---')) { seenHeader = true; continue; }
    if (!seenHeader) continue;
    const m = line.match(INDEX_ROW_RE);
    if (!m) continue;
    out.push({
      companyName: m[1].trim(),
      formType: m[2],
      cik: m[3],
      dateFiled: m[4],
      filename: m[5],
    });
  }
  return out;
}

// Federal holidays when SEC doesn't publish a daily index (2025-2026 observed)
const KNOWN_HOLIDAYS_YMD = new Set([
  '20250101', '20250120', '20250217', '20250526', '20250619', '20250704',
  '20250901', '20251013', '20251111', '20251127', '20251225',
  '20260101', '20260119', '20260216', '20260525', '20260619', '20260703',
  '20260907', '20261012', '20261111', '20261126', '20261225',
]);

async function fetchDailyIndex(d: Date): Promise<IndexEntry[]> {
  const { year, quarter, ymd } = formatYMD(d);
  if (KNOWN_HOLIDAYS_YMD.has(ymd)) return [];
  const url = `https://www.sec.gov/Archives/edgar/daily-index/${year}/QTR${quarter}/company.${ymd}.idx`;
  try {
    const text = await httpGet(url);
    return parseCompanyIdx(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 404 / 403 commonly returned for missing-index days (holidays, pre-publish).
    // Swallow and return empty so one bad day doesn't kill a 180-day run.
    if (msg.includes('HTTP 404') || msg.includes('HTTP 403')) return [];
    // Log and continue on other errors — never fatal at this layer
    console.warn(`\n  WARN: index fetch failed for ${ymd}: ${msg}`);
    return [];
  }
}

// ── Form 4 XML parse ────────────────────────────────────────
interface Form4Record {
  accession: string;
  filedAt: string;
  issuerName: string;
  issuerTicker: string;
  issuerCik: string;
  reporterName: string;
  reporterCik: string;
  isOfficer: boolean;
  isDirector: boolean;
  isTenPercentOwner: boolean;
  officerTitle: string | null;
  transactions: Array<{
    securityTitle: string;
    transactionDate: string;
    transactionCode: string; // S=sale, P=purchase, A=award, M=exercise, etc.
    shares: number;
    pricePerShare: number;
    totalValueUsd: number;
    sharesOwnedAfter: number;
    acquiredOrDisposed: 'A' | 'D';
  }>;
  maxTransactionUsd: number;
  sourceUrl: string;
}

function pickForm4Xml(indexHtml: string): string | null {
  // Match hrefs for form 4 primary XML. Skip FilingSummary.xml / R*.xml index files.
  const hrefs = [...indexHtml.matchAll(/href="([^"]+\.xml)"/gi)].map((m) => m[1]);
  const filtered = hrefs.filter((h) => {
    const name = h.split('/').pop() || '';
    if (/^FilingSummary\.xml$/i.test(name)) return false;
    if (/^R\d+\.xml$/i.test(name)) return false;
    if (/^Financial_Report\.xml$/i.test(name)) return false;
    return true;
  });
  // Prefer one with "form4" in the name, else first non-index XML
  const preferred = filtered.find((h) => /form4/i.test(h));
  return preferred || filtered[0] || null;
}

async function fetchForm4(entry: IndexEntry): Promise<Form4Record | null> {
  // entry.filename = edgar/data/<cik>/<accession-with-dashes>.txt
  // Dir listing lives at /Archives/edgar/data/<cik_int>/<accession-no-dashes>/
  const accMatch = entry.filename.match(/(\d{10}-\d{2}-\d{6})/);
  if (!accMatch) return null;
  const accession = accMatch[1];
  const accessionNoDash = accession.replace(/-/g, '');
  const cikInt = parseInt(entry.cik).toString();
  const dirUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accessionNoDash}/`;

  let indexHtml: string;
  try {
    indexHtml = await httpGet(dirUrl);
  } catch {
    return null;
  }

  const xmlRel = pickForm4Xml(indexHtml);
  if (!xmlRel) return null;

  const xmlUrl = xmlRel.startsWith('http')
    ? xmlRel
    : `https://www.sec.gov${xmlRel.startsWith('/') ? '' : '/'}${xmlRel}`;

  let xml: string;
  try {
    xml = await httpGet(xmlUrl);
  } catch {
    return null;
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: true,
    parseAttributeValue: true,
    isArray: (name) => ['nonDerivativeTransaction', 'derivativeTransaction'].includes(name),
  });

  let doc: any;
  try { doc = parser.parse(xml); } catch { return null; }

  const ownershipDoc = doc?.ownershipDocument;
  if (!ownershipDoc) return null;

  const issuer = ownershipDoc.issuer || {};
  // reportingOwner can be a single object OR an array (joint filings)
  const reporterRaw = Array.isArray(ownershipDoc.reportingOwner)
    ? ownershipDoc.reportingOwner[0]
    : ownershipDoc.reportingOwner;
  const reporter = reporterRaw || {};
  const reporterId = reporter.reportingOwnerId || {};
  const reporterRel = reporter.reportingOwnerRelationship || {};

  const rawTxns = [
    ...(ownershipDoc.nonDerivativeTable?.nonDerivativeTransaction || []),
    ...(ownershipDoc.derivativeTable?.derivativeTransaction || []),
  ];

  const transactions = rawTxns.map((t: any) => {
    const shares = Number(t.transactionAmounts?.transactionShares?.value ?? 0);
    const price = Number(t.transactionAmounts?.transactionPricePerShare?.value ?? 0);
    return {
      securityTitle: String(t.securityTitle?.value ?? ''),
      transactionDate: String(t.transactionDate?.value ?? ''),
      transactionCode: String(t.transactionCoding?.transactionCode ?? ''),
      shares,
      pricePerShare: price,
      totalValueUsd: Math.round(shares * price),
      sharesOwnedAfter: Number(t.postTransactionAmounts?.sharesOwnedFollowingTransaction?.value ?? 0),
      acquiredOrDisposed: String(t.transactionAmounts?.transactionAcquiredDisposedCode?.value ?? '') as 'A' | 'D',
    };
  });

  const maxTransactionUsd = transactions.reduce((m, t) => Math.max(m, t.totalValueUsd), 0);

  return {
    accession,
    filedAt: String(ownershipDoc.periodOfReport ?? entry.dateFiled),
    issuerName: String(issuer.issuerName ?? entry.companyName),
    issuerTicker: String(issuer.issuerTradingSymbol ?? ''),
    issuerCik: String(issuer.issuerCik ?? entry.cik),
    reporterName: String(reporterId.rptOwnerName ?? ''),
    reporterCik: String(reporterId.rptOwnerCik ?? ''),
    isOfficer: String(reporterRel.isOfficer ?? '0') === '1' || reporterRel.isOfficer === true,
    isDirector: String(reporterRel.isDirector ?? '0') === '1' || reporterRel.isDirector === true,
    isTenPercentOwner: String(reporterRel.isTenPercentOwner ?? '0') === '1' || reporterRel.isTenPercentOwner === true,
    officerTitle: reporterRel.officerTitle ? String(reporterRel.officerTitle) : null,
    transactions,
    maxTransactionUsd,
    sourceUrl: xmlUrl,
  };
}

// ── Concurrency helper ──────────────────────────────────────
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      out[myIdx] = await fn(items[myIdx]);
    }
  });
  await Promise.all(workers);
  return out;
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

function writeCsv(records: Form4Record[], outPath: string): void {
  const header = [
    'reporter_name', 'reporter_cik', 'officer_title',
    'is_officer', 'is_director', 'is_ten_percent_owner',
    'issuer_name', 'issuer_ticker', 'issuer_cik',
    'filed_at', 'max_transaction_usd',
    'transaction_code', 'transaction_date', 'shares', 'price_per_share', 'acquired_or_disposed',
    'accession', 'source_url',
  ];
  const rows: string[] = [header.join(',')];
  for (const r of records) {
    // Emit one row per transaction (max) to keep it flat
    const t = r.transactions.reduce(
      (best, cur) => cur.totalValueUsd > (best?.totalValueUsd ?? 0) ? cur : best,
      r.transactions[0],
    );
    if (!t) continue;
    rows.push([
      r.reporterName, r.reporterCik, r.officerTitle,
      r.isOfficer, r.isDirector, r.isTenPercentOwner,
      r.issuerName, r.issuerTicker, r.issuerCik,
      r.filedAt, r.maxTransactionUsd,
      t.transactionCode, t.transactionDate, t.shares, t.pricePerShare, t.acquiredOrDisposed,
      r.accession, r.sourceUrl,
    ].map(csvEscape).join(','));
  }
  fs.writeFileSync(outPath, rows.join('\n'), 'utf8');
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  console.log(`SEC Form 4 scraper — ${DAYS} days, min transaction $${MIN_TRANSACTION_USD.toLocaleString()}${isTest ? ' (TEST)' : ''}`);
  const days = walkBusinessDays(DAYS);
  console.log(`  Walking ${days.length} business days from ${days[days.length - 1]?.toISOString().slice(0, 10)} to ${days[0]?.toISOString().slice(0, 10)}`);

  const allEntries: IndexEntry[] = [];
  for (const d of days) {
    const entries = await fetchDailyIndex(d);
    allEntries.push(...entries);
    process.stdout.write(`\r  Indexed ${d.toISOString().slice(0, 10)}: +${entries.length} filings (total ${allEntries.length})`);
  }
  console.log();

  const capped = allEntries.slice(0, FILING_CAP);
  console.log(`  Fetching ${capped.length} Form 4 XML docs (cap=${FILING_CAP === Number.MAX_SAFE_INTEGER ? 'none' : FILING_CAP})...`);

  let done = 0;
  const records = await mapLimit(capped, MAX_CONCURRENT_XML, async (entry) => {
    const rec = await fetchForm4(entry);
    done++;
    if (done % 50 === 0 || done === capped.length) {
      process.stdout.write(`\r  Parsed ${done}/${capped.length}`);
    }
    return rec;
  });
  console.log();

  const parsed = records.filter((r): r is Form4Record => r !== null);
  const qualifying = parsed.filter((r) => r.maxTransactionUsd >= MIN_TRANSACTION_USD);

  const stamp = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(OUT_DIR, `form-4-${stamp}.jsonl`);
  const csvPath = path.join(OUT_DIR, `form-4-${stamp}.csv`);
  const summaryPath = path.join(OUT_DIR, `form-4-${stamp}-summary.json`);

  fs.writeFileSync(jsonPath, qualifying.map((r) => JSON.stringify(r)).join('\n'), 'utf8');
  writeCsv(qualifying, csvPath);

  const summary = {
    run_at: new Date().toISOString(),
    days_scanned: days.length,
    total_form_4_filings: allEntries.length,
    parsed_successfully: parsed.length,
    qualifying: qualifying.length,
    qualifying_pct: parsed.length > 0 ? Math.round((qualifying.length / parsed.length) * 100) : 0,
    min_transaction_usd: MIN_TRANSACTION_USD,
    sample_issuers: [...new Set(qualifying.map((r) => r.issuerName))].slice(0, 20),
    officer_title_breakdown: (() => {
      const tally: Record<string, number> = {};
      for (const r of qualifying) {
        const key = r.officerTitle || (r.isDirector ? 'Director' : (r.isTenPercentOwner ? '10% Owner' : 'Other'));
        tally[key] = (tally[key] ?? 0) + 1;
      }
      return Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 20));
    })(),
    outputs: { jsonl: jsonPath, csv: csvPath },
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\nDone.`);
  console.log(`  Total filings indexed: ${allEntries.length}`);
  console.log(`  Parsed successfully:   ${parsed.length}`);
  console.log(`  Qualifying (>= $${MIN_TRANSACTION_USD.toLocaleString()}): ${qualifying.length}`);
  console.log(`  JSONL: ${jsonPath}`);
  console.log(`  CSV:   ${csvPath}`);
  console.log(`  Summary: ${summaryPath}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
