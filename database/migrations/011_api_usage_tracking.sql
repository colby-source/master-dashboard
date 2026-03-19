-- API usage and spend tracking
CREATE TABLE IF NOT EXISTS api_usage_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    call_type TEXT NOT NULL,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    credits_used INTEGER,
    lead_id INTEGER REFERENCES enrichment_leads(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_usage_provider ON api_usage_tracking(provider);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage_tracking(created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_lead ON api_usage_tracking(lead_id);
