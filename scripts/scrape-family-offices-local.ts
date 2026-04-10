/**
 * Local Family Office Scraper — Puppeteer (runs on YOUR machine)
 *
 * Uses a persistent Chrome profile so LinkedIn sees your real IP and cookies.
 * No Apify = no IP mismatch = no session invalidation.
 *
 * Usage:
 *   npx ts-node scripts/scrape-family-offices-local.ts [options]
 *
 * Options:
 *   --state <name>      Run a single state (e.g., --state "New York")
 *   --states <list>     Comma-separated states (e.g., --states "Alabama,Alaska")
 *   --resume            Resume from last saved progress
 *   --delay <seconds>   Delay between states (default: 120)
 *   --page-delay <sec>  Delay between pages within a state (default: 8)
 *   --headless          Run headless (default: visible so you can intervene)
 *   --dry-run           Show search URLs without scraping
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
const CDP_PORT = 9224; // Different port from linkedin-browser-service (9223)

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'family-office-scrape');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'progress.json');
const COMBINED_CSV = path.join(OUTPUT_DIR, 'family-office-leads-combined.csv');
const COMBINED_JSON = path.join(OUTPUT_DIR, 'family-office-leads-combined.json');

const RESULTS_PER_PAGE = 25; // Sales Navigator shows 25 per page
const MAX_PAGES = 100; // 100 pages × 25 = 2,500 max

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

function buildSearchUrl(stateGeoId: string, stateName: string, page: number = 1): string {
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

  return `https://www.linkedin.com/sales/search/people?page=${page}&query=${query}`;
}

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

// ── Progress Tracking ───────────────────────────────────────

interface Progress {
  completedStates: string[];
  failedStates: string[];
  totalLeads: number;
  startedAt: string | null;
  lastUpdated: string | null;
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return {
    completedStates: [],
    failedStates: [],
    totalLeads: 0,
    startedAt: null,
    lastUpdated: null,
  };
}

function saveProgress(progress: Progress): void {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ── Browser Management ──────────────────────────────────────

async function launchBrowser(headless: boolean): Promise<Browser> {
  // Try reconnecting to existing instance first
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

// ── Scrape a Single Page via DOM (fallback) ─────────────────

function cleanName(raw: string): string {
  // Remove "is reachable", "• 1st", "• 2nd", "• 3rd", degree indicators, etc.
  return raw
    .replace(/\s*is reachable\s*/gi, '')
    .replace(/\s*•\s*\d+(st|nd|rd|th)?\s*/gi, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim();
}

async function scrapeResultsPageDOM(page: Page, state: string): Promise<Lead[]> {
  // Wait for results to load
  try {
    await page.waitForSelector('ol > li, [class*="artdeco-list"] li', { timeout: 15000 });
  } catch {
    const noResults = await page.evaluate(() => {
      const body = document.body.innerText;
      return body.includes('No results found') || body.includes('No lead results') || body.includes('0 result');
    });
    if (noResults) return [];
    await randomDelay(3, 5);
  }

  await randomDelay(2, 3);

  const leads = await page.evaluate((stateName: string) => {
    const results: Array<{
      firstName: string;
      lastName: string;
      company: string;
      title: string;
      linkedInUrl: string;
      location: string;
      state: string;
    }> = [];

    // Find all lead links — anchor tags pointing to /sales/lead/
    const leadLinks = document.querySelectorAll('a[href*="/sales/lead/"]');
    const processed = new Set<string>();

    leadLinks.forEach(link => {
      const href = (link as HTMLAnchorElement).href;
      if (processed.has(href)) return;
      processed.add(href);

      // Walk up to find the containing list item
      let container: Element | null = link;
      for (let i = 0; i < 10 && container; i++) {
        if (container.tagName === 'LI') break;
        container = container.parentElement;
      }
      if (!container) container = link.parentElement?.parentElement || link.parentElement || link;

      // Get name from the link text
      const nameText = link.textContent?.trim() || '';
      if (!nameText || nameText.length > 100) return;

      // Get all text from the container to find company, title, location
      const allText = (container as HTMLElement).innerText || container.textContent || '';
      const lines = allText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0 && l.length < 200);

      // Find company — look for links to /sales/company/
      const companyLink = container.querySelector('a[href*="/sales/company/"]');
      const company = companyLink?.textContent?.trim() || '';

      // Title — typically a line near the name that's not the company or location
      let title = '';
      let location = '';
      for (const line of lines) {
        if (line === nameText || line === company) continue;
        // Location patterns
        if (/\b(United States|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i.test(line)) {
          if (!location) location = line;
          continue;
        }
        // Skip UI elements
        if (/^(Save|Message|Connect|View|More|Send|InMail|is reachable|ago|year|month|day)/i.test(line)) continue;
        if (line.length < 3) continue;
        // Title is usually the first substantial non-name, non-company line
        if (!title && line !== 'Current' && line !== 'Previous') {
          title = line;
        }
      }

      results.push({
        firstName: '',  // Will be split outside evaluate
        lastName: '',
        company,
        title,
        linkedInUrl: href,
        location,
        state: stateName,
      });
    });

    return results;
  }, state);

  // Clean names and split outside of page.evaluate
  return leads.map(l => {
    // Re-extract name from the lead link text if firstName is empty
    // We stored the raw data, now clean it
    return l;
  });
}

