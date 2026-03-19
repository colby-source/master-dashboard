import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { config } from './config';

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  if (fs.existsSync(config.dbPath)) {
    const buffer = fs.readFileSync(config.dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  // Run schema
  const schemaPath = path.join(__dirname, '../database/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.run(schema);
  }

  // Seed default companies if empty
  const stmt = db.prepare('SELECT COUNT(*) as count FROM companies');
  stmt.step();
  const companyCount = (stmt.getAsObject() as any).count;
  stmt.free();
  if (companyCount === 0) {
    db.run(`INSERT INTO companies (name, type, color, ghl_location_id) VALUES ('Grand Park Capital', 'client', '#3b82f6', 'x8XBOACL6wOFcsQewWPw')`);
    db.run(`INSERT INTO companies (name, type, color, ghl_location_id) VALUES ('Brand New Now', 'client', '#8b5cf6', 'xK1e5YGQ7gK6NjoyhyRI')`);
    db.run(`INSERT INTO companies (name, type, color, ghl_location_id) VALUES ('Tikkun', 'personal', '#10b981', 'EC0ziFgLtYbHvpLv1ymi')`);
    console.log('[DB] Seeded default companies');
  } else {
    // Ensure Tikkun exists
    const tikkunStmt = db.prepare("SELECT id FROM companies WHERE name = 'Tikkun'");
    const hasTikkun = tikkunStmt.step();
    tikkunStmt.free();
    if (!hasTikkun) {
      db.run(`INSERT INTO companies (name, type, color, ghl_location_id) VALUES ('Tikkun', 'personal', '#10b981', 'EC0ziFgLtYbHvpLv1ymi')`);
      console.log('[DB] Added Tikkun company');
    }
  }

  // Seed default integrations if empty
  const intStmt = db.prepare('SELECT COUNT(*) as count FROM integrations');
  intStmt.step();
  const intCount = (intStmt.getAsObject() as any).count;
  intStmt.free();
  if (intCount === 0) {
    db.run(`INSERT INTO integrations (name, type, status) VALUES ('instantly', 'email', 'active')`);
    db.run(`INSERT INTO integrations (name, type, status) VALUES ('ghl', 'crm', 'active')`);
    db.run(`INSERT INTO integrations (name, type, status) VALUES ('openclaw', 'automation', 'active')`);
    db.run(`INSERT INTO integrations (name, type, status) VALUES ('meta_ads', 'advertising', 'pending')`);
    db.run(`INSERT INTO integrations (name, type, status) VALUES ('competitors', 'monitoring', 'active')`);
    db.run(`INSERT INTO integrations (name, type, status) VALUES ('enrichment', 'enrichment', 'active')`);
    console.log('[DB] Seeded default integrations');
  }

  // Migrate: add auto_reply columns to enrichment_config
  try {
    db.run(`ALTER TABLE enrichment_config ADD COLUMN auto_reply_enabled INTEGER DEFAULT 0`);
  } catch { /* column already exists */ }
  try {
    db.run(`ALTER TABLE enrichment_config ADD COLUMN auto_reply_sentiments TEXT DEFAULT '["interested","question","meeting_request"]'`);
  } catch { /* column already exists */ }

  // Migrate: add ab_variant to enrichment_leads
  try {
    db.run(`ALTER TABLE enrichment_leads ADD COLUMN ab_variant TEXT`);
  } catch { /* column already exists */ }

  // Migrate: add GHL opportunity pipeline config columns
  try {
    db.run(`ALTER TABLE enrichment_config ADD COLUMN ghl_pipeline_id TEXT`);
  } catch { /* column already exists */ }
  try {
    db.run(`ALTER TABLE enrichment_config ADD COLUMN ghl_pipeline_stages TEXT`);
  } catch { /* column already exists */ }

  // Migrate: add GHL opportunity tracking to enrichment_leads
  try {
    db.run(`ALTER TABLE enrichment_leads ADD COLUMN ghl_opportunity_id TEXT`);
  } catch { /* column already exists */ }

  // Migrate: add subject to reply_threads
  try {
    db.run(`ALTER TABLE reply_threads ADD COLUMN subject TEXT`);
  } catch { /* column already exists */ }

  // Migrate: add LinkedIn outreach columns to enrichment_leads
  try {
    db.run(`ALTER TABLE enrichment_leads ADD COLUMN linkedin_outreach_status TEXT DEFAULT 'none'`);
  } catch { /* column already exists */ }
  try {
    db.run(`ALTER TABLE enrichment_leads ADD COLUMN linkedin_message TEXT`);
  } catch { /* column already exists */ }

  // Migrate: add LinkedIn sequence columns to enrichment_leads
  try {
    db.run(`ALTER TABLE enrichment_leads ADD COLUMN linkedin_connected_at TEXT`);
  } catch { /* column already exists */ }
  try {
    db.run(`ALTER TABLE enrichment_leads ADD COLUMN linkedin_sequence_step INTEGER DEFAULT 0`);
  } catch { /* column already exists */ }
  try {
    db.run(`ALTER TABLE enrichment_leads ADD COLUMN linkedin_last_dm_at TEXT`);
  } catch { /* column already exists */ }
  try {
    db.run(`ALTER TABLE enrichment_leads ADD COLUMN linkedin_dm_reply_at TEXT`);
  } catch { /* column already exists */ }

  // Create LinkedIn DM sequence messages table
  db.run(`CREATE TABLE IF NOT EXISTS linkedin_dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES enrichment_leads(id) ON DELETE CASCADE,
    step INTEGER NOT NULL,
    direction TEXT NOT NULL DEFAULT 'outbound',
    message TEXT NOT NULL,
    sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_linkedin_dm_lead ON linkedin_dm_messages(lead_id)`);

  // Create campaign snapshots table for performance tracking
  db.run(`CREATE TABLE IF NOT EXISTS campaign_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    snapshot_data TEXT NOT NULL,
    captured_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_campaign ON campaign_snapshots(campaign_id, captured_at)`);

  // Seed company playbooks if empty
  const pbStmt = db.prepare('SELECT COUNT(*) as count FROM company_playbooks');
  pbStmt.step();
  const pbCount = (pbStmt.getAsObject() as any).count;
  pbStmt.free();
  if (pbCount === 0) {
    // Grand Park Capital (companyId: 1)
    db.run(`INSERT INTO company_playbooks (company_id, company_description, value_propositions, target_icp, tone, objection_handlers, conversation_goals, escalation_triggers, do_not_mention, booking_url, max_auto_replies) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      'Granite Park Capital Affordable Housing Fund II, L.P. — a 4th-generation real estate fund ($50M target, $100M hard cap). We acquire and operate Section 8 and LIHTC multifamily affordable and workforce housing NATIONWIDE. GP: Marc Menowitz, 4th-generation multifamily operator, 20+ years experience. Apartment Corp manages 17,000+ units (~$2B portfolio), including 5,500 units with Section 8 contracts. Fund I delivered 179% return on equity in just 2 years. Fund II terms: 7% preferred return, quarterly distributions, $250K minimum, accredited investors only. Government-backed rents through Section 8 HAP contracts. Powerful tax strategies: LIHTC credits (dollar-for-dollar federal tax offsets), cost segregation, and accelerated depreciation.',
      JSON.stringify([
        'Fund I delivered 179% return on equity in just 2 years — Fund II builds on that proven performance',
        'Government-backed rental income through Section 8 HAP contracts — recession-resistant, federally guaranteed',
        'LIHTC tax credits — dollar-for-dollar offsets against federal tax liability that alleviate your tax burden',
        'Cost segregation and accelerated depreciation strategies for additional tax savings',
        '4th-generation real estate family: Marc Menowitz, 20+ years, 17,000+ units (~$2B portfolio), 5,500 Section 8 units',
        'Quarterly distributions backed by government-contracted income',
        'Nationwide strategy — not concentrated in any single market'
      ]),
      'Accredited investors, CPAs/accountants, family offices, wealth managers, RIAs, high-net-worth individuals interested in alternative investments, real estate investors seeking passive income with government-backed downside protection.',
      'authoritative',
      JSON.stringify({
        'too_risky': 'Our properties are backed by government Section 8 HAP contracts providing guaranteed rental income. Marc Menowitz\'s family has operated multifamily housing for three generations — 17,000+ units, ~$2B portfolio. Housing is one of the most recession-resistant asset classes.',
        'minimum_too_high': 'The $250K minimum reflects the institutional quality of our fund structure. I can share our fund deck so you can review the returns, track record, and structure before any commitment.',
        'need_more_info': 'Absolutely — I can send you our investor deck with full details on strategy, track record, and projected returns. Would you also like to schedule a brief call with Marc?',
        'already_invested_elsewhere': 'Many of our LPs hold positions in other funds. What makes Fund II unique is government-backed income (Section 8) combined with LIHTC tax credits that offset your taxes dollar-for-dollar. Fund I delivered 179% return on equity in 2 years — that track record speaks for itself.',
        'not_interested': 'No problem at all. If your allocation strategy changes or you want to explore affordable housing as an asset class in the future, feel free to reach out.',
        'returns_too_low': 'The 7% preferred is just the cash-on-cash floor. Fund I delivered 179% return on equity in 2 years when you factor in appreciation, LIHTC tax credits, cost segregation, and depreciation benefits. The income is backed by government contracts, which is rare at this yield.',
        'whats_the_tax_benefit': 'Fund II generates Low Income Housing Tax Credits (LIHTC) — these are dollar-for-dollar offsets against your federal tax liability, not deductions. For a high-income investor in the 37% bracket, the tax benefit alone can represent a significant portion of total return.',
        'how_is_this_different': 'Three things: (1) government-guaranteed income via Section 8, (2) dollar-for-dollar LIHTC tax credits, and (3) a 3rd-generation operator with 17,000+ units. Most RE funds don\'t offer all three.'
      }),
      JSON.stringify(['book_call_with_marc', 'send_fund_deck', 'qualify_accredited_status', 'get_phone_number', 'schedule_yacht_event']),
      JSON.stringify(['specific_legal_questions', 'tax_advice_requests', 'specific_date_time_meeting', 'complaint_or_threat', 'request_for_ppm_or_subscription_docs']),
      JSON.stringify(['specific_return_guarantees_as_promises', 'competitor_fund_names', 'individual_investor_information', 'unverified_performance_claims', 'fund_I_specific_unit_counts_or_properties', 'any_specific_state_names_for_fund_II_properties']),
      null,
      3
    ]);

    // Brand Me Now (companyId: 2)
    db.run(`INSERT INTO company_playbooks (company_id, company_description, value_propositions, target_icp, tone, objection_handlers, conversation_goals, escalation_triggers, do_not_mention, booking_url, max_auto_replies) VALUES (2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      'Brand Me Now is an AI-powered brand creation platform for influencers and creators. We handle everything — product development, manufacturing, fulfillment, and brand design. Creators get their own branded product line with zero inventory risk and earn 20% royalty on every sale.',
      JSON.stringify([
        'Zero inventory risk — we handle manufacturing and fulfillment',
        'Your own branded product line, not generic merch',
        '200+ SKU catalog across beauty, wellness, lifestyle, and apparel',
        '20% royalty on every sale — true passive income',
        'AI-powered brand design tailored to your audience',
        'Full-service: product development to customer shipping'
      ]),
      'Influencers and content creators with 10K+ followers across Instagram, TikTok, YouTube, or other platforms. Creators looking to monetize beyond sponsorships and ad revenue.',
      'friendly',
      JSON.stringify({
        'already_have_merch': 'We are different from merch — we create an actual branded product line (beauty, wellness, lifestyle) that reflects your personal brand. Think of it as launching your own brand, not just slapping a logo on a t-shirt.',
        'too_busy': 'That is exactly why we built this — it is fully managed. We handle product development, manufacturing, and fulfillment. You just promote to your audience like you already do.',
        'sounds_too_good': 'We make money when you make money — our model is built on the margin between manufacturing and retail. Your 20% royalty is baked into every sale automatically.',
        'not_enough_followers': 'We have seen creators with engaged audiences of 10K+ do really well. It is about engagement quality, not just follower count.',
        'not_interested': 'Totally understand! If you ever want to explore launching your own product line, we are here. No pressure at all.'
      }),
      JSON.stringify(['schedule_platform_demo', 'get_creator_social_handles', 'qualify_audience_size', 'send_case_studies']),
      JSON.stringify(['specific_contract_terms', 'legal_questions', 'specific_date_time_meeting', 'complaint_or_threat']),
      JSON.stringify(['specific_revenue_guarantees', 'other_creator_earnings', 'internal_margins']),
      null,
      3
    ]);

    // Tikkun (companyId: 4)
    db.run(`INSERT INTO company_playbooks (company_id, company_description, value_propositions, target_icp, tone, objection_handlers, conversation_goals, escalation_triggers, do_not_mention, booking_url, max_auto_replies) VALUES (4, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      'Tikkun is a construction technology company specializing in prefabricated housing using our patented Core Spine System. We are acquiring ONX Homes/Resia Manufacturing ($48M facility). Our system produces homes at $35K per unit, enabling 960-2000 homes per year from a single microfactory.',
      JSON.stringify([
        '$35K per unit production cost vs $150K+ traditional construction',
        'Patented Core Spine System with 50+ patents',
        'Scalable microfactory model — 960-2000 homes per year per facility',
        'B2B supply model for developers and homebuilders',
        'IP licensing and franchise opportunities',
        'Addresses the 7.2M unit US housing shortage'
      ]),
      'Real estate developers, homebuilders, government housing authorities, affordable housing developers, construction companies looking for prefab solutions, and investors in construction technology.',
      'professional',
      JSON.stringify({
        'already_have_suppliers': 'Our Core Spine System delivers homes at $35K per unit — significantly below traditional construction costs. Many developers use us alongside existing suppliers to increase margin on affordable housing projects.',
        'unproven_technology': 'Our system is backed by 50+ patents and we are acquiring a $48M manufacturing facility (ONX Homes/Resia). The technology has been validated through multiple builds.',
        'not_enough_volume': 'A single microfactory produces 960-2000 homes annually. We also offer IP licensing so you can build your own production facility.',
        'need_more_details': 'I would be happy to share our technical specifications and production data. Would a brief demo of the Core Spine System be helpful?',
        'not_interested': 'Understood. If housing production costs or speed-to-market become priorities for your projects, we would welcome the conversation.'
      }),
      JSON.stringify(['schedule_core_spine_demo', 'send_technical_specs', 'qualify_project_pipeline', 'get_phone_number']),
      JSON.stringify(['specific_pricing_negotiations', 'legal_contract_terms', 'specific_date_time_meeting', 'complaint_or_threat']),
      JSON.stringify(['acquisition_price_details', 'internal_financials', 'competitor_comparisons']),
      null,
      3
    ]);

    console.log('[DB] Seeded company playbooks');
  }

  saveDb(db);
  return db;
}

export function saveDb(database?: Database) {
  const d = database || db;
  if (!d) return;
  const data = d.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(config.dbPath, buffer);
}

// Auto-save every 30 seconds
setInterval(() => saveDb(), 30000);

// Helper to run queries and get results as objects
export function queryAll(sql: string, params: any[] = []): any[] {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function queryOne(sql: string, params: any[] = []): any | null {
  const results = queryAll(sql, params);
  return results[0] || null;
}

export function runSql(sql: string, params: any[] = []) {
  if (!db) throw new Error('Database not initialized');
  if (params.length > 0) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
  } else {
    db.run(sql);
  }
}
