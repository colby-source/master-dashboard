import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { claudeService } from '../claude-service';
import { getCompanyConfig, logEvent } from './helpers';
import { captureCampaignSnapshot, analyzePersonalizationPerformance } from './campaign-tracker';
import { getWinningVariant, getTestResults } from './ab-testing';
import { autoOptimizeSequence } from './sequence-optimizer';
import { promoteWinningStrategies, autoAddObjectionHandlers } from './playbook-evolver';
import { createLogger } from '../../utils/logger';
const log = createLogger('feedback-loop');

/**
 * Self-optimization cycle — runs periodically (e.g., every 4 hours).
 * 1. Captures campaign snapshots
 * 2. Analyzes which email angles/patterns drive results
 * 3. Detects A/B test winners
 * 4. Generates strategy recommendations for future emails
 * 5. Stores learning insights that the email generator reads
 */
export async function runOptimizationCycle(companyId: number): Promise<{
  snapshotsCaptured: number;
  abTestsCompleted: number;
  insightsGenerated: number;
}> {
  const results = { snapshotsCaptured: 0, abTestsCompleted: 0, insightsGenerated: 0 };

  try {
    // 1. Capture snapshots for all active campaigns
    const activeCampaigns = queryAll(
      `SELECT DISTINCT instantly_campaign_id
       FROM enrichment_leads
       WHERE company_id = ? AND instantly_campaign_id IS NOT NULL AND instantly_push_status = 'pushed'`,
      [companyId]
    );

    for (const row of activeCampaigns) {
      if (row.instantly_campaign_id) {
        const snapshot = await captureCampaignSnapshot(row.instantly_campaign_id, companyId);
        if (snapshot) results.snapshotsCaptured++;
      }
    }

    // 2. Check for A/B test winners
    const activeTests = queryAll(
      `SELECT id, test_name FROM ab_tests WHERE company_id = ? AND status = 'active'`,
      [companyId]
    );

    for (const test of activeTests) {
      const winner = getWinningVariant(test.id);
      if (winner) {
        runSql(
          `UPDATE ab_tests SET status = 'completed', winning_variant = ?, completed_at = datetime('now') WHERE id = ?`,
          [winner.variant_name, test.id]
        );
        logEvent(null, companyId, 'ab_test_winner', {
          testId: test.id,
          testName: test.test_name,
          winner: winner.variant_name,
          metric: winner.metric,
          value: winner.value,
        });
        results.abTestsCompleted++;
        log.info(`[FeedbackLoop] A/B test "${test.test_name}" winner: ${winner.variant_name} (${winner.metric}: ${winner.value}%)`);
      }
    }

    // 3. Analyze personalization performance and generate insights
    const perfAnalysis = await analyzePersonalizationPerformance(companyId);

    if (perfAnalysis.topAngles.length >= 3 || perfAnalysis.recommendations.length > 0) {
      // Generate and store a strategy brief that the email generator will read
      const strategyBrief = await generateStrategyBrief(companyId, perfAnalysis);
      if (strategyBrief) {
        // Store in enrichment_config as a learning artifact
        runSql(
          `UPDATE enrichment_config SET scoring_prompt = scoring_prompt WHERE company_id = ?`,
          [companyId]
        );

        // Store learning insights in a separate event for the email generator
        logEvent(null, companyId, 'optimization_insights', {
          topAngles: perfAnalysis.topAngles.slice(0, 5),
          topSubjectPatterns: perfAnalysis.topSubjectPatterns.slice(0, 5),
          recommendations: perfAnalysis.recommendations,
          strategyBrief,
          generatedAt: new Date().toISOString(),
        });

        results.insightsGenerated++;
        log.info(`[FeedbackLoop] Generated optimization insights: ${perfAnalysis.recommendations.length} recommendations`);
      }
    }

    // 4. Correlate reply outcomes with email generation strategies
    await correlateOutcomes(companyId);

    // 5. Analyze reply strategy performance (which Claude reply strategies convert to meetings)
    await analyzeReplyStrategies(companyId);

    // 6. Self-learning: auto-optimize sequence A/B variants
    //    Loop through active campaigns for this company and disable losing variants
    const activeCampaignIds = queryAll(
      `SELECT DISTINCT instantly_campaign_id
       FROM enrichment_leads
       WHERE company_id = ? AND instantly_campaign_id IS NOT NULL AND instantly_push_status = 'pushed'`,
      [companyId],
    );

    for (const row of activeCampaignIds) {
      if (row.instantly_campaign_id) {
        try {
          const seqResult = await autoOptimizeSequence(row.instantly_campaign_id, companyId);
          if (seqResult.variantsDisabled > 0) {
            log.info(
              `[FeedbackLoop] Sequence optimizer: ${seqResult.variantsDisabled} variants disabled ` +
              `for campaign ${row.instantly_campaign_id}`,
            );
          }
        } catch (seqErr: any) {
          log.error(
            `[FeedbackLoop] Sequence optimizer error for ${row.instantly_campaign_id}:`,
            seqErr.message,
          );
        }
      }
    }

    // 7. Self-learning: promote winning reply strategies into playbook
    try {
      const promoResult = await promoteWinningStrategies(companyId);
      if (promoResult.strategiesPromoted > 0) {
        log.info(
          `[FeedbackLoop] Playbook evolver: promoted ${promoResult.strategiesPromoted} winning strategies`,
        );
      }
    } catch (promoErr: any) {
      log.error('[FeedbackLoop] Playbook evolver (promote) error:', promoErr.message);
    }

    // 8. Self-learning: auto-detect and add new objection handlers
    try {
      const objResult = await autoAddObjectionHandlers(companyId);
      if (objResult.handlersAdded > 0) {
        log.info(
          `[FeedbackLoop] Playbook evolver: added ${objResult.handlersAdded} new objection handlers`,
        );
      }
    } catch (objErr: any) {
      log.error('[FeedbackLoop] Playbook evolver (objections) error:', objErr.message);
    }

    saveDb();

    log.info(
      `[FeedbackLoop] Optimization cycle complete: ` +
      `${results.snapshotsCaptured} snapshots, ${results.abTestsCompleted} A/B winners, ` +
      `${results.insightsGenerated} insights`
    );

    return results;
  } catch (err: any) {
    log.error(`[FeedbackLoop] Optimization cycle error:`, err.message);
    return results;
  }
}

