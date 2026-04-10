// ── BMN Reply Handler ─────────────────────────────────────────
// BMN-specific reply routing logic extracted from enrichment/reply-handler.ts.
// BMN creators always get pushed to the Brand Builder funnel as the primary CTA.

import { BMN_COMPANY_ID, BMN_BRAND_BUILDER_URL } from './config';

/**
 * Check if a company ID belongs to BMN.
 */
export function isBmnCompany(companyId: number): boolean {
  return companyId === BMN_COMPANY_ID;
}

/**
 * Inject BMN-specific Brand Builder goal into conversation goals.
 * The #1 goal is ALWAYS to push creators to the Brand Builder funnel.
 * This is the primary conversion action for all BMN outreach.
 */
export function injectBmnBookingGoal(conversationGoals: string[]): void {
  conversationGoals.push(
    `BRAND BUILDER FUNNEL: The creator seems interested! Your #1 goal is to get them to the Brand Builder funnel. This is where they learn about the opportunity and start building their brand. Share the link naturally and make it feel exciting — something like "Check out how it works here: ${BMN_BRAND_BUILDER_URL}" or "Start building your brand here: ${BMN_BRAND_BUILDER_URL}". Keep it casual and low-pressure. The Brand Builder funnel IS the next step for every interested creator — do NOT suggest booking a call instead. ALWAYS include the Brand Builder link: ${BMN_BRAND_BUILDER_URL}`
  );
}

/**
 * BMN leads should NOT auto-book meetings — creators go through the Brand Builder funnel.
 * Returns true if auto-booking should be skipped for this company.
 */
export function shouldSkipAutoBooking(companyId: number): boolean {
  return isBmnCompany(companyId);
}
