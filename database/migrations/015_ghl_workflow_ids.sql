-- Add GHL workflow ID columns to enrichment_config
ALTER TABLE enrichment_config ADD COLUMN ghl_interested_workflow_id TEXT;
ALTER TABLE enrichment_config ADD COLUMN ghl_meeting_workflow_id TEXT;
