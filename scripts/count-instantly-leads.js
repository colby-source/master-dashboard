const axios = require('axios');
require('dotenv').config();

const api = axios.create({
  baseURL: 'https://api.instantly.ai/api/v2',
  headers: { 'Authorization': 'Bearer ' + process.env.INSTANTLY_API_KEY, 'Content-Type': 'application/json' },
  timeout: 30000
});

async function countLeads() {
  let total = 0;
  let emails = [];
  let startingAfter = null;
  let pages = 0;

  while (true) {
    const params = { campaign_id: '2e3af84a-8f6f-4446-981c-f10bb2348216', limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;

    const { data } = await api.get('/leads', { params });
    const items = data.items || data.data || data;
    if (!Array.isArray(items) || items.length === 0) break;

    for (const item of items) {
      emails.push(item.email);
    }
    total += items.length;
    pages++;
    if (pages % 10 === 0) console.error('Page ' + pages + ': ' + total + ' leads so far');

    if (!data.next_starting_after) break;
    startingAfter = data.next_starting_after;
  }

  console.log(JSON.stringify({ total, emails }));
}

countLeads().catch(e => console.error(e.message));
