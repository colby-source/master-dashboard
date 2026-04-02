/**
 * One-time script: Re-seed cadences for contacts who already received Step 1
 * on 2026-03-30 but whose cadence records were lost on server restart.
 *
 * - Discovers candidates (with new date filter — skips recent outbound)
 * - Generates 4-email cadences via Claude
 * - Creates cadence at current_step=1 (Step 1 already sent)
 * - Sets next_send_at to 48h from now (Step 2)
 * - Records Step 1 as already sent in bmn_followup_messages
 *
 * Run: npx tsx scripts/reseed-cadences.ts
 */
import 'dotenv/config';
import { getDb, runSql, queryOne, saveDb } from '../server/db';
import {
  migrateBmnFollowup,
  discoverNewCandidates,
} from '../server/services/bmn/cadence';

// We need the generateCadence function but it's not exported.
// We'll use previewCadences which discovers + generates without sending.
import { previewCadences } from '../server/services/bmn/cadence';

async function main() {
  await getDb();
  migrateBmnFollowup();

  console.log('Discovering safe candidates (date filter active)...\n');

  // previewCadences discovers candidates and generates emails without sending
  const previews = await previewCadences(50);

  if (previews.length === 0) {
    console.log('No candidates found. All may have been filtered by the date check.');
    process.exit(0);
  }

  console.log(`\nFound ${previews.length} safe candidates. Re-seeding cadences...\n`);

  let seeded = 0;
  const now = new Date();
  // Step 2 should fire 48h from the original Step 1 send (today)
  const step2SendAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  for (const p of previews) {
    // Skip if already seeded (dedup)
    const existing = queryOne(
      'SELECT id FROM bmn_followup_cadence WHERE ghl_contact_id = ?',
      [p.contact.id]
    );
    if (existing) {
      console.log(`  SKIP ${p.contact.email} — already in cadence table`);
      continue;
    }

    // Find the opportunity ID from GHL contact
    // We don't have it from previewCadences, but we can look it up or leave null
    // The cadence doesn't strictly need it for sending — it uses ghl_contact_id

    runSql(
      `INSERT OR IGNORE INTO bmn_followup_cadence
       (ghl_contact_id, ghl_opportunity_id, email, first_name, last_name,
        current_step, status, instantly_conversation, cadence_emails,
        last_sent_at, next_send_at)
       VALUES (?, NULL, ?, ?, ?, 1, 'active', '[]', ?, ?, ?)`,
      [
        p.contact.id,
        p.contact.email,
        p.contact.name?.split(' ')[0] || null,
        p.contact.name?.split(' ').slice(1).join(' ') || null,
        JSON.stringify(p.emails),
        now.toISOString(), // last_sent_at = now (step 1 was sent today)
        step2SendAt,       // next_send_at = 48h from now
      ]
    );

    // Record Step 1 as already sent
    const cadence = queryOne(
      'SELECT id FROM bmn_followup_cadence WHERE ghl_contact_id = ?',
      [p.contact.id]
    );
    if (cadence) {
      runSql(
        `INSERT OR IGNORE INTO bmn_followup_messages
         (cadence_id, step, direction, subject, body, ghl_message_id, ghl_status, sent_at)
         VALUES (?, 1, 'outbound', ?, ?, NULL, 'sent', ?)`,
        [cadence.id, p.emails[0]?.subject || 'Step 1', p.emails[0]?.body || '', now.toISOString()]
      );
    }

    seeded++;
    console.log(`  SEEDED ${p.contact.email} — step 1 marked sent, step 2 at ${step2SendAt.slice(0, 16)}`);
  }

  saveDb();
  console.log(`\nDone — ${seeded} cadences re-seeded. Step 2 will fire in 48h.`);
  console.log('Run `npx tsx scripts/cadence-stats.ts` to verify.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
