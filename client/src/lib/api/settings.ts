import { request, qs } from './client';

export const settingsApi = {
  // ── Tasks ─────────────────────────────────────────────────
  getTasks: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return request(`/tasks${q}`);
  },
  createTask: (task: any) => request('/tasks', { method: 'POST', body: JSON.stringify(task) }),
  updateTask: (id: number, updates: any) => request(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(updates) }),
  deleteTask: (id: number) => request(`/tasks/${id}`, { method: 'DELETE' }),

  // ── Agents ────────────────────────────────────────────────
  getAgents: (companyId?: number) => request(`/agents${companyId ? `?company_id=${companyId}` : ''}`),

  // ── Alerts ────────────────────────────────────────────────
  getAlerts: () => request('/alerts?unacknowledged=true'),
  acknowledgeAlert: (id: number) => request(`/alerts/${id}/acknowledge`, { method: 'POST' }),
  bulkAcknowledgeAlerts: (filters?: { source?: string; type?: string }) =>
    request('/alerts/bulk-acknowledge', { method: 'POST', body: JSON.stringify(filters ?? {}) }),

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
};
