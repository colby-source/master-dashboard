import { ghlService } from './ghl-service';
import { config } from '../config';
import * as cron from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

// ═══════════════════════════════════════════════════════════════
// GPC-ONLY MODULE — Granite Park Capital (company_id = 1)
//
// This entire module is specific to Granite Park Capital's
// post-event follow-up sequences (yacht events, investor dinners).
// All templates, signatures, links, and pipeline IDs are GPC-branded.
//
// DO NOT use this module for Brand Me Now (company_id = 2) or any
// other company. BMN will need its own event sequence module with
// creator-specific language and flows if/when needed.
// ═══════════════════════════════════════════════════════════════
import { GPC_COMPANY_ID } from './gpc/config';

// ── Types ────────────────────────────────────────────────────

interface SequenceStep {
  step: number;
  dayOffset: number;
  channel: 'Email' | 'SMS';
  subject?: string;
  getBody: (firstName: string) => string;
  getHtml?: (firstName: string) => string;
}

interface SequenceConfig {
  id: string;
  name: string;
  eventName: string;
  eventDate: string;
  tag: string;
  requiredTags: string[];
  excludeStageIds: string[];
  pipelineId: string;
  notInterestedStageId: string;
  bookedStageId: string;
  bookingLink: string;
  deckLink: string;
  steps: SequenceStep[];
}

interface EnrolledContact {
  contactId: string;
  firstName: string;
  email: string;
  phone: string;
  enrolledAt: string; // ISO date
  currentStep: number;
  status: 'active' | 'opted-out' | 'booked' | 'replied' | 'completed';
  lastSentAt: string | null;
  lastSentStep: number;
}

interface SequenceState {
  config: { id: string; name: string; eventDate: string; startedAt: string };
  contacts: EnrolledContact[];
}

// ── Opt-Out Detection ────────────────────────────────────────

const OPT_OUT_PATTERNS = [
  /\bnot interested\b/i,
  /\bremove me\b/i,
  /\bremove\b/i,
  /\bstop\b/i,
  /\bunsubscribe\b/i,
  /\btake me off\b/i,
  /\bno thanks\b/i,
  /\bopt out\b/i,
];

function isOptOut(message: string): boolean {
  return OPT_OUT_PATTERNS.some(p => p.test(message));
}

// ── Email HTML Builder ───────────────────────────────────────

function wrapEmailHtml(body: string): string {
  return `<div style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a; max-width: 600px;">${body}</div>`;
}

function signature(): string {
  return `<br><br>Colby Watkins<br>Fund Manager | Granite Park Capital<br><a href="https://granitepark.co">granitepark.co</a><br>1126 S Federal Hwy #704, Ft. Lauderdale, FL 33316`;
}

function signatureShort(): string {
  return `<br><br>Colby Watkins<br>Fund Manager | Granite Park Capital`;
}

// ── Sequence Template: VNTR x Granite Park Party ─────────────

const BOOKING_LINK = 'https://api.leadconnectorhq.com/widget/bookings/granite-park-fund';
const DECK_LINK = 'https://drive.google.com/file/d/1_t0RVOg47WqIKt16mo3jEz1n_4m0Dkzz/view?usp=drive_link';

