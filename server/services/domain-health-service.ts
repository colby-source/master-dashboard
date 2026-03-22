import dns from 'dns/promises';
import { queryAll, queryOne, runSql, saveDb } from '../db';
import { createAlert } from './alert-service';
import { wsServer } from '../websocket/ws-server';
import { instantlyService } from './instantly-service';

// ── Types ───────────────────────────────────────────────────────

interface DnsResult {
  spf_valid: boolean;
  dkim_valid: boolean;
  dmarc_valid: boolean;
}

interface BlacklistResult {
  blacklisted: boolean;
  listings: string[];
}

interface AccountMetrics {
  account_count: number;
  accounts_warming: number;
  accounts_ready: number;
  avg_open_rate: number | null;
  avg_bounce_rate: number | null;
  avg_spam_rate: number | null;
  total_sent_7d: number;
}

interface WarmupReadiness {
  status: 'not_warming' | 'warming' | 'almost_ready' | 'ready' | 'unhealthy';
  reasons: string[];
}

interface HealthConfig {
  auto_pause_on_blacklist: boolean;
  auto_reduce_on_high_bounce: boolean;
  max_bounce_rate: number;
  max_spam_rate: number;
  min_warmup_days: number;
  min_open_rate_for_ready: number;
  daily_send_limit_warmup: number;
  daily_send_limit_ready: number;
  alert_on_dns_fail: boolean;
}

const DNSBL_SERVERS = [
  'zen.spamhaus.org',
  'b.barracudacentral.org',
  'bl.spamcop.net',
  'dnsbl.sorbs.net',
  'psbl.surriel.com',
];

const DKIM_SELECTORS = ['google', 'default', 'selector1', 'selector2', 'k1'];

// ── DNS Checks ──────────────────────────────────────────────────

async function checkDomainDns(domain: string): Promise<DnsResult> {
  const result: DnsResult = { spf_valid: false, dkim_valid: false, dmarc_valid: false };

  // SPF check
  try {
    const records = await dns.resolveTxt(domain);
    const flat = records.map(r => r.join('')).join(' ');
    result.spf_valid = flat.includes('v=spf1');
  } catch { /* no TXT records */ }

  // DKIM check — try common selectors
  for (const selector of DKIM_SELECTORS) {
    try {
      const records = await dns.resolveTxt(`${selector}._domainkey.${domain}`);
      const flat = records.map(r => r.join('')).join(' ');
      if (flat.includes('v=DKIM1') || flat.includes('p=')) {
        result.dkim_valid = true;
        break;
      }
    } catch { /* selector not found */ }
  }

  // DMARC check
  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    const flat = records.map(r => r.join('')).join(' ');
    result.dmarc_valid = flat.includes('v=DMARC1');
  } catch { /* no DMARC record */ }

  return result;
}

// ── Blacklist Checks ────────────────────────────────────────────

async function checkBlacklists(domain: string): Promise<BlacklistResult> {
  const listings: string[] = [];

  // Resolve domain to IP first
  let ips: string[] = [];
  try {
    ips = await dns.resolve4(domain);
  } catch {
    // If domain doesn't resolve, can't check blacklists
    return { blacklisted: false, listings: [] };
  }

  for (const ip of ips.slice(0, 2)) {
    const reversed = ip.split('.').reverse().join('.');

    const checks = DNSBL_SERVERS.map(async (server) => {
      try {
        await dns.resolve4(`${reversed}.${server}`);
        // If it resolves, the IP is listed
        listings.push(server);
      } catch {
        // NXDOMAIN = not listed (expected)
      }
    });

    await Promise.allSettled(checks);
  }

  return {
    blacklisted: listings.length > 0,
    listings: [...new Set(listings)],
  };
}

// ── Health Score ─────────────────────────────────────────────────

function computeHealthScore(
  dnsResult: DnsResult,
  blacklistResult: BlacklistResult,
  metrics: AccountMetrics
): number {
  // DNS auth: 30% (10 each for SPF, DKIM, DMARC)
  let dnsScore = 0;
  if (dnsResult.spf_valid) dnsScore += 10;
  if (dnsResult.dkim_valid) dnsScore += 10;
  if (dnsResult.dmarc_valid) dnsScore += 10;

  // Blacklist: 30% (0 if blacklisted, 30 if clean)
  const blacklistScore = blacklistResult.blacklisted ? 0 : 30;

  // Sending metrics: 40%
  let metricsScore = 0;
  if (metrics.account_count > 0) {
    // Open rate contribution (up to 15 points)
    const openRate = metrics.avg_open_rate ?? 0;
    metricsScore += Math.min(15, (openRate / 50) * 15);

    // Low bounce rate (up to 15 points)
    const bounceRate = metrics.avg_bounce_rate ?? 0;
    metricsScore += bounceRate < 2 ? 15 : Math.max(0, 15 - bounceRate * 5);

    // Low spam rate (up to 10 points)
    const spamRate = metrics.avg_spam_rate ?? 0;
    metricsScore += spamRate < 0.1 ? 10 : Math.max(0, 10 - spamRate * 50);
  } else {
    // No accounts = neutral (give partial credit)
    metricsScore = 20;
  }

  return Math.round(Math.min(100, dnsScore + blacklistScore + metricsScore));
}

