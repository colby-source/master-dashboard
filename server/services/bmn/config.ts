// ── BMN Configuration ─────────────────────────────────────────
// Externalized constants for Brand Me Now GHL pipeline, stages, and URLs.
// Previously hardcoded in bmn-followup-cadence.ts.

export const BMN_COMPANY_ID = 2;

// GHL Pipeline & Stage IDs
export const BMN_PIPELINE_ID = 'By4LcF6zNdTaxAC1O8Ad';
export const BMN_STAGE_POSITIVE_REPLY = '75c0a71b-bba7-45fe-abdb-b751317afa30';
export const BMN_STAGE_APPT_BOOKED = '6f44609d-7bf2-426e-ad37-50b83e0a0ac4';
export const BMN_CALENDAR_ID = 'XAwrLg5ivvFQJQZxj5uT';

// URLs
export const BMN_BOOKING_URL = 'https://api.leadconnectorhq.com/widget/bookings/brand-me-now-sales';
export const BMN_BRAND_BUILDER_URL = 'https://apply.brandmenow.ai';

// Cadence settings
export const BMN_MAX_FOLLOWUP_EMAILS = 4;
export const BMN_BATCH_SIZE = 50;

/** Delay between follow-up steps (in hours): immediate, 2 days, 4 days, 7 days */
export const BMN_STEP_DELAYS_HOURS = [0, 48, 96, 168] as const;

/** Minimum days since last Instantly outbound before starting a cadence */
export const BMN_MIN_DAYS_SINCE_OUTBOUND = 3;

/** Emails to permanently skip in discovery (junk contacts, test data) */
export const BMN_SKIP_EMAILS = new Set([
  'example@gmail.com',
]);
