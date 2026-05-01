-- 030_launchpad_catalog_drift.sql
--
-- Phase 2.4 Feature 3: PLDS catalog drift detection.
--
-- Every catalog refresh now diffs the new XLSX against the prior bmn_catalog
-- snapshot and writes an event per change here. Ops can review what changed
-- since the last sync, and a join to launchpad_brand_skus surfaces brands
-- whose picked SKUs were modified or removed.

CREATE TABLE IF NOT EXISTS bmn_catalog_drift_events (
  id              TEXT PRIMARY KEY,
  catalog_item_id TEXT NOT NULL,        -- the deterministic SHA-1 id
  catalog_source  TEXT NOT NULL,
  change_type     TEXT NOT NULL,        -- 'added' | 'removed' | 'price_changed' | 'msrp_changed' | 'compliance_flag_changed' | 'metadata_changed'
  before_value    TEXT,                 -- JSON snapshot of changed fields BEFORE
  after_value     TEXT,                 -- JSON snapshot of changed fields AFTER
  detected_at     TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  acknowledged_at TEXT,                 -- set when an operator marks the change as reviewed
  acknowledged_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_lpcd_item_id     ON bmn_catalog_drift_events(catalog_item_id);
CREATE INDEX IF NOT EXISTS idx_lpcd_change_type ON bmn_catalog_drift_events(change_type);
CREATE INDEX IF NOT EXISTS idx_lpcd_detected_at ON bmn_catalog_drift_events(detected_at);
CREATE INDEX IF NOT EXISTS idx_lpcd_unacked     ON bmn_catalog_drift_events(acknowledged_at);
