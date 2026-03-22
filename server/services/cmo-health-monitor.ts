// ── CMO Health Monitor ────────────────────────────────────────
// Trend-based early warning system that catches problems BEFORE they're big.
// Runs every 6 hours + daily morning brief. Sends Claude-analyzed intelligence
// digest via SMS. Designed for a CMO who needs to know:
//   1. What's broken or trending wrong RIGHT NOW
//   2. What's working and should be doubled down on
//   3. Specific actions to take to improve pipeline performance
//
// This upgrades the existing threshold-based alerts with trend detection.

import { schedule as cronSchedule } from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import { queryAll, queryOne } from '../db';
import { config } from '../config';
import { instantlyService } from './instantly-service';
import { createAlert } from './alert-service';
import { sendSmsToOperator } from './sms-notifications';
import { sendTelegramToOperator, isTelegramConfigured } from './telegram-service';
import { getStats, getAutoReplyStats } from './enrichment/scoring';
import { getCampaignTrend } from './enrichment/campaign-tracker';
import { getLatestInsights } from './enrichment/feedback-loop';

// ── Types ────────────────────────────────────────────────────

interface TrendAlert {
  category: 'deliverability' | 'engagement' | 'pipeline' | 'spend' | 'system';
  severity: 'critical' | 'warning' | 'info';
  metric: string;
  currentValue: number;
  previousValue: number;
  changePercent: number;
  direction: 'up' | 'down';
  message: string;
}

interface HealthDigest {
  timestamp: string;
  companyId: number;
  companyLabel: string;
  alerts: TrendAlert[];
  campaignHealth: CampaignHealthSummary;
  pipelineHealth: PipelineHealthSummary;
  cmoIntelligence: string; // Claude-generated analysis
}

interface CampaignHealthSummary {
  campaignId: string;
  sent: number;
  openRate: number;
  replyRate: number;
  bounceRate: number;
  positiveReplyRate: number;
  meetingsBooked: number;
  openRateTrend: number; // % change vs 7d ago
  replyRateTrend: number;
  bounceRateTrend: number;
}

interface PipelineHealthSummary {
  totalLeads: number;
  enrichedToday: number;
  scoredToday: number;
  pushedToday: number;
  meetingsThisWeek: number;
  hotLeads: number;
  failedLeads: number;
  pendingReplies: number;
  autoRepliesToday: number;
  conversionRate: number; // meetings / pushed
}

// ── Trend Detection ──────────────────────────────────────────

