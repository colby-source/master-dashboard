/**
 * Unit tests for magic-link-service. Covers:
 *  - Token format (64-char hex, cryptographic strength)
 *  - createMagicLink writes to DB + computes future expiry
 *  - verifyToken rejects malformed / unknown / revoked / expired tokens
 *  - verifyToken accepts valid tokens and increments use_count
 *  - revokeMagicLink writes revoked_at
 *
 * DB is fully mocked so tests run in <50ms with no I/O.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryOne = vi.fn();
const runSql = vi.fn();
const saveDb = vi.fn();

vi.mock('../../../db', () => ({
  queryOne: (...args: unknown[]) => queryOne(...args),
  runSql: (...args: unknown[]) => runSql(...args),
  saveDb: () => saveDb(),
}));

vi.mock('../../../config', () => ({
  config: {
    publicBaseUrl: 'https://dashboard.brandmenow.co/',
    launchpad: { magicLinkTtlDays: 7, fromEmail: 'colby@brandmenow.co' },
  },
}));

// emailService is unused by createMagicLink/verifyToken/revokeMagicLink, but
// the module imports it at top level.
vi.mock('../../email-service', () => ({
  emailService: { sendEmail: vi.fn() },
}));

import { createMagicLink, verifyToken, revokeMagicLink } from '../magic-link-service';

describe('magic-link-service', () => {
  beforeEach(() => {
    queryOne.mockReset();
    runSql.mockReset();
    saveDb.mockReset();
  });

  describe('createMagicLink', () => {
    it('produces a 64-character hex token (256-bit entropy)', () => {
      const link = createMagicLink({ brandId: 'lpb_test1' });
      expect(link.token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns a unique id with mlt_ prefix', () => {
      const link = createMagicLink({ brandId: 'lpb_test1' });
      expect(link.id).toMatch(/^mlt_[0-9a-f]{16}$/);
    });

    it('builds a launchpad URL from publicBaseUrl + token', () => {
      const link = createMagicLink({ brandId: 'lpb_test1' });
      expect(link.url).toBe(`https://dashboard.brandmenow.co/launchpad/${link.token}`);
    });

    it('sets expiresAt 7 days in the future by default', () => {
      const before = Date.now();
      const link = createMagicLink({ brandId: 'lpb_test1' });
      const after = Date.now();
      const expiry = new Date(link.expiresAt).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(expiry).toBeGreaterThanOrEqual(before + sevenDaysMs);
      expect(expiry).toBeLessThanOrEqual(after + sevenDaysMs);
    });

    it('honors custom ttlDays', () => {
      const link = createMagicLink({ brandId: 'lpb_test1', ttlDays: 1 });
      const expiry = new Date(link.expiresAt).getTime();
      const oneDayMs = 24 * 60 * 60 * 1000;
      expect(expiry).toBeGreaterThan(Date.now() + oneDayMs - 1000);
      expect(expiry).toBeLessThan(Date.now() + oneDayMs + 1000);
    });

    it('issues a single INSERT to launchpad_magic_links', () => {
      createMagicLink({ brandId: 'lpb_test1' });
      expect(runSql).toHaveBeenCalledTimes(1);
      const [sql, params] = runSql.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO launchpad_magic_links/i);
      expect(params).toHaveLength(5); // id, brand_id, token, expires_at, issued_by_email
      expect(params[1]).toBe('lpb_test1');
      expect(params[4]).toBeNull(); // issued_by_email defaults to null when not provided
    });

    it('records issued_by_email when supplied', () => {
      createMagicLink({ brandId: 'lpb_test1', issuedByEmail: 'ryan@brandmenow.co' });
      const [, params] = runSql.mock.calls[0];
      expect(params[4]).toBe('ryan@brandmenow.co');
    });

    it('produces unique tokens across calls (no PRNG collision)', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 50; i++) {
        tokens.add(createMagicLink({ brandId: 'lpb_test1' }).token);
      }
      expect(tokens.size).toBe(50);
    });
  });

  describe('verifyToken', () => {
    const validToken = 'a'.repeat(64);
    const futureExpiry = new Date(Date.now() + 60_000).toISOString();
    const pastExpiry = new Date(Date.now() - 60_000).toISOString();

    it('rejects empty / non-string / wrong-length tokens without hitting DB', () => {
      expect(verifyToken('')).toBeNull();
      expect(verifyToken('short')).toBeNull();
      expect(verifyToken('z'.repeat(100))).toBeNull();
      expect(verifyToken(null as unknown as string)).toBeNull();
      expect(verifyToken(undefined as unknown as string)).toBeNull();
      expect(queryOne).not.toHaveBeenCalled();
    });

    it('returns null when token is not in the DB', () => {
      queryOne.mockReturnValueOnce(null);
      expect(verifyToken(validToken)).toBeNull();
      // No UPDATE should be issued for unknown tokens
      expect(runSql).not.toHaveBeenCalled();
    });

    it('returns null and skips UPDATE when token is revoked', () => {
      queryOne.mockReturnValueOnce({
        id: 'mlt_x', brand_id: 'lpb_x',
        expires_at: futureExpiry,
        revoked_at: new Date().toISOString(),
        first_used_at: null, use_count: 0,
      });
      expect(verifyToken(validToken)).toBeNull();
      expect(runSql).not.toHaveBeenCalled();
    });

    it('returns null and skips UPDATE when token is expired', () => {
      queryOne.mockReturnValueOnce({
        id: 'mlt_x', brand_id: 'lpb_x',
        expires_at: pastExpiry,
        revoked_at: null,
        first_used_at: null, use_count: 0,
      });
      expect(verifyToken(validToken)).toBeNull();
      expect(runSql).not.toHaveBeenCalled();
    });

    it('returns brandId/linkId and increments use_count for a valid token', () => {
      queryOne.mockReturnValueOnce({
        id: 'mlt_x', brand_id: 'lpb_x',
        expires_at: futureExpiry,
        revoked_at: null,
        first_used_at: null, use_count: 0,
      });
      const result = verifyToken(validToken);
      expect(result).toEqual({ brandId: 'lpb_x', linkId: 'mlt_x' });
      // 2 writes: the use_count increment + the audit-log redemption row.
      expect(runSql).toHaveBeenCalledTimes(2);
      const [updateSql] = runSql.mock.calls[0];
      expect(updateSql).toMatch(/UPDATE launchpad_magic_links/i);
      expect(updateSql).toMatch(/use_count = use_count \+ 1/);
      const [insertSql] = runSql.mock.calls[1];
      expect(insertSql).toMatch(/INSERT INTO launchpad_magic_link_redemptions/i);
      expect(saveDb).toHaveBeenCalledTimes(1);
    });

    it('records IP and user-agent on the redemption row when ctx is provided', () => {
      queryOne.mockReturnValueOnce({
        id: 'mlt_x', brand_id: 'lpb_x',
        expires_at: futureExpiry,
        revoked_at: null,
        first_used_at: null, use_count: 0,
      });
      verifyToken(validToken, { ip: '203.0.113.42', userAgent: 'TestAgent/1.0' });
      const [sql, params] = runSql.mock.calls[1];
      expect(sql).toMatch(/INSERT INTO launchpad_magic_link_redemptions/i);
      // params: [id, link_id, brand_id, ip, user_agent, redeemed_at]
      expect(params[3]).toBe('203.0.113.42');
      expect(params[4]).toBe('TestAgent/1.0');
    });
  });

  describe('revokeMagicLink', () => {
    it('issues an UPDATE setting revoked_at', () => {
      revokeMagicLink('mlt_test1');
      expect(runSql).toHaveBeenCalledTimes(1);
      const [sql, params] = runSql.mock.calls[0];
      expect(sql).toMatch(/UPDATE launchpad_magic_links SET revoked_at/);
      expect(params[1]).toBe('mlt_test1');
      expect(saveDb).toHaveBeenCalledTimes(1);
    });
  });
});
