// Backward-compatible re-export from modularized enrichment service.
// All logic now lives in ./enrichment/ subdirectory.
export { enrichmentService } from './enrichment';
export type { EnrichmentLead, HandleReplyResult } from './enrichment';
