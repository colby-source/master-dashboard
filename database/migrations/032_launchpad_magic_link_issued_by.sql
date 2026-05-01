-- 032_launchpad_magic_link_issued_by.sql
--
-- Phase 2.4 Feature 5: magic-link operator attribution.
-- Adds issued_by_email so we can audit *who* sent any given link to a creator.
-- Critical when multiple ops people (Ryan for BMN, Colby for GPC) issue links —
-- without this, a brand can have 5 active links and no record of who's the
-- relationship owner.

ALTER TABLE launchpad_magic_links ADD COLUMN issued_by_email TEXT;