// ── Get Total Result Count from Page ────────────────────────

async function getTotalResultCount(page: Page): Promise<number> {
  try {
    // Try multiple selectors and also look for text patterns
    const countText = await page.evaluate(() => {
      // Direct selector approach
      const selectors = [
        '.search-results__result-count',
        '[class*="results-context"] span',
        '[class*="result-count"]',
        'div[class*="search-results__total"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent?.match(/\d/)) return el.textContent.trim();
      }

      // Text search — find "X results" or "X total results" anywhere in headers
      const allText = document.body.innerText;
      const match = allText.match(/(?:About\s+)?([\d,]+)\s+(?:total\s+)?results?/i);
      if (match) return match[0];

      return '';
    });

    const match = countText.match(/([\d,]+)/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10);
    }
  } catch {
    // Ignore
  }
  return 0;
}

// ── Intercept Voyager API for Better Data ───────────────────

interface VoyagerLead {
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  linkedInUrl: string;
  location: string;
}

async function setupVoyagerInterceptor(page: Page): Promise<{
  getLeads: () => VoyagerLead[];
  clear: () => void;
  getTotalCount: () => number;
}> {
  const leads: VoyagerLead[] = [];
  let totalCount = 0;

  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');

  // Buffer completed responses so we can fetch body after response is complete
  const pendingRequests = new Map<string, string>();

  cdp.on('Network.responseReceived', (event) => {
    const url = event.response.url;
    // Match any Sales Navigator search API endpoint
    if (url.includes('/sales-api/') && (
      url.includes('LeadSearch') || url.includes('leadSearch') ||
      url.includes('PeopleSearch') || url.includes('peopleSearch') ||
      url.includes('search')
    )) {
      pendingRequests.set(event.requestId, url);
    }
  });

  cdp.on('Network.loadingFinished', async (event) => {
    const url = pendingRequests.get(event.requestId);
    if (!url) return;
    pendingRequests.delete(event.requestId);

    try {
      const { body } = await cdp.send('Network.getResponseBody', {
        requestId: event.requestId,
      });

      const data = JSON.parse(body);

      // Extract total count
      if (data?.paging?.total != null) {
        totalCount = data.paging.total;
      } else if (data?.metadata?.totalDisplayCount != null) {
        totalCount = data.metadata.totalDisplayCount;
      } else if (data?.totalResultCount != null) {
        totalCount = data.totalResultCount;
      }

      // Extract leads from various response shapes
      const elements = data?.elements || data?.data?.elements || data?.included || [];

      for (const el of elements) {
        // Skip non-person entities
        if (el?.['$type'] && !el['$type'].includes('Profile') && !el['$type'].includes('Lead') && !el['$type'].includes('Person')) {
          continue;
        }

        const profile = el?.currentPositions?.[0] || {};
        const firstName = el?.firstName || el?.currentPositions?.[0]?.firstName || '';
        const lastName = el?.lastName || el?.currentPositions?.[0]?.lastName || '';

        if (!firstName || !lastName) continue;

        // Build LinkedIn URL from entityUrn
        let linkedInUrl = '';
        const urn = el?.entityUrn || el?.objectUrn || el?.profileUrn || '';
        if (urn) {
          const id = urn.split(':').pop() || '';
          if (id) linkedInUrl = `https://www.linkedin.com/sales/lead/${id}`;
        }
        // Also try direct URL fields
        if (!linkedInUrl) {
          linkedInUrl = el?.publicUrl || el?.profileUrl || el?.navigationUrl || '';
        }

        const lead: VoyagerLead = {
          firstName,
          lastName,
          company: profile?.companyName || el?.currentCompany || el?.company?.name || '',
          title: profile?.title || el?.title || el?.headline || '',
          linkedInUrl,
          location: el?.geoRegion || el?.location || el?.geography?.city || '',
        };

        leads.push(lead);
      }
    } catch {
      // Response body may not be available (e.g., streaming)
    }
  });

  return {
    getLeads: () => [...leads],
    clear: () => { leads.length = 0; },
    getTotalCount: () => totalCount,
  };
}

