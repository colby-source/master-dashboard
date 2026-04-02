// ── GPC Configuration ─────────────────────────────────────────
// Externalized constants for Granite Park Capital GHL pipeline, stages, and URLs.
// Mirrors the BMN config pattern for clean company separation.

export const GPC_COMPANY_ID = 1;

// GHL Pipeline & Stage IDs (Cold Email Response Pipeline)
export const GPC_PIPELINE_ID = 'hN3fT6V8135hCKJs8oXN';
export const GPC_STAGE_NEW_REPLY = '626aaea5-7a02-4634-a54a-f652fa4e2468';
export const GPC_STAGE_QUALIFIED = '975e30cc-03f6-436b-ac42-0bbf06b01f66';
export const GPC_STAGE_MEETING_SCHEDULED = 'd6e7a458-ac49-42c1-a656-fa002eb924a7';
export const GPC_STAGE_MEETING_COMPLETED = '562069cc-59d7-453f-b9af-dfd101d86337';
export const GPC_STAGE_PROPOSAL_SENT = 'c1061437-b448-45b4-bf14-8017ed6721e1';
export const GPC_STAGE_WON = 'aec87c1a-9f79-4b73-9d91-0224ada21f9c';
export const GPC_STAGE_LOST = '09d39d51-65f5-4a7d-bdcb-c57f49d022da';

// Instantly campaign
export const GPC_INSTANTLY_CAMPAIGN_ID = '2e3af84a-8f6f-4446-981c-f10bb2348216';

// GHL Calendar
export const GPC_CALENDAR_ID = 'HiJ2M2Xnf0ZRbGCFCAgs';

// Monetary value for GHL opportunities ($250K minimum investment)
export const GPC_MONETARY_VALUE = 250000;

// Post-event sequence (yacht events, investor dinners)
export const GPC_POST_EVENT_ENABLED = true;

// Enrichment behavior
export const GPC_ENRICHMENT_ENABLED = true;
export const GPC_REQUIRES_BUSINESS_EMAIL = true;