// ── Warmup Readiness ────────────────────────────────────────────

function assessWarmupReadiness(
  account: any,
  warmupData: any,
  dnsResult: DnsResult,
  blacklisted: boolean,
  cfg: HealthConfig
): WarmupReadiness {
  if (!account.warmup_enabled && account.warmup_status !== 'active') {
    return { status: 'not_warming', reasons: ['Warmup not enabled'] };
  }

  if (blacklisted || !dnsResult.spf_valid || !dnsResult.dkim_valid || !dnsResult.dmarc_valid) {
    const reasons: string[] = [];
    if (blacklisted) reasons.push('Domain is blacklisted');
    if (!dnsResult.spf_valid) reasons.push('SPF record missing');
    if (!dnsResult.dkim_valid) reasons.push('DKIM record missing');
    if (!dnsResult.dmarc_valid) reasons.push('DMARC record missing');
    return { status: 'unhealthy', reasons };
  }

  const failReasons: string[] = [];
  let passCount = 0;
  const totalCriteria = 4;

  // Days warming
  const createdAt = account.created_at ? new Date(account.created_at) : new Date();
  const daysWarming = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  if (daysWarming >= cfg.min_warmup_days) {
    passCount++;
  } else {
    failReasons.push(`Only ${daysWarming}/${cfg.min_warmup_days} warmup days`);
  }

  // Open rate
  const openRate = warmupData?.open_rate ?? account.warmup_open_rate ?? 0;
  if (openRate >= cfg.min_open_rate_for_ready) {
    passCount++;
  } else {
    failReasons.push(`Open rate ${openRate.toFixed(1)}% < ${cfg.min_open_rate_for_ready}%`);
  }

  // Bounce rate
  const bounceRate = warmupData?.bounce_rate ?? 0;
  if (bounceRate <= cfg.max_bounce_rate) {
    passCount++;
  } else {
    failReasons.push(`Bounce rate ${bounceRate.toFixed(1)}% > ${cfg.max_bounce_rate}%`);
  }

  // Spam rate
  const spamRate = warmupData?.spam_rate ?? 0;
  if (spamRate <= cfg.max_spam_rate) {
    passCount++;
  } else {
    failReasons.push(`Spam rate ${spamRate.toFixed(1)}% > ${cfg.max_spam_rate}%`);
  }

  if (passCount === totalCriteria) {
    return { status: 'ready', reasons: ['All warmup criteria met'] };
  }
  if (passCount >= totalCriteria - 1) {
    return { status: 'almost_ready', reasons: failReasons };
  }
  return { status: 'warming', reasons: failReasons };
}

// ── Config ──────────────────────────────────────────────────────

function getConfig(domain?: string): HealthConfig {
  // Try domain-specific first, fall back to wildcard
  const row = domain
    ? queryOne('SELECT * FROM domain_health_config WHERE domain = ?', [domain])
    : null;
  const global = queryOne("SELECT * FROM domain_health_config WHERE domain = '*'");
  const cfg = row || global;

  return {
    auto_pause_on_blacklist: cfg?.auto_pause_on_blacklist ?? 1,
    auto_reduce_on_high_bounce: cfg?.auto_reduce_on_high_bounce ?? 1,
    max_bounce_rate: cfg?.max_bounce_rate ?? 2.0,
    max_spam_rate: cfg?.max_spam_rate ?? 0.1,
    min_warmup_days: cfg?.min_warmup_days ?? 14,
    min_open_rate_for_ready: cfg?.min_open_rate_for_ready ?? 30.0,
    daily_send_limit_warmup: cfg?.daily_send_limit_warmup ?? 20,
    daily_send_limit_ready: cfg?.daily_send_limit_ready ?? 50,
    alert_on_dns_fail: cfg?.alert_on_dns_fail ?? 1,
  };
}

// ── Auto-Actions ────────────────────────────────────────────────

