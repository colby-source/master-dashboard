/**
 * Sync leads from Instantly "GPF-II AI Personalized" campaign back to DB.
 * Marks leads that are already in Instantly so the migration script skips them.
 */
const axios = require('axios');
const initSqlJs = require('sql.js');
const fs = require('fs');
require('dotenv').config();

const NEW_CAMPAIGN = '2e3af84a-8f6f-4446-981c-f10bb2348216';
const DB_PATH = process.env.DB_PATH || './data/master-dashboard.db';

const api = axios.create({
  baseURL: 'https://api.instantly.ai/api/v2',
  headers: { 'Authorization': 'Bearer ' + process.env.INSTANTLY_API_KEY, 'Content-Type': 'application/json' },
  timeout: 30000
});

async function main() {
  // Load DB
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  try { db.run('ALTER TABLE enrichment_leads ADD COLUMN generated_email_sequence TEXT'); } catch {}

  // Fetch all leads from new campaign in Instantly
  console.log('Fetching leads from Instantly campaign...');
  let allEmails = [];
  let startingAfter = null;
  let pages = 0;

  while (true) {
    const body = { campaign_id: NEW_CAMPAIGN, limit: 100 };
    if (startingAfter) body.starting_after = startingAfter;

    const { data } = await api.post('/leads/list', body);
    const items = data.items || [];
    if (items.length === 0) break;

    for (const item of items) {
      if (item.campaign === NEW_CAMPAIGN) {
        allEmails.push(item.email);
      }
    }
    pages++;
    if (pages % 10 === 0) console.log('  Page ' + pages + ': ' + allEmails.length + ' leads so far');

    if (!data.next_starting_after) break;
    startingAfter = data.next_starting_after;
  }

  console.log('Total leads in Instantly campaign: ' + allEmails.length);

  // Mark these leads in DB as having sequences
  let updated = 0;
  const stmt = db.prepare('SELECT id, generated_email_sequence FROM enrichment_leads WHERE email = ? AND company_id = 1');
  const updateSql = 'UPDATE enrichment_leads SET instantly_campaign_id = ?, generated_email_sequence = COALESCE(generated_email_sequence, ?), updated_at = datetime(\'now\') WHERE id = ?';

  for (const email of allEmails) {
    stmt.bind([email]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      if (!row.generated_email_sequence) {
        // Mark as done with a placeholder sequence so migration skips it
        const updateStmt = db.prepare(updateSql);
        updateStmt.bind([NEW_CAMPAIGN, JSON.stringify({ synced_from_instantly: true, steps: [] }), row.id]);
        updateStmt.step();
        updateStmt.free();
        updated++;
      }
    }
    stmt.reset();
  }
  stmt.free();

  // Save
  const data2 = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data2));

  console.log('Updated ' + updated + ' leads in DB (marked as already in Instantly)');

  // Check remaining
  const remaining = db.exec("SELECT COUNT(*) FROM enrichment_leads WHERE company_id = 1 AND source = 'csv_import' AND status = 'scored' AND enrichment_data IS NOT NULL AND generated_email_sequence IS NULL");
  console.log('Remaining leads needing migration: ' + (remaining[0]?.values[0][0] || 0));
}

main().catch(e => { console.error(e.message); process.exit(1); });
