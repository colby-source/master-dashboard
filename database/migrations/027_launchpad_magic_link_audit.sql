-- 027_launchpad_magic_link_audit.sql
--
-- Adds a per-redemption audit trail for magic links. The links table stores
-- only first_used_at + last_used_at + use_count — that's enough for staleness
-- checks but loses signal on token theft (e.g., a leaked link being redeemed
-- from an unfamiliar IP/region).
--
-- This table records every successful verifyToken() call with IP + UA so a
-- support engineer can spot anomalies after the fact.

CREATE TABLE IF NOT EXISTS launchpad_magic_link_redemptions (
  id          TEXT PRIMARY KEY,
  link_id     TEXT NOT NULL,
  brand_id    TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  redeemed_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (link_id)  REFERENCES launchpad_magic_links(id),
  FOREIGN KEY (brand_id) REFERENCES launchpad_brands(id)
);

CREATE INDEX IF NOT EXISTS idx_lpmlr_link_id     ON launchpad_magic_link_redemptions(link_id);
CREATE INDEX IF NOT EXISTS idx_lpmlr_brand_id    ON launchpad_magic_link_redemptions(brand_id);
CREATE INDEX IF NOT EXISTS idx_lpmlr_redeemed_at ON launchpad_magic_link_redemptions(redeemed_at);
