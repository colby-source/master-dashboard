-- 028_launchpad_telemetry.sql
--
-- Phase 2.4 Feature 1: drop-off telemetry. Every wizard interaction (step
-- entered, intake patch saved, strategy generated, content step completed)
-- writes a row here so we can produce daily funnel-conversion reports
-- and find the step where creators are dropping off.
--
-- Lightweight by design: append-only events, indexed by (brand_id, step,
-- created_at). Aggregations live in the report query, not in materialized
-- counts on launchpad_brands.

CREATE TABLE IF NOT EXISTS launchpad_step_events (
  id          TEXT PRIMARY KEY,
  brand_id    TEXT NOT NULL,
  step        TEXT NOT NULL,            -- 'identity' | 'story' | ... | 'submit'
  event_type  TEXT NOT NULL,            -- 'entered' | 'patch_saved' | 'completed' | 'abandoned'
  meta_json   TEXT,                     -- optional event-specific JSON (field count, errors, etc.)
  created_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (brand_id) REFERENCES launchpad_brands(id)
);

CREATE INDEX IF NOT EXISTS idx_lpse_brand_id   ON launchpad_step_events(brand_id);
CREATE INDEX IF NOT EXISTS idx_lpse_step       ON launchpad_step_events(step);
CREATE INDEX IF NOT EXISTS idx_lpse_event_type ON launchpad_step_events(event_type);
CREATE INDEX IF NOT EXISTS idx_lpse_created_at ON launchpad_step_events(created_at);