async function runAutoActions(
  domain: string,
  dnsResult: DnsResult,
  blacklistResult: BlacklistResult,
  metrics: AccountMetrics,
  accounts: any[]
): Promise<string[]> {
  const cfg = getConfig(domain);
  const actions: string[] = [];

  // Blacklist → pause all accounts
  if (blacklistResult.blacklisted && cfg.auto_pause_on_blacklist) {
    for (const account of accounts) {
      try {
        await instantlyService.pauseAccount(account.email);
        actions.push(`Paused ${account.email} (blacklisted on ${blacklistResult.listings.join(', ')})`);
      } catch (err: any) {
        console.error(`[DomainHealth] Failed to pause ${account.email}:`, err.message);
      }
    }
    createAlert(
      'domain_blacklisted',
      'critical',
      `Domain ${domain} is blacklisted on: ${blacklistResult.listings.join(', ')}. All accounts paused.`,
      'domain-health',
      'domain',
      domain
    );
  }

  // DNS failures → warning alerts
  if (cfg.alert_on_dns_fail) {
    if (!dnsResult.spf_valid) {
      createAlert('dns_missing', 'warning', `SPF record missing for ${domain}. Add a TXT record with "v=spf1" to improve deliverability.`, 'domain-health', 'domain', domain);
      actions.push('Alert: SPF missing');
    }
    if (!dnsResult.dkim_valid) {
      createAlert('dns_missing', 'warning', `DKIM record missing for ${domain}. Configure DKIM signing with your email provider.`, 'domain-health', 'domain', domain);
      actions.push('Alert: DKIM missing');
    }
    if (!dnsResult.dmarc_valid) {
      createAlert('dns_missing', 'warning', `DMARC record missing for ${domain}. Add a TXT record at _dmarc.${domain} with "v=DMARC1".`, 'domain-health', 'domain', domain);
      actions.push('Alert: DMARC missing');
    }
  }

  // High bounce rate → reduce volume
  if (cfg.auto_reduce_on_high_bounce && metrics.avg_bounce_rate !== null && metrics.avg_bounce_rate > cfg.max_bounce_rate) {
    createAlert(
      'high_bounce_rate',
      'warning',
      `Domain ${domain} has ${metrics.avg_bounce_rate.toFixed(1)}% bounce rate (threshold: ${cfg.max_bounce_rate}%). Consider reducing send volume.`,
      'domain-health',
      'domain',
      domain
    );
    actions.push(`Alert: High bounce rate (${metrics.avg_bounce_rate.toFixed(1)}%)`);
  }

  // High spam rate → alert
  if (metrics.avg_spam_rate !== null && metrics.avg_spam_rate > cfg.max_spam_rate) {
    createAlert(
      'high_spam_rate',
      'critical',
      `Domain ${domain} has ${metrics.avg_spam_rate.toFixed(2)}% spam complaint rate (threshold: ${cfg.max_spam_rate}%). Sending should be paused.`,
      'domain-health',
      'domain',
      domain
    );
    actions.push(`Alert: High spam rate (${metrics.avg_spam_rate.toFixed(2)}%)`);
  }

  return actions;
}

// ── Full Health Check ───────────────────────────────────────────

