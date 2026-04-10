/**
 * Family Office Metro Scraper — Captures leads from capped states by
 * breaking them into metro-area sub-searches.
 *
 * Also retries any failed states from the main run.
 *
 * Usage:
 *   npx ts-node scripts/scrape-family-offices-metros.ts [--dry-run]
 *
 * Results are saved alongside the main scrape in data/family-office-scrape/
 * and automatically merged + deduplicated into the combined CSV/JSON.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

// ── Config ──────────────────────────────────────────────────

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = path.join(
  process.env.USERPROFILE || 'C:\\Users\\colby',
  '.linkedin-scraper-profile'
);
const CDP_PORT = 9224;

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'family-office-scrape');
const COMBINED_CSV = path.join(OUTPUT_DIR, 'family-office-leads-combined.csv');
const COMBINED_JSON = path.join(OUTPUT_DIR, 'family-office-leads-combined.json');

const RESULTS_PER_PAGE = 25;
const MAX_PAGES = 100;

// ── Metro Geo IDs ───────────────────────────────────────────
// LinkedIn uses these for metro/city-level targeting in Sales Navigator.

interface MetroRegion {
  name: string;
  geoId: string;
  parentState: string;
}

// California metros — splitting ~4,200 results across major regions
const CALIFORNIA_METROS: MetroRegion[] = [
  { name: 'Greater Los Angeles Area',    geoId: '90000049', parentState: 'California' },
  { name: 'San Francisco Bay Area',      geoId: '90000084', parentState: 'California' },
  { name: 'San Diego Metropolitan Area', geoId: '90000078', parentState: 'California' },
  { name: 'Sacramento Metropolitan Area',geoId: '90000077', parentState: 'California' },
  { name: 'San Jose Metropolitan Area',  geoId: '90000081', parentState: 'California' },
  { name: 'Orange County, California',   geoId: '90000068', parentState: 'California' },
  { name: 'Irvine, California',          geoId: '102393730', parentState: 'California' },
  { name: 'Santa Barbara, California',   geoId: '104170498', parentState: 'California' },
  { name: 'Palm Springs, California',    geoId: '106392384', parentState: 'California' },
  { name: 'Fresno, California',          geoId: '102500703', parentState: 'California' },
  { name: 'Bakersfield, California',     geoId: '104847483', parentState: 'California' },
];

// New York metros — retry with metro segmentation for reliability
const NEW_YORK_METROS: MetroRegion[] = [
  { name: 'New York City Metropolitan Area', geoId: '90000070', parentState: 'New York' },
  { name: 'Manhattan, New York',          geoId: '105613275', parentState: 'New York' },
  { name: 'Long Island, New York',        geoId: '106077598', parentState: 'New York' },
  { name: 'Westchester County, New York', geoId: '103458498', parentState: 'New York' },
  { name: 'Albany, New York',             geoId: '103078643', parentState: 'New York' },
  { name: 'Buffalo, New York',            geoId: '104369393', parentState: 'New York' },
  { name: 'Syracuse, New York',           geoId: '105773051', parentState: 'New York' },
  { name: 'Rochester, New York',          geoId: '103121490', parentState: 'New York' },
];

// North Carolina metros — retry with metro segmentation
const NORTH_CAROLINA_METROS: MetroRegion[] = [
  { name: 'Charlotte Metropolitan Area',  geoId: '90000014', parentState: 'North Carolina' },
  { name: 'Raleigh-Durham Area',          geoId: '90000076', parentState: 'North Carolina' },
  { name: 'Greensboro, North Carolina',   geoId: '104632793', parentState: 'North Carolina' },
  { name: 'Wilmington, North Carolina',   geoId: '101606657', parentState: 'North Carolina' },
  { name: 'Asheville, North Carolina',    geoId: '101850794', parentState: 'North Carolina' },
];

// Also retry the failed states as whole-state searches (in case it was just a transient error)
const FAILED_STATE_RETRIES: Record<string, string> = {
  'New York': '105080838',
  'North Carolina': '103255397',
};

// ── Lead Interface ──────────────────────────────────────────

interface Lead {
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  linkedInUrl: string;
  location: string;
  state: string;
}

// ── Search URL Builder ──────────────────────────────────────

function buildSearchUrl(geoId: string, geoName: string, page: number = 1): string {
  const query = `(filters:List(` +
    `(type:SENIORITY_LEVEL,values:List(` +
      `(id:8,text:CXO,selectionType:INCLUDED),` +
      `(id:7,text:VP,selectionType:INCLUDED),` +
      `(id:6,text:Director,selectionType:INCLUDED),` +
      `(id:10,text:Owner,selectionType:INCLUDED),` +
      `(id:9,text:Partner,selectionType:INCLUDED)` +
    `)),` +
    `(type:REGION,values:List(` +
      `(id:${geoId},text:${encodeURIComponent(geoName)},selectionType:INCLUDED)` +
    `))` +
  `),keywords:${encodeURIComponent('"family office" OR "family investment office" OR "private investment office" OR "single family office" OR "multi family office"')})`;

  return `https://www.linkedin.com/sales/search/people?page=${page}&query=${query}`;
}

// ── Browser Management ──────────────────────────────────────

async function launchBrowser(headless: boolean): Promise<Browser> {
  try {
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}` });
    if (browser.connected) {
      console.log('  Reconnected to existing Chrome instance');
      return browser;
    }
  } catch {
    // Not running, launch fresh
  }

  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }

  console.log('  Launching Chrome with persistent profile...');
  console.log(`  Profile: ${PROFILE_DIR}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    userDataDir: PROFILE_DIR,
    headless,
    args: [
      `--remote-debugging-port=${CDP_PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1400,900',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: null,
  });

  return browser;
}

// ── Wait Helpers ────────────────────────────────────────────

function randomDelay(minSec: number, maxSec: number): Promise<void> {
  const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  return new Promise(r => setTimeout(r, ms));
}

function cleanName(raw: string): string {
  return raw
    .replace(/\s*is reachable\s*/gi, '')
    .replace(/\s*•\s*\d+(st|nd|rd|th)?\s*/gi, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim();
}

