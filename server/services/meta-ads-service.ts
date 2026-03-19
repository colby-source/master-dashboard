import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

class MetaAdsService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.metaBaseUrl,
      timeout: 30000,
    });
  }

  get available(): boolean {
    return !!config.metaAccessToken && !!config.metaAdAccountId;
  }

  private get params() {
    return { access_token: config.metaAccessToken };
  }

  private get actId() {
    return `act_${config.metaAdAccountId}`;
  }

  // ── Account ────────────────────────────────────────────────

  async getAdAccountInfo(): Promise<any> {
    try {
      const { data } = await this.client.get(`/${this.actId}`, {
        params: { ...this.params, fields: 'name,currency,account_status,amount_spent,balance,spend_cap,business_name,timezone_name' },
      });
      return data;
    } catch (err: any) {
      console.error('[Meta] getAdAccountInfo error:', err.response?.data?.error?.message || err.message);
      return null;
    }
  }

  // ── Campaigns ──────────────────────────────────────────────

  async getCampaigns(limit = 50): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/${this.actId}/campaigns`, {
        params: {
          ...this.params,
          fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,updated_time,bid_strategy,buying_type,special_ad_categories',
          limit,
        },
      });
      return data?.data ?? [];
    } catch (err: any) {
      console.error('[Meta] getCampaigns error:', err.response?.data?.error?.message || err.message);
      return [];
    }
  }

  async createCampaign(params: {
    name: string;
    objective: string;
    status?: string;
    daily_budget?: number;
    lifetime_budget?: number;
    special_ad_categories?: string[];
    bid_strategy?: string;
  }): Promise<any> {
    const { data } = await this.client.post(`/${this.actId}/campaigns`, null, {
      params: {
        ...this.params,
        name: params.name,
        objective: params.objective,
        status: params.status || 'PAUSED',
        ...(params.daily_budget && { daily_budget: params.daily_budget }),
        ...(params.lifetime_budget && { lifetime_budget: params.lifetime_budget }),
        ...(params.special_ad_categories && { special_ad_categories: JSON.stringify(params.special_ad_categories) }),
        ...(params.bid_strategy && { bid_strategy: params.bid_strategy }),
      },
    });
    return data;
  }

  async updateCampaign(campaignId: string, updates: Record<string, any>): Promise<any> {
    const { data } = await this.client.post(`/${campaignId}`, null, {
      params: { ...this.params, ...updates },
    });
    return data;
  }

  async deleteCampaign(campaignId: string): Promise<any> {
    const { data } = await this.client.delete(`/${campaignId}`, {
      params: this.params,
    });
    return data;
  }

  async getCampaignInsights(campaignId: string, datePreset = 'last_7d'): Promise<any> {
    try {
      const { data } = await this.client.get(`/${campaignId}/insights`, {
        params: {
          ...this.params,
          fields: 'impressions,clicks,spend,cpc,cpm,ctr,reach,frequency,conversions,cost_per_conversion,actions,cost_per_action_type',
          date_preset: datePreset,
        },
      });
      return data?.data?.[0] ?? null;
    } catch (err: any) {
      console.error('[Meta] getCampaignInsights error:', err.response?.data?.error?.message || err.message);
      return null;
    }
  }

  // ── Account-level insights ─────────────────────────────────

  async getAccountInsights(datePreset = 'last_7d'): Promise<any> {
    try {
      const { data } = await this.client.get(`/${this.actId}/insights`, {
        params: {
          ...this.params,
          fields: 'impressions,clicks,spend,cpc,cpm,ctr,reach,frequency,actions,cost_per_action_type',
          date_preset: datePreset,
        },
      });
      return data?.data?.[0] ?? null;
    } catch (err: any) {
      console.error('[Meta] getAccountInsights error:', err.response?.data?.error?.message || err.message);
      return null;
    }
  }

  async getAccountInsightsBreakdown(datePreset = 'last_7d', breakdown: string = 'age'): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/${this.actId}/insights`, {
        params: {
          ...this.params,
          fields: 'impressions,clicks,spend,ctr,reach',
          date_preset: datePreset,
          breakdowns: breakdown,
        },
      });
      return data?.data ?? [];
    } catch (err: any) {
      console.error('[Meta] getAccountInsightsBreakdown error:', err.response?.data?.error?.message || err.message);
      return [];
    }
  }

  async getAccountInsightsTimeSeries(datePreset = 'last_7d', timeIncrement = 1): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/${this.actId}/insights`, {
        params: {
          ...this.params,
          fields: 'impressions,clicks,spend,ctr,reach,cpc',
          date_preset: datePreset,
          time_increment: timeIncrement,
        },
      });
      return data?.data ?? [];
    } catch (err: any) {
      console.error('[Meta] getAccountInsightsTimeSeries error:', err.response?.data?.error?.message || err.message);
      return [];
    }
  }

  // ── Ad Sets ────────────────────────────────────────────────

  async getAdSets(campaignId?: string, limit = 50): Promise<any[]> {
    try {
      const endpoint = campaignId ? `/${campaignId}/adsets` : `/${this.actId}/adsets`;
      const { data } = await this.client.get(endpoint, {
        params: {
          ...this.params,
          fields: 'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,budget_remaining,targeting,optimization_goal,billing_event,bid_amount,start_time,end_time,updated_time',
          limit,
        },
      });
      return data?.data ?? [];
    } catch (err: any) {
      console.error('[Meta] getAdSets error:', err.response?.data?.error?.message || err.message);
      return [];
    }
  }

  async createAdSet(params: {
    name: string;
    campaign_id: string;
    daily_budget?: number;
    lifetime_budget?: number;
    optimization_goal: string;
    billing_event: string;
    targeting: any;
    status?: string;
    start_time?: string;
    end_time?: string;
    bid_amount?: number;
  }): Promise<any> {
    const { data } = await this.client.post(`/${this.actId}/adsets`, null, {
      params: {
        ...this.params,
        name: params.name,
        campaign_id: params.campaign_id,
        optimization_goal: params.optimization_goal,
        billing_event: params.billing_event,
        targeting: JSON.stringify(params.targeting),
        status: params.status || 'PAUSED',
        ...(params.daily_budget && { daily_budget: params.daily_budget }),
        ...(params.lifetime_budget && { lifetime_budget: params.lifetime_budget }),
        ...(params.start_time && { start_time: params.start_time }),
        ...(params.end_time && { end_time: params.end_time }),
        ...(params.bid_amount && { bid_amount: params.bid_amount }),
      },
    });
    return data;
  }

  async updateAdSet(adSetId: string, updates: Record<string, any>): Promise<any> {
    const { data } = await this.client.post(`/${adSetId}`, null, {
      params: { ...this.params, ...updates },
    });
    return data;
  }

  async getAdSetInsights(adSetId: string, datePreset = 'last_7d'): Promise<any> {
    try {
      const { data } = await this.client.get(`/${adSetId}/insights`, {
        params: {
          ...this.params,
          fields: 'impressions,clicks,spend,cpc,cpm,ctr,reach,frequency,actions,cost_per_action_type',
          date_preset: datePreset,
        },
      });
      return data?.data?.[0] ?? null;
    } catch (err: any) {
      console.error('[Meta] getAdSetInsights error:', err.response?.data?.error?.message || err.message);
      return null;
    }
  }

  // ── Ads ────────────────────────────────────────────────────

  async getAds(adSetId?: string, limit = 50): Promise<any[]> {
    try {
      const endpoint = adSetId ? `/${adSetId}/ads` : `/${this.actId}/ads`;
      const { data } = await this.client.get(endpoint, {
        params: {
          ...this.params,
          fields: 'id,name,status,effective_status,adset_id,campaign_id,creative,tracking_specs,updated_time',
          limit,
        },
      });
      return data?.data ?? [];
    } catch (err: any) {
      console.error('[Meta] getAds error:', err.response?.data?.error?.message || err.message);
      return [];
    }
  }

  async createAd(params: {
    name: string;
    adset_id: string;
    creative: { creative_id: string };
    status?: string;
  }): Promise<any> {
    const { data } = await this.client.post(`/${this.actId}/ads`, null, {
      params: {
        ...this.params,
        name: params.name,
        adset_id: params.adset_id,
        creative: JSON.stringify(params.creative),
        status: params.status || 'PAUSED',
      },
    });
    return data;
  }

  async updateAd(adId: string, updates: Record<string, any>): Promise<any> {
    const { data } = await this.client.post(`/${adId}`, null, {
      params: { ...this.params, ...updates },
    });
    return data;
  }

  async getAdInsights(adId: string, datePreset = 'last_7d'): Promise<any> {
    try {
      const { data } = await this.client.get(`/${adId}/insights`, {
        params: {
          ...this.params,
          fields: 'impressions,clicks,spend,cpc,cpm,ctr,reach,frequency,actions,cost_per_action_type',
          date_preset: datePreset,
        },
      });
      return data?.data?.[0] ?? null;
    } catch (err: any) {
      console.error('[Meta] getAdInsights error:', err.response?.data?.error?.message || err.message);
      return null;
    }
  }

  // ── Ad Creatives ───────────────────────────────────────────

  async getAdCreatives(limit = 50): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/${this.actId}/adcreatives`, {
        params: {
          ...this.params,
          fields: 'id,name,title,body,image_url,thumbnail_url,object_story_spec,status,effective_object_story_id',
          limit,
        },
      });
      return data?.data ?? [];
    } catch (err: any) {
      console.error('[Meta] getAdCreatives error:', err.response?.data?.error?.message || err.message);
      return [];
    }
  }

  async createAdCreative(params: {
    name: string;
    object_story_spec?: any;
    image_hash?: string;
    image_url?: string;
    title?: string;
    body?: string;
    link_url?: string;
    call_to_action_type?: string;
  }): Promise<any> {
    const payload: any = {
      ...this.params,
      name: params.name,
    };
    if (params.object_story_spec) payload.object_story_spec = JSON.stringify(params.object_story_spec);
    if (params.title) payload.title = params.title;
    if (params.body) payload.body = params.body;

    const { data } = await this.client.post(`/${this.actId}/adcreatives`, null, { params: payload });
    return data;
  }

  // ── Custom Audiences ───────────────────────────────────────

  async getCustomAudiences(limit = 50): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/${this.actId}/customaudiences`, {
        params: {
          ...this.params,
          fields: 'id,name,description,subtype,approximate_count,delivery_status,operation_status,time_created,time_updated',
          limit,
        },
      });
      return data?.data ?? [];
    } catch (err: any) {
      console.error('[Meta] getCustomAudiences error:', err.response?.data?.error?.message || err.message);
      return [];
    }
  }

  async createCustomAudience(params: {
    name: string;
    description?: string;
    subtype: string;
    customer_file_source?: string;
    lookalike_spec?: any;
    rule?: any;
  }): Promise<any> {
    const payload: any = {
      ...this.params,
      name: params.name,
      subtype: params.subtype,
    };
    if (params.description) payload.description = params.description;
    if (params.customer_file_source) payload.customer_file_source = params.customer_file_source;
    if (params.lookalike_spec) payload.lookalike_spec = JSON.stringify(params.lookalike_spec);
    if (params.rule) payload.rule = JSON.stringify(params.rule);

    const { data } = await this.client.post(`/${this.actId}/customaudiences`, null, { params: payload });
    return data;
  }

  async deleteCustomAudience(audienceId: string): Promise<any> {
    const { data } = await this.client.delete(`/${audienceId}`, {
      params: this.params,
    });
    return data;
  }

  // ── Ad Images ──────────────────────────────────────────────

  async getAdImages(limit = 50): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/${this.actId}/adimages`, {
        params: {
          ...this.params,
          fields: 'id,name,hash,url,width,height,created_time,updated_time',
          limit,
        },
      });
      return data?.data ?? [];
    } catch (err: any) {
      console.error('[Meta] getAdImages error:', err.response?.data?.error?.message || err.message);
      return [];
    }
  }

  // ── Targeting ──────────────────────────────────────────────

  async searchTargeting(type: string, q: string): Promise<any[]> {
    try {
      const { data } = await this.client.get('/search', {
        params: {
          ...this.params,
          type,
          q,
        },
      });
      return data?.data ?? [];
    } catch (err: any) {
      console.error('[Meta] searchTargeting error:', err.response?.data?.error?.message || err.message);
      return [];
    }
  }

  async getTargetingBrowse(): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/${this.actId}/targetingbrowse`, {
        params: this.params,
      });
      return data?.data ?? [];
    } catch (err: any) {
      console.error('[Meta] getTargetingBrowse error:', err.response?.data?.error?.message || err.message);
      return [];
    }
  }

  async getReachEstimate(targetingSpec: any): Promise<any> {
    try {
      const { data } = await this.client.get(`/${this.actId}/reachestimate`, {
        params: {
          ...this.params,
          targeting_spec: JSON.stringify(targetingSpec),
        },
      });
      return data?.data ?? null;
    } catch (err: any) {
      console.error('[Meta] getReachEstimate error:', err.response?.data?.error?.message || err.message);
      return null;
    }
  }
}

export const metaAdsService = new MetaAdsService();
