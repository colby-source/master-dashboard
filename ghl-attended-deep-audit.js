/**
 * ghl-attended-deep-audit.js — Deep dive into attended contacts:
 * 1. Pull actual message content from conversations
 * 2. Check workflow details for both v1 and v2 follow-ups
 * 3. Determine what contact has actually been made
 */

const https = require('https');

const API_KEY = 'pit-2e8c771d-5817-4826-94ee-285cada31671';
const LOCATION_ID = 'x8XBOACL6wOFcsQewWPw';
const PIPELINE_ID = 'GMqxElyHPSr2karweCGS';
const ATTENDED_STAGE = '7bff2aff-62ef-46aa-b1bb-1ed7c9c8d08c';
const BASE = 'services.leadconnectorhq.com';

// Key workflow IDs
const WORKFLOW_V1 = 'd0569095-7c57-4536-95ed-a6ddc68cb7e3'; // Attended Event Post Follow Up (published)
const WORKFLOW_V2 = 'fae94c24-eae0-47fe-afb3-428cd3318055'; // Post-Event Follow-Up v2 (draft)
const WORKFLOW_TAG_MOVE = 'd6847524-af58-49ea-a09a-b5f2524b6f8e'; // Yacht Check-In — Tag & Move Opp
const WORKFLOW_ADDED_TAG = '93e30c04-7e51-493f-b29c-40cf66c9aa5e'; // Added Tag - Attended

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

function formatTs(ts) {
  if (!ts) return 'unknown';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return d.toLocaleString('en-US', { timeZone: 'America/New_York' });
}

async function main() {
  console.log('=== DEEP AUDIT: ATTENDED STAGE CONTACTS ===\n');

  // ── Fetch opportunities in attended stage ──
  const oppsData = await ghlRequest('GET',
    `/opportunities/search?location_id=${LOCATION_ID}&pipeline_id=${PIPELINE_ID}&limit=100`);
  const allOpps = oppsData.opportunities || [];
  const attendedOpps = allOpps.filter(o =>
    (o.pipelineStageId || o.stageId) === ATTENDED_STAGE);

  console.log(`Attended contacts: ${attendedOpps.length}\n`);

  // ── For each contact, pull full conversation + message history ──
  const contactMessages = [];

  for (let i = 0; i < attendedOpps.length; i++) {
    const opp = attendedOpps[i];
    const contactId = opp.contact?.id || opp.contactId;
    if (!contactId) continue;

    await sleep(200);
    const contact = await ghlRequest('GET', `/contacts/${contactId}`);
    const c = contact.contact || contact;
    const name = `${c.firstName || ''} ${c.lastName || ''}`.trim();

    // Skip test contacts
    if (name.toLowerCase().includes('test')) continue;

    // Search conversations for this contact
    await sleep(200);
    const convoData = await ghlRequest('GET',
      `/conversations/search?locationId=${LOCATION_ID}&contactId=${contactId}`);
    const conversations = convoData.conversations || [];

    const allMessages = [];

    for (const conv of conversations) {
      // Fetch messages in this conversation
      await sleep(200);
      const msgData = await ghlRequest('GET',
        `/conversations/${conv.id}/messages?limit=50`);
      const messages = msgData.messages?.messages || msgData.messages || [];

      for (const msg of messages) {
        allMessages.push({
          type: msg.type || msg.messageType || 'unknown',
          direction: msg.direction || (msg.userId ? 'outbound' : 'inbound'),
          body: msg.body || msg.message || msg.text || '',
          subject: msg.subject || '',
          date: msg.dateAdded || msg.createdAt || msg.timestamp,
          status: msg.status || '',
          source: msg.source || '',
          contentType: msg.contentType || '',
          attachments: msg.attachments || [],
        });
      }
    }

    // Sort messages by date
    allMessages.sort((a, b) => new Date(a.date) - new Date(b.date));

    contactMessages.push({
      name,
      email: c.email,
      phone: c.phone,
      contactId,
      tags: c.tags || [],
      messages: allMessages,
      dateAdded: c.dateAdded || c.createdAt,
    });

    // Progress indicator
    if ((i + 1) % 10 === 0) {
      console.log(`  Processed ${i + 1}/${attendedOpps.length} contacts...`);
    }
  }

  // ── Analysis ──
  console.log('\n\n========================================');
  console.log('  MESSAGE HISTORY PER CONTACT');
  console.log('========================================\n');

  let contactedCount = 0;
  let notContactedCount = 0;
  const messageTemplates = new Map(); // dedupe unique messages

  for (const cm of contactMessages) {
    const outbound = cm.messages.filter(m => m.direction === 'outbound' || m.direction === 'outgoing');
    const inbound = cm.messages.filter(m => m.direction === 'inbound' || m.direction === 'incoming');

    console.log(`\n─── ${cm.name} (${cm.email || 'no email'}) ───`);
    console.log(`  Phone: ${cm.phone || 'none'}`);
    console.log(`  Contact added: ${formatTs(cm.dateAdded)}`);
    console.log(`  Total messages: ${cm.messages.length} (${outbound.length} outbound, ${inbound.length} inbound)`);

    if (cm.messages.length === 0) {
      console.log('  *** NO MESSAGES SENT ***');
      notContactedCount++;
    } else {
      contactedCount++;
      for (const msg of cm.messages) {
        const dir = (msg.direction === 'outbound' || msg.direction === 'outgoing') ? 'OUT' : 'IN';
        const type = String(msg.type || 'UNKNOWN').toUpperCase();
        const body = (msg.body || '').replace(/\n/g, ' ').substring(0, 300);
        const subject = msg.subject ? ` [Subject: ${msg.subject}]` : '';
        console.log(`  ${dir} ${type} (${formatTs(msg.date)})${subject}: ${body || '(empty)'}`);

        // Track unique outbound templates
        if (dir === 'OUT' && body) {
          // Normalize for dedup
          const normalized = body.replace(/\b(hi|hey|hello)\s+\w+/gi, 'GREETING')
            .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, 'DATE')
            .substring(0, 150);
          if (!messageTemplates.has(normalized)) {
            messageTemplates.set(normalized, { type, body: body.substring(0, 500), count: 1 });
          } else {
            messageTemplates.get(normalized).count++;
          }
        }
      }
    }
  }

  // ── Summary ──
  console.log('\n\n========================================');
  console.log('  SUMMARY');
  console.log('========================================\n');

  console.log(`Total attended contacts (excl test): ${contactMessages.length}`);
  console.log(`Contacts who received messages: ${contactedCount}`);
  console.log(`Contacts with ZERO messages: ${notContactedCount}`);

  console.log('\n--- Unique Outbound Message Templates ---\n');
  let tIdx = 1;
  for (const [key, val] of messageTemplates) {
    console.log(`Template ${tIdx} (${val.type}, sent to ${val.count} contacts):`);
    console.log(`  "${val.body}"\n`);
    tIdx++;
  }

  // ── Workflow info ──
  console.log('\n--- Relevant Workflows ---\n');

  const workflowIds = [WORKFLOW_V1, WORKFLOW_V2, WORKFLOW_TAG_MOVE, WORKFLOW_ADDED_TAG];
  for (const wfId of workflowIds) {
    await sleep(200);
    // Try to get workflow details
    const wfData = await ghlRequest('GET', `/workflows/${wfId}`);
    console.log(`Workflow ${wfId}:`);
    console.log(`  ${JSON.stringify(wfData).substring(0, 500)}`);
    console.log('');
  }
}

main().catch(console.error);
