// ── GPC-Specific Types ────────────────────────────────────────
// Types for Granite Park Capital pipeline operations.

/** GPC Cold Email Response Pipeline stages */
export interface GpcPipelineStageMap {
  new_reply: string;
  qualified: string;
  meeting_scheduled: string;
  meeting_completed: string;
  proposal_sent: string;
  won: string;
  lost: string;
}

/** GPC Fund Stages (enrichment lead lifecycle) */
export const GPC_FUNNEL_STAGES = [
  'pending', 'enriching', 'enriched', 'scored', 'pushed',
  'meeting_set', 'subscription_docs_sent', 'committed', 'funded',
] as const;

export type GpcFunnelStage = typeof GPC_FUNNEL_STAGES[number];
