-- Add performance indexes across core tables
CREATE INDEX IF NOT EXISTS idx_companies_ghl_location ON companies(ghl_location_id);
CREATE INDEX IF NOT EXISTS idx_agents_company ON agents(company_id);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_events_lead_type ON enrichment_events(enrichment_lead_id, event_type);
CREATE INDEX IF NOT EXISTS idx_enrichment_leads_source ON enrichment_leads(source);
CREATE INDEX IF NOT EXISTS idx_enrichment_leads_instantly_status ON enrichment_leads(instantly_push_status);
CREATE INDEX IF NOT EXISTS idx_reply_threads_company ON reply_threads(company_id);
CREATE INDEX IF NOT EXISTS idx_bulk_imports_company ON bulk_imports(company_id);
CREATE INDEX IF NOT EXISTS idx_bulk_imports_status ON bulk_imports(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_external_id ON campaigns(external_id);
