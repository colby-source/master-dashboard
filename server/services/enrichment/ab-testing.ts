import { queryOne, queryAll, runSql, saveDb } from '../../db';

// ── A/B Test Assignment ─────────────────────────────────────

/**
 * Assign a lead to a random variant for a given test.
 * Returns the variant config JSON, or null if no active test.
 */
export function assignVariant(testId: number, leadId: number): { variantId: number; variantName: string; config: any } | null {
  const test = queryOne('SELECT * FROM ab_tests WHERE id = ? AND status = ?', [testId, 'active']);
  if (!test) return null;

  // Check if lead already assigned
  const lead = queryOne('SELECT ab_variant FROM enrichment_leads WHERE id = ?', [leadId]);
  if (lead?.ab_variant) {
    try {
      const existing = JSON.parse(lead.ab_variant);
      if (existing.test_id === testId) {
        const variant = queryOne('SELECT * FROM ab_test_variants WHERE id = ?', [existing.variant_id]);
        if (variant) {
          return {
            variantId: variant.id,
            variantName: variant.variant_name,
            config: JSON.parse(variant.config),
          };
        }
      }
    } catch { /* re-assign if corrupt */ }
  }

  // Get all variants for this test
  const variants = queryAll('SELECT * FROM ab_test_variants WHERE test_id = ?', [testId]);
  if (variants.length === 0) return null;

  // Random assignment
  const chosen = variants[Math.floor(Math.random() * variants.length)];

  // Update lead
  const assignment = JSON.stringify({ test_id: testId, variant_id: chosen.id, variant_name: chosen.variant_name });
  runSql("UPDATE enrichment_leads SET ab_variant = ?, updated_at = datetime('now') WHERE id = ?", [assignment, leadId]);

  // Increment leads_assigned
  runSql('UPDATE ab_test_variants SET leads_assigned = leads_assigned + 1 WHERE id = ?', [chosen.id]);
  saveDb();

  return {
    variantId: chosen.id,
    variantName: chosen.variant_name,
    config: JSON.parse(chosen.config),
  };
}

/**
 * Get the active CTA test variant for a lead (convenience wrapper).
 * Finds the first active test of type 'cta_style' for the company and assigns.
 */
export function getActiveCtaVariant(leadId: number, companyId: number): { variantId: number; variantName: string; config: any } | null {
  const test = queryOne(
    "SELECT * FROM ab_tests WHERE company_id = ? AND test_type = 'cta_style' AND status = 'active' LIMIT 1",
    [companyId]
  );
  if (!test) return null;
  return assignVariant(test.id, leadId);
}

// ── Outcome Recording ───────────────────────────────────────

export function recordOutcome(leadId: number, outcome: 'reply' | 'positive_reply' | 'meeting_booked'): void {
  const lead = queryOne('SELECT ab_variant FROM enrichment_leads WHERE id = ?', [leadId]);
  if (!lead?.ab_variant) return;

  let assignment: { variant_id: number };
  try {
    assignment = JSON.parse(lead.ab_variant);
  } catch {
    return;
  }

  const columnMap: Record<string, string> = {
    reply: 'replies_received',
    positive_reply: 'positive_replies',
    meeting_booked: 'meetings_booked',
  };

  const column = columnMap[outcome];
  if (!column) return;

  runSql(`UPDATE ab_test_variants SET ${column} = ${column} + 1 WHERE id = ?`, [assignment.variant_id]);
  saveDb();
}

// ── Results & Statistics ────────────────────────────────────

export function getTestResults(testId: number): {
  test: any;
  variants: {
    id: number;
    variant_name: string;
    description: string;
    leads_assigned: number;
    replies_received: number;
    positive_replies: number;
    meetings_booked: number;
    reply_rate: number;
    positive_rate: number;
    meeting_rate: number;
  }[];
} | null {
  const test = queryOne('SELECT * FROM ab_tests WHERE id = ?', [testId]);
  if (!test) return null;

  const variants = queryAll('SELECT * FROM ab_test_variants WHERE test_id = ? ORDER BY variant_name', [testId]);

  return {
    test,
    variants: variants.map(v => ({
      id: v.id,
      variant_name: v.variant_name,
      description: v.description,
      leads_assigned: v.leads_assigned,
      replies_received: v.replies_received,
      positive_replies: v.positive_replies,
      meetings_booked: v.meetings_booked,
      reply_rate: v.leads_assigned > 0 ? Math.round((v.replies_received / v.leads_assigned) * 1000) / 10 : 0,
      positive_rate: v.leads_assigned > 0 ? Math.round((v.positive_replies / v.leads_assigned) * 1000) / 10 : 0,
      meeting_rate: v.leads_assigned > 0 ? Math.round((v.meetings_booked / v.leads_assigned) * 1000) / 10 : 0,
    })),
  };
}

export function getWinningVariant(testId: number): { variant_name: string; metric: string; value: number } | null {
  const results = getTestResults(testId);
  if (!results || results.variants.length === 0) return null;

  // Need at least 30 leads per variant for meaningful results
  const qualified = results.variants.filter(v => v.leads_assigned >= 30);
  if (qualified.length < 2) return null;

  // Winner by meeting_rate first, then positive_rate, then reply_rate
  const sorted = [...qualified].sort((a, b) => {
    if (b.meeting_rate !== a.meeting_rate) return b.meeting_rate - a.meeting_rate;
    if (b.positive_rate !== a.positive_rate) return b.positive_rate - a.positive_rate;
    return b.reply_rate - a.reply_rate;
  });

  const winner = sorted[0];
  const metric = winner.meeting_rate > 0 ? 'meeting_rate' : winner.positive_rate > 0 ? 'positive_rate' : 'reply_rate';

  return {
    variant_name: winner.variant_name,
    metric,
    value: metric === 'meeting_rate' ? winner.meeting_rate : metric === 'positive_rate' ? winner.positive_rate : winner.reply_rate,
  };
}
