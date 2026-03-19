import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

interface GhlLocation {
  name: string;
  companyId: number;
  apiKey: string;
  locationId: string;
}

class GhlLocationClient {
  private client: AxiosInstance;
  readonly location: GhlLocation;
  private _lastError: string | null = null;
  private _hasAccess = true;

  get lastError() { return this._lastError; }
  get hasAccess() { return this._hasAccess; }

  constructor(location: GhlLocation) {
    this.location = location;
    this.client = axios.create({
      baseURL: config.ghlBaseUrl,
      headers: {
        'Authorization': `Bearer ${location.apiKey}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  private handleError(endpoint: string, err: any): void {
    const status = err.response?.status;
    const body = err.response?.data;
    const msg = body?.message || err.message;

    if (status === 403) {
      this._hasAccess = false;
      this._lastError = `403 Forbidden: ${msg}`;
      console.error(`[GHL:${this.location.name}] ${endpoint} → 403: ${msg}`);
    } else if (status === 401) {
      this._hasAccess = false;
      this._lastError = `401 Unauthorized: Invalid API key`;
      console.error(`[GHL:${this.location.name}] ${endpoint} → 401`);
    } else {
      this._lastError = msg;
      console.error(`[GHL:${this.location.name}] ${endpoint} error:`, msg);
    }
  }

  private ok() { this._hasAccess = true; this._lastError = null; }

  // ── Contacts ──────────────────────────────────────────────
  async searchContacts(query?: string, limit = 20, tag?: string): Promise<any> {
    try {
      const params: any = { limit, locationId: this.location.locationId };
      if (query) params.query = query;
      if (tag) params.query = tag; // GHL uses query param for tag-based filtering
      const { data } = await this.client.get('/contacts/', { params });
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('searchContacts', err);
      return { contacts: [], meta: { total: 0 } };
    }
  }

  async getAllContacts(maxContacts = 50000): Promise<any[]> {
    const all: any[] = [];
    const seen = new Set<string>();
    let startAfter: number | undefined;
    let startAfterId: string | undefined;
    let page = 0;

    while (all.length < maxContacts) {
      try {
        const params: any = { limit: 100, locationId: this.location.locationId };
        if (startAfter !== undefined && startAfterId) {
          params.startAfter = startAfter;
          params.startAfterId = startAfterId;
        }
        const { data } = await this.client.get('/contacts/', { params });
        this.ok();
        const contacts = data?.contacts || [];
        for (const c of contacts) {
          if (!seen.has(c.id)) { seen.add(c.id); all.push(c); }
        }
        page++;
        if (page % 10 === 0) {
          console.log(`[GHL:${this.location.name}] getAllContacts: fetched ${all.length} contacts (${page} pages)`);
        }
        if (!data?.meta?.nextPageUrl || contacts.length === 0) break;
        startAfter = data.meta.startAfter;
        startAfterId = data.meta.startAfterId;

        // Small delay between pages to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err: any) {
        this.handleError('getAllContacts', err);
        break;
      }
    }

    console.log(`[GHL:${this.location.name}] getAllContacts: completed with ${all.length} contacts (${page} pages)`);
    return all;
  }

  async getContact(contactId: string): Promise<any> {
    try {
      const { data } = await this.client.get(`/contacts/${contactId}`);
      this.ok();
      return data?.contact || data;
    } catch (err: any) {
      this.handleError('getContact', err);
      return null;
    }
  }

  async createContact(contactData: any): Promise<any> {
    try {
      const { data } = await this.client.post('/contacts/', {
        ...contactData, locationId: this.location.locationId,
      });
      this.ok();
      return data?.contact || data;
    } catch (err: any) {
      this.handleError('createContact', err);
      return null;
    }
  }

  async updateContact(contactId: string, updates: any): Promise<any> {
    try {
      const { data } = await this.client.put(`/contacts/${contactId}`, updates);
      this.ok();
      return data?.contact || data;
    } catch (err: any) {
      this.handleError('updateContact', err);
      return null;
    }
  }

  async addContactTags(contactId: string, tags: string[]): Promise<any> {
    try {
      const { data } = await this.client.post(`/contacts/${contactId}/tags`, { tags });
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('addContactTags', err);
      return null;
    }
  }

  async removeContactTags(contactId: string, tags: string[]): Promise<any> {
    try {
      const { data } = await this.client.delete(`/contacts/${contactId}/tags`, { data: { tags } });
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('removeContactTags', err);
      return null;
    }
  }

  async getContactTasks(contactId: string): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/contacts/${contactId}/tasks`);
      this.ok();
      return data?.tasks || [];
    } catch (err: any) {
      this.handleError('getContactTasks', err);
      return [];
    }
  }

  async getContactNotes(contactId: string): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/contacts/${contactId}/notes`);
      this.ok();
      return data?.notes || [];
    } catch (err: any) {
      this.handleError('getContactNotes', err);
      return [];
    }
  }

  async createContactNote(contactId: string, body: string): Promise<any> {
    try {
      const { data } = await this.client.post(`/contacts/${contactId}/notes`, { body });
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('createContactNote', err);
      return null;
    }
  }

  // ── Pipelines & Opportunities ─────────────────────────────
  async getPipelines(): Promise<any> {
    try {
      const { data } = await this.client.get('/opportunities/pipelines', {
        params: { locationId: this.location.locationId },
      });
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('getPipelines', err);
      return { pipelines: [] };
    }
  }

  async getOpportunities(pipelineId: string, limit = 50): Promise<any> {
    try {
      const { data } = await this.client.get('/opportunities/search', {
        params: { location_id: this.location.locationId, pipeline_id: pipelineId, limit },
      });
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('getOpportunities', err);
      return { opportunities: [] };
    }
  }

  async createOpportunity(data: { pipelineId: string; stageId: string; contactId: string; name: string; monetaryValue?: number; status?: string }): Promise<any> {
    try {
      const { data: resp } = await this.client.post('/opportunities/', {
        ...data,
        locationId: this.location.locationId,
        status: data.status || 'open',
      });
      this.ok();
      return resp?.opportunity || resp;
    } catch (err: any) {
      this.handleError('createOpportunity', err);
      return null;
    }
  }

  async updateOpportunity(opportunityId: string, updates: any): Promise<any> {
    try {
      const { data } = await this.client.put(`/opportunities/${opportunityId}`, updates);
      this.ok();
      return data?.opportunity || data;
    } catch (err: any) {
      this.handleError('updateOpportunity', err);
      return null;
    }
  }

  async deleteOpportunity(opportunityId: string): Promise<any> {
    try {
      const { data } = await this.client.delete(`/opportunities/${opportunityId}`);
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('deleteOpportunity', err);
      return null;
    }
  }

  async updateOpportunityStage(opportunityId: string, stageId: string): Promise<any> {
    try {
      const { data } = await this.client.put(`/opportunities/${opportunityId}`, { stageId });
      this.ok();
      return data?.opportunity || data;
    } catch (err: any) {
      this.handleError('updateOpportunityStage', err);
      return null;
    }
  }

  // ── Workflows ─────────────────────────────────────────────
  async getWorkflows(): Promise<any> {
    try {
      const { data } = await this.client.get('/workflows/', {
        params: { locationId: this.location.locationId },
      });
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('getWorkflows', err);
      return { workflows: [] };
    }
  }

  async addContactToWorkflow(contactId: string, workflowId: string): Promise<any> {
    try {
      const { data } = await this.client.post(`/contacts/${contactId}/workflow/${workflowId}`, {});
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('addContactToWorkflow', err);
      return null;
    }
  }

  async removeContactFromWorkflow(contactId: string, workflowId: string): Promise<any> {
    try {
      const { data } = await this.client.delete(`/contacts/${contactId}/workflow/${workflowId}`);
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('removeContactFromWorkflow', err);
      return null;
    }
  }

  // ── GHL Campaigns ─────────────────────────────────────────
  async getCampaigns(): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/locations/${this.location.locationId}/campaigns`);
      this.ok();
      return data?.campaigns || [];
    } catch (err: any) {
      this.handleError('getCampaigns', err);
      return [];
    }
  }

  async addContactToCampaign(contactId: string, campaignId: string): Promise<any> {
    try {
      const { data } = await this.client.post(`/contacts/${contactId}/campaigns/${campaignId}`, {});
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('addContactToCampaign', err);
      return null;
    }
  }

  // ── Conversations ─────────────────────────────────────────
  async searchConversations(query?: string, limit = 20): Promise<any> {
    try {
      const { data } = await this.client.get('/conversations/search', {
        params: { locationId: this.location.locationId, q: query, limit },
      });
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('searchConversations', err);
      return { conversations: [] };
    }
  }

  async sendMessage(params: { contactId: string; type: 'SMS' | 'Email'; message?: string; subject?: string; html?: string }): Promise<any> {
    try {
      const { data } = await this.client.post('/conversations/messages', {
        type: params.type,
        contactId: params.contactId,
        ...(params.type === 'SMS' ? { message: params.message } : { subject: params.subject, html: params.html || params.message }),
      });
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('sendMessage', err);
      return null;
    }
  }

  // ── Tags, Custom Fields, Templates ────────────────────────
  async getLocationTags(): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/locations/${this.location.locationId}/tags`);
      this.ok();
      return data?.tags || [];
    } catch (err: any) {
      this.handleError('getLocationTags', err);
      return [];
    }
  }

  async getCustomFields(): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/locations/${this.location.locationId}/customFields`);
      this.ok();
      return data?.customFields || [];
    } catch (err: any) {
      this.handleError('getCustomFields', err);
      return [];
    }
  }

  async createCustomField(field: { name: string; dataType: string; placeholder?: string }): Promise<any> {
    try {
      const { data } = await this.client.post(`/locations/${this.location.locationId}/customFields`, field);
      this.ok();
      return data?.customField || data;
    } catch (err: any) {
      this.handleError('createCustomField', err);
      return null;
    }
  }

  async getTemplates(type?: 'email' | 'sms'): Promise<any[]> {
    try {
      const { data } = await this.client.get(`/locations/${this.location.locationId}/templates`, {
        params: type ? { type } : {},
      });
      this.ok();
      return data?.templates || [];
    } catch (err: any) {
      this.handleError('getTemplates', err);
      return [];
    }
  }

  // ── Calendars & Appointments ─────────────────────────────
  async getCalendars(): Promise<any[]> {
    try {
      const { data } = await this.client.get('/calendars/', {
        params: { locationId: this.location.locationId },
      });
      this.ok();
      return data?.calendars || [];
    } catch (err: any) {
      this.handleError('getCalendars', err);
      return [];
    }
  }

  async getFreeSlots(calendarId: string, startDate: string, endDate: string, timezone = 'America/New_York'): Promise<any> {
    try {
      const { data } = await this.client.get(`/calendars/${calendarId}/free-slots`, {
        params: { startDate, endDate, timezone },
      });
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('getFreeSlots', err);
      return {};
    }
  }

  async createAppointment(params: {
    calendarId: string;
    contactId: string;
    startTime: string;
    endTime: string;
    title?: string;
    notes?: string;
    appointmentStatus?: string;
  }): Promise<any> {
    try {
      const { data } = await this.client.post('/calendars/events/appointments', {
        calendarId: params.calendarId,
        locationId: this.location.locationId,
        contactId: params.contactId,
        startTime: params.startTime,
        endTime: params.endTime,
        title: params.title || '1-on-1 Meeting — Granite Park Capital',
        notes: params.notes || '',
        appointmentStatus: params.appointmentStatus || 'confirmed',
      });
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('createAppointment', err);
      return null;
    }
  }

  async getAppointments(calendarId: string, startDate: string, endDate: string): Promise<any[]> {
    try {
      const { data } = await this.client.get('/calendars/events', {
        params: {
          locationId: this.location.locationId,
          calendarId,
          startTime: startDate,
          endTime: endDate,
        },
      });
      this.ok();
      return data?.events || [];
    } catch (err: any) {
      this.handleError('getAppointments', err);
      return [];
    }
  }

  async updateAppointment(eventId: string, updates: any): Promise<any> {
    try {
      const { data } = await this.client.put(`/calendars/events/appointments/${eventId}`, updates);
      this.ok();
      return data;
    } catch (err: any) {
      this.handleError('updateAppointment', err);
      return null;
    }
  }

  // ── Location Info ─────────────────────────────────────────
  async getLocationInfo(): Promise<any> {
    try {
      const { data } = await this.client.get(`/locations/${this.location.locationId}`);
      this.ok();
      return data?.location || data;
    } catch (err: any) {
      this.handleError('getLocationInfo', err);
      return null;
    }
  }
}

class GhlService {
  private clients: Map<number, GhlLocationClient> = new Map();

  constructor() {
    for (const loc of config.ghlLocations) {
      if (loc.apiKey && loc.locationId) {
        this.clients.set(loc.companyId, new GhlLocationClient(loc));
      }
    }
  }

  getClient(companyId: number): GhlLocationClient | undefined {
    return this.clients.get(companyId);
  }

  getAllClients(): GhlLocationClient[] {
    return Array.from(this.clients.values());
  }
}

export const ghlService = new GhlService();
