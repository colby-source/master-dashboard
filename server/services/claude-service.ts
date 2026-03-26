import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

class ClaudeService {
  private client: Anthropic | null = null;

  getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    }
    return this.client;
  }

  get available(): boolean {
    return !!config.anthropicApiKey;
  }

  async generateCampaignVariations(campaign: {
    name: string;
    stats: any;
    companyName?: string;
  }): Promise<{ variations: { subject: string; body: string; reasoning: string }[] }> {
    const client = this.getClient();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are an expert cold email copywriter. Analyze this top-performing email campaign and generate 3 variations that could perform even better.

Campaign: "${campaign.name}"
${campaign.companyName ? `Company: ${campaign.companyName}` : ''}
Performance: ${campaign.stats?.open_rate || 0}% open rate, ${campaign.stats?.reply_rate || 0}% reply rate, ${campaign.stats?.sent || 0} emails sent

Generate 3 email variations. For each, provide:
1. A subject line
2. A short email body (3-5 sentences, cold outreach style)
3. Brief reasoning for why this variation should perform well

Respond in this exact JSON format:
{"variations": [{"subject": "...", "body": "...", "reasoning": "..."}, ...]}

Only output valid JSON, nothing else.`
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return JSON.parse(this.stripCodeFences(text));
  }

  async queryDashboard(question: string, context: {
    campaigns: any[];
    agents: any[];
    tasks: any[];
    alerts: any[];
    summary: any;
  }): Promise<string> {
    const client = this.getClient();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are an AI assistant for a business operations dashboard. Answer the user's question based on the live data below. Be concise, specific, and actionable.

LIVE DASHBOARD DATA:
---
Executive Summary: ${JSON.stringify(context.summary)}

Campaigns (${context.campaigns.length} total):
${context.campaigns.slice(0, 20).map((c: any) => `- "${c.name}" [${c.status}] open:${c.stats?.open_rate || 0}% reply:${c.stats?.reply_rate || 0}% sent:${c.stats?.sent || 0}`).join('\n')}

Agents (${context.agents.length} total):
${context.agents.slice(0, 15).map((a: any) => `- "${a.name}" [${a.status}] type:${a.type} success:${a.success_rate}% last_run:${a.last_run || 'never'}`).join('\n')}

Tasks: ${context.tasks.filter((t: any) => t.status !== 'done').length} open, ${context.tasks.filter((t: any) => t.status === 'done').length} done
${context.tasks.filter((t: any) => t.status !== 'done').slice(0, 10).map((t: any) => `- [${t.priority}] "${t.title}" (${t.status})`).join('\n')}

Active Alerts: ${context.alerts.length}
${context.alerts.slice(0, 5).map((a: any) => `- [${a.severity}] ${a.message}`).join('\n')}
---

User question: ${question}`
      }],
    });

    return response.content[0].type === 'text' ? response.content[0].text : 'Unable to generate response.';
  }

  async suggestTaskFromAlert(alert: {
    type: string;
    severity: string;
    message: string;
    source: string;
  }): Promise<{ title: string; priority: string; description: string } | null> {
    if (!this.available) return this.fallbackTaskSuggestion(alert);

    try {
      const client = this.getClient();
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `An alert fired in our operations dashboard. Suggest a task to resolve it.

Alert type: ${alert.type}
Severity: ${alert.severity}
Message: ${alert.message}
Source: ${alert.source}

Respond in this exact JSON format:
{"title": "short actionable task title", "priority": "high|medium|low", "description": "1-2 sentence description of what to do"}

Only output valid JSON.`
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return JSON.parse(this.stripCodeFences(text));
    } catch {
      return this.fallbackTaskSuggestion(alert);
    }
  }

  stripCodeFences(text: string): string {
    let cleaned = text.trim();
    // Strip ```json ... ``` or ``` ... ```
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    return cleaned.trim();
  }

  async classifyLead(enrichmentData: any, companyConfig: {
    scoring_prompt?: string;
    score_threshold_hot: number;
    score_threshold_warm: number;
  }): Promise<{
    score: number;
    score_label: string;
    reasoning: string;
    tags: string[];
    personalizations: { opener: string; painPoint: string; cta: string; confidence: number };
  }> {
    const defaultPrompt = `Score this lead 0-100 based on their fit as a prospect. Use the company description and target ICP from the playbook to determine relevance.

Analyze the lead's title, company, industry, and any enrichment data to assess how well they match the ideal customer profile described in the playbook. Consider seniority, decision-making authority, industry fit, and company size.

HIGH-VALUE SIGNALS (score 70-100):
- Title and role directly match the target ICP
- Decision-maker or budget holder at a company that fits the target market
- Strong industry alignment with the company's offerings
- Evidence of relevant purchasing history or active need

MEDIUM SIGNALS (score 40-69):
- Partial ICP match (right industry, wrong seniority or vice versa)
- Adjacent role that may influence buying decisions
- Company fits target market but lead's role is unclear

LOW SIGNALS / DISQUALIFIERS (score 0-39):
- No relevance to the target ICP or industry
- Junior role with no decision-making authority
- Company outside target market entirely
- Roles like HR, IT, Marketing at otherwise relevant companies (unless those are the target)

BONUS FACTORS (+5-15 each):
- Located in key geographic market for the company
- Company size in the sweet spot for the offering
- Evidence of active need or recent related activity

Return ONLY a numeric score 0-100. Higher = better fit as a prospect.`;

    const prompt = companyConfig.scoring_prompt || defaultPrompt;

    // Build LinkedIn profile section if available
    let linkedInSection = '';
    const liProfile = enrichmentData?.linkedin_profile;
    if (liProfile) {
      const liParts: string[] = [];
      if (liProfile.headline) liParts.push(`Headline: ${liProfile.headline}`);
      if (liProfile.summary) liParts.push(`Summary: ${liProfile.summary}`);
      if (liProfile.experience?.length > 0) {
        const expEntries = liProfile.experience.slice(0, 3).map((exp: any) => {
          const title = exp.title || exp.job_title || '';
          const company = exp.company || exp.companyName || '';
          const dates = exp.dates || exp.date_range || '';
          return `  - ${title}${company ? ' at ' + company : ''}${dates ? ' (' + dates + ')' : ''}`;
        });
        liParts.push(`Experience:\n${expEntries.join('\n')}`);
      }
      if (liProfile.skills?.length > 0) {
        liParts.push(`Skills: ${liProfile.skills.slice(0, 10).join(', ')}`);
      }
      if (liProfile.recentPosts?.length > 0) {
        const postEntries = liProfile.recentPosts.slice(0, 3).map((post: any) => {
          const text = (post.text || '').slice(0, 200);
          return `  - "${text}"`;
        });
        liParts.push(`Recent Posts:\n${postEntries.join('\n')}`);
      }
      if (liProfile.connections) {
        liParts.push(`Connections: ${liProfile.connections}`);
      }
      if (liParts.length > 0) {
        linkedInSection = `\n\nLinkedIn Profile Data:\n${liParts.join('\n')}`;
      }
    }

    try {
      const client = this.getClient();
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `${prompt}

LEAD DATA:
${JSON.stringify(enrichmentData, null, 2)}${linkedInSection}

Respond in this exact JSON format (no markdown, no code fences, raw JSON only):
{
  "score": 75,
  "reasoning": "1-2 sentence explanation",
  "tags": ["accredited-investor", "finance-industry"],
  "personalizations": {
    "opener": "A hyper-specific opening line that references something UNIQUE to THIS lead — their company name, job title, a recent post, their city, their industry niche, or their firm's focus area. NEVER use generic lines like 'As someone in finance...' or 'Given your experience...'. It MUST pass this test: could this line ONLY be sent to this one person? Example: 'Noticed [Company] just closed on that [City] multifamily deal — curious if you're exploring tax-advantaged structures on the equity side.'",
    "painPoint": "A specific pain point inferred from their role/industry. Reference their actual situation — e.g., a marketing director struggling with content creation at scale, a founder looking for new revenue channels, an agency owner needing white-label solutions. Be concrete and relevant to the company's offering.",
    "cta": "A low-friction call to action tailored to their seniority and likely interest level. Senior decision-makers get 'quick 15-min call', advisors get 'deck + fund overview to share with clients', etc.",
    "confidence": 0.85
  }
}

PERSONALIZATION RULES:
- "opener" MUST mention at least ONE specific fact about the lead (name, company, title, location, industry detail, or LinkedIn activity). Generic openers = 0 confidence.
- "confidence" is 0.0-1.0 representing how specific and compelling your personalizations are. Below 0.5 means you couldn't find enough lead data to personalize well.
- If lead data is sparse, set confidence low and write the best opener you can with available info — do NOT fabricate details.

CRITICAL: Output raw JSON only. No \`\`\`json blocks, no markdown, no extra text.`
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(this.stripCodeFences(text));
      const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));

      const personalizations = parsed.personalizations || { opener: '', painPoint: '', cta: '', confidence: 0 };
      const confidence = Math.max(0, Math.min(1, Number(personalizations.confidence) || 0));

      // Log low-confidence personalizations for QA
      if (confidence < 0.5) {
        console.warn(`[Claude] Low personalization confidence (${confidence}) for lead: ${enrichmentData.email || 'unknown'}`);
      }

      return {
        score,
        score_label: this.scoreToLabel(score, companyConfig),
        reasoning: parsed.reasoning || '',
        tags: parsed.tags || [],
        personalizations: { ...personalizations, confidence },
      };
    } catch (err: any) {
      console.error('[Claude] classifyLead error:', err.message);
      return {
        score: 0,
        score_label: 'cold',
        reasoning: 'Classification failed — defaulting to score 0',
        tags: [],
        personalizations: { opener: '', painPoint: '', cta: '', confidence: 0 },
      };
    }
  }

  async generateLinkedInMessage(enrichmentData: any, companyConfig: {
    company_description?: string;
    value_propositions?: string;
    target_icp?: string;
    tone?: string;
    sender_name?: string;
    company_name?: string;
  }): Promise<string> {
    const firstName = enrichmentData.first_name || enrichmentData.firstName || '';
    const lastName = enrichmentData.last_name || enrichmentData.lastName || '';
    const title = enrichmentData.title || enrichmentData.job_title || '';
    const company = enrichmentData.company || enrichmentData.organization?.name || '';
    const linkedInProfile = enrichmentData.linkedin_profile || {};
    const headline = linkedInProfile.headline || '';
    const personalizations = enrichmentData.personalizations || {};

    try {
      const client = this.getClient();
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Write a short, personal LinkedIn connection request message (under 280 characters — LinkedIn's limit for connection notes).

SENDER: ${companyConfig.sender_name || 'the team'} from ${companyConfig.company_name || 'our company'}
COMPANY: ${companyConfig.company_description || 'No company description provided.'}

RECIPIENT:
- Name: ${firstName} ${lastName}
- Title: ${title}
- Company: ${company}
- LinkedIn Headline: ${headline}
${personalizations.opener ? `- Personalized opener hint: ${personalizations.opener}` : ''}
${personalizations.painPoint ? `- Pain point: ${personalizations.painPoint}` : ''}

RULES:
- Keep it under 280 characters (HARD LIMIT)
- Be genuine and personal — reference something specific about them
- NO sales pitch — just build the connection
- Mention a shared interest or why you'd like to connect
- Tone: ${companyConfig.tone || 'professional but warm'}
- Don't use generic phrases like "I came across your profile"
- Don't mention the fund or investing directly — keep it relationship-first
- NEVER mention specific IRR numbers or return percentages

Return ONLY the message text. No quotes, no explanation.`
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return text.trim().replace(/^["']|["']$/g, '');
    } catch (err: any) {
      console.error('[Claude] generateLinkedInMessage error:', err.message);
      return `Hi ${firstName}, I noticed your work in ${company || 'the industry'} — would love to connect and exchange ideas.`;
    }
  }

  /** Generate a LinkedIn DM follow-up message for a connected lead */
  async generateLinkedInDM(step: number, enrichmentData: any, companyConfig: {
    company_description?: string;
    value_propositions?: string;
    target_icp?: string;
    tone?: string;
    booking_url?: string;
    sender_name?: string;
    company_name?: string;
  }, connectionMessage: string, previousDMs: Array<{ step: number; direction: string; message: string }>): Promise<string> {
    const firstName = enrichmentData.first_name || enrichmentData.firstName || '';
    const lastName = enrichmentData.last_name || enrichmentData.lastName || '';
    const title = enrichmentData.title || enrichmentData.job_title || '';
    const company = enrichmentData.company || enrichmentData.organization?.name || '';
    const personalizations = enrichmentData.personalizations || {};

    const stepDescriptions: Record<number, string> = {
      1: 'FIRST DM after they accepted your connection request. Thank them for connecting, provide genuine value (insight, article idea, observation about their work). Do NOT pitch yet.',
      2: 'SECOND DM (sent a few days after the first). Share something relevant to their role/industry — a trend, stat, or question that positions you as knowledgeable. Gently introduce what you do.',
      3: 'THIRD DM (final follow-up). Soft ask — suggest a quick call or meeting if they are interested. Reference what you have discussed so far. Include booking link if provided.',
    };

    const prevDMContext = previousDMs.length > 0
      ? `\nPREVIOUS MESSAGES IN THIS THREAD:\n${previousDMs.map(d => `- Step ${d.step} (${d.direction}): ${d.message}`).join('\n')}`
      : '';

    try {
      const client = this.getClient();
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Write a LinkedIn direct message for step ${step} of a 3-message follow-up sequence.

SENDER: ${companyConfig.sender_name || 'the team'} from ${companyConfig.company_name || 'our company'}
COMPANY: ${companyConfig.company_description || 'No company description provided.'}

RECIPIENT:
- Name: ${firstName} ${lastName}
- Title: ${title}
- Company: ${company}
${personalizations.opener ? `- Personalized opener hint: ${personalizations.opener}` : ''}
${personalizations.painPoint ? `- Pain point: ${personalizations.painPoint}` : ''}

ORIGINAL CONNECTION NOTE: "${connectionMessage}"
${prevDMContext}

STEP ${step} INSTRUCTIONS: ${stepDescriptions[step] || stepDescriptions[3]}
${step === 3 && companyConfig.booking_url ? `BOOKING LINK (include naturally): ${companyConfig.booking_url}` : ''}

RULES:
- Keep it under 500 characters
- Sound like a real person, not a bot
- Reference the connection or previous messages naturally
- Tone: ${companyConfig.tone || 'professional but warm'}
- No generic filler — be specific and genuine
- Don't be pushy or salesy in steps 1-2
- Stay on-brand for ${companyConfig.company_name || 'the company'} — only reference what the company actually does
- Do not mention details from other companies or funds

Return ONLY the message text. No quotes, no explanation.`
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return text.trim().replace(/^["']|["']$/g, '');
    } catch (err: any) {
      console.error('[Claude] generateLinkedInDM error:', err.message);
      if (step === 1) return `Thanks for connecting, ${firstName}! I've been following what ${company || 'your team'} is doing — really impressive work.`;
      if (step === 2) return `Hi ${firstName}, came across something that made me think of you and your work at ${company || 'your company'}. Would love to share some thoughts sometime.`;
      return `${firstName}, I've really enjoyed our exchange. Would you be open to a quick 15-min call sometime? I think there could be some mutual value.`;
    }
  }

  private scoreToLabel(score: number, config: { score_threshold_hot: number; score_threshold_warm: number }): string {
    if (score >= config.score_threshold_hot) return 'hot';
    if (score >= config.score_threshold_warm) return 'warm';
    if (score >= 20) return 'cold';
    return 'disqualified';
  }

  async analyzeReplySentiment(replyText: string): Promise<{
    sentiment: 'interested' | 'not_interested' | 'meeting_request' | 'unsubscribe' | 'out_of_office' | 'question';
    confidence: number;
    suggestedAction: string;
    ghlPipelineStage: string;
  }> {
    try {
      const client = this.getClient();
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Analyze this cold email reply and classify the sentiment.

REPLY:
"${replyText}"

Respond in this exact JSON format:
{
  "sentiment": "interested|not_interested|meeting_request|unsubscribe|out_of_office|question",
  "confidence": 0.95,
  "suggestedAction": "what the sales rep should do next",
  "ghlPipelineStage": "which CRM pipeline stage to move the contact to"
}

Only output valid JSON.`
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return JSON.parse(this.stripCodeFences(text));
    } catch (err: any) {
      console.error('[Claude] analyzeReplySentiment error:', err.message);
      return {
        sentiment: 'question',
        confidence: 0,
        suggestedAction: 'Review reply manually',
        ghlPipelineStage: 'new',
      };
    }
  }

  // ── Intelligent Auto-Reply Generation ──────────────────────
  // Uses Sonnet for quality — these replies must feel human and drive conversions

  async generateIntelligentReply(context: {
    replyText: string;
    sentiment: string;
    conversationHistory: { direction: string; body: string }[];
    enrichmentData: any;
    lead: { first_name: string | null; score: number | null; score_label: string | null; tags: string[] };
    playbook: {
      company_description: string;
      value_propositions: string[];
      target_icp: string;
      tone: string;
      objection_handlers: Record<string, string>;
      conversation_goals: string[];
      escalation_triggers: string[];
      do_not_mention: string[];
      booking_url: string | null;
      max_auto_replies: number;
      compliance_rules?: string | null;
      sender_name?: string;
      company_name?: string;
    };
    autoReplyCount: number;
  }): Promise<{
    reply: string;
    strategy: string;
    shouldEscalate: boolean;
    escalationReason?: string;
    suggestedNextStep: string;
  }> {
    const client = this.getClient();

    const toneGuide: Record<string, string> = {
      professional: 'Professional and polished. Confident but not pushy. Business-appropriate language.',
      casual: 'Relaxed and conversational. Like texting a colleague. Short sentences, contractions okay.',
      authoritative: 'Confident and knowledgeable. Speak from expertise. Use data and specifics. Command respect without being arrogant.',
      friendly: 'Warm and approachable. Enthusiastic but genuine. Use their first name. Feel like a trusted friend who happens to have a great opportunity.',
    };

    const pdlPerson = context.enrichmentData?.pdl_person;
    const pdlCompany = context.enrichmentData?.pdl_company;

    const prospectContext = [
      pdlPerson?.first_name ? `Name: ${pdlPerson.first_name} ${pdlPerson.last_name || ''}`.trim() : (context.lead.first_name ? `Name: ${context.lead.first_name}` : null),
      pdlPerson?.job_title ? `Title: ${pdlPerson.job_title}` : null,
      pdlPerson?.job_company_name ? `Company: ${pdlPerson.job_company_name}` : null,
      pdlPerson?.industry ? `Industry: ${pdlPerson.industry}` : null,
      pdlPerson?.location_name ? `Location: ${pdlPerson.location_name}` : null,
      pdlCompany?.size ? `Company Size: ${pdlCompany.size}` : null,
      context.lead.score_label ? `Lead Score: ${context.lead.score}/100 (${context.lead.score_label})` : null,
      context.lead.tags.length > 0 ? `Tags: ${context.lead.tags.join(', ')}` : null,
    ].filter(Boolean).join('\n');

    const conversationStr = context.conversationHistory.length > 0
      ? context.conversationHistory.map(m => `[${m.direction.toUpperCase()}]: ${m.body}`).join('\n\n')
      : '(This is the first reply in the thread)';

    const objectionHandlerStr = Object.entries(context.playbook.objection_handlers)
      .map(([k, v]) => `- If "${k}": ${v}`)
      .join('\n');

    const complianceRules: string[] = (() => {
      try { return JSON.parse(context.playbook.compliance_rules || '[]'); } catch { return []; }
    })();
    const complianceBlock = complianceRules.length > 0
      ? `COMPLIANCE RULES (MANDATORY — violations create legal liability):\n${complianceRules.map(r => `- ${r}`).join('\n')}`
      : '';

    const senderName = context.playbook.sender_name || '';
    const companyName = context.playbook.company_name || '';

    const systemPrompt = `You are ${senderName}${companyName ? ` from ${companyName}` : ''}. You are replying to a real email thread. Write exactly like a busy professional texting — ultra-short, no fluff, no sales language.

HARD RULES:
- 1-3 sentences MAX. Period. If you write more, you failed.
- Never open with their name + comma. Just start talking.
- Never use: "I completely understand", "That's exactly why", "I'd love to", "Just following up", "Hope this finds you", "Great question", "Absolutely", "No worries at all"
- No bullet points. No paragraphs. No re-explaining the offer.
- Sound like a person, not a chatbot. Read it back — would a real person send this?

COMPANY: ${context.playbook.company_description}

VALUE PROPS (use sparingly, don't list them):
${context.playbook.value_propositions.map(v => `- ${v}`).join('\n')}

TARGET CUSTOMER: ${context.playbook.target_icp}

TONE: ${context.playbook.tone} — ${toneGuide[context.playbook.tone] || toneGuide.professional}

OBJECTION RESPONSES (adapt naturally, don't copy verbatim):
${objectionHandlerStr}

GOALS: ${context.playbook.conversation_goals.join(', ')}

NEVER MENTION: ${context.playbook.do_not_mention.join(', ')}

${complianceBlock}

${context.playbook.booking_url ? `BOOKING LINK: ${context.playbook.booking_url}\nDrop it when they show interest. Keep it casual: "here's my calendar: [link]" — one line, done.` : ''}

ESCALATION TRIGGERS (set shouldEscalate=true):
${context.playbook.escalation_triggers.map(t => `- ${t}`).join('\n')}
- Auto-reply count has reached ${context.playbook.max_auto_replies} (currently at ${context.autoReplyCount})`;

    const userPrompt = `PROSPECT: ${prospectContext || 'No data.'}

THREAD:
${conversationStr}

THEIR LATEST MESSAGE:
"${context.replyText}"

SENTIMENT: ${context.sentiment}

Read the thread above. Don't repeat anything already said. Pick up naturally.

If they said "yes" / "interested" / "tell me more" → booking link + one line. Done. Don't re-pitch.
If not interested or unsubscribe → be gracious, short. shouldEscalate=false.
${context.playbook.booking_url ? 'Interest shown → include: ' + context.playbook.booking_url : 'Want to meet → shouldEscalate=true'}
No subject line. This is a reply.

JSON only:
{"reply":"...","strategy":"...","shouldEscalate":false,"escalationReason":"...","suggestedNextStep":"..."}`;

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(this.stripCodeFences(text));

      return {
        reply: parsed.reply || '',
        strategy: parsed.strategy || '',
        shouldEscalate: !!parsed.shouldEscalate,
        escalationReason: parsed.escalationReason,
        suggestedNextStep: parsed.suggestedNextStep || '',
      };
    } catch (err: any) {
      console.error('[Claude] generateIntelligentReply error:', err.message);
      return {
        reply: '',
        strategy: 'Generation failed',
        shouldEscalate: true,
        escalationReason: `AI reply generation failed: ${err.message}`,
        suggestedNextStep: 'Manual reply required',
      };
    }
  }

  // ── Meeting Transcript Analysis ─────────────────────────────
  // Uses Sonnet for deep analysis of sales meeting recordings

  async analyzeMeetingTranscript(context: {
    transcriptText: string;
    leadData: {
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      score: number | null;
      score_label: string | null;
      tags: string[];
      enrichment_data: any;
    };
    conversationHistory: { direction: string; body: string }[];
    playbook: {
      company_description: string;
      value_propositions: string[];
      target_icp: string;
      conversation_goals: string[];
    };
    meetingDate: string;
    durationMinutes: number | null;
  }): Promise<{
    sentiment: string;
    key_topics: string[];
    objections: string[];
    investment_likelihood: number;
    accredited_confirmed: boolean;
    investment_timeline: string;
    next_steps: string[];
    sequence_recommendation: string;
    follow_up_delay_days: number;
    personalized_follow_up: string;
  }> {
    const client = this.getClient();

    const pdlPerson = context.leadData.enrichment_data?.pdl_person;
    const prospectInfo = [
      context.leadData.first_name ? `Name: ${context.leadData.first_name} ${context.leadData.last_name || ''}`.trim() : null,
      pdlPerson?.job_title ? `Title: ${pdlPerson.job_title}` : null,
      pdlPerson?.job_company_name ? `Company: ${pdlPerson.job_company_name}` : null,
      pdlPerson?.industry ? `Industry: ${pdlPerson.industry}` : null,
      context.leadData.score ? `Lead Score: ${context.leadData.score}/100 (${context.leadData.score_label})` : null,
      context.leadData.tags.length > 0 ? `Tags: ${context.leadData.tags.join(', ')}` : null,
    ].filter(Boolean).join('\n');

    const priorEmailsStr = context.conversationHistory.length > 0
      ? context.conversationHistory.map(m => `[${m.direction.toUpperCase()}]: ${m.body}`).join('\n\n')
      : '(No prior email exchanges)';

    const prompt = `You are a senior sales analyst. Analyze this meeting transcript and provide a structured assessment.

COMPANY CONTEXT:
${context.playbook.company_description}

VALUE PROPOSITIONS:
${context.playbook.value_propositions.map(v => `- ${v}`).join('\n')}

TARGET CUSTOMER:
${context.playbook.target_icp}

CONVERSATION GOALS:
${context.playbook.conversation_goals.map(g => `- ${g}`).join('\n')}

PROSPECT INFORMATION:
${prospectInfo || 'No enrichment data available.'}

PRIOR EMAIL EXCHANGES:
${priorEmailsStr}

MEETING DETAILS:
- Date: ${context.meetingDate}
- Duration: ${context.durationMinutes ? `${context.durationMinutes} minutes` : 'unknown'}

MEETING TRANSCRIPT:
${context.transcriptText}

INSTRUCTIONS:
Analyze the transcript and determine:
1. Overall sentiment and interest level
2. Key topics discussed
3. Objections raised by the prospect
4. Likelihood they will convert or move forward (0-100)
5. Whether they confirmed key qualification criteria
6. Their stated timeline for next steps
7. Concrete next steps to advance the deal
8. Which follow-up sequence to assign:
   - "closing" → very interested, high likelihood, ready to commit
   - "nurture" → interested but needs time, medium likelihood
   - "re_engagement" → lukewarm or not interested, revisit in 30+ days
9. How many days to wait before follow-up
10. A personalized follow-up email (2-4 sentences, reference specific things they said)

Respond in this exact JSON format:
{
  "sentiment": "very_interested | interested | lukewarm | not_interested",
  "key_topics": ["topic1", "topic2"],
  "objections": ["objection1"],
  "investment_likelihood": 75,
  "accredited_confirmed": true,
  "investment_timeline": "Q2 2026",
  "next_steps": ["Send materials", "Schedule follow-up call"],
  "sequence_recommendation": "closing",
  "follow_up_delay_days": 3,
  "personalized_follow_up": "Hi [Name], great speaking with you today about..."
}

Output raw JSON only. No code fences, no markdown.`;

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(this.stripCodeFences(text));

      return {
        sentiment: parsed.sentiment || 'lukewarm',
        key_topics: parsed.key_topics || [],
        objections: parsed.objections || [],
        investment_likelihood: Math.max(0, Math.min(100, Number(parsed.investment_likelihood) || 0)),
        accredited_confirmed: !!parsed.accredited_confirmed,
        investment_timeline: parsed.investment_timeline || '',
        next_steps: parsed.next_steps || [],
        sequence_recommendation: parsed.sequence_recommendation || 'nurture',
        follow_up_delay_days: Number(parsed.follow_up_delay_days) || 3,
        personalized_follow_up: parsed.personalized_follow_up || '',
      };
    } catch (err: any) {
      console.error('[Claude] analyzeMeetingTranscript error:', err.message);
      return {
        sentiment: 'lukewarm',
        key_topics: [],
        objections: [],
        investment_likelihood: 0,
        accredited_confirmed: false,
        investment_timeline: '',
        next_steps: ['Manual review required — transcript analysis failed'],
        sequence_recommendation: 'nurture',
        follow_up_delay_days: 3,
        personalized_follow_up: '',
      };
    }
  }

  private fallbackTaskSuggestion(alert: { type: string; severity: string; message: string; source: string }) {
    const priority = alert.severity === 'critical' ? 'high' : alert.severity === 'warning' ? 'medium' : 'low';
    return {
      title: `Resolve: ${alert.message.slice(0, 80)}`,
      priority,
      description: `Auto-created from ${alert.severity} alert (${alert.source}): ${alert.message}`,
    };
  }
}

export const claudeService = new ClaudeService();
