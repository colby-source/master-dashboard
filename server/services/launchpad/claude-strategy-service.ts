/**
 * claude-strategy-service.ts — generates the 7-module StrategyPackage from a
 * BrandIntake. Mirrors the contract defined by the /socialmediamonster skill.
 *
 * Flow:
 *   - Modules 1-3 sequential (each becomes context for the next).
 *   - Modules 4-7 parallel (all consume modules 1-3 as context).
 *   - Single retry on a failing module before returning partial.
 *
 * Latency budget: ~3-4 minutes per package (4 parallel calls + 3 sequential).
 */

import { claudeService } from '../claude-service';
import { createLogger } from '../../utils/logger';
import type { BrandIntake, StrategyPackage } from './types';

const log = createLogger('claude-strategy-service');

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4000;
const PER_MODULE_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes per Claude call

export interface GenerateResult {
  package?: StrategyPackage;
  partial: boolean;
  errors?: { module: number; error: string }[];
}

const SYSTEM_PROMPT = `You are SocialMediaMonster, a world-class social media strategist + direct-response copywriter. You are generating one module of a 7-module social media launch package for a Brand Me Now (BMN) brand client.

Non-negotiables:
- Be DECISIVE and SPECIFIC. No "TBD", no "consider", no "might". Every output is execution-ready.
- Match the brand's voice rules from intake.brand_voice_dos and brand_voice_donts.
- Banned phrases (NEVER use): "elevate your brand", "unlock your potential", "in today's fast-paced world", "game-changing", "revolutionize", "discover", "transform", "empower".
- Output raw JSON only. No markdown fences, no commentary. Match the requested schema exactly.
- For BMN brands specifically: voice is creator-led, honest, anti-hype. No corporate-speak.`;

async function callClaude(prompt: string): Promise<string> {
  const client = claudeService.getClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_MODULE_TIMEOUT_MS);
  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal },
    );
    return response.content[0].type === 'text' ? response.content[0].text : '';
  } finally {
    clearTimeout(timer);
  }
}

function parseJson<T>(raw: string, moduleName: string): T {
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    log.error(`[Strategy] Failed to parse ${moduleName} JSON. First 500 chars: ${cleaned.slice(0, 500)}`);
    throw new Error(`${moduleName}: invalid JSON returned by Claude`, { cause: err });
  }
}

// ── Module prompts ──────────────────────────────────────────

function module1Prompt(intake: BrandIntake): string {
  return `Brand intake:
${JSON.stringify(intake, null, 2)}

Produce module 1 — MasterStrategy. Schema:
{
  "brand_one_liner": "<100 chars, niche + differentiator",
  "positioning_statement": "For [ICP] who [trigger], BRAND is the [category] that [unique mechanism] (Geoffrey Moore format)",
  "category_play": "Category Creator | Challenger | Niche Leader | Premium",
  "three_pillars_of_brand": ["pillar 1", "pillar 2", "pillar 3"],
  "ninety_day_north_star_metric": "single measurable KPI tied to primary_goal",
  "channel_strategy": [{"platform": "instagram", "role": "...", "weekly_cadence": "..."}]
}

channel_strategy must include primary_platform and every secondary_platforms entry.

Return raw JSON only.`;
}

function module2Prompt(intake: BrandIntake, module1: unknown): string {
  return `Brand intake:
${JSON.stringify(intake, null, 2)}

Module 1 (Master Strategy):
${JSON.stringify(module1, null, 2)}

Produce module 2 — IcpPsychology. Schema:
{
  "one_paragraph_persona": "4-6 sentences, named (e.g. 'Meet Sarah, 34, …')",
  "top_5_frustrations": ["specific, ≥10 words each, in their language"],
  "top_5_desires": ["specific, ≥10 words each"],
  "top_3_fears": ["the deeper 'what if I never...' fears"],
  "identity_aspiration": "wants to be seen as the kind of person who...",
  "language_to_use": ["10 phrases lifted from how they actually talk — no marketing buzzwords"],
  "language_to_avoid": ["5 phrases that would make them cringe"],
  "daily_content_habits": "2-3 sentences about when/how they consume content",
  "trust_triggers": ["5 specific things that make them buy"],
  "scroll_stoppers": ["5 hook patterns proven for THIS audience"]
}

Critical: language_to_use must include 0 buzzwords. Each frustration/desire ≥10 words and SPECIFIC (not "wants more confidence").

Return raw JSON only.`;
}

