/**
 * Family Office Overflow Scraper — Captures leads from capped/failed states
 * by running separate searches per seniority level.
 *
 * Strategy: California had ~4,200 results but hit the 2,500 cap when searching
 * all seniority levels at once. By searching CXO, VP, Director, Owner, and
 * Partner separately, each sub-search stays under 2,500 and we capture everything.
 *
 * Also retries New York and North Carolina which failed in the main run.
 *
 * Usage:
 *   npx ts-node scripts/scrape-family-offices-overflow.ts [--dry-run]
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
const OVERFLOW_PROGRESS = path.join(OUTPUT_DIR, 'overflow-progress.json');

const RESULTS_PER_PAGE = 25;
const MAX_PAGES = 100;

// ── Seniority levels to split by ────────────────────────────

const SENIORITY_LEVELS = [
  { id: '8',  text: 'CXO' },
  { id: '10', text: 'Owner' },
  { id: '9',  text: 'Partner' },
  { id: '7',  text: 'VP' },
  { id: '6',  text: 'Director' },
];

// ── States to process ───────────────────────────────────────

const OVERFLOW_STATES: Record<string, string> = {
  'California': '102095887',      // Capped at 2,500 of ~4,200
  'New York': '105080838',        // Failed in main run
  'North Carolina': '103255397',  // Failed in main run
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

interface OverflowProgress {
  completed: string[];  // "California-CXO", "New York-VP", etc.
  totalLeads: number;
  startedAt: string;
  lastUpdated: string;
}

// ── Search URL Builder (single seniority) ───────────────────

function buildSearchUrl(stateGeoId: string, stateName: string, seniority: { id: string; text: string }, page: number = 1): string {
  const query = `(filters:List(` +
    `(type:SENIORITY_LEVEL,values:List(` +
      `(id:${seniority.id},text:${seniority.text},selectionType:INCLUDED)` +
    `)),` +
    `(type:REGION,values:List(` +
      `(id:${stateGeoId},text:${encodeURIComponent(stateName)},selectionType:INCLUDED)` +
    `))` +
  `),keywords:${encodeURIComponent('"family office" OR "family investment office" OR "private investment office" OR "single family office" OR "multi family office"')})`;

  return `https://www.linkedin.com/sales/search/people?page=${page}&query=${query}`;
}

// ── Browser Management ──────────────────────────────────────

async function launchBrowser(): Promise<Browser> {
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
    headless: false,
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

// ── Helpers ─────────────────────────────────────────────────

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

      if (data.paging?.total != null && totalCount === null) {
        totalCount = data.paging.total;
      }
      if (data.metadata?.totalResultCount != null && totalCount === null) {
        totalCount = data.metadata.totalResultCount;
      }

      const elements = data.elements || data.results || [];
      for (const el of elements) {
        const profile = el.currentPositions?.[0] || {};
        const entity = el.entityUrn || el.objectUrn || '';
        const lead: Partial<Lead> = {};

        lead.firstName = el.firstName || el.fullName?.split(' ')[0] || '';
        lead.lastName = el.lastName || el.fullName?.split(' ').slice(1).join(' ') || '';
        lead.company = profile.companyName || el.currentCompany || '';
        lead.title = profile.title || el.title || '';

        if (entity) {
          const match = entity.match(/\(([^,]+)/);
          if (match) {
            lead.linkedInUrl = `https://www.linkedin.com/sales/lead/${match[1]}`;
          }
        }
        if (!lead.linkedInUrl && el.publicIdentifier) {
          lead.linkedInUrl = `https://www.linkedin.com/in/${el.publicIdentifier}`;
        }

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
      try { await client.detach(); } catch {}
    },
  };
}

// ── Scrape a single seniority+state combo ───────────────────

async function scrapeSeniorityState(
  page: Page,
  stateGeoId: string,
  stateName: string,
  seniority: { id: string; text: string },
  pageDelaySec: number,
): Promise<Lead[]> {
  const interceptor = await setupVoyagerInterceptor(page, stateName);
  const allLeads: Lead[] = [];
  let totalResults = 0;
  let consecutiveEmpty = 0;

  const firstUrl = buildSearchUrl(stateGeoId, stateName, seniority, 1);
  await page.goto(firstUrl, { waitUntil: 'networkidle2', timeout: 45000 });
  await randomDelay(4, 7);

  // Check login
  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) {
    console.log('    ⚠ Not logged in! Please log in manually...');
    await new Promise(r => setTimeout(r, 60000));
    await page.goto(firstUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await randomDelay(4, 7);
  }

  await randomDelay(3, 5);

  const interceptTotal = interceptor.getTotalCount();
  if (interceptTotal != null) {
    totalResults = interceptTotal;
  }

  const totalPages = Math.min(Math.ceil(totalResults / RESULTS_PER_PAGE), MAX_PAGES) || 1;
  console.log(`    Results: ~${totalResults} (${totalPages} pages)`);

  // Collect first page
  const firstPageLeads = interceptor.getLeads().map(v => ({
    ...v,
    lastName: cleanName(v.lastName),
    firstName: cleanName(v.firstName),
    state: stateName,
  }));
  interceptor.clear();
  allLeads.push(...firstPageLeads);
  process.stdout.write(`    Page 1/${totalPages}: +${firstPageLeads.length} (${allLeads.length} total)`);

  if (totalResults <= RESULTS_PER_PAGE) {
    console.log('');
    interceptor.destroy();
    return allLeads;
  }

  // Paginate
  for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
    const pageUrl = buildSearchUrl(stateGeoId, stateName, seniority, pageNum);
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
      process.stdout.write(`    Page ${pageNum}/${totalPages}: empty`);
      if (consecutiveEmpty >= 3) {
        console.log('');
        console.log(`    3 consecutive empty — stopping`);
        break;
      }
    } else {
      consecutiveEmpty = 0;
      allLeads.push(...voyagerLeads);
      process.stdout.write(`    Page ${pageNum}/${totalPages}: +${voyagerLeads.length} (${allLeads.length} total)`);
    }

    if (allLeads.length >= totalResults) {
      console.log('');
      break;
    }

    await randomDelay(pageDelaySec * 0.7, pageDelaySec * 1.3);
  }

  console.log('');
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

// ── Progress ────────────────────────────────────────────────

function loadOverflowProgress(): OverflowProgress {
  if (fs.existsSync(OVERFLOW_PROGRESS)) {
    return JSON.parse(fs.readFileSync(OVERFLOW_PROGRESS, 'utf-8'));
  }
  return { completed: [], totalLeads: 0, startedAt: new Date().toISOString(), lastUpdated: new Date().toISOString() };
}

function saveOverflowProgress(progress: OverflowProgress): void {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(OVERFLOW_PROGRESS, JSON.stringify(progress, null, 2));
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const resume = args.includes('--resume');
  const pageDelaySec = 8;
  const delaySec = 120;

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const progress = resume ? loadOverflowProgress() : {
    completed: [] as string[],
    totalLeads: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };

  // Build task list: each state × each seniority level
  const tasks: Array<{ state: string; geoId: string; seniority: typeof SENIORITY_LEVELS[0]; key: string }> = [];
  for (const [state, geoId] of Object.entries(OVERFLOW_STATES)) {
    for (const seniority of SENIORITY_LEVELS) {
      const key = `${state}-${seniority.text}`;
      if (!progress.completed.includes(key)) {
        tasks.push({ state, geoId, seniority, key });
      }
    }
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   Family Office Scraper — SENIORITY SPLIT               ║');
  console.log('║   Capturing capped + failed states                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  States: ${Object.keys(OVERFLOW_STATES).join(', ')}`);
  console.log(`  Seniority levels: ${SENIORITY_LEVELS.map(s => s.text).join(', ')}`);
  console.log(`  Total sub-searches: ${tasks.length}`);
  if (progress.completed.length > 0) {
    console.log(`  Already completed: ${progress.completed.length}`);
  }
  console.log('');

  if (dryRun) {
    for (const task of tasks) {
      console.log(`  ${task.key}: ${buildSearchUrl(task.geoId, task.state, task.seniority)}`);
    }
    return;
  }

  // Launch browser
  console.log('── Launching Browser ─────────────────────────────\n');
  const browser = await launchBrowser();
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

  // Collect all overflow leads per state
  const stateLeads: Record<string, Lead[]> = {};
  let currentPage = page;
  let currentBrowser = browser;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    if (!stateLeads[task.state]) {
      stateLeads[task.state] = [];
    }

    console.log(`── [${i + 1}/${tasks.length}] ${task.state} — ${task.seniority.text} ──────────────────`);

    try {
      const leads = await scrapeSeniorityState(currentPage, task.geoId, task.state, task.seniority, pageDelaySec);
      stateLeads[task.state].push(...leads);
      console.log(`    Got ${leads.length} leads (state running total: ${stateLeads[task.state].length})`);

      progress.completed.push(task.key);
      progress.totalLeads += leads.length;
      saveOverflowProgress(progress);
    } catch (err: any) {
      console.log(`    ✗ Failed: ${err.message}`);
      // Reconnect browser if connection was lost
      if (err.message.includes('Connection closed') || err.message.includes('detached') || err.message.includes('Target closed')) {
        console.log('    Reconnecting browser...');
        try {
          currentBrowser = await launchBrowser();
          currentPage = await currentBrowser.newPage();
          await currentPage.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
          );
          console.log('    Browser reconnected ✓');
        } catch (reconnErr: any) {
          console.log(`    Reconnect failed: ${reconnErr.message}`);
        }
      }
    }

    if (i < tasks.length - 1) {
      console.log(`    Waiting ${delaySec}s...\n`);
      await new Promise(r => setTimeout(r, delaySec * 1000));
    }
  }

  // Save deduplicated per-state overflow files
  console.log('\n══ Saving Results ══════════════════════════════\n');

  for (const [state, leads] of Object.entries(stateLeads)) {
    const deduped = deduplicateLeads(leads);
    const fileName = state.toLowerCase().replace(/\s+/g, '-') + '-overflow.json';
    fs.writeFileSync(path.join(OUTPUT_DIR, fileName), JSON.stringify(deduped, null, 2));
    console.log(`  ${state}: ${leads.length} raw → ${deduped.length} unique → ${fileName}`);
  }

  // ── Final merge: ALL state files + overflow files ─────────

  console.log('\n══ Final Merge ══════════════════════════════════\n');

  const allLeads: Lead[] = [];
  const jsonFiles = fs.readdirSync(OUTPUT_DIR).filter(f =>
    f.endsWith('.json') &&
    !f.includes('progress') &&
    !f.includes('combined') &&
    !f.includes('metros')  // skip failed metro attempt
  );

  for (const file of jsonFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'));
      if (Array.isArray(data)) {
        allLeads.push(...data);
        console.log(`  ${file}: ${data.length} leads`);
      }
    } catch {
      // Skip non-array JSON
    }
  }

  console.log(`\n  Total raw leads: ${allLeads.length}`);
  const finalLeads = deduplicateLeads(allLeads);
  console.log(`  After deduplication: ${finalLeads.length}`);

  fs.writeFileSync(COMBINED_JSON, JSON.stringify(finalLeads, null, 2));
  fs.writeFileSync(COMBINED_CSV, leadsToCsv(finalLeads));
  console.log(`\n  Saved: ${COMBINED_JSON}`);
  console.log(`  Saved: ${COMBINED_CSV}`);

  console.log('\n══ Done! ════════════════════════════════════════\n');
  console.log(`  Final count: ${finalLeads.length} unique family office decision makers`);

  await currentBrowser.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