function detectTrends(companyId: number, campaignId: string): TrendAlert[] {
  const alerts: TrendAlert[] = [];

  // Get snapshots: latest vs 7 days ago vs 3 days ago
  const snapshots = getCampaignTrend(campaignId, 14);
  if (snapshots.length < 2) return alerts;

  const latest = snapshots[snapshots.length - 1];
  const weekAgo = snapshots.find(s => {
    const diff = Date.now() - new Date(s.capturedAt).getTime();
    return diff >= 6 * 24 * 60 * 60 * 1000; // ~6-7 days ago
  }) || snapshots[0];
  const threeDaysAgo = snapshots.find(s => {
    const diff = Date.now() - new Date(s.capturedAt).getTime();
    return diff >= 2.5 * 24 * 60 * 60 * 1000; // ~2.5-3 days ago
  }) || weekAgo;

  // ── Bounce rate trending up (early warning before it hits 5%) ──
  if (latest.bounceRate > weekAgo.bounceRate + 1) {
    const change = latest.bounceRate - weekAgo.bounceRate;
    alerts.push({
      category: 'deliverability',
      severity: latest.bounceRate > 3 ? 'critical' : 'warning',
      metric: 'bounce_rate',
      currentValue: latest.bounceRate,
      previousValue: weekAgo.bounceRate,
      changePercent: weekAgo.bounceRate > 0 ? Math.round((change / weekAgo.bounceRate) * 100) : 100,
      direction: 'up',
      message: `Bounce rate UP ${change.toFixed(1)}pp → ${latest.bounceRate}% (was ${weekAgo.bounceRate}%). Check list quality and sender reputation.`,
    });
  }

  // ── Open rate declining (signals deliverability issues) ──
  if (weekAgo.openRate > 0 && latest.openRate < weekAgo.openRate * 0.8) {
    const change = weekAgo.openRate - latest.openRate;
    alerts.push({
      category: 'deliverability',
      severity: latest.openRate < 25 ? 'critical' : 'warning',
      metric: 'open_rate',
      currentValue: latest.openRate,
      previousValue: weekAgo.openRate,
      changePercent: Math.round((change / weekAgo.openRate) * 100),
      direction: 'down',
      message: `Open rate DOWN ${change.toFixed(1)}pp → ${latest.openRate}% (was ${weekAgo.openRate}%). Possible spam folder issues or sender reputation decline.`,
    });
  }

  // ── 3-day consecutive open rate decline (early warning) ──
  if (snapshots.length >= 3) {
    const recent3 = snapshots.slice(-3);
    if (recent3[0].openRate > recent3[1].openRate && recent3[1].openRate > recent3[2].openRate) {
      alerts.push({
        category: 'deliverability',
        severity: 'warning',
        metric: 'open_rate_consecutive_decline',
        currentValue: recent3[2].openRate,
        previousValue: recent3[0].openRate,
        changePercent: Math.round(((recent3[0].openRate - recent3[2].openRate) / recent3[0].openRate) * 100),
        direction: 'down',
        message: `Open rate declining 3 snapshots in a row: ${recent3[0].openRate}% → ${recent3[1].openRate}% → ${recent3[2].openRate}%. Investigate before it gets worse.`,
      });
    }
  }

  // ── Reply rate drop (engagement issue) ──
  if (weekAgo.replyRate > 0 && latest.replyRate < weekAgo.replyRate * 0.6) {
    const change = weekAgo.replyRate - latest.replyRate;
    alerts.push({
      category: 'engagement',
      severity: 'warning',
      metric: 'reply_rate',
      currentValue: latest.replyRate,
      previousValue: weekAgo.replyRate,
      changePercent: Math.round((change / weekAgo.replyRate) * 100),
      direction: 'down',
      message: `Reply rate DOWN ${change.toFixed(1)}pp → ${latest.replyRate}% (was ${weekAgo.replyRate}%). Email copy or targeting may need adjustment.`,
    });
  }

  // ── Spam/unsubscribe spike ──
  if (latest.unsubscribed > 0 && latest.sent > 50) {
    const unsubRate = (latest.unsubscribed / latest.sent) * 100;
    const weekAgoRate = weekAgo.sent > 0 ? (weekAgo.unsubscribed / weekAgo.sent) * 100 : 0;
    if (unsubRate > weekAgoRate + 0.5) {
      alerts.push({
        category: 'deliverability',
        severity: unsubRate > 1 ? 'critical' : 'warning',
        metric: 'unsubscribe_rate',
        currentValue: unsubRate,
        previousValue: weekAgoRate,
        changePercent: weekAgoRate > 0 ? Math.round(((unsubRate - weekAgoRate) / weekAgoRate) * 100) : 100,
        direction: 'up',
        message: `Unsubscribe rate spiking: ${unsubRate.toFixed(2)}% (was ${weekAgoRate.toFixed(2)}%). Review messaging and targeting.`,
      });
    }
  }

  // ── Sent volume anomaly (sending stalled) ──
  if (threeDaysAgo.sent > 0 && latest.sent <= threeDaysAgo.sent) {
    alerts.push({
      category: 'system',
      severity: 'critical',
      metric: 'send_volume',
      currentValue: latest.sent,
      previousValue: threeDaysAgo.sent,
      changePercent: 0,
      direction: 'down',
      message: `Sending appears STALLED — total sent hasn't increased in 3+ days (${latest.sent} emails). Check Instantly campaign status and account health.`,
    });
  }

  return alerts;
}

// ── Pipeline Health ──────────────────────────────────────────

function getPipelineHealth(companyId: number): PipelineHealthSummary {
  const stats = getStats(companyId);
  const autoReply = getAutoReplyStats(companyId);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);

  const enrichedToday = queryOne(
    `SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND enriched_at >= ?`,
    [companyId, todayStart.toISOString()]
  )?.c || 0;

  const scoredToday = queryOne(
    `SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND scored_at >= ?`,
    [companyId, todayStart.toISOString()]
  )?.c || 0;

  const pushedToday = queryOne(
    `SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND pushed_at >= ?`,
    [companyId, todayStart.toISOString()]
  )?.c || 0;

  const meetingsThisWeek = queryOne(
    `SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND status = 'meeting_set' AND updated_at >= ?`,
    [companyId, weekStart.toISOString()]
  )?.c || 0;

  const pushed = stats.pushedToInstantly || 0;
  const meetings = stats.meetingSet || 0;

  return {
    totalLeads: stats.total,
    enrichedToday,
    scoredToday,
    pushedToday,
    meetingsThisWeek,
    hotLeads: stats.scoreHigh,
    failedLeads: stats.failed,
    pendingReplies: autoReply.pendingReplies,
    autoRepliesToday: autoReply.autoRepliesToday,
    conversionRate: pushed > 0 ? Math.round((meetings / pushed) * 10000) / 100 : 0,
  };
}

