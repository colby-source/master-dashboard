// ── BMN Reply Handler ─────────────────────────────────────────
// BMN-specific reply routing logic extracted from enrichment/reply-handler.ts.
// BMN creators always get "book a call" CTA — no A/B testing, no slot proposals.

import { BMN_COMPANY_ID } from './config';

/**
 * Check if a company ID belongs to BMN.
 */
export function isBmnCompany(companyId: number): boolean {
  return companyId === BMN_COMPANY_ID;
}

/**
 * Inject BMN-specific meeting booking goal into conversation goals.
 * BMN always uses a self-service booking link — no A/B testing, no variation.
 */
export function injectBmnBookingGoal(conversationGoals: string[]): void {
  conversationGoals.push(
    `MEETING BOOKING: The creator seems interested! Your #1 goal is to get them on a call. Share the booking link and encourage them to pick a time that works. Keep it casual and low-pressure — something like "Would love to walk you through how it works — grab a time here that works for you: [booking link]". Do NOT propose specific times yourself — let them self-schedule via the link.`
  );
}

/**
 * BMN leads should NOT auto-book meetings — creators self-book via link in sequence copy.
 * Returns true if auto-booking should be skipped for this company.
 */
export function shouldSkipAutoBooking(companyId: number): boolean {
  return isBmnCompany(companyId);
}
