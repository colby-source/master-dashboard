import { request, qs } from './client';

export const analyticsApi = {
  // ── Core Metrics ──────────────────────────────────────────
  getSummary: () => request('/metrics/summary'),
  getMetrics: (companyId?: number) => request(`/metrics${companyId ? `?company_id=${companyId}` : ''}`),
  getCompanies: () => request('/companies'),

  // ── Charts & analytics ────────────────────────────────────
  getChartData: () => request('/metrics/charts'),

  // ── Events ────────────────────────────────────────────────
  getEvents: () => request('/events'),

  // ── Agent runs ────────────────────────────────────────────
  getAgentRuns: (agentId?: number) =>
    request(`/agents/runs${agentId ? `?agent_id=${agentId}` : ''}`),

  // ── Competitors ───────────────────────────────────────────
  getCompetitors: () => request('/competitors'),
  addCompetitor: (name: string, url: string) =>
    request('/competitors', { method: 'POST', body: JSON.stringify({ name, url }) }),
  removeCompetitor: (id: number) => request(`/competitors/${id}`, { method: 'DELETE' }),
  getCompetitorChanges: (id: number) => request(`/competitors/${id}/changes`),

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
