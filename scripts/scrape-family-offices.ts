/**
 * Family Office Decision Maker Scraper
 *
 * Scrapes LinkedIn Sales Navigator for family office investment decision makers
 * across all 50 US states. Runs state-by-state to stay under the 2,500 result
 * cap per search, deduplicates, and outputs a combined CSV.
 *
 * Usage:
 *   npx tsx scripts/scrape-family-offices.ts [options]
 *
 * Options:
 *   --dry-run           Show search URLs without running scrapes
 *   --state <name>      Run a single state only (e.g., --state "New York")
 *   --resume            Resume from last saved progress
 *   --deep              Enable deep scrape (visit each profile page)
 *   --delay <seconds>   Delay between states in seconds (default: 60)
 *   --count <n>         Max results per search (default: 2500)
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

// ── Config ──────────────────────────────────────────────────

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const LINKEDIN_COOKIES_JSON = process.env.LINKEDIN_COOKIES_JSON; // Full cookies array exported from Cookie-Editor
// Apify API uses ~ in URL paths for actor IDs (not /)
const ACTOR_ID = 'curious_coder~linkedin-sales-navigator-search-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';
const USER_AGENT = process.env.LINKEDIN_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'family-office-scrape');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'progress.json');
const COMBINED_CSV = path.join(OUTPUT_DIR, 'family-office-leads-combined.csv');
const COMBINED_JSON = path.join(OUTPUT_DIR, 'family-office-leads-combined.json');

// ── LinkedIn Geo IDs for all 50 US States ───────────────────

const STATE_GEO_IDS: Record<string, string> = {
  'Alabama': '102240587',
  'Alaska': '100290991',
  'Arizona': '106032500',
  'Arkansas': '102790221',
  'California': '102095887',
  'Colorado': '105763813',
  'Connecticut': '106914527',
  'Delaware': '105375497',
  'Florida': '101318387',
  'Georgia': '103950076',
  'Hawaii': '105051999',
  'Idaho': '102560739',
  'Illinois': '101949407',
  'Indiana': '103336534',
  'Iowa': '103078544',
  'Kansas': '104403803',
  'Kentucky': '106470801',
  'Louisiana': '101822552',
  'Maine': '101102875',
  'Maryland': '100809221',
  'Massachusetts': '101098412',
  'Michigan': '103051080',
  'Minnesota': '103411167',
  'Mississippi': '106899551',
  'Missouri': '101486475',
  'Montana': '101758306',
  'Nebraska': '101197782',
  'Nevada': '101690912',
  'New Hampshire': '103532695',
  'New Jersey': '101651951',
  'New Mexico': '105048220',
  'New York': '105080838',
  'North Carolina': '103255397',
  'North Dakota': '104611396',
  'Ohio': '106981407',
  'Oklahoma': '101343299',
  'Oregon': '101685541',
  'Pennsylvania': '102986501',
  'Rhode Island': '104877241',
  'South Carolina': '102687171',
  'South Dakota': '100115110',
  'Tennessee': '104629187',
  'Texas': '102748797',
  'Utah': '104102239',
  'Vermont': '104453637',
  'Virginia': '101630962',
  'Washington': '103977389',
  'West Virginia': '106420769',
  'Wisconsin': '104454774',
  'Wyoming': '100658004',
};

// ── Search URL Builder ──────────────────────────────────────

function buildSalesNavSearchUrl(stateGeoId: string, stateName: string): string {
  // Sales Navigator Lead Search URL with filters:
  // - Keywords: "family office" OR "family investment" OR "private investment office"
  // - Seniority: CXO, VP, Director, Owner, Partner
  // - Geography: specific state
  const query = `(filters:List(` +
    `(type:SENIORITY_LEVEL,values:List(` +
      `(id:8,text:CXO,selectionType:INCLUDED),` +
      `(id:7,text:VP,selectionType:INCLUDED),` +
      `(id:6,text:Director,selectionType:INCLUDED),` +
      `(id:10,text:Owner,selectionType:INCLUDED),` +
      `(id:9,text:Partner,selectionType:INCLUDED)` +
    `)),` +
    `(type:REGION,values:List(` +
      `(id:${stateGeoId},text:${encodeURIComponent(stateName)},selectionType:INCLUDED)` +
    `))` +
  `),keywords:${encodeURIComponent('"family office" OR "family investment office" OR "private investment office" OR "single family office" OR "multi family office"')})`;

  return `https://www.linkedin.com/sales/search/people?query=${query}`;
}

// ── Apify Client ────────────────────────────────────────────

const apify = axios.create({
  baseURL: APIFY_BASE,
  headers: {
    Authorization: `Bearer ${APIFY_API_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 600_000,
});

async function startActorRun(searchUrl: string, opts: { count?: number; deepScrape?: boolean }): Promise<string> {
  let cookies: any[];
  try {
    cookies = JSON.parse(LINKEDIN_COOKIES_JSON || '[]');
  } catch {
    throw new Error('LINKEDIN_COOKIES_JSON is not valid JSON. Export cookies from Cookie-Editor extension.');
  }
  if (!cookies.length) {
    throw new Error('LINKEDIN_COOKIES_JSON is empty. Export cookies from Cookie-Editor extension.');
  }

  const input: any = {
    cookie: cookies,
    searchUrl,
    userAgent: USER_AGENT,
    deepScrape: opts.deepScrape ?? false,
    stopOnRateLimit: true,
    minDelay: 10,
    maxDelay: 45,
  };
  if (opts.count) input.count = opts.count;

  const { data } = await apify.post(`/acts/${ACTOR_ID}/runs`, input);
  return data.data.id;
}

async function waitForRun(runId: string, timeoutMs = 600_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await apify.get(`/actor-runs/${runId}`);
    const status = data.data.status;
    if (status === 'SUCCEEDED') return data.data.defaultDatasetId;
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Run ${runId} ended with status: ${status}`);
    }
    // Poll every 15 seconds
    await new Promise(r => setTimeout(r, 15_000));
  }
  throw new Error(`Run ${runId} timed out after ${timeoutMs / 1000}s`);
}

async function getDatasetItems(datasetId: string): Promise<any[]> {
  const items: any[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data } = await apify.get(`/datasets/${datasetId}/items`, {
      params: { limit, offset, clean: 1 },
    });
    const batch = Array.isArray(data) ? data : [];
    items.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return items;
}

// ── Lead Formatting ─────────────────────────────────────────

interface Lead {
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  linkedInUrl: string;
  location: string;
  state: string;
}

function formatLead(raw: any, state: string): Lead {
  return {
    firstName: raw.firstName || raw.first_name || '',
    lastName: raw.lastName || raw.last_name || '',
    company: raw.companyName || raw.company || raw.currentCompany || '',
    title: raw.jobTitle || raw.title || raw.headline || '',
    linkedInUrl: raw.publicUrl || raw.profileUrl || raw.salesNavigatorUrl || raw.url || raw.linkedInUrl || '',
    location: raw.location || raw.geo || '',
    state,
  };
}

// ── Progress Tracking ───────────────────────────────────────

interface Progress {
  completedStates: string[];
  failedStates: string[];
  totalLeads: number;
  startedAt: string;
  lastUpdated: string;
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return {
    completedStates: [],
    failedStates: [],
    totalLeads: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveProgress(progress: Progress): void {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ── Deduplication ───────────────────────────────────────────

function deduplicateLeads(leads: Lead[]): Lead[] {
  const seen = new Set<string>();
  return leads.filter(lead => {
    // Dedupe by LinkedIn URL first, then by name+company
    const urlKey = lead.linkedInUrl ? lead.linkedInUrl.toLowerCase().replace(/\/$/, '') : '';
    const nameKey = `${lead.firstName.toLowerCase()}-${lead.lastName.toLowerCase()}-${lead.company.toLowerCase()}`;
    const key = urlKey || nameKey;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    // Also add the other key to catch cross-matches
    if (urlKey && nameKey) {
      seen.add(nameKey);
    }
    return true;
  });
}

// ── CSV Export ───────────────────────────────────────────────

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function leadsToCsv(leads: Lead[]): string {
  const header = 'first_name,last_name,company,title,linkedin_url,location,state';
  const rows = leads.map(l =>
    [l.firstName, l.lastName, l.company, l.title, l.linkedInUrl, l.location, l.state]
      .map(escapeCsvField)
      .join(',')
  );
  return [header, ...rows].join('\n');
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const resume = args.includes('--resume');
  const deepScrape = args.includes('--deep');
  const singleStateIdx = args.indexOf('--state');
  const singleState = singleStateIdx >= 0 ? args[singleStateIdx + 1] : null;
  const delayIdx = args.indexOf('--delay');
  const delaySec = delayIdx >= 0 ? parseInt(args[delayIdx + 1]) : 180;
  const countIdx = args.indexOf('--count');
  const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) : 2500;

  // Validate
  if (!APIFY_API_KEY) {
    console.error('ERROR: APIFY_API_KEY not set in .env');
    process.exit(1);
  }
  if (!LINKEDIN_COOKIES_JSON && !dryRun) {
    console.error('ERROR: LINKEDIN_COOKIES_JSON not set in .env');
    console.error('  1. Install Cookie-Editor extension in Chrome');
    console.error('  2. Log into LinkedIn Sales Navigator');
    console.error('  3. Click Cookie-Editor → Export → JSON');
    console.error('  4. Set LINKEDIN_COOKIES_JSON in .env (paste the full JSON array)');
    process.exit(1);
  }

  // Ensure output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Determine which states to process
  let statesToProcess: string[];
  if (singleState) {
    if (!STATE_GEO_IDS[singleState]) {
      console.error(`ERROR: Unknown state "${singleState}". Valid states: ${Object.keys(STATE_GEO_IDS).join(', ')}`);
      process.exit(1);
    }
    statesToProcess = [singleState];
  } else {
    statesToProcess = Object.keys(STATE_GEO_IDS);
  }

  // Load progress if resuming
  const progress = resume ? loadProgress() : {
    completedStates: [],
    failedStates: [],
    totalLeads: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };

  if (resume && progress.completedStates.length > 0) {
    console.log(`\nResuming from previous run. ${progress.completedStates.length} states already completed.`);
    statesToProcess = statesToProcess.filter(s => !progress.completedStates.includes(s));
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   Family Office Decision Maker Scraper                  ║');
  console.log('║   Granite Park Capital — Fund Lead Generation           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  States to scrape:  ${statesToProcess.length}`);
  console.log(`  Deep scrape:       ${deepScrape}`);
  console.log(`  Max results:       ${count}`);
  console.log(`  Delay between:     ${delaySec}s`);
  console.log(`  Output directory:  ${OUTPUT_DIR}`);
  console.log(`  Dry run:           ${dryRun}\n`);

  if (dryRun) {
    console.log('── Search URLs (dry run) ──────────────────────\n');
    for (const state of statesToProcess) {
      const url = buildSalesNavSearchUrl(STATE_GEO_IDS[state], state);
      console.log(`${state}:`);
      console.log(`  ${url}\n`);
    }
    console.log(`\nTotal searches: ${statesToProcess.length}`);
    return;
  }

  // Collect all leads across states
  const allLeads: Lead[] = [];

  // Load existing leads from already-completed states
  if (resume) {
    for (const completedState of progress.completedStates) {
      const stateFile = path.join(OUTPUT_DIR, `${completedState.toLowerCase().replace(/\s+/g, '-')}.json`);
      if (fs.existsSync(stateFile)) {
        const stateLeads: Lead[] = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        allLeads.push(...stateLeads);
      }
    }
    console.log(`Loaded ${allLeads.length} leads from ${progress.completedStates.length} completed states.\n`);
  }

  // Process each state
  for (let i = 0; i < statesToProcess.length; i++) {
    const state = statesToProcess[i];
    const geoId = STATE_GEO_IDS[state];
    const searchUrl = buildSalesNavSearchUrl(geoId, state);
    const stateSlug = state.toLowerCase().replace(/\s+/g, '-');

    console.log(`\n── [${i + 1}/${statesToProcess.length}] ${state} ──────────────────────────`);
    console.log(`  Geo ID: ${geoId}`);

    try {
      // Start the Apify actor run
      console.log('  Starting Apify actor run...');
      const runId = await startActorRun(searchUrl, { count, deepScrape });
      console.log(`  Run ID: ${runId}`);

      // Wait for completion
      console.log('  Waiting for completion...');
      const datasetId = await waitForRun(runId);
      console.log(`  Dataset ID: ${datasetId}`);

      // Fetch results
      console.log('  Fetching results...');
      const rawResults = await getDatasetItems(datasetId);
      console.log(`  Raw results: ${rawResults.length}`);

      // Format leads
      const stateLeads = rawResults
        .map(r => formatLead(r, state))
        .filter(l => l.firstName && l.lastName);
      console.log(`  Valid leads: ${stateLeads.length}`);

      // Save state-specific results
      const stateJsonPath = path.join(OUTPUT_DIR, `${stateSlug}.json`);
      fs.writeFileSync(stateJsonPath, JSON.stringify(stateLeads, null, 2));
      console.log(`  Saved to: ${stateSlug}.json`);

      allLeads.push(...stateLeads);

      // Update progress
      progress.completedStates.push(state);
      progress.totalLeads = allLeads.length;
      saveProgress(progress);

    } catch (err: any) {
      console.error(`  ERROR: ${err.message}`);
      progress.failedStates.push(state);
      saveProgress(progress);
    }

    // Delay between states (skip after last state)
    if (i < statesToProcess.length - 1) {
      console.log(`  Waiting ${delaySec}s before next state...`);
      await new Promise(r => setTimeout(r, delaySec * 1000));
    }
  }

  // ── Final: Deduplicate & Export ────────────────────────────

  console.log('\n\n══════════════════════════════════════════════════');
  console.log('  FINAL RESULTS');
  console.log('══════════════════════════════════════════════════\n');

  console.log(`  Total raw leads:     ${allLeads.length}`);

  const dedupedLeads = deduplicateLeads(allLeads);
  console.log(`  After dedup:         ${dedupedLeads.length}`);
  console.log(`  Duplicates removed:  ${allLeads.length - dedupedLeads.length}`);

  // Save combined JSON
  fs.writeFileSync(COMBINED_JSON, JSON.stringify(dedupedLeads, null, 2));
  console.log(`\n  Combined JSON: ${COMBINED_JSON}`);

  // Save combined CSV
  fs.writeFileSync(COMBINED_CSV, leadsToCsv(dedupedLeads));
  console.log(`  Combined CSV:  ${COMBINED_CSV}`);

  // State breakdown
  console.log('\n── Leads by State ─────────────────────────────\n');
  const byState: Record<string, number> = {};
  for (const lead of dedupedLeads) {
    byState[lead.state] = (byState[lead.state] || 0) + 1;
  }
  const sorted = Object.entries(byState).sort((a, b) => b[1] - a[1]);
  for (const [state, count] of sorted) {
    console.log(`  ${state.padEnd(20)} ${count}`);
  }

  if (progress.failedStates.length > 0) {
    console.log('\n── Failed States (retry with --resume) ────────\n');
    for (const state of progress.failedStates) {
      console.log(`  ${state}`);
    }
  }

  // Final progress
  progress.totalLeads = dedupedLeads.length;
  saveProgress(progress);

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Done! ${dedupedLeads.length} unique leads ready for enrichment.`);
  console.log('══════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
