import { queryOne, queryAll, runSql, saveDb } from '../../db';
import { ghlService } from '../ghl-service';
import { GhlPipelineStageMap, AnyStageMap, CompanyPipeline } from './types';
import { getCompanyConfig, logEvent } from './helpers';
import { wsServer } from '../../websocket/ws-server';

// ── Pipeline Resolution ────────────────────────────────────────
// Routes leads to the correct GHL pipeline based on company + campaign.
// BMN has two pipelines (Agency Partner Funnel, Creator Investment Funnel)
// routed by Instantly campaign ID. GPC uses the legacy single-pipeline model.

/**
 * Resolve which GHL pipeline a lead should enter based on company + campaign.
 *
 * Lookup order:
 *   1. company_pipelines row matching (company_id, instantly_campaign_id)
 *   2. company_pipelines default row for company (is_default = 1)
 *   3. Legacy enrichment_config.ghl_pipeline_id (backward compat for GPC)
 */
export function resolvePipeline(
  companyId: number,
  campaignId?: string | null
): { pipelineId: string; stages: AnyStageMap; monetaryValue: number; pipelineName: string } | null {
  // 1. Exact campaign match
  if (campaignId) {
    const exact = queryOne(
      'SELECT * FROM company_pipelines WHERE company_id = ? AND instantly_campaign_id = ?',
      [companyId, campaignId]
    ) as CompanyPipeline | null;

    if (exact) {
      return {
        pipelineId: exact.ghl_pipeline_id,
        stages: JSON.parse(exact.stage_map),
        monetaryValue: exact.monetary_value,
        pipelineName: exact.pipeline_name,
      };
    }
  }

  // 2. Default pipeline for company
  const defaultPipeline = queryOne(
    'SELECT * FROM company_pipelines WHERE company_id = ? AND is_default = 1',
    [companyId]
  ) as CompanyPipeline | null;

  if (defaultPipeline) {
    return {
      pipelineId: defaultPipeline.ghl_pipeline_id,
      stages: JSON.parse(defaultPipeline.stage_map),
      monetaryValue: defaultPipeline.monetary_value,
      pipelineName: defaultPipeline.pipeline_name,
    };
  }

  // 3. Legacy fallback: enrichment_config (GPC backward compat)
  return getLegacyPipelineConfig(companyId);
}

/** Legacy single-pipeline config from enrichment_config table. */
function getLegacyPipelineConfig(companyId: number): { pipelineId: string; stages: AnyStageMap; monetaryValue: number; pipelineName: string } | null {
  const cfg = getCompanyConfig(companyId);
  if (!cfg?.ghl_pipeline_id || !cfg?.ghl_pipeline_stages) return null;

  // Per-company monetary value: GPC fund deals ~$250K, BMN creator deals ~$500
  const MONETARY_VALUES: Record<number, number> = { 1: 250000, 2: 500 };
  const monetaryValue = MONETARY_VALUES[companyId] ?? 1000;

  try {
    return {
      pipelineId: cfg.ghl_pipeline_id,
      stages: JSON.parse(cfg.ghl_pipeline_stages),
      monetaryValue,
      pipelineName: 'Cold Email Response Pipeline',
    };
  } catch {
    return null;
  }
}

// ── Legacy Setup (GPC) ────────────────────────────────────────

const GPC_PIPELINE_NAME = 'Cold Email Response Pipeline';

const GPC_EXPECTED_STAGES = [
  'New Reply', 'Qualified', 'Meeting Scheduled', 'Meeting Completed',
  'Proposal Sent', 'Won', 'Lost',
] as const;

const GPC_STAGE_KEY_MAP: Record<string, keyof GhlPipelineStageMap> = {
  'New Reply': 'new_reply',
  'Qualified': 'qualified',
  'Meeting Scheduled': 'meeting_scheduled',
  'Meeting Completed': 'meeting_completed',
  'Proposal Sent': 'proposal_sent',
  'Won': 'won',
  'Lost': 'lost',
};

