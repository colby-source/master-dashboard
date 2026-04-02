-- Migration 016: Columns previously added inline in db.ts
-- These are now managed by the migration system.

ALTER TABLE enrichment_config ADD COLUMN auto_reply_enabled INTEGER DEFAULT 0;
ALTER TABLE enrichment_config ADD COLUMN auto_reply_sentiments TEXT DEFAULT '["interested","question","meeting_request"]';
ALTER TABLE enrichment_leads ADD COLUMN ab_variant TEXT;
ALTER TABLE enrichment_config ADD COLUMN ghl_pipeline_id TEXT;
ALTER TABLE enrichment_config ADD COLUMN ghl_pipeline_stages TEXT;
ALTER TABLE enrichment_leads ADD COLUMN ghl_opportunity_id TEXT;
ALTER TABLE reply_threads ADD COLUMN subject TEXT;
ALTER TABLE enrichment_leads ADD COLUMN linkedin_outreach_status TEXT DEFAULT 'none';
ALTER TABLE enrichment_leads ADD COLUMN linkedin_message TEXT;
ALTER TABLE enrichment_leads ADD COLUMN linkedin_connected_at TEXT;
ALTER TABLE enrichment_leads ADD COLUMN linkedin_sequence_step INTEGER DEFAULT 0;
ALTER TABLE enrichment_leads ADD COLUMN linkedin_last_dm_at TEXT;
ALTER TABLE enrichment_leads ADD COLUMN linkedin_dm_reply_at TEXT;
ALTER TABLE ab_tests ADD COLUMN test_name TEXT;
ALTER TABLE ab_tests ADD COLUMN winning_variant TEXT;
ALTER TABLE ab_tests ADD COLUMN completed_at TEXT;
ALTER TABLE company_playbooks ADD COLUMN company_name TEXT NOT NULL DEFAULT '';
ALTER TABLE company_playbooks ADD COLUMN sender_name TEXT NOT NULL DEFAULT '';
ALTER TABLE company_playbooks ADD COLUMN compliance_rules TEXT;
ALTER TABLE reply_messages ADD COLUMN review_status TEXT;

-- Backfill existing unsent outbound messages to 'approved' so they don't get stuck
UPDATE reply_messages SET review_status = 'approved' WHERE review_status IS NULL AND direction = 'outbound' AND sent = 0;

-- Create tables that were inline
CREATE TABLE IF NOT EXISTS linkedin_dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES enrichment_leads(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  direction TEXT NOT NULL DEFAULT 'outbound',
  message TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_linkedin_dm_lead ON linkedin_dm_messages(lead_id);

CREATE TABLE IF NOT EXISTS campaign_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  company_id INTEGER NOT NULL,
  snapshot_data TEXT NOT NULL,
  captured_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_campaign ON campaign_snapshots(campaign_id, captured_at);
