// Re-exports from split modules for backward compatibility.
// All functions that were previously in this file are now in focused modules:
//   - lead-enrichment.ts: Core enrichment logic (enrichLead, deepEnrichWithPdl, etc.)
//   - lead-approval.ts: Cold email approval and GHL push workflow
//   - lead-processing.ts: High-level orchestration and bulk operations

export {
  enrichLead,
  deepEnrichWithPdl,
  reEnrichStale,
  checkKnownContact,
  determineColdEmailStatus,
  importKnownContactsFromGhl,
} from './lead-enrichment';

export {
  approveForColdEmail,
  bulkApproveForColdEmail,
  excludeFromColdEmail,
  retryFailedInstantlyPushes,
  pushToGhl,
  ENRICHMENT_CUSTOM_FIELDS,
  MAX_PUSH_RETRIES,
} from './lead-approval';

export {
  processLead,
  bulkProcessImport,
  advanceLeadStage,
  fastTrackEventAttendees,
  migrateCampaignWithPersonalization,
  FUNNEL_STAGES,
} from './lead-processing';
