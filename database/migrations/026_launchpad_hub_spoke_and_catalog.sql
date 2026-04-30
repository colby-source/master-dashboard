-- Migration 026: Hub-and-Spoke architecture + BMN PLDS catalog cache
--
-- Phase 1 of the Launchpad revenue-guarantee build. Extends the data model
-- to support the creator's PERSONAL handle (spoke) and the brand-owned
-- handle (hub) as two distinct identities. Caches the PLDS XLSX catalog
-- (Skin Care + Cosmetics + Selfnamed + Supplements) in SQLite for the
-- "Product line + SKUs" wizard step.
--
-- Backwards-compat: existing brands keep working — brand_identity rows
-- are created lazily, and clip/longform `audience` defaults to
-- 'creator_personal' so legacy single-handle calendars stay valid.

-- ── Hub identity ─────────────────────────────────────────────
-- The brand-owned handle is created NEW per brand (separate from the
-- creator's personal handle). One row per brand. Per-platform handles
-- live in JSON since one brand may launch on multiple platforms.
CREATE TABLE IF NOT EXISTS launchpad_brand_identity (
  brand_id TEXT PRIMARY KEY,                    -- FK to launchpad_brands.id

  -- Handle reservation per platform — JSON Record<platform, "@handle">
  brand_handles TEXT,

  -- Brand kit
  primary_color TEXT,                           -- hex
  secondary_color TEXT,
  accent_color TEXT,
  logo_drive_file_id TEXT,
  brand_kit_drive_url TEXT,

  -- Bio + link-in-bio
  brand_bio_text TEXT,                          -- bio displayed on brand handle
  bio_link_url TEXT,                            -- absolute URL of the bio page
  bio_link_slug TEXT UNIQUE,                    -- per-brand bio page slug

  -- Day-1 brand-page positioning content
  founder_story_reel_script TEXT,               -- script for the pinned launch Reel
  founder_story_reel_drive_url TEXT,            -- finished video URL after edit

  -- Hub/spoke split rules (denormalized from socialmediamonster output)
  hub_post_cadence TEXT,                        -- e.g. "daily IG + TikTok"
  spoke_post_cadence TEXT,                      -- e.g. "1x/week brand mention"
  hub_content_mix TEXT,                         -- JSON: { ugc, education, founder_clips, memes }

  -- Storefront integration (single brandmenow.shop store; one collection per brand)
  shopify_collection_id TEXT,
  shopify_collection_handle TEXT,
  shopify_storefront_url TEXT,                  -- brandmenow.shop/collections/{handle}

  -- Marketplace setup state (one BMN-level seller account each; track per brand)
  tiktok_shop_status TEXT NOT NULL DEFAULT 'pending',     -- pending|active|disabled
  amazon_brand_registry_status TEXT NOT NULL DEFAULT 'pending',

  -- GHL — single BMN sub-account; brand owns its pipeline + tag namespace
  ghl_pipeline_id TEXT,
  ghl_workflow_ids TEXT,                        -- JSON: { welcome, cart_abandon, post_purchase, replenish_d45, win_back, browse_abandon }
  ghl_sms_number TEXT,                          -- 10DLC number for this brand

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES launchpad_brands(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_brand_identity_bio_slug ON launchpad_brand_identity(bio_link_slug);

-- ── Per-brand SKU selections ────────────────────────────────
-- Which PLDS items the creator picked. Hero = primary launch SKU; support
-- = bundle/cross-sell SKUs; bundle = explicitly bundled-as-set offering.
CREATE TABLE IF NOT EXISTS launchpad_brand_skus (
  id TEXT PRIMARY KEY,                          -- 'lps_<random>'
  brand_id TEXT NOT NULL,
  catalog_item_id TEXT NOT NULL,                -- FK to bmn_catalog.id
  role TEXT NOT NULL DEFAULT 'support',         -- 'hero' | 'support' | 'bundle'
  custom_name TEXT,                             -- creator's branded name for the SKU
  custom_msrp_usd REAL,                         -- override MSRP if creator chose differently
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES launchpad_brands(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_brand_skus_brand ON launchpad_brand_skus(brand_id, role);

-- ── BMN PLDS catalog cache ──────────────────────────────────
-- Source of truth: I:\...\BMN\PLDS\Skin Care\*.xlsx + Supplements\*.xlsx
-- Refreshed by catalog-service on startup + scheduled refresh.
CREATE TABLE IF NOT EXISTS bmn_catalog (
  id TEXT PRIMARY KEY,                          -- deterministic sha1 of source+supplier+product+size
  catalog_source TEXT NOT NULL,                 -- 'skincare' | 'cosmetics' | 'selfnamed' | 'supplements'
  supplier_name TEXT,
  category TEXT,
  product_name TEXT NOT NULL,
  size_or_volume TEXT,

  -- Economics (USD)
  total_landed_cost REAL,
  msrp_usd REAL,
  gross_profit_usd REAL,
  gross_margin_pct REAL,
  influencer_payout_25_usd REAL,                -- 25% influencer share at MSRP
  bmn_net_usd REAL,
  bmn_net_pct REAL,

  -- Logistics
  moq INTEGER,
  moq_notes TEXT,
  label_on_demand INTEGER NOT NULL DEFAULT 0,   -- 0/1
  ships_2_3_days INTEGER NOT NULL DEFAULT 0,

  -- Compliance flags
  requires_compliance_review INTEGER NOT NULL DEFAULT 0,
  compliance_notes TEXT,

  -- Raw source row preserved for fields we didn't normalize
  raw_metadata TEXT,                            -- JSON

  source_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bmn_catalog_source ON bmn_catalog(catalog_source, category);
CREATE INDEX IF NOT EXISTS idx_bmn_catalog_margin ON bmn_catalog(gross_margin_pct DESC);

-- ── Hub-and-spoke audience tagging ──────────────────────────
-- Every clip and longform source is tagged with which audience/handle owns
-- it. Existing rows default to 'creator_personal' to preserve current
-- behavior; new generations will split the calendar correctly.
ALTER TABLE launchpad_clips ADD COLUMN audience TEXT NOT NULL DEFAULT 'creator_personal';
ALTER TABLE launchpad_longform_sources ADD COLUMN audience TEXT NOT NULL DEFAULT 'creator_personal';

CREATE INDEX IF NOT EXISTS idx_clips_audience ON launchpad_clips(brand_id, audience, assigned_day);
