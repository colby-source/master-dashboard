require('dotenv').config();
const axios = require('axios');
const apiKey = process.env.GHL_API_KEY_BNN;
const locationId = process.env.GHL_LOCATION_ID_BNN;
const baseUrl = 'https://services.leadconnectorhq.com';

async function checkByEmail(email) {
  try {
    const contactRes = await axios.get(baseUrl + '/contacts/search/duplicate', {
      headers: { Authorization: 'Bearer ' + apiKey, Version: '2021-04-15' },
      params: { locationId, email }
    });
    const contact = contactRes.data.contact;
    if (!contact) { console.log(email + ': contact not found'); return; }

    const searchRes = await axios.get(baseUrl + '/conversations/search', {
      headers: { Authorization: 'Bearer ' + apiKey, Version: '2021-04-15' },
      params: { locationId, contactId: contact.id }
    });
    const convos = searchRes.data.conversations || [];
    if (convos.length === 0) { console.log(email + ': no conversations'); return; }

    const msgRes = await axios.get(baseUrl + '/conversations/' + convos[0].id + '/messages', {
      headers: { Authorization: 'Bearer ' + apiKey, Version: '2021-04-15' },
    });
    const msgs = msgRes.data.messages?.messages || [];
    const outboundEmails = msgs.filter(m => (m.type === 2 || m.type === 3) && m.direction === 'outbound');
    const inboundEmails = msgs.filter(m => (m.type === 2 || m.type === 3) && m.direction === 'inbound');
    console.log('\n' + email);
    console.log('  Total msgs: ' + msgs.length + ' | Outbound emails: ' + outboundEmails.length + ' | Inbound emails: ' + inboundEmails.length);

    outboundEmails.forEach(m => {
      const body = (m.body || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 250);
      console.log('  [SENT] ' + m.dateAdded);
      console.log('    ' + body);
    });

    if (outboundEmails.length === 0) {
      const types = {};
      msgs.forEach(m => { const k = m.direction + ':type' + m.type; types[k] = (types[k] || 0) + 1; });
      console.log('  Message types: ' + JSON.stringify(types));
    }
  } catch(e) {
    console.log(email + ' ERROR: ' + (e.response?.status || '') + ' ' + (e.response?.data?.message || e.message));
  }
}

async function main() {
  console.log('Checking GHL outbound emails for BMN Stage 0 contacts...\n');
  const emails = [
    'kristinaprilfitness@gmail.com',
    'thekingdomcoaching@gmail.com',
    'jamesturnage16@gmail.com',
    'administration@thefitanthefab.com',
    'momone1421@gmail.com',
    'brittneybouchard@me.com',
    'clemenfitnesstherapy@gmail.com',
    'theadgexperience@gmail.com',
    'bsimonecontact@gmail.com',
    'olasgifts.co@gmail.com',
    'brie@briewieselman.com',
    'jessica@thejkoagency.com',
    'contacthelenmarie@gmail.com',
    'symone.s59@gmail.com',
    'biguglyduude@gmail.com',
  ];
  for (const e of emails) { await checkByEmail(e); }
}

main().catch(e => console.error(e.message));
