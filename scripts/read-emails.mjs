import fs from 'fs';
import path from 'path';

const f = path.join(process.env.TEMP, 'gpf_emails.json');
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
const items = d.items || d.data || d;
if (!Array.isArray(items)) {
  console.log(JSON.stringify(d).substring(0, 500));
  process.exit(0);
}
let sent = 0, opened = 0, replied = 0, bounced = 0;
for (const e of items) {
  sent++;
  if (e.is_opened) opened++;
  if (e.is_replied) replied++;
  if (e.is_bounced) bounced++;
}
console.log('Emails in batch:', items.length);
console.log('Sent:', sent, '| Opened:', opened, '| Replied:', replied, '| Bounced:', bounced);
if (items.length > 0) {
  console.log('\nSample keys:', Object.keys(items[0]).join(', '));
}
