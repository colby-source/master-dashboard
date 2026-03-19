-- Add default_campaign_id and auto_approve_threshold to enrichment_config
-- for auto-approving high-scoring leads for cold email
ALTER TABLE enrichment_config ADD COLUMN default_campaign_id TEXT;
ALTER TABLE enrichment_config ADD COLUMN auto_approve_threshold INTEGER DEFAULT 70;
