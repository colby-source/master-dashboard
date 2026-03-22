PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    ghl_location_id TEXT,
    instantly_tag TEXT,
    color TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    last_sync TEXT,
    last_error TEXT,
    config_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT,
    name TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    platform TEXT NOT NULL DEFAULT 'instantly',
    status TEXT DEFAULT 'draft',
    stats_json TEXT,
    daily_limit INTEGER,
    account_count INTEGER DEFAULT 0,
    last_synced TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_campaigns_company ON campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_platform ON campaigns(platform);

CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT,
    name TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    config_json TEXT,
    last_run TEXT,
    success_rate REAL DEFAULT 100,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    status TEXT DEFAULT 'running',
    duration_ms INTEGER,
    cost_cents INTEGER,
    output_summary TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    source TEXT DEFAULT 'manual',
    source_id TEXT,
    assignee TEXT,
    status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium',
    due_date TEXT,
    completed_at TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id);

CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    metric_type TEXT NOT NULL,
    value REAL NOT NULL,
    recorded_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_metrics_type ON metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_metrics_company ON metrics(company_id);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'info',
    message TEXT NOT NULL,
    source TEXT,
    entity_type TEXT,
    entity_id TEXT,
    acknowledged INTEGER DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alerts_ack ON alerts(acknowledged);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    action TEXT NOT NULL,
    payload_json TEXT,
    source TEXT,
    actor TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS ai_discoveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    source_url TEXT,
    platform TEXT,
    summary TEXT,
    category TEXT,
    saved INTEGER DEFAULT 0,
    discovered_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meta_ad_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'unknown',
    objective TEXT,
    stats_json TEXT,
    last_synced TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    active INTEGER DEFAULT 1,
    last_checked TEXT,
    last_content_hash TEXT,
    last_title TEXT,
    last_description TEXT,
    last_status_code INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competitor_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competitor_id INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
    change_type TEXT NOT NULL,
    old_hash TEXT,
    new_hash TEXT,
    old_title TEXT,
    new_title TEXT,
    old_description TEXT,
    new_description TEXT,
    detected_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_competitor_changes_comp ON competitor_changes(competitor_id);

CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ── Instagram DM Outreach ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS ig_dm_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    lead_source TEXT,
    lead_source_value TEXT,
    ig_session_cookie TEXT,
    dm_actor_id TEXT DEFAULT 'leeerob/instagram-dm-sender',
    daily_limit INTEGER DEFAULT 20,
    delay_min INTEGER DEFAULT 60,
    delay_max INTEGER DEFAULT 180,
    total_sent INTEGER DEFAULT 0,
    total_replies INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ig_dm_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES ig_dm_campaigns(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    full_name TEXT,
    bio TEXT,
    followers INTEGER,
    following INTEGER,
    engagement_rate REAL,
    profile_pic_url TEXT,
    status TEXT DEFAULT 'pending',
    current_step INTEGER DEFAULT 0,
    last_contacted_at TEXT,
    reply_text TEXT,
    error_message TEXT,
    scraped_data_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ig_dm_leads_campaign ON ig_dm_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ig_dm_leads_status ON ig_dm_leads(status);

CREATE TABLE IF NOT EXISTS ig_dm_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES ig_dm_campaigns(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL DEFAULT 1,
    message_template TEXT NOT NULL,
    delay_hours INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ig_dm_steps_campaign ON ig_dm_steps(campaign_id);

-- ── Data Enrichment Platform ────────────────────────────────────

CREATE TABLE IF NOT EXISTS enrichment_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    ghl_contact_id TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    first_name TEXT,
    last_name TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'pending',
    enrichment_data TEXT,
    score REAL,
    score_label TEXT,
    score_reasoning TEXT,
    tags TEXT,
    ghl_push_status TEXT DEFAULT 'pending',
    instantly_push_status TEXT DEFAULT 'awaiting_approval', -- 'excluded','awaiting_approval','approved','pushed','failed'
    instantly_campaign_id TEXT,
    linkedin_outreach_status TEXT DEFAULT 'none', -- 'none','queued','sent','skipped'
    linkedin_message TEXT,
    referral_source TEXT,
    introduced_by TEXT,
    enrichment_completeness INTEGER DEFAULT 0,
    is_known_contact INTEGER DEFAULT 0,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    enriched_at TEXT,
    scored_at TEXT,
    pushed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_enrichment_leads_status ON enrichment_leads(status);
CREATE INDEX IF NOT EXISTS idx_enrichment_leads_company ON enrichment_leads(company_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_leads_ghl ON enrichment_leads(ghl_contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrichment_leads_email_company ON enrichment_leads(email, company_id);

CREATE TABLE IF NOT EXISTS enrichment_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    response_data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
);

CREATE TABLE IF NOT EXISTS enrichment_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    enabled INTEGER DEFAULT 1,
    auto_enrich INTEGER DEFAULT 1,
    auto_push_ghl INTEGER DEFAULT 1,
    cold_email_requires_approval INTEGER DEFAULT 1,
    score_threshold_hot REAL DEFAULT 80,
    score_threshold_warm REAL DEFAULT 50,
    scoring_prompt TEXT,
    target_instantly_campaign_id TEXT,
    ghl_tag_prefix TEXT DEFAULT 'enriched',
    default_campaign_id TEXT,
    auto_approve_threshold INTEGER DEFAULT 70,
    ghl_interested_workflow_id TEXT,
    ghl_meeting_workflow_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrichment_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrichment_lead_id INTEGER REFERENCES enrichment_leads(id) ON DELETE CASCADE,
    company_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Source-based cold email exclusion rules
CREATE TABLE IF NOT EXISTS cold_email_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL, -- 'source_exclude','domain_exclude','tag_exclude'
    rule_value TEXT NOT NULL, -- e.g. 'granitepark.co', 'website', 'boat-event'
    description TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cold_email_rules_company ON cold_email_rules(company_id);

-- Known contacts that should never receive cold email
CREATE TABLE IF NOT EXISTS known_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    email TEXT,
    phone TEXT,
    first_name TEXT,
    last_name TEXT,
    source TEXT DEFAULT 'manual', -- 'manual','ghl_import','csv'
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_known_contacts_email ON known_contacts(email);
CREATE INDEX IF NOT EXISTS idx_known_contacts_company ON known_contacts(company_id);

-- Company playbooks for AI-powered auto-replies
CREATE TABLE IF NOT EXISTS company_playbooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL DEFAULT '',          -- Short company name for emails/messages
    sender_name TEXT NOT NULL DEFAULT '',           -- Rep name (e.g. "Ryan", "Colby")
    company_description TEXT NOT NULL,
    value_propositions TEXT NOT NULL,   -- JSON array
    target_icp TEXT NOT NULL,
    tone TEXT DEFAULT 'professional',   -- 'professional','casual','authoritative','friendly'
    objection_handlers TEXT,            -- JSON object
    conversation_goals TEXT,            -- JSON array
    escalation_triggers TEXT,           -- JSON array
    sample_responses TEXT,              -- JSON array
    do_not_mention TEXT,                -- JSON array
    compliance_rules TEXT,              -- Optional compliance rules (e.g. SEC for funds)
    booking_url TEXT,                    -- Calendly/GHL booking link for meeting requests
    max_auto_replies INTEGER DEFAULT 3,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Reply thread tracking for multi-turn email conversations
CREATE TABLE IF NOT EXISTS reply_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrichment_lead_id INTEGER NOT NULL REFERENCES enrichment_leads(id) ON DELETE CASCADE,
    company_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    instantly_email_id TEXT,
    instantly_campaign_id TEXT,
    thread_status TEXT DEFAULT 'active', -- 'active','paused','escalated','converted','closed'
    message_count INTEGER DEFAULT 0,
    auto_reply_count INTEGER DEFAULT 0,
    last_sentiment TEXT,
    last_message_at TEXT,
    escalation_reason TEXT,
    conversion_type TEXT,               -- 'meeting_booked','info_requested','qualified'
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reply_threads_lead ON reply_threads(enrichment_lead_id);
CREATE INDEX IF NOT EXISTS idx_reply_threads_email ON reply_threads(email);
CREATE INDEX IF NOT EXISTS idx_reply_threads_status ON reply_threads(thread_status);

-- Individual messages within reply threads
CREATE TABLE IF NOT EXISTS reply_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL REFERENCES reply_threads(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,            -- 'inbound' or 'outbound'
    body TEXT NOT NULL,
    sentiment TEXT,
    generated_by TEXT,                  -- 'claude' or 'human'
    instantly_email_id TEXT,
    strategy TEXT,                      -- Claude's strategy explanation
    scheduled_at TEXT,                  -- when to send (for delayed replies)
    sent INTEGER DEFAULT 0,            -- 0=pending, 1=sent
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reply_messages_thread ON reply_messages(thread_id);

-- ── AI Assistant Chat History ─────────────────────────────
CREATE TABLE IF NOT EXISTS assistant_chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL DEFAULT 'default',
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assistant_chat_conversation ON assistant_chat_history(conversation_id);

-- ── Bulk CSV Imports ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bulk_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    total_rows INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER DEFAULT 0,
    duplicate_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    processed_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    lead_ids TEXT,
    error_details TEXT,
    column_mapping TEXT,
    auto_process INTEGER DEFAULT 1,
    target_campaign_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ── Domain Health Monitoring ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS domain_health_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    health_score INTEGER NOT NULL DEFAULT 0,
    spf_valid INTEGER DEFAULT 0,
    dkim_valid INTEGER DEFAULT 0,
    dmarc_valid INTEGER DEFAULT 0,
    blacklisted INTEGER DEFAULT 0,
    blacklist_details TEXT,           -- JSON array of blacklist names
    account_count INTEGER DEFAULT 0,
    accounts_warming INTEGER DEFAULT 0,
    accounts_ready INTEGER DEFAULT 0,
    avg_open_rate REAL,
    avg_bounce_rate REAL,
    avg_spam_rate REAL,
    total_sent_7d INTEGER DEFAULT 0,
    auto_actions_taken TEXT,          -- JSON array of actions taken
    checked_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dhs_domain ON domain_health_snapshots(domain);
CREATE INDEX IF NOT EXISTS idx_dhs_checked ON domain_health_snapshots(checked_at);

CREATE TABLE IF NOT EXISTS domain_health_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT DEFAULT '*' UNIQUE,
    auto_pause_on_blacklist INTEGER DEFAULT 1,
    auto_reduce_on_high_bounce INTEGER DEFAULT 1,
    max_bounce_rate REAL DEFAULT 2.0,
    max_spam_rate REAL DEFAULT 0.1,
    min_warmup_days INTEGER DEFAULT 14,
    min_open_rate_for_ready REAL DEFAULT 30.0,
    daily_send_limit_warmup INTEGER DEFAULT 20,
    daily_send_limit_ready INTEGER DEFAULT 50,
    alert_on_dns_fail INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ── Company Pipeline Routing ──────────────────────────────────────
-- Maps (company, campaign) → GHL pipeline + stage IDs
-- Supports multiple pipelines per company, routed by Instantly campaign
CREATE TABLE IF NOT EXISTS company_pipelines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    pipeline_name TEXT NOT NULL,
    ghl_pipeline_id TEXT NOT NULL,
    instantly_campaign_id TEXT,            -- NULL = default pipeline for this company
    stage_map TEXT NOT NULL,               -- JSON: stage_key → GHL stage ID
    monetary_value INTEGER DEFAULT 0,      -- default opportunity value in dollars
    is_default INTEGER DEFAULT 0,          -- 1 = fallback when no campaign match
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_company_pipelines_company ON company_pipelines(company_id);
CREATE INDEX IF NOT EXISTS idx_company_pipelines_campaign ON company_pipelines(instantly_campaign_id);

-- ── Additional Indexes ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_companies_ghl_location ON companies(ghl_location_id);
CREATE INDEX IF NOT EXISTS idx_agents_company ON agents(company_id);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_events_lead_type ON enrichment_events(enrichment_lead_id, event_type);
CREATE INDEX IF NOT EXISTS idx_enrichment_leads_source ON enrichment_leads(source);
CREATE INDEX IF NOT EXISTS idx_enrichment_leads_instantly_status ON enrichment_leads(instantly_push_status);
CREATE INDEX IF NOT EXISTS idx_reply_threads_company ON reply_threads(company_id);
CREATE INDEX IF NOT EXISTS idx_bulk_imports_company ON bulk_imports(company_id);
CREATE INDEX IF NOT EXISTS idx_bulk_imports_status ON bulk_imports(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_external_id ON campaigns(external_id);

-- ── Daily Reports ────────────────────────────────────────────
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

-- ── Meeting Transcripts ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES enrichment_leads(id),
  company_id INTEGER NOT NULL DEFAULT 1,
  ghl_contact_id TEXT,
  meeting_date TEXT NOT NULL,
  platform TEXT DEFAULT 'google_meet',
  transcript_text TEXT NOT NULL,
  duration_minutes INTEGER,
  attendees TEXT,
  recording_url TEXT,
  analysis TEXT,
  next_steps TEXT,
  sequence_assigned TEXT,
  ghl_synced INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_lead ON meeting_transcripts(lead_id);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_company ON meeting_transcripts(company_id);

-- ── A/B Testing ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ab_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  test_type TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ab_test_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER REFERENCES ab_tests(id) ON DELETE CASCADE,
  variant_name TEXT NOT NULL,
  description TEXT,
  config TEXT NOT NULL,
  leads_assigned INTEGER DEFAULT 0,
  replies_received INTEGER DEFAULT 0,
  positive_replies INTEGER DEFAULT 0,
  meetings_booked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ab_test_variants_test ON ab_test_variants(test_id);

CREATE TABLE IF NOT EXISTS daily_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_date TEXT NOT NULL,
    result_json TEXT NOT NULL,
    ok_count INTEGER DEFAULT 0,
    warning_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instantly_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_data TEXT NOT NULL,
    ok_count INTEGER DEFAULT 0,
    warning_count INTEGER DEFAULT 0,
    critical_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_instantly_audits_created ON instantly_audits(created_at);

-- ── Ad Intelligence: Competitor Ads ─────────────────────────────
CREATE TABLE IF NOT EXISTS competitor_ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad_library_id TEXT NOT NULL UNIQUE,
    page_id TEXT NOT NULL,
    page_name TEXT NOT NULL,
    creative_body TEXT,
    creative_link_title TEXT,
    creative_link_description TEXT,
    snapshot_url TEXT,
    scraped_image_url TEXT,
    platforms TEXT,
    delivery_start TEXT,
    delivery_stop TEXT,
    days_active INTEGER DEFAULT 0,
    winner_score INTEGER DEFAULT 0,
    score_breakdown_json TEXT,
    analysis_json TEXT,
    search_term TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_competitor_ads_page ON competitor_ads(page_id);
CREATE INDEX IF NOT EXISTS idx_competitor_ads_score ON competitor_ads(winner_score);
CREATE INDEX IF NOT EXISTS idx_competitor_ads_search ON competitor_ads(search_term);

-- ── Ad Intelligence: Generated Ad Creatives ─────────────────────
CREATE TABLE IF NOT EXISTS generated_ad_creatives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    headline TEXT,
    body TEXT,
    cta TEXT,
    style TEXT,
    format TEXT,
    image_path TEXT,
    image_url TEXT,
    prompt_used TEXT,
    source_competitor_ids TEXT,        -- JSON array of competitor ad IDs used as inspiration
    research_context TEXT,             -- NotebookLM research summary used
    status TEXT DEFAULT 'draft',       -- draft, approved, launched
    meta_ad_id TEXT,                   -- Meta ad ID once launched
    meta_campaign_id TEXT,
    performance_json TEXT,             -- Click-through, impressions, etc.
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gen_creatives_status ON generated_ad_creatives(status);

-- ── Ad Intelligence: Research Briefs ─────────────────────────────
CREATE TABLE IF NOT EXISTS ad_research_briefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brief_json TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ── Ad Intelligence: Research Variants ───────────────────────────
CREATE TABLE IF NOT EXISTS ad_research_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    angle TEXT NOT NULL,
    headline TEXT NOT NULL,
    primary_text TEXT NOT NULL,
    description TEXT NOT NULL,
    cta_type TEXT NOT NULL,
    compliance_note TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
