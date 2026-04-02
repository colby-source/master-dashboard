/**
 * Resume BMN cadence sends after a pause.
 * Run: npx tsx scripts/resume-cadence.ts
 */
import 'dotenv/config';
import { getDb } from '../server/db';
import { migrateBmnFollowup, resumeAllCadences, isCadencePaused, getCadenceStats } from '../server/services/bmn/cadence';

async function main() {
  await getDb();
  migrateBmnFollowup();

  if (!isCadencePaused()) {
    console.log('\nCadence is already RUNNING. No action needed.\n');
    process.exit(0);
  }

  resumeAllCadences();
  const stats = getCadenceStats();

  console.log('\nCADENCE RESUMED. Sends are now active.');
  console.log(`  Active cadences: ${stats.active}`);
  console.log(`  Total sent so far: ${stats.totalSent}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Resume failed:', err);
  process.exit(1);
});