// ── Voyager API Interceptor ─────────────────────────────────

interface VoyagerInterceptor {
  getLeads(): Lead[];
  getTotalCount(): number | null;
  clear(): void;
  destroy(): void;
}

async function setupVoyagerInterceptor(page: Page, state: string): Promise<VoyagerInterceptor> {
  const leads: Lead[] = [];
  let totalCount: number | null = null;
  const client = await page.createCDPSession();

  await client.send('Network.enable');

  const responseBodyMap = new Map<string, string>();

  client.on('Network.responseReceived', (params: any) => {
    const url = params.response?.url || '';
    if (url.includes('/sales-api/') && (url.includes('salesApiPeopleSearch') || url.includes('salesApiLeadSearch'))) {
      responseBodyMap.set(params.requestId, url);
    }
  });

  client.on('Network.loadingFinished', async (params: any) => {
    const url = responseBodyMap.get(params.requestId);
    if (!url) return;
    responseBodyMap.delete(params.requestId);

    try {
      const resp = await client.send('Network.getResponseBody', { requestId: params.requestId });
      const body = resp.body;
      if (!body) return;

      const data = JSON.parse(body);

      // Extract total count
      if (data.paging?.total != null && totalCount === null) {
        totalCount = data.paging.total;
      }
      if (data.metadata?.totalResultCount != null && totalCount === null) {
        totalCount = data.metadata.totalResultCount;
      }

      // Extract leads from various response shapes
      const elements = data.elements || data.results || [];
      for (const el of elements) {
        const profile = el.currentPositions?.[0] || {};
        const entity = el.entityUrn || el.objectUrn || '';
        const lead: Partial<Lead> = {};

        // Name
        lead.firstName = el.firstName || el.fullName?.split(' ')[0] || '';
        lead.lastName = el.lastName || el.fullName?.split(' ').slice(1).join(' ') || '';

        // Company & title from current position
        lead.company = profile.companyName || el.currentCompany || '';
        lead.title = profile.title || el.title || '';

        // LinkedIn URL
        if (entity) {
          const match = entity.match(/\(([^,]+)/);
          if (match) {
            lead.linkedInUrl = `https://www.linkedin.com/sales/lead/${match[1]}`;
          }
        }
        if (!lead.linkedInUrl && el.publicIdentifier) {
          lead.linkedInUrl = `https://www.linkedin.com/in/${el.publicIdentifier}`;
        }

        // Location
        lead.location = el.geoRegion || el.location || el.geography?.city || '';
        lead.state = state;

        if (lead.firstName || lead.lastName) {
          leads.push(lead as Lead);
        }
      }
    } catch {
      // Ignore parse errors
    }
  });

  return {
    getLeads: () => [...leads],
    getTotalCount: () => totalCount,
    clear: () => {
      leads.length = 0;
      totalCount = null;
    },
    destroy: async () => {
      try { await client.detach(); } catch { /* expected */ }
    },
  };
}

// ── Scrape a Region ─────────────────────────────────────────

async function scrapeRegion(
  page: Page,
  geoId: string,
  geoName: string,
  stateName: string,
  pageDelaySec: number,
): Promise<Lead[]> {
  const interceptor = await setupVoyagerInterceptor(page, stateName);
  const allLeads: Lead[] = [];
  let totalResults = 0;
  let consecutiveEmpty = 0;

  // Load first page
  const firstUrl = buildSearchUrl(geoId, geoName, 1);
  await page.goto(firstUrl, { waitUntil: 'networkidle2', timeout: 45000 });
  await randomDelay(4, 7);

  // Check login
  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) {
    console.log('  ⚠ Not logged in! Please log in manually...');
    await new Promise(r => setTimeout(r, 60000));
    await page.goto(firstUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await randomDelay(4, 7);
  }

  await randomDelay(3, 5);

  // Get total from interceptor
  const interceptTotal = interceptor.getTotalCount();
  if (interceptTotal != null) {
    totalResults = interceptTotal;
  }

  const totalPages = Math.min(Math.ceil(totalResults / RESULTS_PER_PAGE), MAX_PAGES) || 1;
  console.log(`  Total results: ~${totalResults} (${totalPages} pages)`);

  // Collect first page leads
  const firstPageLeads = interceptor.getLeads().map(v => ({
    ...v,
    lastName: cleanName(v.lastName),
    firstName: cleanName(v.firstName),
    state: stateName,
  }));
  interceptor.clear();
  allLeads.push(...firstPageLeads);
  process.stdout.write(`  Page 1/${totalPages}: +${firstPageLeads.length} new (${allLeads.length} total)`);

  if (totalResults <= RESULTS_PER_PAGE) {
    console.log('');
    interceptor.destroy();
    return allLeads;
  }

  // Paginate
  for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
    const pageUrl = buildSearchUrl(geoId, geoName, pageNum);
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await randomDelay(3, 5);

    const voyagerLeads = interceptor.getLeads().map(v => ({
      ...v,
      lastName: cleanName(v.lastName),
      firstName: cleanName(v.firstName),
      state: stateName,
    }));
    interceptor.clear();

    if (voyagerLeads.length === 0) {
      consecutiveEmpty++;
      process.stdout.write(`  Page ${pageNum}/${totalPages}: empty`);
      if (consecutiveEmpty >= 3) {
        console.log('');
        console.log(`  3 consecutive empty pages — stopping pagination`);
        break;
      }
    } else {
      consecutiveEmpty = 0;
      allLeads.push(...voyagerLeads);
      process.stdout.write(`  Page ${pageNum}/${totalPages}: +${voyagerLeads.length} new (${allLeads.length} total)`);
    }

    if (allLeads.length >= totalResults) {
      console.log('');
      console.log(`  Reached total result count (${totalResults})`);
      break;
    }

    await randomDelay(pageDelaySec * 0.7, pageDelaySec * 1.3);
  }

  console.log('');
  console.log(`  Total unique leads: ${allLeads.length}`);
  interceptor.destroy();
  return allLeads;
}

