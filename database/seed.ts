import { getDb } from '../server/db';

async function seed() {
  const db = await getDb();

  db.run(`INSERT OR IGNORE INTO companies (name, type, color) VALUES ('Grand Park Capital', 'investment_fund', '#1e40af')`);
  db.run(`INSERT OR IGNORE INTO companies (name, type, color) VALUES ('Brand New Now', 'marketing', '#7c3aed')`);
  db.run(`INSERT OR IGNORE INTO companies (name, type, color) VALUES ('Personal', 'personal', '#059669')`);

  db.run(`INSERT OR IGNORE INTO integrations (name, type, status) VALUES ('instantly', 'api', 'active')`);
  db.run(`INSERT OR IGNORE INTO integrations (name, type, status) VALUES ('ghl', 'api', 'active')`);
  db.run(`INSERT OR IGNORE INTO integrations (name, type, status) VALUES ('openclaw', 'websocket', 'active')`);
  db.run(`INSERT OR IGNORE INTO integrations (name, type, status) VALUES ('meta_ads', 'api', 'disabled')`);

  // Sample agents
  db.run(`INSERT OR IGNORE INTO agents (name, company_id, type, status) VALUES ('Email Outreach Bot', 1, 'cloudcode', 'active')`);
  db.run(`INSERT OR IGNORE INTO agents (name, company_id, type, status) VALUES ('Lead Qualifier', 1, 'ghl_workflow', 'active')`);
  db.run(`INSERT OR IGNORE INTO agents (name, company_id, type, status) VALUES ('Brand Campaign Manager', 2, 'cloudcode', 'active')`);
  db.run(`INSERT OR IGNORE INTO agents (name, company_id, type, status) VALUES ('OpenClaw Assistant', null, 'openclaw_cron', 'active')`);

  await saveDb(db);
  console.log('Seed complete');
}

import { saveDb } from '../server/db';
seed();