// ── Scrape All Pages for a State ────────────────────────────

async function scrapeState(
  page: Page,
  state: string,
  geoId: string,
  pageDelaySec: number
): Promise<Lead[]> {
  const allLeads: Lead[] = [];
  const seen = new Set<string>();

  // Set up Voyager API interceptor for more reliable data
  const interceptor = await setupVoyagerInterceptor(page);

  // Navigate to first page
  const firstUrl = buildSearchUrl(geoId, state, 1);
  console.log(`  Loading search results...`);
  await page.goto(firstUrl, { waitUntil: 'networkidle2', timeout: 45000 });
  await randomDelay(4, 7);

  // Check if we're logged in / on Sales Navigator
  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) {
    console.log('  ⚠ Not logged in! Please log into Sales Navigator in the browser window.');
    console.log('  Waiting 60s for manual login...');
    await new Promise(r => setTimeout(r, 60000));
    await page.goto(firstUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await randomDelay(4, 7);
  }

  // Wait a moment for Voyager interceptor to capture response
  await randomDelay(2, 3);

  // Get total count — try Voyager first, then DOM
  let totalCount = interceptor.getTotalCount();
  if (totalCount === 0) {
    totalCount = await getTotalResultCount(page);
  }
  // If still 0, assume at least 1 page
  const totalPages = totalCount > 0
    ? Math.min(Math.ceil(totalCount / RESULTS_PER_PAGE), MAX_PAGES)
    : 1;
  console.log(`  Total results: ~${totalCount} (${totalPages} pages)`);

  // Track consecutive empty pages to know when to stop
  let consecutiveEmpty = 0;

  // Scrape each page
  for (let pageNum = 1; pageNum <= Math.max(totalPages, 100); pageNum++) {
    if (pageNum > 1) {
      const pageUrl = buildSearchUrl(geoId, state, pageNum);
      await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 45000 });
      await randomDelay(3, 5);
    }

    // Collect from Voyager interceptor (primary — clean structured data)
    const voyagerLeads = interceptor.getLeads().map(v => ({
      ...v,
      lastName: cleanName(v.lastName),
      firstName: cleanName(v.firstName),
      state,
    }));
    interceptor.clear();

    // If Voyager got nothing, try DOM scraping as fallback
    let pageLeads = voyagerLeads;
    if (voyagerLeads.length === 0) {
      const domLeads = await scrapeResultsPageDOM(page, state);
      pageLeads = domLeads;
    }

    // Deduplicate within this state
    let newCount = 0;
    for (const lead of pageLeads) {
      const key = lead.linkedInUrl
        ? lead.linkedInUrl.toLowerCase().split(',')[0].split('?')[0] // normalize Sales Nav URLs
        : `${lead.firstName}-${lead.lastName}-${lead.company}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        allLeads.push(lead);
        newCount++;
      }
    }

    const displayTotal = totalPages > 1 ? totalPages : '?';
    process.stdout.write(`  Page ${pageNum}/${displayTotal}: +${newCount} new (${allLeads.length} total)      \r`);

    // Stop conditions
    if (newCount === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) {
        console.log(`\n  No new results for ${consecutiveEmpty} pages, stopping pagination`);
        break;
      }
    } else {
      consecutiveEmpty = 0;
    }

    // Stop if we've exceeded the expected total
    if (totalCount > 0 && allLeads.length >= totalCount) {
      console.log(`\n  Reached total result count (${totalCount})`);
      break;
    }

    // Stop at page limit
    if (pageNum >= totalPages && totalPages > 0) {
      console.log('');
      break;
    }

    // Delay between pages (randomized for safety)
    await randomDelay(pageDelaySec * 0.7, pageDelaySec * 1.3);
  }

  console.log(`  Total unique leads: ${allLeads.length}`);
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
  const resume = args.includes('--resume');
  const headless = args.includes('--headless');

  const singleStateIdx = args.indexOf('--state');
  const singleState = singleStateIdx >= 0 ? args[singleStateIdx + 1] : null;

  const statesIdx = args.indexOf('--states');
  const statesList = statesIdx >= 0 ? args[statesIdx + 1].split(',').map(s => s.trim()) : null;

  const delayIdx = args.indexOf('--delay');
  const delaySec = delayIdx >= 0 ? parseInt(args[delayIdx + 1]) : 120;

  const pageDelayIdx = args.indexOf('--page-delay');
  const pageDelaySec = pageDelayIdx >= 0 ? parseInt(args[pageDelayIdx + 1]) : 8;

  // Ensure output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Determine which states to process
  let statesToProcess: string[];
  if (singleState) {
    if (!STATE_GEO_IDS[singleState]) {
      console.error(`Unknown state "${singleState}". Valid: ${Object.keys(STATE_GEO_IDS).join(', ')}`);
      process.exit(1);
    }
    statesToProcess = [singleState];
  } else if (statesList) {
    for (const s of statesList) {
      if (!STATE_GEO_IDS[s]) {
        console.error(`Unknown state "${s}". Valid: ${Object.keys(STATE_GEO_IDS).join(', ')}`);
        process.exit(1);
      }
    }
    statesToProcess = statesList;
  } else {
    statesToProcess = Object.keys(STATE_GEO_IDS);
  }

  // Load progress if resuming
  const progress: Progress = resume ? loadProgress() : {
    completedStates: [],
    failedStates: [],
    totalLeads: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };

  if (!progress.startedAt) {
    progress.startedAt = new Date().toISOString();
  }

  if (resume && progress.completedStates.length > 0) {
    console.log(`\nResuming. ${progress.completedStates.length} states already completed.`);
    statesToProcess = statesToProcess.filter(s => !progress.completedStates.includes(s));
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   Family Office Scraper — LOCAL (Puppeteer)             ║');
  console.log('║   Granite Park Capital — Fund Lead Generation           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  States to scrape:  ${statesToProcess.length}`);
  console.log(`  Delay between:     ${delaySec}s`);
  console.log(`  Page delay:        ${pageDelaySec}s`);
  console.log(`  Headless:          ${headless}`);
  console.log(`  Output directory:  ${OUTPUT_DIR}`);
  console.log(`  Dry run:           ${dryRun}\n`);

  if (dryRun) {
    for (const state of statesToProcess) {
      console.log(`${state}: ${buildSearchUrl(STATE_GEO_IDS[state], state, 1)}\n`);
    }
    return;
  }

  // Launch browser
  console.log('── Launching Browser ─────────────────────────────\n');
  const browser = await launchBrowser(headless);
  const page = await browser.newPage();

  // Set a realistic viewport and user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );

  // Check if logged into Sales Navigator
  console.log('  Checking Sales Navigator login...');
  await page.goto('https://www.linkedin.com/sales/home', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await randomDelay(2, 4);

  const loginUrl = page.url();
  if (loginUrl.includes('/login') || loginUrl.includes('/authwall') || loginUrl.includes('/uas/')) {
    console.log('\n  ⚠ Not logged into LinkedIn/Sales Navigator!');
    console.log('  Please log in manually in the Chrome window that just opened.');
    console.log('  The script will continue automatically once you\'re logged in.\n');

    // Wait up to 5 minutes for manual login
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const currentUrl = page.url();
      if (currentUrl.includes('/sales/') && !currentUrl.includes('/login')) {
        console.log('  Logged in! Continuing...\n');
        break;
      }
      if (i === 59) {
        console.error('  Timed out waiting for login. Exiting.');
        await browser.close();
        process.exit(1);
      }
    }
  } else {
    console.log('  Logged into Sales Navigator ✓\n');
  }

  // Collect all leads
  const allLeads: Lead[] = [];

  // Load existing leads from completed states if resuming
  if (resume) {
    for (const completedState of progress.completedStates) {
      const stateFile = path.join(OUTPUT_DIR, `${completedState.toLowerCase().replace(/\s+/g, '-')}.json`);
      if (fs.existsSync(stateFile)) {
        const stateLeads: Lead[] = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        allLeads.push(...stateLeads);
      }
    }
    if (allLeads.length > 0) {
      console.log(`  Loaded ${allLeads.length} leads from ${progress.completedStates.length} completed states.\n`);
    }
  }

  // Process each state
  for (let i = 0; i < statesToProcess.length; i++) {
    const state = statesToProcess[i];
    const geoId = STATE_GEO_IDS[state];
    const stateSlug = state.toLowerCase().replace(/\s+/g, '-');

    console.log(`\n── [${i + 1}/${statesToProcess.length}] ${state} ──────────────────────────`);

    try {
      const stateLeads = await scrapeState(page, state, geoId, pageDelaySec);

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

    // Delay between states (skip after last)
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
  for (const [st, cnt] of sorted) {
    console.log(`  ${st.padEnd(20)} ${cnt}`);
  }

  if (progress.failedStates.length > 0) {
    console.log('\n── Failed States (retry with --resume) ────────\n');
    for (const st of progress.failedStates) {
      console.log(`  ${st}`);
    }
  }

  progress.totalLeads = dedupedLeads.length;
  saveProgress(progress);

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Done! ${dedupedLeads.length} unique leads ready for enrichment.`);
  console.log('══════════════════════════════════════════════════\n');

  await browser.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