async function fullHealthCheck(targetDomain?: string): Promise<any[]> {
  // Get all accounts from Instantly
  const allAccounts: any[] = [];
  let startingAfter: string | undefined;
  for (let i = 0; i < 10; i++) {
    const result = await instantlyService.listAccounts({ limit: 100, starting_after: startingAfter });
    const items = result?.items ?? result ?? [];
    if (!Array.isArray(items) || items.length === 0) break;
    allAccounts.push(...items);
    startingAfter = result?.next_starting_after;
    if (!startingAfter || items.length < 100) break;
  }

  // Group by domain
  const domainMap = new Map<string, any[]>();
  for (const account of allAccounts) {
    const email: string = account.email || '';
    const domain = email.split('@')[1];
    if (!domain) continue;
    if (targetDomain && domain !== targetDomain) continue;
    const existing = domainMap.get(domain) || [];
    existing.push(account);
    domainMap.set(domain, existing);
  }

  // Get warmup analytics
  const warmupData = await instantlyService.getWarmupAnalytics({ limit: 1000 });
  const warmupMap = new Map<string, any>();
  if (Array.isArray(warmupData?.items ?? warmupData)) {
    for (const w of warmupData?.items ?? warmupData) {
      if (w.email || w.account_id) {
        warmupMap.set(w.email || w.account_id, w);
      }
    }
  }

  const cfg = getConfig();
  const snapshots: any[] = [];

  for (const [domain, accounts] of domainMap) {
    try {
      // Run DNS and blacklist checks in parallel
      const [dnsResult, blacklistResult] = await Promise.all([
        checkDomainDns(domain),
        checkBlacklists(domain),
      ]);

      // Compute account-level metrics
      let totalOpenRate = 0;
      let totalBounceRate = 0;
      let totalSpamRate = 0;
      let rateCount = 0;
      let warmingCount = 0;
      let readyCount = 0;
      let totalSent = 0;

      const accountDetails = accounts.map(account => {
        const wd = warmupMap.get(account.email) || {};
        const readiness = assessWarmupReadiness(account, wd, dnsResult, blacklistResult.blacklisted, cfg);

        if (readiness.status === 'warming' || readiness.status === 'almost_ready') warmingCount++;
        if (readiness.status === 'ready') readyCount++;

        const openRate = wd.open_rate ?? account.warmup_open_rate ?? 0;
        const bounceRate = wd.bounce_rate ?? 0;
        const spamRate = wd.spam_rate ?? 0;
        totalOpenRate += openRate;
        totalBounceRate += bounceRate;
        totalSpamRate += spamRate;
        totalSent += wd.total_sent ?? 0;
        rateCount++;

        return { ...account, warmup_readiness: readiness, warmup_analytics: wd };
      });

      const metrics: AccountMetrics = {
        account_count: accounts.length,
        accounts_warming: warmingCount,
        accounts_ready: readyCount,
        avg_open_rate: rateCount > 0 ? totalOpenRate / rateCount : null,
        avg_bounce_rate: rateCount > 0 ? totalBounceRate / rateCount : null,
        avg_spam_rate: rateCount > 0 ? totalSpamRate / rateCount : null,
        total_sent_7d: totalSent,
      };

      const healthScore = computeHealthScore(dnsResult, blacklistResult, metrics);
      const autoActions = await runAutoActions(domain, dnsResult, blacklistResult, metrics, accounts);

      // Store snapshot
      runSql(
        `INSERT INTO domain_health_snapshots
         (domain, health_score, spf_valid, dkim_valid, dmarc_valid, blacklisted, blacklist_details,
          account_count, accounts_warming, accounts_ready, avg_open_rate, avg_bounce_rate, avg_spam_rate,
          total_sent_7d, auto_actions_taken)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          domain, healthScore,
          dnsResult.spf_valid ? 1 : 0,
          dnsResult.dkim_valid ? 1 : 0,
          dnsResult.dmarc_valid ? 1 : 0,
          blacklistResult.blacklisted ? 1 : 0,
          JSON.stringify(blacklistResult.listings),
          metrics.account_count, metrics.accounts_warming, metrics.accounts_ready,
          metrics.avg_open_rate, metrics.avg_bounce_rate, metrics.avg_spam_rate,
          metrics.total_sent_7d,
          JSON.stringify(autoActions),
        ]
      );

      const snapshot = {
        domain,
        health_score: healthScore,
        dns: dnsResult,
        blacklist: blacklistResult,
        metrics,
        accounts: accountDetails,
        auto_actions: autoActions,
      };

      snapshots.push(snapshot);
    } catch (err: any) {
      console.error(`[DomainHealth] Error checking ${domain}:`, err.message);
    }
  }

  saveDb();
  wsServer.broadcast({ type: 'domain_health_updated', domains: snapshots.map(s => s.domain) });
  return snapshots;
}

// ── Query Helpers ───────────────────────────────────────────────

function getLatestSnapshots(): any[] {
  return queryAll(`
    SELECT dhs.* FROM domain_health_snapshots dhs
    INNER JOIN (
      SELECT domain, MAX(checked_at) as latest
      FROM domain_health_snapshots
      GROUP BY domain
    ) latest ON dhs.domain = latest.domain AND dhs.checked_at = latest.latest
    ORDER BY dhs.health_score ASC
  `);
}

function getDomainHistory(domain: string, limit = 30): any[] {
  return queryAll(
    'SELECT * FROM domain_health_snapshots WHERE domain = ? ORDER BY checked_at DESC LIMIT ?',
    [domain, limit]
  );
}

function getSummary(): any {
  const snapshots = getLatestSnapshots();
  const totalDomains = snapshots.length;
  const healthyCount = snapshots.filter(s => s.health_score >= 80).length;
  const warningCount = snapshots.filter(s => s.health_score >= 50 && s.health_score < 80).length;
  const criticalCount = snapshots.filter(s => s.health_score < 50).length;
  const totalAccounts = snapshots.reduce((sum, s) => sum + (s.account_count || 0), 0);
  const totalWarming = snapshots.reduce((sum, s) => sum + (s.accounts_warming || 0), 0);
  const totalReady = snapshots.reduce((sum, s) => sum + (s.accounts_ready || 0), 0);

  return {
    total_domains: totalDomains,
    healthy: healthyCount,
    warning: warningCount,
    critical: criticalCount,
    total_accounts: totalAccounts,
    accounts_warming: totalWarming,
    accounts_ready: totalReady,
  };
}

// ── Exports ─────────────────────────────────────────────────────

export const domainHealthService = {
  checkDomainDns,
  checkBlacklists,
  computeHealthScore,
  assessWarmupReadiness,
  runAutoActions,
  fullHealthCheck,
  getLatestSnapshots,
  getDomainHistory,
  getConfig,
  getSummary,
};
