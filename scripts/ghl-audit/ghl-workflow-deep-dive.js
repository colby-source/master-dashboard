/**
 * ghl-workflow-deep-dive.js — Pull full message copy from the post-event follow-up sequences
 * by analyzing what was actually sent to contacts who completed the full sequence.
 * Also check all workflow endpoints available in the API.
 */

const https = require('https');

const API_KEY = 'pit-2e8c771d-5817-4826-94ee-285cada31671';
const LOCATION_ID = 'x8XBOACL6wOFcsQewWPw';
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

function formatTs(ts) {
  if (!ts) return 'unknown';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return d.toLocaleString('en-US', { timeZone: 'America/New_York' });
}

async function main() {
  console.log('=== FULL SEQUENCE COPY EXTRACTION ===\n');

  // The contacts who went through the FULL v1 sequence (Feb event):
  // - Daria Grave (ceo@alvia.agency)
  // - Michelle Jones (invest@bnbfamilyoffice.com) — most messages
  // - Melissa Somogyi (no email, SMS only)
  // - Yadira (yadiramvega@gmail.com)
  // - colby Watkins test (colby@whbiopharma.com) — March 18 test

  // Also check the colby@granitepark.co contact for historical messages
  const targetEmails = [
    'invest@bnbfamilyoffice.com',  // Michelle - most complete sequence
    'ceo@alvia.agency',            // Daria
    'yadiramvega@gmail.com',       // Yadira
    'colby@whbiopharma.com',       // Test contact - March sequence
  ];

  for (const email of targetEmails) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`CONTACT: ${email}`);
    console.log('='.repeat(70));

    // Search for contact
    await sleep(300);
    const searchData = await ghlRequest('GET',
      `/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(email)}&limit=5`);
    const contacts = searchData.contacts || [];
    const contact = contacts.find(c => c.email === email);

    if (!contact) {
      console.log('  Contact not found');
      continue;
    }

    console.log(`  Name: ${contact.firstName} ${contact.lastName}`);
    console.log(`  Phone: ${contact.phone || 'none'}`);
    console.log(`  Added: ${formatTs(contact.dateAdded)}`);
    console.log(`  Tags: [${(contact.tags || []).join(', ')}]`);

    // Get all conversations
    await sleep(300);
    const convoData = await ghlRequest('GET',
      `/conversations/search?locationId=${LOCATION_ID}&contactId=${contact.id}`);
    const conversations = convoData.conversations || [];

    for (const conv of conversations) {
      await sleep(300);
      // Get ALL messages - try higher limit
      const msgData = await ghlRequest('GET',
        `/conversations/${conv.id}/messages?limit=100`);
      const messages = msgData.messages?.messages || msgData.messages || [];

      // Sort by date
      messages.sort((a, b) => new Date(a.dateAdded || a.createdAt || 0) - new Date(b.dateAdded || b.createdAt || 0));

      let stepNum = 0;
      for (const msg of messages) {
        const dir = (msg.direction === 'outbound' || msg.direction === 'outgoing') ? 'OUTBOUND' : 'INBOUND';
        const msgType = String(msg.type || 'unknown');
        const contentType = msg.contentType || '';
        const date = formatTs(msg.dateAdded || msg.createdAt);
        const body = (msg.body || msg.message || msg.text || '');
        const subject = msg.subject || '';
        const status = msg.status || '';
        const source = msg.source || '';

        // Skip system messages (type 28 = activity)
        if (msgType === '28' || msgType === '25') continue;

        stepNum++;
        console.log(`\n  ── Step ${stepNum} ──`);
        console.log(`  Direction: ${dir}`);
        console.log(`  Type: ${msgType} | Content: ${contentType}`);
        console.log(`  Date: ${date}`);
        console.log(`  Status: ${status}`);
        console.log(`  Source: ${source}`);
        if (subject) console.log(`  Subject: ${subject}`);
        console.log(`  Body:`);

        // Print full body with proper formatting
        const lines = body.split(/\n/);
        for (const line of lines) {
          console.log(`    ${line}`);
        }
      }
    }
  }

  // Also try to get SMS-only contact (Melissa) messages
  console.log(`\n${'='.repeat(70)}`);
  console.log('CONTACT: Melissa Somogyi (SMS-only, no email)');
  console.log('='.repeat(70));

  await sleep(300);
  const melSearch = await ghlRequest('GET',
    `/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent('+18438772232')}&limit=5`);
  const melContacts = melSearch.contacts || [];
  const melissa = melContacts.find(c => (c.phone || '').includes('8438772232'));

  if (melissa) {
    console.log(`  Name: ${melissa.firstName} ${melissa.lastName}`);

    await sleep(300);
    const convoData = await ghlRequest('GET',
      `/conversations/search?locationId=${LOCATION_ID}&contactId=${melissa.id}`);

    for (const conv of (convoData.conversations || [])) {
      await sleep(300);
      const msgData = await ghlRequest('GET',
        `/conversations/${conv.id}/messages?limit=100`);
      const messages = msgData.messages?.messages || msgData.messages || [];
      messages.sort((a, b) => new Date(a.dateAdded || a.createdAt || 0) - new Date(b.dateAdded || b.createdAt || 0));

      let stepNum = 0;
      for (const msg of messages) {
        const msgType = String(msg.type || 'unknown');
        if (msgType === '28' || msgType === '25') continue;

        stepNum++;
        const dir = (msg.direction === 'outbound' || msg.direction === 'outgoing') ? 'OUTBOUND' : 'INBOUND';
        console.log(`\n  ── Step ${stepNum} ──`);
        console.log(`  Direction: ${dir} | Type: ${msgType}`);
        console.log(`  Date: ${formatTs(msg.dateAdded || msg.createdAt)}`);
        console.log(`  Body:`);
        const lines = (msg.body || '').split(/\n/);
        for (const line of lines) {
          console.log(`    ${line}`);
        }
      }
    }
  }
}

main().catch(console.error);
