-- Warmup monitor status table (singleton row)
CREATE TABLE IF NOT EXISTS warmup_status (
  id INTEGER PRIMARY KEY DEFAULT 1,
  status_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