// ── Pipeline Trend Alerts ────────────────────────────────────

function detectPipelineTrends(companyId: number): TrendAlert[] {
  const alerts: TrendAlert[] = [];

  // Check for failed leads piling up
  const failedRecent = queryOne(
    `SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND status = 'failed' AND updated_at >= datetime('now', '-1 day')`,
    [companyId]
  )?.c || 0;

  const failedPrior = queryOne(
    `SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND status = 'failed' AND updated_at >= datetime('now', '-2 day') AND updated_at < datetime('now', '-1 day')`,
    [companyId]
  )?.c || 0;

  if (failedRecent > 5 && failedRecent > failedPrior * 2) {
    alerts.push({
      category: 'pipeline',
      severity: failedRecent > 20 ? 'critical' : 'warning',
      metric: 'failed_leads',
      currentValue: failedRecent,
      previousValue: failedPrior,
      changePercent: failedPrior > 0 ? Math.round(((failedRecent - failedPrior) / failedPrior) * 100) : 100,
      direction: 'up',
      message: `${failedRecent} leads failed in last 24h (vs ${failedPrior} prior day). Check API health and enrichment errors.`,
    });
  }

  // Check for stalled enrichment (leads stuck in pending)
  const stalledPending = queryOne(
    `SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND status = 'pending' AND created_at <= datetime('now', '-2 day')`,
    [companyId]
  )?.c || 0;

  if (stalledPending > 10) {
    alerts.push({
      category: 'pipeline',
      severity: stalledPending > 50 ? 'critical' : 'warning',
      metric: 'stalled_pending',
      currentValue: stalledPending,
      previousValue: 0,
      changePercent: 0,
      direction: 'up',
      message: `${stalledPending} leads stuck in 'pending' for 2+ days. Enrichment pipeline may be blocked.`,
    });
  }

  // Check auto-reply health (pending replies not being sent)
  const unsent = queryOne(
    `SELECT COUNT(*) as c FROM reply_messages WHERE sent = 0 AND direction = 'outbound' AND created_at <= datetime('now', '-1 hour')`,
  )?.c || 0;

  if (unsent > 3) {
    alerts.push({
      category: 'system',
      severity: unsent > 10 ? 'critical' : 'warning',
      metric: 'unsent_replies',
      currentValue: unsent,
      previousValue: 0,
      changePercent: 0,
      direction: 'up',
      message: `${unsent} auto-replies stuck unsent for 1+ hour. Check Instantly API connection and reply processor.`,
    });
  }

  // Check for escalated threads needing human attention
  const escalated = queryOne(
    `SELECT COUNT(*) as c FROM reply_threads WHERE company_id = ? AND thread_status = 'escalated'`,
    [companyId]
  )?.c || 0;

  if (escalated > 0) {
    alerts.push({
      category: 'engagement',
      severity: escalated > 5 ? 'critical' : 'warning',
      metric: 'escalated_threads',
      currentValue: escalated,
      previousValue: 0,
      changePercent: 0,
      direction: 'up',
      message: `${escalated} reply thread(s) escalated and waiting for human response. These are warm leads losing interest.`,
    });
  }

  return alerts;
}

// ── Spend Trend Alerts ───────────────────────────────────────

function detectSpendTrends(): TrendAlert[] {
  const alerts: TrendAlert[] = [];

  // Check daily spend vs 7-day average
  const todaySpend = queryOne(
    `SELECT SUM(cost_usd) as total FROM api_usage WHERE created_at >= datetime('now', '-1 day')`
  )?.total || 0;

  const avgDailySpend = queryOne(
    `SELECT AVG(daily_total) as avg FROM (
      SELECT date(created_at) as d, SUM(cost_usd) as daily_total
      FROM api_usage
      WHERE created_at >= datetime('now', '-7 day') AND created_at < datetime('now', '-1 day')
      GROUP BY d
    )`
  )?.avg || 0;

  if (avgDailySpend > 0 && todaySpend > avgDailySpend * 2) {
    alerts.push({
      category: 'spend',
      severity: todaySpend > avgDailySpend * 3 ? 'critical' : 'warning',
      metric: 'daily_spend',
      currentValue: todaySpend,
      previousValue: avgDailySpend,
      changePercent: Math.round(((todaySpend - avgDailySpend) / avgDailySpend) * 100),
      direction: 'up',
      message: `Today's API spend $${todaySpend.toFixed(2)} is ${Math.round(todaySpend / avgDailySpend)}x the 7-day average ($${avgDailySpend.toFixed(2)}/day). Check for runaway processes.`,
    });
  }

  return alerts;
}

