import fs from 'fs';
import path from 'path';

const f = path.join(process.env.TEMP, 'gpf_emails.json');
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
const items = d.items || d.data || d;

// Group by step
const byStep = {};
const fromAddresses = new Set();
let earliest = null, latest = null;

for (const e of items) {
  const step = e.step || 0;
  byStep[step] = (byStep[step] || 0) + 1;
  if (e.from_address_email) fromAddresses.add(e.from_address_email);
  const ts = e.timestamp_email || e.timestamp_created;
  if (ts) {
    if (!earliest || ts < earliest) earliest = ts;
    if (!latest || ts > latest) latest = ts;
  }
}

console.log('=== GPF-II RE (Warm) Campaign Status ===\n');
console.log('Status: ACTIVE (sending)');
console.log('Daily limit: 15 emails/day');
console.log('Open tracking: OFF');
console.log('Stop on reply: YES\n');
console.log('Total emails sent: ' + items.length);
console.log('Date range: ' + (earliest ? new Date(earliest).toLocaleDateString() : '?') + ' — ' + (latest ? new Date(latest).toLocaleDateString() : '?'));
console.log('\nEmails by step:');
for (const [step, count] of Object.entries(byStep).sort((a,b) => a[0]-b[0])) {
  console.log(`  Step ${step}: ${count} emails`);
}
console.log('\nSending from:');
for (const addr of fromAddresses) console.log('  ' + addr);
