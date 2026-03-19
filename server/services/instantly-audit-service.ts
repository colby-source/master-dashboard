import { instantlyService } from './instantly-service';
import { createAlert } from './alert-service';
import { queryAll, queryOne, runSql, saveDb } from '../db';
import { config } from '../config';

// ── Types ──────────────────────────────────────────────────────────────────

export type AuditSeverity = 'ok' | 'warning' | 'critical';

export interface AuditCheck {
  name: string;
  category: string;
  severity: AuditSeverity;
  message: string;
  details?: Record<string, any>;
}

export interface InstantlyAuditReport {
  checks: AuditCheck[];
  summary: { ok: number; warnings: number; critical: number };
  timestamp: string;
}

// ── Thresholds ──────────────────────────────────────────────────────────────

const THRESHOLDS = {
  bounceRateWarning: 3,
  bounceRateCritical: 5,
  spamRateWarning: 0.05,
  spamRateCritical: 0.1,
  replyDropPercent: 50,
  unsubscribeRateWarning: 0.5,
  unsubscribeRateCritical: 1,
  dailySendLimitWarningPct: 80,
  dailySendLimitCriticalPct: 95,
} as const;

// ── Known problematic domain patterns ───────────────────────────────────────

const BLACKLIST_RISK_PATTERNS = [
  /\.xyz$/i,
  /\.top$/i,
  /\.buzz$/i,
  /\.click$/i,
  /\.link$/i,
  /\.info$/i,
  /\.biz$/i,
  /\.cc$/i,
  /\.tk$/i,
  /\.ml$/i,
  /\.ga$/i,
  /\.cf$/i,
  /\.gq$/i,
];

// ── Helper: safe percentage calculation ─────────────────────────────────────

function safePercent(numerator: number, denominator: number): number {
  if (!denominator || denominator === 0) return 0;
  return (numerator / denominator) * 100;
}

// ── Helper: get date N days ago in YYYY-MM-DD format ────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// ── Individual audit checks ────────────────────────────────────────────────

async function checkBounceRates(campaigns: any[]): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  for (const campaign of campaigns) {
    const campaignId = campaign.id;
    const campaignName = campaign.name || campaignId;

    try {
      const analytics = await instantlyService.getCampaignAnalytics(campaignId);
      if (!analytics) continue;

      // The Instantly analytics response may have various shapes — extract what we can
      const sent = analytics.sent ?? analytics.total_sent ?? analytics.emails_sent ?? 0;
      const bounced = analytics.bounced ?? analytics.total_bounced ?? 0;

      if (sent === 0) continue;

      const bounceRate = safePercent(bounced, sent);

      if (bounceRate > THRESHOLDS.bounceRateCritical) {
        checks.push({
          name: `Bounce Rate: ${campaignName}`,
          category: 'bounce_rate',
          severity: 'critical',
          message: `Bounce rate ${bounceRate.toFixed(1)}% exceeds ${THRESHOLDS.bounceRateCritical}% threshold`,
          details: { campaignId, campaignName, bounceRate, sent, bounced },
        });
      } else if (bounceRate > THRESHOLDS.bounceRateWarning) {
        checks.push({
          name: `Bounce Rate: ${campaignName}`,
          category: 'bounce_rate',
          severity: 'warning',
          message: `Bounce rate ${bounceRate.toFixed(1)}% approaching critical threshold`,
          details: { campaignId, campaignName, bounceRate, sent, bounced },
        });
      } else {
        checks.push({
          name: `Bounce Rate: ${campaignName}`,
          category: 'bounce_rate',
          severity: 'ok',
          message: `Bounce rate ${bounceRate.toFixed(1)}% within safe limits`,
          details: { campaignId, bounceRate },
        });
      }
    } catch (err: any) {
      checks.push({
        name: `Bounce Rate: ${campaignName}`,
        category: 'bounce_rate',
        severity: 'warning',
        message: `Unable to fetch analytics: ${err.message}`,
      });
    }
  }

  if (campaigns.length === 0) {
    checks.push({
      name: 'Bounce Rate',
      category: 'bounce_rate',
      severity: 'ok',
      message: 'No active campaigns to check',
    });
  }

  return checks;
}

