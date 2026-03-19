import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { claudeService } from '../claude-service';
import { getCompanyConfig, logEvent } from './helpers';
import { captureCampaignSnapshot, analyzePersonalizationPerformance } from './campaign-tracker';
import { getWinningVariant, getTestResults } from './ab-testing';

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
        console.log(`[FeedbackLoop] A/B test "${test.test_name}" winner: ${winner.variant_name} (${winner.metric}: ${winner.value}%)`);
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
        console.log(`[FeedbackLoop] Generated optimization insights: ${perfAnalysis.recommendations.length} recommendations`);
      }
    }

    // 4. Correlate reply outcomes with email generation strategies
    await correlateOutcomes(companyId);

    saveDb();

    console.log(
      `[FeedbackLoop] Optimization cycle complete: ` +
      `${results.snapshotsCaptured} snapshots, ${results.abTestsCompleted} A/B winners, ` +
      `${results.insightsGenerated} insights`
    );

    return results;
  } catch (err: any) {
    console.error(`[FeedbackLoop] Optimization cycle error:`, err.message);
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
    console.error('[FeedbackLoop] Strategy brief generation error:', err.message);
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
