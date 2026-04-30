/**
 * Unit tests for catalog-service. Covers:
 *  - list() / listCategories() build correct SQL with filters
 *  - getById() returns null on miss
 *  - refresh() degrades gracefully when PLDS root is missing (no crash)
 *  - rowToCatalogItem mapping handles 0/1 boolean columns + JSON metadata
 *
 * fs and xlsx are mocked so tests don't read real spreadsheets.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryAll = vi.fn();
const queryOne = vi.fn();
const runSql = vi.fn();
const saveDb = vi.fn();
const fsExistsSync = vi.fn();

vi.mock('../../../db', () => ({
  queryAll: (...args: unknown[]) => queryAll(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
  runSql: (...args: unknown[]) => runSql(...args),
  saveDb: () => saveDb(),
}));

vi.mock('../../../config', () => ({
  config: {
    launchpad: {
      pldsRoot: '/nonexistent/plds/root',
      pldsRefreshHours: 24,
      shopifyShopDomain: 'brandmenow.shop',
    },
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: { ...actual, existsSync: (...args: unknown[]) => fsExistsSync(...args) },
    existsSync: (...args: unknown[]) => fsExistsSync(...args),
  };
});

import { catalogService } from '../catalog-service';

describe('catalog-service', () => {
  beforeEach(() => {
    queryAll.mockReset();
    queryOne.mockReset();
    runSql.mockReset();
    saveDb.mockReset();
    fsExistsSync.mockReset();
  });

  describe('list', () => {
    it('returns mapped rows (booleans hydrated, JSON parsed)', () => {
      queryAll.mockReturnValueOnce([
        {
          id: 'cat_a', catalog_source: 'skincare', supplier_name: 'Printify',
          category: 'Serum', product_name: 'Vitamin Boost Serum', size_or_volume: '1 fl oz',
          total_landed_cost: 18.04, msrp_usd: 26, gross_profit_usd: 7.96, gross_margin_pct: 30.6,
          influencer_payout_25_usd: 6.5, bmn_net_usd: 1.46, bmn_net_pct: 5.6,
          moq: 1, moq_notes: null,
          label_on_demand: 1, ships_2_3_days: 1,
          requires_compliance_review: 0, compliance_notes: null,
          raw_metadata: '{"source":"PLDS"}',
          source_synced_at: 't', created_at: 't',
        },
      ]);

      const items = catalogService.list();
      expect(items).toHaveLength(1);
      expect(items[0].labelOnDemand).toBe(true);
      expect(items[0].ships2to3Days).toBe(true);
      expect(items[0].requiresComplianceReview).toBe(false);
      expect(items[0].rawMetadata).toEqual({ source: 'PLDS' });
    });

    it('builds WHERE clauses for source + category + minMargin filters', () => {
      queryAll.mockReturnValueOnce([]);
      catalogService.list({
        source: 'supplements', category: 'Vitamin',
        minMarginPct: 30, requiresCompliance: true, search: 'protein',
      });
      const [sql, params] = queryAll.mock.calls[0];
      expect(sql).toMatch(/catalog_source = \?/);
      expect(sql).toMatch(/category/i);
      expect(sql).toMatch(/gross_margin_pct >= \?/);
      expect(sql).toMatch(/requires_compliance_review = \?/);
      expect(sql).toMatch(/product_name.*LIKE/);
      expect(params).toContain('supplements');
      expect(params).toContain(30);
      expect(params).toContain(1); // requiresCompliance true → 1
      expect(params).toContain('%protein%');
    });

    it('emulates NULLS LAST on bmn_net_pct + gross_margin_pct ordering', () => {
      queryAll.mockReturnValueOnce([]);
      catalogService.list();
      const [sql] = queryAll.mock.calls[0];
      // sql.js doesn't support NULLS LAST — must use IS NULL trick instead
      expect(sql).not.toMatch(/NULLS LAST/i);
      expect(sql).toMatch(/\(bmn_net_pct IS NULL\) ASC/);
    });

    it('caps limit at 200 by default', () => {
      queryAll.mockReturnValueOnce([]);
      catalogService.list();
      const [, params] = queryAll.mock.calls[0];
      const limitParam = (params as unknown[])[(params as unknown[]).length - 2];
      expect(limitParam).toBe(200);
    });
  });

  describe('listCategories', () => {
    it('returns distinct non-null categories', () => {
      queryAll.mockReturnValueOnce([
        { category: 'Serum' }, { category: 'Cleanser' }, { category: 'Moisturizer' },
      ]);
      expect(catalogService.listCategories()).toEqual(['Serum', 'Cleanser', 'Moisturizer']);
      const [sql] = queryAll.mock.calls[0];
      expect(sql).toMatch(/SELECT DISTINCT category/);
      expect(sql).toMatch(/category IS NOT NULL/);
    });

    it('scopes to a specific source when provided', () => {
      queryAll.mockReturnValueOnce([{ category: 'Vitamin' }]);
      catalogService.listCategories('supplements');
      const [sql, params] = queryAll.mock.calls[0];
      expect(sql).toMatch(/catalog_source = \?/);
      expect(params).toEqual(['supplements']);
    });
  });

  describe('getById', () => {
    it('returns null when row is missing', () => {
      queryOne.mockReturnValueOnce(null);
      expect(catalogService.getById('cat_unknown')).toBeNull();
    });
  });

  describe('refresh', () => {
    it('returns ok:false with an error when PLDS root is missing (does not throw)', async () => {
      fsExistsSync.mockReturnValue(false);
      const result = await catalogService.refresh();
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/PLDS root not found/);
    });

    it('does not write to bmn_catalog when root is missing', async () => {
      fsExistsSync.mockReturnValue(false);
      await catalogService.refresh();
      // No DELETE/INSERT should fire for any source
      const writes = runSql.mock.calls.filter(([sql]) =>
        /DELETE FROM bmn_catalog|INSERT INTO bmn_catalog/i.test(sql as string),
      );
      expect(writes).toHaveLength(0);
    });
  });
});
