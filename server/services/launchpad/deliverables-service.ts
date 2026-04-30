/**
 * deliverables-service.ts — On approval, packages the brand's strategy +
 * approved clips into Google Docs / Sheet inside their Drive folder, and
 * sends a delivery email.
 *
 * Outputs:
 *   - 7 Google Docs (one per strategy module) at /Strategy/
 *   - 1 Google Sheet for the 30-day calendar at /Calendar/
 *   - 1 CSV download endpoint for Buffer/Later import
 *   - Delivery email to founder with all links
 */

import { queryOne, queryAll, runSql, saveDb } from '../../db';
import { googleDriveService } from './google-drive-service';
import { emailService } from '../email-service';
import { config } from '../../config';
import { contentProcessorService } from './content-processor-service';
import { createLogger } from '../../utils/logger';
import type { LaunchpadBrand, StrategyPackage, Clip } from './types';

const log = createLogger('deliverables');

interface ModuleDoc {
  moduleNumber: number;
  title: string;
  body: string;
}

function formatModule(num: number, data: unknown): ModuleDoc {
  const titles: Record<number, string> = {
    1: '01 — Master Strategy',
    2: '02 — ICP Psychology',
    3: '03 — Authority Positioning',
    4: '04 — Content Pillars',
    5: '05 — 30-Day Calendar',
    6: '06 — Hook Bank (50)',
    7: '07 — Monetization Funnel',
  };

  const body = renderModuleBody(num, data);
  return { moduleNumber: num, title: titles[num] || `Module ${num}`, body };
}

function renderModuleBody(num: number, data: unknown): string {
  if (data === null || data === undefined) return '(No data — regenerate this module)';
  if (Array.isArray(data)) {
    return data.map((item, i) => `${i + 1}. ${renderItem(item)}`).join('\n\n');
  }
  if (typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => `${humanize(k)}\n${'─'.repeat(humanize(k).length)}\n${renderValue(v)}`)
      .join('\n\n');
  }
  return String(data);
}

function renderItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (typeof item !== 'object' || item === null) return String(item);
  return Object.entries(item as Record<string, unknown>)
    .map(([k, v]) => `  ${humanize(k)}: ${renderValue(v)}`)
    .join('\n');
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => `• ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n  ');
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Calendar Sheet rendering ──────────────────────────────

function buildCalendarTSV(strategy: StrategyPackage, clips: Clip[]): string {
  const calendar = (strategy.module_5_thirty_day_calendar as Array<Record<string, unknown>>) || [];
  const header = ['Day', 'Date Offset', 'Platform', 'Pillar', 'Format', 'Hook', 'Body', 'CTA', 'Visual', 'Best Time', 'Hashtags', 'Asset URL'];

  // Index clips by assigned_day for quick lookup
  const clipsByDay = new Map<number, Clip[]>();
  for (const c of clips) {
    if (c.assignedDay && c.approvalStatus === 'approved') {
      const arr = clipsByDay.get(c.assignedDay) || [];
      arr.push(c);
      clipsByDay.set(c.assignedDay, arr);
    }
  }

  const rows = calendar.map((entry) => {
    const day = entry.day as number;
    const matched = clipsByDay.get(day)?.[0];
    const hashtags = matched?.hashtags || (entry.hashtags as string[]) || [];
    return [
      String(day),
      String(entry.date_offset || ''),
      String(entry.platform || ''),
      String(entry.pillar_number || ''),
      String(matched?.format || entry.format || ''),
      String(matched?.hook || entry.hook || ''),
      String(matched?.body || entry.body || ''),
      String(matched?.cta || entry.cta || ''),
      String(matched?.visualDirection || entry.visual_direction || ''),
      String(matched?.bestPostTime || entry.best_post_time || ''),
      Array.isArray(hashtags) ? hashtags.join(' ') : '',
      matched?.driveFileUrl || '',
    ].map((cell) => cell.replace(/\t/g, ' ').replace(/\n/g, ' / '));
  });

  return [header.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
}

export function buildCalendarCSV(strategy: StrategyPackage, clips: Clip[]): string {
  const calendar = (strategy.module_5_thirty_day_calendar as Array<Record<string, unknown>>) || [];
  const header = ['Day', 'Date Offset', 'Platform', 'Pillar', 'Format', 'Hook', 'Body', 'CTA', 'Visual', 'Best Time', 'Hashtags', 'Asset URL'];

  const clipsByDay = new Map<number, Clip[]>();
  for (const c of clips) {
    if (c.assignedDay && c.approvalStatus === 'approved') {
      const arr = clipsByDay.get(c.assignedDay) || [];
      arr.push(c);
      clipsByDay.set(c.assignedDay, arr);
    }
  }

  const escape = (cell: string): string => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  };

  const rows = calendar.map((entry) => {
    const day = entry.day as number;
    const matched = clipsByDay.get(day)?.[0];
    const hashtags = matched?.hashtags || (entry.hashtags as string[]) || [];
    return [
      String(day),
      String(entry.date_offset || ''),
      String(entry.platform || ''),
      String(entry.pillar_number || ''),
      String(matched?.format || entry.format || ''),
      String(matched?.hook || entry.hook || ''),
      String(matched?.body || entry.body || ''),
      String(matched?.cta || entry.cta || ''),
      String(matched?.visualDirection || entry.visual_direction || ''),
      String(matched?.bestPostTime || entry.best_post_time || ''),
      Array.isArray(hashtags) ? hashtags.join(' ') : '',
      matched?.driveFileUrl || '',
    ].map(escape);
  });

  return [header.map(escape).join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// ── Main delivery action ──────────────────────────────────

export async function writeDeliverables(brandId: string): Promise<{ ok: boolean; links: Record<string, string>; error?: string }> {
  const row = queryOne(`SELECT * FROM launchpad_brands WHERE id = ?`, [brandId]) as Record<string, unknown> | null;
  if (!row) return { ok: false, links: {}, error: 'Brand not found' };

  const strategyJson = row.strategy_package as string | null;
  if (!strategyJson) return { ok: false, links: {}, error: 'No strategy generated yet' };

  const strategy = JSON.parse(strategyJson) as StrategyPackage;
  const driveFolderId = row.drive_folder_id as string | null;

  if (!driveFolderId || !googleDriveService.available) {
    return { ok: false, links: {}, error: 'Google Drive not configured for this brand' };
  }

  const links: Record<string, string> = {};

  try {
    // Strategy sub-folder
    const strategyFolder = await googleDriveService.createSubFolder(driveFolderId, 'Strategy');

    // Write 7 module Google Docs in parallel
    const modules: ModuleDoc[] = [
      formatModule(1, strategy.module_1_master_strategy),
      formatModule(2, strategy.module_2_icp_psychology),
      formatModule(3, strategy.module_3_authority_positioning),
      formatModule(4, strategy.module_4_content_pillars),
      formatModule(5, strategy.module_5_thirty_day_calendar),
      formatModule(6, strategy.module_6_hook_bank),
      formatModule(7, strategy.module_7_monetization_funnel),
    ];

    const docResults = await Promise.all(
      modules.map((m) =>
        googleDriveService
          .createGoogleDoc({ folderId: strategyFolder.id, title: m.title, content: m.body })
          .then((r) => ({ moduleNumber: m.moduleNumber, ok: true as const, ...r }))
          .catch((err: unknown) => ({ moduleNumber: m.moduleNumber, ok: false as const, error: err instanceof Error ? err.message : String(err) })),
      ),
    );

    for (const r of docResults) {
      if (r.ok) {
        links[`module_${r.moduleNumber}`] = r.url;
      } else {
        log.warn(`[Deliverables] Module ${r.moduleNumber} doc failed: ${r.error}`);
      }
    }

    // Calendar sheet (TSV uploaded as Sheet)
    const calendarFolder = await googleDriveService.createSubFolder(driveFolderId, 'Calendar');
    const clips = contentProcessorService.listClips(brandId);
    const tsv = buildCalendarTSV(strategy, clips);

    try {
      const sheet = await googleDriveService.createGoogleDoc({
        folderId: calendarFolder.id,
        title: '30-Day Calendar (TSV — paste into Sheets)',
        content: tsv,
      });
      links.calendar_tsv = sheet.url;
    } catch (err: unknown) {
      log.warn(`[Deliverables] Calendar sheet failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    runSql(
      `UPDATE launchpad_brands SET deliverables_written_at = ?, deliverables_drive_links = ?, updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), JSON.stringify(links), new Date().toISOString(), brandId],
    );
    saveDb();

    log.info(`[Deliverables] Wrote ${Object.keys(links).length} files to Drive for ${brandId}`);
    return { ok: true, links };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Deliverables] Failed for ${brandId}: ${msg}`);
    return { ok: false, links, error: msg };
  }
}

