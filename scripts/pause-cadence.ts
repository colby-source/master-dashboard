/**
 * KILL SWITCH: Immediately pause all BMN cadence sends.
 * No new emails will be sent until resumed.
 * Run: npx tsx scripts/pause-cadence.ts
 */
import 'dotenv/config';
import { getDb } from '../server/db';
import { migrateBmnFollowup, pauseAllCadences, isCadencePaused } from '../server/services/bmn/cadence';

async function main() {
  await getDb();
  migrateBmnFollowup();

  if (isCadencePaused()) {
    console.log('\nCadence is already PAUSED. No action needed.\n');
    process.exit(0);
  }

  pauseAllCadences();
  console.log('\nCADENCE PAUSED. No emails will be sent.');
  console.log('To resume: npx tsx scripts/resume-cadence.ts\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Pause failed:', err);
  process.exit(1);
});
