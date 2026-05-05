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
 * Positioning: BMN is a creator investment fund, not a service provider.
 * The #1 goal is ALWAYS to push creators to the Brand Builder funnel.
 */
export function injectBmnBookingGoal(conversationGoals: string[]): void {
  conversationGoals.push(
    `BRAND BUILDER FUNNEL: The creator is interested. You are an investor who believes in this creator — act like it. Your #1 goal is to get them to the Brand Builder funnel where they can see exactly what we would build for them. Frame it as: "We put together a breakdown of what your brand would look like — check it out here: ${BMN_BRAND_BUILDER_URL}". Make them feel selected, not sold to. This is an investment opportunity for them, not a product pitch. ALWAYS include the Brand Builder link: ${BMN_BRAND_BUILDER_URL}. Do NOT suggest booking a call — the funnel IS the next step.`
  );
}

/**
 * BMN leads should NOT auto-book meetings — creators go through the Brand Builder funnel.
 * Returns true if auto-booking should be skipped for this company.
 */
export function shouldSkipAutoBooking(companyId: number): boolean {
  return isBmnCompany(companyId);
}
