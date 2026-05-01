-- 031_launchpad_quality_metrics.sql
--
-- Phase 2.4 Feature 4: Strategy quality feedback. Records post-launch
-- revenue + engagement metrics per brand at standardized day-30/60/90
-- checkpoints so we can grade each brand's strategy package against
-- actual outcomes and let the underlying Claude prompts evolve from data.
--
-- Metrics come from external systems (Shopify, GHL, social platforms).
-- The pull is implemented incrementally — initial scaffold writes manual
-- entries; later phases auto-pull from /api integrations.

CREATE TABLE IF NOT EXISTS launchpad_brand_quality_metrics (
  id                       TEXT PRIMARY KEY,
  brand_id                 TEXT NOT NULL,
  checkpoint               TEXT NOT NULL,        -- 'day_30' | 'day_60' | 'day_90'
  measured_at              TEXT NOT NULL,
  source                   TEXT NOT NULL,        -- 'manual' | 'shopify' | 'ghl' | 'meta' | 'tiktok'
  revenue_usd              REAL,
  orders_count             INTEGER,
  email_subscribers        INTEGER,
  followers_personal_handle INTEGER,
  followers_brand_handle   INTEGER,
  posts_published          INTEGER,
  reply_rate_pct           REAL,
  notes                    TEXT,
  created_at               TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (brand_id) REFERENCES launchpad_brands(id)
);

CREATE INDEX IF NOT EXISTS idx_lpbqm_brand_id    ON launchpad_brand_quality_metrics(brand_id);
CREATE INDEX IF NOT EXISTS idx_lpbqm_checkpoint  ON launchpad_brand_quality_metrics(checkpoint);
CREATE INDEX IF NOT EXISTS idx_lpbqm_measured_at ON launchpad_brand_quality_metrics(measured_at);

-- Strategy "score" per brand — derived view-like single source of truth so
-- comparisons are consistent. Stored as a snapshot rather than recomputed
-- on each query so historical scores stay stable as the formula evolves.
CREATE TABLE IF NOT EXISTS launchpad_strategy_scores (
  id              TEXT PRIMARY KEY,
  brand_id        TEXT NOT NULL,
  checkpoint      TEXT NOT NULL,
  revenue_score   INTEGER,        -- 0-100, normalized vs target
  engagement_score INTEGER,
  composite_score INTEGER,        -- weighted overall
  scoring_version TEXT NOT NULL,  -- e.g. 'v1.0' — bump when formula changes
  inputs_json     TEXT,
  scored_at       TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (brand_id) REFERENCES launchpad_brands(id)
);

CREATE INDEX IF NOT EXISTS idx_lpss_brand_id        ON launchpad_strategy_scores(brand_id);
CREATE INDEX IF NOT EXISTS idx_lpss_scoring_version ON launchpad_strategy_scores(scoring_version);