// ── Claude CMO Intelligence ──────────────────────────────────

async function generateCmoIntelligence(
  alerts: TrendAlert[],
  campaignHealth: CampaignHealthSummary,
  pipelineHealth: PipelineHealthSummary,
  companyId: number,
): Promise<string> {
  if (!config.anthropicApiKey) return 'Claude unavailable — check API key.';

  const insights = getLatestInsights(companyId);

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are the AI advisor to a CMO running cold email campaigns for a $100M investment fund. Give a brief, direct health assessment and 3 specific actions to take.

CAMPAIGN METRICS:
- Sent: ${campaignHealth.sent} | Open: ${campaignHealth.openRate}% | Reply: ${campaignHealth.replyRate}% | Bounce: ${campaignHealth.bounceRate}%
- Meetings booked: ${campaignHealth.meetingsBooked}
- Open rate trend (vs 7d ago): ${campaignHealth.openRateTrend > 0 ? '+' : ''}${campaignHealth.openRateTrend}pp
- Reply rate trend (vs 7d ago): ${campaignHealth.replyRateTrend > 0 ? '+' : ''}${campaignHealth.replyRateTrend}pp
- Bounce rate trend (vs 7d ago): ${campaignHealth.bounceRateTrend > 0 ? '+' : ''}${campaignHealth.bounceRateTrend}pp

PIPELINE:
- Total leads: ${pipelineHealth.totalLeads} | Hot (80+): ${pipelineHealth.hotLeads} | Failed: ${pipelineHealth.failedLeads}
- Today: ${pipelineHealth.enrichedToday} enriched, ${pipelineHealth.scoredToday} scored, ${pipelineHealth.pushedToday} pushed
- This week: ${pipelineHealth.meetingsThisWeek} meetings | Conversion rate: ${pipelineHealth.conversionRate}%
- Auto-replies today: ${pipelineHealth.autoRepliesToday} | Pending: ${pipelineHealth.pendingReplies}

${alerts.length > 0 ? `RED FLAGS:\n${alerts.map(a => `- [${a.severity.toUpperCase()}] ${a.message}`).join('\n')}` : 'No red flags detected.'}

${insights ? `OPTIMIZATION INSIGHTS:\n${insights.recommendations.join('\n')}` : ''}

Give your response in this format:
HEALTH: [one sentence overall assessment]
${alerts.length > 0 ? 'PROBLEMS:\n[numbered list of what needs fixing, most urgent first]' : ''}
ACTIONS:
1. [most impactful thing to do right now]
2. [second most impactful]
3. [third most impactful]
WINS: [what's working well, keep doing]

Be direct. No fluff. Talk like you're texting a busy executive.`,
      }],
    });

    return (response.content[0] as any).text?.trim() || 'Analysis unavailable.';
  } catch (err: any) {
    console.error('[CMO] Intelligence generation error:', err.message);
    return `Analysis error: ${err.message}`;
  }
}

// ── Main Health Check ────────────────────────────────────────

