import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { pdlClient } from '../pdl-client';
import { millionverifierClient } from '../millionverifier-client';
import { instantlyService } from '../instantly-service';
import { wsServer } from '../../websocket/ws-server';
import { EnrichmentLead } from './types';
import { getCompanyConfig, updateLead, logEvent } from './helpers';
import { scoreLead } from './scoring';
import { syncOpportunityStage } from './opportunity-pipeline';
import { claudeService } from '../claude-service';
import { generateEmailSequence, sequenceToCustomVariables } from './email-generator';
import { createAlert } from '../alert-service';
import { BMN_COMPANY_ID } from '../bmn/config';
import { enrichLead, deepEnrichWithPdl } from './lead-enrichment';
import { pushToGhl, approveForColdEmail } from './lead-approval';
import { classifySegment, segmentPdlGate, segmentAllowsAutoApproval } from './segment-router';
import { generatePersonalizationHook } from './personalization-hook';
import { createLogger } from '../../utils/logger';
const log = createLogger('lead-processing');

/** Valid funnel stages in order of progression. */
export const FUNNEL_STAGES = [
  'pending',
  'enriching',
  'enriched',
  'scored',
  'pushed',
  'meeting_set',
  'subscription_docs_sent',
  'committed',
  'funded',
] as const;

