#!/usr/bin/env node
/**
 * AnyMailFinder Email Finder — Processes CSV data sources to find emails
 *
 * Usage:
 *   node scripts/amf-email-finder.js [--source <name>] [--limit <n>] [--concurrency <n>] [--dry-run]
 *
 * Sources: formd_re, formd_leads, re_investor, fo_lp, sec_13dg, ria_websites, all
 * Default: processes all sources in priority order
 *
 * Found emails are saved to data/amf-results/ as CSVs ready for bulk upload.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ── Config ──────────────────────────────────────────────────────────────────
const AMF_API_KEY = process.env.ANYMAILFINDER_API_KEY;
const AMF_BASE_URL = process.env.ANYMAILFINDER_BASE_URL || 'https://api.anymailfinder.com/v5.1';
const BULK_UPLOAD_URL = `http://localhost:${process.env.PORT || 3001}/api/enrichment/bulk-upload`;
const DATA_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME,
  'OneDrive/Documents/Data/Granite Park/Fund - Marc/Marketing/Data/Cold Data - Email Campaign'
);
const RESULTS_DIR = path.join(__dirname, '..', 'data', 'amf-results');
const CACHE_FILE = path.join(RESULTS_DIR, 'amf-cache.json');
const PROGRESS_FILE = path.join(RESULTS_DIR, 'amf-progress.json');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const SOURCE = getArg('--source', 'all');
const LIMIT = parseInt(getArg('--limit', '0')) || 0;
const CONCURRENCY = parseInt(getArg('--concurrency', '5')) || 5;
const DRY_RUN = args.includes('--dry-run');
const AUTO_UPLOAD = args.includes('--auto-upload');

// ── Institutional Blocklist — skip big players, target family offices ────────
const INSTITUTIONAL_BLOCKLIST = [
  'blackstone', 'brookfield', 'invesco', 'fidelity', 'blackrock', 'pgim',
  'manulife', 'two sigma', 'tpg capital', 'kkr', 'carlyle', 'apollo',
  'ares management', 'oaktree', 'starwood', 'cerberus', 'fortress',
  'lone star', 'goldman sachs', 'morgan stanley', 'jp morgan', 'jpmorgan',
  'citigroup', 'citi ', 'bank of america', 'wells fargo', 'ubs ',
  'credit suisse', 'deutsche bank', 'barclays', 'hsbc', 'bnp paribas',
  'lazard', 'macquarie', 'nomura', 'pimco', 'vanguard', 'state street',
  'northern trust', 'bny mellon', 'prudential', 'metlife', 'aig ',
  'allianz', 'axa ', 'zurich', 'berkshire hathaway', 'warburg pincus',
  'bain capital', 'advent international', 'permira', 'cinven', 'cvc capital',
  'eqt partners', 'hellman friedman', 'silver lake', 'thoma bravo',
  'vista equity', 'general atlantic', 'insight partners', 'tiger global',
  'coatue', 'dragoneer', 'd1 capital', 'altimeter', 'durable capital',
  'blue owl', 'heitman', 'nuveen', 'principal', 't. rowe price',
  'wellington management', 'capital group', 'dimensional fund',
  'ameriprise', 'raymond james', 'edward jones', 'charles schwab',
  'td ameritrade', 'interactive brokers', 'robinhood',
];

function isInstitutional(companyName) {
  if (!companyName) return false;
  const lower = companyName.toLowerCase();
  return INSTITUTIONAL_BLOCKLIST.some(term => lower.includes(term));
}

function parseOfferingAmount(val) {
  if (!val) return 0;
  const n = parseFloat(val.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Target segments for FO/LP (skip institutional, 13F, pooled mega-funds)
const TARGET_SEGMENTS = [
  'family office', 'hnw individual', 'real estate fund', 'foundation',
  'real estate investor', 'alternative investment firm', 'business owner',
  'tech founder', 'angel investor', 'uhnw', 'investor',
];

function isTargetSegment(segment) {
  if (!segment) return false;
  const lower = segment.toLowerCase().trim();
  return TARGET_SEGMENTS.some(s => lower.includes(s));
}

// ── Data Source Definitions ─────────────────────────────────────────────────
// Priority order: FO/LP first (family offices), then FormD with $250K-$20M filter
const SOURCES = {
  fo_lp: {
    name: 'Master Lead List FO/LP (Family Offices & HNW)',
    file: path.join(DATA_DIR, 'Master_Lead_List_FO_LP.csv'),
    type: 'person',
    filter: (r) => {
      // Must not already have email
      if ((r.email || '').includes('@')) return false;
      // Must be a target segment (family office, HNW, etc.)
      if (!isTargetSegment(r.segment)) return false;
      // Must not be institutional
      if (isInstitutional(r.company)) return false;
      return true;
    },
    mapRow: (r) => ({
      first_name: r.first_name,
      last_name: r.last_name,
      company: r.company,
      domain: extractDomain(r.website),
      title: r.title,
      phone: r.phone,
      city: r.city,
      state: r.state,
      source: 'FO_LP_Master',
      segment: r.segment,
      grade: r.grade || 'A',
    }),
  },
  formd_re: {
    name: 'FormD RE Contacts ($250K-$20M)',
    file: path.join(DATA_DIR, 'SEC_RE_Investors', 'FormD_RE_Contacts.csv'),
    type: 'person',
    filter: (r) => {
      // Filter by offering size: $250K-$20M sweet spot
      const amt = parseOfferingAmount(r.total_offering);
      if (amt > 0 && (amt < 250000 || amt > 20000000)) return false;
      // Block institutional players
      if (isInstitutional(r.organization)) return false;
      return true;
    },
    mapRow: (r) => ({
      first_name: r.first_name,
      last_name: r.last_name,
      company: r.organization,
      domain: extractDomain(r.website),
      title: r.title,
      phone: r.org_phone,
      city: r.city || r.org_city,
      state: r.state || r.org_state,
      source: 'FormD_RE',
      grade: 'A+',
    }),
  },
  formd_leads: {
    name: 'SEC FormD Leads ($250K-$20M)',
    file: path.join(DATA_DIR, 'SEC_FormD_Leads.csv'),
    type: 'person',
    filter: (r) => {
      // Filter by offering size: $250K-$20M sweet spot
      const amt = parseOfferingAmount(r.offering_amount);
      if (amt > 0 && (amt < 250000 || amt > 20000000)) return false;
      // Block institutional players
      if (isInstitutional(r.company)) return false;
      return true;
    },
    mapRow: (r) => ({
      first_name: r.first_name,
      last_name: r.last_name,
      company: r.company,
      domain: extractDomain(r.website),
      title: r.title,
      phone: r.phone,
      city: r.city,
      state: r.state,
      source: 'SEC_FormD',
      grade: r.grade || 'A+',
    }),
  },
  re_investor: {
    name: 'RE Investor Master (filtered)',
    file: path.join(DATA_DIR, 'SEC_RE_Investors', 'RE_Investor_Master_List.csv'),
    type: 'person',
    filter: (r) => !isInstitutional(r.organization),
    mapRow: (r) => ({
      first_name: r.first_name,
      last_name: r.last_name,
      company: r.organization,
      domain: extractDomain(r.website),
      title: r.title,
      phone: r.phone,
      city: r.city,
      state: r.state,
      source: 'RE_Investor_Master',
      grade: r.grade || 'A+',
    }),
  },
  ria_websites: {
    name: 'RIA Firms With Websites (filtered)',
    file: path.join(DATA_DIR, 'SEC_IAPD', 'RIA_National_With_Websites.csv'),
    type: 'company',
    filter: (r) => !isInstitutional(r.firm_name),
    mapRow: (r) => ({
      first_name: '',
      last_name: '',
      company: r.firm_name,
      domain: extractDomain(r.website || r.all_websites),
      title: '',
      phone: r.phone,
      city: r.city,
      state: r.state,
      source: 'RIA_IAPD',
      grade: r.grade || 'A',
    }),
  },
};

// ── CSV Parser ──────────────────────────────────────────────────────────────
function parseCSV(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = parseCSVLine(headerLine).map(h => h.trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim(); });
    rows.push(obj);
  }
  return rows;
}

function parseCSVLine(line) {
  const vals = [];
  let inQuote = false;
  let cur = '';
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { vals.push(cur); cur = ''; }
    else { cur += ch; }
  }
  vals.push(cur);
  return vals;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function extractDomain(url) {
  if (!url) return '';
  let domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].trim();
  // Skip obvious non-domains
  if (!domain.includes('.') || domain.length < 4) return '';
  return domain.toLowerCase();
}

function buildCacheKey(record) {
  const name = (record.first_name + '_' + record.last_name).toLowerCase().replace(/\s+/g, '_');
  const domain = (record.domain || record.company || '').toLowerCase().replace(/\s+/g, '_');
  return `${name}:${domain}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── AMF API Calls ───────────────────────────────────────────────────────────
const amfClient = axios.create({
  baseURL: AMF_BASE_URL,
  headers: { 'Authorization': AMF_API_KEY, 'Content-Type': 'application/json' },
  timeout: 180000, // 180s — real-time SMTP checks
});

async function findPersonEmail(record) {
  const params = {};
  if (record.domain) params.domain = record.domain;
  else if (record.company) params.company_name = record.company;
  else return null;

  if (record.first_name && record.last_name) {
    params.first_name = record.first_name;
    params.last_name = record.last_name;
  } else {
    const full = (record.first_name + ' ' + record.last_name).trim();
    if (full) params.full_name = full;
    else return null; // No name = can't find person email
  }

  try {
    const { data } = await amfClient.post('/find-email/person', params);
    return {
      email: data.email || null,
      email_status: data.email_status || 'not_found',
      valid_email: data.valid_email || null,
    };
  } catch (err) {
    if (err.response?.status === 402) {
      console.error('\n[AMF] OUT OF CREDITS — stopping.');
      process.exit(1);
    }
    if (err.response?.status === 429) {
      console.warn('[AMF] Rate limited, waiting 10s...');
      await sleep(10000);
      return findPersonEmail(record); // retry once
    }
    console.error(`[AMF] Error: ${err.response?.data?.message || err.message}`);
    return null;
  }
}

async function findCompanyEmails(record) {
  const params = {};
  if (record.domain) params.domain = record.domain;
  else if (record.company) params.company_name = record.company;
  else return null;

  params.email_type = 'personal'; // We want decision-maker emails, not info@

  try {
    const { data } = await amfClient.post('/find-email/company', params);
    return {
      emails: data.emails || [],
      valid_emails: data.valid_emails || [],
      email_status: data.email_status || 'not_found',
    };
  } catch (err) {
    if (err.response?.status === 402) {
      console.error('\n[AMF] OUT OF CREDITS — stopping.');
      process.exit(1);
    }
    if (err.response?.status === 429) {
      console.warn('[AMF] Rate limited, waiting 10s...');
      await sleep(10000);
      return findCompanyEmails(record);
    }
    console.error(`[AMF] Error: ${err.response?.data?.message || err.message}`);
    return null;
  }
}

// ── Cache Management ────────────────────────────────────────────────────────
let cache = {};
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      console.log(`[Cache] Loaded ${Object.keys(cache).length} cached results`);
    }
  } catch { cache = {}; }
}

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// ── Progress Management ─────────────────────────────────────────────────────
let progress = {};
function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    }
  } catch { progress = {}; }
}

function saveProgress() {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ── Concurrent Processing ───────────────────────────────────────────────────
async function processWithConcurrency(items, fn, concurrency) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Main Processing ─────────────────────────────────────────────────────────
async function processSource(sourceKey, sourceDef) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${sourceDef.name}`);
  console.log(`File: ${sourceDef.file}`);
  console.log(`Type: ${sourceDef.type} lookup`);
  console.log('='.repeat(60));

  if (!fs.existsSync(sourceDef.file)) {
    console.error(`  File not found: ${sourceDef.file}`);
    return { found: 0, notFound: 0, cached: 0, errors: 0 };
  }

  // Parse CSV
  let rows = parseCSV(sourceDef.file);
  console.log(`  Total rows: ${rows.length}`);

  // Apply source-specific filter
  if (sourceDef.filter) {
    rows = rows.filter(sourceDef.filter);
    console.log(`  After filter: ${rows.length}`);
  }

  // Map to standard format
  let records = rows.map(sourceDef.mapRow);

  // Filter out records without name (for person lookups) or without company/domain
  if (sourceDef.type === 'person') {
    records = records.filter(r => {
      const hasName = (r.first_name || '').trim() && (r.first_name || '').toLowerCase() !== '(none)';
      const hasCompany = (r.domain || r.company || '').trim();
      return hasName && hasCompany;
    });
    console.log(`  With name + company/domain: ${records.length}`);
  } else {
    records = records.filter(r => (r.domain || r.company || '').trim());
    console.log(`  With company/domain: ${records.length}`);
  }

  // Deduplicate by cache key
  const seen = new Set();
  records = records.filter(r => {
    const key = buildCacheKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`  After dedup: ${records.length}`);

  // Resume from progress
  const startIdx = progress[sourceKey] || 0;
  if (startIdx > 0) {
    console.log(`  Resuming from index ${startIdx}`);
  }
  const toProcess = records.slice(startIdx);

  // Apply limit
  const limited = LIMIT > 0 ? toProcess.slice(0, LIMIT) : toProcess;
  console.log(`  To process: ${limited.length}${LIMIT ? ` (limited to ${LIMIT})` : ''}`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would process these records. Exiting.');
    return { found: 0, notFound: 0, cached: 0, errors: 0 };
  }

  // Process records
  const stats = { found: 0, notFound: 0, cached: 0, errors: 0, apiCalls: 0 };
  const foundEmails = [];
  let lastSave = Date.now();

  await processWithConcurrency(limited, async (record, idx) => {
    const cacheKey = buildCacheKey(record);
    const globalIdx = startIdx + idx;

    // Check cache first
    if (cache[cacheKey]) {
      stats.cached++;
      const cachedResult = cache[cacheKey];
      if (cachedResult.email) {
        stats.found++;
        foundEmails.push({ ...record, email: cachedResult.email, email_status: cachedResult.email_status });
      } else {
        stats.notFound++;
      }
      return;
    }

    // Call AMF API
    stats.apiCalls++;
    let result;
    if (sourceDef.type === 'person') {
      result = await findPersonEmail(record);
    } else {
      result = await findCompanyEmails(record);
    }

    if (!result) {
      stats.errors++;
      return;
    }

    // Handle person result
    if (sourceDef.type === 'person') {
      cache[cacheKey] = result;
      if (result.email && result.email_status !== 'not_found') {
        stats.found++;
        foundEmails.push({
          ...record,
          email: result.valid_email || result.email,
          email_status: result.email_status,
        });
        process.stdout.write(`\r  ✓ Found: ${record.first_name} ${record.last_name} → ${result.valid_email || result.email}`);
      } else {
        stats.notFound++;
      }
    }

    // Handle company result
    if (sourceDef.type === 'company') {
      cache[cacheKey] = result;
      const emails = result.valid_emails?.length ? result.valid_emails : result.emails || [];
      if (emails.length > 0) {
        stats.found += emails.length;
        for (const email of emails) {
          foundEmails.push({ ...record, email, email_status: 'valid' });
        }
        process.stdout.write(`\r  ✓ Found ${emails.length} emails at ${record.domain || record.company}`);
      } else {
        stats.notFound++;
      }
    }

    // Save progress periodically (every 30s)
    if (Date.now() - lastSave > 30000) {
      progress[sourceKey] = globalIdx + 1;
      saveProgress();
      saveCache();
      lastSave = Date.now();
    }

    // Progress log every 50 records
    if ((idx + 1) % 50 === 0) {
      const pct = ((idx + 1) / limited.length * 100).toFixed(1);
      console.log(`\n  Progress: ${idx + 1}/${limited.length} (${pct}%) | Found: ${stats.found} | API calls: ${stats.apiCalls}`);
    }
  }, CONCURRENCY);

  // Final save
  progress[sourceKey] = startIdx + limited.length;
  saveProgress();
  saveCache();

  // Write found emails to CSV
  if (foundEmails.length > 0) {
    const outFile = path.join(RESULTS_DIR, `amf-found-${sourceKey}-${Date.now()}.csv`);
    const csvHeader = 'first_name,last_name,email,company,title,phone,city,state,source,grade,email_status';
    const csvRows = foundEmails.map(r =>
      [r.first_name, r.last_name, r.email, csvEscape(r.company), csvEscape(r.title), r.phone, r.city, r.state, r.source, r.grade, r.email_status].join(',')
    );
    fs.writeFileSync(outFile, [csvHeader, ...csvRows].join('\n'));
    console.log(`\n  Saved ${foundEmails.length} found emails to: ${outFile}`);

    // Auto-upload to enrichment pipeline if requested
    if (AUTO_UPLOAD) {
      await uploadToPipeline(foundEmails, sourceKey);
    }
  }

  console.log(`\n  Results: found=${stats.found}, not_found=${stats.notFound}, cached=${stats.cached}, errors=${stats.errors}, api_calls=${stats.apiCalls}`);
  return stats;
}

function csvEscape(val) {
  if (!val) return '';
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

// ── Bulk Upload to Server ───────────────────────────────────────────────────
async function uploadToPipeline(records, sourceKey) {
  try {
    const leads = records.map(r => ({
      email: r.email,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      phone: r.phone || null,
    }));

    const resp = await axios.post(BULK_UPLOAD_URL, {
      company_id: 1,
      file_name: `amf-${sourceKey}.csv`,
      leads,
      auto_process: true,
    }, { timeout: 60000 });

    console.log(`  Uploaded to pipeline: ${resp.data.inserted} inserted, ${resp.data.duplicates} duplicates`);
  } catch (err) {
    console.error(`  Upload failed: ${err.message}`);
    console.log('  Results saved to CSV — upload manually later');
  }
}

// ── Entry Point ─────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  AnyMailFinder Email Finder                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  API Key: ${AMF_API_KEY ? AMF_API_KEY.slice(0, 8) + '...' : 'NOT SET'}`);
  console.log(`  Source: ${SOURCE}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Limit: ${LIMIT || 'none'}`);
  console.log(`  Dry run: ${DRY_RUN}`);
  console.log(`  Auto upload: ${AUTO_UPLOAD}`);

  if (!AMF_API_KEY) {
    console.error('\nERROR: ANYMAILFINDER_API_KEY not set in .env');
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  loadCache();
  loadProgress();

  // Determine which sources to process — FO/LP first, then FormD with filters, then rest
  const sourceKeys = SOURCE === 'all'
    ? ['fo_lp', 'formd_re', 'formd_leads', 're_investor', 'ria_websites']
    : [SOURCE];

  const totalStats = { found: 0, notFound: 0, cached: 0, errors: 0 };

  for (const key of sourceKeys) {
    if (!SOURCES[key]) {
      console.error(`Unknown source: ${key}`);
      console.log(`Available: ${Object.keys(SOURCES).join(', ')}`);
      process.exit(1);
    }
    const stats = await processSource(key, SOURCES[key]);
    totalStats.found += stats.found;
    totalStats.notFound += stats.notFound;
    totalStats.cached += stats.cached;
    totalStats.errors += stats.errors;
  }

  console.log('\n' + '='.repeat(60));
  console.log('FINAL TOTALS');
  console.log('='.repeat(60));
  console.log(`  Emails found: ${totalStats.found}`);
  console.log(`  Not found: ${totalStats.notFound}`);
  console.log(`  Cached: ${totalStats.cached}`);
  console.log(`  Errors: ${totalStats.errors}`);
  console.log(`\nResults saved to: ${RESULTS_DIR}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  saveCache();
  saveProgress();
  process.exit(1);
});
