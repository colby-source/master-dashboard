import fs from 'fs';
import path from 'path';

const f = path.join(process.env.TEMP, 'gpf_campaign.json');
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
console.log('Name:', d.name);
console.log('Status:', d.status, '(1=active)');
for (const [k, v] of Object.entries(d)) {
  if (typeof v !== 'object' || v === null) console.log(`${k}: ${v}`);
}
