-- Instantly email health audit results
CREATE TABLE IF NOT EXISTS instantly_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_data TEXT NOT NULL,
    ok_count INTEGER DEFAULT 0,
    warning_count INTEGER DEFAULT 0,
    critical_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_instantly_audits_created ON instantly_audits(created_at);
