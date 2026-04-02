/**
 * Show BMN follow-up cadence stats and recent activity.
 * Run: npx tsx scripts/cadence-stats.ts
 * Add --detail for per-contact breakdown.
 */
import 'dotenv/config';
import { getDb, queryAll, queryOne } from '../server/db';
import { migrateBmnFollowup, getCadenceStats, isCadencePaused } from '../server/services/bmn/cadence';

async function main() {
  await getDb();
  migrateBmnFollowup();

  const detail = process.argv.includes('--detail');
  const paused = isCadencePaused();
  const stats = getCadenceStats();

  console.log('\n=== BMN CADENCE STATUS ===');
  console.log(`  System:    ${paused ? 'PAUSED' : 'RUNNING'}`);
  console.log(`  Active:    ${stats.active}`);
  console.log(`  Completed: ${stats.completed}`);
  console.log(`  Replied:   ${stats.replied}`);
  console.log(`  Escalated: ${stats.escalated}`);
  console.log(`  Booked:    ${stats.booked}`);
  console.log(`  Total Sent: ${stats.totalSent}`);

  const pending = queryOne(
    "SELECT COUNT(*) as c FROM bmn_followup_cadence WHERE status = 'pending'"
  )?.c || 0;
  const total = queryOne('SELECT COUNT(*) as c FROM bmn_followup_cadence')?.c || 0;
  console.log(`  Pending:   ${pending}`);
  console.log(`  Total:     ${total}`);

  // Recent sends
  const recentSends = queryAll(
    `SELECT m.subject, m.sent_at, m.ghl_status, c.email, c.first_name
     FROM bmn_followup_messages m
     JOIN bmn_followup_cadence c ON c.id = m.cadence_id
     WHERE m.direction = 'outbound'
     ORDER BY m.sent_at DESC
     LIMIT 10`
  );

  if (recentSends.length > 0) {
    console.log('\n=== RECENT SENDS (last 10) ===');
    for (const s of recentSends) {
      const name = s.first_name || s.email;
      const status = s.ghl_status || '?';
      console.log(`  ${s.sent_at} | ${name} | "${s.subject}" | ${status}`);
    }
  }

  // Upcoming sends
  const upcoming = queryAll(
    `SELECT c.email, c.first_name, c.current_step, c.next_send_at
     FROM bmn_followup_cadence c
     WHERE c.status = 'active' AND c.next_send_at IS NOT NULL
     ORDER BY c.next_send_at ASC
     LIMIT 10`
  );

  if (upcoming.length > 0) {
    console.log('\n=== NEXT 10 SCHEDULED ===');
    for (const u of upcoming) {
      const name = u.first_name || u.email;
      console.log(`  ${u.next_send_at} | ${name} | Step ${u.current_step + 1}`);
    }
  }

  if (detail) {
    const all = queryAll(
      `SELECT c.*,
              (SELECT COUNT(*) FROM bmn_followup_messages WHERE cadence_id = c.id AND direction = 'outbound') as emails_sent
       FROM bmn_followup_cadence c
       ORDER BY c.status, c.updated_at DESC`
    );

    console.log('\n=== ALL CADENCES ===');
    for (const c of all) {
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
      console.log(`  ${name} | ${c.email} | Status: ${c.status} | Step: ${c.current_step}/4 | Sent: ${c.emails_sent}`);
    }
  }

  console.log();
  process.exit(0);
}

main().catch((err) => {
  console.error('Stats failed:', err);
  process.exit(1);
});
