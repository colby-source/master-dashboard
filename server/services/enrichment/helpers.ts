import { queryOne, runSql } from '../../db';
import { EnrichmentConfig } from './types';

export function updateLead(leadId: number, updates: Record<string, any>): void {
  const sets = Object.keys(updates).map(k => `${k} = ?`);
  sets.push("updated_at = datetime('now')");
  const values = Object.values(updates);
  values.push(leadId);
  runSql(`UPDATE enrichment_leads SET ${sets.join(', ')} WHERE id = ?`, values);
}

export function logEvent(leadId: number | null, companyId: number, eventType: string, eventData: any): void {
  runSql(
    'INSERT INTO enrichment_events (enrichment_lead_id, company_id, event_type, event_data) VALUES (?, ?, ?, ?)',
    [leadId, companyId, eventType, eventData ? JSON.stringify(eventData) : null]
  );
}

export function getCompanyConfig(companyId: number): EnrichmentConfig | null {
  return queryOne('SELECT * FROM enrichment_config WHERE company_id = ?', [companyId]) as EnrichmentConfig | null;
}
