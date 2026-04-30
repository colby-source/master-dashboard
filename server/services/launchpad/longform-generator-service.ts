/**
 * longform-generator-service.ts — Generates long-form scripts/articles per
 * content pillar based on the brand's strategy package. Output is a
 * camera-ready talking-head script (5-8 min if filmed) or a 1500-word
 * article. Each piece becomes a "source" that the text-chopper will turn
 * into 6-10 short-form pieces.
 */

import { claudeService } from '../claude-service';
import { createLogger } from '../../utils/logger';
import type { BrandIntake, StrategyPackage } from './types';

const log = createLogger('longform-generator');
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 5 * 60 * 1000;

const SYSTEM_PROMPT = `You are a long-form scriptwriter for a Brand Me Now (BMN) creator brand.
You write camera-ready talking-head scripts AND article-style long-form pieces
that the brand's founder can perform or publish, then chop into ~8 short-form
pieces apiece.

Non-negotiables:
- Pull voice + vocabulary from the brand's intake.brand_voice_dos / language_to_use
- Use the brand's signature_belief and unique_pov as the spine — never generic advice
- Banned phrases: "elevate", "unlock", "in today's fast-paced world", "game-changing", "revolutionize", "discover", "transform", "empower"
- Output raw JSON only, matching the requested schema exactly.`;

export interface GeneratedLongform {
  pillar_number: 1 | 2 | 3 | 4 | 5;
  title: string;
  format: 'talking_head_script' | 'article';
  body: string;            // 1200-2000 words
  estimated_duration_min: number; // for talking-head scripts
  key_segments: { timestamp_label: string; topic: string; quotable_line: string }[]; // 5-10 segments
}

async function callClaude(prompt: string): Promise<string> {
  const client = claudeService.getClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await client.messages.create(
      { model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }] },
      { signal: controller.signal },
    );
    return r.content[0].type === 'text' ? r.content[0].text : '';
  } finally {
    clearTimeout(timer);
  }
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

function buildPrompt(intake: BrandIntake, strategy: StrategyPackage, pillarNumber: number, format: 'talking_head_script' | 'article'): string {
  const formatGuidance = format === 'talking_head_script'
    ? `Format: TALKING-HEAD SCRIPT for the founder to film straight-to-camera.
- Open with a 7-second hook (most important sentence in the whole script)
- 5-8 minutes of spoken content (~900-1200 spoken words)
- Mark beats: [HOOK 0:00] [POINT 1 0:30] [POINT 2 1:30] ...
- Conversational pacing — short sentences, punchy transitions
- Include 3-5 quotable lines (will become standalone post hooks)
- End with a soft CTA that doesn't feel salesy`
    : `Format: ARTICLE / BLOG POST.
- 1500-2000 words
- Strong subhead (H2) every 200-300 words
- Specific examples, not abstractions
- Include 5-8 quotable single sentences
- End with soft conversion ask (newsletter, follow, product)`;

  return `Brand context:
${JSON.stringify({
  brand_name: intake.brand_name,
  niche: intake.niche,
  signature_belief: intake.signature_belief,
  founder_story: intake.founder_story,
  brand_voice_dos: intake.brand_voice_dos,
  brand_voice_donts: intake.brand_voice_donts,
  off_limits_topics: intake.off_limits_topics,
  legal_constraints: intake.legal_constraints,
}, null, 2)}

ICP psychology (from module 2):
${JSON.stringify(strategy.module_2_icp_psychology, null, 2)}

Authority POV (from module 3):
${JSON.stringify(strategy.module_3_authority_positioning, null, 2)}

Content pillars (from module 4):
${JSON.stringify(strategy.module_4_content_pillars, null, 2)}

You are writing one piece of long-form content for PILLAR ${pillarNumber}.
${formatGuidance}

Return raw JSON matching this shape:
{
  "pillar_number": ${pillarNumber},
  "title": "specific, benefit-driven, NOT generic",
  "format": "${format}",
  "body": "the full long-form text — script or article",
  "estimated_duration_min": ${format === 'talking_head_script' ? '5-8' : '0'},
  "key_segments": [
    {"timestamp_label": "0:00 (hook)" or "Section 1", "topic": "what this segment covers", "quotable_line": "the ONE line from this segment that could become a standalone short-form hook"}
  ]
}

key_segments must have 5-10 entries. Each quotable_line must pass the test: would I save this as a screenshot? It must be ownable to THIS brand's POV.

Return raw JSON only.`;
}

export async function generateLongform(params: {
  intake: BrandIntake;
  strategy: StrategyPackage;
  pillarNumber: number;
  format: 'talking_head_script' | 'article';
}): Promise<GeneratedLongform> {
  const raw = await callClaude(buildPrompt(params.intake, params.strategy, params.pillarNumber, params.format));
  try {
    return JSON.parse(stripFences(raw)) as GeneratedLongform;
  } catch (err) {
    log.error(`[Longform] Parse failed for pillar ${params.pillarNumber}. First 400 chars: ${stripFences(raw).slice(0, 400)}`);
    throw new Error(`Long-form generation failed for pillar ${params.pillarNumber}`, { cause: err });
  }
}

/**
 * Generate one long-form per pillar (5 total) in parallel. Default mix:
 * 3 talking-head scripts + 2 articles. Caller can override.
 */
export async function generateLongformBatch(params: {
  intake: BrandIntake;
  strategy: StrategyPackage;
  formatPerPillar?: Record<1 | 2 | 3 | 4 | 5, 'talking_head_script' | 'article'>;
}): Promise<{ results: GeneratedLongform[]; errors: { pillar: number; error: string }[] }> {
  const defaults: Record<number, 'talking_head_script' | 'article'> = {
    1: 'talking_head_script',
    2: 'talking_head_script',
    3: 'article',
    4: 'talking_head_script',
    5: 'article',
  };
  const formats: Record<number, 'talking_head_script' | 'article'> = {
    ...defaults,
    ...(params.formatPerPillar as Record<number, 'talking_head_script' | 'article'> || {}),
  };

  const tasks = [1, 2, 3, 4, 5].map(async (p) => {
    try {
      const result = await generateLongform({
        intake: params.intake,
        strategy: params.strategy,
        pillarNumber: p,
        format: formats[p],
      });
      return { ok: true as const, result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, pillar: p, error: msg };
    }
  });

  const settled = await Promise.all(tasks);
  const results = settled.filter((s): s is { ok: true; result: GeneratedLongform } => s.ok).map((s) => s.result);
  const errors = settled.filter((s): s is { ok: false; pillar: number; error: string } => !s.ok).map((s) => ({ pillar: s.pillar, error: s.error }));

  log.info(`[Longform] Batch complete: ${results.length} ok, ${errors.length} errors`);
  return { results, errors };
}

export const longformGeneratorService = { generateLongform, generateLongformBatch };
