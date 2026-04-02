/**
 * Audit all Stage 0 leads — check last Instantly outbound date.
 * Outputs safe vs too-recent lists.
 * Run: npx tsx scripts/audit-cadence-dates.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import { getDb } from '../server/db';
import { migrateBmnFollowup, discoverNewCandidates } from '../server/services/bmn/cadence';

async function main() {
  await getDb();
  migrateBmnFollowup();

  console.log('Discovering candidates from GHL Stage 0...');
  const candidates = await discoverNewCandidates();

  const cutoff = '2026-03-27';
  const safe: any[] = [];
  const tooRecent: any[] = [];

  for (const c of candidates) {
    let lastOutbound = 'none';
    let lastInbound = 'none';

    for (const msg of c.instantlyConversation) {
      if (msg.startsWith('[outbound]')) {
        const match = msg.match(/\((\d{4}-\d{2}-\d{2})/);
        if (match) lastOutbound = match[1];
      }
      if (msg.startsWith('[inbound]')) {
        const match = msg.match(/\((\d{4}-\d{2}-\d{2})/);
        if (match) lastInbound = match[1];
      }
    }

    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || '-';
    const recentHit = lastOutbound !== 'none' && lastOutbound >= cutoff;

    const entry = { email: c.email, name, lastOutbound, lastInbound, msgs: c.instantlyConversation.length };
    if (recentHit) {
      tooRecent.push(entry);
    } else {
      safe.push(entry);
    }
  }

  const lines: string[] = [];
  lines.push(`TOTAL CANDIDATES: ${candidates.length}`);
  lines.push(`SAFE (last outbound before ${cutoff}): ${safe.length}`);
  lines.push(`SKIP (last outbound on/after ${cutoff}): ${tooRecent.length}`);
  lines.push('');
  lines.push('--- SKIP (double-hit risk) ---');
  for (const c of tooRecent) lines.push(`${c.email} | ${c.name} | lastOut:${c.lastOutbound} | lastIn:${c.lastInbound}`);
  lines.push('');
  lines.push('--- SAFE (ok to email) ---');
  for (const c of safe) lines.push(`${c.email} | ${c.name} | lastOut:${c.lastOutbound} | lastIn:${c.lastInbound}`);

  const output = lines.join('\n');
  console.log(output);
  fs.writeFileSync('cadence-audit-results.txt', output);
  console.log('\nResults saved to cadence-audit-results.txt');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
