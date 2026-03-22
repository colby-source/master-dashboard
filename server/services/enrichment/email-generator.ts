import { claudeService } from '../claude-service';
import { queryOne, queryAll } from '../../db';
import { CompanyPlaybook } from './types';
import { getCompanyConfig, logEvent } from './helpers';
import { getLatestInsights } from './feedback-loop';

export interface GeneratedEmailSequence {
  steps: GeneratedEmailStep[];
  strategy: string;
  generatedAt: string;
}

export interface GeneratedEmailStep {
  step: number;
  subject: string;
  body: string;
  angle: string;
  waitDays: number;
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

/**
 * Extract a structured lead context from raw enrichment data for prompt building.
 */
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

/**
 * Build a rich prospect profile section for Claude prompts.
 */
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

/**
 * Load the winning email strategy from past performance data.
 * Returns insights about what angles, tones, and CTAs have worked best.
 */
function loadPerformanceInsights(companyId: number): string {
  try {
    // Get recent positive replies with their original email data
    const positiveReplies = queryAll(
      `SELECT el.enrichment_data, el.score_label, el.tags, el.ab_variant,
              ee.event_data
       FROM enrichment_leads el
       JOIN enrichment_events ee ON ee.enrichment_lead_id = el.id
       WHERE el.company_id = ?
         AND ee.event_type IN ('reply_positive', 'meeting_booked', 'reply_received')
         AND el.enrichment_data IS NOT NULL
       ORDER BY ee.created_at DESC
       LIMIT 20`,
      [companyId]
    );

    if (positiveReplies.length === 0) return '';

    // Analyze winning patterns
    const winningAngles: string[] = [];
    const winningScoreLabels: Record<string, number> = {};

    for (const row of positiveReplies) {
      try {
        const data = JSON.parse(row.enrichment_data);
        const emailSeq = data.generated_email_sequence as GeneratedEmailSequence | undefined;
        if (emailSeq?.steps?.[0]) {
          winningAngles.push(emailSeq.steps[0].angle);
        }
        const label = row.score_label || 'unknown';
        winningScoreLabels[label] = (winningScoreLabels[label] || 0) + 1;
      } catch { /* skip malformed data */ }
    }

    // Get A/B test winners
    const abWinners = queryAll(
      `SELECT test_name, JSON_EXTRACT(variants, '$') as variants
       FROM ab_tests
       WHERE company_id = ? AND status = 'completed' AND winning_variant IS NOT NULL
       ORDER BY completed_at DESC LIMIT 5`,
      [companyId]
    );

    const insights: string[] = [];
    if (winningAngles.length > 0) {
      const angleCounts: Record<string, number> = {};
      for (const a of winningAngles) {
        angleCounts[a] = (angleCounts[a] || 0) + 1;
      }
      const topAngles = Object.entries(angleCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([angle, count]) => `"${angle}" (${count} positive replies)`);
      insights.push(`Top performing email angles: ${topAngles.join(', ')}`);
    }

    if (Object.keys(winningScoreLabels).length > 0) {
      const labelStr = Object.entries(winningScoreLabels)
        .map(([label, count]) => `${label}: ${count}`)
        .join(', ');
      insights.push(`Positive replies by score: ${labelStr}`);
    }

    for (const ab of abWinners) {
      insights.push(`A/B test "${ab.test_name}": winning variant identified`);
    }

    // Also incorporate strategy brief from the feedback loop
    const latestInsights = getLatestInsights(companyId);
    if (latestInsights?.strategyBrief) {
      insights.push(`\nSTRATEGY BRIEF (learned from past performance):\n${latestInsights.strategyBrief}`);
    }
    if (latestInsights?.recommendations?.length) {
      for (const rec of latestInsights.recommendations) {
        insights.push(rec);
      }
    }

    return insights.length > 0
      ? `\nPERFORMANCE INSIGHTS (what has worked for this campaign):\n${insights.map(i => `- ${i}`).join('\n')}`
      : '';
  } catch {
    return '';
  }
}

/**
 * Generate a full personalized cold email sequence for a lead.
 * This is the core of the personalization engine — every email is
 * individually written by Claude based on enrichment data, playbook,
 * and historical performance insights.
 */
export async function generateEmailSequence(
  leadId: number,
  companyId: number,
): Promise<GeneratedEmailSequence | null> {
  const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]);
  if (!lead || !lead.enrichment_data) return null;

  const enrichmentData = JSON.parse(lead.enrichment_data);
  const ctx = buildLeadContext(lead, enrichmentData);

  // Load playbook
  const playbook = queryOne(
    'SELECT * FROM company_playbooks WHERE company_id = ?',
    [companyId]
  ) as CompanyPlaybook | null;

  if (!playbook) {
    console.error(`[EmailGen] No playbook found for company ${companyId}`);
    return null;
  }

  const valuePropList = safeParseJson(playbook.value_propositions, []);
  const doNotMention = safeParseJson(playbook.do_not_mention, []);
  const conversationGoals = safeParseJson(playbook.conversation_goals, []);
  const complianceRules = safeParseJson(playbook.compliance_rules, []);
  const complianceRulesBlock = complianceRules.length > 0
    ? `COMPLIANCE RULES (MANDATORY):\n${complianceRules.map((r: string) => `- ${r}`).join('\n')}`
    : '';

  // Load performance insights for self-optimization
  const performanceInsights = loadPerformanceInsights(companyId);

  // Load A/B variant if active
  const cfg = getCompanyConfig(companyId);

  const toneGuide: Record<string, string> = {
    professional: 'Business-sharp. Credible. No fluff. Short paragraphs.',
    casual: 'Relaxed and conversational. Like messaging a colleague.',
    authoritative: 'Confident. Data-driven. Speak from deep expertise. Command respect.',
    friendly: 'Warm and approachable. Like a trusted advisor sharing insider knowledge.',
  };

  const prospectProfile = buildProspectProfile(ctx);
  const senderName = playbook.sender_name || 'the team';
  const companyName = playbook.company_name || 'our company';

  const prompt = `You are the world's best cold email copywriter. You write emails that read like they were personally written by a human who deeply researched the recipient. Every email is unique — no templates, no generic lines, no filler.

SENDER: ${senderName} from ${companyName}
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

${complianceRulesBlock}

GENERATE a 4-step personalized cold email sequence for this prospect.

STEP GUIDELINES:
1. **Opening email** (send immediately): Pattern-interrupt opener that references something SPECIFIC about them. 3-5 sentences max. Spark curiosity. NO pitch — just hook them. The subject line must be ultra-personal (their name, company, or something only relevant to them).
2. **Value add** (3 days later): Share a specific insight relevant to their role/industry. Position yourself as knowledgeable. Mention one key value prop naturally. 3-4 sentences.
3. **Social proof + soft ask** (5 days later): Reference a relevant proof point or track record. Include a low-friction CTA (deck, quick call, demo). 3-4 sentences.
4. **Breakup email** (7 days later): Casual, short last touch. Make them feel like they're missing out, not being sold to. 2-3 sentences max. Final CTA.

CRITICAL RULES:
- Each email must feel like it was written by a human who spent 5 minutes researching this person
- Subject lines: Short (3-7 words), personal, curiosity-driven. Never generic like "Quick question" or "Following up"
- Body: No greeting like "I hope this finds you well". Jump straight in. Write like a busy executive texts, not like a marketer
- Reference at least ONE specific fact about the prospect per email (company, title, location, industry, LinkedIn activity)
- Vary the angle per step — don't repeat the same pitch 4 times
- The FIRST LINE of each email must be a hook — something that makes them think "how does this person know about me?"
- CTA in steps 3-4 only. Steps 1-2 are about earning attention
- Sign off with just "— ${senderName}" (no "Best regards" or "Sincerely")
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
    const client = claudeService.getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = JSON.parse(claudeService.stripCodeFences(text));

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

    // Validate — must have at least 3 steps with non-empty bodies
    const validSteps = sequence.steps.filter(s => s.body.length > 20 && s.subject.length > 3);
    if (validSteps.length < 3) {
      console.error(`[EmailGen] Only ${validSteps.length} valid steps generated for lead ${leadId}`);
      logEvent(leadId, companyId, 'email_gen_low_quality', {
        validSteps: validSteps.length,
        strategy: sequence.strategy,
      });
      return null;
    }

    logEvent(leadId, companyId, 'email_sequence_generated', {
      steps: sequence.steps.length,
      strategy: sequence.strategy,
      angles: sequence.steps.map(s => s.angle),
    });

    console.log(
      `[EmailGen] Generated ${sequence.steps.length}-step sequence for lead ${leadId}: ${sequence.strategy}`
    );

    return sequence;
  } catch (err: any) {
    console.error(`[EmailGen] Error generating sequence for lead ${leadId}:`, err.message);
    logEvent(leadId, companyId, 'error', { error: err.message, step: 'email_generation' });
    return null;
  }
}

/**
 * Build Instantly custom_variables map from a generated sequence.
 * Maps step N → { personalized_subject_N, personalized_body_N }
 */
export function sequenceToCustomVariables(
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

function safeParseJson(value: string | null, fallback: any): any {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
