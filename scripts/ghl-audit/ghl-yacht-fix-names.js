/**
 * ghl-yacht-fix-names.js — Fix opportunity names from "Yacht Mixer Check-In" to actual contact names
 */

const https = require('https');

const API_KEY = 'pit-2e8c771d-5817-4826-94ee-285cada31671';
const LOCATION_ID = 'x8XBOACL6wOFcsQewWPw';
const PIPELINE_ID = 'GMqxElyHPSr2karweCGS';
const BASE = 'services.leadconnectorhq.com';

function ghlRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: BASE, path, method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== FIXING OPPORTUNITY NAMES ===\n');

  // Fetch all opportunities in the pipeline
  const oppsData = await ghlRequest('GET',
    `/opportunities/search?location_id=${LOCATION_ID}&pipeline_id=${PIPELINE_ID}&limit=100`);
  const allOpps = oppsData.opportunities || [];

  let fixed = 0;
  let skipped = 0;

  for (const opp of allOpps) {
    const oppName = opp.name || '';

    // Only fix opportunities named "Yacht Mixer Check-In"
    if (!oppName.toLowerCase().includes('yacht mixer check-in') &&
        !oppName.toLowerCase().includes('yacht check-in')) {
      continue;
    }

    const contactId = opp.contact?.id || opp.contactId;
    if (!contactId) {
      console.log(`SKIP: Opp ${opp.id} has no contact ID`);
      skipped++;
      continue;
    }

    // Get the actual contact name
    await sleep(200);
    const contactData = await ghlRequest('GET', `/contacts/${contactId}`);
    const c = contactData.contact || contactData;
    const firstName = c.firstName || '';
    const lastName = c.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim();

    if (!fullName || fullName.toLowerCase().includes('test') || fullName.toLowerCase().includes('yacht')) {
      console.log(`SKIP: Contact ${contactId} has no valid name ("${fullName}")`);
      skipped++;
      continue;
    }

    // Update opportunity name to contact's real name
    const newName = fullName;
    console.log(`FIX: "${oppName}" → "${newName}" (opp: ${opp.id})`);

    await sleep(200);
    const result = await ghlRequest('PUT', `/opportunities/${opp.id}`, {
      name: newName,
    });

    if (result.opportunity || result.id) {
      fixed++;
    } else {
      console.log(`  ERROR: ${JSON.stringify(result).substring(0, 200)}`);
    }
  }

  console.log(`\nDone. Fixed: ${fixed}, Skipped: ${skipped}`);
}

main().catch(console.error);