/**
 * Generate a strategy brief from performance data.
 * This brief is consumed by the email generator to improve future emails.
 */
async function generateStrategyBrief(
  companyId: number,
  analysis: Awaited<ReturnType<typeof analyzePersonalizationPerformance>>,
): Promise<string | null> {
  if (!claudeService.available) return null;

  try {
    // Get recent reply samples (anonymized) for context
    const recentPositiveReplies = queryAll(
      `SELECT rm.body, rt.last_sentiment
       FROM reply_messages rm
       JOIN reply_threads rt ON rm.thread_id = rt.id
       WHERE rt.company_id = ? AND rm.direction = 'inbound'
         AND rt.last_sentiment IN ('interested', 'meeting_request', 'question')
       ORDER BY rm.created_at DESC LIMIT 10`,
      [companyId]
    );

    const replyExamples = recentPositiveReplies
      .map(r => `[${r.last_sentiment}]: "${(r.body || '').slice(0, 200)}"`)
      .join('\n');

    const client = claudeService.getClient();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Based on cold email campaign performance data, write a brief strategy guide (5-7 bullet points) for generating better cold emails.

PERFORMANCE DATA:
Top performing angles: ${analysis.topAngles.map(a => `"${a.angle}" (${a.replyRate}% reply, n=${a.sampleSize})`).join(', ')}
Bottom angles: ${analysis.topAngles.slice(-3).map(a => `"${a.angle}" (${a.replyRate}% reply, n=${a.sampleSize})`).join(', ')}

${replyExamples ? `SAMPLE POSITIVE REPLIES (what prospects responded to):\n${replyExamples}` : ''}

${analysis.recommendations.length > 0 ? `PREVIOUS RECOMMENDATIONS:\n${analysis.recommendations.join('\n')}` : ''}

Write the strategy brief as bullet points. Be specific and actionable. Focus on what WORKS and what to AVOID.`
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return text.trim();
  } catch (err: any) {
    log.error('[FeedbackLoop] Strategy brief generation error:', err.message);
    return null;
  }
}

/**
 * Correlate reply outcomes with the specific email angles/strategies that generated them.
 * Updates each lead's enrichment data with outcome tracking.
 */
async function correlateOutcomes(companyId: number): Promise<void> {
  // Find leads that got positive replies but haven't been tagged with outcome data
  const uncorrelated = queryAll(
    `SELECT el.id, el.enrichment_data
     FROM enrichment_leads el
     JOIN reply_threads rt ON rt.enrichment_lead_id = el.id
     WHERE el.company_id = ?
       AND rt.last_sentiment IN ('interested', 'meeting_request')
       AND el.enrichment_data LIKE '%generated_email_sequence%'
       AND el.enrichment_data NOT LIKE '%outcome_correlated%'
     LIMIT 50`,
    [companyId]
  );

  for (const lead of uncorrelated) {
    try {
      const data = JSON.parse(lead.enrichment_data);
      const seq = data.generated_email_sequence;
      if (!seq) continue;

      // Tag this lead's email sequence as having generated a positive outcome
      const updatedData = {
        ...data,
        outcome_correlated: true,
        outcome_correlated_at: new Date().toISOString(),
        winning_angles: seq.steps?.map((s: any) => s.angle) || [],
      };

      runSql(
        `UPDATE enrichment_leads SET enrichment_data = ?, updated_at = datetime('now') WHERE id = ?`,
        [JSON.stringify(updatedData), lead.id]
      );
    } catch { /* skip malformed */ }
  }
}

/**
 * Analyze which Claude reply strategies lead to meetings vs escalations.
 * Feeds learnings back into the system prompt so Claude improves over time.
 */
async function analyzeReplyStrategies(companyId: number): Promise<void> {
  try {
    // Get outbound reply strategies and their thread outcomes
    const strategyOutcomes = queryAll(
      `SELECT rm.strategy, rt.thread_status, rt.last_sentiment, rt.auto_reply_count,
              (SELECT COUNT(*) FROM enrichment_events ee
               WHERE ee.enrichment_lead_id = rt.enrichment_lead_id
                 AND ee.event_type = 'meeting_booked') as meetings
       FROM reply_messages rm
       JOIN reply_threads rt ON rm.thread_id = rt.id
       WHERE rt.company_id = ? AND rm.direction = 'outbound' AND rm.generated_by = 'claude'
         AND rm.strategy IS NOT NULL AND rm.strategy != ''
       ORDER BY rm.created_at DESC LIMIT 100`,
      [companyId]
    );

    if (strategyOutcomes.length < 10) return; // Need enough data

    // Group by strategy and count outcomes
    const strategyStats: Record<string, { total: number; meetings: number; escalated: number; positive: number }> = {};
    for (const row of strategyOutcomes) {
      const strategy = (row.strategy || '').slice(0, 100); // Truncate long strategies
      if (!strategyStats[strategy]) {
        strategyStats[strategy] = { total: 0, meetings: 0, escalated: 0, positive: 0 };
      }
      strategyStats[strategy].total++;
      if (row.meetings > 0) strategyStats[strategy].meetings++;
      if (row.thread_status === 'escalated') strategyStats[strategy].escalated++;
      if (['interested', 'meeting_request'].includes(row.last_sentiment)) strategyStats[strategy].positive++;
    }

    // Also analyze A/B variant performance for this company
    const abResults = queryAll(
      `SELECT atv.variant_name, atv.leads_assigned, atv.meetings_booked, atv.positive_replies
       FROM ab_test_variants atv
       JOIN ab_tests at2 ON atv.test_id = at2.id
       WHERE at2.company_id = ? AND at2.status = 'active'`,
      [companyId]
    );

    // Store as reply_strategy_insights event
    logEvent(null, companyId, 'reply_strategy_insights', {
      strategyStats,
      abVariantPerformance: abResults.map(r => ({
        variant: r.variant_name,
        assigned: r.leads_assigned,
        meetings: r.meetings_booked,
        positiveReplies: r.positive_replies,
        meetingRate: r.leads_assigned > 0 ? Math.round((r.meetings_booked / r.leads_assigned) * 1000) / 10 : 0,
      })),
      analyzedAt: new Date().toISOString(),
      sampleSize: strategyOutcomes.length,
    });

    log.info(`[FeedbackLoop] Reply strategy analysis: ${Object.keys(strategyStats).length} strategies from ${strategyOutcomes.length} replies`);
  } catch (err: any) {
    log.error('[FeedbackLoop] Reply strategy analysis error:', err.message);
  }
}

/**
 * Get the latest reply strategy insights for a company.
 * Used by the reply handler to incorporate learnings into Claude's system prompt.
 */
export function getReplyStrategyInsights(companyId: number): {
  topStrategies: { strategy: string; meetingRate: number; total: number }[];
  abPerformance: { variant: string; meetingRate: number; assigned: number }[];
} | null {
  const event = queryOne(
    `SELECT event_data FROM enrichment_events
     WHERE company_id = ? AND event_type = 'reply_strategy_insights'
     ORDER BY created_at DESC LIMIT 1`,
    [companyId]
  );

  if (!event?.event_data) return null;

  try {
    const data = JSON.parse(event.event_data);
    const stats = data.strategyStats || {};

    const topStrategies = Object.entries(stats)
      .map(([strategy, s]: [string, any]) => ({
        strategy,
        meetingRate: s.total > 0 ? Math.round((s.meetings / s.total) * 1000) / 10 : 0,
        total: s.total,
      }))
      .filter(s => s.total >= 3) // Need at least 3 uses
      .sort((a, b) => b.meetingRate - a.meetingRate)
      .slice(0, 5);

    return {
      topStrategies,
      abPerformance: data.abVariantPerformance || [],
    };
  } catch {
    return null;
  }
}

/**
 * Get the latest optimization insights for a company.
 * Used by the email generator to incorporate learnings.
 */
export function getLatestInsights(companyId: number): {
  topAngles: { angle: string; replyRate: number }[];
  recommendations: string[];
  strategyBrief: string | null;
} | null {
  const event = queryOne(
    `SELECT event_data FROM enrichment_events
     WHERE company_id = ? AND event_type = 'optimization_insights'
     ORDER BY created_at DESC LIMIT 1`,
    [companyId]
  );

  if (!event?.event_data) return null;

  try {
    const data = JSON.parse(event.event_data);
    return {
      topAngles: data.topAngles || [],
      recommendations: data.recommendations || [],
      strategyBrief: data.strategyBrief || null,
    };
  } catch {
    return null;
  }
}