/**
 * Auto-detect the GPC "Cold Email Response Pipeline" in GHL.
 * Stores in enrichment_config for backward compatibility.
 */
export async function setupColdEmailPipeline(
  companyId: number
): Promise<{ pipelineId: string; stages: GhlPipelineStageMap } | { error: string; instructions: string[] }> {
  const ghlClient = ghlService.getClient(companyId);
  if (!ghlClient) {
    return { error: 'No GHL client configured for this company', instructions: [] };
  }

  const pipelinesData = await ghlClient.getPipelines();
  const pipelines = pipelinesData?.pipelines || [];

  const pipeline = pipelines.find(
    (p: any) => p.name === GPC_PIPELINE_NAME || p.name?.toLowerCase().includes('cold email')
  );

  if (!pipeline) {
    return {
      error: `Pipeline "${GPC_PIPELINE_NAME}" not found in GHL`,
      instructions: [
        'Go to GHL Dashboard → Opportunities → Pipelines',
        `Create a new pipeline named: "${GPC_PIPELINE_NAME}"`,
        `Add these stages in order: ${GPC_EXPECTED_STAGES.join(', ')}`,
        'Then re-run this setup to auto-detect the pipeline and stage IDs',
      ],
    };
  }

  const pipelineStages = pipeline.stages || [];
  const stageMap: Partial<GhlPipelineStageMap> = {};
  const missing: string[] = [];

  for (const expectedName of GPC_EXPECTED_STAGES) {
    const key = GPC_STAGE_KEY_MAP[expectedName];
    const found = pipelineStages.find(
      (s: any) => s.name === expectedName || s.name?.toLowerCase() === expectedName.toLowerCase()
    );
    if (found) {
      stageMap[key] = found.id;
    } else {
      missing.push(expectedName);
    }
  }

  if (missing.length > 0) {
    return {
      error: `Pipeline found but missing stages: ${missing.join(', ')}`,
      instructions: [
        `Open pipeline "${pipeline.name}" in GHL`,
        `Add missing stages: ${missing.join(', ')}`,
        'Then re-run setup',
      ],
    };
  }

  const fullStageMap = stageMap as GhlPipelineStageMap;

  runSql(
    `UPDATE enrichment_config SET ghl_pipeline_id = ?, ghl_pipeline_stages = ? WHERE company_id = ?`,
    [pipeline.id, JSON.stringify(fullStageMap), companyId]
  );
  saveDb();

  logEvent(null, companyId, 'ghl_pipeline_configured', {
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    stages: fullStageMap,
  });

  console.log(`[Pipeline] Configured "${GPC_PIPELINE_NAME}" for company ${companyId}: ${pipeline.id}`);
  return { pipelineId: pipeline.id, stages: fullStageMap };
}

/** @deprecated Use resolvePipeline() instead. Kept for backward compat. */
export function getPipelineConfig(companyId: number): { pipelineId: string; stages: GhlPipelineStageMap } | null {
  const result = getLegacyPipelineConfig(companyId);
  if (!result) return null;
  return { pipelineId: result.pipelineId, stages: result.stages as unknown as GhlPipelineStageMap };
}

// ── Opportunity Creation ──────────────────────────────────────

/**
 * Create a GHL opportunity for a lead, routed to the correct pipeline
 * based on company + campaign ID.
 */
