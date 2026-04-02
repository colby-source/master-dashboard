export { BASE, request, qs } from './client';
import { campaignApi } from './campaigns';
import { enrichmentApi } from './enrichment';
import { integrationsApi } from './integrations';
import { analyticsApi } from './analytics';
import { settingsApi } from './settings';

export const api = {
  ...analyticsApi,
  ...campaignApi,
  ...enrichmentApi,
  ...integrationsApi,
  ...settingsApi,
};
