import { Database } from 'sql.js';

/**
 * Seeds default data into the database if tables are empty.
 * Called once during database initialization after schema and migrations.
 *
 * @param db - The sql.js Database instance
 * @param saveFn - Callback to persist the database to disk
 */
export function seedDefaults(db: Database, saveFn: () => void): void {
  seedCompanies(db);
  seedIntegrations(db);
  seedCompanyPlaybooks(db);
  seedBmnEnrichmentConfig(db);
  seedBmnPipelines(db);
  seedGpcPipelines(db);
  seedBmnAbTest(db);
  saveFn();
}

function seedCompanies(db: Database): void {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM companies');
  stmt.step();
  const companyCount = (stmt.getAsObject() as any).count;
  stmt.free();

  if (companyCount === 0) {
    db.run(`INSERT INTO companies (name, type, color, ghl_location_id) VALUES ('Granite Park Capital', 'client', '#3b82f6', 'x8XBOACL6wOFcsQewWPw')`);
    db.run(`INSERT INTO companies (name, type, color, ghl_location_id) VALUES ('Brand Me Now', 'client', '#8b5cf6', 'xK1e5YGQ7gK6NjoyhyRI')`);
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
}

function seedIntegrations(db: Database): void {
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
}

function seedCompanyPlaybooks(db: Database): void {
  const pbStmt = db.prepare('SELECT COUNT(*) as count FROM company_playbooks');
  pbStmt.step();
  const pbCount = (pbStmt.getAsObject() as any).count;
  pbStmt.free();

  if (pbCount === 0) {
    // Granite Park Capital (companyId: 1)
    db.run(`INSERT INTO company_playbooks (company_id, company_name, sender_name, company_description, value_propositions, target_icp, tone, objection_handlers, conversation_goals, escalation_triggers, do_not_mention, compliance_rules, booking_url, max_auto_replies) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      'Granite Park Capital',
      'Colby',
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
      JSON.stringify([
        'NEVER guarantee specific returns. Use "targeting" or "projected" — never "will earn", "guaranteed", or "you\'ll get"',
        'NEVER provide tax advice, legal advice, or specific financial advice — always recommend consulting their CPA/attorney',
        'NEVER discuss specific investor information or other LPs',
        'NEVER make forward-looking guarantees about fund performance',
        'If the prospect asks about risks, be transparent: real estate carries risks including illiquidity and potential loss of principal',
        'If the prospect asks for PPM, subscription docs, or detailed fund legal terms — escalate to human',
        'Use "past performance is not indicative of future results" if referencing Fund I track record',
      ]),
      null,
      3
    ]);

    // Brand Me Now (companyId: 2)
    db.run(`INSERT INTO company_playbooks (company_id, company_name, sender_name, company_description, value_propositions, target_icp, tone, objection_handlers, conversation_goals, escalation_triggers, do_not_mention, compliance_rules, booking_url, max_auto_replies) VALUES (2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      'Brand Me Now',
      'Ryan',
      'Brand Me Now is an AI-powered brand creation platform for influencers and creators. We handle everything — product development, manufacturing, fulfillment, and brand design. Creators get their own branded product line with zero inventory risk and earn industry-leading royalties on every sale.',
      JSON.stringify([
        'Zero inventory risk — we handle manufacturing and fulfillment',
        'Your own branded product line, not generic merch',
        '200+ SKU catalog across beauty, wellness, lifestyle, and apparel',
        'Industry-leading royalties on every sale — true passive income',
        'AI-powered brand design tailored to your audience',
        'Full-service: product development to customer shipping'
      ]),
      'Influencers and content creators with 10K+ followers across Instagram, TikTok, YouTube, or other platforms. Creators looking to monetize beyond sponsorships and ad revenue.',
      'friendly',
      JSON.stringify({
        'already_have_merch': 'We are different from merch — we create an actual branded product line (beauty, wellness, lifestyle) that reflects your personal brand. Think of it as launching your own brand, not just slapping a logo on a t-shirt.',
        'too_busy': 'That is exactly why we built this — it is fully managed. We handle product development, manufacturing, and fulfillment. You just promote to your audience like you already do.',
        'sounds_too_good': 'We make money when you make money — our model is built on the margin between manufacturing and retail. Your royalties are baked into every sale automatically, and the rates are extremely competitive compared to anything else in the creator space.',
        'not_enough_followers': 'We have seen creators with engaged audiences of 10K+ do really well. It is about engagement quality, not just follower count.',
        'not_interested': 'Totally understand! If you ever want to explore launching your own product line, we are here. No pressure at all.'
      }),
      JSON.stringify(['schedule_platform_demo', 'get_creator_social_handles', 'qualify_audience_size', 'send_case_studies']),
      JSON.stringify(['specific_contract_terms', 'legal_questions', 'specific_date_time_meeting', 'complaint_or_threat']),
      JSON.stringify(['specific_revenue_guarantees', 'other_creator_earnings', 'internal_margins', 'specific_royalty_percentages', '20%', 'twenty percent', 'exact_commission_rates']),
      null, // no compliance rules for BMN
      'https://api.leadconnectorhq.com/widget/bookings/brand-me-now-sales',
      3
    ]);

    // Tikkun (companyId: 4)
    db.run(`INSERT INTO company_playbooks (company_id, company_name, sender_name, company_description, value_propositions, target_icp, tone, objection_handlers, conversation_goals, escalation_triggers, do_not_mention, compliance_rules, booking_url, max_auto_replies) VALUES (4, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      'Tikkun',
      'Colby',
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
      null, // no compliance rules for Tikkun
      null,
      3
    ]);

    console.log('[DB] Seeded company playbooks');
  }
}

function seedBmnEnrichmentConfig(db: Database): void {
  const bmnConfig = db.prepare('SELECT auto_reply_enabled FROM enrichment_config WHERE company_id = 2');
  if (bmnConfig.step()) {
    const row = bmnConfig.getAsObject() as any;
    if (!row.auto_reply_enabled) {
      db.run(
        `UPDATE enrichment_config SET auto_reply_enabled = 1, auto_reply_sentiments = ?, target_instantly_campaign_id = ?, updated_at = datetime('now') WHERE company_id = 2`,
        [
          JSON.stringify(['interested', 'question', 'meeting_request', 'positive']),
          '542243a5-f75a-441a-b311-f5ff0dbf8e3e', // BMN Influencers campaign
        ]
      );
      console.log('[DB] Enabled auto-reply for BMN (company_id=2)');
    }
  } else {
    // Create config row if it doesn't exist
    db.run(
      `INSERT INTO enrichment_config (company_id, enabled, auto_enrich, auto_push_ghl, auto_reply_enabled, auto_reply_sentiments, target_instantly_campaign_id) VALUES (2, 1, 1, 1, 1, ?, ?)`,
      [
        JSON.stringify(['interested', 'question', 'meeting_request', 'positive']),
        '542243a5-f75a-441a-b311-f5ff0dbf8e3e',
      ]
    );
    console.log('[DB] Created enrichment_config for BMN (company_id=2) with auto-reply enabled');
  }
  bmnConfig.free();
}

function seedBmnPipelines(db: Database): void {
  const bmnPipelineCount = db.prepare('SELECT COUNT(*) as count FROM company_pipelines WHERE company_id = 2');
  bmnPipelineCount.step();
  const pipelineCount = (bmnPipelineCount.getAsObject() as any).count;
  bmnPipelineCount.free();

  if (pipelineCount === 0) {
    // Creator Investment Funnel — mapped to Influencers Instantly campaign (default)
    db.run(
      `INSERT INTO company_pipelines (company_id, pipeline_name, ghl_pipeline_id, instantly_campaign_id, stage_map, monetary_value, is_default) VALUES (2, ?, ?, ?, ?, ?, 1)`,
      [
        'Creator Investment Funnel',
        'By4LcF6zNdTaxAC1O8Ad',
        '542243a5-f75a-441a-b311-f5ff0dbf8e3e', // Influencers campaign
        JSON.stringify({
          positive_reply: '75c0a71b-bba7-45fe-abdb-b751317afa30',
          appt_booked: '6f44609d-7bf2-426e-ad37-50b83e0a0ac4',
          application_received: '87f935a4-485d-4f00-800e-14ff73494459',
          brand_builder_started: '353d6b67-e8fb-4872-87ed-5a5dc827b864',
          brand_builder_finished: '94938168-7775-48f7-8030-049e8c2c693b',
          manual_review: 'babecf3c-b51a-4174-9c75-65344266d732',
          approved: 'e4710b8c-ba21-4043-97fd-9ed6ef85a95e',
          rejected: '3c5e2aaf-1896-405f-a49e-0736a17ecef1',
        }),
        0,
      ]
    );

    // Agency Partner Funnel — mapped to Agencies Instantly campaign
    db.run(
      `INSERT INTO company_pipelines (company_id, pipeline_name, ghl_pipeline_id, instantly_campaign_id, stage_map, monetary_value, is_default) VALUES (2, ?, ?, ?, ?, ?, 0)`,
      [
        'Agency Partner Funnel',
        'ChG0j1v34xGZDI7bp9Km',
        '3f481ba8-ea1f-48af-afa7-2e2179cb78bd', // Agencies campaign
        JSON.stringify({
          positive_reply: 'dd276576-8047-4550-b905-5317e90d5b70',
          engaged: '723b2fcd-5cc2-442a-9220-ecd07ec3837a',
          discovery_scheduled: '8082abbd-1dd0-4501-9795-84c5ed772682',
          discovery_completed: '76b5e9a1-5492-4624-863f-11d4d5ed4000',
          proposal_sent: '8a7a862e-e5b8-4e2f-ac32-153e07fec4bc',
          negotiation: '30c99e6c-f53e-4d8f-942f-1ea8e5ea71ba',
          agreement_signed: '08c066f7-2d15-4ad1-860d-fb328167d8c8',
          onboarding: '6a708619-b7f5-4c23-a818-e371a58fd2e6',
          lost: 'd0f2429f-fd5f-4fb6-955a-3f800ec6a4fe',
        }),
        0,
      ]
    );

    // Creator Investment Funnel v2 — mapped to Influencer 2 Campaign (Skin Care)
    db.run(
      `INSERT INTO company_pipelines (company_id, pipeline_name, ghl_pipeline_id, instantly_campaign_id, stage_map, monetary_value, is_default) VALUES (2, ?, ?, ?, ?, ?, 0)`,
      [
        'Creator Investment Funnel',
        'By4LcF6zNdTaxAC1O8Ad',
        '08c32856-d624-4e3a-b7da-04d7357b8e54', // Influencer 2 Campaign (Skin Care)
        JSON.stringify({
          positive_reply: '75c0a71b-bba7-45fe-abdb-b751317afa30',
          appt_booked: '6f44609d-7bf2-426e-ad37-50b83e0a0ac4',
          application_received: '87f935a4-485d-4f00-800e-14ff73494459',
          brand_builder_started: '353d6b67-e8fb-4872-87ed-5a5dc827b864',
          brand_builder_finished: '94938168-7775-48f7-8030-049e8c2c693b',
          manual_review: 'babecf3c-b51a-4174-9c75-65344266d732',
          approved: 'e4710b8c-ba21-4043-97fd-9ed6ef85a95e',
          rejected: '3c5e2aaf-1896-405f-a49e-0736a17ecef1',
        }),
        0,
      ]
    );

    console.log('[DB] Seeded BMN company_pipelines (Creator Investment + Agency Partner + Influencer 2 funnels)');
  }

  // Ensure Influencer 2 Campaign mapping exists (added after initial seed)
  const bmn2Check = db.prepare(
    "SELECT id FROM company_pipelines WHERE instantly_campaign_id = '08c32856-d624-4e3a-b7da-04d7357b8e54'"
  );
  const hasBmn2 = bmn2Check.step();
  bmn2Check.free();

  if (!hasBmn2) {
    db.run(
      `INSERT INTO company_pipelines (company_id, pipeline_name, ghl_pipeline_id, instantly_campaign_id, stage_map, monetary_value, is_default) VALUES (2, ?, ?, ?, ?, ?, 0)`,
      [
        'Creator Investment Funnel',
        'By4LcF6zNdTaxAC1O8Ad',
        '08c32856-d624-4e3a-b7da-04d7357b8e54',
        JSON.stringify({
          positive_reply: '75c0a71b-bba7-45fe-abdb-b751317afa30',
          appt_booked: '6f44609d-7bf2-426e-ad37-50b83e0a0ac4',
          application_received: '87f935a4-485d-4f00-800e-14ff73494459',
          brand_builder_started: '353d6b67-e8fb-4872-87ed-5a5dc827b864',
          brand_builder_finished: '94938168-7775-48f7-8030-049e8c2c693b',
          manual_review: 'babecf3c-b51a-4174-9c75-65344266d732',
          approved: 'e4710b8c-ba21-4043-97fd-9ed6ef85a95e',
          rejected: '3c5e2aaf-1896-405f-a49e-0736a17ecef1',
        }),
        0,
      ]
    );
    console.log('[DB] Added BMN Influencer 2 Campaign pipeline mapping');
  }
}

function seedGpcPipelines(db: Database): void {
  const gpcPipelineCount = db.prepare('SELECT COUNT(*) as count FROM company_pipelines WHERE company_id = 1');
  gpcPipelineCount.step();
  const gpcPipelineExists = (gpcPipelineCount.getAsObject() as any).count;
  gpcPipelineCount.free();

  if (gpcPipelineExists === 0) {
    db.run(
      `INSERT INTO company_pipelines (company_id, pipeline_name, ghl_pipeline_id, instantly_campaign_id, stage_map, monetary_value, is_default) VALUES (1, ?, ?, ?, ?, ?, 1)`,
      [
        'Cold Email Response Pipeline',
        'hN3fT6V8135hCKJs8oXN',
        '2e3af84a-8f6f-4446-981c-f10bb2348216', // GPC Instantly campaign
        JSON.stringify({
          new_reply: '626aaea5-7a02-4634-a54a-f652fa4e2468',
          qualified: '975e30cc-03f6-436b-ac42-0bbf06b01f66',
          meeting_scheduled: 'd6e7a458-ac49-42c1-a656-fa002eb924a7',
          meeting_completed: '562069cc-59d7-453f-b9af-dfd101d86337',
          proposal_sent: 'c1061437-b448-45b4-bf14-8017ed6721e1',
          won: 'aec87c1a-9f79-4b73-9d91-0224ada21f9c',
          lost: '09d39d51-65f5-4a7d-bdcb-c57f49d022da',
        }),
        250000,
      ]
    );
    console.log('[DB] Seeded GPC company_pipelines (Cold Email Response Pipeline)');
  }
}

function seedBmnAbTest(db: Database): void {
  const bmnAbTest = db.prepare("SELECT COUNT(*) as count FROM ab_tests WHERE company_id = 2 AND test_type = 'cta_style' AND status = 'active'");
  bmnAbTest.step();
  const bmnAbCount = (bmnAbTest.getAsObject() as any).count;
  bmnAbTest.free();

  if (bmnAbCount === 0) {
    db.run(
      `INSERT INTO ab_tests (company_id, name, test_name, test_type, status) VALUES (2, ?, ?, 'cta_style', 'active')`,
      ['BMN Creator CTA Split', 'BMN Creator CTA Split']
    );

    // Get the test ID we just inserted
    const lastId = db.prepare('SELECT last_insert_rowid() as id');
    lastId.step();
    const testId = (lastId.getAsObject() as any).id;
    lastId.free();

    // Variant A: Push booking link (book a call)
    db.run(
      `INSERT INTO ab_test_variants (test_id, variant_name, description, config) VALUES (?, ?, ?, ?)`,
      [
        testId,
        'book_a_call',
        'Push creator to book a discovery call via scheduling link',
        JSON.stringify({
          cta_instruction: 'Your goal is to get the creator on a discovery call. Share the booking link and encourage them to grab a time. Frame it as a quick, casual chat to walk them through how it works. Keep it low-pressure.',
          cta_type: 'booking_link',
        }),
      ]
    );

    // Variant B: Push Brand Builder application
    db.run(
      `INSERT INTO ab_test_variants (test_id, variant_name, description, config) VALUES (?, ?, ?, ?)`,
      [
        testId,
        'brand_builder',
        'Push creator to start the Brand Builder application to get their own product line',
        JSON.stringify({
          cta_instruction: 'Your goal is to get the creator excited about launching their own brand and direct them to start the Brand Builder application. Frame it as the first step to getting their own product line — it only takes a few minutes and lets us tailor everything to their audience. Share the Brand Builder link and make it feel like an exciting next step, not a chore.',
          cta_type: 'brand_builder',
        }),
      ]
    );

    console.log('[DB] Seeded BMN A/B test: Book a Call vs Brand Builder CTA');
  }
}