export async function processLead(leadId: number): Promise<boolean> {
  // BMN NEVER runs through the enrichment pipeline
  const checkLead = queryOne('SELECT company_id FROM enrichment_leads WHERE id = ?', [leadId]);
  if (checkLead?.company_id === BMN_COMPANY_ID) {
    log.info(`[Enrichment] Skipping processLead for BMN lead ${leadId}`);
    return false;
  }

  const enriched = await enrichLead(leadId);
  if (!enriched) return false;

  const scored = await scoreLead(leadId);
  if (!scored) return false;

  // Gated deep-enrich: PDL threshold is now segment-aware.
  //   FAMILY_OFFICE: 60, HNW_INDIVIDUAL: 65, OPERATOR_ADJACENT: 75, STANDARD_B2B: 80, GATEKEEPER: never.
  // Shifts spend toward segments where PDL data actually converts.
  const scoredLead = queryOne('SELECT score, company_id, segment, email FROM enrichment_leads WHERE id = ?', [leadId]) as { score: number; company_id: number; segment: string | null; email: string | null } | null;
  if (scoredLead && pdlClient.available) {
    const segment = scoredLead.segment ?? classifySegment({ company_id: scoredLead.company_id, email: scoredLead.email });
    const pdlGate = segmentPdlGate(segment as any);
    if (pdlGate !== null && scoredLead.score >= pdlGate) {
      log.info(`[Enrichment] PDL gate passed for lead ${leadId} (score ${scoredLead.score} >= ${pdlGate} for ${segment})`);
      await deepEnrichWithPdl(leadId);
      // Re-score with deeper data for more accurate classification
      await scoreLead(leadId);
    }
  }

  // ── Generate personalization hook (ready-to-send subject + opener) ──
  // Uses Claude Haiku (~$0.001) against the full enrichment blob. Highest-ROI output for FO/HNW.
  if (scoredLead && scoredLead.score >= 50) {
    try {
      const freshLead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
      const enrichmentData = freshLead?.enrichment_data ? JSON.parse(freshLead.enrichment_data) : {};
      const playbook = queryOne('SELECT company_description, value_propositions FROM company_playbooks WHERE company_id = ?', [scoredLead.company_id]) as { company_description?: string; value_propositions?: string } | null;
      const senderContext = playbook
        ? [playbook.company_description, playbook.value_propositions].filter(Boolean).join(' — ')
        : undefined;
      await generatePersonalizationHook({
        lead_id: leadId,
        segment: (scoredLead.segment ?? 'STANDARD_B2B') as any,
        enrichment_data: enrichmentData,
        company_id: scoredLead.company_id,
        sender_context: senderContext,
      });
    } catch (err: any) {
      log.warn(`[Enrichment] Personalization hook generation failed for lead ${leadId}: ${err.message}`);
    }
  }

  // Auto-push to GHL if enabled
  if (scoredLead) {
    const companyConfig = getCompanyConfig(scoredLead.company_id);
    if (companyConfig?.auto_push_ghl) {
      await pushToGhl(leadId);
    }

    // Auto-approve for cold email if lead qualifies.
    // Gated by segment: FAMILY_OFFICE and HNW_INDIVIDUAL NEVER auto-approve (manual review only).
    if (companyConfig?.default_campaign_id) {
      const threshold = companyConfig.auto_approve_threshold || 70;
      const freshLead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
      const freshSegment = (freshLead as any)?.segment ?? 'STANDARD_B2B';
      const segmentOK = segmentAllowsAutoApproval(freshSegment);
      if (!segmentOK && freshLead) {
        logEvent(leadId, scoredLead.company_id, 'auto_approve_skipped_by_segment', {
          segment: freshSegment,
          score: freshLead.score,
        });
      }
      if (segmentOK && freshLead && freshLead.score !== null && freshLead.score >= threshold
        && freshLead.instantly_push_status === 'awaiting_approval'
        && !freshLead.is_known_contact) {
        // Verify email is not invalid
        const enrichmentData = freshLead.enrichment_data ? (() => { try { return JSON.parse(freshLead.enrichment_data); } catch { return {}; } })() : {};
        const emailInvalid = enrichmentData.email_verify
          ? millionverifierClient.isInvalid(enrichmentData.email_verify)
          : false;

        if (!emailInvalid) {
          await approveForColdEmail(leadId, companyConfig.default_campaign_id);
          logEvent(leadId, scoredLead.company_id, 'auto_approved_cold_email', {
            score: freshLead.score,
            threshold,
            campaign_id: companyConfig.default_campaign_id,
          });
        }
      }
    }

    // ── LinkedIn outreach for hot leads ──────────────────────────
    const liLead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
    if (liLead && liLead.score !== null && liLead.score >= (companyConfig?.score_threshold_hot || 80)) {
      const liEnrichData = liLead.enrichment_data ? (() => { try { return JSON.parse(liLead.enrichment_data); } catch { return {}; } })() : {};
      const linkedInUrl = liEnrichData.linkedin_url
        || liEnrichData.apollo_person?.linkedin_url
        || liEnrichData.pdl_person?.linkedin_url
        || liEnrichData.linkedin_profile?.url
        || '';

      if (linkedInUrl && liLead.linkedin_outreach_status === 'none') {
        try {
          const playbook = queryOne('SELECT * FROM company_playbooks WHERE company_id = ?', [liLead.company_id]);
          const message = await claudeService.generateLinkedInMessage(liEnrichData, {
            company_description: playbook?.company_description,
            value_propositions: playbook?.value_propositions,
            target_icp: playbook?.target_icp,
            tone: playbook?.tone,
          });

          updateLead(leadId, {
            linkedin_outreach_status: 'queued',
            linkedin_message: message,
          });

          logEvent(leadId, liLead.company_id, 'linkedin_outreach_queued', {
            score: liLead.score,
            linkedin_url: linkedInUrl,
            message_preview: message.slice(0, 100),
          });

          wsServer.broadcast({
            type: 'enrichment_update',
            leadId,
            linkedin_outreach_status: 'queued',
          });

          log.info(`[Enrichment] Lead ${leadId} (${liLead.first_name} ${liLead.last_name}) queued for LinkedIn outreach — score ${liLead.score}`);
        } catch (err: any) {
          log.error(`[Enrichment] LinkedIn message generation failed for lead ${leadId}:`, err.message);
        }
      }
    }
  }

  return true;
}