function module3Prompt(intake: BrandIntake, module1: unknown, module2: unknown): string {
  return `Brand intake:
${JSON.stringify(intake, null, 2)}

Module 1 (Strategy):
${JSON.stringify(module1, null, 2)}

Module 2 (ICP Psychology):
${JSON.stringify(module2, null, 2)}

The signature_belief from intake is the spine — expand it.

Produce module 3 — AuthorityPositioning. Schema:
{
  "unique_pov": "3-4 sentences expanding signature_belief",
  "contrarian_takes": ["5 things this brand says that the category won't — each must make a category insider uncomfortable"],
  "signature_frameworks": [{"name": "concrete name e.g. 'The 3-Layer Skin Test'", "explanation": "2-sentence usable explanation"}],
  "proof_pillars": ["5 sources of credibility — mix founder cred / IP / customer transformations / third-party / transparency"],
  "content_north_star": "ONE sentence that filters every future post"
}

signature_frameworks: exactly 3 entries with concrete names, not generic.
contrarian_takes must contradict actual category defaults — re-statements of category norms are REJECTED.

Return raw JSON only.`;
}

function module4Prompt(intake: BrandIntake, m1: unknown, m2: unknown, m3: unknown): string {
  const ratios: Record<string, string> = {
    awareness: '40% reach / 35% trust / 25% convert',
    list_build: '35% reach / 30% trust / 35% convert',
    sales: '25% reach / 30% trust / 45% convert',
    community: '30% reach / 50% trust / 20% convert',
  };
  return `Brand intake: ${JSON.stringify(intake)}
Module 1: ${JSON.stringify(m1)}
Module 2: ${JSON.stringify(m2)}
Module 3: ${JSON.stringify(m3)}

Produce module 4 — exactly 5 ContentPillars as a JSON array.

Mix rule for primary_goal=${intake.primary_goal}: ${ratios[intake.primary_goal] || ratios.awareness}.
posting_ratio across all 5 pillars must sum to 100%.

Each ContentPillar:
{
  "pillar_number": 1-5,
  "pillar_name": "ownable, NOT generic — 'Bathroom Cabinet Audits' beats 'Skincare Tips'",
  "why_it_works": "2-3 sentences tying to module 2 ICP psychology AND module 3 POV",
  "posting_ratio": "% of weekly content (e.g. '25%')",
  "goal": "reach | trust | convert",
  "example_topics": ["10 specific real post ideas, not categories"],
  "format_mix": ["reel", "carousel", ...],
  "signature_hook_pattern": "template hook that this pillar uses repeatedly"
}

Return raw JSON array of 5 ContentPillar objects.`;
}

