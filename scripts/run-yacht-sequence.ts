#!/usr/bin/env tsx
/**
 * Run the VNTR x Granite Park Party post-event follow-up sequence.
 *
 * Usage:
 *   npx tsx scripts/run-yacht-sequence.ts enroll     # Enroll contacts (dry run — shows who would be enrolled)
 *   npx tsx scripts/run-yacht-sequence.ts enroll --go # Enroll contacts for real
 *   npx tsx scripts/run-yacht-sequence.ts send        # Process pending sends (dry run)
 *   npx tsx scripts/run-yacht-sequence.ts send --go   # Process pending sends for real
 *   npx tsx scripts/run-yacht-sequence.ts status       # Show sequence status
 *   npx tsx scripts/run-yacht-sequence.ts start        # Start cron-based automation
 *   npx tsx scripts/run-yacht-sequence.ts replies      # Check for replies now
 *
 * For future events, copy this script and change the createEventSequence() params.
 */

import 'dotenv/config';
import { createYachtEventSequence } from '../server/services/post-event-sequence';

const command = process.argv[2] || 'status';
const isLive = process.argv.includes('--go');

async function main() {
  const seq = createYachtEventSequence();

  switch (command) {
    case 'enroll': {
      if (!isLive) {
        console.log('\n=== DRY RUN — Enrollment Preview ===\n');
        console.log('Add --go to actually enroll contacts.\n');
      }
      const contacts = await seq.enrollContacts();
      console.log(`\nEnrolled ${contacts.length} contacts:\n`);
      contacts.forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.firstName} | ${c.email} | ${c.phone} | ${c.contactId}`);
      });
      if (!isLive) {
        console.log('\n⚠️  This was a dry run. State was saved but no messages sent.');
        console.log('    Run with --go to confirm, then use "send --go" to start sending.\n');
      }
      break;
    }

    case 'send': {
      if (!isLive) {
        console.log('\n=== DRY RUN — Send Preview ===\n');
        const status = seq.getStatus();
        console.log(`Active contacts: ${status.active}`);
        console.log(`Next sends:`);
        status.nextSends.forEach(s => {
          console.log(`  ${s.name} — Step ${s.step} (${s.channel}) — ${s.scheduledFor}`);
        });
        console.log('\nAdd --go to actually send messages.\n');
      } else {
        const result = await seq.processSends();
        console.log(`\nSend complete: ${result.sent} sent, ${result.errors} errors\n`);
      }
      break;
    }

    case 'status': {
      const status = seq.getStatus();
      console.log('\n=== Sequence Status ===\n');
      console.log(`Total enrolled: ${status.total}`);
      console.log(`Active: ${status.active}`);
      console.log(`Opted out: ${status.optedOut}`);
      console.log(`Booked call: ${status.booked}`);
      console.log(`Replied: ${status.replied}`);
      console.log(`Completed: ${status.completed}`);
      if (status.nextSends.length > 0) {
        console.log(`\nNext sends:`);
        status.nextSends.forEach(s => {
          console.log(`  ${s.name} — Step ${s.step} (${s.channel}) — ${new Date(s.scheduledFor).toLocaleString()}`);
        });
      }
      console.log('');
      break;
    }

    case 'start': {
      console.log('\n=== Starting Automated Sequence ===\n');
      console.log('Sends processed hourly at :05, reply checks every 30 min.');
      console.log('Press Ctrl+C to stop.\n');
      seq.start();
      // Keep process alive
      process.on('SIGINT', () => { seq.stop(); process.exit(0); });
      break;
    }

    case 'replies': {
      console.log('\n=== Checking Replies ===\n');
      await seq.checkReplies();
      const status = seq.getStatus();
      console.log(`Replied: ${status.replied}, Opted out: ${status.optedOut}, Booked: ${status.booked}\n`);
      break;
    }

    default:
      console.log('Usage: npx tsx scripts/run-yacht-sequence.ts [enroll|send|status|start|replies] [--go]');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
