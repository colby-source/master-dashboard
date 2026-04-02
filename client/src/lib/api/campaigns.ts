import { request } from './client';

export const campaignApi = {
  getCampaigns: (companyId?: number) => request(`/campaigns${companyId ? `?company_id=${companyId}` : ''}`),
  pauseCampaign: (id: number) => request(`/campaigns/${id}/pause`, { method: 'POST' }),
  activateCampaign: (id: number) => request(`/campaigns/${id}/activate`, { method: 'POST' }),
  getCampaignDetail: (id: number) => request(`/campaigns/${id}/detail`),
};
