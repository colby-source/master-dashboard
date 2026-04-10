import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

class ApifyService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.apifyBaseUrl,
      headers: {
        Authorization: `Bearer ${config.apifyApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120_000,
    });
  }

  // ── Actors (discover & run scrapers) ────────────────────────

  /** Search the Apify Store for actors */
  async searchActors(opts?: { search?: string; limit?: number; offset?: number; category?: string }) {
    const params: Record<string, any> = {};
    if (opts?.search) params.search = opts.search;
    if (opts?.limit) params.limit = opts.limit;
    if (opts?.offset) params.offset = opts.offset;
    if (opts?.category) params.category = opts.category;
    const { data } = await this.client.get('/store', { params });
    return data.data;
  }

  /** Get actor details */
  async getActor(actorId: string) {
    const { data } = await this.client.get(`/acts/${actorId}`);
    return data.data;
  }

  /** Run an actor with given input */
  async runActor(actorId: string, input: any, opts?: {
    memory?: number;
    timeout?: number;
    build?: string;
    waitForFinish?: number;
  }) {
    const params: Record<string, any> = {};
    if (opts?.memory) params.memory = opts.memory;
    if (opts?.timeout) params.timeout = opts.timeout;
    if (opts?.build) params.build = opts.build;
    if (opts?.waitForFinish) params.waitForFinish = opts.waitForFinish;
    const { data } = await this.client.post(`/acts/${actorId}/runs`, input, { params });
    return data.data;
  }

  /** Run an actor and wait for it to finish (synchronous — up to 5 min) */
  async runActorSync(actorId: string, input: any, opts?: { timeout?: number; memory?: number }) {
    const params: Record<string, any> = { waitForFinish: 300 };
    if (opts?.memory) params.memory = opts.memory;
    if (opts?.timeout) params.timeout = opts.timeout;
    const { data } = await this.client.post(`/acts/${actorId}/runs`, input, {
      params,
      timeout: 360_000,
    });
    return data.data;
  }

  /** Get last run of an actor */
  async getActorLastRun(actorId: string) {
    const { data } = await this.client.get(`/acts/${actorId}/runs/last`);
    return data.data;
  }

  // ── Runs ────────────────────────────────────────────────────

  /** List runs for the user account */
  async listRuns(opts?: { limit?: number; offset?: number; desc?: boolean; status?: string }) {
    const params: Record<string, any> = {};
    if (opts?.limit) params.limit = opts.limit;
    if (opts?.offset) params.offset = opts.offset;
    if (opts?.desc !== undefined) params.desc = opts.desc ? 1 : 0;
    if (opts?.status) params.status = opts.status;
    const { data } = await this.client.get('/actor-runs', { params });
    return data.data;
  }

  /** Get a specific run */
  async getRun(runId: string) {
    const { data } = await this.client.get(`/actor-runs/${runId}`);
    return data.data;
  }

  /** Abort a running actor run */
  async abortRun(runId: string) {
    const { data } = await this.client.post(`/actor-runs/${runId}/abort`);
    return data.data;
  }

  /** Resurrect a finished run */
  async resurrectRun(runId: string) {
    const { data } = await this.client.post(`/actor-runs/${runId}/resurrect`);
    return data.data;
  }

  /** Get run log */
  async getRunLog(runId: string) {
    const { data } = await this.client.get(`/actor-runs/${runId}/log`, {
      headers: { Accept: 'text/plain' },
      transformResponse: [(d: any) => d],
    });
    return data;
  }

  // ── Datasets (results from runs) ───────────────────────────

  /** List datasets */
  async listDatasets(opts?: { limit?: number; offset?: number; unnamed?: boolean }) {
    const params: Record<string, any> = {};
    if (opts?.limit) params.limit = opts.limit;
    if (opts?.offset) params.offset = opts.offset;
    if (opts?.unnamed !== undefined) params.unnamed = opts.unnamed ? 1 : 0;
    const { data } = await this.client.get('/datasets', { params });
    return data.data;
  }

  /** Get dataset info */
  async getDataset(datasetId: string) {
    const { data } = await this.client.get(`/datasets/${datasetId}`);
    return data.data;
  }

  /** Get items from a dataset */
  async getDatasetItems(datasetId: string, opts?: {
    limit?: number;
    offset?: number;
    fields?: string[];
    omit?: string[];
    clean?: boolean;
  }) {
    const params: Record<string, any> = {};
    if (opts?.limit) params.limit = opts.limit;
    if (opts?.offset) params.offset = opts.offset;
    if (opts?.fields) params.fields = opts.fields.join(',');
    if (opts?.omit) params.omit = opts.omit.join(',');
    if (opts?.clean) params.clean = 1;
    const { data } = await this.client.get(`/datasets/${datasetId}/items`, { params });
    return data;
  }

  /** Delete a dataset */
  async deleteDataset(datasetId: string) {
    await this.client.delete(`/datasets/${datasetId}`);
  }

  // ── Tasks (saved actor configurations) ─────────────────────

  /** List user tasks */
  async listTasks(opts?: { limit?: number; offset?: number }) {
    const params: Record<string, any> = {};
    if (opts?.limit) params.limit = opts.limit;
    if (opts?.offset) params.offset = opts.offset;
    const { data } = await this.client.get('/actor-tasks', { params });
    return data.data;
  }

  /** Get task details */
  async getTask(taskId: string) {
    const { data } = await this.client.get(`/actor-tasks/${taskId}`);
    return data.data;
  }

  /** Create a new task */
  async createTask(payload: {
    actId: string;
    name: string;
    options?: { build?: string; memoryMbytes?: number; timeoutSecs?: number };
    input?: any;
  }) {
    const { data } = await this.client.post('/actor-tasks', payload);
    return data.data;
  }

  /** Update a task */
  async updateTask(taskId: string, updates: any) {
    const { data } = await this.client.put(`/actor-tasks/${taskId}`, updates);
    return data.data;
  }

  /** Delete a task */
  async deleteTask(taskId: string) {
    await this.client.delete(`/actor-tasks/${taskId}`);
  }

  /** Run a task */
  async runTask(taskId: string, input?: any, opts?: { waitForFinish?: number; memory?: number }) {
    const params: Record<string, any> = {};
    if (opts?.waitForFinish) params.waitForFinish = opts.waitForFinish;
    if (opts?.memory) params.memory = opts.memory;
    const { data } = await this.client.post(`/actor-tasks/${taskId}/runs`, input ?? {}, { params });
    return data.data;
  }

  /** Get last run of a task */
  async getTaskLastRun(taskId: string) {
    const { data } = await this.client.get(`/actor-tasks/${taskId}/runs/last`);
    return data.data;
  }

  // ── Schedules ──────────────────────────────────────────────

  /** List schedules */
  async listSchedules(opts?: { limit?: number; offset?: number }) {
    const params: Record<string, any> = {};
    if (opts?.limit) params.limit = opts.limit;
    if (opts?.offset) params.offset = opts.offset;
    const { data } = await this.client.get('/schedules', { params });
    return data.data;
  }

  /** Create a schedule */
  async createSchedule(payload: {
    name: string;
    cronExpression: string;
    isEnabled?: boolean;
    actions: Array<{ type: string; actorId?: string; actorTaskId?: string; input?: any }>;
  }) {
    const { data } = await this.client.post('/schedules', payload);
    return data.data;
  }

  /** Update a schedule */
  async updateSchedule(scheduleId: string, updates: any) {
    const { data } = await this.client.put(`/schedules/${scheduleId}`, updates);
    return data.data;
  }

  /** Delete a schedule */
  async deleteSchedule(scheduleId: string) {
    await this.client.delete(`/schedules/${scheduleId}`);
  }

  // ── Key-Value Store ────────────────────────────────────────

  /** List key-value stores */
  async listKeyValueStores(opts?: { limit?: number; offset?: number }) {
    const params: Record<string, any> = {};
    if (opts?.limit) params.limit = opts.limit;
    if (opts?.offset) params.offset = opts.offset;
    const { data } = await this.client.get('/key-value-stores', { params });
    return data.data;
  }

  /** Get record from key-value store */
  async getStoreRecord(storeId: string, key: string) {
    const { data } = await this.client.get(`/key-value-stores/${storeId}/records/${key}`);
    return data;
  }

  // ── User / Account ─────────────────────────────────────────

  /** Get current user info */
  async getUser() {
    const { data } = await this.client.get('/users/me');
    return data.data;
  }

  /** Get account usage / limits */
  async getUsage() {
    const { data } = await this.client.get('/users/me/usage/monthly');
    return data.data;
  }

  // ── Pre-configured scraper shortcuts ───────────────────────

  /** Scrape LinkedIn profiles using apify/linkedin-profile-scraper or similar */
  async scrapeLinkedInProfiles(urls: string[], opts?: { maxItems?: number }) {
    return this.runActor('anchor/linkedin-profile-scraper', {
      profileUrls: urls,
      maxItems: opts?.maxItems ?? 50,
    }, { waitForFinish: 120 });
  }

  /** Scrape LinkedIn company pages */
  async scrapeLinkedInCompanies(urls: string[]) {
    return this.runActor('anchor/linkedin-company-scraper', {
      companyUrls: urls,
    }, { waitForFinish: 120 });
  }

  /** Scrape Instagram profiles */
  async scrapeInstagramProfiles(usernames: string[], opts?: { maxPosts?: number }) {
    return this.runActor('apify/instagram-profile-scraper', {
      usernames,
      resultsLimit: opts?.maxPosts ?? 20,
    }, { waitForFinish: 120 });
  }

  /** Scrape Instagram hashtag */
  async scrapeInstagramHashtag(hashtag: string, opts?: { maxPosts?: number }) {
    return this.runActor('apify/instagram-hashtag-scraper', {
      hashtags: [hashtag],
      resultsLimit: opts?.maxPosts ?? 50,
    }, { waitForFinish: 120 });
  }

  /** Scrape Google search results */
  async scrapeGoogle(queries: string[], opts?: { maxResults?: number; language?: string; country?: string }) {
    return this.runActor('apify/google-search-scraper', {
      queries,
      maxPagesPerQuery: 1,
      resultsPerPage: opts?.maxResults ?? 10,
      languageCode: opts?.language ?? 'en',
      countryCode: opts?.country ?? 'us',
    }, { waitForFinish: 120 });
  }

  /** Generic website scraper (Cheerio crawler) */
  async scrapeWebsite(urls: string[], opts?: { maxPages?: number; selector?: string }) {
    return this.runActor('apify/cheerio-scraper', {
      startUrls: urls.map(url => ({ url })),
      maxRequestsPerCrawl: opts?.maxPages ?? 10,
      pageFunction: opts?.selector
        ? `async function pageFunction(context) {
            const { $, request } = context;
            const results = [];
            $('${opts.selector}').each((i, el) => {
              results.push({ text: $(el).text().trim(), url: request.url });
            });
            return results;
          }`
        : undefined,
    }, { waitForFinish: 120 });
  }

  /** Scrape Meta Ad Library for competitor ads */
  async scrapeMetaAdLibrary(keyword: string, opts?: {
    country?: string;
    adActiveStatus?: string;
    maxAds?: number;
    mediaType?: string;
  }) {
    return this.runActorSync('apify/facebook-ads-scraper', {
      search_type: 'keyword_unordered',
      keyword,
      country: opts?.country ?? 'US',
      ad_type: 'all',
      ad_active_status: opts?.adActiveStatus ?? 'active',
      max_ads: opts?.maxAds ?? 100,
      media_type: opts?.mediaType ?? 'all',
    }, { timeout: 300 });
  }

  /** Scrape any website with a full browser (Puppeteer) */
  async scrapeWithBrowser(urls: string[], opts?: { maxPages?: number; waitForSelector?: string }) {
    return this.runActor('apify/web-scraper', {
      startUrls: urls.map(url => ({ url })),
      maxRequestsPerCrawl: opts?.maxPages ?? 10,
      pageFunction: `async function pageFunction(context) {
        const { page, request } = context;
        ${opts?.waitForSelector ? `await page.waitForSelector('${opts.waitForSelector}');` : ''}
        const title = await page.title();
        const text = await page.$eval('body', el => el.innerText.substring(0, 5000));
        return { url: request.url, title, text };
      }`,
    }, { waitForFinish: 120 });
  }
}

export const apifyService = new ApifyService();
