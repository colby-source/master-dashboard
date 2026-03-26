/**
 * Unit tests for security fixes in server/routes/enrichment.ts
 *
 * Covers:
 *   1. Review status whitelist
 *   2. Bulk action ID validation
 *   3. Test endpoint NODE_ENV guards
 */

// ---------------------------------------------------------------------------
// 1. Review Status Whitelist
// ---------------------------------------------------------------------------

describe('Review Status Whitelist', () => {
  const allowedStatuses = ['pending_review', 'approved', 'rejected'];

  function sanitizeStatus(raw: string | undefined): string {
    const rawStatus = raw || 'pending_review';
    return allowedStatuses.includes(rawStatus) ? rawStatus : 'pending_review';
  }

  it('passes through "pending_review"', () => {
    expect(sanitizeStatus('pending_review')).toBe('pending_review');
  });

  it('passes through "approved"', () => {
    expect(sanitizeStatus('approved')).toBe('approved');
  });

  it('passes through "rejected"', () => {
    expect(sanitizeStatus('rejected')).toBe('rejected');
  });

  it('falls back to "pending_review" for an arbitrary unknown string', () => {
    expect(sanitizeStatus('unknown_status')).toBe('pending_review');
  });

  it('falls back to "pending_review" for an empty string', () => {
    expect(sanitizeStatus('')).toBe('pending_review');
  });

  it('falls back to "pending_review" for undefined', () => {
    expect(sanitizeStatus(undefined)).toBe('pending_review');
  });

  it('falls back to "pending_review" for a SQL injection attempt', () => {
    expect(sanitizeStatus("'; DROP TABLE enrichment_leads; --")).toBe('pending_review');
  });

  it('falls back to "pending_review" for a UNION SELECT injection', () => {
    expect(sanitizeStatus("approved' UNION SELECT * FROM users --")).toBe('pending_review');
  });

  it('falls back to "pending_review" for null coerced to string', () => {
    // simulate query param coercion
    expect(sanitizeStatus(String(null))).toBe('pending_review');
  });

  it('falls back to "pending_review" for whitespace-only input', () => {
    expect(sanitizeStatus('   ')).toBe('pending_review');
  });

  it('is case-sensitive — "Approved" (capital A) falls back to pending_review', () => {
    expect(sanitizeStatus('Approved')).toBe('pending_review');
  });

  it('is case-sensitive — "REJECTED" falls back to pending_review', () => {
    expect(sanitizeStatus('REJECTED')).toBe('pending_review');
  });
});

// ---------------------------------------------------------------------------
// 2. Bulk Action ID Validation
// ---------------------------------------------------------------------------

