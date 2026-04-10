/**
 * Unit tests for server/services/bmn/reply-handler.ts
 *
 * Tests cover:
 *   1. isBmnCompany() — identity check against BMN_COMPANY_ID (2)
 *   2. injectBmnBookingGoal() — mutation of conversationGoals array
 *   3. shouldSkipAutoBooking() — delegates to isBmnCompany(), drives auto-book gate
 *
 * No mocks required: all three functions are pure (or operate on a caller-owned
 * array) and import only the BMN_COMPANY_ID constant from ./config.
 */

import {
  isBmnCompany,
  injectBmnBookingGoal,
  shouldSkipAutoBooking,
} from '../services/bmn/reply-handler';

// ── isBmnCompany ──────────────────────────────────────────────────────────────

describe('isBmnCompany', () => {
  it('returns true for company ID 2 (BMN_COMPANY_ID)', () => {
    expect(isBmnCompany(2)).toBe(true);
  });

  it('returns false for company ID 1 (GPC)', () => {
    expect(isBmnCompany(1)).toBe(false);
  });

  it('returns false for company ID 0', () => {
    expect(isBmnCompany(0)).toBe(false);
  });

  it('returns false for company ID 3', () => {
    expect(isBmnCompany(3)).toBe(false);
  });

  it('returns false for a negative company ID', () => {
    expect(isBmnCompany(-1)).toBe(false);
  });

  it('returns false for a large arbitrary company ID', () => {
    expect(isBmnCompany(999)).toBe(false);
  });
});

// ── injectBmnBookingGoal ──────────────────────────────────────────────────────

describe('injectBmnBookingGoal', () => {
  it('appends exactly one goal string to an empty array', () => {
    const goals: string[] = [];
    injectBmnBookingGoal(goals);
    expect(goals).toHaveLength(1);
  });

  it('the injected goal contains the BRAND BUILDER FUNNEL header', () => {
    const goals: string[] = [];
    injectBmnBookingGoal(goals);
    expect(goals[0]).toContain('BRAND BUILDER FUNNEL');
  });

  it('the injected goal instructs sharing the Brand Builder funnel link', () => {
    const goals: string[] = [];
    injectBmnBookingGoal(goals);
    expect(goals[0]).toContain('apply.brandmenow.ai/influencer-video-funnel');
  });

  it('the injected goal explicitly forbids suggesting booking a call', () => {
    const goals: string[] = [];
    injectBmnBookingGoal(goals);
    expect(goals[0]).toContain('do NOT suggest booking a call');
  });

  it('appends to a pre-populated goals array without modifying existing entries', () => {
    const existing = 'EXISTING_GOAL';
    const goals: string[] = [existing];
    injectBmnBookingGoal(goals);
    expect(goals).toHaveLength(2);
    expect(goals[0]).toBe(existing);
  });

  it('calling twice appends two goal entries (not idempotent — caller guards dedup)', () => {
    const goals: string[] = [];
    injectBmnBookingGoal(goals);
    injectBmnBookingGoal(goals);
    expect(goals).toHaveLength(2);
    // Both entries should be the same booking goal string
    expect(goals[0]).toBe(goals[1]);
  });

  it('mutates the passed-in array reference (void return)', () => {
    const goals: string[] = [];
    const result = injectBmnBookingGoal(goals);
    expect(result).toBeUndefined();
    // Side effect is on the original reference
    expect(goals).toHaveLength(1);
  });

  it('appended goal string is non-empty', () => {
    const goals: string[] = [];
    injectBmnBookingGoal(goals);
    expect(goals[0].trim().length).toBeGreaterThan(0);
  });
});

// ── shouldSkipAutoBooking ─────────────────────────────────────────────────────

describe('shouldSkipAutoBooking', () => {
  it('returns true for BMN (company ID 2) — creators self-book via link', () => {
    expect(shouldSkipAutoBooking(2)).toBe(true);
  });

  it('returns false for GPC (company ID 1) — standard auto-book flow applies', () => {
    expect(shouldSkipAutoBooking(1)).toBe(false);
  });

  it('returns false for company ID 0', () => {
    expect(shouldSkipAutoBooking(0)).toBe(false);
  });

  it('returns false for company ID 3', () => {
    expect(shouldSkipAutoBooking(3)).toBe(false);
  });

  it('delegates to isBmnCompany — result matches isBmnCompany for all tested IDs', () => {
    const testIds = [0, 1, 2, 3, 99];
    for (const id of testIds) {
      expect(shouldSkipAutoBooking(id)).toBe(isBmnCompany(id));
    }
  });
});