async function checkSpamComplaintRates(campaigns: any[]): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  for (const campaign of campaigns) {
    const campaignId = campaign.id;
    const campaignName = campaign.name || campaignId;

    try {
      const analytics = await instantlyService.getCampaignAnalytics(campaignId);
      if (!analytics) continue;

      const sent = analytics.sent ?? analytics.total_sent ?? analytics.emails_sent ?? 0;
      const spamComplaints = analytics.spam_complaints ?? analytics.spam ?? analytics.total_spam ?? 0;

      if (sent === 0) continue;

      const spamRate = safePercent(spamComplaints, sent);

      if (spamRate > THRESHOLDS.spamRateCritical) {
        checks.push({
          name: `Spam Rate: ${campaignName}`,
          category: 'spam_rate',
          severity: 'critical',
          message: `Spam complaint rate ${spamRate.toFixed(3)}% exceeds ${THRESHOLDS.spamRateCritical}% threshold`,
          details: { campaignId, campaignName, spamRate, sent, spamComplaints },
        });
      } else if (spamRate > THRESHOLDS.spamRateWarning) {
        checks.push({
          name: `Spam Rate: ${campaignName}`,
          category: 'spam_rate',
          severity: 'warning',
          message: `Spam complaint rate ${spamRate.toFixed(3)}% approaching critical threshold`,
          details: { campaignId, campaignName, spamRate, sent, spamComplaints },
        });
      } else {
        checks.push({
          name: `Spam Rate: ${campaignName}`,
          category: 'spam_rate',
          severity: 'ok',
          message: `Spam complaint rate ${spamRate.toFixed(3)}% within safe limits`,
          details: { campaignId, spamRate },
        });
      }
    } catch {
      // Skip — bounce rate check already reports fetch errors
    }
  }

  if (campaigns.length === 0) {
    checks.push({
      name: 'Spam Complaint Rate',
      category: 'spam_rate',
      severity: 'ok',
      message: 'No active campaigns to check',
    });
  }

  return checks;
}

async function checkReplyRateAnomalies(campaigns: any[]): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  for (const campaign of campaigns) {
    const campaignId = campaign.id;
    const campaignName = campaign.name || campaignId;

    try {
      const dailyAnalytics = await instantlyService.getDailyCampaignAnalytics(campaignId, {
        start_date: daysAgo(8),
        end_date: daysAgo(0),
      });

      if (!dailyAnalytics || !Array.isArray(dailyAnalytics)) continue;

      // Need at least 2 days of data to compare
      if (dailyAnalytics.length < 2) continue;

      // Calculate 7-day average reply rate (exclude today)
      const historicalDays = dailyAnalytics.slice(0, -1);
      const todayData = dailyAnalytics[dailyAnalytics.length - 1];

      const avgReplies = historicalDays.reduce((sum: number, day: any) => {
        return sum + (day.replies ?? day.reply_count ?? 0);
      }, 0) / Math.max(historicalDays.length, 1);

      const todayReplies = todayData.replies ?? todayData.reply_count ?? 0;

      if (avgReplies > 0) {
        const dropPercent = ((avgReplies - todayReplies) / avgReplies) * 100;

        if (dropPercent > THRESHOLDS.replyDropPercent) {
          checks.push({
            name: `Reply Rate Drop: ${campaignName}`,
            category: 'reply_rate',
            severity: 'warning',
            message: `Reply rate dropped ${dropPercent.toFixed(0)}% vs 7-day avg (${todayReplies} today vs ${avgReplies.toFixed(1)} avg)`,
            details: { campaignId, campaignName, todayReplies, avgReplies, dropPercent },
          });
        } else {
          checks.push({
            name: `Reply Rate: ${campaignName}`,
            category: 'reply_rate',
            severity: 'ok',
            message: `Reply rate stable (${todayReplies} today vs ${avgReplies.toFixed(1)} avg)`,
            details: { campaignId, todayReplies, avgReplies },
          });
        }
      }
    } catch {
      // Skip — individual campaign analytics may not be available
    }
  }

  if (campaigns.length === 0) {
    checks.push({
      name: 'Reply Rate Anomalies',
      category: 'reply_rate',
      severity: 'ok',
      message: 'No active campaigns to check',
    });
  }

  return checks;
}