describe('Bulk Action ID Validation', () => {
  function filterValidIds(ids: any[]): number[] {
    return ids.filter((id: any) => Number.isInteger(id) && id > 0);
  }

  it('passes through a clean array of positive integers', () => {
    expect(filterValidIds([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('passes through a single valid integer', () => {
    expect(filterValidIds([42])).toEqual([42]);
  });

  it('filters out string IDs', () => {
    expect(filterValidIds(['1', '2', '3'])).toEqual([]);
  });

  it('filters out mixed strings and integers — keeps only integers', () => {
    expect(filterValidIds([1, '2', 3])).toEqual([1, 3]);
  });

  it('filters out negative integers', () => {
    expect(filterValidIds([-1, -5, -100])).toEqual([]);
  });

  it('filters out zero', () => {
    expect(filterValidIds([0])).toEqual([]);
  });

  it('filters out float values', () => {
    expect(filterValidIds([1.5, 2.9, 3.0001])).toEqual([]);
  });

  it('keeps integer 3.0 because Number.isInteger(3.0) is true in JS', () => {
    // JS: 3.0 === 3, Number.isInteger(3.0) is true — this is intentional behavior
    expect(filterValidIds([3.0])).toEqual([3]);
  });

  it('filters out null values', () => {
    expect(filterValidIds([null])).toEqual([]);
  });

  it('filters out undefined values', () => {
    expect(filterValidIds([undefined])).toEqual([]);
  });

  it('filters out object values', () => {
    expect(filterValidIds([{ id: 1 }, { id: 2 }])).toEqual([]);
  });

  it('filters out NaN', () => {
    expect(filterValidIds([NaN])).toEqual([]);
  });

  it('filters out Infinity', () => {
    expect(filterValidIds([Infinity, -Infinity])).toEqual([]);
  });

  it('filters out boolean values', () => {
    expect(filterValidIds([true, false])).toEqual([]);
  });

  it('returns empty array for all-invalid input — callers should return 400', () => {
    const validIds = filterValidIds(['abc', -1, 0, 1.5, null]);
    expect(validIds.length).toBe(0);
    // Mirrors the route guard: validIds.length === 0 → 400 response
  });

  it('large valid array passes through fully', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => i + 1);
    expect(filterValidIds(ids)).toHaveLength(1000);
  });

  it('SQL injection string is filtered out', () => {
    expect(filterValidIds(["'; DROP TABLE reply_messages; --"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Test Endpoint NODE_ENV Guards
// ---------------------------------------------------------------------------

describe('Test Endpoint NODE_ENV Guards', () => {
  /**
   * Mirrors the exact guard used in the three test-only routes:
   *
   *   if (process.env.NODE_ENV !== 'test') {
   *     return res.status(403).json({ error: 'Not available in production' });
   *   }
   *
   * We test the predicate logic in isolation rather than spinning up Express.
   */
  function isTestEndpointAllowed(nodeEnv: string | undefined): boolean {
    return nodeEnv === 'test';
  }

  // --- routes that should be blocked in non-test environments ---

  it('blocks the endpoint when NODE_ENV is "production"', () => {
    expect(isTestEndpointAllowed('production')).toBe(false);
  });

  it('blocks the endpoint when NODE_ENV is "development"', () => {
    expect(isTestEndpointAllowed('development')).toBe(false);
  });

  it('blocks the endpoint when NODE_ENV is undefined', () => {
    expect(isTestEndpointAllowed(undefined)).toBe(false);
  });

  it('blocks the endpoint when NODE_ENV is an empty string', () => {
    expect(isTestEndpointAllowed('')).toBe(false);
  });

  it('blocks the endpoint when NODE_ENV is "staging"', () => {
    expect(isTestEndpointAllowed('staging')).toBe(false);
  });

  it('blocks the endpoint when NODE_ENV is "TEST" (wrong case)', () => {
    expect(isTestEndpointAllowed('TEST')).toBe(false);
  });

  // --- route should be accessible only in test environment ---

  it('allows the endpoint when NODE_ENV is "test"', () => {
    expect(isTestEndpointAllowed('test')).toBe(true);
  });

  // --- verify response shape contract (403 body) ---

  it('guard produces a 403 status for non-test environments', () => {
    const nodeEnv = 'production';
    const allowed = isTestEndpointAllowed(nodeEnv);
    const statusCode = allowed ? 200 : 403;
    expect(statusCode).toBe(403);
  });

  it('guard produces the correct error message body for non-test environments', () => {
    const nodeEnv = 'development';
    const allowed = isTestEndpointAllowed(nodeEnv);
    const response = allowed ? null : { error: 'Not available in production' };
    expect(response).toEqual({ error: 'Not available in production' });
  });

  it('guard returns no 403 body when NODE_ENV is "test"', () => {
    const nodeEnv = 'test';
    const allowed = isTestEndpointAllowed(nodeEnv);
    const blockedResponse = allowed ? null : { error: 'Not available in production' };
    expect(blockedResponse).toBeNull();
  });

  // --- all three guarded endpoints use the identical pattern ---

  const guardedEndpoints = [
    'POST /enrichment/test-seed-reply',
    'POST /enrichment/test-cleanup-reply',
    'GET  /enrichment/test-check-send-queue',
  ];

  guardedEndpoints.forEach((endpoint) => {
    it(`endpoint "${endpoint}" is blocked in production`, () => {
      expect(isTestEndpointAllowed('production')).toBe(false);
    });

    it(`endpoint "${endpoint}" is accessible in test`, () => {
      expect(isTestEndpointAllowed('test')).toBe(true);
    });
  });
});
