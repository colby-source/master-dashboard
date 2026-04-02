import { request, qs } from './client';

export const enrichmentApi = {
  // ── Data Enrichment - Leads ──────────────────────────────────────
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

  // Reply draft review queue
  getReplyDrafts: (params?: { company_id?: number; review_status?: string; limit?: number; offset?: number }) =>
    request(`/enrichment/reply-drafts${qs(params as any ?? {})}`),
  approveReplyDraft: (id: number) =>
    request(`/enrichment/reply-drafts/${id}/approve`, { method: 'POST' }),
  rejectReplyDraft: (id: number) =>
    request(`/enrichment/reply-drafts/${id}/reject`, { method: 'POST' }),
  bulkActionReplyDrafts: (ids: number[], action: 'approve' | 'reject') =>
    request('/enrichment/reply-drafts/bulk-action', { method: 'POST', body: JSON.stringify({ ids, action }) }),
  editReplyDraft: (id: number, body: string) =>
    request(`/enrichment/reply-drafts/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),

  // Direct Person/Company Lookup
  lookupPerson: (params: { email?: string; phone?: string; name?: string; company?: string }) =>
    request<any>('/enrichment/lookup/person', { method: 'POST', body: JSON.stringify(params) }),
  lookupCompany: (params: { domain?: string; name?: string }) =>
    request<any>('/enrichment/lookup/company', { method: 'POST', body: JSON.stringify(params) }),

  // A/B Testing
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

  // Meeting Transcripts
  getMeetingTranscripts: (companyId?: number) =>
    request<any[]>(`/enrichment/meeting-transcripts${qs({ company_id: companyId })}`),
  getMeetingTranscript: (id: number) =>
    request<any>(`/enrichment/meeting-transcripts/${id}`),
  reprocessMeetingTranscript: (id: number) =>
    request<{ queued: boolean }>(`/enrichment/meeting-transcripts/${id}/reprocess`, { method: 'POST' }),
};
