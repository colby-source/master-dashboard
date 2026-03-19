const https = require('https');

const CF_EMAIL = 'colby@granitepark.co';
const CF_KEY = '54a56dc8c77f7c79da5834e7fb501e0e58892';

const ZONES = {
  'graniteparkcapitalfund.com': '231a29fed1c2a800a8f3968b45bc8494',
  'granitehousingpartners.com': 'e5fc0ef20d61dee416194ddcccc18611',
  'granite-park-fund.com': '8a5ff7a7dd8f0ac11f8b4c709a27055d',
  'granitehousingfund.com': 'fb5ec28c53cce25176c13dbb194002c2',
};

function cfRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.cloudflare.com',
      path: '/client/v4' + path,
      method,
      headers: {
        'X-Auth-Email': CF_EMAIL,
        'X-Auth-Key': CF_KEY,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve({ success: false, errors: [{ message: d }] }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getRecords(zoneId, type, name) {
  const result = await cfRequest('GET', `/zones/${zoneId}/dns_records?type=${type}&name=${encodeURIComponent(name)}&per_page=50`);
  return result.success ? result.result : [];
}

async function createRecord(zoneId, record) {
  return cfRequest('POST', `/zones/${zoneId}/dns_records`, record);
}

async function updateRecord(zoneId, recordId, record) {
  return cfRequest('PATCH', `/zones/${zoneId}/dns_records/${recordId}`, record);
}

async function fixDomain(domain, zoneId) {
  console.log(`\n=== ${domain} (${zoneId}) ===`);

  // 1. Add tracking CNAME
  console.log('  [1] Custom tracking domain...');
  const trackRecords = await getRecords(zoneId, 'CNAME', `track.${domain}`);
  if (trackRecords.length > 0) {
    console.log('    Already exists: track.' + domain + ' -> ' + trackRecords[0].content);
    // Update if pointing to wrong target
    if (trackRecords[0].content !== 'track.instantly.ai') {
      const r = await updateRecord(zoneId, trackRecords[0].id, { content: 'track.instantly.ai', proxied: false });
      console.log('    Updated to track.instantly.ai:', r.success ? 'OK' : r.errors[0]?.message);
    }
  } else {
    const r = await createRecord(zoneId, {
      type: 'CNAME',
      name: 'track',
      content: 'track.instantly.ai',
      proxied: false,
      ttl: 1, // auto
    });
    console.log('    Created track.' + domain + ' -> track.instantly.ai:', r.success ? 'OK' : r.errors[0]?.message);
  }

  // 2. Fix SPF: change ~all to -all
  console.log('  [2] SPF hardening...');
  const txtRecords = await getRecords(zoneId, 'TXT', domain);
  const spfRecord = txtRecords.find(r => r.content && r.content.includes('v=spf1'));
  if (spfRecord) {
    if (spfRecord.content.includes('~all')) {
      const newSpf = spfRecord.content.replace('~all', '-all');
      const r = await updateRecord(zoneId, spfRecord.id, { content: newSpf });
      console.log('    Updated SPF to -all:', r.success ? 'OK' : r.errors[0]?.message);
    } else if (spfRecord.content.includes('-all')) {
      console.log('    Already has -all');
    } else {
      console.log('    SPF exists but unusual:', spfRecord.content);
    }
  } else {
    console.log('    No SPF record found - creating one');
    const r = await createRecord(zoneId, {
      type: 'TXT',
      name: domain,
      content: 'v=spf1 include:_spf.google.com -all',
      ttl: 1,
    });
    console.log('    Created SPF:', r.success ? 'OK' : r.errors[0]?.message);
  }

  // 3. Fix DMARC: change p=none to p=quarantine with strict alignment
  console.log('  [3] DMARC enforcement...');
  const dmarcRecords = await getRecords(zoneId, 'TXT', `_dmarc.${domain}`);
  const dmarcRecord = dmarcRecords.find(r => r.content && r.content.includes('DMARC'));
  const newDmarc = `v=DMARC1; p=quarantine; rua=mailto:dmarc-rua@${domain}; ruf=mailto:dmarc-ruf@${domain}; pct=100; sp=quarantine; adkim=s; aspf=s; fo=1`;

  if (dmarcRecord) {
    if (dmarcRecord.content.includes('p=none')) {
      const r = await updateRecord(zoneId, dmarcRecord.id, { content: newDmarc });
      console.log('    Updated DMARC to p=quarantine:', r.success ? 'OK' : r.errors[0]?.message);
    } else if (dmarcRecord.content.includes('p=quarantine') || dmarcRecord.content.includes('p=reject')) {
      console.log('    Already enforcing:', dmarcRecord.content.substring(0, 60));
    } else {
      console.log('    Unusual DMARC:', dmarcRecord.content);
    }
  } else {
    const r = await createRecord(zoneId, {
      type: 'TXT',
      name: '_dmarc',
      content: newDmarc,
      ttl: 1,
    });
    console.log('    Created DMARC:', r.success ? 'OK' : r.errors[0]?.message);
  }
}

async function main() {
  console.log('Starting Cloudflare DNS fixes for all Granite domains...');

  for (const [domain, zoneId] of Object.entries(ZONES)) {
    await fixDomain(domain, zoneId);
  }

  console.log('\n=== ALL DONE ===');
  console.log('Next steps:');
  console.log('1. Register tracking domains in Instantly Settings > Tracking');
  console.log('2. Wait 5-10 minutes for DNS propagation');
  console.log('3. Verify with: nslookup -type=CNAME track.DOMAIN');
}

main().catch(e => console.error('Fatal:', e));
