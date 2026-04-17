-- Migration 017: Equipment Finder
-- Adds tables for aggregated equipment listings, deal scores, alerts, and market price cache.

CREATE TABLE IF NOT EXISTS equipment_listings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',

  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  make TEXT,
  model TEXT,
  year INTEGER,
  hours INTEGER,
  mileage INTEGER,
  serial_number TEXT,

  price REAL,
  is_auction INTEGER NOT NULL DEFAULT 0,
  auction_end_time TEXT,
  current_bid REAL,
  buy_now_price REAL,

  condition TEXT NOT NULL DEFAULT 'unknown',

  location_city TEXT,
  location_state TEXT,
  location_zip TEXT,
  location_lat REAL,
  location_lng REAL,

  seller_name TEXT,
  seller_is_dealer INTEGER NOT NULL DEFAULT 0,
  seller_url TEXT,

  image_urls TEXT NOT NULL DEFAULT '[]',    -- JSON array
  image_count INTEGER NOT NULL DEFAULT 0,

  listed_date TEXT,
  days_on_market INTEGER,

  scraped_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,

  raw_data TEXT,                             -- JSON blob

  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_source ON equipment_listings(source);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON equipment_listings(category);
CREATE INDEX IF NOT EXISTS idx_equipment_make_model ON equipment_listings(make, model);
CREATE INDEX IF NOT EXISTS idx_equipment_price ON equipment_listings(price);
CREATE INDEX IF NOT EXISTS idx_equipment_location ON equipment_listings(location_state);
CREATE INDEX IF NOT EXISTS idx_equipment_scraped ON equipment_listings(scraped_at);

CREATE TABLE IF NOT EXISTS equipment_deal_scores (
  listing_id TEXT PRIMARY KEY,
  score REAL NOT NULL,
  tier TEXT NOT NULL,
  price_score REAL NOT NULL DEFAULT 0,
  urgency_score REAL NOT NULL DEFAULT 0,
  hidden_score REAL NOT NULL DEFAULT 0,
  quality_score REAL NOT NULL DEFAULT 0,
  geo_score REAL NOT NULL DEFAULT 0,
  seller_score REAL NOT NULL DEFAULT 0,
  price_vs_market_pct REAL,
  market_avg_price REAL,
  comparable_count INTEGER NOT NULL DEFAULT 0,
  signals TEXT NOT NULL DEFAULT '[]',       -- JSON array
  summary TEXT NOT NULL DEFAULT '',
  suggested_action TEXT NOT NULL DEFAULT '',
  negotiation_notes TEXT NOT NULL DEFAULT '',
  scored_at TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES equipment_listings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_equipment_deal_scores_score ON equipment_deal_scores(score);

CREATE TABLE IF NOT EXISTS equipment_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  raw_query TEXT NOT NULL,
  parsed_query TEXT NOT NULL,                -- JSON blob of SearchQuery
  frequency TEXT NOT NULL DEFAULT 'daily',
  min_deal_score REAL NOT NULL DEFAULT 60,
  is_active INTEGER NOT NULL DEFAULT 1,
  telegram_chat_id TEXT,
  email TEXT,
  last_triggered TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_alerts_active ON equipment_alerts(is_active, frequency);

CREATE TABLE IF NOT EXISTS equipment_market_prices (
  id TEXT PRIMARY KEY,
  equipment_type TEXT NOT NULL,
  make TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  year_range TEXT NOT NULL DEFAULT '',
  avg_price REAL NOT NULL,
  median_price REAL NOT NULL,
  low_price REAL NOT NULL,
  high_price REAL NOT NULL,
  price_std_dev REAL NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL,
  cheapest_states TEXT NOT NULL DEFAULT '[]',
  most_expensive_states TEXT NOT NULL DEFAULT '[]',
  regional_spread_pct REAL NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL,
  UNIQUE (equipment_type, make, model, year_range)
);

CREATE TABLE IF NOT EXISTS equipment_search_history (
  id TEXT PRIMARY KEY,
  raw_query TEXT NOT NULL,
  parsed_query TEXT,
  total_found INTEGER NOT NULL DEFAULT 0,
  top_score REAL,
  sources_searched TEXT NOT NULL DEFAULT '[]',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  searched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_search_history_date ON equipment_search_history(searched_at);