export async function createOpportunity(
  leadId: number,
  ghlContactId: string,
  sentiment: string,
  campaignId?: string | null
): Promise<string | null> {
  const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as any;
  if (!lead) return null;

  // Use campaign from lead if not explicitly passed
  const effectiveCampaignId = campaignId || lead.instantly_campaign_id;

  const pipelineCfg = resolvePipeline(lead.company_id, effectiveCampaignId);
  if (!pipelineCfg) {
    console.warn(`[Pipeline] No pipeline configured for company ${lead.company_id} campaign ${effectiveCampaignId} — skipping`);
    return null;
  }

  const ghlClient = ghlService.getClient(lead.company_id);
  if (!ghlClient) return null;

  // Find the "first" / "new reply" stage — look for common keys
  const stageKeys = Object.keys(pipelineCfg.stages);
  const initialStageKey = sentiment === 'meeting_request'
    ? (stageKeys.find(k => k.includes('booked') || k.includes('scheduled') || k === 'qualified') || stageKeys[0])
    : (stageKeys.find(k => k.includes('reply') || k === 'new_reply' || k === 'positive_reply') || stageKeys[0]);
  const initialStageId = pipelineCfg.stages[initialStageKey];

  // Check for existing opportunity — move it instead of creating a duplicate
  if (lead.ghl_opportunity_id) {
    try {
      await ghlClient.updateOpportunityStage(lead.ghl_opportunity_id, initialStageId);
      logEvent(leadId, lead.company_id, 'ghl_opportunity_stage_updated', {
        opportunityId: lead.ghl_opportunity_id,
        stage: initialStageKey,
        sentiment,
        reason: 'existing_opportunity_moved',
      });
      console.log(`[Pipeline] Moved existing opportunity ${lead.ghl_opportunity_id} → ${initialStageKey} for lead ${leadId}`);
      return lead.ghl_opportunity_id;
    } catch (err: any) {
      console.warn(`[Pipeline] Failed to update existing opp ${lead.ghl_opportunity_id}, creating new: ${err.message}`);
    }
  }

  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Unknown';
  const enrichmentData = lead.enrichment_data ? JSON.parse(lead.enrichment_data) : {};
  const company = enrichmentData.pdl_person?.job_company_name || enrichmentData.pdl_company?.name || '';

  const opportunityName = company
    ? `${name} (${company}) — ${pipelineCfg.pipelineName}`
    : `${name} — ${pipelineCfg.pipelineName}`;

  const opportunity = await ghlClient.createOpportunity({
    pipelineId: pipelineCfg.pipelineId,
    stageId: initialStageId,
    contactId: ghlContactId,
    name: opportunityName,
    monetaryValue: pipelineCfg.monetaryValue,
    status: 'open',
  });

  if (!opportunity?.id) {
    console.error(`[Pipeline] Failed to create opportunity for lead ${leadId}`);
    return null;
  }

  runSql(
    'UPDATE enrichment_leads SET ghl_opportunity_id = ? WHERE id = ?',
    [opportunity.id, leadId]
  );
  saveDb();

  logEvent(leadId, lead.company_id, 'ghl_opportunity_created', {
    opportunityId: opportunity.id,
    pipelineId: pipelineCfg.pipelineId,
    pipelineName: pipelineCfg.pipelineName,
    stageId: initialStageId,
    stageKey: initialStageKey,
    sentiment,
    campaignId: effectiveCampaignId,
  });

  wsServer.broadcast({
    type: 'ghl_opportunity_created',
    leadId,
    opportunityId: opportunity.id,
    pipelineName: pipelineCfg.pipelineName,
  });

  console.log(`[Pipeline] Created opportunity ${opportunity.id} for lead ${leadId} (${name}) in "${pipelineCfg.pipelineName}"`);
  return opportunity.id;
}

/** @deprecated Use createOpportunity() instead */
export async function createColdEmailOpportunity(
  leadId: number,
  ghlContactId: string,
  sentiment: string
): Promise<string | null> {
  return createOpportunity(leadId, ghlContactId, sentiment);
}

// ── Stage Sync ────────────────────────────────────────────────

/**
 * Sync a lead's funnel stage to the appropriate GHL pipeline stage.
 * Works with both legacy GPC stages and BMN stages via flexible key matching.
 */
const FUNNEL_TO_STAGE_KEY: Record<string, string[]> = {
  // GPC stages
  meeting_set: ['meeting_scheduled', 'appt_booked', 'discovery_scheduled'],
  subscription_docs_sent: ['proposal_sent'],
  committed: ['won', 'agreement_signed', 'approved'],
  funded: ['won', 'agreement_signed'],
  // BMN Agency stages
  discovery_call_scheduled: ['discovery_scheduled'],
  discovery_call_completed: ['discovery_completed'],
  agreement_signed: ['agreement_signed'],
  onboarding: ['onboarding'],
  // BMN Creator stages
  application_received: ['application_received'],
  brand_builder_started: ['brand_builder_started'],
  brand_builder_finished: ['brand_builder_finished'],
  manual_review: ['manual_review'],
  approved_for_partnership: ['approved'],
};

