require('dotenv').config();
const axios = require('axios');

const apiKey = process.env.GHL_API_KEY_BNN;
const locationId = process.env.GHL_LOCATION_ID_BNN;
const pipelineId = 'By4LcF6zNdTaxAC1O8Ad';
// Actual Stage 0 (Positive Cold Email Reply) ID from live GHL data
const STAGE_POSITIVE_REPLY = '75c0a71b-bba7-45fe-abdb-b751317afa30';
const baseUrl = 'https://services.leadconnectorhq.com';
const headers = { Authorization: 'Bearer ' + apiKey, Version: '2021-04-15' };

async function fetchAllOpps() {
  let all = [];
  let startAfterId = null;
  let startAfter = null;
  let page = 0;
  while (true) {
    page++;
    const params = { location_id: locationId, pipeline_id: pipelineId, limit: 100 };
    if (startAfterId) {
      params.startAfterId = startAfterId;
      params.startAfter = startAfter;
    }
    const res = await axios.get(baseUrl + '/opportunities/search', { headers, params });
    const opps = res.data.opportunities || [];
    const meta = res.data.meta || {};
    console.error('Page ' + page + ': ' + opps.length + ' (total: ' + meta.total + ')');
    all = all.concat(opps);
    if (!meta.nextPage || opps.length === 0) break;
    startAfterId = meta.startAfterId;
    startAfter = meta.startAfter;
  }
  return all;
}

async function main() {
  const allOpps = await fetchAllOpps();
  console.error('Fetched: ' + allOpps.length + ' pipeline opportunities\n');

  // Group by stage
  const stageGroups = {};
  for (const o of allOpps) {
    const key = o.pipelineStageId;
    if (!stageGroups[key]) stageGroups[key] = [];
    stageGroups[key].push(o);
  }

  console.log('=== STAGE BREAKDOWN ===');
  for (const [stageId, opps] of Object.entries(stageGroups)) {
    console.log('  ' + stageId + ': ' + opps.length + ' opportunities');
  }

  // Filter to Stage 0 only
  const opps = allOpps.filter(o => o.pipelineStageId === STAGE_POSITIVE_REPLY);
  console.log('\nStage 0 (Positive Reply): ' + opps.length + ' total\n');

  const skip = [];
  const include = [];

  for (const opp of opps) {
    const name = opp.contact?.name || opp.name || 'Unknown';
    const email = opp.contact?.email || '';
    const phone = opp.contact?.phone || '';
    const contactId = opp.contact?.id || opp.contactId || '';
    const status = opp.status || '';

    let skipReason = null;

    // Non-open status
    if (status !== 'open') {
      skipReason = 'STATUS: ' + status;
    }

    // Test/dummy contacts
    const nameLower = name.toLowerCase().trim();
    if (!skipReason && (/^test\d*$/.test(nameLower) || nameLower === 'john doe' || nameLower === 'jane doe' ||
        nameLower === 'example only' || email === 'johndoe@gmail.com' || email === 'example@gmail.com')) {
      skipReason = 'TEST/DUMMY CONTACT';
    }

    // No email
    if (!email && !skipReason) {
      skipReason = 'NO EMAIL';
    }

    // Known booked contacts
    const bookedEmails = ['brie@briewieselman.com', 'jamesturnage16@gmail.com', 'momone1421@gmail.com', 'symone.s59@gmail.com'];
    if (!skipReason && bookedEmails.includes(email)) {
      skipReason = 'ALREADY BOOKED CALL';
    }

    if (skipReason) {
      skip.push({ name, email, phone, reason: skipReason, status });
    } else {
      include.push({ name, email, phone, contactId, oppId: opp.id, status });
    }
  }

  // Check for duplicate emails
  const emailCounts = {};
  for (const c of include) {
    if (c.email) {
      emailCounts[c.email] = (emailCounts[c.email] || 0) + 1;
    }
  }
  const dupes = Object.entries(emailCounts).filter(([_, v]) => v > 1);

  console.log('=== CONTACTS TO SKIP (' + skip.length + ') ===');
  for (const s of skip) {
    console.log('  SKIP: ' + s.name + ' | ' + (s.email || 'NO EMAIL') + ' | Reason: ' + s.reason);
  }

  if (dupes.length > 0) {
    console.log('\n=== DUPLICATE EMAILS ===');
    for (const [email, count] of dupes) {
      const names = include.filter(c => c.email === email).map(c => c.name);
      console.log('  ' + email + ' (' + count + 'x) — ' + names.join(', '));
    }
  }

  // Show contacts in other stages
  const otherStages = allOpps.filter(o => o.pipelineStageId !== STAGE_POSITIVE_REPLY);
  if (otherStages.length > 0) {
    console.log('\n=== CONTACTS IN OTHER STAGES (' + otherStages.length + ') ===');
    for (const o of otherStages) {
      const name = o.contact?.name || o.name || 'Unknown';
      const email = o.contact?.email || '';
      console.log('  ' + name + ' | ' + email + ' | Stage: ' + o.pipelineStageId + ' | Status: ' + o.status);
    }
  }

  console.log('\n=== CONTACTS TO INCLUDE (' + include.length + ') ===');
  let i = 1;
  for (const c of include) {
    const dupe = emailCounts[c.email] > 1 ? ' [DUPE]' : '';
    console.log('  ' + (i++) + '. ' + c.name + ' | ' + c.email + dupe);
  }

  console.log('\n=== SUMMARY ===');
  console.log('Total pipeline: ' + allOpps.length);
  console.log('Stage 0 (Positive Reply): ' + opps.length);
  console.log('Skipping: ' + skip.length);
  console.log('Including (before dedup): ' + include.length);
  const uniqueEmails = new Set(include.map(c => c.email));
  console.log('Unique emails to include: ' + uniqueEmails.size);
  if (dupes.length > 0) console.log('Duplicate email sets: ' + dupes.length);
}

main().catch(e => console.error(e.message));
