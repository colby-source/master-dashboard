const http = require('http');
const https = require('https');

const API_KEY = 'NTE4ZGU4ZjgtYzg1ZC00ZmM2LWJhN2MtOGI2MDFlY2YzZTNlOk1xYlZSVWd5TU9SaQ==';
const CAMPAIGN_ID = 'c5ad2979-086b-4a9a-89f2-e7766b7023de';

async function getLeads(offset, limit) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3001/api/enrichment/leads?limit=' + limit + '&offset=' + offset + '&status=scored', res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

async function addLead(lead) {
  let enrichment = {};
  try {
    enrichment = lead.enrichment_data
      ? (typeof lead.enrichment_data === 'string' ? JSON.parse(lead.enrichment_data) : lead.enrichment_data)
      : {};
  } catch {}
  const ap = enrichment.apollo_person || {};
  const pp = enrichment.pdl_person || {};
  const personalizations = enrichment.personalizations || {};

  const body = JSON.stringify({
    email: lead.email,
    first_name: lead.first_name || '',
    last_name: lead.last_name || '',
    company_name: ap.organization_name || pp.job_company_name || '',
    campaign: CAMPAIGN_ID,
    custom_variables: {
      score: lead.score,
      score_label: lead.score_label,
      job_title: ap.title || pp.job_title || '',
      company: ap.organization_name || pp.job_company_name || '',
      industry: ap.organization_industry || pp.industry || '',
      opener: personalizations.opener || '',
      pain_point: personalizations.painPoint || '',
      cta: personalizations.cta || '',
      personalization: personalizations.opener || '',
      source: lead.source || '',
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.instantly.ai',
      path: '/api/v2/leads',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ ok: res.statusCode === 200 }));
    });
    req.on('error', () => resolve({ ok: false }));
    req.write(body);
    req.end();
  });
}

async function run() {
  let totalSuccess = 0, totalFailed = 0, processed = 0;
  const batchSize = 500;
  let offset = 6; // skip first 6 already added

  while (true) {
    const data = await getLeads(offset, batchSize);
    const leads = data.leads || [];
    if (leads.length === 0) break;

    for (const lead of leads) {
      if (lead.email === undefined || lead.email === null || lead.email === '') {
        totalFailed++;
        processed++;
        continue;
      }
      const result = await addLead(lead);
      if (result.ok) totalSuccess++;
      else totalFailed++;
      processed++;
      if (processed % 100 === 0) {
        console.log('Progress:', processed, '/ ~2312 | success:', totalSuccess, '| failed:', totalFailed);
      }
    }
    offset += batchSize;
  }
  console.log('DONE. Total:', processed, '| Success:', totalSuccess, '| Failed:', totalFailed);
}

run().catch(e => console.error(e));
