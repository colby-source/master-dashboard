/**
 * brand-identity-service.ts — CRUD on launchpad_brand_identity (the "hub"
 * in the hub-and-spoke model) and launchpad_brand_skus (per-brand product
 * picks from the BMN PLDS catalog).
 *
 * Identity rows are created lazily — when a brand starts the
 * brand-identity wizard step (step 9 in the new flow), the upsert runs.
 * Existing brands without a row keep working; the type system treats
 * `BrandIdentity | null` so callers must handle absence.
 */

import crypto from 'crypto';
import { queryAll, queryOne, runSql, saveDb } from '../../db';
import {
  BrandIdentity,
  BrandIdentityRow,
  BrandSku,
  BrandSkuRow,
  rowToBrandIdentity,
  rowToBrandSku,
} from './types';

class BrandIdentityService {
  /** Returns the brand identity, or null if the brand hasn't started identity setup yet. */
  getByBrandId(brandId: string): BrandIdentity | null {
    const row = queryOne(
      `SELECT * FROM launchpad_brand_identity WHERE brand_id = ?`,
      [brandId],
    ) as BrandIdentityRow | null;
    return row ? rowToBrandIdentity(row) : null;
  }

  /** Returns identity by bio-link slug — used to render the public bio page. */
  getByBioSlug(slug: string): BrandIdentity | null {
    const row = queryOne(
      `SELECT * FROM launchpad_brand_identity WHERE bio_link_slug = ?`,
      [slug],
    ) as BrandIdentityRow | null;
    return row ? rowToBrandIdentity(row) : null;
  }

  /**
   * Upsert: creates the identity row if missing, otherwise patches the
   * provided fields. Always touches `updated_at`. Patch keys use camelCase
   * matching `BrandIdentity`; only persisted fields are written.
   */
  upsert(brandId: string, patch: Partial<BrandIdentity>): BrandIdentity {
    const existing = this.getByBrandId(brandId);
    const now = new Date().toISOString();

    // Map camelCase patch → snake_case DB columns. Only write keys that are
    // explicitly present on the patch (so an undefined `primaryColor` doesn't
    // wipe a previously-set value).
    const colMap: Array<[keyof BrandIdentity, string, (v: unknown) => unknown]> = [
      ['brandHandles', 'brand_handles', (v) => (v ? JSON.stringify(v) : null)],
      ['primaryColor', 'primary_color', (v) => v ?? null],
      ['secondaryColor', 'secondary_color', (v) => v ?? null],
      ['accentColor', 'accent_color', (v) => v ?? null],
      ['logoDriveFileId', 'logo_drive_file_id', (v) => v ?? null],
      ['brandKitDriveUrl', 'brand_kit_drive_url', (v) => v ?? null],
      ['brandBioText', 'brand_bio_text', (v) => v ?? null],
      ['bioLinkUrl', 'bio_link_url', (v) => v ?? null],
      ['bioLinkSlug', 'bio_link_slug', (v) => v ?? null],
      ['founderStoryReelScript', 'founder_story_reel_script', (v) => v ?? null],
      ['founderStoryReelDriveUrl', 'founder_story_reel_drive_url', (v) => v ?? null],
      ['hubPostCadence', 'hub_post_cadence', (v) => v ?? null],
      ['spokePostCadence', 'spoke_post_cadence', (v) => v ?? null],
      ['hubContentMix', 'hub_content_mix', (v) => (v ? JSON.stringify(v) : null)],
      ['shopifyCollectionId', 'shopify_collection_id', (v) => v ?? null],
      ['shopifyCollectionHandle', 'shopify_collection_handle', (v) => v ?? null],
      ['shopifyStorefrontUrl', 'shopify_storefront_url', (v) => v ?? null],
      ['tiktokShopStatus', 'tiktok_shop_status', (v) => v ?? 'pending'],
      ['amazonBrandRegistryStatus', 'amazon_brand_registry_status', (v) => v ?? 'pending'],
      ['ghlPipelineId', 'ghl_pipeline_id', (v) => v ?? null],
      ['ghlWorkflowIds', 'ghl_workflow_ids', (v) => (v ? JSON.stringify(v) : null)],
      ['ghlSmsNumber', 'ghl_sms_number', (v) => v ?? null],
    ];

    const presentCols = colMap.filter(([camelKey]) =>
      Object.prototype.hasOwnProperty.call(patch, camelKey),
    );

    if (!existing) {
      // INSERT: write every column that's present on the patch, plus brand_id.
      const cols = ['brand_id', 'updated_at', ...presentCols.map(([, c]) => c)];
      const placeholders = cols.map(() => '?').join(', ');
      const values: unknown[] = [
        brandId,
        now,
        ...presentCols.map(([camelKey, , transform]) => transform(patch[camelKey])),
      ];
      runSql(
        `INSERT INTO launchpad_brand_identity (${cols.join(', ')}) VALUES (${placeholders})`,
        values,
      );
    } else if (presentCols.length > 0) {
      // UPDATE: only set the columns that are explicitly on the patch.
      const setClause = presentCols.map(([, c]) => `${c} = ?`).join(', ');
      const values: unknown[] = [
        ...presentCols.map(([camelKey, , transform]) => transform(patch[camelKey])),
        now,
        brandId,
      ];
      runSql(
        `UPDATE launchpad_brand_identity SET ${setClause}, updated_at = ? WHERE brand_id = ?`,
        values,
      );
    }
    saveDb();

    const after = this.getByBrandId(brandId);
    if (!after) throw new Error(`brand_identity upsert failed for ${brandId}`);
    return after;
  }

