-- Migration 018: Equipment Finder — auction-specific fields
-- Adds columns required for auction-house listings (Bidspotter, GovDeals, Ritchie Bros, etc.)
-- These are all nullable so existing rows remain valid.

ALTER TABLE equipment_listings ADD COLUMN starting_bid REAL;
ALTER TABLE equipment_listings ADD COLUMN buyer_premium_pct REAL;
ALTER TABLE equipment_listings ADD COLUMN lot_number TEXT;
ALTER TABLE equipment_listings ADD COLUMN auction_house TEXT;
ALTER TABLE equipment_listings ADD COLUMN bidding_opens_at TEXT;

CREATE INDEX IF NOT EXISTS idx_equipment_auction_end ON equipment_listings(auction_end_time);
CREATE INDEX IF NOT EXISTS idx_equipment_auction_house ON equipment_listings(auction_house);
