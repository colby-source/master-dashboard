import { ghlService } from '../services/ghl-service';
import { runSql, queryOne } from '../db';
import { saveDb } from '../db';
import { createLogger } from '../utils/logger';
const log = createLogger('ghl-sync');

class GhlSync {
  private accessAlertSent = new Set<number>();

  async sync() {
    log.info('[Sync:GHL] Starting...');
    let totalPipelines = 0;
    let totalWorkflows = 0;

    const clients = ghlService.getAllClients();
    if (clients.length === 0) {
      log.info('[Sync:GHL] No GHL locations configured, skipping');
      return;
    }

    for (const client of clients) {
      const companyId = client.location.companyId;
      const label = client.location.name;

      // Sync pipelines as metrics
      const pipelineData = await client.getPipelines();

      // Check for access issues after first API call
      if (!client.hasAccess) {
        if (!this.accessAlertSent.has(companyId)) {
          this.accessAlertSent.add(companyId);
          try {
            runSql(
              `INSERT INTO alerts (company_id, severity, source, message) VALUES (?, 'warning', 'ghl', ?)`,
              [companyId, `GHL connection failed for ${label}: ${client.lastError}. Fix: Go to GHL → Settings → Integrations → Private Integrations → Edit your integration → Enable scopes: contacts.readonly, opportunities.readonly, workflows.readonly`]
            );
          } catch (_e) { /* ignore if db not ready */ }
        }
        log.info(`[Sync:GHL:${label}] Skipping — no access (${client.lastError})`);
        continue;
      }

      // Clear access alert if previously sent and now working
      this.accessAlertSent.delete(companyId);

      const pipelines = pipelineData?.pipelines || [];

      for (const pipeline of pipelines) {
        const opps = await client.getOpportunities(pipeline.id);
        const opportunities = opps?.opportunities || [];
        const totalValue = opportunities.reduce((sum: number, o: any) => sum + (o.monetaryValue || 0), 0);

        runSql(
          `INSERT INTO metrics (company_id, metric_type, value) VALUES (?, 'pipeline_value', ?)`,
          [companyId, totalValue]
        );
      }
      totalPipelines += pipelines.length;

      // Sync workflows as agents
      const workflowData = await client.getWorkflows();
      const workflows = workflowData?.workflows || [];

      for (const wf of workflows) {
        const existing = queryOne('SELECT id FROM agents WHERE external_id = ? AND type = ?', [wf.id, 'ghl_workflow']);
        if (!existing) {
          runSql(
            `INSERT INTO agents (external_id, name, company_id, type, status) VALUES (?, ?, ?, 'ghl_workflow', ?)`,
            [wf.id, wf.name, companyId, wf.status === 'published' ? 'active' : 'paused']
          );
        } else {
          runSql(
            `UPDATE agents SET name = ?, status = ?, updated_at = datetime('now') WHERE external_id = ? AND type = 'ghl_workflow'`,
            [wf.name, wf.status === 'published' ? 'active' : 'paused', wf.id]
          );
        }
      }
      totalWorkflows += workflows.length;

      // Contact count metric
      const contactData = await client.searchContacts(undefined, 1);
      const contactTotal = contactData?.meta?.total || contactData?.total || 0;
      if (contactTotal) {
        runSql(
          `INSERT INTO metrics (company_id, metric_type, value) VALUES (?, 'total_contacts', ?)`,
          [companyId, contactTotal]
        );
      }

      log.info(`[Sync:GHL:${label}] ${pipelines.length} pipelines, ${workflows.length} workflows, ${contactTotal} contacts`);
    }

    saveDb();
    log.info(`[Sync:GHL] Total: ${totalPipelines} pipelines, ${totalWorkflows} workflows`);
  }
}

export const ghlSync = new GhlSync();
