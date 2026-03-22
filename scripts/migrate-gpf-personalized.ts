#!/usr/bin/env npx tsx
/**
 * Standalone migration script: GPF-II RE (Warm) → GPF-II AI Personalized
 *
 * Processes all 2,318 leads from the old campaign through Claude email generation
 * and pushes them to the new AI Personalized campaign with custom variables.
 *
 * Usage: npx tsx scripts/migrate-gpf-personalized.ts
 */

import 'dotenv/config';
import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import axios, { AxiosInstance } from 'axios';

// ── Config ────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || './data/master-dashboard.db';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY || '';
const INSTANTLY_BASE_URL = 'https://api.instantly.ai/api/v2';

const OLD_CAMPAIGN = 'c5ad2979-086b-4a9a-89f2-e7766b7023de';
const NEW_CAMPAIGN = '2e3af84a-8f6f-4446-981c-f10bb2348216';
const COMPANY_ID = 1; // Grand Park Capital

const BATCH_SIZE = 5;  // 5 parallel Claude calls per wave
const DELAY_MS = 500;  // short delay between waves
const CONCURRENCY = 5; // parallel Claude API calls

// ── Database ──────────────────────────────────────────────────
let db: Database;

async function initDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    throw new Error(`Database not found at ${DB_PATH}`);
  }
  db.run('PRAGMA foreign_keys = ON');

  // Run schema + migrations (same as getDb() in server/db.ts)
  const schemaPath = path.join(__dirname, '../database/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.run(schema);
  }

  // Run the same migrations as db.ts
  const migrations = [
    `ALTER TABLE enrichment_config ADD COLUMN auto_reply_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE enrichment_config ADD COLUMN auto_reply_sentiments TEXT DEFAULT '["interested","question","meeting_request"]'`,
    `ALTER TABLE enrichment_leads ADD COLUMN ab_variant TEXT`,
    `ALTER TABLE enrichment_config ADD COLUMN ghl_pipeline_id TEXT`,
    `ALTER TABLE enrichment_config ADD COLUMN ghl_pipeline_stages TEXT`,
    `ALTER TABLE enrichment_leads ADD COLUMN ghl_opportunity_id TEXT`,
    `ALTER TABLE reply_threads ADD COLUMN subject TEXT`,
    `ALTER TABLE enrichment_leads ADD COLUMN linkedin_outreach_status TEXT DEFAULT 'none'`,
    `ALTER TABLE enrichment_leads ADD COLUMN linkedin_message TEXT`,
    `ALTER TABLE enrichment_leads ADD COLUMN linkedin_connected_at TEXT`,
    `ALTER TABLE enrichment_leads ADD COLUMN linkedin_sequence_step INTEGER DEFAULT 0`,
    `ALTER TABLE enrichment_leads ADD COLUMN linkedin_last_dm_at TEXT`,
    `ALTER TABLE enrichment_leads ADD COLUMN linkedin_dm_reply_at TEXT`,
  ];
  for (const m of migrations) {
    try { db.run(m); } catch { /* column already exists */ }
  }

  return db;
}

function queryAll(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function queryOne(sql: string, params: any[] = []): any | null {
  const results = queryAll(sql, params);
  return results[0] || null;
}

function runSql(sql: string, params: any[] = []) {
  if (params.length > 0) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
  } else {
    db.run(sql);
  }
}

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Claude Client ─────────────────────────────────────────────
const claude = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  return cleaned.trim();
}

