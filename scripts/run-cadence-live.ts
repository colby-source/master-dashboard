/**
 * Run BMN follow-up cadence cycle LIVE — sends real emails.
 * Discovers up to BATCH_SIZE (50) new candidates per run, generates
 * personalized 4-email cadences via Claude, and sends Step 1 via GHL Email.
 *
 * Safety: kill switch (pause-cadence.ts), DB dedup, batch cap, send logging.
 *
 * Run: npx tsx scripts/run-cadence-live.ts
 */
import 'dotenv/config';
import { getDb } from '../server/db';
import {
  migrateBmnFollowup,
  runFollowupCycle,
  getCadenceStats,
  isCadencePaused,
} from '../server/services/bmn/cadence';

async function main() {
  await getDb();
  migrateBmnFollowup();

  if (isCadencePaused()) {
    console.log('\nCADENCE IS PAUSED. Run `npx tsx scripts/resume-cadence.ts` to unpause.\n');
    process.exit(0);
  }

  console.log('\nStarting LIVE BMN follow-up cadence cycle...\n');
  console.log('This will:');
  console.log('  1. Discover up to 50 Stage 0 leads');
  console.log('  2. Generate personalized 4-email cadences via Claude');
  console.log('  3. Send Step 1 emails via GHL Email');
  console.log('  4. Process any due follow-up emails for existing cadences\n');

  const result = await runFollowupCycle();
  console.log(`\nCycle complete: ${result.discovered} new cadences, ${result.sent} emails sent`);

  const stats = getCadenceStats();
  console.log('\n--- CADENCE STATS ---');
  console.log(`  Active:    ${stats.active}`);
  console.log(`  Completed: ${stats.completed}`);
  console.log(`  Replied:   ${stats.replied}`);
  console.log(`  Escalated: ${stats.escalated}`);
  console.log(`  Booked:    ${stats.booked}`);
  console.log(`  Total Sent: ${stats.totalSent}`);
  console.log('--------------------\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Live cadence run failed:', err);
  process.exit(1);
});