async function checkSendingAccountHealth(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  try {
    const accountsResult = await instantlyService.listAccounts({ limit: 100 });
    const accounts = accountsResult?.items ?? accountsResult ?? [];

    if (!Array.isArray(accounts) || accounts.length === 0) {
      checks.push({
        name: 'Sending Account Health',
        category: 'account_health',
        severity: 'warning',
        message: 'No sending accounts found',
      });
      return checks;
    }

    const paused: string[] = [];
    const suspended: string[] = [];
    const warming: string[] = [];
    const active: string[] = [];

    for (const account of accounts) {
      const email = account.email ?? account.id ?? 'unknown';
      const status = (account.status ?? '').toLowerCase();

      if (status === 'paused' || account.is_paused) {
        paused.push(email);
      } else if (status === 'suspended' || status === 'disabled' || account.is_suspended) {
        suspended.push(email);
      } else if (status === 'warmup' || account.warmup_status === 'active') {
        warming.push(email);
      } else {
        active.push(email);
      }
    }

    if (suspended.length > 0) {
      checks.push({
        name: 'Suspended Accounts',
        category: 'account_health',
        severity: 'critical',
        message: `${suspended.length} account(s) suspended: ${suspended.slice(0, 3).join(', ')}${suspended.length > 3 ? '...' : ''}`,
        details: { suspended, count: suspended.length },
      });
    }

    if (paused.length > 0) {
      checks.push({
        name: 'Paused Accounts',
        category: 'account_health',
        severity: 'warning',
        message: `${paused.length} account(s) paused: ${paused.slice(0, 3).join(', ')}${paused.length > 3 ? '...' : ''}`,
        details: { paused, count: paused.length },
      });
    }

    checks.push({
      name: 'Account Overview',
      category: 'account_health',
      severity: suspended.length > 0 ? 'critical' : paused.length > 0 ? 'warning' : 'ok',
      message: `${active.length} active, ${warming.length} warming, ${paused.length} paused, ${suspended.length} suspended`,
      details: { active: active.length, warming: warming.length, paused: paused.length, suspended: suspended.length, total: accounts.length },
    });
  } catch (err: any) {
    checks.push({
      name: 'Sending Account Health',
      category: 'account_health',
      severity: 'warning',
      message: `Unable to fetch accounts: ${err.message}`,
    });
  }

  return checks;
}

