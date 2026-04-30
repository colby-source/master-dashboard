/**
 * text-chopper-service.ts — Takes a long-form piece (script, article, or
 * uploaded transcript) and generates 6-10 short-form clips: carousels,
 * single-post hooks, threads, and quote graphics. Each clip is voice-matched
 * to the brand's module 2 language_to_use.
 *
 * Output clips are PRE-WRITTEN, not outlines. Hook + body + CTA + format
 * are all execution-ready.
 */

import { claudeService } from '../claude-service';
import { createLogger } from '../../utils/logger';
import type { BrandIntake, StrategyPackage, ClipType, ClipFormat } from './types';

const log = createLogger('text-chopper');
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4500;
const TIMEOUT_MS = 5 * 60 * 1000;

const SYSTEM_PROMPT = `You are a short-form chopper for Brand Me Now (BMN) creator brands.
You take long-form content (scripts, articles, transcripts) and chop it into
6-10 short-form posts that work standalone on Instagram, TikTok, and X.

Rules:
- Use language_to_use vocabulary from the brand's ICP module
- Each clip must be a COMPLETE, postable piece — not a snippet
- Hooks ≤120 chars, must pass the ownability test (couldn't be swapped to a competitor)
- Carousels: 5-8 slides, each slide ≤25 words, slide 1 = hook, last slide = CTA
- Quotes: single sentence pulled from the source, designed for screenshot
- Single posts: full caption ready to paste
- Threads: 5-8 connected tweets/posts, ≤280 chars each
- Banned phrases: "elevate", "unlock", "in today's fast-paced world", "game-changing", "revolutionize", "discover", "transform", "empower"
- Output raw JSON only.`;

export interface ChoppedClip {
  clip_type: ClipType;
  format: ClipFormat;
  hook: string;
  body: string;            // for carousels: JSON-stringified array of {slide_n, text}; for others: full caption
  cta: string;
  visual_direction: string;
  hashtags: string[];
  source_quote_used?: string; // optional excerpt from the source this clip is derived from
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
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

function buildPrompt(params: {
  intake: BrandIntake;
  strategy: StrategyPackage;
  longformBody: string;
  longformTitle: string;
  pillarNumber: number;
  targetClipCount: number;
}): string {
  return `Brand voice + ICP context:
${JSON.stringify({
  brand_name: params.intake.brand_name,
  brand_voice_dos: params.intake.brand_voice_dos,
  brand_voice_donts: params.intake.brand_voice_donts,
  language_to_use: (params.strategy.module_2_icp_psychology as Record<string, unknown>)?.language_to_use,
  scroll_stoppers: (params.strategy.module_2_icp_psychology as Record<string, unknown>)?.scroll_stoppers,
}, null, 2)}

Pillar ${params.pillarNumber} (from module 4):
${JSON.stringify(((params.strategy.module_4_content_pillars as unknown[]) || []).find((p) => (p as { pillar_number?: number }).pillar_number === params.pillarNumber), null, 2)}

LONG-FORM SOURCE:
Title: "${params.longformTitle}"
Body:
${params.longformBody}

Chop this into ${params.targetClipCount} short-form clips. MIX OF TYPES (target distribution):
- 30% carousel (5-8 slide deep-dives — best for trust + saves)
- 25% single_post (one-image + full caption — versatile)
- 20% quote (single screenshot-worthy line — best for shares)
- 15% video_clip (suggested cuts for if creator films this — describe in/out points + hook)
- 10% thread (5-8 connected posts for X)

For each clip, return:
{
  "clip_type": "video_clip | carousel | quote | single_post | thread",
  "format": "reel | carousel | static | story | long_video",
  "hook": "≤120 chars, ownable, passes the screenshot test",
  "body": "FULL postable text. For carousel: JSON.stringify([{\\"slide\\":1,\\"text\\":\\"...\\"}, ...]). For thread: JSON.stringify([{\\"post\\":1,\\"text\\":\\"...\\"}, ...]). For others: the full caption ready to paste.",
  "cta": "specific, soft, in brand voice",
  "visual_direction": "1-line shot list / design note. For carousel: typography rules. For quote: bg + type treatment. For video_clip: how to film/cut.",
  "hashtags": ["max 5"],
  "source_quote_used": "the exact line(s) from the source this clip is derived from"
}

EVERY clip must:
- Be postable AS-IS without further writing
- Use language_to_use vocabulary
- Pass the ownability test (couldn't fit competitor's brand)
- For carousel/thread types: parse cleanly as JSON inside body

Return raw JSON ARRAY of ${params.targetClipCount} clip objects.`;
}

export async function chopLongform(params: {
  intake: BrandIntake;
  strategy: StrategyPackage;
  longformBody: string;
  longformTitle: string;
  pillarNumber: number;
  targetClipCount?: number;
}): Promise<ChoppedClip[]> {
  const target = params.targetClipCount ?? 8;
  const raw = await callClaude(buildPrompt({ ...params, targetClipCount: target }));
  try {
    const parsed = JSON.parse(stripFences(raw)) as ChoppedClip[];
    if (!Array.isArray(parsed)) throw new Error('Expected JSON array');
    return parsed;
  } catch (err) {
    log.error(`[Chopper] Parse failed. First 400 chars: ${stripFences(raw).slice(0, 400)}`);
    throw new Error('Text chopper returned invalid JSON', { cause: err });
  }
}

export const textChopperService = { chopLongform };
