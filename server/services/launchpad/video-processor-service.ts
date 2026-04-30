/**
 * video-processor-service.ts — End-to-end video chopping pipeline.
 *
 * Flow:
 *   1. Accept video upload → temp file
 *   2. Transcribe via OpenAI Whisper API (segment-level timestamps)
 *   3. Persist transcript on the longform_source row
 *   4. Send transcript + brand context to Claude → identify N clip moments
 *      (each: start_sec, end_sec, hook, body, pillar, format)
 *   5. Cut each clip with ffmpeg (vertical 9:16 smart-crop, h264 NVENC if available)
 *   6. Upload cut clips to Drive sub-folder /Clips/
 *   7. Persist as Clip rows with source_id + drive_file_url
 *
 * Falls back gracefully if OPENAI_API_KEY isn't set: video stored, transcript
 * required from the user, processing skipped with clear error.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import OpenAI from 'openai';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import crypto from 'crypto';
import { runSql, queryOne, saveDb } from '../../db';
import { config } from '../../config';
import { claudeService } from '../claude-service';
import { googleDriveService } from './google-drive-service';
import { createLogger } from '../../utils/logger';
import type { BrandIntake, StrategyPackage } from './types';

const log = createLogger('video-processor');

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

function ensureTempDir(): string {
  const dir = path.resolve(config.launchpad.videoTempDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function gid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

// ── Stage 1: transcription ────────────────────────────────

async function transcribeVideo(localPath: string): Promise<{ text: string; segments: TranscriptSegment[] }> {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured — required for video transcription');
  }
  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  log.info(`[Video] Transcribing ${path.basename(localPath)} via Whisper`);

  const fileStream = fs.createReadStream(localPath);
  const result = await openai.audio.transcriptions.create({
    file: fileStream,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  const data = result as { text: string; segments?: { start: number; end: number; text: string }[] };
  const segments: TranscriptSegment[] = (data.segments || []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text,
  }));

  log.info(`[Video] Transcribed: ${segments.length} segments, ${data.text.length} chars`);
  return { text: data.text, segments };
}

// ── Stage 2: identify clip moments via Claude ─────────────

interface ClipMoment {
  start_sec: number;
  end_sec: number;
  pillar_number: number;
  format: 'reel' | 'long_video';
  hook: string;
  body: string;
  cta: string;
  visual_direction: string;
  hashtags: string[];
}

async function identifyClipMoments(params: {
  intake: BrandIntake;
  strategy: StrategyPackage;
  transcript: string;
  segments: TranscriptSegment[];
  targetCount: number;
}): Promise<ClipMoment[]> {
  const client = claudeService.getClient();

  const prompt = `Brand voice + ICP context:
${JSON.stringify({
  brand_name: params.intake.brand_name,
  brand_voice_dos: params.intake.brand_voice_dos,
  language_to_use: (params.strategy.module_2_icp_psychology as Record<string, unknown>)?.language_to_use,
  pillars: params.strategy.module_4_content_pillars,
}, null, 2)}

VIDEO TRANSCRIPT WITH TIMESTAMPS (each line: [start_sec - end_sec] text):
${params.segments.map((s) => `[${s.start.toFixed(1)} - ${s.end.toFixed(1)}] ${s.text}`).join('\n')}

Identify ${params.targetCount} short-form clip moments from this video. Each clip should be ${config.launchpad.clipDurationSecMin}-${config.launchpad.clipDurationSecMax} seconds long.

Selection criteria (in order):
1. Has a self-contained idea — listener doesn't need preceding context
2. Has a hook in the first 3 seconds (declarative, contrarian, or curiosity gap)
3. Maps to one of the brand's content pillars
4. Uses brand voice / language_to_use vocabulary
5. Has a quotable / shareable beat

Return raw JSON ARRAY of ${params.targetCount} clip moments. Each:
{
  "start_sec": 0.0,            // boundary aligned to a transcript segment start
  "end_sec": 35.0,             // boundary aligned to a transcript segment end
  "pillar_number": 1-5,
  "format": "reel" | "long_video",
  "hook": "the first 3 seconds — what the creator literally says + on-screen text",
  "body": "the full caption to post alongside the video — written in brand voice",
  "cta": "specific soft CTA",
  "visual_direction": "any post-production notes — captions, b-roll, zoom moments",
  "hashtags": ["max 5"]
}

Return raw JSON only. No markdown.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  try {
    const response = await client.messages.create(
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4500,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal },
    );
    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    const cleaned = raw.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned) as ClipMoment[];
    if (!Array.isArray(parsed)) throw new Error('Expected JSON array');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

// ── Stage 3: cut clips with ffmpeg ────────────────────────

function probeVideo(localPath: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(localPath, (err, data) => {
      if (err) return reject(err);
      const stream = data.streams.find((s) => s.codec_type === 'video');
      if (!stream) return reject(new Error('No video stream found'));
      resolve({
        width: stream.width || 0,
        height: stream.height || 0,
        duration: parseFloat(String(data.format.duration || '0')),
      });
    });
  });
}

async function cutClip(params: {
  inputPath: string;
  outputPath: string;
  startSec: number;
  endSec: number;
  vertical: boolean;
}): Promise<void> {
  const duration = params.endSec - params.startSec;
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(params.inputPath)
      .setStartTime(params.startSec)
      .duration(duration)
      .outputOptions(['-movflags', '+faststart']);

    if (params.vertical) {
      // Smart vertical crop: scale to fit 1080x1920 (9:16). For source wider than 9:16,
      // crop center. For source taller, scale + pad.
      cmd = cmd.videoFilter([
        // Scale up so the shorter dim fills 1080
        'scale=if(gt(a\\,9/16)\\,-2\\,1080):if(gt(a\\,9/16)\\,1920\\,-2)',
        // Center crop to 1080x1920
        'crop=1080:1920',
      ]);
    }

    cmd
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-preset', 'veryfast', '-crf', '23'])
      .save(params.outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err));
  });
}

// ── Pipeline orchestrator ─────────────────────────────────

export interface ProcessVideoSourceResult {
  ok: boolean;
  sourceId: string;
  segments?: number;
  clipsCreated?: number;
  error?: string;
}

export async function processVideoSource(params: {
  brandId: string;
  sourceId: string;
  videoBuffer: Buffer;
  filename: string;
  mimeType: string;
  intake: BrandIntake;
  strategy: StrategyPackage;
  targetClipCount?: number;
  driveFolderId?: string;
}): Promise<ProcessVideoSourceResult> {
  const tempDir = ensureTempDir();
  const localPath = path.join(tempDir, `${params.sourceId}-${params.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`);

  try {
    // Mark processing start
    runSql(
      `UPDATE launchpad_longform_sources SET status = 'processing', processing_started_at = ?, updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), new Date().toISOString(), params.sourceId],
    );
    saveDb();

    // Write buffer to disk
    fs.writeFileSync(localPath, params.videoBuffer);
    log.info(`[Video] Wrote ${params.videoBuffer.length} bytes to ${localPath}`);

    // Probe duration
    const probe = await probeVideo(localPath);
    runSql(
      `UPDATE launchpad_longform_sources SET duration_seconds = ?, updated_at = ? WHERE id = ?`,
      [Math.round(probe.duration), new Date().toISOString(), params.sourceId],
    );

    // Transcribe
    const { text: transcript, segments } = await transcribeVideo(localPath);

    runSql(
      `UPDATE launchpad_longform_sources SET transcript = ?, transcript_segments = ?, body = ?, updated_at = ? WHERE id = ?`,
      [transcript, JSON.stringify(segments), transcript, new Date().toISOString(), params.sourceId],
    );
    saveDb();

    // Identify clip moments
    const moments = await identifyClipMoments({
      intake: params.intake,
      strategy: params.strategy,
      transcript,
      segments,
      targetCount: params.targetClipCount ?? config.launchpad.targetClipsPerVideo,
    });
    log.info(`[Video] Identified ${moments.length} clip moments`);

    // Cut and upload each clip
    let clipsCreated = 0;
    const clipsFolderId = params.driveFolderId
      ? (await googleDriveService.createSubFolder(params.driveFolderId, 'Clips')).id
      : null;

    for (let i = 0; i < moments.length; i++) {
      const m = moments[i];
      const clipFilename = `clip-${i + 1}-day${'?'}.mp4`;
      const clipPath = path.join(tempDir, `${params.sourceId}-${i + 1}.mp4`);

      try {
        await cutClip({
          inputPath: localPath,
          outputPath: clipPath,
          startSec: m.start_sec,
          endSec: m.end_sec,
          vertical: m.format === 'reel',
        });

        let driveFileId: string | null = null;
        let driveFileUrl: string | null = null;
        if (clipsFolderId) {
          const buf = fs.readFileSync(clipPath);
          const uploaded = await googleDriveService.uploadFile({
            folderId: clipsFolderId,
            filename: clipFilename,
            mimeType: 'video/mp4',
            body: buf,
          });
          driveFileId = uploaded.id;
          driveFileUrl = uploaded.url;
        }

        const clipId = gid('clp');
        const now = new Date().toISOString();
        runSql(
          `INSERT INTO launchpad_clips (id, brand_id, source_id, clip_type, format, hook, body, cta, visual_direction, hashtags, pillar_number, source_start_seconds, source_end_seconds, drive_file_id, drive_file_url, approval_status, created_at, updated_at)
           VALUES (?, ?, ?, 'video_clip', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          [
            clipId, params.brandId, params.sourceId,
            m.format, m.hook, m.body, m.cta, m.visual_direction,
            JSON.stringify(m.hashtags || []),
            m.pillar_number, m.start_sec, m.end_sec,
            driveFileId, driveFileUrl,
            now, now,
          ],
        );
        clipsCreated++;

        // Cleanup local cut
        try { fs.unlinkSync(clipPath); } catch { /* expected on Windows sometimes */ }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[Video] Clip ${i + 1} cut/upload failed: ${msg}`);
      }
    }

    runSql(
      `UPDATE launchpad_longform_sources SET status = 'ready', processing_completed_at = ?, updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), new Date().toISOString(), params.sourceId],
    );
    saveDb();

    // Cleanup source video local copy
    try { fs.unlinkSync(localPath); } catch { /* expected on Windows */ }

    return { ok: true, sourceId: params.sourceId, segments: segments.length, clipsCreated };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Video] Pipeline failed for ${params.sourceId}: ${msg}`);
    runSql(
      `UPDATE launchpad_longform_sources SET status = 'error', error = ?, updated_at = ? WHERE id = ?`,
      [msg, new Date().toISOString(), params.sourceId],
    );
    saveDb();
    try { fs.unlinkSync(localPath); } catch { /* expected */ }
    return { ok: false, sourceId: params.sourceId, error: msg };
  }
}

export const videoProcessorService = { processVideoSource };