  // ── SKU selections ────────────────────────────────────────

  listBrandSkus(brandId: string): BrandSku[] {
    const rows = queryAll(
      `SELECT * FROM launchpad_brand_skus WHERE brand_id = ? ORDER BY display_order, created_at`,
      [brandId],
    ) as BrandSkuRow[];
    return rows.map(rowToBrandSku);
  }

  addBrandSku(input: {
    brandId: string;
    catalogItemId: string;
    role?: BrandSku['role'];
    customName?: string | null;
    customMsrpUsd?: number | null;
    displayOrder?: number;
  }): BrandSku {
    const id = `lps_${crypto.randomBytes(8).toString('hex')}`;
    runSql(
      `INSERT INTO launchpad_brand_skus
       (id, brand_id, catalog_item_id, role, custom_name, custom_msrp_usd, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.brandId,
        input.catalogItemId,
        input.role ?? 'support',
        input.customName ?? null,
        input.customMsrpUsd ?? null,
        input.displayOrder ?? 0,
      ],
    );
    saveDb();
    const added = queryOne(`SELECT * FROM launchpad_brand_skus WHERE id = ?`, [id]) as BrandSkuRow;
    return rowToBrandSku(added);
  }

  removeBrandSku(brandId: string, skuId: string): void {
    runSql(
      `DELETE FROM launchpad_brand_skus WHERE id = ? AND brand_id = ?`,
      [skuId, brandId],
    );
    saveDb();
  }

  /** Replaces the brand's SKU set wholesale. Used by the wizard product step. */
  replaceBrandSkus(
    brandId: string,
    selections: Array<{
      catalogItemId: string;
      role: BrandSku['role'];
      customName?: string;
      customMsrpUsd?: number;
      displayOrder?: number;
    }>,
  ): BrandSku[] {
    runSql(`DELETE FROM launchpad_brand_skus WHERE brand_id = ?`, [brandId]);
    saveDb();
    return selections.map((sel, i) =>
      this.addBrandSku({
        brandId,
        catalogItemId: sel.catalogItemId,
        role: sel.role,
        customName: sel.customName ?? null,
        customMsrpUsd: sel.customMsrpUsd ?? null,
        displayOrder: sel.displayOrder ?? i,
      }),
    );
  }
}

export const brandIdentityService = new BrandIdentityService();