function buildEventSequence(eventName: string, deckLink: string, bookingLink: string): SequenceStep[] {
  return [
    // STEP 1 — Day 1 | Email | Personal Thank You + Deck
    {
      step: 1, dayOffset: 1, channel: 'Email',
      subject: `Great connecting at the ${eventName}`,
      getBody: (fn) => `Hi ${fn},

Colby here from Granite Park Capital — really enjoyed meeting you at the ${eventName} on the yacht last night. Hope you had a great time.

I wanted to follow up while we're fresh. We're currently raising Fund II — a $50M affordable housing fund focused on stabilized, cash-flowing multifamily communities backed by government Section 8 contracts.

Quick snapshot of what we're building:

- Fund I delivered 179% return on equity in 2 years — fully subscribed at $50M
- Quarterly distributions backed by government Section 8 contracts
- Cost segregation + accelerated depreciation for significant tax savings in early years
- Cash-out refinances are tax-free — you access gains without triggering a taxable event
- We're also open to larger 1031 exchanges into the fund
- Our team co-invests significant capital — we eat what we cook
- 4th-generation operator managing 17,000+ units (~$2B portfolio)

I put together our investor deck if you'd like to take a look:

Download Investor Deck: ${deckLink}

If any of this resonates, I'd love to grab 15 minutes to walk you through how it might fit your portfolio.

Book a Quick Call: ${bookingLink}

P.S. — If this isn't a fit for you right now, no worries at all. Just reply "not interested" and I'll take you off the list. No hard feelings.`,
      getHtml: (fn) => wrapEmailHtml(`
<p>Hi ${fn},</p>
<p>Colby here from Granite Park Capital — really enjoyed meeting you at the ${eventName} on the yacht last night. Hope you had a great time.</p>
<p>I wanted to follow up while we're fresh. We're currently raising Fund II — a $50M affordable housing fund focused on stabilized, cash-flowing multifamily communities backed by government Section 8 contracts.</p>
<p>Quick snapshot of what we're building:</p>
<ul>
<li>Fund I delivered <strong>179% return on equity in 2 years</strong> — fully subscribed at $50M</li>
<li>Quarterly distributions backed by government Section 8 contracts</li>
<li>Cost segregation + accelerated depreciation for significant tax savings in early years</li>
<li>Cash-out refinances are tax-free — you access gains without triggering a taxable event</li>
<li>We're also open to larger 1031 exchanges into the fund</li>
<li>Our team co-invests significant capital — we eat what we cook</li>
<li>4th-generation operator managing 17,000+ units (~$2B portfolio)</li>
</ul>
<p>I put together our investor deck if you'd like to take a look:</p>
<p>👉 <a href="${deckLink}">Download Investor Deck</a></p>
<p>If any of this resonates, I'd love to grab 15 minutes to walk you through how it might fit your portfolio.</p>
<p><a href="${bookingLink}">Book a Quick Call</a></p>
${signature()}
<p style="font-size:13px;color:#666;">P.S. — If this isn't a fit for you right now, no worries at all. Just reply "not interested" and I'll take you off the list. No hard feelings.</p>
`),
    },

    // STEP 2 — Day 1 (2 hrs after) | SMS
    {
      step: 2, dayOffset: 1, channel: 'SMS',
      getBody: (fn) => `Hey ${fn}, it's Colby from the ${eventName}. Just sent you an email with our investor deck — wanted to make sure it didn't get buried. Would love to grab 15 min to walk you through what we're doing in affordable housing. Here's my calendar: ${bookingLink}\n\nReply STOP to opt out.`,
    },

    // STEP 3 — Day 3 | Email | Fund I Results + Why Now
    {
      step: 3, dayOffset: 3, channel: 'Email',
      subject: 'Our Fund I just delivered 179% ROE — here\'s what\'s next',
      getBody: (fn) => `Hi ${fn},

Quick update I wanted to share — our Fund I just hit a milestone that I think tells the whole story:

179% return on equity in just 2 years.

Every dollar of that came from government-backed Section 8 rental income. No speculation. No hope-and-pray appreciation plays. Just stable, contracted cash flow from the federal government.

Fund I is fully subscribed at $50M and performing exactly as projected. Q3 distributions came in at $320K across the portfolio — on schedule, from government checks.

That's why we launched Fund II.

What's different about right now:

Congress just passed the FY2026 budget — Section 8 funding increased $2.4 billion to $38.4B. That's the largest increase in years. Despite all the noise about HUD cuts, they actually rejected $33B in proposed cuts and INCREASED funding instead.

Meanwhile, there are 7.2 million families on waitlists for affordable housing. The demand isn't going anywhere — it's getting worse.

Fund II targets the same strategy that delivered for Fund I, at a larger scale.

If you'd like to see the full picture, I'm happy to walk you through it:

Book 15 Minutes With Me: ${bookingLink}

P.S. — Not interested? Just reply "remove me" and I'll respect that immediately.`,
      getHtml: (fn) => wrapEmailHtml(`
<p>Hi ${fn},</p>
<p>Quick update I wanted to share — our Fund I just hit a milestone that I think tells the whole story:</p>
<p><strong>179% return on equity in just 2 years.</strong></p>
<p>Every dollar of that came from government-backed Section 8 rental income. No speculation. No hope-and-pray appreciation plays. Just stable, contracted cash flow from the federal government.</p>
<p>Fund I is fully subscribed at $50M and performing exactly as projected. Q3 distributions came in at $320K across the portfolio — on schedule, from government checks.</p>
<p>That's why we launched Fund II.</p>
<p><strong>What's different about right now:</strong></p>
<p>Congress just passed the FY2026 budget — Section 8 funding increased $2.4 billion to $38.4B. That's the largest increase in years. Despite all the noise about HUD cuts, they actually rejected $33B in proposed cuts and INCREASED funding instead.</p>
<p>Meanwhile, there are 7.2 million families on waitlists for affordable housing. The demand isn't going anywhere — it's getting worse.</p>
<p>Fund II targets the same strategy that delivered for Fund I, at a larger scale.</p>
<p>If you'd like to see the full picture, I'm happy to walk you through it:</p>
<p><a href="${bookingLink}">Book 15 Minutes With Me</a></p>
${signatureShort()}
<p style="font-size:13px;color:#666;">P.S. — Not interested? Just reply "remove me" and I'll respect that immediately.</p>
`),
    },

    // STEP 4 — Day 5 | SMS | Social Proof Nudge
    {
      step: 4, dayOffset: 5, channel: 'SMS',
      getBody: (fn) => `Hey ${fn}, Colby from Granite Park. Fund II just crossed 30% subscribed on our $50M raise. We're seeing a lot of interest from family offices moving into government-backed housing this year. Happy to share what's driving it if you want to grab 15 min: ${bookingLink}\n\nReply STOP to opt out.`,
    },

    // STEP 5 — Day 7 | Email | Government Tailwind Deep Dive
    {
      step: 5, dayOffset: 7, channel: 'Email',
      subject: 'Congress just made our business model stronger',
      getBody: (fn) => `Hi ${fn},

I keep getting asked: "With all the political noise, is affordable housing still safe?"

The answer is yes — and the numbers just got significantly better.`,
      getHtml: (fn) => wrapEmailHtml(`
<p>Hi ${fn},</p>
<p>I keep getting asked: "With all the political noise, is affordable housing still safe?"</p>
<p>The answer is yes — and the numbers just got significantly better. Here's what happened this year:</p>
<p><strong>Federal Funding (FY2026):</strong></p>
<ul>
<li>Section 8 budget: $38.4B (+$2.4B increase)</li>
<li>Total HUD budget: $77.3B (+$7.2B increase)</li>
<li>60,000 new Housing Choice Vouchers distributed</li>
<li>The President proposed $33B in HUD cuts. Congress said no and increased funding instead.</li>
</ul>
<p><strong>Affordable Housing Expansion (now permanent law):</strong></p>
<ul>
<li>Bond financing threshold cut from 50% to 25% — massive unlock for new deals</li>
<li>Novogradac projects 1.22 million additional affordable homes over the next decade</li>
<li>New supply pipeline is shrinking — starts declining, setting up stronger fundamentals late 2026–2027</li>
</ul>
<p><strong>Fannie Mae &amp; Freddie Mac:</strong></p>
<ul>
<li>2026 lending caps: $176B combined (up 20.5% from last year)</li>
<li>At least 50% must go to affordable housing</li>
<li>Affordable housing investment authority doubled to $4B annually</li>
</ul>
<p><strong>The demand side:</strong></p>
<ul>
<li>7.2 million affordable rental home shortage nationwide</li>
<li>Only 35 affordable units available per 100 extremely low-income households</li>
<li>Section 8 waitlists run 4–8+ years in major cities</li>
</ul>
<p>This is the environment we're operating in. Government funding is at record highs, demand is at record highs, and supply can't keep up. That's why Section 8 rents are guaranteed and our occupancy stays in the mid-90s.</p>
<p>I'd love 15 minutes to show you how we're positioned to capture this:</p>
<p><a href="${bookingLink}">Book a Quick Call</a></p>
${signatureShort()}
<p style="font-size:13px;color:#666;">P.S. — If you'd rather not hear from me, just reply "not interested" and I'll remove you right away.</p>
`),
    },

    // STEP 6 — Day 10 | SMS | Direct Ask
    {
      step: 6, dayOffset: 10, channel: 'SMS',
      getBody: (fn) => `${fn}, it's Colby. I know you're busy — just wanted to see if 15 minutes this week works to walk through the fund. We've had a few spots open up on the calendar: ${bookingLink}\n\nNo pressure. If it's not a fit, just say the word.\n\nReply STOP to opt out.`,
    },

    // STEP 7 — Day 14 | Email | Tax Benefits Breakdown
    {
      step: 7, dayOffset: 14, channel: 'Email',
      subject: 'How our LPs keep more of what they make',
      getHtml: (fn) => wrapEmailHtml(`
<p>Hi ${fn},</p>
<p>One thing that surprises most investors about our fund: the tax advantages are built into the structure from day one.</p>
<p>Here's how it works:</p>
<p><strong>Cost Segregation + Accelerated Depreciation</strong></p>
<p>We use cost segregation studies to accelerate depreciation on property components — creating significant paper losses that offset your taxable income in the early years. This is one of the most powerful tools in real estate, and we build it into every acquisition.</p>
<p><strong>Cash-Out Refinance = Tax-Free Access to Gains</strong></p>
<p>As properties appreciate and we reposition assets, we use cash-out refinances to return capital to investors. The key: refinance proceeds are not a taxable event. You're accessing your gains without triggering taxes.</p>
<p><strong>1031 Exchange Friendly</strong></p>
<p>We're also structured to accept larger 1031 exchanges into the fund — so if you're sitting on gains from another property, this is a clean way to defer and redeploy.</p>
<p><strong>The Full Return Stack:</strong></p>
<ol>
<li>7% preferred return (quarterly, from Section 8 income)</li>
<li>Appreciation on asset repositioning</li>
<li>Cost segregation + accelerated depreciation</li>
<li>Tax-free cash-out refinances</li>
<li>1031 exchange eligibility</li>
</ol>
<p>Fund I delivered 179% ROE in 2 years using this exact strategy — and investors kept more of it because of the tax structure.</p>
<p>Want to see how this could work for your specific situation? Happy to walk through the numbers:</p>
<p><a href="${bookingLink}">Book 15 Minutes</a></p>
${signatureShort()}
<p style="font-size:13px;color:#666;">P.S. — Not your thing? Reply "remove" and you're off the list. Totally respect it.</p>
`),
      getBody: (fn) => `Hi ${fn}, one thing that surprises most investors about our fund: the tax advantages are built in from day one. Cost segregation, tax-free cash-out refinances, 1031 exchanges — Fund I investors kept more because of the structure. Want to see how it works? ${bookingLink}`,
    },

    // STEP 8 — Day 17 | SMS | Urgency
    {
      step: 8, dayOffset: 17, channel: 'SMS',
      getBody: (fn) => `Hey ${fn}, Colby from Granite Park. Quick heads up — Fund II is past 30% subscribed and we're targeting close in the coming weeks. If you've been thinking about it, now's a good time to grab 15 min so I can walk you through the details: ${bookingLink}\n\nReply STOP to opt out.`,
    },

    // STEP 9 — Day 21 | Email | Final Value + Breakup
    {
      step: 9, dayOffset: 21, channel: 'Email',
      subject: 'Last note from me (unless you say otherwise)',
      getHtml: (fn) => wrapEmailHtml(`
<p>Hi ${fn},</p>
<p>I've reached out a few times and I want to be respectful of your time. This will be my last email unless you'd like to continue the conversation.</p>
<p>Here's the quick summary of what we're offering:</p>
<p><strong>Granite Park Capital Affordable Housing Fund II</strong></p>
<ul>
<li>$50M target raise (past 30% subscribed)</li>
<li>7% preferred return, paid quarterly from government Section 8 contracts</li>
<li>Fund I delivered 179% ROE in 2 years — performing exactly as projected</li>
<li>Tax advantages: cost segregation, accelerated depreciation, tax-free cash-out refinances, 1031 exchange eligible</li>
<li>4th-generation operator managing 17,000+ units across a ~$2B portfolio</li>
<li>GP co-invests alongside every LP</li>
</ul>
<p><strong>Why now:</strong></p>
<ul>
<li>Section 8 funding at $38.4B (historic high)</li>
<li>Affordable housing legislation permanently expanded by Congress</li>
<li>7.2 million affordable home shortage nationwide</li>
<li>Class B/C multifamily outperforming Class A on rent growth, occupancy, and cap rates</li>
</ul>
<p>If any of this interests you — even down the road — I'm always happy to chat:</p>
<p><a href="${bookingLink}">Book a Call Anytime</a></p>
<p>If not, no hard feelings at all. Just reply "not interested" and I'll take you off the list.</p>
<p>Either way, it was great meeting you at the ${eventName}. Wishing you the best.</p>
<br>Colby Watkins<br>Fund Manager | Granite Park Capital<br><a href="https://granitepark.co">granitepark.co</a>
`),
      getBody: (fn) => `Hi ${fn}, this is my last note — I want to be respectful of your time. If Granite Park's affordable housing fund interests you (even down the road), I'm always here: ${bookingLink}. If not, reply "not interested" and I'll remove you. Either way, great meeting you at the ${eventName}. — Colby`,
    },

    // STEP 10 — Day 25 | SMS | Last Call
    {
      step: 10, dayOffset: 25, channel: 'SMS',
      getBody: (fn) => `Hey ${fn}, Colby from the ${eventName}. Last note from me — if you ever want to learn more about what we're doing in affordable housing, my calendar is always open: ${bookingLink}\n\nIf not, just reply NOT INTERESTED and I'll remove you. All good either way.\n\nReply STOP to opt out.`,
    },
  ];
}

