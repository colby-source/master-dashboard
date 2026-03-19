-- Daily email reports table
CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK(report_type IN ('morning', 'evening')),
  data_json TEXT NOT NULL,
  html TEXT NOT NULL,
  sent_to TEXT NOT NULL,
  sent_at TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_type ON daily_reports(report_type);
