import { chromium, type Browser, type BrowserContext } from 'playwright';
import * as cheerio from 'cheerio';
import { createLogger } from '../../../utils/logger';

const log = createLogger('playwright-fetcher');

/**
 * Singleton-ish Playwright wrapper for scrapers that need a real browser.
 * Used for sites that aggressively block non-browser clients (Bidspotter,
 * EquipmentTrader, some React SPAs). Shares one browser across requests for
 * the lifetime of the process; callers don't own lifecycle management.
 */
class PlaywrightFetcher {
  private browser: Browser | null = null;
  private ctx: BrowserContext | null = null;
  private launching: Promise<void> | null = null;

  async fetchHtml(url: string, opts: { timeoutMs?: number; waitForSelector?: string } = {}): Promise<cheerio.CheerioAPI | null> {
    await this.ensureLaunched();
    if (!this.ctx) return null;

    const page = await this.ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 25_000 });
      if (opts.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: 8_000 }).catch(() => undefined);
      }
      const html = await page.content();
      return cheerio.load(html);
    } catch (err) {
      log.warn('playwright fetch failed', { url, error: String(err) });
      return null;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async ensureLaunched(): Promise<void> {
    if (this.browser && this.ctx) return;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      try {
        this.browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
          ],
        });
        this.ctx = await this.browser.newContext({
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
          viewport: { width: 1280, height: 800 },
          locale: 'en-US',
          ignoreHTTPSErrors: true,
        });
        log.info('playwright browser launched');
      } catch (err) {
        log.error('playwright launch failed', { error: String(err) });
        this.browser = null;
        this.ctx = null;
      } finally {
        this.launching = null;
      }
    })();

    return this.launching;
  }

  async close(): Promise<void> {
    try {
      await this.ctx?.close();
    } catch {
      /* noop */
    }
    try {
      await this.browser?.close();
    } catch {
      /* noop */
    }
    this.ctx = null;
    this.browser = null;
  }
}

export const playwrightFetcher = new PlaywrightFetcher();

// Ensure browser is cleanly torn down on process exit
for (const sig of ['SIGINT', 'SIGTERM', 'beforeExit'] as const) {
  process.once(sig, () => {
    void playwrightFetcher.close();
  });
}
