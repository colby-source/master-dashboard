import { queryAll } from '../db';
import { ghlService } from './ghl-service';
import { metaAdsService } from './meta-ads-service';

export interface ReportLead {
  name: string;
  email: string;
  investorType: string;
  grade: string;
  stage: string;
  dateAdded: string;
}

export interface GhlData {
  newLeads: ReportLead[];
  totalCount: number;
  byGrade: Record<string, number>;
  byStage: Record<string, number>;
}

export interface MetaData {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpl: number;
  leads: number;
  campaigns: Array<{ name: string; status: string; spend: number; leads: number }>;
}

export interface EnrichmentData {
  byStatus: Record<string, number>;
  byScore: Record<string, number>;
  byPush: Record<string, number>;
  total: number;
}

export interface ReportData {
  date: string;
  type: 'morning' | 'evening';
  ghl: GhlData;
  meta: MetaData | null;
  enrichment: EnrichmentData;
  summary: string;
}

const META_PIPELINE_ID = 'iJ5eS6fANsGVejDo6ubW';
const GPC_COMPANY_ID = 1;

class ReportDataService {

  async gatherReportData(type: 'morning' | 'evening'): Promise<ReportData> {
    const targetDate = type === 'morning'
      ? this.getYesterdayDate()
      : this.getTodayDate();

    const [ghl, meta, enrichment] = await Promise.allSettled([
      this.fetchGhlData(targetDate),
      this.fetchMetaData(type),
      this.fetchEnrichmentData(targetDate),
    ]);

    const ghlResult = ghl.status === 'fulfilled' ? ghl.value : this.emptyGhl();
    const metaResult = meta.status === 'fulfilled' ? meta.value : null;
    const enrichResult = enrichment.status === 'fulfilled' ? enrichment.value : this.emptyEnrichment();

    const summary = this.buildSummary(ghlResult, metaResult, enrichResult, type);

    return {
      date: targetDate,
      type,
      ghl: ghlResult,
      meta: metaResult,
      enrichment: enrichResult,
      summary,
    };
  }

