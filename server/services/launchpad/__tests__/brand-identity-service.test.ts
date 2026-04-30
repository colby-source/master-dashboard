/**
 * Unit tests for brand-identity-service. Covers:
 *  - getByBrandId returns null when no row exists
 *  - upsert creates a row with only the patch fields when none exists
 *  - upsert updates only patch fields, preserving prior values
 *  - JSON columns (brandHandles, hubContentMix, ghlWorkflowIds) round-trip
 *  - Brand SKU CRUD (add / list / remove / replace)
 *
 * DB is fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryAll = vi.fn();
const queryOne = vi.fn();
const runSql = vi.fn();
const saveDb = vi.fn();

vi.mock('../../../db', () => ({
  queryAll: (...args: unknown[]) => queryAll(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
  runSql: (...args: unknown[]) => runSql(...args),
  saveDb: () => saveDb(),
}));

import { brandIdentityService } from '../brand-identity-service';

describe('brand-identity-service', () => {
  beforeEach(() => {
    queryAll.mockReset();
    queryOne.mockReset();
    runSql.mockReset();
    saveDb.mockReset();
  });

  describe('getByBrandId', () => {
    it('returns null when no row exists', () => {
      queryOne.mockReturnValueOnce(null);
      expect(brandIdentityService.getByBrandId('lpb_x')).toBeNull();
    });

    it('hydrates JSON columns into objects', () => {
      queryOne.mockReturnValueOnce({
        brand_id: 'lpb_x',
        brand_handles: '{"instagram":"@quinn","tiktok":"@quinn"}',
        primary_color: '#1AE7F6',
        secondary_color: null, accent_color: null,
        logo_drive_file_id: null, brand_kit_drive_url: null,
        brand_bio_text: null, bio_link_url: null, bio_link_slug: null,
        founder_story_reel_script: null, founder_story_reel_drive_url: null,
        hub_post_cadence: null, spoke_post_cadence: null,
        hub_content_mix: '{"ugc":0.4,"education":0.25}',
        shopify_collection_id: null, shopify_collection_handle: null, shopify_storefront_url: null,
        tiktok_shop_status: 'pending', amazon_brand_registry_status: 'pending',
        ghl_pipeline_id: null, ghl_workflow_ids: null, ghl_sms_number: null,
        created_at: '2026-04-30T00:00:00Z', updated_at: '2026-04-30T00:00:00Z',
      });
      const id = brandIdentityService.getByBrandId('lpb_x');
      expect(id?.brandHandles).toEqual({ instagram: '@quinn', tiktok: '@quinn' });
      expect(id?.hubContentMix).toEqual({ ugc: 0.4, education: 0.25 });
      expect(id?.primaryColor).toBe('#1AE7F6');
    });
  });

  describe('upsert', () => {
    it('creates an INSERT when no row exists', () => {
      // First call: getByBrandId → null. Second: getByBrandId → newly inserted.
      queryOne
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({
          brand_id: 'lpb_x',
          brand_handles: null,
          primary_color: '#1AE7F6',
          secondary_color: null, accent_color: null,
          logo_drive_file_id: null, brand_kit_drive_url: null,
          brand_bio_text: null, bio_link_url: null, bio_link_slug: null,
          founder_story_reel_script: null, founder_story_reel_drive_url: null,
          hub_post_cadence: null, spoke_post_cadence: null, hub_content_mix: null,
          shopify_collection_id: null, shopify_collection_handle: null, shopify_storefront_url: null,
          tiktok_shop_status: 'pending', amazon_brand_registry_status: 'pending',
          ghl_pipeline_id: null, ghl_workflow_ids: null, ghl_sms_number: null,
          created_at: '2026-04-30T00:00:00Z', updated_at: '2026-04-30T00:00:00Z',
        });

      brandIdentityService.upsert('lpb_x', { primaryColor: '#1AE7F6' });

      const insertCall = runSql.mock.calls.find(([sql]) => /INSERT/i.test(sql as string));
      expect(insertCall).toBeDefined();
      expect(insertCall![0]).toMatch(/INSERT INTO launchpad_brand_identity/);
      // INSERT lists brand_id + updated_at + just the one patch field
      expect(insertCall![0]).toMatch(/primary_color/);
      expect(insertCall![0]).not.toMatch(/secondary_color/);
    });

    it('issues an UPDATE that only sets columns explicitly on the patch', () => {
      const existing = {
        brand_id: 'lpb_x',
        brand_handles: '{"instagram":"@quinn"}',
        primary_color: '#1AE7F6',
        secondary_color: '#016F74', accent_color: null,
        logo_drive_file_id: null, brand_kit_drive_url: null,
        brand_bio_text: null, bio_link_url: null, bio_link_slug: null,
        founder_story_reel_script: null, founder_story_reel_drive_url: null,
        hub_post_cadence: null, spoke_post_cadence: null, hub_content_mix: null,
        shopify_collection_id: null, shopify_collection_handle: null, shopify_storefront_url: null,
        tiktok_shop_status: 'pending', amazon_brand_registry_status: 'pending',
        ghl_pipeline_id: null, ghl_workflow_ids: null, ghl_sms_number: null,
        created_at: '2026-04-30T00:00:00Z', updated_at: '2026-04-30T00:00:00Z',
      };
      queryOne.mockReturnValue(existing);

      brandIdentityService.upsert('lpb_x', { primaryColor: '#FF0000' });

      const updateCall = runSql.mock.calls.find(([sql]) => /UPDATE/i.test(sql as string));
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).toMatch(/UPDATE launchpad_brand_identity/);
      expect(updateCall![0]).toMatch(/primary_color = \?/);
      // Critical: secondary_color was NOT in the patch, so it must NOT appear in SET
      expect(updateCall![0]).not.toMatch(/secondary_color = \?/);
      expect(updateCall![0]).not.toMatch(/brand_handles = \?/);
    });

    it('serializes JSON columns when patch includes brandHandles', () => {
      queryOne.mockReturnValueOnce(null).mockReturnValueOnce({
        brand_id: 'lpb_x', brand_handles: '{"tiktok":"@x"}',
        primary_color: null, secondary_color: null, accent_color: null,
        logo_drive_file_id: null, brand_kit_drive_url: null,
        brand_bio_text: null, bio_link_url: null, bio_link_slug: null,
        founder_story_reel_script: null, founder_story_reel_drive_url: null,
        hub_post_cadence: null, spoke_post_cadence: null, hub_content_mix: null,
        shopify_collection_id: null, shopify_collection_handle: null, shopify_storefront_url: null,
        tiktok_shop_status: 'pending', amazon_brand_registry_status: 'pending',
        ghl_pipeline_id: null, ghl_workflow_ids: null, ghl_sms_number: null,
        created_at: 't', updated_at: 't',
      });

      brandIdentityService.upsert('lpb_x', { brandHandles: { tiktok: '@x' } });

      const insertCall = runSql.mock.calls.find(([sql]) => /INSERT/i.test(sql as string));
      const params = insertCall![1] as unknown[];
      const serializedHandles = params.find((p) => typeof p === 'string' && p.includes('tiktok'));
      expect(serializedHandles).toBe('{"tiktok":"@x"}');
    });
  });

  describe('SKU CRUD', () => {
    it('listBrandSkus returns mapped rows', () => {
      queryAll.mockReturnValueOnce([
        { id: 'lps_a', brand_id: 'lpb_x', catalog_item_id: 'cat_1', role: 'hero', custom_name: 'Quinn Glow', custom_msrp_usd: 49, display_order: 0, created_at: 't' },
        { id: 'lps_b', brand_id: 'lpb_x', catalog_item_id: 'cat_2', role: 'support', custom_name: null, custom_msrp_usd: null, display_order: 1, created_at: 't' },
      ]);
      const skus = brandIdentityService.listBrandSkus('lpb_x');
      expect(skus).toHaveLength(2);
      expect(skus[0].role).toBe('hero');
      expect(skus[0].customMsrpUsd).toBe(49);
      expect(skus[1].customName).toBeNull();
    });

    it('addBrandSku INSERTs and returns the persisted row', () => {
      queryOne.mockReturnValueOnce({
        id: 'lps_x', brand_id: 'lpb_x', catalog_item_id: 'cat_1',
        role: 'hero', custom_name: null, custom_msrp_usd: null,
        display_order: 0, created_at: 't',
      });
      const sku = brandIdentityService.addBrandSku({
        brandId: 'lpb_x', catalogItemId: 'cat_1', role: 'hero',
      });
      expect(sku.role).toBe('hero');
      expect(runSql).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO launchpad_brand_skus/),
        expect.arrayContaining(['lpb_x', 'cat_1', 'hero']),
      );
    });

    it('replaceBrandSkus deletes prior selections then re-inserts', () => {
      // 3 INSERTs after replaceBrandSkus → 3 getById fetches for return.
      queryOne.mockReturnValue({
        id: 'lps_y', brand_id: 'lpb_x', catalog_item_id: 'cat_1',
        role: 'support', custom_name: null, custom_msrp_usd: null,
        display_order: 0, created_at: 't',
      });

      brandIdentityService.replaceBrandSkus('lpb_x', [
        { catalogItemId: 'cat_1', role: 'hero' },
        { catalogItemId: 'cat_2', role: 'support' },
        { catalogItemId: 'cat_3', role: 'bundle' },
      ]);

      const deleteCall = runSql.mock.calls.find(([sql]) => /DELETE/i.test(sql as string));
      expect(deleteCall).toBeDefined();
      expect(deleteCall![0]).toMatch(/DELETE FROM launchpad_brand_skus/);

      const inserts = runSql.mock.calls.filter(([sql]) => /INSERT/i.test(sql as string));
      expect(inserts).toHaveLength(3);
    });

    it('removeBrandSku scopes DELETE to brand_id (cannot delete another brand\'s SKU)', () => {
      brandIdentityService.removeBrandSku('lpb_x', 'lps_y');
      const [sql, params] = runSql.mock.calls[0];
      expect(sql).toMatch(/DELETE FROM launchpad_brand_skus WHERE id = \? AND brand_id = \?/);
      expect(params).toEqual(['lps_y', 'lpb_x']);
    });
  });
});