async function runHealthCheck(companyId: number, campaignId: string, companyLabel: string): Promise<HealthDigest> {
  // 1. Detect all trends
  const campaignAlerts = detectTrends(companyId, campaignId);
  const pipelineAlerts = detectPipelineTrends(companyId);
  const spendAlerts = detectSpendTrends();
  const allAlerts = [...campaignAlerts, ...pipelineAlerts, ...spendAlerts];

  // 2. Build campaign health summary
  const snapshots = getCampaignTrend(campaignId, 14);
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const weekAgo = snapshots.find(s => {
    const diff = Date.now() - new Date(s.capturedAt).getTime();
    return diff >= 6 * 24 * 60 * 60 * 1000;
  }) || snapshots[0] || null;

  const campaignHealth: CampaignHealthSummary = {
    campaignId,
    sent: latest?.sent || 0,
    openRate: latest?.openRate || 0,
    replyRate: latest?.replyRate || 0,
    bounceRate: latest?.bounceRate || 0,
    positiveReplyRate: latest?.positiveReplyRate || 0,
    meetingsBooked: latest?.meetingsBooked || 0,
    openRateTrend: weekAgo ? (latest?.openRate || 0) - weekAgo.openRate : 0,
    replyRateTrend: weekAgo ? (latest?.replyRate || 0) - weekAgo.replyRate : 0,
    bounceRateTrend: weekAgo ? (latest?.bounceRate || 0) - weekAgo.bounceRate : 0,
  };

  // 3. Build pipeline health
  const pipelineHealth = getPipelineHealth(companyId);

  // 4. Generate Claude CMO intelligence
  const cmoIntelligence = await generateCmoIntelligence(allAlerts, campaignHealth, pipelineHealth, companyId);

  // 5. Create dashboard alerts for critical/warning items
  for (const alert of allAlerts) {
    if (alert.severity === 'critical' || alert.severity === 'warning') {
      createAlert(
        `cmo_trend_${alert.metric}`,
        alert.severity,
        alert.message,
        'cmo-health-monitor',
        'campaign',
        campaignId,
      );
    }
  }

  return {
    timestamp: new Date().toISOString(),
    companyId,
    companyLabel,
    alerts: allAlerts,
    campaignHealth,
    pipelineHealth,
    cmoIntelligence,
  };
}

// ── Telegram Delivery (primary) ──────────────────────────────

function buildTelegramDigest(digest: HealthDigest): string {
  const criticals = digest.alerts.filter(a => a.severity === 'critical');
  const warnings = digest.alerts.filter(a => a.severity === 'warning');

  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const lines: string[] = [];

  // Header with status indicator
  const statusIcon = criticals.length > 0 ? '🔴' : warnings.length > 0 ? '🟡' : '🟢';
  lines.push(`${statusIcon} *CMO Brief — ${digest.companyLabel}*`);
  lines.push(`_${time} ET_`);
  lines.push('');

  // Red flags
  if (criticals.length > 0) {
    lines.push('🚨 *CRITICAL*');
    for (const a of criticals) {
      lines.push(`• ${a.message}`);
    }
    lines.push('');
  }
  if (warnings.length > 0) {
    lines.push('⚠️ *WATCH*');
    for (const a of warnings) {
      lines.push(`• ${a.message}`);
    }
    lines.push('');
  }

  // Campaign metrics
  const ch = digest.campaignHealth;
  lines.push('📊 *Campaign*');
  lines.push(`Sent: *${ch.sent}* | Open: *${ch.openRate}%* | Reply: *${ch.replyRate}%* | Bounce: *${ch.bounceRate}%*`);

  // Trend arrows
  const arrow = (v: number) => v > 0 ? `↑${v.toFixed(1)}pp` : v < 0 ? `↓${Math.abs(v).toFixed(1)}pp` : '→ flat';
  lines.push(`Trends vs 7d: Open ${arrow(ch.openRateTrend)} | Reply ${arrow(ch.replyRateTrend)} | Bounce ${arrow(ch.bounceRateTrend)}`);
  lines.push('');

  // Pipeline metrics
  const ph = digest.pipelineHealth;
  lines.push('🔧 *Pipeline*');
  lines.push(`Hot leads: *${ph.hotLeads}* | Meetings this week: *${ph.meetingsThisWeek}* | Conv: *${ph.conversionRate}%*`);
  lines.push(`Today: ${ph.enrichedToday} enriched | ${ph.scoredToday} scored | ${ph.pushedToday} pushed`);
  lines.push(`Auto-replies: ${ph.autoRepliesToday} sent | ${ph.pendingReplies} pending`);
  if (ph.failedLeads > 0) {
    lines.push(`Failed: *${ph.failedLeads}* ⚠️`);
  }
  lines.push('');

  // Claude intelligence (full — no truncation needed for Telegram)
  lines.push('🧠 *AI Analysis*');
  lines.push(digest.cmoIntelligence);

  return lines.join('\n');
}

// ── SMS Critical Alert (fallback) ────────────────────────────

function buildSmsCriticalAlert(digest: HealthDigest): string | null {
  const criticals = digest.alerts.filter(a => a.severity === 'critical');
  if (criticals.length === 0) return null;

  // Short SMS — just the critical alerts + "see Telegram"
  const lines = [
    `CRITICAL — ${digest.companyLabel}`,
    ...criticals.slice(0, 2).map(a => a.message.slice(0, 100)),
    criticals.length > 2 ? `+${criticals.length - 2} more` : '',
    'Full report on Telegram',
  ].filter(Boolean);

  return lines.join('\n');
}