function module5Prompt(intake: BrandIntake, m1: unknown, m2: unknown, m3: unknown, m4: unknown): string {
  const expectedCount = intake.posting_capacity === 'daily' ? 30 : intake.posting_capacity === '3x_week' ? 13 : 15;
  return `Brand intake: ${JSON.stringify(intake)}
Module 1: ${JSON.stringify(m1)}
Module 2: ${JSON.stringify(m2)}
Module 3: ${JSON.stringify(m3)}
Module 4 (Pillars): ${JSON.stringify(m4)}

Produce module 5 — a 30-day calendar with EXACTLY ${expectedCount} entries (posting_capacity=${intake.posting_capacity}).

Arc:
- Days 1-7: INTRODUCTION (founder, story, signature belief). Reach/trust dominant. Light CTAs.
- Days 8-17: TRUST (frameworks in action, transparency, 1-2 first soft offers).
- Days 18-24: DESIRE (case studies, transformations, proof). CTAs ramp up.
- Days 25-30: LAUNCH WEEK. Convert pillar dominates. Days 28-30 hit launch_week_promo.

Each CalendarEntry:
{
  "day": 1-30,
  "date_offset": "+0d", "+2d" relative to launch_date,
  "platform": "${intake.primary_platform}",
  "pillar_number": 1-5,
  "format": "reel | carousel | static | story | live | long_video",
  "hook": "≤120 chars — the first 3 seconds / first line",
  "body": "the FULL written caption/script/carousel copy. NOT a placeholder.",
  "cta": "specific CTA",
  "goal": "reach | trust | convert",
  "visual_direction": "1-line shot list / design note",
  "best_post_time": "e.g. '7:42pm ET' — stagger times across days",
  "hashtags": ["optional", "max 5"]
}

Use language_to_use from module 2 in actual copy. Hit each pillar's signature_hook_pattern at least 2x. No two entries with identical hook text.

Return raw JSON array of ${expectedCount} CalendarEntry objects sorted by day ascending.`;
}

function module6Prompt(intake: BrandIntake, m2: unknown, m3: unknown, m4: unknown): string {
  return `Brand intake: ${JSON.stringify(intake)}
Module 2: ${JSON.stringify(m2)}
Module 3: ${JSON.stringify(m3)}
Module 4 (Pillars): ${JSON.stringify(m4)}

Produce module 6 — 50 unique hooks. Use these 25 patterns, 2 hooks per pattern:

A. Curiosity (12 hooks): 1) Contrarian declaration 2) Curiosity gap 3) Number+specificity 4) POV insider reveal 5) Shock claim
B. Identity (6 hooks): 6) Identity assertion 7) Aspirational reframe 8) Permission grant
C. Frustration (6 hooks): 9) Frustration mirror 10) Validation+redirection
D. Story (6 hooks): 11) Origin moment 12) BTS 13) Customer letter
E. Comparison (6 hooks): 14) This vs that 15) Before/after 16) Cost reframe
F. Education (6 hooks): 17) Framework reveal 18) Common mistake 19) Step-by-step
G. Urgency (4 hooks): 20) Scarcity drop 21) Insider access 22) Deadline
H. Vulnerability (4 hooks): 23) Founder confession 24) What I got wrong 25) Public learning

Each HookEntry:
{
  "number": 1-50,
  "hook_pattern": "one of the pattern names above",
  "hook_text": "the actual hook — must be ownable to THIS brand",
  "best_for_pillar": 1-5,
  "best_for_format": "reel | carousel | static"
}

OWNABILITY TEST — if a competitor could swap their name in and the hook still works, REJECT. Use module 2 language_to_use vocabulary.

Return raw JSON array of 50 HookEntry objects.`;
}

function module7Prompt(intake: BrandIntake, m1: unknown, m2: unknown, m3: unknown): string {
  return `Brand intake: ${JSON.stringify(intake)}
Module 1: ${JSON.stringify(m1)}
Module 2: ${JSON.stringify(m2)}
Module 3: ${JSON.stringify(m3)}

Produce module 7 — MonetizationFunnel. Schema:
{
  "offer_ladder": [{"tier": "name", "price": "$X", "pitch_line": "one-line pitch"}],
  "follower_to_buyer_sequence": [
    {"stage": "awareness", "content_angle": "...", "example_post_idea": "..."},
    {"stage": "interest", ...},
    {"stage": "desire", ...},
    {"stage": "action", ...}
  ],
  "cta_library": [{"context": "after a transformation post", "cta_copy": "exact copy"}],
  "bio_optimization": {"line": "the actual bio copy ≤150 chars", "link_strategy": "where the link goes"},
  "story_funnel_template": ["frame 1 hook", "frame 2 build", "frame 3 build", "frame 4 build", "frame 5 swipe-up CTA"],
  "dm_response_template": "≤4 sentences. Match brand voice. Soft CTA.",
  "launch_week_promo": "first-week-only offer with urgency (deadline / quantity / bonus). NOT just '20% off'."
}

offer_ladder: 3-5 tiers. Match intake.price_point_range — max tier ≤ 4x the high end of that range.
cta_library: 8 unique CTA contexts.

Return raw JSON only.`;
}

