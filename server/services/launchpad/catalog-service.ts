/**
 * catalog-service.ts — parses the BMN PLDS XLSX catalog files into the
 * `bmn_catalog` SQLite table and serves filterable reads to the wizard.
 *
 * The PLDS folder lives on Google Drive (sync'd locally via Drive for Desktop).
 * Path is configured by `config.launchpad.pldsRoot`. We support 4 catalog
 * sources, each with a slightly different XLSX schema:
 *
 *   - skincare    → Skin Care/Skincare_PLDS_US.xlsx       (sheet: Skincare_Product_Pricing)
 *   - cosmetics   → Skin Care/Cosmetics_PLDS_US.xlsx      (sheet: Cosmetics_Product_Pricing)
 *   - selfnamed   → Skin Care/Selfnamed_Full_Catalog.xlsx (sheet: Selfnamed Full Catalog)
 *   - supplements → Supplements/Supplements_PLDS_US.xlsx  (sheet: Product_Pricing)
 *
 * Refresh runs on server startup and every `pldsRefreshHours`. Missing PLDS
 * paths log a warning but don't crash the server — the wizard product step
 * just shows an empty catalog until the path is fixed.
 *
 * Item IDs are deterministic SHA-1 of (source, supplier, product, size) so
 * re-imports are idempotent and re-pick existing brand_skus links.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { config } from '../../config';
import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { createLogger } from '../../utils/logger';
import {
  BmnCatalogItem,
  BmnCatalogRow,
  CatalogSource,
  rowToCatalogItem,
} from './types';

const log = createLogger('catalog-service');

interface NormalizedItem {
  catalogSource: CatalogSource;
  supplierName: string | null;
  category: string | null;
  productName: string;
  sizeOrVolume: string | null;
  totalLandedCost: number | null;
  msrpUsd: number | null;
  grossProfitUsd: number | null;
  grossMarginPct: number | null;
  influencerPayout25Usd: number | null;
  bmnNetUsd: number | null;
  bmnNetPct: number | null;
  moq: number | null;
  moqNotes: string | null;
  labelOnDemand: boolean;
  ships2to3Days: boolean;
  requiresComplianceReview: boolean;
  complianceNotes: string | null;
  rawMetadata: Record<string, unknown>;
}

type PldsConfig = {
  source: CatalogSource;
  relPath: string;
  productSheet: string;
  companiesSheet?: string;
};

const PLDS_FILES: PldsConfig[] = [
  {
    source: 'skincare',
    relPath: path.join('Skin Care', 'Skincare_PLDS_US.xlsx'),
    productSheet: 'Skincare_Product_Pricing',
    companiesSheet: 'Skincare_Companies',
  },
  {
    source: 'cosmetics',
    relPath: path.join('Skin Care', 'Cosmetics_PLDS_US.xlsx'),
    productSheet: 'Cosmetics_Product_Pricing',
    companiesSheet: 'Cosmetics_Companies',
  },
  {
    source: 'selfnamed',
    relPath: path.join('Skin Care', 'Selfnamed_Full_Catalog.xlsx'),
    productSheet: 'Selfnamed Full Catalog',
  },
  {
    source: 'supplements',
    relPath: path.join('Supplements', 'Supplements_PLDS_US.xlsx'),
    productSheet: 'Product_Pricing',
    companiesSheet: 'Companies',
  },
];

// Categories that need extra compliance review before launch
const COMPLIANCE_RISKY_CATEGORIES = [
  'rx', 'medical', 'peptide', 'rocktomicrx', 'pharma', 'prescription',
];

class CatalogService {
  private refreshTimer: NodeJS.Timeout | null = null;

  /** Schedule periodic refresh + run an initial sync. Called once at server start. */
  start(): void {
    this.refresh().catch((err) => {
      log.warn(`[catalog] initial refresh failed: ${err instanceof Error ? err.message : err}`);
    });
    const intervalMs = Math.max(1, config.launchpad.pldsRefreshHours) * 60 * 60 * 1000;
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) => {
        log.warn(`[catalog] scheduled refresh failed: ${err instanceof Error ? err.message : err}`);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  /**
   * Parse all PLDS XLSX files and upsert into bmn_catalog. Each item is
   * keyed by deterministic id so re-runs replace prior values without
   * orphaning brand_skus references.
   */
  async refresh(): Promise<{ ok: boolean; counts: Record<CatalogSource, number>; errors: string[] }> {
    const root = config.launchpad.pldsRoot;
    const counts: Record<CatalogSource, number> = {
      skincare: 0, cosmetics: 0, selfnamed: 0, supplements: 0,
    };
    const errors: string[] = [];

    if (!root || !fs.existsSync(root)) {
      const msg = `PLDS root not found: ${root}`;
      log.warn(`[catalog] ${msg}`);
      errors.push(msg);
      return { ok: false, counts, errors };
    }

    for (const cfg of PLDS_FILES) {
      const fullPath = path.join(root, cfg.relPath);
      if (!fs.existsSync(fullPath)) {
        const msg = `Missing: ${cfg.relPath}`;
        log.warn(`[catalog] ${msg}`);
        errors.push(msg);
        continue;
      }
      try {
        const items = this.parseFile(fullPath, cfg);
        this.upsertBatch(cfg.source, items);
        counts[cfg.source] = items.length;
        log.info(`[catalog] ${cfg.source}: ${items.length} items`);
      } catch (err) {
        const msg = `${cfg.source}: ${err instanceof Error ? err.message : String(err)}`;
        log.error(`[catalog] ${msg}`);
        errors.push(msg);
      }
    }

    saveDb();
    return { ok: errors.length === 0, counts, errors };
  }

  private parseFile(fullPath: string, cfg: PldsConfig): NormalizedItem[] {
    const wb = XLSX.readFile(fullPath, { cellDates: false });
    const sheet = wb.Sheets[cfg.productSheet];
    if (!sheet) throw new Error(`sheet "${cfg.productSheet}" not found in ${cfg.relPath}`);
    // Build a supplier → company-row index so we can enrich product rows
    // with MOQ / fulfillment metadata.
    const companyIndex = cfg.companiesSheet
      ? this.indexCompanies(wb.Sheets[cfg.companiesSheet])
      : new Map<string, Record<string, unknown>>();

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    return rows
      .map((row) => this.normalizeRow(cfg.source, row, companyIndex))
      .filter((item): item is NormalizedItem => item !== null);
  }

  private indexCompanies(sheet: XLSX.WorkSheet | undefined): Map<string, Record<string, unknown>> {
    const map = new Map<string, Record<string, unknown>>();
    if (!sheet) return map;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    for (const r of rows) {
      const name = (r.CompanyName as string | null) ?? null;
      if (name) map.set(name.trim().toLowerCase(), r);
    }
    return map;
  }

  private normalizeRow(
    source: CatalogSource,
    row: Record<string, unknown>,
    companyIndex: Map<string, Record<string, unknown>>,
  ): NormalizedItem | null {
    // Each source has slightly different column names. Pick out the canonical
    // fields and store the rest as raw_metadata so the UI / future logic can
    // surface anything we didn't normalize.
    let productName: string | null = null;
    let supplier: string | null = null;
    let category: string | null = null;
    let size: string | null = null;
    let landedCost: number | null = null;
    let msrp: number | null = null;
    let grossProfit: number | null = null;
    let grossMarginPct: number | null = null;
    let influencer25: number | null = null;
    let bmnNet: number | null = null;
    let bmnNetPct: number | null = null;

    const str = (v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      return s.length === 0 ? null : s;
    };
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,%\s]/g, ''));
      return Number.isFinite(n) ? n : null;
    };

    if (source === 'skincare' || source === 'cosmetics') {
      supplier = str(row.CompanyName);
      category = str(row.Category);
      productName = str(row.Product);
      size = str(row.Size);
      landedCost = num(row.Total_Landed_Cost);
      msrp = num(row.MSRP_Median);
      grossProfit = num(row.Gross_Profit);
      grossMarginPct = num(row['Gross_Margin%']);
      influencer25 = num(row['Influencer_25%']);
      bmnNet = num(row['BMN_Net$']);
      bmnNetPct = num(row['BMN_Net%']);
    } else if (source === 'selfnamed') {
      supplier = 'Selfnamed';
      category = str(row.Category) ?? str(row.Group);
      productName = str(row['Product Name']);
      const ml = str(row['Volume (ml)']);
      const floz = str(row['Volume (fl oz)']);
      size = ml && floz ? `${floz} fl oz / ${ml}ml` : (ml ?? floz);
      landedCost = num(row['Our Cost\n(USD @ 1.04)']) ?? num(row['Our Cost (USD)']);
      msrp = num(row['MSRP\n(USD Benchmark)']) ?? num(row['MSRP (USD)']);
      grossProfit = num(row['Gross Profit\n($)']) ?? num(row['Gross Profit ($)']);
      grossMarginPct = num(row['Gross Margin\n(%)']) ?? num(row['Gross Margin (%)']);
      influencer25 = num(row['Influencer\nPayout (25%)']) ?? num(row['Influencer Payout (25%)']);
      bmnNet = num(row['BMN Net\n($)']) ?? num(row['BMN Net ($)']);
      bmnNetPct = num(row['BMN Net\n(%)']) ?? num(row['BMN Net (%)']);
    } else if (source === 'supplements') {
      supplier = str(row.CompanyName);
      category = str(row.Category);
      productName = str(row.Product_Name);
      size = [str(row.Form), str(row.Serving_Size), str(row.Bottle_Count)]
        .filter(Boolean)
        .join(' / ') || null;
      landedCost = num(row.Total_Landed_Cost);
      msrp = num(row.MSRP_Median);
      grossProfit = num(row.Gross_Profit);
      grossMarginPct = num(row.Gross_Margin_Pct);
      influencer25 = num(row.Influencer_25_Pct);
      bmnNet = num(row.BMN_Net_Dollar);
      bmnNetPct = num(row.BMN_Net_Pct);
    }

    if (!productName) return null;

    // Pull MOQ / fulfillment from the companies sheet when we have a match.
    const company = supplier ? companyIndex.get(supplier.toLowerCase()) : undefined;
    const moqRaw = company?.MOQ_per_SKU ?? null;
    const moq = typeof moqRaw === 'number' ? moqRaw : num(moqRaw);
    const moqNotes = str(company?.MOQ_Notes);
    const labelOnDemand = isYes(company?.Label_On_Demand);
    const ships2to3 = isYes(company?.Ships_2to3_Days);

    // Compliance heuristic — flag anything category-tagged as Rx / pharma /
    // peptide / etc. Operator can override later via admin.
    const categoryLc = (category || '').toLowerCase();
    const requiresCompliance =
      source === 'supplements' ||
      COMPLIANCE_RISKY_CATEGORIES.some((kw) => categoryLc.includes(kw));

    return {
      catalogSource: source,
      supplierName: supplier,
      category,
      productName,
      sizeOrVolume: size,
      totalLandedCost: landedCost,
      msrpUsd: msrp,
      grossProfitUsd: grossProfit,
      grossMarginPct,
      influencerPayout25Usd: influencer25,
      bmnNetUsd: bmnNet,
      bmnNetPct,
      moq,
      moqNotes,
      labelOnDemand,
      ships2to3Days: ships2to3,
      requiresComplianceReview: requiresCompliance,
      complianceNotes: source === 'supplements'
        ? 'Supplements: FDA structure/function compliance review required before any PDP/ad copy.'
        : null,
      rawMetadata: row,
    };
  }

  private upsertBatch(source: CatalogSource, items: NormalizedItem[]): void {
    // Wipe existing rows for this source so deletions in PLDS propagate.
    runSql(`DELETE FROM bmn_catalog WHERE catalog_source = ?`, [source]);
    const now = new Date().toISOString();
    for (const item of items) {
      const id = computeId(item);
      runSql(
        `INSERT INTO bmn_catalog (
           id, catalog_source, supplier_name, category, product_name, size_or_volume,
           total_landed_cost, msrp_usd, gross_profit_usd, gross_margin_pct,
           influencer_payout_25_usd, bmn_net_usd, bmn_net_pct,
           moq, moq_notes, label_on_demand, ships_2_3_days,
           requires_compliance_review, compliance_notes, raw_metadata, source_synced_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          item.catalogSource,
          item.supplierName,
          item.category,
          item.productName,
          item.sizeOrVolume,
          item.totalLandedCost,
          item.msrpUsd,
          item.grossProfitUsd,
          item.grossMarginPct,
          item.influencerPayout25Usd,
          item.bmnNetUsd,
          item.bmnNetPct,
          item.moq,
          item.moqNotes,
          item.labelOnDemand ? 1 : 0,
          item.ships2to3Days ? 1 : 0,
          item.requiresComplianceReview ? 1 : 0,
          item.complianceNotes,
          JSON.stringify(item.rawMetadata),
          now,
        ],
      );
    }
  }

  // ── Read API ─────────────────────────────────────────────

  list(filter?: {
    source?: CatalogSource;
    category?: string;
    minMarginPct?: number;
    minBmnNetPct?: number;
    requiresCompliance?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  }): BmnCatalogItem[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.source) {
      where.push('catalog_source = ?');
      params.push(filter.source);
    }
    if (filter?.category) {
      where.push('LOWER(category) = LOWER(?)');
      params.push(filter.category);
    }
    if (typeof filter?.minMarginPct === 'number') {
      where.push('gross_margin_pct >= ?');
      params.push(filter.minMarginPct);
    }
    if (typeof filter?.minBmnNetPct === 'number') {
      where.push('bmn_net_pct >= ?');
      params.push(filter.minBmnNetPct);
    }
    if (typeof filter?.requiresCompliance === 'boolean') {
      where.push('requires_compliance_review = ?');
      params.push(filter.requiresCompliance ? 1 : 0);
    }
    if (filter?.search) {
      where.push('(LOWER(product_name) LIKE ? OR LOWER(supplier_name) LIKE ?)');
      const term = `%${filter.search.toLowerCase()}%`;
      params.push(term, term);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filter?.limit ?? 200;
    const offset = filter?.offset ?? 0;
    // sql.js (older SQLite) doesn't support NULLS LAST — emulate with CASE.
    const rows = queryAll(
      `SELECT * FROM bmn_catalog ${whereSql}
       ORDER BY (bmn_net_pct IS NULL) ASC, bmn_net_pct DESC,
                (gross_margin_pct IS NULL) ASC, gross_margin_pct DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ) as BmnCatalogRow[];
    return rows.map(rowToCatalogItem);
  }

  getById(id: string): BmnCatalogItem | null {
    const row = queryOne(`SELECT * FROM bmn_catalog WHERE id = ?`, [id]) as BmnCatalogRow | null;
    return row ? rowToCatalogItem(row) : null;
  }

  /** Distinct categories for a source — drives the wizard's category dropdown. */
  listCategories(source?: CatalogSource): string[] {
    const where = source
      ? `WHERE catalog_source = ? AND category IS NOT NULL`
      : `WHERE category IS NOT NULL`;
    const params = source ? [source] : [];
    const rows = queryAll(
      `SELECT DISTINCT category FROM bmn_catalog ${where} ORDER BY category`,
      params,
    ) as Array<{ category: string }>;
    return rows.map((r) => r.category).filter(Boolean);
  }
}

function isYes(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return s === 'y' || s === 'yes' || s === 'true' || s.startsWith('y ');
}

function computeId(item: NormalizedItem): string {
  const key = [
    item.catalogSource,
    item.supplierName ?? '',
    item.productName,
    item.sizeOrVolume ?? '',
  ].join('||').toLowerCase();
  return `cat_${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
}

export const catalogService = new CatalogService();
