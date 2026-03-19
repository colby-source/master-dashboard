const fs = require('fs');
const path = require('path');
const http = require('http');

const batchNum = process.argv[2] || '01';
const batchDir = path.join(
  'C:', 'Users', 'colby', 'OneDrive', 'Documents', 'Data', 'Granite Park',
  'Fund - Marc', 'Marketing', 'Data', 'Cold Data - Email Campaign', 'Enrichment_Batches'
);

// Find the batch file
const files = fs.readdirSync(batchDir).filter(f => f.startsWith(`batch_${batchNum}`));
if (files.length === 0) {
  console.log(`No batch file found for batch ${batchNum}`);
  process.exit(1);
}
const batchFile = path.join(batchDir, files[0]);
console.log(`Loading: ${files[0]}`);

function parseCSVLine(line) {
  const result = []; let current = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

const text = fs.readFileSync(batchFile, 'utf-8');
const lines = text.split('\n').filter(l => l.trim());
const headers = parseCSVLine(lines[0]).map(h => h.trim());

const leads = [];
for (let i = 1; i < lines.length; i++) {
  const vals = parseCSVLine(lines[i]);
  const row = {};
  headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });
  leads.push({
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    email: row.email || '',
    company: row.company || '',
    title: row.title || '',
    phone: row.phone || '',
    city: row.city || '',
    state: row.state || '',
    source: row.source || 'AMF',
  });
}

console.log(`Parsed ${leads.length} leads`);
console.log('Sample:', JSON.stringify(leads[0], null, 2));

const payload = JSON.stringify({ company_id: 1, leads, auto_process: true });
console.log(`\nUploading to enrichment pipeline (${(Buffer.byteLength(payload) / 1024).toFixed(0)}KB)...`);

const req = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/enrichment/bulk-upload',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  timeout: 30000,
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    try {
      const json = JSON.parse(body);
      console.log('Response:', JSON.stringify(json, null, 2).substring(0, 1000));
    } catch {
      console.log('Response:', body.substring(0, 1000));
    }
  });
});
req.on('error', (err) => console.log('Error:', err.message));
req.on('timeout', () => { console.log('Request timed out'); req.destroy(); });
req.write(payload);
req.end();
