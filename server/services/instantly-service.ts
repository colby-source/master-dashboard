import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

class InstantlyService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.instantlyBaseUrl,
      headers: {
        'Authorization': `Bearer ${config.instantlyApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  // ── Campaigns ─────────────────────────────────────────────
  async listCampaigns(opts?: { limit?: number; search?: string; status?: number; starting_after?: string }): Promise<any> {
    try {
      const { data } = await this.client.get('/campaigns', { params: { limit: opts?.limit ?? 100, ...opts } });
      return data;
    } catch (err: any) {
      console.error('[Instantly] listCampaigns error:', err.message);
      return { items: [] };
    }
  }

  async getCampaign(campaignId: string): Promise<any> {
    try {
      const { data } = await this.client.get(`/campaigns/${campaignId}`);
      return data;
    } catch (err: any) {
      console.error('[Instantly] getCampaign error:', err.message);
      return null;
    }
  }

  async createCampaign(payload: { name: string; sequences?: any[]; schedule?: any }): Promise<any> {
    const { data } = await this.client.post('/campaigns', payload);
    return data;
  }

  async updateCampaign(campaignId: string, updates: any): Promise<any> {
    const { data } = await this.client.patch(`/campaigns/${campaignId}`, updates);
    return data;
  }

  async deleteCampaign(campaignId: string): Promise<any> {
    const { data } = await this.client.delete(`/campaigns/${campaignId}`);
    return data;
  }

  async pauseCampaign(campaignId: string): Promise<any> {
    const { data } = await this.client.post(`/campaigns/${campaignId}/pause`, {});
    return data;
  }

  async activateCampaign(campaignId: string): Promise<any> {
    const { data } = await this.client.post(`/campaigns/${campaignId}/activate`, {});
    return data;
  }

  async duplicateCampaign(campaignId: string): Promise<any> {
    const { data } = await this.client.post(`/campaigns/${campaignId}/duplicate`, {});
    return data;
  }

  async shareCampaign(campaignId: string): Promise<any> {
    const { data } = await this.client.post(`/campaigns/${campaignId}/share`, {});
    return data;
  }

  async exportCampaign(campaignId: string): Promise<any> {
    const { data } = await this.client.post(`/campaigns/${campaignId}/export`, {});
    return data;
  }

  async getCampaignSendingStatus(campaignId: string): Promise<any> {
    try {
      const { data } = await this.client.get(`/campaigns/${campaignId}/sending-status`);
      return data;
    } catch (err: any) {
      console.error('[Instantly] getSendingStatus error:', err.message);
      return null;
    }
  }

  async searchCampaignsByContact(email: string): Promise<any> {
    try {
      const { data } = await this.client.get('/campaigns/search-by-contact', { params: { email } });
      return data;
    } catch (err: any) {
      console.error('[Instantly] searchByContact error:', err.message);
      return [];
    }
  }

  async countLaunchedCampaigns(): Promise<any> {
    try {
      const { data } = await this.client.get('/campaigns/count-launched');
      return data;
    } catch (err: any) {
      console.error('[Instantly] countLaunched error:', err.message);
      return null;
    }
  }

  // ── Campaign Subsequences ───────────────────────────────────
  async listSubsequences(campaignId: string): Promise<any[]> {
    try {
      const { data } = await this.client.get('/campaign-subsequences', { params: { campaign_id: campaignId } });
      return data?.items ?? data ?? [];
    } catch (err: any) {
      console.error('[Instantly] listSubsequences error:', err.message);
      return [];
    }
  }

  async createSubsequence(campaignId: string, payload: any): Promise<any> {
    const { data } = await this.client.post('/campaign-subsequences', { campaign_id: campaignId, ...payload });
    return data;
  }

  async pauseSubsequence(subsequenceId: string): Promise<any> {
    const { data } = await this.client.post(`/campaign-subsequences/${subsequenceId}/pause`, {});
    return data;
  }

  async resumeSubsequence(subsequenceId: string): Promise<any> {
    const { data } = await this.client.post(`/campaign-subsequences/${subsequenceId}/resume`, {});
    return data;
  }

  // ── Accounts (email sending accounts) ─────────────────────
  async listAccounts(opts?: { limit?: number; search?: string; starting_after?: string }): Promise<any> {
    try {
      const { data } = await this.client.get('/accounts', { params: { limit: opts?.limit ?? 100, ...opts } });
      return data;
    } catch (err: any) {
      console.error('[Instantly] listAccounts error:', err.message);
      return { items: [] };
    }
  }

  // Enriched account list with warmup scores from individual account endpoints
  async listAccountsWithWarmup(opts?: { limit?: number; search?: string; starting_after?: string }): Promise<any> {
    const listResult = await this.listAccounts(opts);
    const items: any[] = listResult?.items ?? listResult ?? [];

    // Fetch individual account details in parallel (has warmup settings, tracking domain, etc.)
    const enriched = await Promise.all(
      items.map(async (acct) => {
        try {
          const detail = await this.getAccount(acct.email);
          if (!detail) return acct;

          const warmupStarted = detail.timestamp_warmup_start ? new Date(detail.timestamp_warmup_start) : null;
          const warmupAgeDays = warmupStarted ? Math.floor((Date.now() - warmupStarted.getTime()) / (1000 * 60 * 60 * 24)) : 0;
          const warmupLimit = detail.warmup?.limit ? Number(detail.warmup.limit) : 0;
          const warmupIncrement = detail.warmup?.increment ? Number(detail.warmup.increment) : 0;

          // Calculate expected daily warmup volume from settings (API doesn't expose actual counts)
          const expectedDailyVolume = warmupIncrement > 0
            ? Math.min(warmupAgeDays * warmupIncrement, warmupLimit)
            : 0;
          const atCapacity = warmupLimit > 0 && expectedDailyVolume >= warmupLimit;
          const volumePercent = warmupLimit > 0 ? Math.round((expectedDailyVolume / warmupLimit) * 100) : 0;

          // Readiness: must be warming for 14+ days AND ramped to full capacity
          const isReady = warmupAgeDays >= 14 && atCapacity;
          const readinessStatus = isReady ? 'READY' : warmupAgeDays > 0 ? 'WARMING' : 'COLD';

          return {
            ...acct,
            warmup_limit: warmupLimit,
            warmup_increment: warmupIncrement,
            warmup_reply_rate_setting: detail.warmup?.reply_rate ?? null,
            warmup_started: detail.timestamp_warmup_start ?? null,
            warmup_age_days: warmupAgeDays,
            expected_daily_volume: expectedDailyVolume,
            volume_percent: volumePercent,
            at_capacity: atCapacity,
            warmup_ready: isReady,
            readiness_status: readinessStatus,
            tracking_domain: detail.tracking_domain_name ?? null,
            tracking_domain_status: detail.tracking_domain_status ?? null,
            daily_limit: detail.daily_limit ?? acct.daily_limit,
            enable_slow_ramp: detail.enable_slow_ramp ?? false,
          };
        } catch {
          return acct;
        }
      })
    );

    return { ...listResult, items: enriched };
  }

  // Back-compat alias
  async searchAccounts(query?: string, limit = 50): Promise<any[]> {
    const result = await this.listAccounts({ limit, search: query });
    return result?.items ?? result ?? [];
  }

  async getAccount(email: string): Promise<any> {
    try {
      const { data } = await this.client.get(`/accounts/${encodeURIComponent(email)}`);
      return data;
    } catch (err: any) {
      console.error('[Instantly] getAccount error:', err.message);
      return null;
    }
  }

  // Back-compat alias
  async getAccountStatus(email: string): Promise<any> {
    return this.getAccount(email);
  }

  async pauseAccount(email: string): Promise<any> {
    const { data } = await this.client.post(`/accounts/${encodeURIComponent(email)}/pause`, {});
    return data;
  }

  async resumeAccount(email: string): Promise<any> {
    const { data } = await this.client.post(`/accounts/${encodeURIComponent(email)}/resume`, {});
    return data;
  }

  async deleteAccount(email: string): Promise<any> {
    const { data } = await this.client.delete(`/accounts/${encodeURIComponent(email)}`, {
      headers: { 'Content-Type': undefined },
    });
    return data;
  }

  async testAccountVitals(email: string): Promise<any> {
    try {
      const { data } = await this.client.post('/accounts/test-vitals', { email });
      return data;
    } catch (err: any) {
      console.error('[Instantly] testVitals error:', err.message);
      return null;
    }
  }

  async markAccountFixed(email: string): Promise<any> {
    const { data } = await this.client.post('/accounts/mark-fixed', { email });
    return data;
  }

  async enableWarmup(emails: string[]): Promise<any> {
    const { data } = await this.client.post('/accounts/warmup/enable', { emails });
    return data;
  }

  async enableWarmupAll(): Promise<any> {
    const { data } = await this.client.post('/accounts/warmup/enable', { include_all_emails: true });
    return data;
  }

  async disableWarmup(emails: string[]): Promise<any> {
    const { data } = await this.client.post('/accounts/warmup/disable', { emails });
    return data;
  }

  async getWarmupAnalytics(opts?: { account_id?: string; limit?: number }): Promise<any> {
    try {
      const { data } = await this.client.get('/accounts/warmup-analytics', { params: opts });
      return data;
    } catch (err: any) {
      console.error('[Instantly] warmupAnalytics error:', err.message);
      return null;
    }
  }

  async getAccountCampaignMapping(email: string): Promise<any> {
    try {
      const { data } = await this.client.get(`/account-campaign-mappings/${encodeURIComponent(email)}`);
      return data;
    } catch (err: any) {
      console.error('[Instantly] accountCampaignMapping error:', err.message);
      return null;
    }
  }

  // ── Leads ─────────────────────────────────────────────────
  async listLeads(opts: { campaign_id?: string; list_id?: string; limit?: number; starting_after?: string; search?: string }): Promise<any> {
    try {
      const { data } = await this.client.get('/leads', { params: { limit: opts.limit ?? 100, ...opts } });
      return data;
    } catch (err: any) {
      console.error('[Instantly] listLeads error:', err.message);
      return { items: [] };
    }
  }

  // Back-compat alias
  async getCampaignLeads(campaignId: string, limit = 100): Promise<any[]> {
    const result = await this.listLeads({ campaign_id: campaignId, limit });
    return result?.items ?? result ?? [];
  }

  async getLead(email: string, campaignId?: string): Promise<any> {
    try {
      const { data } = await this.client.get(`/leads/${encodeURIComponent(email)}`, {
        params: campaignId ? { campaign_id: campaignId } : undefined,
      });
      return data;
    } catch (err: any) {
      console.error('[Instantly] getLead error:', err.message);
      return null;
    }
  }

  // Back-compat alias
  async getLeadStatus(email: string, campaignId: string): Promise<any> {
    return this.getLead(email, campaignId);
  }

  async createLead(lead: { email: string; first_name?: string; last_name?: string; company_name?: string; phone?: string; website?: string; custom_variables?: any; campaign?: string; list_id?: string }): Promise<any> {
    const { data } = await this.client.post('/leads', lead);
    return data;
  }

  async updateLead(email: string, updates: any): Promise<any> {
    const { data } = await this.client.patch(`/leads/${encodeURIComponent(email)}`, updates);
    return data;
  }

  async deleteLead(email: string, campaignId?: string): Promise<any> {
    const { data } = await this.client.delete(`/leads/${encodeURIComponent(email)}`, {
      params: campaignId ? { campaign_id: campaignId } : undefined,
    });
    return data;
  }

  async addLeadsToCampaign(campaignId: string, leads: Array<{ email: string; first_name?: string; last_name?: string; company_name?: string; [key: string]: any }>): Promise<any> {
    const results: any[] = [];
    for (const lead of leads) {
      try {
        const { data } = await this.client.post('/leads', {
          ...lead,
          campaign: campaignId,
          skip_if_in_campaign: true,
        });
        results.push(data);
      } catch (err: any) {
        console.error(`[Instantly] addLead ${lead.email} error:`, err.message);
        results.push({ email: lead.email, error: err.message });
      }
    }
    return results;
  }

  async bulkDeleteLeads(payload: { campaign_id?: string; list_id?: string; emails?: string[]; delete_all?: boolean }): Promise<any> {
    const { data } = await this.client.post('/leads/bulk-delete', payload);
    return data;
  }

  async moveLeads(payload: { from_campaign_id?: string; to_campaign_id?: string; emails?: string[] }): Promise<any> {
    const { data } = await this.client.post('/leads/move', payload);
    return data;
  }

  async updateLeadInterestStatus(email: string, campaignId: string, interestStatus: number): Promise<any> {
    const { data } = await this.client.post('/leads/update-interest-status', {
      email,
      campaign_id: campaignId,
      interest_status: interestStatus,
    });
    return data;
  }

  // ── Lead Lists ──────────────────────────────────────────────
  async listLeadLists(opts?: { limit?: number; starting_after?: string }): Promise<any> {
    try {
      const { data } = await this.client.get('/lead-lists', { params: opts });
      return data;
    } catch (err: any) {
      console.error('[Instantly] listLeadLists error:', err.message);
      return { items: [] };
    }
  }

  async createLeadList(name: string): Promise<any> {
    const { data } = await this.client.post('/lead-lists', { name });
    return data;
  }

  async deleteLeadList(id: string): Promise<any> {
    const { data } = await this.client.delete(`/lead-lists/${id}`);
    return data;
  }

  // ── Lead Labels ─────────────────────────────────────────────
  async listLeadLabels(): Promise<any[]> {
    try {
      const { data } = await this.client.get('/lead-labels');
      return data?.items ?? data ?? [];
    } catch (err: any) {
      console.error('[Instantly] listLeadLabels error:', err.message);
      return [];
    }
  }

  async createLeadLabel(name: string, color?: string): Promise<any> {
    const { data } = await this.client.post('/lead-labels', { name, color });
    return data;
  }

  // ── Emails (Unibox) ────────────────────────────────────────
  async listEmails(opts?: {
    limit?: number; starting_after?: string; search?: string;
    campaign_id?: string; is_unread?: boolean; preview_only?: boolean;
    email_type?: string; sort_order?: string; i_status?: number;
    eaccount?: string; lead?: string;
  }): Promise<any> {
    try {
      const { data } = await this.client.get('/emails', { params: { limit: opts?.limit ?? 50, ...opts } });
      return data;
    } catch (err: any) {
      console.error('[Instantly] listEmails error:', err.message);
      return { items: [] };
    }
  }

  async getEmail(emailId: string): Promise<any> {
    try {
      const { data } = await this.client.get(`/emails/${emailId}`);
      return data;
    } catch (err: any) {
      console.error('[Instantly] getEmail error:', err.message);
      return null;
    }
  }

  async replyToEmail(emailId: string, body: { body: string; eaccount?: string }): Promise<any> {
    const { data } = await this.client.post(`/emails/${emailId}/reply`, body);
    return data;
  }

  async forwardEmail(emailId: string, to: string, body?: string): Promise<any> {
    const { data } = await this.client.post(`/emails/${emailId}/forward`, { to, body });
    return data;
  }

  async markEmailRead(emailId: string): Promise<any> {
    const { data } = await this.client.post(`/emails/${emailId}/mark-read`, {});
    return data;
  }

  async deleteEmail(emailId: string): Promise<any> {
    const { data } = await this.client.delete(`/emails/${emailId}`);
    return data;
  }

  async countUnreadEmails(): Promise<any> {
    try {
      const { data } = await this.client.get('/emails/count-unread');
      return data;
    } catch (err: any) {
      console.error('[Instantly] countUnread error:', err.message);
      return { count: 0 };
    }
  }

  async sendTestEmail(payload: { from: string; to: string; subject: string; body: string }): Promise<any> {
    const { data } = await this.client.post('/emails/send-test', payload);
    return data;
  }

  // ── Analytics ───────────────────────────────────────────────
  async getCampaignAnalytics(campaignId?: string, opts?: { start_date?: string; end_date?: string }): Promise<any> {
    try {
      const { data } = await this.client.get('/campaigns/analytics', {
        params: { id: campaignId, ...opts },
      });
      return data;
    } catch (err: any) {
      console.error('[Instantly] getCampaignAnalytics error:', err.message);
      return null;
    }
  }

  async getCampaignAnalyticsOverview(campaignId?: string): Promise<any> {
    try {
      const { data } = await this.client.get('/campaigns/analytics/overview', {
        params: campaignId ? { id: campaignId } : undefined,
      });
      return data;
    } catch (err: any) {
      console.error('[Instantly] analyticsOverview error:', err.message);
      return null;
    }
  }

  async getDailyCampaignAnalytics(campaignId: string, opts?: { start_date?: string; end_date?: string }): Promise<any> {
    try {
      const { data } = await this.client.get('/campaigns/analytics/daily', {
        params: { id: campaignId, ...opts },
      });
      return data;
    } catch (err: any) {
      console.error('[Instantly] dailyAnalytics error:', err.message);
      return null;
    }
  }

  async getCampaignStepsAnalytics(campaignId: string): Promise<any> {
    try {
      const { data } = await this.client.get('/campaigns/analytics/steps', {
        params: { id: campaignId },
      });
      return data;
    } catch (err: any) {
      console.error('[Instantly] stepsAnalytics error:', err.message);
      return null;
    }
  }

  async getDailyAccountAnalytics(accountEmail: string, opts?: { start_date?: string; end_date?: string }): Promise<any> {
    try {
      const { data } = await this.client.get('/accounts/analytics/daily', {
        params: { account_id: accountEmail, ...opts },
      });
      return data;
    } catch (err: any) {
      console.error('[Instantly] dailyAccountAnalytics error:', err.message);
      return null;
    }
  }

  // ── Email Verification ────────────────────────────────────
  async verifyEmail(email: string): Promise<any> {
    try {
      const { data } = await this.client.post('/email-verification', { email });
      return data;
    } catch (err: any) {
      console.error('[Instantly] verifyEmail error:', err.message);
      return null;
    }
  }

  async checkVerificationStatus(email: string): Promise<any> {
    try {
      const { data } = await this.client.get('/email-verification/status', { params: { email } });
      return data;
    } catch (err: any) {
      console.error('[Instantly] checkVerification error:', err.message);
      return null;
    }
  }

  // ── Block List ──────────────────────────────────────────────
  async listBlockListEntries(opts?: { limit?: number; starting_after?: string }): Promise<any> {
    try {
      const { data } = await this.client.get('/block-list-entries', { params: opts });
      return data;
    } catch (err: any) {
      console.error('[Instantly] listBlockList error:', err.message);
      return { items: [] };
    }
  }

  async addBlockListEntry(entry: string, type?: string): Promise<any> {
    const { data } = await this.client.post('/block-list-entries', { entry, type });
    return data;
  }

  async deleteBlockListEntry(id: string): Promise<any> {
    const { data } = await this.client.delete(`/block-list-entries/${id}`);
    return data;
  }

  // ── Custom Tags ─────────────────────────────────────────────
  async listCustomTags(): Promise<any[]> {
    try {
      const { data } = await this.client.get('/custom-tags');
      return data?.items ?? data ?? [];
    } catch (err: any) {
      console.error('[Instantly] listCustomTags error:', err.message);
      return [];
    }
  }

  async createCustomTag(name: string): Promise<any> {
    const { data } = await this.client.post('/custom-tags', { name });
    return data;
  }

  async toggleTagResource(tagId: string, resourceId: string, resourceType: string): Promise<any> {
    const { data } = await this.client.post('/custom-tags/toggle-resource', {
      tag_id: tagId,
      resource_id: resourceId,
      resource_type: resourceType,
    });
    return data;
  }

  // ── Email Templates ─────────────────────────────────────────
  async listEmailTemplates(): Promise<any[]> {
    try {
      const { data } = await this.client.get('/email-templates');
      return data?.items ?? data ?? [];
    } catch (err: any) {
      console.error('[Instantly] listTemplates error:', err.message);
      return [];
    }
  }

  // ── Webhooks ────────────────────────────────────────────────
  async listWebhooks(): Promise<any[]> {
    try {
      const { data } = await this.client.get('/webhooks');
      return data?.items ?? data ?? [];
    } catch (err: any) {
      console.error('[Instantly] listWebhooks error:', err.message);
      return [];
    }
  }

  async createWebhook(payload: { url: string; event_type: string; campaign_id?: string }): Promise<any> {
    const { data } = await this.client.post('/webhooks', payload);
    return data;
  }

  async deleteWebhook(id: string): Promise<any> {
    const { data } = await this.client.delete(`/webhooks/${id}`);
    return data;
  }

  async listWebhookEventTypes(): Promise<any[]> {
    try {
      const { data } = await this.client.get('/webhooks/event-types');
      return data ?? [];
    } catch (err: any) {
      console.error('[Instantly] webhookEventTypes error:', err.message);
      return [];
    }
  }

  // ── Inbox Placement Testing ─────────────────────────────────
  async listInboxPlacementTests(): Promise<any[]> {
    try {
      const { data } = await this.client.get('/inbox-placement-tests');
      return data?.items ?? data ?? [];
    } catch (err: any) {
      console.error('[Instantly] listIPTests error:', err.message);
      return [];
    }
  }

  async createInboxPlacementTest(payload: { name: string; from_email: string; subject: string; body: string }): Promise<any> {
    const { data } = await this.client.post('/inbox-placement-tests', payload);
    return data;
  }

  // ── Workspace ───────────────────────────────────────────────
  async getWorkspace(): Promise<any> {
    try {
      const { data } = await this.client.get('/workspace');
      return data;
    } catch (err: any) {
      console.error('[Instantly] getWorkspace error:', err.message);
      return null;
    }
  }

  async getWorkspacePlan(): Promise<any> {
    try {
      const { data } = await this.client.get('/workspace-billing/plan');
      return data;
    } catch (err: any) {
      console.error('[Instantly] getWorkspacePlan error:', err.message);
      return null;
    }
  }

  // ── Campaign Template Configuration ─────────────────────────
  /**
   * Configure a campaign's email steps to use personalized variable templates.
   * Each step's subject becomes {{personalized_subject_N}} and body becomes {{personalized_body_N}}.
   * This is the key link between Claude-generated emails and Instantly delivery.
   */
  async configurePersonalizedTemplates(
    campaignId: string,
    opts?: {
      stepCount?: number;
      delays?: number[];
    },
  ): Promise<{ success: boolean; steps: number; message: string }> {
    const stepCount = opts?.stepCount ?? 4;
    const delays = opts?.delays ?? [0, 2, 4, 7]; // days between steps

    try {
      // First get current campaign to understand its state
      const campaign = await this.getCampaign(campaignId);
      if (!campaign) {
        return { success: false, steps: 0, message: 'Campaign not found' };
      }

      // Build the sequence with personalized variable placeholders
      const steps = Array.from({ length: stepCount }, (_, i) => ({
        subject: `{{personalized_subject_${i + 1}}}`,
        body: `{{personalized_body_${i + 1}}}`,
        type: 'email' as const,
        delay: delays[i] ?? (i * 3),
        variant: 'a',
      }));

      // Update campaign with the personalized template sequence
      const result = await this.updateCampaign(campaignId, {
        sequences: [{ steps }],
      });

      if (result) {
        console.log(
          `[Instantly] Configured ${stepCount}-step personalized templates for campaign ${campaignId}`,
        );
        return {
          success: true,
          steps: stepCount,
          message: `Campaign configured with ${stepCount} personalized template steps`,
        };
      }

      return { success: false, steps: 0, message: 'Campaign update returned no result' };
    } catch (err: any) {
      console.error('[Instantly] configurePersonalizedTemplates error:', err.message);
      return { success: false, steps: 0, message: err.message };
    }
  }
}

export const instantlyService = new InstantlyService();