export async function syncOpportunityStage(leadId: number, newFunnelStage: string): Promise<void> {
  const candidateKeys = FUNNEL_TO_STAGE_KEY[newFunnelStage];
  if (!candidateKeys) return;

  const lead = queryOne(
    'SELECT company_id, ghl_opportunity_id, instantly_campaign_id FROM enrichment_leads WHERE id = ?',
    [leadId]
  ) as any;
  if (!lead?.ghl_opportunity_id) return;

  const pipelineCfg = resolvePipeline(lead.company_id, lead.instantly_campaign_id);
  if (!pipelineCfg) return;

  // Find first matching stage key in this pipeline's stage map
  const matchedKey = candidateKeys.find(k => pipelineCfg.stages[k]);
  if (!matchedKey) return;

  const targetStageId = pipelineCfg.stages[matchedKey];
  if (!targetStageId) return;

  const ghlClient = ghlService.getClient(lead.company_id);
  if (!ghlClient) return;

  await ghlClient.updateOpportunityStage(lead.ghl_opportunity_id, targetStageId);

  logEvent(leadId, lead.company_id, 'ghl_opportunity_stage_updated', {
    opportunityId: lead.ghl_opportunity_id,
    stage: matchedKey,
    funnelStage: newFunnelStage,
    pipelineName: pipelineCfg.pipelineName,
  });

  console.log(`[Pipeline] Updated opportunity ${lead.ghl_opportunity_id} → ${matchedKey} (lead stage: ${newFunnelStage})`);
}

// ── Lose Opportunity ──────────────────────────────────────────

/**
 * Mark a GHL opportunity as lost (when lead is excluded or not interested).
 * Finds the "lost" / "rejected" stage automatically.
 */
export async function loseOpportunity(leadId: number, reason: string): Promise<void> {
  const lead = queryOne(
    'SELECT company_id, ghl_opportunity_id, instantly_campaign_id FROM enrichment_leads WHERE id = ?',
    [leadId]
  ) as any;
  if (!lead?.ghl_opportunity_id) return;

  const pipelineCfg = resolvePipeline(lead.company_id, lead.instantly_campaign_id);
  if (!pipelineCfg) return;

  const ghlClient = ghlService.getClient(lead.company_id);
  if (!ghlClient) return;

  // Find lost/rejected stage
  const lostStageId = pipelineCfg.stages.lost || pipelineCfg.stages.rejected;
  if (!lostStageId) {
    console.warn(`[Pipeline] No lost/rejected stage found in "${pipelineCfg.pipelineName}"`);
    return;
  }

  await ghlClient.updateOpportunity(lead.ghl_opportunity_id, {
    stageId: lostStageId,
    status: 'lost',
  });

  logEvent(leadId, lead.company_id, 'ghl_opportunity_lost', {
    opportunityId: lead.ghl_opportunity_id,
    reason,
    pipelineName: pipelineCfg.pipelineName,
  });

  console.log(`[Pipeline] Marked opportunity ${lead.ghl_opportunity_id} as lost: ${reason}`);
}

// ── GHL → DB Sync Loop ────────────────────────────────────────

/** Map GHL stage names to internal lead status values. */
const GHL_STAGE_TO_STATUS: Record<string, string> = {
  'new reply': 'replied',
  'qualified': 'qualified',
  'meeting scheduled': 'meeting_set',
  'meeting completed': 'meeting_completed',
  'proposal sent': 'proposal_sent',
  'won': 'committed',
  'lost': 'not_interested',
  // BMN stages
  'discovery scheduled': 'meeting_set',
  'discovery completed': 'meeting_completed',
  'agreement signed': 'committed',
  'onboarding': 'committed',
};

