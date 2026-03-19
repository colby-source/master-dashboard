const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, '..', 'data', 'master-dashboard.db');
  if (!fs.existsSync(dbPath)) { console.log('DB not found'); return; }
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);

  // List all tables
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log('=== ALL TABLES ===');
  tables[0].values.forEach(r => {
    const count = db.exec(`SELECT COUNT(*) FROM "${r[0]}"`);
    console.log(`  ${r[0]}: ${count[0].values[0][0]} rows`);
  });

  // Check for lead/contact-like columns in each table
  console.log('\n=== TABLES WITH EMAIL/NAME COLUMNS ===');
  for (const row of tables[0].values) {
    const tbl = row[0];
    const cols = db.exec(`PRAGMA table_info("${tbl}")`);
    if (!cols.length) continue;
    const colNames = cols[0].values.map(c => c[1]);
    const hasEmail = colNames.some(c => /email/i.test(c));
    const hasName = colNames.some(c => /first.?name|last.?name|name/i.test(c));
    if (hasEmail || hasName) {
      console.log(`\n  ${tbl} (${colNames.join(', ')})`);
      const count = db.exec(`SELECT COUNT(*) FROM "${tbl}"`);
      console.log(`    Rows: ${count[0].values[0][0]}`);
    }
  }

  // Deep audit on enrichment_leads - the big one
  console.log('\n\n========================================');
  console.log('=== ENRICHMENT_LEADS FULL AUDIT ===');
  console.log('========================================');

  const total = db.exec('SELECT COUNT(*) FROM enrichment_leads')[0].values[0][0];
  console.log(`Total: ${total}`);

  // 1. Junk first_name patterns (website scraping artifacts)
  const junkFirstNames = [
    'senior', 'executive', 'assistant', 'associate', 'managing', 'vice',
    'president', 'director', 'chief', 'meet', 'read', 'view', 'learn',
    'click', 'our', 'the', 'about', 'contact', 'team', 'founders', 'hi',
    'founded', 'founding', 'partner', 'principal', 'chairman', 'community',
    'everyone', 'founder', 'general', 'investment', 'portfolio', 'advisory',
    'board', 'management', 'leadership', 'office', 'investor', 'relations',
    'committee', 'counsel', 'compliance', 'operations', 'analyst', 'bio',
    'here', 'more', 'info', 'see', 'discover', 'explore', 'get'
  ];
  const junkLastNames = [
    'president', 'vice', 'team', 'bio', 'more', 'leadership', 'read',
    'here', 'us', 'chairman', 'committee', 'relations', 'officer',
    'counsel', 'partner', 'capital', 'fund', 'group', 'management',
    'investments', 'advisors', 'advisory', 'associates', 'global',
    'ventures', 'equity', 'wealth', 'asset', 'securities', 'financial'
  ];

  const junkFirstQ = junkFirstNames.map(n => `'${n}'`).join(',');
  const junkLastQ = junkLastNames.map(n => `'${n}'`).join(',');

  const junkByFirst = db.exec(
    `SELECT first_name, last_name, email, score FROM enrichment_leads WHERE LOWER(first_name) IN (${junkFirstQ}) ORDER BY first_name LIMIT 50`
  );
  console.log('\n--- Junk by first_name (sample 50) ---');
  if (junkByFirst.length) {
    junkByFirst[0].values.forEach(r => console.log(`  "${r[0]} ${r[1]}" - ${r[2]} (score: ${r[3]})`));
  }
  const junkFirstCount = db.exec(`SELECT COUNT(*) FROM enrichment_leads WHERE LOWER(first_name) IN (${junkFirstQ})`);
  console.log(`  COUNT: ${junkFirstCount[0].values[0][0]}`);

  const junkByLast = db.exec(
    `SELECT first_name, last_name, email, score FROM enrichment_leads WHERE LOWER(last_name) IN (${junkLastQ}) AND LOWER(first_name) NOT IN (${junkFirstQ}) ORDER BY last_name LIMIT 50`
  );
  console.log('\n--- Junk by last_name only (sample 50) ---');
  if (junkByLast.length) {
    junkByLast[0].values.forEach(r => console.log(`  "${r[0]} ${r[1]}" - ${r[2]} (score: ${r[3]})`));
  }
  const junkLastCount = db.exec(`SELECT COUNT(*) FROM enrichment_leads WHERE LOWER(last_name) IN (${junkLastQ}) AND LOWER(first_name) NOT IN (${junkFirstQ})`);
  console.log(`  COUNT: ${junkLastCount[0].values[0][0]}`);

  // 2. Name duplicates (same first+last, keep best scored)
  const nameDupes = db.exec(
    `SELECT LOWER(first_name) as fn, LOWER(last_name) as ln, COUNT(*) as cnt, GROUP_CONCAT(id) as ids, GROUP_CONCAT(score) as scores
     FROM enrichment_leads
     WHERE first_name IS NOT NULL AND last_name IS NOT NULL
     GROUP BY fn, ln
     HAVING cnt > 1
     ORDER BY cnt DESC
     LIMIT 30`
  );
  console.log('\n--- Name duplicates (top 30) ---');
  let totalNameDupeRows = 0;
  if (nameDupes.length) {
    nameDupes[0].values.forEach(r => {
      console.log(`  "${r[0]} ${r[1]}" x${r[2]} - ids:[${r[3]}] scores:[${r[4]}]`);
      totalNameDupeRows += r[2] - 1; // excess copies
    });
  }
  const allNameDupeGroups = db.exec(
    `SELECT COUNT(*), SUM(cnt - 1) FROM (SELECT COUNT(*) as cnt FROM enrichment_leads WHERE first_name IS NOT NULL AND last_name IS NOT NULL GROUP BY LOWER(first_name), LOWER(last_name) HAVING cnt > 1)`
  );
  console.log(`  Total dupe groups: ${allNameDupeGroups[0]?.values[0][0] || 0}, removable rows: ${allNameDupeGroups[0]?.values[0][1] || 0}`);

  // 3. Email-based duplicates (case insensitive)
  const emailDupes = db.exec(
    `SELECT LOWER(email) as em, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
     FROM enrichment_leads
     WHERE email IS NOT NULL AND email != ''
     GROUP BY em
     HAVING cnt > 1
     ORDER BY cnt DESC LIMIT 20`
  );
  console.log('\n--- Email duplicates ---');
  if (emailDupes.length) {
    emailDupes[0].values.forEach(r => console.log(`  ${r[0]} x${r[1]} ids:[${r[2]}]`));
  } else {
    console.log('  None');
  }

  // 4. Emails that look fake/generated
  const fakeEmails = db.exec(
    `SELECT email, first_name, last_name FROM enrichment_leads
     WHERE email LIKE '%noreply%' OR email LIKE '%no-reply%'
     OR email LIKE '%donotreply%' OR email LIKE '%info@%'
     OR email LIKE '%admin@%' OR email LIKE '%support@%'
     OR email LIKE '%hello@%' OR email LIKE '%contact@%'
     OR email LIKE '%team@%' OR email LIKE '%careers@%'
     OR email LIKE '%jobs@%' OR email LIKE '%hr@%'
     OR email LIKE '%press@%' OR email LIKE '%media@%'
     OR email LIKE '%office@%' OR email LIKE '%general@%'
     OR email LIKE '%enquir%@%' OR email LIKE '%feedback@%'
     ORDER BY email LIMIT 30`
  );
  console.log('\n--- Generic/non-personal emails (sample 30) ---');
  if (fakeEmails.length) {
    fakeEmails[0].values.forEach(r => console.log(`  ${r[0]} (${r[1]} ${r[2]})`));
  }
  const fakeEmailCount = db.exec(
    `SELECT COUNT(*) FROM enrichment_leads
     WHERE email LIKE '%noreply%' OR email LIKE '%no-reply%'
     OR email LIKE '%donotreply%' OR email LIKE '%info@%'
     OR email LIKE '%admin@%' OR email LIKE '%support@%'
     OR email LIKE '%hello@%' OR email LIKE '%contact@%'
     OR email LIKE '%team@%' OR email LIKE '%careers@%'
     OR email LIKE '%jobs@%' OR email LIKE '%hr@%'
     OR email LIKE '%press@%' OR email LIKE '%media@%'
     OR email LIKE '%office@%' OR email LIKE '%general@%'
     OR email LIKE '%enquir%@%' OR email LIKE '%feedback@%'`
  );
  console.log(`  COUNT: ${fakeEmailCount[0]?.values[0][0] || 0}`);

  // 5. Emails where the local part doesn't match the name at all (likely wrong person-email mapping)
  // Skip this for now as it's complex

  // 6. Company distribution
  const companyDist = db.exec(
    `SELECT c.name, COUNT(*) as cnt FROM enrichment_leads el JOIN companies c ON c.id = el.company_id GROUP BY el.company_id ORDER BY cnt DESC`
  );
  console.log('\n--- Leads by company ---');
  if (companyDist.length) companyDist[0].values.forEach(r => console.log(`  ${r[0]}: ${r[1]}`));

  // 7. Source distribution
  const sourceDist = db.exec(
    `SELECT source, COUNT(*) as cnt FROM enrichment_leads GROUP BY source ORDER BY cnt DESC`
  );
  console.log('\n--- Leads by source ---');
  if (sourceDist.length) sourceDist[0].values.forEach(r => console.log(`  ${r[0]}: ${r[1]}`));

  // 8. Status distribution
  const statusDist = db.exec(
    `SELECT status, COUNT(*) as cnt FROM enrichment_leads GROUP BY status ORDER BY cnt DESC`
  );
  console.log('\n--- Leads by status ---');
  if (statusDist.length) statusDist[0].values.forEach(r => console.log(`  ${r[0]}: ${r[1]}`));

  // SUMMARY
  const junkTotal = (junkFirstCount[0]?.values[0][0] || 0) + (junkLastCount[0]?.values[0][0] || 0);
  const nameDupeRemovable = allNameDupeGroups[0]?.values[0][1] || 0;
  const genericEmails = fakeEmailCount[0]?.values[0][0] || 0;

  console.log('\n========================================');
  console.log('=== CLEANUP SUMMARY ===');
  console.log('========================================');
  console.log(`Total leads: ${total}`);
  console.log(`Junk names (scraping artifacts): ${junkTotal}`);
  console.log(`Name duplicate excess rows: ${nameDupeRemovable}`);
  console.log(`Generic/non-personal emails: ${genericEmails}`);
  console.log(`Estimated removable: ${junkTotal + nameDupeRemovable + genericEmails}`);
  console.log(`Estimated remaining: ${total - junkTotal - nameDupeRemovable - genericEmails}`);
})();
