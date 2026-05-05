import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { instantlyService } from '../instantly-service';
import { claudeService } from '../claude-service';
import { getCompanyConfig, logEvent } from './helpers';
import { wsServer } from '../../websocket/ws-server';
import { createLogger } from '../../utils/logger';
const log = createLogger('campaign-tracker');

export interface CampaignSnapshot {
  campaignId: string;
  companyId: number;
  capturedAt: string;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  openRate: number;
  replyRate: number;
  bounceRate: number;
  positiveReplyRate: number;
  meetingsBooked: number;
  stepBreakdown: StepStats[];
}

interface StepStats {
  step: number;
  sent: number;
  opened: number;
  replied: number;
  openRate: number;
  replyRate: number;
}

/**
 * Capture a point-in-time snapshot of campaign performance from Instantly.
 * Stores it in the DB for trend analysis and self-optimization.
 */
export async function captureCampaignSnapshot(campaignId: string, companyId: number): Promise<CampaignSnapshot | null> {
  try {
    const [analytics, stepsData] = await Promise.all([
      instantlyService.getCampaignAnalyticsOverview(campaignId),
      instantlyService.getCampaignStepsAnalytics(campaignId),
    ]);

    if (!analytics) return null;

    const sent = Number(analytics.sent || analytics.total_sent || 0);
    const opened = Number(analytics.opened || analytics.total_opened || 0);
    const replied = Number(analytics.replied || analytics.total_replied || 0);
    const bounced = Number(analytics.bounced || analytics.total_bounced || 0);
    const unsubscribed = Number(analytics.unsubscribed || 0);

    // Get positive reply count from our DB
    const positiveReplies = queryOne(
      `SELECT COUNT(*) as count FROM enrichment_events
       WHERE company_id = ? AND event_type IN ('reply_positive', 'meeting_booked')
       AND enrichment_lead_id IN (
         SELECT id FROM enrichment_leads WHERE instantly_campaign_id = ?
       )`,
      [companyId, campaignId]
    )?.count || 0;

    const meetingsBooked = queryOne(
      `SELECT COUNT(*) as count FROM enrichment_leads
       WHERE company_id = ? AND instantly_campaign_id = ? AND status = 'meeting_set'`,
      [companyId, campaignId]
    )?.count || 0;

    // Parse step-level data
    const stepBreakdown: StepStats[] = [];
    const steps = stepsData?.items || stepsData || [];
    if (Array.isArray(steps)) {
      for (const s of steps) {
        const stepSent = Number(s.sent || 0);
        const stepOpened = Number(s.opened || 0);
        const stepReplied = Number(s.replied || 0);
        stepBreakdown.push({
          step: Number(s.step || s.sequence_step || stepBreakdown.length + 1),
          sent: stepSent,
          opened: stepOpened,
          replied: stepReplied,
          openRate: stepSent > 0 ? Math.round((stepOpened / stepSent) * 100) : 0,
          replyRate: stepSent > 0 ? Math.round((stepReplied / stepSent) * 100) : 0,
        });
      }
    }

    const snapshot: CampaignSnapshot = {
      campaignId,
      companyId,
      capturedAt: new Date().toISOString(),
      sent,
      opened,
      replied,
      bounced,
      unsubscribed,
      openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
      replyRate: sent > 0 ? Math.round((replied / sent) * 100) : 0,
      bounceRate: sent > 0 ? Math.round((bounced / sent) * 100) : 0,
      positiveReplyRate: sent > 0 ? Math.round((positiveReplies / sent) * 100) : 0,
      meetingsBooked,
      stepBreakdown,
    };

    // Store snapshot
    runSql(
      `INSERT INTO campaign_snapshots (campaign_id, company_id, snapshot_data, captured_at)
       VALUES (?, ?, ?, ?)`,
      [campaignId, companyId, JSON.stringify(snapshot), snapshot.capturedAt]
    );

    // Check deliverability health and alert if issues detected
    checkDeliverabilityHealth(snapshot, companyId);

    saveDb();
    wsServer.broadcast({ type: 'campaign_snapshot', campaignId, snapshot });

    log.info(
      `[CampaignTracker] Snapshot: ${sent} sent, ${snapshot.openRate}% open, ` +
      `${snapshot.replyRate}% reply, ${snapshot.bounceRate}% bounce, ` +
      `${meetingsBooked} meetings`
    );

    return snapshot;
  } catch (err: any) {
    log.error(`[CampaignTracker] Snapshot error for ${campaignId}:`, err.message);
    return null;
  }
}

/**
 * Check deliverability health and flag issues.
 */