async function checkDomainBlacklistRisk(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  try {
    const accountsResult = await instantlyService.listAccounts({ limit: 100 });
    const accounts = accountsResult?.items ?? accountsResult ?? [];

    if (!Array.isArray(accounts) || accounts.length === 0) {
      checks.push({
        name: 'Domain Blacklist Risk',
        category: 'domain_risk',
        severity: 'ok',
        message: 'No accounts to assess',
      });
      return checks;
    }

    // Extract unique domains from sending accounts
    const domains = new Set<string>();
    for (const account of accounts) {
      const email = account.email ?? '';
      const domain = email.split('@')[1];
      if (domain) domains.add(domain.toLowerCase());
    }

    const riskyDomains: string[] = [];
    const safeDomains: string[] = [];

    for (const domain of domains) {
      const isRisky = BLACKLIST_RISK_PATTERNS.some((pattern) => pattern.test(domain));
      if (isRisky) {
        riskyDomains.push(domain);
      } else {
        safeDomains.push(domain);
      }
    }

    // Also check local domain_health_snapshots for actual blacklist data
    const blacklistedDomains: string[] = [];
    for (const domain of domains) {
      const snapshot: any = queryOne(
        `SELECT blacklisted, blacklist_details FROM domain_health_snapshots WHERE domain = ? ORDER BY checked_at DESC LIMIT 1`,
        [domain]
      );
      if (snapshot?.blacklisted) {
        blacklistedDomains.push(domain);
      }
    }

    if (blacklistedDomains.length > 0) {
      checks.push({
        name: 'Blacklisted Domains',
        category: 'domain_risk',
        severity: 'critical',
        message: `${blacklistedDomains.length} domain(s) blacklisted: ${blacklistedDomains.join(', ')}`,
        details: { blacklistedDomains },
      });
    }

    if (riskyDomains.length > 0) {
      checks.push({
        name: 'Risky Domain TLDs',
        category: 'domain_risk',
        severity: 'warning',
        message: `${riskyDomains.length} domain(s) using high-risk TLDs: ${riskyDomains.join(', ')}`,
        details: { riskyDomains },
      });
    }

    if (blacklistedDomains.length === 0 && riskyDomains.length === 0) {
      checks.push({
        name: 'Domain Blacklist Risk',
        category: 'domain_risk',
        severity: 'ok',
        message: `All ${domains.size} sending domain(s) appear healthy`,
        details: { domains: [...domains] },
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'Domain Blacklist Risk',
      category: 'domain_risk',
      severity: 'warning',
      message: `Unable to assess domains: ${err.message}`,
    });
  }

  return checks;
}

async function checkUnsubscribeRates(campaigns: any[]): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  for (const campaign of campaigns) {
    const campaignId = campaign.id;
    const campaignName = campaign.name || campaignId;

    try {
      const analytics = await instantlyService.getCampaignAnalytics(campaignId);
      if (!analytics) continue;

      const sent = analytics.sent ?? analytics.total_sent ?? analytics.emails_sent ?? 0;
      const unsubscribes = analytics.unsubscribes ?? analytics.unsubscribed ?? analytics.total_unsubscribed ?? 0;

      if (sent === 0) continue;

      const unsubRate = safePercent(unsubscribes, sent);

      if (unsubRate > THRESHOLDS.unsubscribeRateCritical) {
        checks.push({
          name: `Unsubscribe Rate: ${campaignName}`,
          category: 'unsubscribe_rate',
          severity: 'critical',
          message: `Unsubscribe rate ${unsubRate.toFixed(2)}% exceeds ${THRESHOLDS.unsubscribeRateCritical}% threshold`,
          details: { campaignId, campaignName, unsubRate, sent, unsubscribes },
        });
      } else if (unsubRate > THRESHOLDS.unsubscribeRateWarning) {
        checks.push({
          name: `Unsubscribe Rate: ${campaignName}`,
          category: 'unsubscribe_rate',
          severity: 'warning',
          message: `Unsubscribe rate ${unsubRate.toFixed(2)}% approaching critical threshold`,
          details: { campaignId, campaignName, unsubRate, sent, unsubscribes },
        });
      } else {
        checks.push({
          name: `Unsubscribe Rate: ${campaignName}`,
          category: 'unsubscribe_rate',
          severity: 'ok',
          message: `Unsubscribe rate ${unsubRate.toFixed(2)}% within safe limits`,
          details: { campaignId, unsubRate },
        });
      }
    } catch {
      // Skip — other checks already report fetch errors
    }
  }

  if (campaigns.length === 0) {
    checks.push({
      name: 'Unsubscribe Rate',
      category: 'unsubscribe_rate',
      severity: 'ok',
      message: 'No active campaigns to check',
    });
  }

  return checks;
}