  private async fetchGhlData(targetDate: string): Promise<GhlData> {
    const client = ghlService.getClient(GPC_COMPANY_ID);
    if (!client) return this.emptyGhl();

    // Search for meta-lead tagged contacts
    const result = await client.searchContacts(undefined, 100, 'meta-lead');
    const contacts = result?.contacts || [];

    // Filter by date — GHL dateAdded is ISO string
    const filtered = contacts.filter((c: any) => {
      const added = c.dateAdded || c.createdAt || '';
      return added.startsWith(targetDate);
    });

    const leads: ReportLead[] = filtered.map((c: any) => {
      const tags = c.tags || [];
      const grade = this.extractGrade(tags);
      return {
        name: [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown',
        email: c.email || '',
        investorType: this.extractInvestorType(tags),
        grade,
        stage: '', // will be enriched from opportunities
        dateAdded: c.dateAdded || c.createdAt || '',
      };
    });

    // Get pipeline opportunities for stage data
    const oppResult = await client.getOpportunities(META_PIPELINE_ID, 100);
    const opportunities = oppResult?.opportunities || [];

    // Map contact stages from pipeline
    const contactStageMap = new Map<string, string>();
    for (const opp of opportunities) {
      if (opp.contact?.id) {
        contactStageMap.set(opp.contact.id, opp.pipelineStageId || opp.stage?.name || 'Unknown');
      }
    }

    for (const lead of leads) {
      const contact = filtered.find((c: any) =>
        [c.firstName, c.lastName].filter(Boolean).join(' ') === lead.name
      );
      if (contact && contactStageMap.has(contact.id)) {
        lead.stage = contactStageMap.get(contact.id) || '';
      }
    }

    const byGrade: Record<string, number> = {};
    const byStage: Record<string, number> = {};
    for (const lead of leads) {
      byGrade[lead.grade || 'Ungraded'] = (byGrade[lead.grade || 'Ungraded'] || 0) + 1;
      byStage[lead.stage || 'New'] = (byStage[lead.stage || 'New'] || 0) + 1;
    }

    return { newLeads: leads, totalCount: leads.length, byGrade, byStage };
  }

  private async fetchMetaData(type: 'morning' | 'evening'): Promise<MetaData | null> {
    if (!metaAdsService.available) return null;

    const datePreset = type === 'morning' ? 'yesterday' : 'today';
    const [insights, campaigns] = await Promise.allSettled([
      metaAdsService.getAccountInsights(datePreset),
      metaAdsService.getCampaigns(20),
    ]);

    const acctInsights = insights.status === 'fulfilled' ? insights.value : null;
    const campaignList = campaigns.status === 'fulfilled' ? campaigns.value : [];

    if (!acctInsights) return null;

    const spend = parseFloat(acctInsights.spend || '0');
    const impressions = parseInt(acctInsights.impressions || '0');
    const clicks = parseInt(acctInsights.clicks || '0');
    const ctr = parseFloat(acctInsights.ctr || '0');

    // Extract lead actions
    const actions = acctInsights.actions || [];
    const leadAction = actions.find((a: any) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped');
    const leadCount = leadAction ? parseInt(leadAction.value || '0') : 0;
    const cpl = leadCount > 0 ? spend / leadCount : 0;

    const campaignData = campaignList
      .filter((c: any) => c.effective_status === 'ACTIVE')
      .map((c: any) => ({
        name: c.name,
        status: c.effective_status,
        spend: 0,
        leads: 0,
      }));

    return { spend, impressions, clicks, ctr, cpl, leads: leadCount, campaigns: campaignData };
  }

  private fetchEnrichmentData(targetDate: string): EnrichmentData {
    const rows = queryAll(
      `SELECT status, score_label, ghl_push_status FROM enrichment_leads
       WHERE source LIKE '%meta%' AND date(created_at) = ?`,
      [targetDate]
    );

    const byStatus: Record<string, number> = {};
    const byScore: Record<string, number> = {};
    const byPush: Record<string, number> = {};

    for (const r of rows) {
      byStatus[r.status || 'unknown'] = (byStatus[r.status || 'unknown'] || 0) + 1;
      if (r.score_label) {
        byScore[r.score_label] = (byScore[r.score_label] || 0) + 1;
      }
      byPush[r.ghl_push_status || 'pending'] = (byPush[r.ghl_push_status || 'pending'] || 0) + 1;
    }

    return { byStatus, byScore, byPush, total: rows.length };
  }

  private extractGrade(tags: string[]): string {
    for (const tag of tags) {
      const t = tag.toLowerCase();
      if (t.includes('a+') || t.includes('a-plus')) return 'A+';
      if (t.includes('grade-a') || t === 'a') return 'A';
      if (t.includes('grade-b') || t === 'b') return 'B';
    }
    return 'Ungraded';
  }

  private extractInvestorType(tags: string[]): string {
    for (const tag of tags) {
      const t = tag.toLowerCase();
      if (t.includes('accredited')) return 'Accredited';
      if (t.includes('qualified')) return 'Qualified Purchaser';
      if (t.includes('institutional')) return 'Institutional';
    }
    return 'Unknown';
  }

  private buildSummary(ghl: GhlData, meta: MetaData | null, enrichment: EnrichmentData, type: 'morning' | 'evening'): string {
    const parts: string[] = [];
    const label = type === 'morning' ? 'Yesterday' : 'Today';

    parts.push(`${label}: ${ghl.totalCount} new Meta lead${ghl.totalCount !== 1 ? 's' : ''}`);

    if (meta) {
      parts.push(`$${meta.spend.toFixed(2)} spent, ${meta.leads} ad leads`);
      if (meta.cpl > 0) parts.push(`$${meta.cpl.toFixed(2)} CPL`);
    }

    if (enrichment.total > 0) {
      const scored = enrichment.byStatus['scored'] || 0;
      parts.push(`${scored}/${enrichment.total} enriched & scored`);
    }

    return parts.join(' · ');
  }

  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  private getYesterdayDate(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  private emptyGhl(): GhlData {
    return { newLeads: [], totalCount: 0, byGrade: {}, byStage: {} };
  }

  private emptyEnrichment(): EnrichmentData {
    return { byStatus: {}, byScore: {}, byPush: {}, total: 0 };
  }
}

export const reportDataService = new ReportDataService();
