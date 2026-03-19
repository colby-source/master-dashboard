const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, '..', 'data', 'master-dashboard.db');
  if (!fs.existsSync(dbPath)) { console.log('DB not found'); return; }
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);

  const before = db.exec('SELECT COUNT(*) FROM enrichment_leads')[0].values[0][0];
  console.log(`Starting cleanup. Total leads before: ${before}\n`);

  let totalRemoved = 0;

  // ═══════════════════════════════════════════════════════════
  // PASS 1: Remove junk first_name entries (website scraping artifacts)
  // ═══════════════════════════════════════════════════════════
  const junkFirstNames = [
    'senior', 'executive', 'assistant', 'associate', 'managing',
    'meet', 'read', 'view', 'learn', 'click', 'our', 'the', 'about',
    'contact', 'team', 'everyone', 'founded', 'community',
    'bio', 'here', 'more', 'info', 'see', 'discover', 'explore', 'get'
  ];
  // "founders" + non-name last_name (like "Kevin" is a real name but "Founders Kevin" with email fkevin@ is junk)
  // "founder" alone could be real, so only match when last_name is also junk-like

  const junkFirstQ = junkFirstNames.map(n => `'${n}'`).join(',');

  // Delete leads where first_name is clearly a website artifact
  const pass1Count = db.exec(`SELECT COUNT(*) FROM enrichment_leads WHERE LOWER(first_name) IN (${junkFirstQ})`);
  const pass1Num = pass1Count[0].values[0][0];
  console.log(`PASS 1: Junk first_names — ${pass1Num} leads to remove`);

  // Also grab "Founders X" pattern where email starts with f + lowercase last_name initial
  const foundersJunk = db.exec(
    `SELECT COUNT(*) FROM enrichment_leads WHERE LOWER(first_name) = 'founders' AND email LIKE 'f%'`
  );
  const foundersNum = foundersJunk[0].values[0][0];
  console.log(`  + "Founders X" pattern: ${foundersNum} leads`);

  // Delete junk first names
  db.run(`DELETE FROM enrichment_leads WHERE LOWER(first_name) IN (${junkFirstQ})`);
  // Delete "Founders X" where email = f + last_name pattern (scraped team page)
  db.run(`DELETE FROM enrichment_leads WHERE LOWER(first_name) = 'founders'`);
  // Delete "Founder X" with similar pattern
  db.run(`DELETE FROM enrichment_leads WHERE LOWER(first_name) = 'founder'`);

  const afterPass1 = db.exec('SELECT COUNT(*) FROM enrichment_leads')[0].values[0][0];
  const pass1Removed = before - afterPass1;
  totalRemoved += pass1Removed;
  console.log(`  Removed: ${pass1Removed}\n`);

  // ═══════════════════════════════════════════════════════════
  // PASS 2: Remove junk last_name entries
  // ═══════════════════════════════════════════════════════════
  const junkLastNames = [
    'vice', 'team', 'bio', 'more', 'leadership', 'read',
    'here', 'us', 'chairman', 'committee', 'relations',
    'ventures', 'advisors', 'advisory', 'investments'
  ];
  const junkLastQ = junkLastNames.map(n => `'${n}'`).join(',');

  const pass2Count = db.exec(`SELECT COUNT(*) FROM enrichment_leads WHERE LOWER(last_name) IN (${junkLastQ})`);
  console.log(`PASS 2: Junk last_names — ${pass2Count[0].values[0][0]} leads to remove`);

  db.run(`DELETE FROM enrichment_leads WHERE LOWER(last_name) IN (${junkLastQ})`);

  const afterPass2 = db.exec('SELECT COUNT(*) FROM enrichment_leads')[0].values[0][0];
  const pass2Removed = afterPass1 - afterPass2;
  totalRemoved += pass2Removed;
  console.log(`  Removed: ${pass2Removed}\n`);

  // ═══════════════════════════════════════════════════════════
  // PASS 3: Remove "there X" first_name pattern (scraped "Hi there" or similar)
  // ═══════════════════════════════════════════════════════════
  const thereCount = db.exec(`SELECT COUNT(*) FROM enrichment_leads WHERE LOWER(first_name) = 'there'`);
  console.log(`PASS 3: "there X" first_name — ${thereCount[0].values[0][0]} leads to remove`);

  db.run(`DELETE FROM enrichment_leads WHERE LOWER(first_name) = 'there'`);

  const afterPass3 = db.exec('SELECT COUNT(*) FROM enrichment_leads')[0].values[0][0];
  const pass3Removed = afterPass2 - afterPass3;
  totalRemoved += pass3Removed;
  console.log(`  Removed: ${pass3Removed}\n`);

  // ═══════════════════════════════════════════════════════════
  // PASS 4: Remove generic/non-personal email addresses
  // ═══════════════════════════════════════════════════════════
  const genericEmailPatterns = [
    "email LIKE 'info@%'",
    "email LIKE 'hello@%'",
    "email LIKE 'contact@%'",
    "email LIKE 'team@%'",
    "email LIKE 'careers@%'",
    "email LIKE 'jobs@%'",
    "email LIKE 'hr@%'",
    "email LIKE 'press@%'",
    "email LIKE 'media@%'",
    "email LIKE 'office@%'",
    "email LIKE 'general@%'",
    "email LIKE '%noreply%'",
    "email LIKE '%no-reply%'",
    "email LIKE '%donotreply%'",
    "email LIKE 'admin@%'",
    "email LIKE 'support@%'",
    "email LIKE '%enquir%@%'",
    "email LIKE 'feedback@%'",
    "email LIKE 'ninfo@%'",
  ];
  const genericWhere = genericEmailPatterns.join(' OR ');

  const pass4Count = db.exec(`SELECT COUNT(*) FROM enrichment_leads WHERE ${genericWhere}`);
  console.log(`PASS 4: Generic/non-personal emails — ${pass4Count[0].values[0][0]} leads to remove`);

  db.run(`DELETE FROM enrichment_leads WHERE ${genericWhere}`);

  const afterPass4 = db.exec('SELECT COUNT(*) FROM enrichment_leads')[0].values[0][0];
  const pass4Removed = afterPass3 - afterPass4;
  totalRemoved += pass4Removed;
  console.log(`  Removed: ${pass4Removed}\n`);

  // ═══════════════════════════════════════════════════════════
  // PASS 5: Remove name duplicates (keep highest scored)
  // ═══════════════════════════════════════════════════════════
  // Find all name duplicate groups, keep the one with highest score (or lowest id as tiebreaker)
  const dupeGroups = db.exec(
    `SELECT GROUP_CONCAT(id) as ids, GROUP_CONCAT(score) as scores
     FROM enrichment_leads
     WHERE first_name IS NOT NULL AND last_name IS NOT NULL
     GROUP BY LOWER(first_name), LOWER(last_name)
     HAVING COUNT(*) > 1`
  );

  const idsToDelete = [];
  if (dupeGroups.length) {
    for (const row of dupeGroups[0].values) {
      const ids = row[0].split(',').map(Number);
      const scores = row[1].split(',').map(Number);

      // Find the best one (highest score, then lowest id)
      let bestIdx = 0;
      for (let i = 1; i < ids.length; i++) {
        if (scores[i] > scores[bestIdx] || (scores[i] === scores[bestIdx] && ids[i] < ids[bestIdx])) {
          bestIdx = i;
        }
      }

      // Mark all others for deletion
      for (let i = 0; i < ids.length; i++) {
        if (i !== bestIdx) idsToDelete.push(ids[i]);
      }
    }
  }

  console.log(`PASS 5: Name duplicates — ${idsToDelete.length} excess rows to remove`);
  if (idsToDelete.length > 0) {
    // Delete in batches of 100
    for (let i = 0; i < idsToDelete.length; i += 100) {
      const batch = idsToDelete.slice(i, i + 100);
      db.run(`DELETE FROM enrichment_leads WHERE id IN (${batch.join(',')})`);
    }
  }

  const afterPass5 = db.exec('SELECT COUNT(*) FROM enrichment_leads')[0].values[0][0];
  const pass5Removed = afterPass4 - afterPass5;
  totalRemoved += pass5Removed;
  console.log(`  Removed: ${pass5Removed}\n`);

  // ═══════════════════════════════════════════════════════════
  // PASS 6: Remove leads with null/empty first AND last name
  // ═══════════════════════════════════════════════════════════
  const nullNameCount = db.exec(
    `SELECT COUNT(*) FROM enrichment_leads WHERE (first_name IS NULL OR first_name = '') AND (last_name IS NULL OR last_name = '')`
  );
  console.log(`PASS 6: Null/empty names — ${nullNameCount[0].values[0][0]} leads to remove`);

  db.run(`DELETE FROM enrichment_leads WHERE (first_name IS NULL OR first_name = '') AND (last_name IS NULL OR last_name = '')`);

  const afterPass6 = db.exec('SELECT COUNT(*) FROM enrichment_leads')[0].values[0][0];
  const pass6Removed = afterPass5 - afterPass6;
  totalRemoved += pass6Removed;
  console.log(`  Removed: ${pass6Removed}\n`);

  // ═══════════════════════════════════════════════════════════
  // PASS 7: Remove emails where local part is clearly auto-generated
  // Pattern: first initial of first_name + last_name = email local part for junk names
  // e.g., "Be Valuable" → bvaluable@, "Barlow Co" → bco@
  // ═══════════════════════════════════════════════════════════
  const suspiciousNames = db.exec(
    `SELECT id, first_name, last_name, email FROM enrichment_leads
     WHERE LENGTH(first_name) <= 3
     AND LOWER(SUBSTR(email, 1, 1)) = LOWER(SUBSTR(first_name, 1, 1))
     AND LOWER(last_name) IN ('co', 'it', 'valuable')`
  );
  if (suspiciousNames.length) {
    const suspIds = suspiciousNames[0].values.map(r => r[0]);
    console.log(`PASS 7: Short junk names (Be Valuable, Barlow Co, etc.) — ${suspIds.length} leads`);
    if (suspIds.length > 0) {
      db.run(`DELETE FROM enrichment_leads WHERE id IN (${suspIds.join(',')})`);
    }
  } else {
    console.log('PASS 7: Short junk names — 0 leads');
  }

  const afterPass7 = db.exec('SELECT COUNT(*) FROM enrichment_leads')[0].values[0][0];
  const pass7Removed = afterPass6 - afterPass7;
  totalRemoved += pass7Removed;
  console.log(`  Removed: ${pass7Removed}\n`);

  // ═══════════════════════════════════════════════════════════
  // SAVE
  // ═══════════════════════════════════════════════════════════
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);

  const after = db.exec('SELECT COUNT(*) FROM enrichment_leads')[0].values[0][0];

  // Also clean up orphaned enrichment_events and linkedin_dm_messages
  const orphanEvents = db.exec(
    `SELECT COUNT(*) FROM enrichment_events WHERE enrichment_lead_id NOT IN (SELECT id FROM enrichment_leads)`
  );
  const orphanEventsNum = orphanEvents[0]?.values[0][0] || 0;
  if (orphanEventsNum > 0) {
    db.run(`DELETE FROM enrichment_events WHERE enrichment_lead_id NOT IN (SELECT id FROM enrichment_leads)`);
    console.log(`Cleaned ${orphanEventsNum} orphaned enrichment_events`);
  }

  const orphanDMs = db.exec(
    `SELECT COUNT(*) FROM linkedin_dm_messages WHERE lead_id NOT IN (SELECT id FROM enrichment_leads)`
  );
  const orphanDMsNum = orphanDMs[0]?.values[0][0] || 0;
  if (orphanDMsNum > 0) {
    db.run(`DELETE FROM linkedin_dm_messages WHERE lead_id NOT IN (SELECT id FROM enrichment_leads)`);
    console.log(`Cleaned ${orphanDMsNum} orphaned linkedin_dm_messages`);
  }

  // Save again after orphan cleanup
  const data2 = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data2));

  // Final score distribution
  const scoreDist = db.exec(
    "SELECT CASE WHEN score >= 80 THEN 'A+ (80+)' WHEN score >= 60 THEN 'A (60-79)' WHEN score >= 40 THEN 'B (40-59)' WHEN score IS NOT NULL THEN 'C (<40)' ELSE 'Unscored' END as tier, COUNT(*) as cnt FROM enrichment_leads GROUP BY tier ORDER BY cnt DESC"
  );

  console.log('\n========================================');
  console.log('=== CLEANUP COMPLETE ===');
  console.log('========================================');
  console.log(`Before: ${before}`);
  console.log(`Removed: ${totalRemoved}`);
  console.log(`After: ${after}`);
  console.log(`\nScore distribution:`);
  if (scoreDist.length) scoreDist[0].values.forEach(r => console.log(`  ${r[0]}: ${r[1]}`));

  // Verify no more junk
  const remainingJunk = db.exec(
    `SELECT first_name, last_name, COUNT(*) as cnt FROM enrichment_leads
     WHERE LOWER(first_name) IN ('senior','executive','assistant','associate','meet','read','view','learn','there','founders','founder','founded','community','everyone','bio','click','our','the','about','contact','team')
     OR LOWER(last_name) IN ('vice','team','bio','more','leadership','read','here','us','chairman','committee','relations','ventures','advisors','advisory','investments')
     GROUP BY first_name, last_name ORDER BY cnt DESC LIMIT 10`
  );
  if (remainingJunk.length && remainingJunk[0].values.length > 0) {
    console.log('\nRemaining suspicious (review manually):');
    remainingJunk[0].values.forEach(r => console.log(`  ${r[0]} ${r[1]} (${r[2]})`));
  } else {
    console.log('\nNo remaining junk detected!');
  }
})();