// ── Generation orchestration ──────────────────────────────

async function generateModule<T>(
  num: number,
  promptFn: () => string,
  fallback: T,
): Promise<{ data: T; error?: string }> {
  try {
    const raw = await callClaude(promptFn());
    const parsed = parseJson<T>(raw, `module${num}`);
    return { data: parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Strategy] Module ${num} generation failed: ${msg}. Retrying once...`);
    try {
      const raw2 = await callClaude(promptFn());
      const parsed2 = parseJson<T>(raw2, `module${num}`);
      return { data: parsed2 };
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2);
      log.error(`[Strategy] Module ${num} retry failed: ${msg2}`);
      return { data: fallback, error: msg2 };
    }
  }
}

export async function generateStrategyPackage(intake: BrandIntake): Promise<GenerateResult> {
  if (!claudeService.available) {
    return {
      partial: true,
      errors: [{ module: 0, error: 'Claude API not configured (ANTHROPIC_API_KEY missing)' }],
    };
  }

  const errors: { module: number; error: string }[] = [];
  const startedAt = Date.now();

  // ── Sequential phase: modules 1-3 ──
  log.info(`[Strategy] Starting generation for ${intake.brand_name}`);

  const m1 = await generateModule(1, () => module1Prompt(intake), null as unknown);
  if (m1.error) errors.push({ module: 1, error: m1.error });

  const m2 = await generateModule(2, () => module2Prompt(intake, m1.data), null as unknown);
  if (m2.error) errors.push({ module: 2, error: m2.error });

  const m3 = await generateModule(3, () => module3Prompt(intake, m1.data, m2.data), null as unknown);
  if (m3.error) errors.push({ module: 3, error: m3.error });

  // ── Parallel phase: modules 4-7 ──
  const [m4, m5, m6, m7] = await Promise.all([
    generateModule(4, () => module4Prompt(intake, m1.data, m2.data, m3.data), [] as unknown),
    generateModule(5, () => module5Prompt(intake, m1.data, m2.data, m3.data, [] as unknown), [] as unknown),
    generateModule(6, () => module6Prompt(intake, m2.data, m3.data, [] as unknown), [] as unknown),
    generateModule(7, () => module7Prompt(intake, m1.data, m2.data, m3.data), null as unknown),
  ]);

  if (m4.error) errors.push({ module: 4, error: m4.error });
  if (m5.error) errors.push({ module: 5, error: m5.error });
  if (m6.error) errors.push({ module: 6, error: m6.error });
  if (m7.error) errors.push({ module: 7, error: m7.error });

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  log.info(`[Strategy] Generation complete for ${intake.brand_name} in ${elapsedSec}s. ${errors.length} errors.`);

  const pkg: StrategyPackage = {
    generated_at: new Date().toISOString(),
    brand_name: intake.brand_name,
    module_1_master_strategy: m1.data,
    module_2_icp_psychology: m2.data,
    module_3_authority_positioning: m3.data,
    module_4_content_pillars: m4.data,
    module_5_thirty_day_calendar: m5.data,
    module_6_hook_bank: m6.data,
    module_7_monetization_funnel: m7.data,
  };

  return {
    package: pkg,
    partial: errors.length > 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export const claudeStrategyService = { generateStrategyPackage };