/**
 * Sync GHL opportunity stages back to the local DB.
 * Runs on a schedule (every 15 min) to catch manual stage changes made in GHL.
 */
export async function syncGhlOpportunitiesToDb(): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  // Get all leads with GHL opportunity IDs
  const leadsWithOpps = queryAll(
    `SELECT el.id, el.company_id, el.ghl_opportunity_id, el.status, el.instantly_campaign_id
     FROM enrichment_leads el
     WHERE el.ghl_opportunity_id IS NOT NULL
       AND el.status NOT IN ('not_interested', 'committed', 'funded')
     ORDER BY el.updated_at DESC
     LIMIT 200`
  );

  if (leadsWithOpps.length === 0) return { synced: 0, errors: 0 };

  // Group by company to minimize API calls
  const byCompany: Record<number, typeof leadsWithOpps> = {};
  for (const lead of leadsWithOpps) {
    (byCompany[lead.company_id] ||= []).push(lead);
  }

  for (const [companyIdStr, leads] of Object.entries(byCompany)) {
    const companyId = Number(companyIdStr);
    const ghlClient = ghlService.getClient(companyId);
    if (!ghlClient) continue;

    // Get all pipeline configs for this company
    const pipelineCfg = resolvePipeline(companyId, leads[0]?.instantly_campaign_id);
    if (!pipelineCfg) continue;

    try {
      const oppData = await ghlClient.getOpportunities(pipelineCfg.pipelineId, 200);
      const opportunities = oppData?.opportunities || [];

      // Build lookup: oppId → stage name
      const oppStageMap = new Map<string, { stageName: string; status: string }>();
      for (const opp of opportunities) {
        oppStageMap.set(opp.id, { stageName: opp.pipelineStageId, status: opp.status });
      }

      // Reverse-lookup stage IDs to names
      const stageIdToName = new Map<string, string>();
      for (const [key, stageId] of Object.entries(pipelineCfg.stages)) {
        stageIdToName.set(stageId, key);
      }

      for (const lead of leads) {
        const oppInfo = oppStageMap.get(lead.ghl_opportunity_id);
        if (!oppInfo) continue;

        const stageName = stageIdToName.get(oppInfo.stageName) || '';
        const normalizedStage = stageName.toLowerCase().replace(/_/g, ' ');
        const newStatus = GHL_STAGE_TO_STATUS[normalizedStage];

        if (newStatus && newStatus !== lead.status) {
          runSql(
            `UPDATE enrichment_leads SET status = ?, updated_at = datetime('now') WHERE id = ?`,
            [newStatus, lead.id]
          );
          logEvent(lead.id, companyId, 'ghl_sync_status_update', {
            oldStatus: lead.status,
            newStatus,
            ghlStage: stageName,
            opportunityId: lead.ghl_opportunity_id,
          });
          synced++;
          console.log(`[GhlSync] Lead ${lead.id}: ${lead.status} → ${newStatus} (GHL stage: ${stageName})`);
        }

        // If GHL opportunity is lost but lead isn't marked yet
        if (oppInfo.status === 'lost' && lead.status !== 'not_interested') {
          runSql(
            `UPDATE enrichment_leads SET status = 'not_interested', updated_at = datetime('now') WHERE id = ?`,
            [lead.id]
          );
          synced++;
        }
      }
    } catch (err: any) {
      errors++;
      console.error(`[GhlSync] Error syncing company ${companyId}:`, err.message);
    }
  }

  if (synced > 0) {
    saveDb();
    console.log(`[GhlSync] Synced ${synced} leads from GHL (${errors} errors)`);
  }
  return { synced, errors };
}

// ── Pipeline Admin ────────────────────────────────────────────

/** Get all configured pipelines for a company. */
export function getCompanyPipelines(companyId: number): CompanyPipeline[] {
  return queryAll(
    'SELECT * FROM company_pipelines WHERE company_id = ? ORDER BY is_default DESC, pipeline_name ASC',
    [companyId]
  ) as CompanyPipeline[];
}
