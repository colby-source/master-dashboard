const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, '..', 'data', 'master-dashboard.db');
  if (!fs.existsSync(dbPath)) {
    console.log('DB not found at', dbPath);
    return;
  }
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);

  // Total count
  const total = db.exec('SELECT COUNT(*) FROM enrichment_leads');
  console.log('Total leads:', total[0].values[0][0]);

  // Dupes by email
  const emailDupes = db.exec(
    "SELECT email, COUNT(*) as cnt FROM enrichment_leads WHERE email IS NOT NULL AND email != '' GROUP BY LOWER(email) HAVING cnt > 1 ORDER BY cnt DESC LIMIT 20"
  );
  console.log('\nEmail duplicates (top 20):');
  if (emailDupes.length) emailDupes[0].values.forEach(r => console.log('  ', r[0], '-', r[1], 'copies'));
  else console.log('  None');

  // Dupes by first+last+company
  const nameDupes = db.exec(
    "SELECT first_name, last_name, company_id, COUNT(*) as cnt FROM enrichment_leads WHERE first_name IS NOT NULL AND last_name IS NOT NULL GROUP BY LOWER(first_name), LOWER(last_name), company_id HAVING cnt > 1 ORDER BY cnt DESC LIMIT 20"
  );
  console.log('\nName+Company duplicates (top 20):');
  if (nameDupes.length) nameDupes[0].values.forEach(r => console.log('  ', r[0], r[1], '(company_id:', r[2] + ')', '-', r[3], 'copies'));
  else console.log('  None');

  // Dupes by ghl_contact_id
  const ghlDupes = db.exec(
    "SELECT ghl_contact_id, COUNT(*) as cnt FROM enrichment_leads WHERE ghl_contact_id IS NOT NULL AND ghl_contact_id != '' GROUP BY ghl_contact_id HAVING cnt > 1 ORDER BY cnt DESC LIMIT 20"
  );
  console.log('\nGHL Contact ID duplicates (top 20):');
  if (ghlDupes.length) ghlDupes[0].values.forEach(r => console.log('  ', r[0], '-', r[1], 'copies'));
  else console.log('  None');

  // Summary counts
  const emailDupeGroups = db.exec(
    "SELECT COUNT(*) FROM (SELECT email FROM enrichment_leads WHERE email IS NOT NULL AND email != '' GROUP BY LOWER(email) HAVING COUNT(*) > 1)"
  );
  const emailRemovable = db.exec(
    "SELECT COUNT(*) FROM enrichment_leads WHERE email IS NOT NULL AND email != '' AND id NOT IN (SELECT MIN(id) FROM enrichment_leads WHERE email IS NOT NULL AND email != '' GROUP BY LOWER(email))"
  );
  const ghlDupeGroups = db.exec(
    "SELECT COUNT(*) FROM (SELECT ghl_contact_id FROM enrichment_leads WHERE ghl_contact_id IS NOT NULL AND ghl_contact_id != '' GROUP BY ghl_contact_id HAVING COUNT(*) > 1)"
  );

  console.log('\n=== SUMMARY ===');
  console.log('Unique emails with dupes:', emailDupeGroups[0]?.values[0][0] || 0);
  console.log('Removable email dupes (keep oldest):', emailRemovable[0]?.values[0][0] || 0);
  console.log('GHL contact ID groups with dupes:', ghlDupeGroups[0]?.values[0][0] || 0);

  // Junk name patterns — scraped website artifacts
  const junkPatterns = [
    'Senior Vice', 'Executive Vice', 'Assistant Vice', 'Associate Vice',
    'there Team', 'there Read', 'Read Bio', 'View Bio', 'Meet Our',
    'Learn More', 'Senior Leadership', 'Executive Assistant',
    'Executive Chairman', 'Founders Kevin'
  ];
  const junkQuery = junkPatterns.map(p => {
    const parts = p.split(' ');
    return `(LOWER(first_name) = '${parts[0].toLowerCase()}' AND LOWER(last_name) = '${parts[1].toLowerCase()}')`;
  }).join(' OR ');

  const junkCount = db.exec(
    `SELECT COUNT(*) FROM enrichment_leads WHERE ${junkQuery}`
  );
  console.log('\nJunk entries (scraped artifacts):', junkCount[0]?.values[0][0] || 0);

  // Leads with no email
  const noEmail = db.exec(
    "SELECT COUNT(*) FROM enrichment_leads WHERE email IS NULL OR email = ''"
  );
  console.log('Leads with no email:', noEmail[0]?.values[0][0] || 0);

  // Leads with very short/suspicious names (1 char or common website text)
  const shortNames = db.exec(
    "SELECT first_name, last_name, email, COUNT(*) as cnt FROM enrichment_leads WHERE LENGTH(first_name) <= 2 OR LENGTH(last_name) <= 2 GROUP BY first_name, last_name ORDER BY cnt DESC LIMIT 20"
  );
  console.log('\nShort/suspicious names (top 20):');
  if (shortNames.length) shortNames[0].values.forEach(r => console.log('  ', JSON.stringify(r[0]), JSON.stringify(r[1]), '- email:', r[2], '-', r[3], 'entries'));

  // Names that look like titles/roles, not people
  const roleLike = db.exec(
    "SELECT first_name, last_name, COUNT(*) as cnt FROM enrichment_leads WHERE LOWER(first_name) IN ('senior','executive','assistant','associate','managing','vice','president','director','chief','meet','read','view','learn','click','our','the','about','contact','team','founders','hi') OR LOWER(last_name) IN ('president','vice','team','bio','more','leadership','read','here','us','chairman') GROUP BY first_name, last_name ORDER BY cnt DESC LIMIT 30"
  );
  console.log('\nRole/website-text names (likely junk):');
  if (roleLike.length) {
    let totalJunk = 0;
    roleLike[0].values.forEach(r => { console.log('  ', r[0], r[1], '-', r[2]); totalJunk += r[2]; });
    console.log('  TOTAL:', totalJunk);
  }

  // Score distribution
  const scoreDist = db.exec(
    "SELECT CASE WHEN score >= 80 THEN 'A+ (80+)' WHEN score >= 60 THEN 'A (60-79)' WHEN score >= 40 THEN 'B (40-59)' WHEN score IS NOT NULL THEN 'C (<40)' ELSE 'Unscored' END as tier, COUNT(*) as cnt FROM enrichment_leads GROUP BY tier ORDER BY cnt DESC"
  );
  console.log('\nScore distribution:');
  if (scoreDist.length) scoreDist[0].values.forEach(r => console.log('  ', r[0], '-', r[1]));

  // Leads with no enrichment data
  const noEnrichment = db.exec(
    "SELECT COUNT(*) FROM enrichment_leads WHERE enrichment_data IS NULL OR enrichment_data = '' OR enrichment_data = '{}'"
  );
  console.log('\nLeads with no enrichment data:', noEnrichment[0]?.values[0][0] || 0);
})();
