const BASE = '/api';

async function request<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  return entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : '';
}

export const api = {
  getCompanies: () => request('/companies'),
  getSummary: () => request('/metrics/summary'),
  getMetrics: (companyId?: number) => request(`/metrics${companyId ? `?company_id=${companyId}` : ''}`),
  getCampaigns: (companyId?: number) => request(`/campaigns${companyId ? `?company_id=${companyId}` : ''}`),
  pauseCampaign: (id: number) => request(`/campaigns/${id}/pause`, { method: 'POST' }),
  activateCampaign: (id: number) => request(`/campaigns/${id}/activate`, { method: 'POST' }),
  getCampaignDetail: (id: number) => request(`/campaigns/${id}/detail`),
  getTasks: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return request(`/tasks${q}`);
  },
  createTask: (task: any) => request('/tasks', { method: 'POST', body: JSON.stringify(task) }),
  updateTask: (id: number, updates: any) => request(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(updates) }),
  deleteTask: (id: number) => request(`/tasks/${id}`, { method: 'DELETE' }),
  getAgents: (companyId?: number) => request(`/agents${companyId ? `?company_id=${companyId}` : ''}`),
  getAlerts: () => request('/alerts?unacknowledged=true'),
  acknowledgeAlert: (id: number) => request(`/alerts/${id}/acknowledge`, { method: 'POST' }),
  bulkAcknowledgeAlerts: (filters?: { source?: string; type?: string }) =>
    request('/alerts/bulk-acknowledge', { method: 'POST', body: JSON.stringify(filters ?? {}) }),

  // ── OpenClaw ──────────────────────────────────────────────
  getOpenClawHealth: () => request('/openclaw/health'),
  getOpenClawStatus: () => request('/openclaw/status'),
  openclawPing: () => request('/openclaw/ping'),
  openclawSession: () => request('/openclaw/session'),
  openclawListMachines: () => request('/openclaw/machines'),
  openclawMachineStatus: (id: string) => request(`/openclaw/machines/${id}`),
  openclawStartMachine: (id: string) => request(`/openclaw/machines/${id}/start`, { method: 'POST' }),
  openclawStopMachine: (id: string) => request(`/openclaw/machines/${id}/stop`, { method: 'POST' }),
  openclawRestartMachine: (id: string) => request(`/openclaw/machines/${id}/restart`, { method: 'POST' }),
  openclawDiagnostics: (id: string) => request(`/openclaw/machines/${id}/diagnostics`, { method: 'POST' }),
  openclawCommand: (command: string, payload?: any) =>
    request('/openclaw/command', { method: 'POST', body: JSON.stringify({ command, payload }) }),

  // ── GHL ───────────────────────────────────────────────────
  getGhlStatus: () => request('/ghl/status'),
  getGhlContacts: (companyId?: number, query?: string) =>
    request(`/ghl/contacts${qs({ company_id: companyId, query })}`),
  getGhlContact: (id: string, companyId?: number) =>
    request(`/ghl/contacts/${id}${qs({ company_id: companyId })}`),
  createGhlContact: (data: any, companyId?: number) =>
    request(`/ghl/contacts${qs({ company_id: companyId })}`, { method: 'POST', body: JSON.stringify(data) }),
  updateGhlContact: (id: string, data: any, companyId?: number) =>
    request(`/ghl/contacts/${id}${qs({ company_id: companyId })}`, { method: 'PUT', body: JSON.stringify(data) }),
  addGhlContactTags: (id: string, tags: string[], companyId?: number) =>
    request(`/ghl/contacts/${id}/tags${qs({ company_id: companyId })}`, { method: 'POST', body: JSON.stringify({ tags }) }),
  getGhlContactNotes: (id: string, companyId?: number) =>
    request(`/ghl/contacts/${id}/notes${qs({ company_id: companyId })}`),
  addGhlContactNote: (id: string, body: string, companyId?: number) =>
    request(`/ghl/contacts/${id}/notes${qs({ company_id: companyId })}`, { method: 'POST', body: JSON.stringify({ body }) }),
  addGhlContactToWorkflow: (contactId: string, workflowId: string, companyId?: number) =>
    request(`/ghl/contacts/${contactId}/workflow/${workflowId}${qs({ company_id: companyId })}`, { method: 'POST' }),
  getGhlPipelines: (companyId?: number) =>
    request(`/ghl/pipelines${qs({ company_id: companyId })}`),
  getGhlAllPipelines: () => request('/ghl/pipelines/all'),
  getGhlOpportunities: (pipelineId: string, companyId?: number) =>
    request(`/ghl/opportunities${qs({ pipeline_id: pipelineId, company_id: companyId })}`),
  createGhlOpportunity: (data: any, companyId?: number) =>
    request(`/ghl/opportunities${qs({ company_id: companyId })}`, { method: 'POST', body: JSON.stringify(data) }),
  updateGhlOpportunity: (id: string, data: any, companyId?: number) =>
    request(`/ghl/opportunities/${id}${qs({ company_id: companyId })}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGhlOpportunity: (id: string, companyId?: number) =>
    request(`/ghl/opportunities/${id}${qs({ company_id: companyId })}`, { method: 'DELETE' }),
  updateGhlOpportunityStage: (id: string, stageId: string, companyId?: number) =>
    request(`/ghl/opportunities/${id}/stage${qs({ company_id: companyId })}`, { method: 'PUT', body: JSON.stringify({ stageId }) }),
  getGhlCampaigns: (companyId?: number) =>
    request(`/ghl/campaigns${qs({ company_id: companyId })}`),
  getGhlConversations: (companyId?: number, query?: string) =>
    request(`/ghl/conversations${qs({ company_id: companyId, query })}`),
  sendGhlMessage: (data: any, companyId?: number) =>
    request(`/ghl/messages${qs({ company_id: companyId })}`, { method: 'POST', body: JSON.stringify(data) }),
  getGhlTags: (companyId?: number) =>
    request(`/ghl/tags${qs({ company_id: companyId })}`),
  getGhlCustomFields: (companyId?: number) =>
    request(`/ghl/custom-fields${qs({ company_id: companyId })}`),
  getGhlTemplates: (companyId?: number, type?: string) =>
    request(`/ghl/templates${qs({ company_id: companyId, type })}`),
  getGhlLocation: (companyId?: number) =>
    request(`/ghl/location${qs({ company_id: companyId })}`),

  // ── AI Discoveries ────────────────────────────────────────
  getDiscoveries: () => request('/ai-discoveries'),
  saveDiscovery: (id: number) => request(`/ai-discoveries/${id}/save`, { method: 'POST' }),
  dismissDiscovery: (id: number) => request(`/ai-discoveries/${id}`, { method: 'DELETE' }),

  // ── AI features ───────────────────────────────────────────
  generateCampaignVariations: (campaignId: number) =>
    request('/ai/campaign-writer', { method: 'POST', body: JSON.stringify({ campaignId }) }),
  queryDashboard: (question: string) =>
    request('/ai/query', { method: 'POST', body: JSON.stringify({ question }) }),
  getChatHistory: () => request('/ai/chat-history'),
  clearChatHistory: () => request('/ai/chat-history?confirm=true', { method: 'DELETE' }),

  // ── AI Assistant (tool-use chat) ────────────────────────
  assistantChat: (message: string, conversationId?: string) =>
    request('/ai-assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ message, conversation_id: conversationId }),
    }),
  getAssistantHistory: (conversationId?: string) =>
    request(`/ai-assistant/history${qs({ conversation_id: conversationId })}`),
  clearAssistantHistory: (conversationId?: string) =>
    request(`/ai-assistant/history${qs({ conversation_id: conversationId })}`, { method: 'DELETE' }),

  // ── Meta Ads ──────────────────────────────────────────────
  // Account
  getMetaAdAccount: () => request('/meta-ads/account'),

  // Account Insights
  getMetaAdInsights: (datePreset?: string) =>
    request(`/meta-ads/insights${qs({ date_preset: datePreset })}`),
  getMetaAdInsightsBreakdown: (datePreset?: string, breakdown?: string) =>
    request(`/meta-ads/insights/breakdown${qs({ date_preset: datePreset, breakdown })}`),
  getMetaAdInsightsTimeSeries: (datePreset?: string, timeIncrement?: number) =>
    request(`/meta-ads/insights/time-series${qs({ date_preset: datePreset, time_increment: timeIncrement })}`),

  // Campaigns
  getMetaAdCampaigns: () => request('/meta-ads/campaigns'),
  getMetaAdCampaignsLive: (limit?: number) =>
    request(`/meta-ads/campaigns/live${qs({ limit })}`),
  createMetaAdCampaign: (payload: any) =>
    request('/meta-ads/campaigns', { method: 'POST', body: JSON.stringify(payload) }),
  updateMetaAdCampaign: (id: string, updates: any) =>
    request(`/meta-ads/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  pauseMetaAdCampaign: (id: string) =>
    request(`/meta-ads/campaigns/${id}/pause`, { method: 'POST' }),
  activateMetaAdCampaign: (id: string) =>
    request(`/meta-ads/campaigns/${id}/activate`, { method: 'POST' }),
  deleteMetaAdCampaign: (id: string) =>
    request(`/meta-ads/campaigns/${id}`, { method: 'DELETE' }),
  getMetaAdCampaignInsights: (id: string, datePreset?: string) =>
    request(`/meta-ads/campaigns/${id}/insights${qs({ date_preset: datePreset })}`),

  // Ad Sets
  getMetaAdSets: (campaignId?: string, limit?: number) =>
    request(`/meta-ads/adsets${qs({ campaign_id: campaignId, limit })}`),
  createMetaAdSet: (payload: any) =>
    request('/meta-ads/adsets', { method: 'POST', body: JSON.stringify(payload) }),
  updateMetaAdSet: (id: string, updates: any) =>
    request(`/meta-ads/adsets/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  pauseMetaAdSet: (id: string) =>
    request(`/meta-ads/adsets/${id}/pause`, { method: 'POST' }),
  activateMetaAdSet: (id: string) =>
    request(`/meta-ads/adsets/${id}/activate`, { method: 'POST' }),
  getMetaAdSetInsights: (id: string, datePreset?: string) =>
    request(`/meta-ads/adsets/${id}/insights${qs({ date_preset: datePreset })}`),

  // Ads
  getMetaAds: (adSetId?: string, limit?: number) =>
    request(`/meta-ads/ads${qs({ adset_id: adSetId, limit })}`),
  createMetaAd: (payload: any) =>
    request('/meta-ads/ads', { method: 'POST', body: JSON.stringify(payload) }),
  updateMetaAd: (id: string, updates: any) =>
    request(`/meta-ads/ads/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  pauseMetaAd: (id: string) =>
    request(`/meta-ads/ads/${id}/pause`, { method: 'POST' }),
  activateMetaAd: (id: string) =>
    request(`/meta-ads/ads/${id}/activate`, { method: 'POST' }),
  getMetaAdInsightsById: (id: string, datePreset?: string) =>
    request(`/meta-ads/ads/${id}/insights${qs({ date_preset: datePreset })}`),

  // Creatives
  getMetaAdCreatives: (limit?: number) =>
    request(`/meta-ads/creatives${qs({ limit })}`),
  createMetaAdCreative: (payload: any) =>
    request('/meta-ads/creatives', { method: 'POST', body: JSON.stringify(payload) }),

  // Audiences
  getMetaAdAudiences: (limit?: number) =>
    request(`/meta-ads/audiences${qs({ limit })}`),
  createMetaAdAudience: (payload: any) =>
    request('/meta-ads/audiences', { method: 'POST', body: JSON.stringify(payload) }),
  deleteMetaAdAudience: (id: string) =>
    request(`/meta-ads/audiences/${id}`, { method: 'DELETE' }),

  // Images
  getMetaAdImages: (limit?: number) =>
    request(`/meta-ads/images${qs({ limit })}`),

  // Targeting
  searchMetaTargeting: (type: string, q: string) =>
    request(`/meta-ads/targeting/search${qs({ type, q })}`),
  browseMetaTargeting: () => request('/meta-ads/targeting/browse'),
  getMetaReachEstimate: (targetingSpec: any) =>
    request('/meta-ads/reach-estimate', { method: 'POST', body: JSON.stringify({ targeting_spec: targetingSpec }) }),

  // ── Competitors ───────────────────────────────────────────
  getCompetitors: () => request('/competitors'),
  addCompetitor: (name: string, url: string) =>
    request('/competitors', { method: 'POST', body: JSON.stringify({ name, url }) }),
  removeCompetitor: (id: number) => request(`/competitors/${id}`, { method: 'DELETE' }),
  getCompetitorChanges: (id: number) => request(`/competitors/${id}/changes`),

  // ── Charts & analytics ────────────────────────────────────
  getChartData: () => request('/metrics/charts'),

  // ── Events ────────────────────────────────────────────────
  getEvents: () => request('/events'),

  // ── Agent runs ────────────────────────────────────────────
  getAgentRuns: (agentId?: number) =>
    request(`/agents/runs${agentId ? `?agent_id=${agentId}` : ''}`),

  // ── Instantly v2 Full API ─────────────────────────────────
  // Campaigns
  instantlyCampaigns: (opts?: { limit?: number; search?: string; status?: number }) =>
    request(`/instantly/campaigns${qs(opts as any ?? {})}`),
  instantlyCampaign: (id: string) => request(`/instantly/campaigns/${id}`),
  instantlyCreateCampaign: (payload: any) =>
    request('/instantly/campaigns', { method: 'POST', body: JSON.stringify(payload) }),
  instantlyUpdateCampaign: (id: string, updates: any) =>
    request(`/instantly/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  instantlyDeleteCampaign: (id: string) =>
    request(`/instantly/campaigns/${id}`, { method: 'DELETE' }),
  instantlyPauseCampaign: (id: string) =>
    request(`/instantly/campaigns/${id}/pause`, { method: 'POST' }),
  instantlyActivateCampaign: (id: string) =>
    request(`/instantly/campaigns/${id}/activate`, { method: 'POST' }),
  instantlyDuplicateCampaign: (id: string) =>
    request(`/instantly/campaigns/${id}/duplicate`, { method: 'POST' }),
  instantlyCampaignSendingStatus: (id: string) =>
    request(`/instantly/campaigns/${id}/sending-status`),
  instantlyCountLaunched: () => request('/instantly/campaigns/count-launched'),

  // Accounts
  instantlyAccounts: (opts?: { limit?: number; search?: string }) =>
    request(`/instantly/accounts${qs(opts as any ?? {})}`),
  instantlyAccountsWarmupStatus: (opts?: { limit?: number; search?: string }) =>
    request(`/instantly/accounts/warmup-status${qs(opts as any ?? {})}`),
  instantlyAccount: (email: string) => request(`/instantly/accounts/${encodeURIComponent(email)}`),
  instantlyPauseAccount: (email: string) =>
    request(`/instantly/accounts/${encodeURIComponent(email)}/pause`, { method: 'POST' }),
  instantlyResumeAccount: (email: string) =>
    request(`/instantly/accounts/${encodeURIComponent(email)}/resume`, { method: 'POST' }),
  instantlyTestVitals: (email: string) =>
    request('/instantly/accounts/test-vitals', { method: 'POST', body: JSON.stringify({ email }) }),
  instantlyMarkFixed: (email: string) =>
    request('/instantly/accounts/mark-fixed', { method: 'POST', body: JSON.stringify({ email }) }),
  instantlyEnableWarmup: (emails: string[]) =>
    request('/instantly/accounts/enable-warmup', { method: 'POST', body: JSON.stringify({ emails }) }),
  instantlyDisableWarmup: (emails: string[]) =>
    request('/instantly/accounts/disable-warmup', { method: 'POST', body: JSON.stringify({ emails }) }),
  instantlyWarmupAnalytics: (accountId?: string) =>
    request(`/instantly/accounts/warmup-analytics${qs({ account_id: accountId })}`),

  // Leads
  instantlyLeads: (opts?: { campaign_id?: string; list_id?: string; limit?: number; search?: string }) =>
    request(`/instantly/leads${qs(opts as any ?? {})}`),
  instantlyLead: (email: string, campaignId?: string) =>
    request(`/instantly/leads/${encodeURIComponent(email)}${qs({ campaign_id: campaignId })}`),
  instantlyCreateLead: (lead: any) =>
    request('/instantly/leads', { method: 'POST', body: JSON.stringify(lead) }),
  instantlyBulkAddLeads: (campaignId: string, leads: any[]) =>
    request('/instantly/leads/bulk-add', { method: 'POST', body: JSON.stringify({ campaign_id: campaignId, leads }) }),
  instantlyDeleteLead: (email: string, campaignId?: string) =>
    request(`/instantly/leads/${encodeURIComponent(email)}${qs({ campaign_id: campaignId })}`, { method: 'DELETE' }),
  instantlyMoveLeads: (payload: any) =>
    request('/instantly/leads/move', { method: 'POST', body: JSON.stringify(payload) }),
  instantlyUpdateInterest: (email: string, campaignId: string, status: number) =>
    request('/instantly/leads/update-interest-status', { method: 'POST', body: JSON.stringify({ email, campaign_id: campaignId, interest_status: status }) }),

  // Lead Lists & Labels
  instantlyLeadLists: () => request('/instantly/lead-lists'),
  instantlyCreateLeadList: (name: string) =>
    request('/instantly/lead-lists', { method: 'POST', body: JSON.stringify({ name }) }),
  instantlyLeadLabels: () => request('/instantly/lead-labels'),

  // Emails (Unibox)
  instantlyEmails: (opts?: { limit?: number; campaign_id?: string; is_unread?: boolean; email_type?: string }) =>
    request(`/instantly/emails${qs(opts as any ?? {})}`),
  instantlyEmail: (id: string) => request(`/instantly/emails/${id}`),
  instantlyReplyEmail: (id: string, body: string, eaccount?: string) =>
    request(`/instantly/emails/${id}/reply`, { method: 'POST', body: JSON.stringify({ body, eaccount }) }),
  instantlyForwardEmail: (id: string, to: string, body?: string) =>
    request(`/instantly/emails/${id}/forward`, { method: 'POST', body: JSON.stringify({ to, body }) }),
  instantlyMarkRead: (id: string) =>
    request(`/instantly/emails/${id}/mark-read`, { method: 'POST' }),
  instantlyCountUnread: () => request('/instantly/emails/count-unread'),

  // Analytics
  instantlyAnalytics: (campaignId?: string, startDate?: string, endDate?: string) =>
    request(`/instantly/analytics/campaign${qs({ campaign_id: campaignId, start_date: startDate, end_date: endDate })}`),
  instantlyAnalyticsOverview: (campaignId?: string) =>
    request(`/instantly/analytics/campaign/overview${qs({ campaign_id: campaignId })}`),
  instantlyDailyAnalytics: (campaignId: string, startDate?: string, endDate?: string) =>
    request(`/instantly/analytics/campaign/daily${qs({ campaign_id: campaignId, start_date: startDate, end_date: endDate })}`),
  instantlyStepsAnalytics: (campaignId: string) =>
    request(`/instantly/analytics/campaign/steps${qs({ campaign_id: campaignId })}`),

  // Verification, Block List, Tags, Templates, Webhooks, Workspace
  instantlyVerifyEmail: (email: string) =>
    request('/instantly/email-verification', { method: 'POST', body: JSON.stringify({ email }) }),
  instantlyBlockList: () => request('/instantly/block-list'),
  instantlyAddBlock: (entry: string, type?: string) =>
    request('/instantly/block-list', { method: 'POST', body: JSON.stringify({ entry, type }) }),
  instantlyCustomTags: () => request('/instantly/custom-tags'),
  instantlyEmailTemplates: () => request('/instantly/email-templates'),
  instantlyWebhooks: () => request('/instantly/webhooks'),
  instantlyWorkspace: () => request('/instantly/workspace'),
  instantlyWorkspacePlan: () => request('/instantly/workspace/plan'),

  // Legacy aliases (keep old routes working)
  getInstantlyAccounts: () => request('/campaigns/accounts'),
  getInstantlyLeads: (campaignId: string) =>
    request(`/campaigns/leads?campaign_id=${campaignId}`),

  // ── Apify / Scraping ─────────────────────────────────────────
  // Store & Actors
  apifySearchStore: (opts?: { search?: string; limit?: number; category?: string }) =>
    request(`/apify/store${qs(opts as any ?? {})}`),
  apifyGetActor: (actorId: string) => request(`/apify/actors/${actorId}`),
  apifyRunActor: (actorId: string, input: any, opts?: { memory?: number; timeout?: number; waitForFinish?: number }) =>
    request(`/apify/actors/${actorId}/run`, { method: 'POST', body: JSON.stringify({ input, ...opts }) }),
  apifyRunActorSync: (actorId: string, input: any, opts?: { memory?: number; timeout?: number }) =>
    request(`/apify/actors/${actorId}/run-sync`, { method: 'POST', body: JSON.stringify({ input, ...opts }) }),
  apifyActorLastRun: (actorId: string) => request(`/apify/actors/${actorId}/last-run`),

  // Runs
  apifyListRuns: (opts?: { limit?: number; offset?: number; desc?: boolean; status?: string }) =>
    request(`/apify/runs${qs(opts as any ?? {})}`),
  apifyGetRun: (runId: string) => request(`/apify/runs/${runId}`),
  apifyAbortRun: (runId: string) => request(`/apify/runs/${runId}/abort`, { method: 'POST' }),
  apifyResurrectRun: (runId: string) => request(`/apify/runs/${runId}/resurrect`, { method: 'POST' }),
  apifyGetRunLog: (runId: string) => request(`/apify/runs/${runId}/log`),

  // Datasets
  apifyListDatasets: (opts?: { limit?: number; offset?: number }) =>
    request(`/apify/datasets${qs(opts as any ?? {})}`),
  apifyGetDataset: (datasetId: string) => request(`/apify/datasets/${datasetId}`),
  apifyGetDatasetItems: (datasetId: string, opts?: { limit?: number; offset?: number; clean?: boolean }) =>
    request(`/apify/datasets/${datasetId}/items${qs(opts as any ?? {})}`),
  apifyDeleteDataset: (datasetId: string) => request(`/apify/datasets/${datasetId}`, { method: 'DELETE' }),

  // Tasks
  apifyListTasks: (opts?: { limit?: number; offset?: number }) =>
    request(`/apify/tasks${qs(opts as any ?? {})}`),
  apifyGetTask: (taskId: string) => request(`/apify/tasks/${taskId}`),
  apifyCreateTask: (payload: any) =>
    request('/apify/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  apifyUpdateTask: (taskId: string, updates: any) =>
    request(`/apify/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(updates) }),
  apifyDeleteTask: (taskId: string) => request(`/apify/tasks/${taskId}`, { method: 'DELETE' }),
  apifyRunTask: (taskId: string, input?: any, opts?: { waitForFinish?: number; memory?: number }) =>
    request(`/apify/tasks/${taskId}/run`, { method: 'POST', body: JSON.stringify({ input, ...opts }) }),
  apifyTaskLastRun: (taskId: string) => request(`/apify/tasks/${taskId}/last-run`),

  // Schedules
  apifyListSchedules: () => request('/apify/schedules'),
  apifyCreateSchedule: (payload: any) =>
    request('/apify/schedules', { method: 'POST', body: JSON.stringify(payload) }),
  apifyUpdateSchedule: (scheduleId: string, updates: any) =>
    request(`/apify/schedules/${scheduleId}`, { method: 'PUT', body: JSON.stringify(updates) }),
  apifyDeleteSchedule: (scheduleId: string) => request(`/apify/schedules/${scheduleId}`, { method: 'DELETE' }),

  // Scraper shortcuts
  apifyScrapeLinkedInProfiles: (urls: string[], maxItems?: number) =>
    request('/apify/scrape/linkedin-profiles', { method: 'POST', body: JSON.stringify({ urls, maxItems }) }),
  apifyScrapeLinkedInCompanies: (urls: string[]) =>
    request('/apify/scrape/linkedin-companies', { method: 'POST', body: JSON.stringify({ urls }) }),
  apifyScrapeInstagramProfiles: (usernames: string[], maxPosts?: number) =>
    request('/apify/scrape/instagram-profiles', { method: 'POST', body: JSON.stringify({ usernames, maxPosts }) }),
  apifyScrapeInstagramHashtag: (hashtag: string, maxPosts?: number) =>
    request('/apify/scrape/instagram-hashtag', { method: 'POST', body: JSON.stringify({ hashtag, maxPosts }) }),
  apifyScrapeGoogle: (queries: string[], opts?: { maxResults?: number; language?: string; country?: string }) =>
    request('/apify/scrape/google', { method: 'POST', body: JSON.stringify({ queries, ...opts }) }),
  apifyScrapeWebsite: (urls: string[], opts?: { maxPages?: number; selector?: string }) =>
    request('/apify/scrape/website', { method: 'POST', body: JSON.stringify({ urls, ...opts }) }),
  apifyScrapeBrowser: (urls: string[], opts?: { maxPages?: number; waitForSelector?: string }) =>
    request('/apify/scrape/browser', { method: 'POST', body: JSON.stringify({ urls, ...opts }) }),

  // User / Account
  apifyUser: () => request('/apify/user'),
  apifyUsage: () => request('/apify/usage'),

  // ── WhatsApp Cloud API ───────────────────────────────────────
  // Send messages
  whatsappSendText: (to: string, body: string, previewUrl?: boolean) =>
    request('/whatsapp/send/text', { method: 'POST', body: JSON.stringify({ to, body, previewUrl }) }),
  whatsappSendTemplate: (to: string, templateName: string, language?: string, components?: any[]) =>
    request('/whatsapp/send/template', { method: 'POST', body: JSON.stringify({ to, templateName, language, components }) }),
  whatsappSendImage: (to: string, link: string, caption?: string) =>
    request('/whatsapp/send/image', { method: 'POST', body: JSON.stringify({ to, link, caption }) }),
  whatsappSendDocument: (to: string, link: string, filename?: string, caption?: string) =>
    request('/whatsapp/send/document', { method: 'POST', body: JSON.stringify({ to, link, filename, caption }) }),
  whatsappSendVideo: (to: string, link: string, caption?: string) =>
    request('/whatsapp/send/video', { method: 'POST', body: JSON.stringify({ to, link, caption }) }),
  whatsappSendAudio: (to: string, link: string) =>
    request('/whatsapp/send/audio', { method: 'POST', body: JSON.stringify({ to, link }) }),
  whatsappSendLocation: (to: string, latitude: number, longitude: number, name?: string, address?: string) =>
    request('/whatsapp/send/location', { method: 'POST', body: JSON.stringify({ to, latitude, longitude, name, address }) }),
  whatsappSendButtons: (to: string, body: string, buttons: Array<{ id: string; title: string }>, header?: string, footer?: string) =>
    request('/whatsapp/send/buttons', { method: 'POST', body: JSON.stringify({ to, body, buttons, header, footer }) }),
  whatsappSendList: (to: string, body: string, buttonText: string, sections: any[], header?: string, footer?: string) =>
    request('/whatsapp/send/list', { method: 'POST', body: JSON.stringify({ to, body, buttonText, sections, header, footer }) }),
  whatsappSendReaction: (to: string, messageId: string, emoji: string) =>
    request('/whatsapp/send/reaction', { method: 'POST', body: JSON.stringify({ to, messageId, emoji }) }),
  whatsappMarkRead: (messageId: string) =>
    request('/whatsapp/mark-read', { method: 'POST', body: JSON.stringify({ messageId }) }),

  // Media
  whatsappGetMedia: (mediaId: string) => request(`/whatsapp/media/${mediaId}`),
  whatsappDeleteMedia: (mediaId: string) => request(`/whatsapp/media/${mediaId}`, { method: 'DELETE' }),

  // Templates
  whatsappListTemplates: (opts?: { limit?: number; status?: string }) =>
    request(`/whatsapp/templates${qs(opts as any ?? {})}`),
  whatsappCreateTemplate: (payload: any) =>
    request('/whatsapp/templates', { method: 'POST', body: JSON.stringify(payload) }),
  whatsappDeleteTemplate: (name: string) => request(`/whatsapp/templates/${name}`, { method: 'DELETE' }),

  // Phone numbers & profile
  whatsappPhoneNumbers: () => request('/whatsapp/phone-numbers'),
  whatsappPhoneNumber: (id: string) => request(`/whatsapp/phone-numbers/${id}`),
  whatsappProfile: () => request('/whatsapp/profile'),
  whatsappUpdateProfile: (profile: any) =>
    request('/whatsapp/profile', { method: 'PUT', body: JSON.stringify(profile) }),

  // ── LinkedIn (via Apify) ─────────────────────────────────────
  linkedinScrapeProfiles: (urls: string[], maxItems?: number) =>
    request('/linkedin/scrape-profiles', { method: 'POST', body: JSON.stringify({ urls, maxItems }) }),
  linkedinScrapeProfilesAsync: (urls: string[], maxItems?: number) =>
    request('/linkedin/scrape-profiles/async', { method: 'POST', body: JSON.stringify({ urls, maxItems }) }),
  linkedinSearchPeople: (query: string, maxResults?: number) =>
    request('/linkedin/search-people', { method: 'POST', body: JSON.stringify({ query, maxResults }) }),
  linkedinSearchPeopleAsync: (query: string, maxResults?: number) =>
    request('/linkedin/search-people/async', { method: 'POST', body: JSON.stringify({ query, maxResults }) }),
  linkedinScrapeCompanies: (urls: string[]) =>
    request('/linkedin/scrape-companies', { method: 'POST', body: JSON.stringify({ urls }) }),
  linkedinScrapeCompaniesAsync: (urls: string[]) =>
    request('/linkedin/scrape-companies/async', { method: 'POST', body: JSON.stringify({ urls }) }),
  linkedinCompanyEmployees: (companyUrl: string, maxResults?: number) =>
    request('/linkedin/company-employees', { method: 'POST', body: JSON.stringify({ companyUrl, maxResults }) }),
  linkedinScrapePosts: (profileUrl: string, maxPosts?: number) =>
    request('/linkedin/scrape-posts', { method: 'POST', body: JSON.stringify({ profileUrl, maxPosts }) }),
  linkedinScrapeJobs: (query: string, location?: string, maxResults?: number) =>
    request('/linkedin/scrape-jobs', { method: 'POST', body: JSON.stringify({ query, location, maxResults }) }),
  linkedinEnrichLeads: (profiles: any[]) =>
    request('/linkedin/enrich-leads', { method: 'POST', body: JSON.stringify({ profiles }) }),
  linkedinGetRun: (runId: string) => request(`/linkedin/run/${runId}`),
  linkedinGetRunData: (runId: string, limit?: number) =>
    request(`/linkedin/run/${runId}/data${qs({ limit })}`),

  // LinkedIn Outreach Queue
  linkedinOutreachQueue: (status?: string, companyId?: number) =>
    request(`/linkedin/outreach-queue${qs({ status, company_id: companyId })}`),
  linkedinOutreachMarkSent: (leadId: number) =>
    request(`/linkedin/outreach/${leadId}/mark-sent`, { method: 'POST' }),
  linkedinOutreachSkip: (leadId: number) =>
    request(`/linkedin/outreach/${leadId}/skip`, { method: 'POST' }),
  linkedinOutreachRegenerate: (leadId: number) =>
    request(`/linkedin/outreach/${leadId}/regenerate`, { method: 'POST' }),
  linkedinOutreachStats: () => request('/linkedin/outreach-stats'),
  linkedinOutreachStatus: () => request('/linkedin/outreach/status'),
  linkedinOutreachSend: (leadId: number) =>
    request(`/linkedin/outreach/${leadId}/send`, { method: 'POST' }),
  linkedinOutreachSendBatch: (limit?: number) =>
    request('/linkedin/outreach/send-batch', { method: 'POST', body: JSON.stringify({ limit }) }),

  // ── Instagram ────────────────────────────────────────────
  instagramScrapeProfiles: (usernames: string[], maxPosts?: number) =>
    request('/instagram/scrape-profiles', { method: 'POST', body: JSON.stringify({ usernames, maxPosts }) }),
  instagramScrapeProfilesAsync: (usernames: string[], maxPosts?: number) =>
    request('/instagram/scrape-profiles/async', { method: 'POST', body: JSON.stringify({ usernames, maxPosts }) }),
  instagramScrapeHashtags: (hashtags: string[], maxPosts?: number) =>
    request('/instagram/scrape-hashtags', { method: 'POST', body: JSON.stringify({ hashtags, maxPosts }) }),
  instagramScrapeHashtagsAsync: (hashtags: string[], maxPosts?: number) =>
    request('/instagram/scrape-hashtags/async', { method: 'POST', body: JSON.stringify({ hashtags, maxPosts }) }),
  instagramScrapePosts: (urls: string[]) =>
    request('/instagram/scrape-posts', { method: 'POST', body: JSON.stringify({ urls }) }),
  instagramScrapePostsAsync: (urls: string[]) =>
    request('/instagram/scrape-posts/async', { method: 'POST', body: JSON.stringify({ urls }) }),
  instagramScrapeComments: (postUrl: string, maxComments?: number) =>
    request('/instagram/scrape-comments', { method: 'POST', body: JSON.stringify({ postUrl, maxComments }) }),
  instagramScrapeReels: (username: string, maxReels?: number) =>
    request('/instagram/scrape-reels', { method: 'POST', body: JSON.stringify({ username, maxReels }) }),
  instagramCompareProfiles: (usernames: string[]) =>
    request('/instagram/compare-profiles', { method: 'POST', body: JSON.stringify({ usernames }) }),
  instagramAnalyzeHashtag: (hashtag: string, maxPosts?: number) =>
    request('/instagram/analyze-hashtag', { method: 'POST', body: JSON.stringify({ hashtag, maxPosts }) }),
  instagramGetRun: (runId: string) => request(`/instagram/run/${runId}`),
  instagramGetRunData: (runId: string, limit?: number) =>
    request(`/instagram/run/${runId}/data${qs({ limit })}`),

  // ── Instagram DM Outreach ────────────────────────────────
  igDmGetCampaigns: () => request('/instagram-dm/campaigns'),
  igDmGetCampaign: (id: number) => request(`/instagram-dm/campaigns/${id}`),
  igDmCreateCampaign: (data: any) =>
    request('/instagram-dm/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  igDmUpdateCampaign: (id: number, data: any) =>
    request(`/instagram-dm/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  igDmDeleteCampaign: (id: number) =>
    request(`/instagram-dm/campaigns/${id}`, { method: 'DELETE' }),

  igDmGetSteps: (campaignId: number) => request(`/instagram-dm/campaigns/${campaignId}/steps`),
  igDmAddStep: (campaignId: number, message_template: string, delay_hours?: number) =>
    request(`/instagram-dm/campaigns/${campaignId}/steps`, { method: 'POST', body: JSON.stringify({ message_template, delay_hours }) }),
  igDmUpdateStep: (id: number, data: any) =>
    request(`/instagram-dm/steps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  igDmDeleteStep: (id: number) =>
    request(`/instagram-dm/steps/${id}`, { method: 'DELETE' }),

  igDmGetLeads: (campaignId: number, status?: string) =>
    request(`/instagram-dm/campaigns/${campaignId}/leads${status ? `?status=${status}` : ''}`),
  igDmAddLeads: (campaignId: number, leads: any[]) =>
    request(`/instagram-dm/campaigns/${campaignId}/leads`, { method: 'POST', body: JSON.stringify({ leads }) }),
  igDmImportHashtag: (campaignId: number, hashtag: string, maxPosts?: number) =>
    request(`/instagram-dm/campaigns/${campaignId}/import-hashtag`, { method: 'POST', body: JSON.stringify({ hashtag, maxPosts }) }),
  igDmImportCompetitor: (campaignId: number, username: string, maxFollowers?: number) =>
    request(`/instagram-dm/campaigns/${campaignId}/import-competitor`, { method: 'POST', body: JSON.stringify({ username, maxFollowers }) }),
  igDmUpdateLeadStatus: (id: number, status: string, extra?: any) =>
    request(`/instagram-dm/leads/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, ...extra }) }),

  igDmStartCampaign: (id: number) =>
    request(`/instagram-dm/campaigns/${id}/start`, { method: 'POST' }),
  igDmPauseCampaign: (id: number) =>
    request(`/instagram-dm/campaigns/${id}/pause`, { method: 'POST' }),
  igDmGetStats: (campaignId: number) => request(`/instagram-dm/campaigns/${campaignId}/stats`),

  // ── Data Enrichment ──────────────────────────────────────────
  // Leads
  getEnrichmentLeads: (params?: { company_id?: number; status?: string; score_label?: string; source?: string; instantly_push_status?: string; tag?: string; limit?: number; offset?: number }) =>
    request(`/enrichment/leads${qs(params as any ?? {})}`),
  getEnrichmentLead: (id: number) => request(`/enrichment/leads/${id}`),
  getEnrichmentLeadFull: (id: number) => request(`/enrichment/leads/${id}/full`),
  searchEnrichmentLeads: (params?: { q?: string; company_id?: number; status?: string; score_label?: string; source?: string; instantly_push_status?: string; limit?: number; offset?: number }) =>
    request(`/enrichment/leads/search${qs(params as any ?? {})}`),
  createEnrichmentLead: (data: any) =>
    request('/enrichment/leads', { method: 'POST', body: JSON.stringify(data) }),
  triggerEnrich: (id: number) =>
    request(`/enrichment/leads/${id}/enrich`, { method: 'POST' }),
  triggerScore: (id: number) =>
    request(`/enrichment/leads/${id}/score`, { method: 'POST' }),
  triggerPushGhl: (id: number) =>
    request(`/enrichment/leads/${id}/push-ghl`, { method: 'POST' }),
  triggerProcess: (id: number) =>
    request(`/enrichment/leads/${id}/process`, { method: 'POST' }),
  approveColdEmail: (id: number, campaignId: string) =>
    request(`/enrichment/leads/${id}/approve-cold-email`, { method: 'POST', body: JSON.stringify({ campaign_id: campaignId }) }),
  excludeColdEmail: (id: number, reason?: string) =>
    request(`/enrichment/leads/${id}/exclude-cold-email`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Bulk actions
  bulkApproveColdEmail: (leadIds: number[], campaignId: string) =>
    request('/enrichment/bulk-approve-cold-email', { method: 'POST', body: JSON.stringify({ lead_ids: leadIds, campaign_id: campaignId }) }),
  bulkEnrich: (ids: number[]) =>
    request('/enrichment/bulk-enrich', { method: 'POST', body: JSON.stringify({ ids }) }),
  bulkProcess: (ids: number[]) =>
    request('/enrichment/bulk-process', { method: 'POST', body: JSON.stringify({ ids }) }),
  bulkUpdateTags: (ids: number[], tags: string[], mode: 'add' | 'remove' | 'replace') =>
    request('/enrichment/bulk-update-tags', { method: 'POST', body: JSON.stringify({ ids, tags, mode }) }),
  updateLeadTags: (id: number, tags: string[]) =>
    request(`/enrichment/leads/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tags }) }),
  getMatchingLeadIds: (params?: { company_id?: number; status?: string; score_label?: string; source?: string; instantly_push_status?: string; tag?: string }) =>
    request(`/enrichment/leads/matching-ids${qs(params as any ?? {})}`),
  getDistinctTags: () => request('/enrichment/tags'),
  reEnrichStale: (companyId?: number) =>
    request('/enrichment/re-enrich-stale', { method: 'POST', body: JSON.stringify({ company_id: companyId }) }),

  // Stats & events
  getEnrichmentStats: (companyId?: number) =>
    request(`/enrichment/stats${qs({ company_id: companyId })}`),
  getEnrichmentEvents: (params?: { company_id?: number; limit?: number }) =>
    request(`/enrichment/events${qs(params as any ?? {})}`),

  // Config
  getEnrichmentConfig: (companyId: number) =>
    request(`/enrichment/config/${companyId}`),
  updateEnrichmentConfig: (companyId: number, data: any) =>
    request(`/enrichment/config/${companyId}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Cold email rules
  getColdEmailRules: (companyId?: number) =>
    request(`/enrichment/cold-email-rules${qs({ company_id: companyId })}`),
  createColdEmailRule: (data: any) =>
    request('/enrichment/cold-email-rules', { method: 'POST', body: JSON.stringify(data) }),
  deleteColdEmailRule: (id: number) =>
    request(`/enrichment/cold-email-rules/${id}`, { method: 'DELETE' }),

  // Known contacts
  getKnownContacts: (params?: { company_id?: number; search?: string }) =>
    request(`/enrichment/known-contacts${qs(params as any ?? {})}`),
  createKnownContact: (data: any) =>
    request('/enrichment/known-contacts', { method: 'POST', body: JSON.stringify(data) }),
  deleteKnownContact: (id: number) =>
    request(`/enrichment/known-contacts/${id}`, { method: 'DELETE' }),
  importKnownContactsFromGhl: (companyId: number) =>
    request('/enrichment/known-contacts/import-ghl', { method: 'POST', body: JSON.stringify({ company_id: companyId }) }),

  // Reply threads
  getReplyThreads: (params?: { company_id?: number; status?: string }) =>
    request(`/enrichment/threads${qs(params as any ?? {})}`),
  getReplyThread: (id: number) => request(`/enrichment/threads/${id}`),
  sendManualReply: (threadId: number, body: string) =>
    request(`/enrichment/threads/${threadId}/reply`, { method: 'POST', body: JSON.stringify({ body }) }),
  updateThreadStatus: (threadId: number, status: string, escalation_reason?: string, conversion_type?: string) =>
    request(`/enrichment/threads/${threadId}/status`, { method: 'PUT', body: JSON.stringify({ status, escalation_reason, conversion_type }) }),

  // Playbooks
  getPlaybook: (companyId: number) => request(`/enrichment/playbooks/${companyId}`),
  updatePlaybook: (companyId: number, data: any) =>
    request(`/enrichment/playbooks/${companyId}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Import from GHL
  importFromGhl: (data: { company_id: number; query?: string; contact_ids?: string[]; auto_process?: boolean }) =>
    request('/enrichment/import-from-ghl', { method: 'POST', body: JSON.stringify(data) }),

  // Bulk CSV upload
  bulkUploadLeads: (data: { company_id: number; file_name: string; leads: any[]; auto_process?: boolean; target_campaign_id?: string; column_mapping?: Record<string, string> }) =>
    request('/enrichment/bulk-upload', { method: 'POST', body: JSON.stringify(data) }),
  getBulkUploads: () => request('/enrichment/bulk-upload'),
  getBulkUpload: (id: number) => request(`/enrichment/bulk-upload/${id}`),
  cancelBulkUpload: (id: number) =>
    request(`/enrichment/bulk-upload/${id}/cancel`, { method: 'POST' }),

  // Audit log
  getLeadAuditLog: (id: number) => request(`/enrichment/leads/${id}/audit-log`),

  // Auto-reply stats
  getAutoReplyStats: (companyId?: number) =>
    request(`/enrichment/auto-reply-stats${qs({ company_id: companyId })}`),

  // ── BTR Conference ─────────────────────────────────────────
  getBtrDashboard: () => request('/btr-conference/dashboard'),
  updateBtrContactStatus: (contactId: string, status: string) =>
    request(`/btr-conference/contacts/${contactId}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  reassignBtrContact: (contactId: string, assignee: string) =>
    request(`/btr-conference/contacts/${contactId}/assign`, { method: 'POST', body: JSON.stringify({ assignee }) }),

  // ── Domain Health ─────────────────────────────────────────
  getDomainHealthDomains: () => request('/domain-health/domains'),
  getDomainHealthDomain: (domain: string, limit?: number) =>
    request(`/domain-health/domains/${encodeURIComponent(domain)}${qs({ limit })}`),
  getDomainHealthAccounts: () => request('/domain-health/accounts'),
  getDomainHealthAccount: (email: string) =>
    request(`/domain-health/accounts/${encodeURIComponent(email)}`),
  enableWarmup: (email: string) =>
    request(`/domain-health/accounts/${encodeURIComponent(email)}/warmup/enable`, { method: 'POST' }),
  disableWarmup: (email: string) =>
    request(`/domain-health/accounts/${encodeURIComponent(email)}/warmup/disable`, { method: 'POST' }),
  pauseAccount: (email: string) =>
    request(`/domain-health/accounts/${encodeURIComponent(email)}/pause`, { method: 'POST' }),
  resumeAccount: (email: string) =>
    request(`/domain-health/accounts/${encodeURIComponent(email)}/resume`, { method: 'POST' }),
  checkDomainHealth: (domain: string) =>
    request(`/domain-health/domains/${encodeURIComponent(domain)}/check`, { method: 'POST' }),
  checkAllDomainHealth: () =>
    request('/domain-health/check-all', { method: 'POST' }),
  getWarmupStatus: () =>
    request<any>('/domain-health/warmup-status'),
  forceWarmupCheck: () =>
    request<any>('/domain-health/warmup-check', { method: 'POST' }),
  getDomainHealthConfig: () => request('/domain-health/config'),
  updateDomainHealthConfig: (data: any) =>
    request('/domain-health/config', { method: 'PUT', body: JSON.stringify(data) }),
  getDomainHealthSummary: () => request('/domain-health/summary'),

  // ── Settings & System Health ────────────────────────────────
  getSystemHealth: () => request<{
    integrations: any[];
    webhooks: any[];
    system: any;
    summary: { total: number; configured: number; missing: number };
  }>('/settings/health'),
  getWebhookLog: (params?: { limit?: number; offset?: number; source?: string; event_type?: string }) =>
    request<{ events: any[]; total: number; breakdown: any[] }>(`/settings/webhook-log${qs(params as any)}`),
  getWebhookLogStats: () => request<{ hourly: any[]; daily: any[]; bySource: any[] }>('/settings/webhook-log/stats'),
  pingService: (service: string) =>
    request<{ ok: boolean; latencyMs: number; details?: string }>(`/settings/ping/${service}`, { method: 'POST' }),
  getDbStats: () => request<{ tables: { table: string; count: number }[] }>('/settings/db-stats'),

  // ── RB2B Visitors ───────────────────────────────────────────
  getRb2bVisitors: (params?: { limit?: number; offset?: number; status?: string; company_id?: number; search?: string }) =>
    request<{ visitors: any[]; total: number }>(`/rb2b/visitors${qs(params as any)}`),
  getRb2bStats: (companyId?: number) =>
    request<any>(`/rb2b/stats${qs({ company_id: companyId })}`),
  getRb2bVisitor: (id: number) =>
    request<{ visitor: any; events: any[] }>(`/rb2b/visitors/${id}`),

  // ── Direct Person/Company Lookup ────────────────────────────
  lookupPerson: (params: { email?: string; phone?: string; name?: string; company?: string }) =>
    request<any>('/enrichment/lookup/person', { method: 'POST', body: JSON.stringify(params) }),
  lookupCompany: (params: { domain?: string; name?: string }) =>
    request<any>('/enrichment/lookup/company', { method: 'POST', body: JSON.stringify(params) }),

  // ── Anymailfinder ────────────────────────────────────────────
  amfFindPersonEmail: (params: { domain?: string; company_name?: string; full_name?: string; first_name?: string; last_name?: string }) =>
    request<{ email: string | null; email_status: string; valid_email: string | null }>('/anymailfinder/find-person', { method: 'POST', body: JSON.stringify(params) }),
  amfFindCompanyEmails: (params: { domain?: string; company_name?: string; email_type?: 'any' | 'generic' | 'personal' }) =>
    request<{ email_status: string; emails: string[]; valid_emails: string[] }>('/anymailfinder/find-company', { method: 'POST', body: JSON.stringify(params) }),
  amfVerifyEmail: (email: string) =>
    request<{ email: string; email_status: string }>('/anymailfinder/verify', { method: 'POST', body: JSON.stringify({ email }) }),
  amfStatus: () =>
    request<{ available: boolean }>('/anymailfinder/status'),

  // ── A/B Testing ─────────────────────────────────────────────
  getAbTests: (companyId?: number) =>
    request<any[]>(`/enrichment/ab-tests${qs({ company_id: companyId })}`),
  getAbTest: (id: number) =>
    request<any>(`/enrichment/ab-tests/${id}`),
  createAbTest: (data: { name: string; test_type: string; company_id?: number; variants?: any[] }) =>
    request<any>('/enrichment/ab-tests', { method: 'POST', body: JSON.stringify(data) }),
  updateAbTestStatus: (id: number, status: string) =>
    request<any>(`/enrichment/ab-tests/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  getAbTestWinner: (id: number) =>
    request<{ winner: any }>(`/enrichment/ab-tests/${id}/winner`),

  // ── Meeting Transcripts ────────────────────────────────────
  getMeetingTranscripts: (companyId?: number) =>
    request<any[]>(`/enrichment/meeting-transcripts${qs({ company_id: companyId })}`),
  getMeetingTranscript: (id: number) =>
    request<any>(`/enrichment/meeting-transcripts/${id}`),
  reprocessMeetingTranscript: (id: number) =>
    request<{ queued: boolean }>(`/enrichment/meeting-transcripts/${id}/reprocess`, { method: 'POST' }),

  // ── Daily Reports ────────────────────────────────────────────
  getReports: (limit?: number) =>
    request(`/reports${qs({ limit })}`),
  getReport: (id: number) =>
    request(`/reports/${id}`),
  getReportPreview: (type?: string) =>
    request(`/reports/preview${qs({ type })}`),
  sendReport: (type: string) =>
    request('/reports/send-now', { method: 'POST', body: JSON.stringify({ type }) }),
};
