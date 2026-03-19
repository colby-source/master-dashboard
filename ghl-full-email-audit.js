const https = require('https');
const fs = require('fs');

const API_KEY = 'pit-b843ddf7-affa-43f1-81b5-634a248e2c93';
const LOCATION_ID = 'x8XBOACL6wOFcsQewWPw';

function ghlGet(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'services.leadconnectorhq.com',
      path,
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Version': '2021-07-28' },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject);
  });
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
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

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== COMPREHENSIVE GHL EMAIL/SMS AUDIT ===\n');
  console.log('Fetching all conversations...\n');

  // Fetch all conversations (paginate)
  const allConvs = [];
  let lastId = null;
  for (let page = 0; page < 20; page++) {
    let path = `/conversations/search?locationId=${LOCATION_ID}&limit=50`;
    if (lastId) path += `&startAfterDate=${lastId}`;

    const data = await ghlGet(path);
    const convs = data.conversations || [];
    if (convs.length === 0) break;
    allConvs.push(...convs);
    console.log(`  Page ${page + 1}: ${convs.length} conversations (total: ${allConvs.length})`);

    // Use last conversation's date for pagination
    if (convs.length < 50) break;
    lastId = convs[convs.length - 1].dateUpdated || convs[convs.length - 1].dateAdded;
    await delay(200);
  }

  console.log(`\nTotal conversations: ${allConvs.length}`);

  // Fetch messages from each conversation
  const allOutbound = [];
  let processed = 0;

  for (const conv of allConvs) {
    try {
      let allMsgs = [];
      let lastMsgId = null;

      // Paginate messages
      for (let mPage = 0; mPage < 5; mPage++) {
        let msgPath = `/conversations/${conv.id}/messages?limit=50`;
        if (lastMsgId) msgPath += `&lastMessageId=${lastMsgId}`;

        const msgData = await ghlGet(msgPath);
        const msgs = msgData.messages?.messages || [];
        if (msgs.length === 0) break;
        allMsgs.push(...msgs);

        if (!msgData.messages?.nextPage) break;
        lastMsgId = msgs[msgs.length - 1].id;
        await delay(100);
      }

      for (const m of allMsgs) {
        if (m.direction === 'outbound') {
          // Skip pure activity/system messages
          if (m.messageType === 'TYPE_ACTIVITY_OPPORTUNITY' ||
              m.messageType === 'TYPE_ACTIVITY_CONTACT' ||
              m.messageType === 'TYPE_ACTIVITY_NOTE') continue;

          const body = m.body || m.html || m.text || '';
          if (!body || body.length < 10) continue;

          allOutbound.push({
            contactName: conv.contactName || conv.fullName || '',
            contactId: conv.contactId,
            email: conv.email || '',
            type: m.messageType || `type_${m.type}`,
            subject: m.subject || '',
            body: body,
            bodyText: body.includes('<') ? stripHtml(body) : body,
            dateAdded: m.dateAdded || '',
            source: m.source || '',
            altType: m.altType || '',
            status: m.status || '',
          });
        }
      }

      processed++;
      if (processed % 20 === 0) {
        console.log(`  Processed ${processed}/${allConvs.length} conversations, ${allOutbound.length} outbound messages found`);
      }
      await delay(100);
    } catch (err) {
      // skip errors silently
    }
  }

  console.log(`\nTotal outbound messages: ${allOutbound.length}`);

  // Deduplicate by content similarity
  // Normalize body for grouping (remove names, dates, specific details)
  function normalizeForGrouping(text) {
    return text
      .replace(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, '{NAME}') // Names
      .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, '{DATE}')
      .replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi, '{DAY}')
      .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/gi, '{MONTH}')
      .replace(/\b\d{1,2}:\d{2}\s*(AM|PM|am|pm)\b/g, '{TIME}')
      .substring(0, 200);
  }

  // Group by template
  const templates = new Map();
  for (const msg of allOutbound) {
    const key = normalizeForGrouping(msg.bodyText || msg.body);
    if (!templates.has(key)) {
      templates.set(key, { ...msg, count: 1 });
    } else {
      templates.get(key).count++;
    }
  }

  // Sort by date
  const sorted = [...templates.values()].sort((a, b) => {
    // Group by type first (EMAIL then SMS)
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return (a.dateAdded || '').localeCompare(b.dateAdded || '');
  });

  console.log(`Unique message templates: ${sorted.length}\n`);

  // Output
  let output = '';
  output += '='.repeat(80) + '\n';
  output += 'GOHIGHLEVEL — COMPLETE OUTBOUND MESSAGE AUDIT\n';
  output += 'Grand Park Capital (Location: x8XBOACL6wOFcsQewWPw)\n';
  output += `Generated: ${new Date().toISOString().split('T')[0]}\n`;
  output += `Total outbound messages scanned: ${allOutbound.length}\n`;
  output += `Unique templates identified: ${sorted.length}\n`;
  output += '='.repeat(80) + '\n\n';

  // Separate emails and SMS
  const emails = sorted.filter(m => m.type === 'TYPE_EMAIL' || m.subject);
  const sms = sorted.filter(m => m.type === 'TYPE_SMS' || (!m.subject && m.type !== 'TYPE_EMAIL'));
  const other = sorted.filter(m => !emails.includes(m) && !sms.includes(m));

  output += '╔══════════════════════════════════════════════════════════════╗\n';
  output += '║                    EMAIL SEQUENCES                          ║\n';
  output += '╚══════════════════════════════════════════════════════════════╝\n\n';

  let idx = 1;
  for (const e of emails) {
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `EMAIL #${idx}  |  Sent ${e.count}x  |  Source: ${e.source}\n`;
    output += `Date: ${e.dateAdded}\n`;
    if (e.subject) output += `Subject: ${e.subject}\n`;
    output += `──────────────────────────────────────────\n`;
    output += (e.bodyText || e.body) + '\n\n';
    idx++;
  }

  output += '\n╔══════════════════════════════════════════════════════════════╗\n';
  output += '║                    SMS SEQUENCES                             ║\n';
  output += '╚══════════════════════════════════════════════════════════════╝\n\n';

  idx = 1;
  for (const s of sms) {
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `SMS #${idx}  |  Sent ${s.count}x  |  Source: ${s.source}\n`;
    output += `Date: ${s.dateAdded}\n`;
    output += `──────────────────────────────────────────\n`;
    output += (s.bodyText || s.body) + '\n\n';
    idx++;
  }

  if (other.length > 0) {
    output += '\n╔══════════════════════════════════════════════════════════════╗\n';
    output += '║                    OTHER MESSAGES                            ║\n';
    output += '╚══════════════════════════════════════════════════════════════╝\n\n';
    for (const o of other) {
      output += `Type: ${o.type} | Source: ${o.source} | Sent ${o.count}x\n`;
      output += (o.bodyText || o.body).substring(0, 500) + '\n\n';
    }
  }

  // Save
  fs.writeFileSync('c:/Users/colby/Master Dashboard/ghl-email-copy-audit.txt', output);
  fs.writeFileSync('c:/Users/colby/Master Dashboard/ghl-all-messages-raw.json', JSON.stringify(allOutbound, null, 2));

  console.log(output);
  console.log('\n\nFiles saved:');
  console.log('  ghl-email-copy-audit.txt — formatted audit');
  console.log('  ghl-all-messages-raw.json — raw JSON of all messages');
}

main().catch(e => console.error('Fatal:', e));