function checkDeliverabilityHealth(snapshot: CampaignSnapshot, companyId: number): void {
  const issues: string[] = [];

  if (snapshot.sent >= 50) {
    if (snapshot.bounceRate > 5) {
      issues.push(`High bounce rate: ${snapshot.bounceRate}% (target: <5%)`);
    }
    if (snapshot.openRate < 30) {
      issues.push(`Low open rate: ${snapshot.openRate}% (target: >30%). Check subject lines and sender reputation.`);
    }
    if (snapshot.replyRate < 1) {
      issues.push(`Very low reply rate: ${snapshot.replyRate}% (target: >2%). Email copy may need improvement.`);
    }
    if (snapshot.unsubscribed > snapshot.sent * 0.03) {
      issues.push(`High unsubscribe rate: ${Math.round((snapshot.unsubscribed / snapshot.sent) * 100)}%. Targeting or messaging may be off.`);
    }
  }

  if (issues.length > 0) {
    logEvent(null, companyId, 'deliverability_warning', {
      campaignId: snapshot.campaignId,
      issues,
      snapshot: {
        sent: snapshot.sent,
        openRate: snapshot.openRate,
        replyRate: snapshot.replyRate,
        bounceRate: snapshot.bounceRate,
      },
    });

    log.warn(`[CampaignTracker] Deliverability issues detected:\n${issues.map(i => `  - ${i}`).join('\n')}`);
  }
}

/**
 * Analyze which personalization angles are driving the best results.
 * Returns insights that feed back into the email generator.
 */
export async function analyzePersonalizationPerformance(companyId: number): Promise<{
  topAngles: { angle: string; replyRate: number; sampleSize: number }[];
  topSubjectPatterns: { pattern: string; openRate: number; sampleSize: number }[];
  recommendations: string[];
}> {
  // Get all pushed leads with generated sequences
  const leads = queryAll(
    `SELECT el.id, el.enrichment_data, el.score, el.score_label
     FROM enrichment_leads el
     WHERE el.company_id = ?
       AND el.instantly_push_status = 'pushed'
       AND el.enrichment_data LIKE '%generated_email_sequence%'`,
    [companyId]
  );

  const angleStats: Record<string, { sent: number; replied: number }> = {};
  const subjectStats: Record<string, { sent: number; opened: number }> = {};

  for (const lead of leads) {
    try {
      const data = JSON.parse(lead.enrichment_data);
      const seq = data.generated_email_sequence;
      if (!seq?.steps) continue;

      // Check if this lead replied
      const hasReply = queryOne(
        `SELECT id FROM reply_threads WHERE enrichment_lead_id = ?`,
        [lead.id]
      );

      for (const step of seq.steps) {
        const angle = step.angle || 'unknown';
        if (!angleStats[angle]) angleStats[angle] = { sent: 0, replied: 0 };
        angleStats[angle].sent++;
        if (hasReply) angleStats[angle].replied++;

        // Track subject line pattern (first 3 words)
        const subjectPattern = (step.subject || '').split(' ').slice(0, 3).join(' ').toLowerCase();
        if (subjectPattern) {
          if (!subjectStats[subjectPattern]) subjectStats[subjectPattern] = { sent: 0, opened: 0 };
          subjectStats[subjectPattern].sent++;
          // We approximate opens by whether there was any engagement
          if (hasReply) subjectStats[subjectPattern].opened++;
        }
      }
    } catch { /* skip malformed data */ }
  }

  const topAngles = Object.entries(angleStats)
    .filter(([, stats]) => stats.sent >= 5)
    .map(([angle, stats]) => ({
      angle,
      replyRate: Math.round((stats.replied / stats.sent) * 100),
      sampleSize: stats.sent,
    }))
    .sort((a, b) => b.replyRate - a.replyRate)
    .slice(0, 10);

  const topSubjectPatterns = Object.entries(subjectStats)
    .filter(([, stats]) => stats.sent >= 5)
    .map(([pattern, stats]) => ({
      pattern,
      openRate: Math.round((stats.opened / stats.sent) * 100),
      sampleSize: stats.sent,
    }))
    .sort((a, b) => b.openRate - a.openRate)
    .slice(0, 10);

  // Generate recommendations via Claude if we have enough data
  const recommendations: string[] = [];
  if (topAngles.length >= 3 && claudeService.available) {
    try {
      const client = claudeService.getClient();
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Analyze these cold email performance metrics and give 3 actionable recommendations to improve reply rates.

Top performing angles (by reply rate):
${topAngles.map(a => `- "${a.angle}": ${a.replyRate}% reply rate (n=${a.sampleSize})`).join('\n')}

Bottom performing angles:
${topAngles.slice(-3).map(a => `- "${a.angle}": ${a.replyRate}% reply rate (n=${a.sampleSize})`).join('\n')}

Give exactly 3 short, specific recommendations. One per line. No numbering or bullets.`
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      recommendations.push(...text.split('\n').filter(l => l.trim().length > 10).slice(0, 3));
    } catch { /* non-critical */ }
  }

  return { topAngles, topSubjectPatterns, recommendations };
}

/**
 * Get campaign performance trend over time.
 */
export function getCampaignTrend(campaignId: string, days: number = 14): CampaignSnapshot[] {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = queryAll(
    `SELECT snapshot_data FROM campaign_snapshots
     WHERE campaign_id = ? AND captured_at >= ?
     ORDER BY captured_at ASC`,
    [campaignId, since.toISOString()]
  );

  return rows.map(r => {
    try {
      return JSON.parse(r.snapshot_data);
    } catch {
      return null;
    }
  }).filter(Boolean);
}
