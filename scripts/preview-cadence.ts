/**
 * Preview cadence emails for BMN leads WITHOUT sending.
 * Run: npx tsx scripts/preview-cadence.ts
 */
import 'dotenv/config';
import { getDb } from '../server/db';
import { migrateBmnFollowup, previewCadences } from '../server/services/bmn/cadence';

async function main() {
  // Initialize DB first
  await getDb();

  migrateBmnFollowup();

  const limit = parseInt(process.argv[2] || '3', 10);
  console.log(`\nGenerating preview for up to ${limit} leads (NOT sending)...\n`);

  const previews = await previewCadences(limit);

  if (previews.length === 0) {
    console.log('No new candidates found in Stage 0 (all may already have cadences).');
    process.exit(0);
  }

  for (const p of previews) {
    console.log('='.repeat(80));
    console.log(`CREATOR: ${p.contact.name} (${p.contact.email})`);
    console.log(`GHL Contact ID: ${p.contact.id}`);
    console.log('-'.repeat(80));

    if (p.instantlyConversation.length > 0) {
      console.log('\nINSTANTLY CONVERSATION:');
      for (const msg of p.instantlyConversation) {
        console.log(`  ${msg.slice(0, 200)}`);
      }
    }

    console.log('\nGENERATED EMAILS:');
    for (const email of p.emails) {
      console.log(`\n  Step ${email.step} (delay: ${email.delayHours}h) | Subject: "${email.subject}"`);
      console.log('  ' + '-'.repeat(60));
      for (const line of email.body.split('\n')) {
        console.log(`  ${line}`);
      }
    }
    console.log();
  }

  console.log(`\nPreview complete - ${previews.length} cadences generated (nothing sent)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Preview failed:', err);
  process.exit(1);
});
