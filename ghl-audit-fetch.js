const https = require('https');

const API_KEY = 'pit-b843ddf7-affa-43f1-81b5-634a248e2c93';
const LOCATION_ID = 'x8XBOACL6wOFcsQewWPw';
const EVENT_PIPELINE = 'GMqxElyHPSr2karweCGS';
const META_PIPELINE = 'iJ5eS6fANsGVejDo6ubW';

function ghlGet(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'services.leadconnectorhq.com',
      path,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Version': '2021-07-28',
      },
    };
    https.get(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    }).on('error', reject);
  });
}

async function getContactConversations(contactId) {
  // Get conversations for this contact
  const convData = await ghlGet(`/conversations/search?locationId=${LOCATION_ID}&contactId=${contactId}`);
  return convData.conversations || [];
}

async function getConversationMessages(conversationId) {
  const msgData = await ghlGet(`/conversations/${conversationId}/messages?limit=100`);
  return msgData.messages || msgData.msg?.messages || [];
}

async function getAllOpps(pipelineId) {
  const data = await ghlGet(`/opportunities/search?location_id=${LOCATION_ID}&pipeline_id=${pipelineId}&limit=100`);
  return data.opportunities || [];
}

async function main() {
  console.log('=== Fetching opportunities from both pipelines ===\n');

  // Get opps from both pipelines
  const [eventOpps, metaOpps] = await Promise.all([
    getAllOpps(EVENT_PIPELINE),
    getAllOpps(META_PIPELINE),
  ]);

  console.log(`Event Funnel: ${eventOpps.length} opportunities`);
  console.log(`Meta Lead Intake: ${metaOpps.length} opportunities\n`);

  // Group by stage
  const stageMap = {};
  for (const o of eventOpps) {
    const sn = o.pipelineStageName || 'unknown';
    if (!stageMap[sn]) stageMap[sn] = [];
    const cid = o.contact?.id || o.contactId;
    if (cid) stageMap[sn].push(cid);
  }
  const metaStageMap = {};
  for (const o of metaOpps) {
    const sn = o.pipelineStageName || 'unknown';
    if (!metaStageMap[sn]) metaStageMap[sn] = [];
    const cid = o.contact?.id || o.contactId;
    if (cid) metaStageMap[sn].push(cid);
  }

  console.log('--- Event Funnel Stages ---');
  for (const [sn, cids] of Object.entries(stageMap)) {
    console.log(`  ${sn}: ${cids.length} contacts`);
  }
  console.log('\n--- Meta Lead Intake Stages ---');
  for (const [sn, cids] of Object.entries(metaStageMap)) {
    console.log(`  ${sn}: ${cids.length} contacts`);
  }

  // Collect unique contact IDs - sample from each stage
  const sampleContacts = new Set();
  for (const [sn, cids] of Object.entries(stageMap)) {
    // Take up to 2 from each stage to get variety
    cids.slice(0, 2).forEach(c => sampleContacts.add(c));
  }
  for (const [sn, cids] of Object.entries(metaStageMap)) {
    cids.slice(0, 2).forEach(c => sampleContacts.add(c));
  }

  console.log(`\n=== Fetching conversation history for ${sampleContacts.size} sample contacts ===\n`);

  const allEmails = [];

  for (const contactId of sampleContacts) {
    try {
      const convs = await getContactConversations(contactId);
      for (const conv of convs) {
        const messages = await getConversationMessages(conv.id);
        for (const msg of messages) {
          // Only outbound emails/SMS from GHL
          if (msg.direction === 'outbound' || msg.direction === 1) {
            allEmails.push({
              contactId,
              contactName: conv.contactName || conv.fullName || contactId,
              type: msg.contentType || msg.type || 'unknown',
              subject: msg.subject || '',
              body: msg.body || msg.message || msg.text || '',
              html: msg.html || '',
              dateAdded: msg.dateAdded || msg.createdAt || '',
              source: msg.source || msg.altType || '',
              messageType: msg.messageType || '',
            });
          }
        }
      }
      // Rate limit
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`Error fetching for contact ${contactId}: ${err.message}`);
    }
  }

  console.log(`\nTotal outbound messages found: ${allEmails.length}\n`);

  // Group emails by subject/type to identify unique sequences
  const uniqueEmails = new Map();
  for (const e of allEmails) {
    // Create a key from subject + first 100 chars of body
    const bodyPreview = (e.body || e.html || '').replace(/<[^>]+>/g, '').substring(0, 100);
    const key = `${e.subject}|||${bodyPreview}`;
    if (!uniqueEmails.has(key)) {
      uniqueEmails.set(key, e);
    }
  }

  console.log(`Unique email templates identified: ${uniqueEmails.size}\n`);
  console.log('=== FULL EMAIL COPY ===\n');

  let idx = 1;
  for (const [key, e] of uniqueEmails) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`EMAIL #${idx}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Type: ${e.type}`);
    console.log(`Source: ${e.source}`);
    console.log(`Date: ${e.dateAdded}`);
    console.log(`Contact: ${e.contactName}`);
    if (e.subject) console.log(`Subject: ${e.subject}`);
    console.log(`${'─'.repeat(40)}`);

    // Strip HTML to get readable text, or show plain body
    let body = e.body || e.html || '';
    if (body.includes('<')) {
      // Basic HTML to text
      body = body
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
    console.log(body);
    idx++;
  }

  // Write full JSON for reference
  const fs = require('fs');
  fs.writeFileSync('/tmp/ghl_all_emails.json', JSON.stringify(allEmails, null, 2));
  console.log('\n\nFull JSON saved to /tmp/ghl_all_emails.json');
}

main().catch(err => console.error('Fatal error:', err));