// ── Instantly Client ──────────────────────────────────────────
const instantly: AxiosInstance = axios.create({
  baseURL: INSTANTLY_BASE_URL,
  headers: {
    'Authorization': `Bearer ${INSTANTLY_API_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

async function addLeadToInstantly(campaignId: string, lead: Record<string, any>): Promise<any> {
  try {
    const { data } = await instantly.post('/leads', {
      ...lead,
      campaign: campaignId,
      skip_if_in_campaign: true,
    });
    return data;
  } catch (err: any) {
    console.error(`  [Instantly] addLead ${lead.email} error:`, err.response?.data || err.message);
    return { error: err.message };
  }
}

// ── Email Generator (inlined from email-generator.ts) ─────────

interface GeneratedEmailStep {
  step: number;
  subject: string;
  body: string;
  angle: string;
  waitDays: number;
}

interface GeneratedEmailSequence {
  steps: GeneratedEmailStep[];
  strategy: string;
  generatedAt: string;
}

interface LeadContext {
  firstName: string;
  lastName: string;
  email: string;
  title: string;
  company: string;
  industry: string;
  location: string;
  linkedinHeadline: string;
  linkedinSummary: string;
  recentExperience: string[];
  recentPosts: string[];
  score: number;
  scoreLabel: string;
  personalizations: { opener?: string; painPoint?: string; cta?: string; confidence?: number };
  tags: string[];
}

function buildLeadContext(lead: any, enrichmentData: any): LeadContext {
  const ap = enrichmentData.apollo_person || {};
  const ao = enrichmentData.apollo_org || {};
  const pp = enrichmentData.pdl_person || {};
  const pc = enrichmentData.pdl_company || {};
  const li = enrichmentData.linkedin_profile || {};
  const personalizations = enrichmentData.personalizations || {};

  const experience = (li.experience || []).slice(0, 3).map((exp: any) => {
    const t = exp.title || exp.job_title || '';
    const c = exp.company || exp.companyName || '';
    const d = exp.dates || exp.date_range || '';
    return `${t}${c ? ' at ' + c : ''}${d ? ' (' + d + ')' : ''}`;
  });

  const posts = (li.recentPosts || []).slice(0, 3).map((p: any) =>
    (p.text || '').slice(0, 200)
  );

  return {
    firstName: lead.first_name || ap.first_name || pp.first_name || '',
    lastName: lead.last_name || ap.last_name || pp.last_name || '',
    email: lead.email || '',
    title: ap.title || pp.job_title || li.headline || '',
    company: ap.organization_name || pp.job_company_name || ao.name || pc.name || '',
    industry: ap.organization_industry || pp.industry || ao.industry || '',
    location: ap.location || pp.location_name || li.location || '',
    linkedinHeadline: li.headline || '',
    linkedinSummary: (li.summary || '').slice(0, 500),
    recentExperience: experience,
    recentPosts: posts,
    score: lead.score || 0,
    scoreLabel: lead.score_label || 'unknown',
    personalizations,
    tags: lead.tags ? JSON.parse(lead.tags) : [],
  };
}

function buildProspectProfile(ctx: LeadContext): string {
  const lines: string[] = [];
  if (ctx.firstName) lines.push(`Name: ${ctx.firstName} ${ctx.lastName}`.trim());
  if (ctx.title) lines.push(`Title: ${ctx.title}`);
  if (ctx.company) lines.push(`Company: ${ctx.company}`);
  if (ctx.industry) lines.push(`Industry: ${ctx.industry}`);
  if (ctx.location) lines.push(`Location: ${ctx.location}`);
  if (ctx.linkedinHeadline) lines.push(`LinkedIn Headline: ${ctx.linkedinHeadline}`);
  if (ctx.linkedinSummary) lines.push(`LinkedIn Summary: ${ctx.linkedinSummary}`);
  if (ctx.recentExperience.length > 0) {
    lines.push(`Recent Experience:\n${ctx.recentExperience.map(e => `  - ${e}`).join('\n')}`);
  }
  if (ctx.recentPosts.length > 0) {
    lines.push(`Recent LinkedIn Posts:\n${ctx.recentPosts.map(p => `  - "${p}"`).join('\n')}`);
  }
  if (ctx.score > 0) lines.push(`Lead Score: ${ctx.score}/100 (${ctx.scoreLabel})`);
  if (ctx.tags.length > 0) lines.push(`Tags: ${ctx.tags.join(', ')}`);
  if (ctx.personalizations.opener) lines.push(`Opener hint: ${ctx.personalizations.opener}`);
  if (ctx.personalizations.painPoint) lines.push(`Pain point: ${ctx.personalizations.painPoint}`);
  return lines.join('\n');
}

function safeParseJson(value: string | null, fallback: any): any {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function generateEmailSequence(
  lead: any,
  enrichmentData: any,
  playbook: any,
  performanceInsights: string,
): Promise<GeneratedEmailSequence | null> {
  const ctx = buildLeadContext(lead, enrichmentData);
  const valuePropList = safeParseJson(playbook.value_propositions, []);
  const doNotMention = safeParseJson(playbook.do_not_mention, []);
  const conversationGoals = safeParseJson(playbook.conversation_goals, []);

  const toneGuide: Record<string, string> = {
    professional: 'Business-sharp. Credible. No fluff. Short paragraphs.',
    casual: 'Relaxed and conversational. Like messaging a colleague.',
    authoritative: 'Confident. Data-driven. Speak from deep expertise. Command respect.',
    friendly: 'Warm and approachable. Like a trusted advisor sharing insider knowledge.',
  };

  const prospectProfile = buildProspectProfile(ctx);

  const prompt = `You are the world's best cold email copywriter. You write emails that read like they were personally written by a human who deeply researched the recipient. Every email is unique — no templates, no generic lines, no filler.

SENDER: Colby from Granite Park Capital
COMPANY:
${playbook.company_description}

KEY VALUE PROPOSITIONS:
${valuePropList.map((v: string) => `- ${v}`).join('\n')}

TARGET CUSTOMER:
${playbook.target_icp}

TONE: ${playbook.tone}
${toneGuide[playbook.tone] || toneGuide.authoritative}

PROSPECT PROFILE:
${prospectProfile}

${playbook.booking_url ? `BOOKING LINK: ${playbook.booking_url}` : ''}
${performanceInsights}

TOPICS TO NEVER MENTION:
${doNotMention.map((t: string) => `- ${t}`).join('\n')}

CONVERSATION GOALS (advance toward these across the sequence):
${conversationGoals.map((g: string) => `- ${g}`).join('\n')}

SEC COMPLIANCE RULES (MANDATORY):
- NEVER guarantee specific returns. Use "targeting" or "projected"
- NEVER provide tax, legal, or specific financial advice
- NEVER discuss specific investor information
- Use "past performance is not indicative of future results" if referencing Fund I
- If mentioning Fund I performance, say "179% return on equity" not "179% IRR"

GENERATE a 4-step personalized cold email sequence for this prospect.

STEP GUIDELINES:
1. **Opening email** (send immediately): Pattern-interrupt opener that references something SPECIFIC about them. 3-5 sentences max. Spark curiosity. NO pitch — just hook them. The subject line must be ultra-personal (their name, company, or something only relevant to them).
2. **Value add** (3 days later): Share a specific insight relevant to their role/industry. Position yourself as knowledgeable. Mention one key value prop naturally. 3-4 sentences.
3. **Social proof + soft ask** (5 days later): Reference Fund I track record or a relevant proof point. Include a low-friction CTA (deck, quick call). 3-4 sentences.
4. **Breakup email** (7 days later): Casual, short last touch. Make them feel like they're missing out, not being sold to. 2-3 sentences max. Final CTA.

CRITICAL RULES:
- Each email must feel like it was written by a human who spent 5 minutes researching this person
- Subject lines: Short (3-7 words), personal, curiosity-driven. Never generic like "Quick question" or "Following up"
- Body: No greeting like "I hope this finds you well". Jump straight in. Write like a busy executive texts, not like a marketer
- Reference at least ONE specific fact about the prospect per email (company, title, location, industry, LinkedIn activity)
- Vary the angle per step — don't repeat the same pitch 4 times
- The FIRST LINE of each email must be a hook — something that makes them think "how does this person know about me?"
- CTA in steps 3-4 only. Steps 1-2 are about earning attention
- Sign off with just "— Colby" (no "Best regards" or "Sincerely")
- Keep emails scannable on mobile — short paragraphs, no walls of text

Respond in this exact JSON format (raw JSON only, no code fences):
{
  "steps": [
    {
      "step": 1,
      "subject": "subject line",
      "body": "full email body including signature",
      "angle": "2-3 word description of the angle used",
      "waitDays": 0
    },
    {
      "step": 2,
      "subject": "subject line",
      "body": "full email body",
      "angle": "angle description",
      "waitDays": 3
    },
    {
      "step": 3,
      "subject": "subject line",
      "body": "full email body",
      "angle": "angle description",
      "waitDays": 5
    },
    {
      "step": 4,
      "subject": "subject line",
      "body": "full email body",
      "angle": "angle description",
      "waitDays": 7
    }
  ],
  "strategy": "1-2 sentence explanation of the overall personalization strategy for this specific prospect"
}`;

  try {
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = JSON.parse(stripCodeFences(text));

    const sequence: GeneratedEmailSequence = {
      steps: (parsed.steps || []).map((s: any) => ({
        step: s.step,
        subject: s.subject || '',
        body: s.body || '',
        angle: s.angle || '',
        waitDays: s.waitDays || 0,
      })),
      strategy: parsed.strategy || '',
      generatedAt: new Date().toISOString(),
    };

    const validSteps = sequence.steps.filter(s => s.body.length > 20 && s.subject.length > 3);
    if (validSteps.length < 3) {
      console.warn(`  [EmailGen] Only ${validSteps.length} valid steps for lead ${lead.id} — skipping`);
      return null;
    }

    return sequence;
  } catch (err: any) {
    console.error(`  [EmailGen] Error for lead ${lead.id}:`, err.message);
    return null;
  }
}

function sequenceToCustomVariables(
  sequence: GeneratedEmailSequence,
  baseVars: Record<string, any>,
): Record<string, any> {
  const vars = { ...baseVars };
  for (const step of sequence.steps) {
    vars[`personalized_subject_${step.step}`] = step.subject;
    vars[`personalized_body_${step.step}`] = step.body;
  }
  vars.email_strategy = sequence.strategy;
  vars.sequence_generated_at = sequence.generatedAt;
  return vars;
}

// ── Performance Insights (simplified) ─────────────────────────

function loadPerformanceInsights(): string {
  try {
    const positiveReplies = queryAll(
      `SELECT el.enrichment_data, el.score_label, el.tags, el.ab_variant
       FROM enrichment_leads el
       JOIN enrichment_events ee ON ee.enrichment_lead_id = el.id
       WHERE el.company_id = ?
         AND ee.event_type IN ('reply_positive', 'meeting_booked', 'reply_received')
         AND el.enrichment_data IS NOT NULL
       ORDER BY ee.created_at DESC
       LIMIT 20`,
      [COMPANY_ID]
    );

    if (positiveReplies.length === 0) return '';

    const winningAngles: string[] = [];
    for (const row of positiveReplies) {
      try {
        const data = JSON.parse(row.enrichment_data);
        const emailSeq = data.generated_email_sequence;
        if (emailSeq?.steps?.[0]) winningAngles.push(emailSeq.steps[0].angle);
      } catch { /* skip */ }
    }

    const insights: string[] = [];
    if (winningAngles.length > 0) {
      const angleCounts: Record<string, number> = {};
      for (const a of winningAngles) angleCounts[a] = (angleCounts[a] || 0) + 1;
      const topAngles = Object.entries(angleCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([angle, count]) => `"${angle}" (${count} positive replies)`);
      insights.push(`Top performing email angles: ${topAngles.join(', ')}`);
    }

    return insights.length > 0
      ? `\nPERFORMANCE INSIGHTS (what has worked for this campaign):\n${insights.map(i => `- ${i}`).join('\n')}`
      : '';
  } catch {
    return '';
  }
}

// ── Main Migration ────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  GPF-II Migration: Warm → AI Personalized              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Validate env
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  if (!INSTANTLY_API_KEY) throw new Error('INSTANTLY_API_KEY not set');

  // Init DB
  console.log('[1/4] Initializing database...');
  await initDb();

  // Load playbook
  const playbook = queryOne('SELECT * FROM company_playbooks WHERE company_id = ?', [COMPANY_ID]);
  if (!playbook) throw new Error('No playbook found for Grand Park Capital');
  console.log(`  Playbook loaded: ${playbook.company_description?.slice(0, 60)}...`);

  // Load performance insights
  const performanceInsights = loadPerformanceInsights();
  if (performanceInsights) console.log('  Performance insights loaded');

  // Query enriched leads from DB — only leads that went through the enrichment pipeline
  console.log('\n[2/3] Querying enriched leads for migration...');

  // Ensure generated_email_sequence column exists
  try { db.run('ALTER TABLE enrichment_leads ADD COLUMN generated_email_sequence TEXT'); } catch { /* exists */ }

  // Count already-done leads (have a generated sequence)
  const alreadyDone = queryOne(
    `SELECT COUNT(*) as count FROM enrichment_leads
     WHERE company_id = ? AND generated_email_sequence IS NOT NULL`,
    [COMPANY_ID],
  );
  const prevDone = alreadyDone?.count || 0;

  // Get leads that need processing: enriched via pipeline (csv_import + scored), no sequence yet
  const leads = queryAll(
    `SELECT id, email, first_name, last_name, enrichment_data, score, score_label, tags, source, instantly_campaign_id
     FROM enrichment_leads
     WHERE company_id = ?
       AND source = 'csv_import'
       AND status = 'scored'
       AND enrichment_data IS NOT NULL
       AND generated_email_sequence IS NULL
     ORDER BY score DESC`,
    [COMPANY_ID],
  );

  const totalLeads = queryOne(
    'SELECT COUNT(*) as count FROM enrichment_leads WHERE company_id = ? AND source = \'csv_import\' AND status = \'scored\'',
    [COMPANY_ID],
  );

  console.log(`  Total enriched leads: ${totalLeads?.count || 0}`);
  console.log(`  Already processed: ${prevDone}`);
  console.log(`  Remaining to process: ${leads.length}`);

  if (leads.length === 0) {
    console.log('  All leads migrated! Nothing to do.');
    saveDb();
    return;
  }

  // Process a single lead end-to-end (used in parallel)
  async function processLead(lead: any): Promise<'migrated' | 'failed' | 'skipped'> {
    if (!lead.email) {
      console.log(`    SKIP lead ${lead.id}: no email`);
      return 'skipped';
    }
    if (!lead.enrichment_data) {
      // Use minimal context if no enrichment data at all
      lead.enrichment_data = JSON.stringify({
        apollo_person: { first_name: lead.first_name || '', last_name: lead.last_name || '' },
        apollo_org: {}, pdl_person: {}, pdl_company: {}, linkedin_profile: {}, personalizations: {},
      });
    }

    let enrichmentData: any;
    try {
      enrichmentData = JSON.parse(lead.enrichment_data);
    } catch {
      console.log(`    SKIP lead ${lead.id} (${lead.email}): malformed enrichment data`);
      return 'skipped';
    }

    // Generate personalized email sequence via Claude (this is the slow part)
    const sequence = await generateEmailSequence(lead, enrichmentData, playbook, performanceInsights);
    if (!sequence) return 'failed';

    // Build custom variables
    const customVars = sequenceToCustomVariables(sequence, {
      firstName: lead.first_name || '',
      lastName: lead.last_name || '',
      company: enrichmentData.apollo_person?.organization_name ||
               enrichmentData.pdl_person?.job_company_name || '',
    });

    // Push to Instantly new campaign
    const result = await addLeadToInstantly(NEW_CAMPAIGN, {
      email: lead.email,
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      custom_variables: customVars,
    });

    if (result?.error) {
      console.log(`    FAIL lead ${lead.id} (${lead.email}): Instantly push failed`);
      return 'failed';
    }

    // Update DB — store sequence in dedicated column, update campaign
    runSql(
      `UPDATE enrichment_leads
       SET instantly_campaign_id = ?, generated_email_sequence = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [NEW_CAMPAIGN, JSON.stringify(sequence), lead.id]
    );
    runSql(
      'INSERT INTO enrichment_events (enrichment_lead_id, company_id, event_type, event_data) VALUES (?, ?, ?, ?)',
      [lead.id, COMPANY_ID, 'migrated_to_ai_campaign', JSON.stringify({
        from_campaign: OLD_CAMPAIGN,
        to_campaign: NEW_CAMPAIGN,
        strategy: sequence.strategy,
        angles: sequence.steps.map(s => s.angle),
      })]
    );

    const scoreTag = lead.score_label ? ` [${lead.score_label}:${lead.score}]` : '';
    console.log(`    ✓ ${lead.email}${scoreTag} — "${sequence.strategy.slice(0, 70)}"`);
    return 'migrated';
  }

  // Process in parallel waves of CONCURRENCY
  console.log(`\n[3/3] Processing ${leads.length} leads (${CONCURRENCY} parallel, ${DELAY_MS}ms between waves)...`);
  const totalWaves = Math.ceil(leads.length / CONCURRENCY);
  let migrated = 0;
  let failed = 0;
  let skipped = 0;
  const startTime = Date.now();

  for (let waveIdx = 0; waveIdx < totalWaves; waveIdx++) {
    const wave = leads.slice(waveIdx * CONCURRENCY, (waveIdx + 1) * CONCURRENCY);
    const waveNum = waveIdx + 1;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const totalDone = migrated + prevDone;
    const totalTarget = (totalLeads?.count || 0);
    const rate = migrated > 0 ? ((migrated / (Date.now() - startTime)) * 1000 * 60).toFixed(1) : '—';
    const remaining = leads.length - (migrated + failed + skipped);
    const etaMins = migrated > 0 ? ((remaining / (migrated / ((Date.now() - startTime) / 1000 / 60)))).toFixed(0) : '?';

    console.log(`\n  ── Wave ${waveNum}/${totalWaves} | ${totalDone}/${totalTarget} total | ${elapsed}s | ~${rate}/min | ETA: ${etaMins}min ──`);

    // Fire all Claude calls in parallel
    const results = await Promise.allSettled(wave.map(lead => processLead(lead)));

    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value === 'migrated') migrated++;
        else if (r.value === 'failed') failed++;
        else skipped++;
      } else {
        console.error(`    ERROR: ${r.reason}`);
        failed++;
      }
    }

    // Save DB every 5 waves
    if (waveIdx % 5 === 0) saveDb();

    // Short delay between waves
    if (waveIdx < totalWaves - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  // Final save — only if we actually made progress (prevents failed runs from wiping data)
  if (migrated > 0) {
    saveDb();
    console.log(`\n  DB saved (${migrated} new leads persisted).`);
  } else {
    console.log('\n  No progress made — DB NOT saved (preserving existing data).');
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  Migration Complete                                     ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Previously done: ${String(prevDone).padStart(5)}                               ║`);
  console.log(`║  This run:        ${String(migrated).padStart(5)}                               ║`);
  console.log(`║  Failed:          ${String(failed).padStart(5)}                               ║`);
  console.log(`║  Skipped:         ${String(skipped).padStart(5)}                               ║`);
  console.log(`║  Total migrated:  ${String(prevDone + migrated).padStart(5)}                               ║`);
  console.log(`║  Time:          ${totalTime.padStart(6)} min                            ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  console.log('\nNext steps:');
  console.log('  1. Activate the new campaign in Instantly');
  console.log('  2. Restart the server to pick up code changes');
  console.log('  3. Monitor Instantly for deliverability');
}

main().catch(err => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