// ── Deduplication ───────────────────────────────────────────

function deduplicateLeads(leads: Lead[]): Lead[] {
  const seen = new Set<string>();
  return leads.filter(lead => {
    const urlKey = lead.linkedInUrl ? lead.linkedInUrl.toLowerCase().replace(/\/$/, '') : '';
    const nameKey = `${lead.firstName.toLowerCase()}-${lead.lastName.toLowerCase()}-${lead.company.toLowerCase()}`;
    const key = urlKey || nameKey;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    if (urlKey && nameKey) seen.add(nameKey);
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
  const pageDelaySec = 8;
  const delaySec = 120;

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Build the full task list
  const tasks: Array<{
    metros: MetroRegion[];
    label: string;
    outputFile: string;
    reason: string;
  }> = [
    {
      metros: CALIFORNIA_METROS,
      label: 'California (metro breakout)',
      outputFile: 'california-metros.json',
      reason: 'Capped at 2,500 — splitting into metros to capture remaining ~1,700',
    },
    {
      metros: NEW_YORK_METROS,
      label: 'New York (metro breakout)',
      outputFile: 'new-york-metros.json',
      reason: 'Failed in main run — retrying via metro segmentation',
    },
    {
      metros: NORTH_CAROLINA_METROS,
      label: 'North Carolina (metro breakout)',
      outputFile: 'north-carolina-metros.json',
      reason: 'Failed in main run — retrying via metro segmentation',
    },
  ];

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   Family Office Scraper — METRO BREAKOUT                ║');
  console.log('║   Capturing capped + failed states via sub-regions      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  for (const task of tasks) {
    console.log(`  ${task.label}: ${task.metros.length} metros (${task.reason})`);
  }
  console.log('');

  if (dryRun) {
    for (const task of tasks) {
      console.log(`\n── ${task.label} ──────────────────────────`);
      for (const metro of task.metros) {
        console.log(`  ${metro.name}: ${buildSearchUrl(metro.geoId, metro.name)}`);
      }
    }
    return;
  }

  // Launch browser
  console.log('── Launching Browser ─────────────────────────────\n');
  const browser = await launchBrowser(false);
  const page = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );

  // Check login
  console.log('  Checking Sales Navigator login...');
  await page.goto('https://www.linkedin.com/sales/home', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await randomDelay(2, 4);

  const loginUrl = page.url();
  if (loginUrl.includes('/login') || loginUrl.includes('/authwall') || loginUrl.includes('/uas/')) {
    console.log('\n  ⚠ Not logged into LinkedIn/Sales Navigator!');
    console.log('  Please log in manually in the Chrome window.');
    console.log('  Waiting up to 5 minutes...\n');
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const url = page.url();
      if (url.includes('/sales/home') || url.includes('/sales/search')) break;
    }
  }
  console.log('  Logged into Sales Navigator ✓\n');

  // Also retry failed states as whole-state searches first
  console.log('── Retrying Failed States (whole-state) ─────────\n');
  for (const [stateName, geoId] of Object.entries(FAILED_STATE_RETRIES)) {
    console.log(`── ${stateName} (full state retry) ──────────────────────────`);
    try {
      const leads = await scrapeRegion(page, geoId, stateName, stateName, pageDelaySec);
      const fileName = stateName.toLowerCase().replace(/\s+/g, '-') + '.json';
      fs.writeFileSync(path.join(OUTPUT_DIR, fileName), JSON.stringify(leads, null, 2));
      console.log(`  Saved to: ${fileName}`);
    } catch (err: any) {
      console.log(`  ✗ Failed: ${err.message}`);
      console.log(`  Will try metro breakout instead.`);
    }
    console.log(`  Waiting ${delaySec}s...\n`);
    await new Promise(r => setTimeout(r, delaySec * 1000));
  }

  // Now run metro breakouts
  for (const task of tasks) {
    console.log(`\n══ ${task.label} ══════════════════════════════\n`);

    const allMetroLeads: Lead[] = [];

    for (let i = 0; i < task.metros.length; i++) {
      const metro = task.metros[i];
      console.log(`── [${i + 1}/${task.metros.length}] ${metro.name} ──────────────────────────`);

      try {
        const leads = await scrapeRegion(page, metro.geoId, metro.name, metro.parentState, pageDelaySec);
        allMetroLeads.push(...leads);
        console.log(`  Running total: ${allMetroLeads.length} leads\n`);
      } catch (err: any) {
        console.log(`  ✗ Failed: ${err.message}\n`);
      }

      if (i < task.metros.length - 1) {
        console.log(`  Waiting ${delaySec}s before next metro...\n`);
        await new Promise(r => setTimeout(r, delaySec * 1000));
      }
    }

    // Deduplicate within metro results
    const dedupedMetro = deduplicateLeads(allMetroLeads);
    console.log(`\n  ${task.label}: ${allMetroLeads.length} raw → ${dedupedMetro.length} unique leads`);

    // Save metro results
    fs.writeFileSync(path.join(OUTPUT_DIR, task.outputFile), JSON.stringify(dedupedMetro, null, 2));
    console.log(`  Saved to: ${task.outputFile}`);
  }

  // ── Final merge: combine ALL state files + metro files ────

  console.log('\n══ Final Merge ══════════════════════════════════\n');

  const allLeads: Lead[] = [];
  const jsonFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.json') && f !== 'progress.json');

  for (const file of jsonFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'));
      if (Array.isArray(data)) {
        allLeads.push(...data);
      }
    } catch {
      // Skip non-array JSON
    }
  }

  console.log(`  Total raw leads across all files: ${allLeads.length}`);
  const finalLeads = deduplicateLeads(allLeads);
  console.log(`  After deduplication: ${finalLeads.length}`);

  // Save combined output
  fs.writeFileSync(COMBINED_JSON, JSON.stringify(finalLeads, null, 2));
  fs.writeFileSync(COMBINED_CSV, leadsToCsv(finalLeads));
  console.log(`  Saved combined JSON: ${COMBINED_JSON}`);
  console.log(`  Saved combined CSV:  ${COMBINED_CSV}`);

  console.log('\n══ Done! ════════════════════════════════════════\n');
  console.log(`  Final count: ${finalLeads.length} unique family office decision makers`);

  await browser.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