export async function bulkProcessImport(
  importId: number,
  leadIds: number[],
  targetCampaignId?: string
): Promise<void> {
  const batchSize = 5;
  let processedCount = 0;

  for (let i = 0; i < leadIds.length; i += batchSize) {
    // Check if cancelled
    const importRecord = queryOne('SELECT status FROM bulk_imports WHERE id = ?', [importId]);
    if (importRecord?.status === 'cancelled') {
      wsServer.broadcast({ type: 'bulk_import_cancelled', import_id: importId, processed: processedCount });
      return;
    }

    const batch = leadIds.slice(i, i + batchSize);

    for (const leadId of batch) {
      try {
        await processLead(leadId);

        // If target campaign specified, auto-approve for cold email
        if (targetCampaignId) {
          const lead = queryOne('SELECT instantly_push_status FROM enrichment_leads WHERE id = ?', [leadId]);
          if (lead?.instantly_push_status === 'awaiting_approval') {
            await approveForColdEmail(leadId, targetCampaignId);
          }
        }
      } catch (err: any) {
        log.error(`[BulkImport] Failed to process lead ${leadId}:`, err.message);
      }

      processedCount++;

      // Update import record
      runSql(
        `UPDATE bulk_imports SET processed_count = ?, updated_at = datetime('now') WHERE id = ?`,
        [processedCount, importId]
      );
      saveDb();

      // Broadcast progress
      wsServer.broadcast({
        type: 'bulk_import_progress',
        import_id: importId,
        processed: processedCount,
        total: leadIds.length,
        percent: Math.round((processedCount / leadIds.length) * 100),
      });
    }

    // Small delay between batches to respect rate limits
    if (i + batchSize < leadIds.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Mark complete
  runSql(
    `UPDATE bulk_imports SET status = 'complete', processed_count = ?, updated_at = datetime('now') WHERE id = ?`,
    [processedCount, importId]
  );
  saveDb();

  wsServer.broadcast({
    type: 'bulk_import_complete',
    import_id: importId,
    processed: processedCount,
    total: leadIds.length,
  });
}

/**
 * Advance a lead to a new funnel stage. Validates the stage name
 * and logs the transition.
 */
export function advanceLeadStage(leadId: number, newStage: string): boolean {
  if (!FUNNEL_STAGES.includes(newStage as any)) {
    return false;
  }

  const lead = queryOne('SELECT id, company_id, status FROM enrichment_leads WHERE id = ?', [leadId]);
  if (!lead) return false;

  const oldStage = lead.status;
  updateLead(leadId, { status: newStage });
  logEvent(leadId, lead.company_id, 'stage_advanced', { from: oldStage, to: newStage });
  saveDb();

  wsServer.broadcast({ type: 'enrichment_update', leadId, status: newStage, previousStatus: oldStage });

  // Sync GHL opportunity stage (async, non-blocking)
  syncOpportunityStage(leadId, newStage).catch(err => {
    log.error(`[Pipeline] Failed to sync opportunity stage for lead ${leadId}:`, err.message);
  });

  return true;
}

/**
 * Fast-track processing for high-value event attendees.
 * - Tags each lead as 'event_attendee'
 * - Enriches + scores via processLead
 * - Auto-approves for cold email (skips manual approval)
 * - Auto-pushes to GHL regardless of config
 * - Sets referral_source to the event name
 */
export async function fastTrackEventAttendees(
  companyId: number,
  leadIds: number[],
  eventName: string,
  targetCampaignId?: string
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  for (const leadId of leadIds) {
    try {
      const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ? AND company_id = ?', [leadId, companyId]);
      if (!lead) { failed++; continue; }

      // Tag as event attendee and set referral source
      const existingTags: string[] = lead.tags ? (() => { try { return JSON.parse(lead.tags); } catch { return []; } })() : [];
      if (!existingTags.includes('event_attendee')) existingTags.push('event_attendee');
      if (eventName && !existingTags.includes(eventName)) existingTags.push(eventName);

      updateLead(leadId, {
        tags: JSON.stringify(existingTags),
        referral_source: eventName,
      });

      // Full enrich + score pipeline
      const ok = await processLead(leadId);
      if (!ok) { failed++; continue; }

      // Auto-push to GHL (bypass config check)
      await pushToGhl(leadId);

      // Auto-approve for cold email if campaign specified
      if (targetCampaignId) {
        const updated = queryOne('SELECT instantly_push_status FROM enrichment_leads WHERE id = ?', [leadId]);
        if (updated?.instantly_push_status === 'awaiting_approval') {
          await approveForColdEmail(leadId, targetCampaignId);
        }
      }

      logEvent(leadId, companyId, 'fast_track_complete', { event: eventName });
      processed++;
    } catch (err: any) {
      log.error(`[FastTrack] Failed lead ${leadId}:`, err.message);
      failed++;
    }
  }

  if (processed > 0) {
    createAlert('enrichment', 'info', `Fast-tracked ${processed} event attendees from "${eventName}"`, 'enrichment-service');
    saveDb();
  }

  wsServer.broadcast({
    type: 'fast_track_complete',
    event: eventName,
    processed,
    failed,
    total: leadIds.length,
  });

  return { processed, failed };
}

/**
 * Migrate all leads from one Instantly campaign to another, generating
 * Claude-personalized email sequences for each lead along the way.
 *
 * Processes in batches to respect rate limits. Emits WebSocket progress updates.
 */
export async function migrateCampaignWithPersonalization(
  fromCampaignId: string,
  toCampaignId: string,
  companyId: number,
  opts?: { batchSize?: number; delayMs?: number },
): Promise<{ migrated: number; failed: number; skipped: number; total: number }> {
  const batchSize = opts?.batchSize ?? 10;
  const delayMs = opts?.delayMs ?? 2000; // 2s between batches to respect Claude rate limits

  // Get all leads currently pushed to the old campaign
  const leads = queryAll(
    `SELECT id, email, first_name, last_name, enrichment_data, score, score_label, source
     FROM enrichment_leads
     WHERE company_id = ? AND instantly_campaign_id = ? AND instantly_push_status = 'pushed'
     ORDER BY id ASC`,
    [companyId, fromCampaignId],
  );

  const total = leads.length;
  let migrated = 0;
  let failed = 0;
  let skipped = 0;

  log.info(`[Migration] Starting campaign migration: ${total} leads from ${fromCampaignId} → ${toCampaignId}`);
  wsServer.broadcast({ type: 'migration_started', fromCampaignId, toCampaignId, total });

  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize);

    const batchPromises = batch.map(async (lead) => {
      try {
        const enrichmentData = lead.enrichment_data ? JSON.parse(lead.enrichment_data) : {};
        const personalizations = enrichmentData.personalizations || {};
        const ap = enrichmentData.apollo_person;
        const pp = enrichmentData.pdl_person;
        const ao = enrichmentData.apollo_org;
        const pc = enrichmentData.pdl_company;

        // Generate personalized email sequence via Claude
        let emailSequence = null;
        if (claudeService.available) {
          try {
            emailSequence = await generateEmailSequence(lead.id, companyId);
          } catch (err: any) {
            log.warn(`[Migration] Email generation failed for lead ${lead.id}: ${err.message}`);
          }
        }

        if (!emailSequence || emailSequence.steps.length < 3) {
          log.warn(`[Migration] Skipping lead ${lead.id} — no personalized sequence generated`);
          skipped++;
          return;
        }

        // Build custom variables with full personalized bodies
        const customVars = sequenceToCustomVariables(emailSequence, {
          score: lead.score,
          score_label: lead.score_label,
          job_title: ap?.title || pp?.job_title || '',
          company: ap?.organization_name || pp?.job_company_name || '',
          industry: ap?.organization_industry || pp?.industry || '',
          source: lead.source,
          opener: personalizations.opener || '',
          pain_point: personalizations.painPoint || '',
          cta: personalizations.cta || '',
        });

        // Push to new campaign
        const result = await instantlyService.addLeadsToCampaign(toCampaignId, [{
          email: lead.email,
          first_name: lead.first_name || undefined,
          last_name: lead.last_name || undefined,
          company_name: ap?.organization_name || ao?.name || pp?.job_company_name || pc?.name || undefined,
          custom_variables: customVars,
        }]);

        if (result) {
          // Update DB to point to new campaign
          const updatedData = { ...enrichmentData, generated_email_sequence: emailSequence };
          updateLead(lead.id, {
            instantly_campaign_id: toCampaignId,
            enrichment_data: JSON.stringify(updatedData),
          });
          logEvent(lead.id, companyId, 'campaign_migrated', {
            from: fromCampaignId,
            to: toCampaignId,
            personalized: true,
            strategy: emailSequence.strategy,
          });
          migrated++;
        } else {
          failed++;
        }
      } catch (err: any) {
        log.error(`[Migration] Lead ${lead.id} error:`, err.message);
        failed++;
      }
    });

    await Promise.all(batchPromises);
    saveDb();

    // Progress update
    const progress = Math.min(i + batchSize, total);
    log.info(`[Migration] Progress: ${progress}/${total} (migrated=${migrated}, failed=${failed}, skipped=${skipped})`);
    wsServer.broadcast({
      type: 'migration_progress',
      progress,
      total,
      migrated,
      failed,
      skipped,
    });

    // Rate limit pause between batches
    if (i + batchSize < leads.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  log.info(`[Migration] Complete: ${migrated} migrated, ${failed} failed, ${skipped} skipped out of ${total}`);
  wsServer.broadcast({ type: 'migration_complete', migrated, failed, skipped, total });

  return { migrated, failed, skipped, total };
}
