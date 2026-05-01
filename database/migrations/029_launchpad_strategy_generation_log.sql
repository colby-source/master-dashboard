-- 029_launchpad_strategy_generation_log.sql
--
-- Phase 2.4 Feature 2: Claude cost cap + alerting. Records every strategy
-- generation attempt (success, partial, failure) with rough cost so we can
-- enforce per-brand daily caps and trigger Telegram alerts on budget
-- overruns.
--
-- Cost is computed at write time from the per-call token usage exposed by
-- the Anthropic SDK. If we don't have token counts, we fall back to a
-- conservative per-package estimate (~$1.50).

CREATE TABLE IF NOT EXISTS launchpad_strategy_generations (
  id              TEXT PRIMARY KEY,
  brand_id        TEXT NOT NULL,
  status          TEXT NOT NULL,        -- 'ok' | 'partial' | 'error'
  modules_ok      INTEGER NOT NULL DEFAULT 0,
  modules_failed  INTEGER NOT NULL DEFAULT 0,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER,
  error_summary   TEXT,
  created_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (brand_id) REFERENCES launchpad_brands(id)
);

CREATE INDEX IF NOT EXISTS idx_lpsg_brand_id   ON launchpad_strategy_generations(brand_id);
CREATE INDEX IF NOT EXISTS idx_lpsg_created_at ON launchpad_strategy_generations(created_at);
