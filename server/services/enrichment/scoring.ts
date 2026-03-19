import { queryOne, saveDb } from '../../db';
import { claudeService } from '../claude-service';
import { wsServer } from '../../websocket/ws-server';
import { EnrichmentLead } from './types';
import { getCompanyConfig, updateLead, logEvent } from './helpers';

export async function scoreLead(leadId: number): Promise<boolean> {
  const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
  if (!lead || !lead.enrichment_data) return false;

  const companyConfig = getCompanyConfig(lead.company_id);

  try {
    const enrichmentData = JSON.parse(lead.enrichment_data);
    const classification = await claudeService.classifyLead(enrichmentData, {
      scoring_prompt: companyConfig?.scoring_prompt || undefined,
      score_threshold_hot: companyConfig?.score_threshold_hot || 80,
      score_threshold_warm: companyConfig?.score_threshold_warm || 50,
    });

    updateLead(leadId, {
      score: classification.score,
      score_label: classification.score_label,
      score_reasoning: classification.reasoning,
      tags: JSON.stringify(classification.tags),
      status: 'scored',
      scored_at: new Date().toISOString(),
      enrichment_data: JSON.stringify({
        ...enrichmentData,
        personalizations: classification.personalizations,
      }),
    });

    logEvent(leadId, lead.company_id, 'score_complete', {
      score: classification.score,
      score_label: classification.score_label,
    });

    saveDb();
    wsServer.broadcast({ type: 'enrichment_update', leadId, status: 'scored', score: classification.score, score_label: classification.score_label });
    return true;
  } catch (err: any) {
    console.error(`[Enrichment] scoreLead(${leadId}) error:`, err.message);
    logEvent(leadId, lead.company_id, 'error', { error: err.message, step: 'scoring' });
    return false;
  }
}

export function getStats(companyId?: number): any {
  const where = companyId ? 'WHERE company_id = ?' : '';
  const params = companyId ? [companyId] : [];

  const total = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where}`, params)?.count || 0;
  const pending = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} status = 'pending'`, params)?.count || 0;
  const enriched = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} status = 'enriched'`, params)?.count || 0;
  const scored = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} status = 'scored'`, params)?.count || 0;
  const failed = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} status = 'failed'`, params)?.count || 0;
  const meetingSet = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} status = 'meeting_set'`, params)?.count || 0;
  const subscriptionDocsSent = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} status = 'subscription_docs_sent'`, params)?.count || 0;
  const committed = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} status = 'committed'`, params)?.count || 0;
  const funded = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} status = 'funded'`, params)?.count || 0;
  const warmIntros = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} referral_source IS NOT NULL`, params)?.count || 0;

  const scoreHigh = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} score >= 80`, params)?.count || 0;
  const scoreMedium = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} score >= 50 AND score < 80`, params)?.count || 0;
  const scoreLow = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} score >= 20 AND score < 50`, params)?.count || 0;
  const scoreVeryLow = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} score < 20 AND score IS NOT NULL AND status IN ('scored')`, params)?.count || 0;
  const avgScore = queryOne(`SELECT AVG(score) as avg FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} score IS NOT NULL`, params)?.avg || 0;

  const awaitingApproval = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} instantly_push_status = 'awaiting_approval'`, params)?.count || 0;
  const excludedFromCold = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} instantly_push_status = 'excluded'`, params)?.count || 0;
  const pushedToInstantly = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} instantly_push_status = 'pushed'`, params)?.count || 0;
  const pushedToGhl = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} ghl_push_status = 'pushed'`, params)?.count || 0;
  const knownContacts = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} is_known_contact = 1`, params)?.count || 0;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const enrichedToday = queryOne(
    `SELECT COUNT(*) as count FROM enrichment_leads ${where ? where + ' AND' : 'WHERE'} enriched_at >= ?`,
    [...params, todayStart.toISOString()]
  )?.count || 0;

  return {
    total, pending, enriched, scored, failed,
    scoreHigh, scoreMedium, scoreLow, scoreVeryLow, avgScore,
    awaitingApproval, excludedFromCold, pushedToInstantly, pushedToGhl,
    knownContacts, enrichedToday,
    meetingSet, subscriptionDocsSent, committed, funded, warmIntros,
  };
}

export function getAutoReplyStats(companyId?: number): any {
  const where = companyId ? 'WHERE company_id = ?' : '';
  const params = companyId ? [companyId] : [];

  const totalThreads = queryOne(`SELECT COUNT(*) as count FROM reply_threads ${where}`, params)?.count || 0;
  const activeThreads = queryOne(`SELECT COUNT(*) as count FROM reply_threads ${where ? where + ' AND' : 'WHERE'} thread_status = 'active'`, params)?.count || 0;
  const escalatedThreads = queryOne(`SELECT COUNT(*) as count FROM reply_threads ${where ? where + ' AND' : 'WHERE'} thread_status = 'escalated'`, params)?.count || 0;
  const convertedThreads = queryOne(`SELECT COUNT(*) as count FROM reply_threads ${where ? where + ' AND' : 'WHERE'} thread_status = 'converted'`, params)?.count || 0;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const autoRepliesToday = queryOne(
    `SELECT COUNT(*) as count FROM reply_messages rm JOIN reply_threads rt ON rm.thread_id = rt.id ${where ? 'AND rt.' + where.slice(6) : ''} WHERE rm.direction = 'outbound' AND rm.generated_by = 'claude' AND rm.sent = 1 AND rm.created_at >= ?`,
    [...params, todayStart.toISOString()]
  )?.count || 0;

  const pendingReplies = queryOne(
    `SELECT COUNT(*) as count FROM reply_messages WHERE sent = 0 AND direction = 'outbound'`
  )?.count || 0;

  return {
    totalThreads, activeThreads, escalatedThreads, convertedThreads,
    autoRepliesToday, pendingReplies,
  };
}