// ── Delivery email ────────────────────────────────────────

export async function sendDeliveryEmail(brandId: string): Promise<void> {
  const brand = queryOne(`SELECT brand_name, founder_name, founder_email, drive_folder_url, deliverables_drive_links FROM launchpad_brands WHERE id = ?`, [brandId]) as {
    brand_name: string;
    founder_name: string | null;
    founder_email: string;
    drive_folder_url: string | null;
    deliverables_drive_links: string | null;
  } | null;

  if (!brand) throw new Error('Brand not found');

  const links: Record<string, string> = brand.deliverables_drive_links ? JSON.parse(brand.deliverables_drive_links) : {};
  const firstName = brand.founder_name?.split(' ')[0] || 'there';

  const linkRows = [
    { label: 'Master Strategy', key: 'module_1' },
    { label: 'ICP Psychology', key: 'module_2' },
    { label: 'Authority Positioning', key: 'module_3' },
    { label: 'Content Pillars', key: 'module_4' },
    { label: '30-Day Calendar', key: 'module_5' },
    { label: 'Hook Bank (50)', key: 'module_6' },
    { label: 'Monetization Funnel', key: 'module_7' },
    { label: 'Calendar TSV', key: 'calendar_tsv' },
  ];

  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; color: #0D0D0D;">
  <div style="margin-bottom: 24px;">
    <span style="display: inline-block; padding: 4px 10px; background: #1AE7F6; color: #0D0D0D; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 3px;">Brand Me Now</span>
  </div>
  <h1 style="font-size: 24px; line-height: 1.3; margin: 0 0 16px;">${brand.brand_name} — your launch package is approved.</h1>
  <p style="font-size: 16px; line-height: 1.55; margin: 0 0 16px;">Hey ${firstName} — everything is in your Drive. Here's the index:</p>

  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${linkRows.filter((r) => links[r.key]).map((r) => `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB;"><strong>${r.label}</strong></td>
        <td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB; text-align: right;"><a href="${links[r.key]}" style="color: #0A9396;">Open ↗</a></td>
      </tr>
    `).join('')}
  </table>

  ${brand.drive_folder_url ? `<p style="margin: 24px 0;"><a href="${brand.drive_folder_url}" style="display: inline-block; padding: 14px 28px; background: #0A9396; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 6px;">Open my full Drive folder</a></p>` : ''}

  <h2 style="font-size: 18px; margin: 32px 0 8px;">Next steps</h2>
  <ol style="font-size: 15px; line-height: 1.6; padding-left: 20px;">
    <li>Open the 30-Day Calendar — every approved post is mapped to a day.</li>
    <li>Open the Calendar TSV and paste into a Google Sheet, then export as CSV for Buffer/Later/Hootsuite.</li>
    <li>Schedule your first 7 days. We'll check in on day 8.</li>
  </ol>

  <p style="font-size: 13px; color: #6B7280; line-height: 1.5; margin: 32px 0 0;">— Brand Me Now</p>
</body></html>`;

  await emailService.sendMail(brand.founder_email, `${brand.brand_name} — your launch package is ready`, html, config.launchpad.fromEmail);
  log.info(`[Deliverables] Sent delivery email to ${brand.founder_email}`);
}

// ── CSV export endpoint helper ────────────────────────────

export function exportCalendarCSV(brandId: string): string | null {
  const row = queryOne(`SELECT strategy_package FROM launchpad_brands WHERE id = ?`, [brandId]) as { strategy_package: string | null } | null;
  if (!row?.strategy_package) return null;
  const strategy = JSON.parse(row.strategy_package) as StrategyPackage;
  const clipRows = queryAll(`SELECT * FROM launchpad_clips WHERE brand_id = ? AND approval_status = 'approved'`, [brandId]);
  const clips = clipRows.map((r) => ({
    assignedDay: r.assigned_day,
    approvalStatus: r.approval_status,
    format: r.format,
    hook: r.hook,
    body: r.body,
    cta: r.cta,
    visualDirection: r.visual_direction,
    hashtags: r.hashtags ? JSON.parse(r.hashtags) : [],
    bestPostTime: r.best_post_time,
    driveFileUrl: r.drive_file_url,
  })) as unknown as Clip[];
  return buildCalendarCSV(strategy, clips);
}

export const deliverablesService = {
  writeDeliverables,
  sendDeliveryEmail,
  exportCalendarCSV,
  buildCalendarCSV,
};