async function checkDailySendVolume(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  try {
    // Get workspace plan for send limits
    const plan = await instantlyService.getWorkspacePlan();
    const workspace = await instantlyService.getWorkspace();

    // Get today's analytics overview for total sends
    const overview = await instantlyService.getCampaignAnalyticsOverview();

    const dailySent = overview?.sent_today ?? overview?.emails_sent_today ?? 0;

    // Instantly limits depend on plan — try to extract from workspace/plan info
    // Common limits: Growth=5000/day, Hypergrowth=100000/day, Light Speed=500000/day
    const dailyLimit = plan?.daily_email_limit ?? plan?.email_limit ?? plan?.daily_limit ?? 5000;

    const usagePct = safePercent(dailySent, dailyLimit);

    if (usagePct > THRESHOLDS.dailySendLimitCriticalPct) {
      checks.push({
        name: 'Daily Send Volume',
        category: 'send_volume',
        severity: 'critical',
        message: `${usagePct.toFixed(0)}% of daily limit used (${dailySent}/${dailyLimit})`,
        details: { dailySent, dailyLimit, usagePct, plan: plan?.name },
      });
    } else if (usagePct > THRESHOLDS.dailySendLimitWarningPct) {
      checks.push({
        name: 'Daily Send Volume',
        category: 'send_volume',
        severity: 'warning',
        message: `${usagePct.toFixed(0)}% of daily limit used (${dailySent}/${dailyLimit})`,
        details: { dailySent, dailyLimit, usagePct, plan: plan?.name },
      });
    } else {
      checks.push({
        name: 'Daily Send Volume',
        category: 'send_volume',
        severity: 'ok',
        message: `${dailySent} emails sent today (${usagePct.toFixed(0)}% of ${dailyLimit} limit)`,
        details: { dailySent, dailyLimit, usagePct },
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'Daily Send Volume',
      category: 'send_volume',
      severity: 'warning',
      message: `Unable to check send volume: ${err.message}`,
    });
  }

  return checks;
}

async function checkCampaignStatusAnomalies(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  try {
    // Get campaigns from local DB that should be active
    const localActiveCampaigns = queryAll(
      `SELECT id, name, external_id, status, stats_json FROM campaigns WHERE status = 'active' AND external_id IS NOT NULL`
    );

    if (localActiveCampaigns.length === 0) {
      checks.push({
        name: 'Campaign Status',
        category: 'campaign_status',
        severity: 'ok',
        message: 'No active campaigns tracked locally',
      });
      return checks;
    }

    const anomalies: Array<{ name: string; localStatus: string; instantlyStatus: string }> = [];

    for (const campaign of localActiveCampaigns) {
      try {
        const instantlyCampaign = await instantlyService.getCampaign(campaign.external_id);
        if (!instantlyCampaign) {
          anomalies.push({
            name: campaign.name,
            localStatus: 'active',
            instantlyStatus: 'not_found',
          });
          continue;
        }

        // Check if campaign is paused or completed on Instantly side but active locally
        const instantlyStatus = (instantlyCampaign.status ?? '').toString().toLowerCase();
        if (instantlyStatus === 'paused' || instantlyStatus === 'completed' || instantlyStatus === '0') {
          anomalies.push({
            name: campaign.name,
            localStatus: 'active',
            instantlyStatus,
          });
        }

        // Check sending status — campaign marked active but not actually sending
        const sendingStatus = await instantlyService.getCampaignSendingStatus(campaign.external_id);
        if (sendingStatus && sendingStatus.is_sending === false && instantlyStatus !== 'completed') {
          anomalies.push({
            name: campaign.name,
            localStatus: 'active',
            instantlyStatus: `${instantlyStatus} (not sending)`,
          });
        }
      } catch {
        // Individual campaign check failure is not critical
      }
    }

    if (anomalies.length > 0) {
      checks.push({
        name: 'Campaign Status Anomalies',
        category: 'campaign_status',
        severity: 'warning',
        message: `${anomalies.length} campaign(s) have status mismatches`,
        details: { anomalies },
      });
    } else {
      checks.push({
        name: 'Campaign Status',
        category: 'campaign_status',
        severity: 'ok',
        message: `All ${localActiveCampaigns.length} active campaign(s) verified`,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'Campaign Status',
      category: 'campaign_status',
      severity: 'warning',
      message: `Unable to check campaign statuses: ${err.message}`,
    });
  }

  return checks;
}

// ── Warmup Ramp Schedule ──────────────────────────────────────────────────
// Auto-adjusts campaign sending limits based on account warmup age.
// Runs as part of the daily audit. Conservative ramp: 10 → 15 → 20/day.

interface WarmupRampConfig {
  campaignId: string;
  accounts: string[];
  rampSchedule: { minAgeDays: number; dailyLimit: number }[];
}

const WARMUP_RAMP_CONFIGS: WarmupRampConfig[] = [
  {
    campaignId: 'c5ad2979-086b-4a9a-89f2-e7766b7023de', // GPF-II RE (Warm)
    accounts: [
      'colby@graniteparkcapitalfund.com', 'ryan@graniteparkcapitalfund.com',
      'colby@granitehousingpartners.com', 'ryan@granitehousingpartners.com',
      'colby@granite-park-fund.com', 'ryan@granite-park-fund.com',
      'colby@granitehousingfund.com', 'ryan@granitehousingfund.com',
    ],
    rampSchedule: [
      { minAgeDays: 14, dailyLimit: 10 },
      { minAgeDays: 21, dailyLimit: 15 },
      { minAgeDays: 28, dailyLimit: 20 },
    ],
  },
];

async function checkWarmupRampSchedule(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  for (const cfg of WARMUP_RAMP_CONFIGS) {
    try {
      // Get warmup age from the first account as reference
      const refAccount = await instantlyService.getAccount(cfg.accounts[0]);
      if (!refAccount?.timestamp_warmup_start) {
        checks.push({
          name: 'Warmup Ramp',
          category: 'warmup_ramp',
          severity: 'warning',
          message: `No warmup start date for ${cfg.accounts[0]} — cannot determine ramp stage`,
        });
        continue;
      }

      const warmupStart = new Date(refAccount.timestamp_warmup_start);
      const ageDays = Math.floor((Date.now() - warmupStart.getTime()) / (1000 * 60 * 60 * 24));
      const warmupLimit = refAccount.warmup?.limit ? Number(refAccount.warmup.limit) : 0;
      const warmupIncrement = refAccount.warmup?.increment ? Number(refAccount.warmup.increment) : 0;
      const expectedVolume = warmupIncrement > 0 ? Math.min(ageDays * warmupIncrement, warmupLimit) : 0;
      const atCapacity = warmupLimit > 0 && expectedVolume >= warmupLimit;

      // Find the highest applicable ramp tier (requires 14+ days AND at capacity)
      const applicableTier = [...cfg.rampSchedule]
        .reverse()
        .find(tier => ageDays >= tier.minAgeDays && atCapacity);

      if (!applicableTier) {
        const volumeInfo = `${expectedVolume}/${warmupLimit} warmup/day (${atCapacity ? 'at capacity' : 'ramping'})`;
        checks.push({
          name: 'Warmup Ramp',
          category: 'warmup_ramp',
          severity: 'ok',
          message: `Accounts warming for ${ageDays}d. ${volumeInfo}. ` +
            (ageDays < 14 ? `Not ready — need ${14 - ageDays} more days before sending.` : `Not yet at capacity — hold sending.`),
          details: { ageDays, expectedVolume, warmupLimit, atCapacity, campaignId: cfg.campaignId },
        });
        continue;
      }

      // Check current campaign limit
      const campaign = await instantlyService.getCampaign(cfg.campaignId);
      const currentLimit = campaign?.daily_limit ?? 0;

      if (currentLimit < applicableTier.dailyLimit) {
        // Auto-ramp: increase the campaign daily limit
        await instantlyService.updateCampaign(cfg.campaignId, { daily_limit: applicableTier.dailyLimit });
        console.log(`[Warmup Ramp] Campaign ${cfg.campaignId} daily_limit raised: ${currentLimit} → ${applicableTier.dailyLimit} (age: ${ageDays}d, volume: ${expectedVolume}/${warmupLimit})`);

        checks.push({
          name: 'Warmup Ramp — Auto Increased',
          category: 'warmup_ramp',
          severity: 'ok',
          message: `Auto-ramped campaign limit: ${currentLimit} → ${applicableTier.dailyLimit}/day per account. ` +
            `Warmup age: ${ageDays}d, volume: ${expectedVolume}/${warmupLimit}/day. ` +
            `Total capacity: ${applicableTier.dailyLimit * cfg.accounts.length}/day across ${cfg.accounts.length} accounts.`,
          details: { ageDays, expectedVolume, warmupLimit, previousLimit: currentLimit, newLimit: applicableTier.dailyLimit, campaignId: cfg.campaignId },
        });
      } else {
        checks.push({
          name: 'Warmup Ramp',
          category: 'warmup_ramp',
          severity: 'ok',
          message: `Campaign at ${currentLimit}/day per account (${currentLimit * cfg.accounts.length} total). ` +
            `Warmup age: ${ageDays}d, volume: ${expectedVolume}/${warmupLimit}/day. On track.`,
          details: { ageDays, expectedVolume, warmupLimit, currentLimit, campaignId: cfg.campaignId },
        });
      }
    } catch (err: any) {
      checks.push({
        name: 'Warmup Ramp',
        category: 'warmup_ramp',
        severity: 'warning',
        message: `Warmup ramp check failed: ${err.message}`,
      });
    }
  }

  return checks;
}

// ── Main audit runner ──────────────────────────────────────────────────────

export async function runInstantlyAudit(): Promise<InstantlyAuditReport> {
  console.log('[Instantly Audit] Starting email health audit...');

  if (!config.instantlyApiKey) {
    const report: InstantlyAuditReport = {
      checks: [{
        name: 'Instantly API',
        category: 'api_connectivity',
        severity: 'critical',
        message: 'Instantly API key not configured',
      }],
      summary: { ok: 0, warnings: 0, critical: 1 },
      timestamp: new Date().toISOString(),
    };
    return report;
  }

  // Fetch active campaigns once to reuse across checks
  let activeCampaigns: any[] = [];
  try {
    const campaignsResult = await instantlyService.listCampaigns({ limit: 100, status: 1 });
    activeCampaigns = campaignsResult?.items ?? campaignsResult ?? [];
    if (!Array.isArray(activeCampaigns)) activeCampaigns = [];
  } catch (err: any) {
    console.error('[Instantly Audit] Failed to fetch campaigns:', err.message);
  }

  // Run all checks in parallel where possible
  const [
    bounceChecks,
    spamChecks,
    replyChecks,
    accountChecks,
    domainChecks,
    unsubChecks,
    volumeChecks,
    statusChecks,
    rampChecks,
  ] = await Promise.all([
    checkBounceRates(activeCampaigns),
    checkSpamComplaintRates(activeCampaigns),
    checkReplyRateAnomalies(activeCampaigns),
    checkSendingAccountHealth(),
    checkDomainBlacklistRisk(),
    checkUnsubscribeRates(activeCampaigns),
    checkDailySendVolume(),
    checkCampaignStatusAnomalies(),
    checkWarmupRampSchedule(),
  ]);

  const allChecks = [
    ...bounceChecks,
    ...spamChecks,
    ...replyChecks,
    ...accountChecks,
    ...domainChecks,
    ...unsubChecks,
    ...volumeChecks,
    ...statusChecks,
    ...rampChecks,
  ];

  const summary = {
    ok: allChecks.filter((c) => c.severity === 'ok').length,
    warnings: allChecks.filter((c) => c.severity === 'warning').length,
    critical: allChecks.filter((c) => c.severity === 'critical').length,
  };

  const report: InstantlyAuditReport = {
    checks: allChecks,
    summary,
    timestamp: new Date().toISOString(),
  };

  // Persist audit result
  try {
    runSql(
      `INSERT INTO instantly_audits (audit_data, ok_count, warning_count, critical_count) VALUES (?, ?, ?, ?)`,
      [JSON.stringify(report), summary.ok, summary.warnings, summary.critical]
    );
    saveDb();
  } catch (err) {
    console.error('[Instantly Audit] Failed to store audit result:', err);
  }

  // Create dashboard alerts for warning/critical findings
  for (const check of allChecks) {
    if (check.severity === 'critical') {
      createAlert(
        'instantly_audit_critical',
        'critical',
        `${check.name}: ${check.message}`,
        'instantly-audit',
        'campaign',
        check.details?.campaignId
      );
    } else if (check.severity === 'warning') {
      createAlert(
        'instantly_audit_warning',
        'warning',
        `${check.name}: ${check.message}`,
        'instantly-audit',
        'campaign',
        check.details?.campaignId
      );
    }
  }

  console.log(`[Instantly Audit] Complete — OK: ${summary.ok}, Warnings: ${summary.warnings}, Critical: ${summary.critical}`);

  return report;
}

// ── HTML renderer for email report section ─────────────────────────────────

export function renderInstantlyAuditHtml(report: InstantlyAuditReport): string {
  const statusIcon = (s: AuditSeverity) => s === 'ok' ? '&#9989;' : s === 'warning' ? '&#9888;&#65039;' : '&#10060;';
  const statusColor = (s: AuditSeverity) => s === 'ok' ? '#38a169' : s === 'warning' ? '#ed8936' : '#e53e3e';

  const issueChecks = report.checks.filter((c) => c.severity !== 'ok');
  const okChecks = report.checks.filter((c) => c.severity === 'ok');

  const issueRows = issueChecks.map((c) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;">${statusIcon(c.severity)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;font-weight:500;color:#2d3748;">${c.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:${statusColor(c.severity)};">${c.message}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:#718096;">${c.category}</td>
    </tr>`).join('');

  const summaryColor = report.summary.critical > 0 ? '#e53e3e' : report.summary.warnings > 0 ? '#ed8936' : '#38a169';
  const summaryText = report.summary.critical > 0
    ? `${report.summary.critical} critical issue(s) require immediate attention`
    : report.summary.warnings > 0
      ? `${report.summary.warnings} warning(s) detected`
      : 'All email health checks passed';

  return `
        <!-- Instantly Email Health Audit -->
        <tr>
          <td style="padding:24px 40px;">
            <h2 style="margin:0 0 8px;font-size:16px;color:#2d3748;">Instantly Email Health</h2>
            <p style="margin:0 0 16px;font-size:13px;color:${summaryColor};font-weight:600;">
              ${summaryText} (${report.summary.ok} OK, ${report.summary.warnings} warnings, ${report.summary.critical} critical)
            </p>
            ${issueChecks.length > 0 ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
              <tr style="background:#edf2f7;">
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;width:30px;"></th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Check</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Issue</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Category</th>
              </tr>
              ${issueRows}
            </table>` : ''}
            ${okChecks.length > 0 ? `
            <p style="margin:${issueChecks.length > 0 ? '12px' : '0'} 0 0;font-size:12px;color:#718096;">
              ${okChecks.length} check(s) passed: ${okChecks.map((c) => c.name).slice(0, 5).join(', ')}${okChecks.length > 5 ? '...' : ''}
            </p>` : ''}
          </td>
        </tr>`;
}

// ── Get latest audit from DB ───────────────────────────────────────────────

export function getLatestInstantlyAudit(): InstantlyAuditReport | null {
  const row: any = queryOne(`SELECT audit_data FROM instantly_audits ORDER BY id DESC LIMIT 1`);
  if (!row) return null;
  try {
    return JSON.parse(row.audit_data);
  } catch {
    return null;
  }
}
