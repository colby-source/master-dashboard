-- Migration 023: Launchpad strategy-generation concurrency lock
-- Prevents duplicate Claude generation runs from a double-clicked Generate
-- button or competing admin/client triggers. Stores the start time of the
-- in-flight generation; service rejects fresh calls if a recent one is active.

ALTER TABLE launchpad_brands ADD COLUMN strategy_generation_started_at TEXT;

CREATE INDEX IF NOT EXISTS idx_launchpad_brands_gen_started
  ON launchpad_brands(strategy_generation_started_at)
  WHERE strategy_generation_started_at IS NOT NULL;
