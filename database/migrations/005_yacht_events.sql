-- Yacht mixer event check-in system

CREATE TABLE IF NOT EXISTS yacht_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,          -- ISO date (YYYY-MM-DD)
  location TEXT DEFAULT 'The Deck at Island Gardens, Miami',
  yacht_name TEXT DEFAULT 'TYCOON',
  max_capacity INTEGER DEFAULT 50,
  status TEXT DEFAULT 'upcoming',    -- upcoming, active, completed, cancelled
  check_in_code TEXT UNIQUE,         -- short code for QR URL (e.g., 'yacht-2026-03-12')
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS yacht_event_attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES yacht_events(id),
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  company TEXT,
  ghl_contact_id TEXT,
  enrichment_lead_id INTEGER,
  status TEXT DEFAULT 'invited',     -- invited, confirmed, checked_in, no_show
  checked_in_at TEXT,
  vip_flag INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, email)
);

CREATE INDEX IF NOT EXISTS idx_yacht_events_code ON yacht_events(check_in_code);
CREATE INDEX IF NOT EXISTS idx_yacht_attendees_event ON yacht_event_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_yacht_attendees_email ON yacht_event_attendees(email);