// ── Send Digest (Telegram primary, SMS critical fallback) ────

async function sendCmoDigest(digest: HealthDigest): Promise<void> {
  const criticals = digest.alerts.filter(a => a.severity === 'critical');
  const warnings = digest.alerts.filter(a => a.severity === 'warning');

  // 1. Send full digest via Telegram (primary channel)
  if (isTelegramConfigured()) {
    const telegramMsg = buildTelegramDigest(digest);
    await sendTelegramToOperator(digest.companyId, telegramMsg);
    console.log(`[CMO] Telegram digest sent (company ${digest.companyId}): ${criticals.length} critical, ${warnings.length} warnings`);
  } else {
    console.warn('[CMO] Telegram not configured — falling back to SMS for full digest');
    // Fallback: send truncated version via SMS if Telegram isn't set up
    const ch = digest.campaignHealth;
    const ph = digest.pipelineHealth;
    const smsMsg = [
      `CMO Brief — ${digest.companyLabel}`,
      `Open ${ch.openRate}% | Reply ${ch.replyRate}% | Bounce ${ch.bounceRate}%`,
      `Hot: ${ph.hotLeads} | Mtgs: ${ph.meetingsThisWeek} | Conv: ${ph.conversionRate}%`,
      digest.cmoIntelligence.slice(0, 300),
    ].join('\n');
    await sendSmsToOperator(digest.companyId, smsMsg);
  }

  // 2. Send short SMS ping for critical alerts only
  const smsAlert = buildSmsCriticalAlert(digest);
  if (smsAlert) {
    await sendSmsToOperator(digest.companyId, smsAlert);
    console.log(`[CMO] Critical SMS alert sent (company ${digest.companyId})`);
  }
}

// ── Scheduled Runner ─────────────────────────────────────────

function getActiveCompanies(): Array<{ companyId: number; campaignId: string; label: string }> {
  const rows = queryAll(
    `SELECT ec.company_id, ec.target_instantly_campaign_id, cp.company_name
     FROM enrichment_config ec
     LEFT JOIN company_playbooks cp ON cp.company_id = ec.company_id
     WHERE ec.target_instantly_campaign_id IS NOT NULL`
  );
  return rows.map((r: any) => ({
    companyId: r.company_id,
    campaignId: r.target_instantly_campaign_id,
    label: r.company_name || `Company ${r.company_id}`,
  }));
}

async function runAllHealthChecks(): Promise<void> {
  const companies = getActiveCompanies();
  if (companies.length === 0) {
    console.log('[CMO] No active companies — skipping health check');
    return;
  }

  for (const co of companies) {
    try {
      const digest = await runHealthCheck(co.companyId, co.campaignId, co.label);

      // Always send Telegram digest at scheduled brief times
      // SMS only fires for critical alerts (handled inside sendCmoDigest)
      await sendCmoDigest(digest);
    } catch (err: any) {
      console.error(`[CMO] Health check error for ${co.label}:`, err.message);
    }
  }
}

// ── Initialize ───────────────────────────────────────────────

export function initCmoHealthMonitor(): void {
  // Morning CMO brief at 7:30 AM ET (before the 8 AM daily report)
  cronSchedule('30 7 * * *', () => {
    console.log('[CMO] Running morning health brief...');
    runAllHealthChecks().catch(err => {
      console.error('[CMO] Morning brief error:', err.message);
    });
  }, { timezone: 'America/New_York' });

  // Midday check at 12:30 PM ET
  cronSchedule('30 12 * * *', () => {
    console.log('[CMO] Running midday health check...');
    runAllHealthChecks().catch(err => {
      console.error('[CMO] Midday check error:', err.message);
    });
  }, { timezone: 'America/New_York' });

  // Evening wrap at 5:30 PM ET
  cronSchedule('30 17 * * *', () => {
    console.log('[CMO] Running evening health wrap...');
    runAllHealthChecks().catch(err => {
      console.error('[CMO] Evening wrap error:', err.message);
    });
  }, { timezone: 'America/New_York' });

  console.log('[CMO] Health monitor active — briefs at 7:30 AM, 12:30 PM, 5:30 PM ET + critical alerts anytime');
}

// Export for manual triggering via routes
export { runHealthCheck, runAllHealthChecks, detectTrends, detectPipelineTrends };