// ── State Persistence ────────────────────────────────────────

const STATE_DIR = path.join(process.cwd(), 'data', 'sequences');

function stateFilePath(sequenceId: string): string {
  return path.join(STATE_DIR, `${sequenceId}.json`);
}

function loadState(sequenceId: string): SequenceState | null {
  const fp = stateFilePath(sequenceId);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function saveState(sequenceId: string, state: SequenceState): void {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFilePath(sequenceId), JSON.stringify(state, null, 2));
}

// ── Reply Classification (Claude) ────────────────────────────

async function classifyReply(message: string, contactName: string): Promise<{
  intent: 'opt-out' | 'interested' | 'question' | 'booking' | 'neutral';
  summary: string;
  suggestedAction: string;
}> {
  // Quick opt-out check without calling Claude
  if (isOptOut(message)) {
    return {
      intent: 'opt-out',
      summary: `${contactName} wants to be removed from the sequence.`,
      suggestedAction: 'Remove from sequence and move to Not Interested stage.',
    };
  }

  if (!config.anthropicApiKey) {
    return {
      intent: 'neutral',
      summary: `${contactName} replied: "${message.substring(0, 100)}"`,
      suggestedAction: 'Review manually — Claude API not configured.',
    };
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Classify this reply from a potential investor (${contactName}) who received outreach about Granite Park Capital's affordable housing fund:

"${message}"

Classify intent as one of: opt-out, interested, question, booking, neutral
Provide a 1-sentence summary and a suggested action for the fund manager.

Respond in JSON: {"intent": "...", "summary": "...", "suggestedAction": "..."}
Only output valid JSON.`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  try {
    return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
  } catch {
    return {
      intent: 'neutral',
      summary: `${contactName} replied: "${message.substring(0, 100)}"`,
      suggestedAction: 'Review manually — could not parse Claude response.',
    };
  }
}

// ── Notification (SMS to Colby) ──────────────────────────────

const COLBY_CONTACT_ID = 'cIHEhSgoSQdFZJ9A8cnY'; // Colby's GHL contact ID
const COLBY_PHONE = '+15083973792';

async function notifyColby(message: string): Promise<void> {
  const ghl = ghlService.getClient(GPC_COMPANY_ID); // Granite Park Capital
  if (!ghl) { console.error('[Sequence] No GHL client for notifications'); return; }

  try {
    await ghl.sendMessage({
      contactId: COLBY_CONTACT_ID,
      type: 'SMS',
      message: `[Post-Event Sequence] ${message}`,
    });
    console.log(`[Sequence] Notified Colby: ${message.substring(0, 80)}`);
  } catch (err) {
    console.error('[Sequence] Failed to notify Colby:', err);
  }
}

// ── Core Sequence Engine ─────────────────────────────────────

export class PostEventSequence {
  private config: SequenceConfig;
  private cronJob: cron.ScheduledTask | null = null;
  private replyCheckJob: cron.ScheduledTask | null = null;

  constructor(seqConfig: SequenceConfig) {
    this.config = seqConfig;
  }

  get sequenceId(): string { return this.config.id; }

  // Enroll contacts matching tags, excluding test contacts and specified stages
  async enrollContacts(): Promise<EnrolledContact[]> {
    const ghl = ghlService.getClient(GPC_COMPANY_ID);
    if (!ghl) throw new Error('GHL client not available');

    // Fetch contacts with the event tag
    const result = await ghl.searchContacts(this.config.tag, 100);
    const contacts: any[] = result.contacts || [];

    // Filter: must have all required tags, exclude test contacts and Colby
    const testPatterns = [/^test/i, /test\.com$/, /example\.com$/, /\+15555/];
    const colbyEmails = ['colby@whbiopharma.com', 'colby@granitepark.co'];

    const eligible = contacts.filter(c => {
      const tags: string[] = c.tags || [];
      const hasAllTags = this.config.requiredTags.every(t => tags.includes(t));
      if (!hasAllTags) return false;

      const name = (c.contactName || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const phone = c.phone || '';

      // Exclude test contacts
      if (testPatterns.some(p => p.test(name) || p.test(email) || p.test(phone))) return false;
      // Exclude Colby
      if (colbyEmails.includes(email)) return false;

      return true;
    });

    // Check for contacts in excluded stages (Colby Warm Nurture, etc.)
    // We already verified 0 contacts in that stage, but this handles future cases
    // TODO: If needed, fetch opportunities for each contact and check stage

    const enrolled: EnrolledContact[] = eligible.map(c => ({
      contactId: c.id,
      firstName: c.firstNameRaw || c.firstName || c.contactName?.split(' ')[0] || 'there',
      email: c.email || '',
      phone: c.phone || '',
      enrolledAt: new Date().toISOString(),
      currentStep: 0,
      status: 'active' as const,
      lastSentAt: null,
      lastSentStep: 0,
    }));

    // Save state
    const state: SequenceState = {
      config: {
        id: this.config.id,
        name: this.config.name,
        eventDate: this.config.eventDate,
        startedAt: new Date().toISOString(),
      },
      contacts: enrolled,
    };
    saveState(this.config.id, state);

    console.log(`[Sequence:${this.config.id}] Enrolled ${enrolled.length} contacts (filtered from ${contacts.length} tagged)`);
    return enrolled;
  }

  // Process the next batch of sends
  async processSends(): Promise<{ sent: number; errors: number }> {
    const state = loadState(this.config.id);
    if (!state) { console.log(`[Sequence:${this.config.id}] No state found`); return { sent: 0, errors: 0 }; }

    const ghl = ghlService.getClient(GPC_COMPANY_ID);
    if (!ghl) { console.error('[Sequence] No GHL client'); return { sent: 0, errors: 0 }; }

    const now = new Date();
    let sent = 0;
    let errors = 0;

    for (const contact of state.contacts) {
      if (contact.status !== 'active') continue;

      const nextStep = contact.lastSentStep + 1;
      const stepDef = this.config.steps.find(s => s.step === nextStep);
      if (!stepDef) {
        // Sequence complete for this contact
        contact.status = 'completed';
        continue;
      }

      // Calculate when this step should fire
      const enrollDate = new Date(contact.enrolledAt);
      const sendDate = new Date(enrollDate);
      sendDate.setDate(sendDate.getDate() + stepDef.dayOffset);

      // For step 2 (SMS 2hrs after step 1), add 2 hours
      if (stepDef.step === 2 && contact.lastSentStep === 1) {
        const lastSent = contact.lastSentAt ? new Date(contact.lastSentAt) : sendDate;
        sendDate.setTime(lastSent.getTime() + 2 * 60 * 60 * 1000);
      }

      // Set send time to 9 AM ET on the target day (except step 2)
      if (stepDef.step !== 2) {
        sendDate.setHours(9, 0, 0, 0);
      }

      if (now < sendDate) continue; // Not time yet

      try {
        if (stepDef.channel === 'Email') {
          const html = stepDef.getHtml
            ? stepDef.getHtml(contact.firstName)
            : wrapEmailHtml(`<p>${stepDef.getBody(contact.firstName).replace(/\n/g, '</p><p>')}</p>`);
          await ghl.sendMessage({
            contactId: contact.contactId,
            type: 'Email',
            subject: stepDef.subject || `Update from Granite Park Capital`,
            html,
          });
        } else {
          await ghl.sendMessage({
            contactId: contact.contactId,
            type: 'SMS',
            message: stepDef.getBody(contact.firstName),
          });
        }

        contact.lastSentStep = stepDef.step;
        contact.lastSentAt = now.toISOString();
        contact.currentStep = stepDef.step;
        sent++;

        console.log(`[Sequence:${this.config.id}] Step ${stepDef.step} (${stepDef.channel}) sent to ${contact.firstName} (${contact.contactId})`);

        // Rate limit: 500ms between sends
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        errors++;
        console.error(`[Sequence:${this.config.id}] Error sending step ${stepDef.step} to ${contact.firstName}:`, err);
      }
    }

    saveState(this.config.id, state);

    if (sent > 0) {
      console.log(`[Sequence:${this.config.id}] Batch complete: ${sent} sent, ${errors} errors`);
    }
    return { sent, errors };
  }

  // Check for replies and classify them
  async checkReplies(): Promise<void> {
    const state = loadState(this.config.id);
    if (!state) return;

    const ghl = ghlService.getClient(GPC_COMPANY_ID);
    if (!ghl) return;

    for (const contact of state.contacts) {
      if (contact.status !== 'active') continue;
      if (!contact.lastSentAt) continue;

      try {
        // Search conversations for this contact
        const convResult = await ghl.searchConversations(contact.contactId, 1);
        const conversations = convResult.conversations || [];

        if (conversations.length === 0) continue;

        const conv = conversations[0];
        // Check if the last message is inbound and after our last send
        if (conv.lastMessageDirection !== 'inbound') continue;

        const lastMsgDate = new Date(conv.lastMessageDate || conv.dateUpdated);
        const lastSentDate = new Date(contact.lastSentAt);

        if (lastMsgDate <= lastSentDate) continue;

        // We have a new inbound reply!
        const messageBody = conv.lastMessageBody || '';
        const classification = await classifyReply(messageBody, contact.firstName);

        console.log(`[Sequence:${this.config.id}] Reply from ${contact.firstName}: ${classification.intent}`);

        if (classification.intent === 'opt-out') {
          contact.status = 'opted-out';
          // Add tag and move to Not Interested
          await ghl.addContactTags(contact.contactId, ['opted-out-post-event']);
          // Send confirmation
          await ghl.sendMessage({
            contactId: contact.contactId,
            type: conv.lastMessageType?.includes('SMS') ? 'SMS' : 'Email',
            message: "Got it — you've been removed. If anything changes down the road, feel free to reach out anytime. Best, Colby",
          });
          await notifyColby(`${contact.firstName} (${contact.email}) opted out of post-event sequence.`);
        } else if (classification.intent === 'interested' || classification.intent === 'booking') {
          contact.status = 'booked';
          await ghl.addContactTags(contact.contactId, ['replied-post-event']);
          await notifyColby(`🔥 ${contact.firstName} (${contact.email}) is interested! "${messageBody.substring(0, 80)}" — ${classification.suggestedAction}`);
        } else if (classification.intent === 'question') {
          contact.status = 'replied';
          await ghl.addContactTags(contact.contactId, ['replied-post-event']);
          await notifyColby(`❓ ${contact.firstName} (${contact.email}) asked: "${messageBody.substring(0, 80)}" — Review and respond manually.`);
        } else {
          // Neutral — still notify
          await ghl.addContactTags(contact.contactId, ['replied-post-event']);
          await notifyColby(`💬 ${contact.firstName} (${contact.email}) replied: "${messageBody.substring(0, 80)}" — ${classification.suggestedAction}`);
          contact.status = 'replied';
        }

        // Rate limit between contact checks
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.error(`[Sequence:${this.config.id}] Error checking replies for ${contact.firstName}:`, err);
      }
    }

    saveState(this.config.id, state);
  }

  // Start automated processing
  start(): void {
    // Process sends every hour at :05
    this.cronJob = cron.schedule('5 * * * *', async () => {
      try { await this.processSends(); } catch (err) { console.error('[Sequence] processSends error:', err); }
    });

    // Check replies every 30 minutes
    this.replyCheckJob = cron.schedule('*/30 * * * *', async () => {
      try { await this.checkReplies(); } catch (err) { console.error('[Sequence] checkReplies error:', err); }
    });

    console.log(`[Sequence:${this.config.id}] Started — sends at :05 every hour, reply checks every 30min`);
  }

  stop(): void {
    this.cronJob?.stop();
    this.replyCheckJob?.stop();
    console.log(`[Sequence:${this.config.id}] Stopped`);
  }

  // Get current status
  getStatus(): { total: number; active: number; optedOut: number; booked: number; replied: number; completed: number; nextSends: any[] } {
    const state = loadState(this.config.id);
    if (!state) return { total: 0, active: 0, optedOut: 0, booked: 0, replied: 0, completed: 0, nextSends: [] };

    const contacts = state.contacts;
    const now = new Date();

    const nextSends = contacts
      .filter(c => c.status === 'active')
      .map(c => {
        const nextStep = c.lastSentStep + 1;
        const stepDef = this.config.steps.find(s => s.step === nextStep);
        if (!stepDef) return null;
        const sendDate = new Date(c.enrolledAt);
        sendDate.setDate(sendDate.getDate() + stepDef.dayOffset);
        return { name: c.firstName, step: nextStep, channel: stepDef.channel, scheduledFor: sendDate.toISOString() };
      })
      .filter(Boolean)
      .slice(0, 10);

    return {
      total: contacts.length,
      active: contacts.filter(c => c.status === 'active').length,
      optedOut: contacts.filter(c => c.status === 'opted-out').length,
      booked: contacts.filter(c => c.status === 'booked').length,
      replied: contacts.filter(c => c.status === 'replied').length,
      completed: contacts.filter(c => c.status === 'completed').length,
      nextSends,
    };
  }
}

// ── Factory: Create March 18 Yacht Event Sequence ────────────

export function createYachtEventSequence(): PostEventSequence {
  const steps = buildEventSequence('VNTR x Granite Park Party', DECK_LINK, BOOKING_LINK);

  return new PostEventSequence({
    id: 'yacht-event-2026-03-18',
    name: 'Post-Event Follow-Up — VNTR x Granite Park Party (March 18)',
    eventName: 'VNTR x Granite Park Party',
    eventDate: '2026-03-18',
    tag: 'yacht-event-2026-03-18',
    requiredTags: ['attended-mixer', 'yacht-event-2026-03-18'],
    excludeStageIds: ['690b47f0-2dfe-4bf5-8fc1-93b7c439ca79'], // Colby Warm Nurture
    pipelineId: 'GMqxElyHPSr2karweCGS',
    notInterestedStageId: 'f287eacd-8301-434d-8b84-789529def681',
    bookedStageId: '450dd1b9-6ab2-4c86-af74-ed9f8e5ec373',
    bookingLink: BOOKING_LINK,
    deckLink: DECK_LINK,
    steps,
  });
}

// ── Factory: Create Sequence for ANY Future Event ────────────

/** GPC-only factory. Throws if called for a non-GPC company. */
export function createEventSequence(params: {
  eventId: string;
  eventName: string;
  eventDate: string;
  tag: string;
  companyId?: number;
  deckLink?: string;
  bookingLink?: string;
}): PostEventSequence {
  if (params.companyId && params.companyId !== GPC_COMPANY_ID) {
    throw new Error(`[PostEventSequence] This module is GPC-only (company_id=${GPC_COMPANY_ID}). Cannot create sequence for company_id=${params.companyId}.`);
  }
  const steps = buildEventSequence(
    params.eventName,
    params.deckLink || DECK_LINK,
    params.bookingLink || BOOKING_LINK,
  );

  return new PostEventSequence({
    id: params.eventId,
    name: `Post-Event Follow-Up — ${params.eventName}`,
    eventName: params.eventName,
    eventDate: params.eventDate,
    tag: params.tag,
    requiredTags: ['attended-mixer', params.tag],
    excludeStageIds: ['690b47f0-2dfe-4bf5-8fc1-93b7c439ca79'],
    pipelineId: 'GMqxElyHPSr2karweCGS',
    notInterestedStageId: 'f287eacd-8301-434d-8b84-789529def681',
    bookedStageId: '450dd1b9-6ab2-4c86-af74-ed9f8e5ec373',
    bookingLink: params.bookingLink || BOOKING_LINK,
    deckLink: params.deckLink || DECK_LINK,
    steps,
  });
}
