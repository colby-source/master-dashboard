-- Add warm intro tracking fields to enrichment_leads
ALTER TABLE enrichment_leads ADD COLUMN referral_source TEXT;
ALTER TABLE enrichment_leads ADD COLUMN introduced_by TEXT;

-- Add enrichment completeness score (0-100)
ALTER TABLE enrichment_leads ADD COLUMN enrichment_completeness INTEGER DEFAULT 0;
