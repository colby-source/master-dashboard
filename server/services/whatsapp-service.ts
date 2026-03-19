import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

class WhatsAppService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://graph.facebook.com/v21.0',
      headers: {
        Authorization: `Bearer ${config.whatsappAccessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  private get phoneId() { return config.whatsappPhoneNumberId; }
  private get wabaId() { return config.whatsappBusinessAccountId; }

  // ── Send Messages ──────────────────────────────────────────

  /** Send a text message */
  async sendText(to: string, body: string, opts?: { previewUrl?: boolean }) {
    const { data } = await this.client.post(`/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body, preview_url: opts?.previewUrl ?? false },
    });
    return data;
  }

  /** Send a template message */
  async sendTemplate(to: string, templateName: string, language: string, components?: any[]) {
    const { data } = await this.client.post(`/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        ...(components ? { components } : {}),
      },
    });
    return data;
  }

  /** Send an image (by URL or media ID) */
  async sendImage(to: string, image: { link?: string; id?: string; caption?: string }) {
    const { data } = await this.client.post(`/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image,
    });
    return data;
  }

  /** Send a document */
  async sendDocument(to: string, doc: { link?: string; id?: string; caption?: string; filename?: string }) {
    const { data } = await this.client.post(`/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'document',
      document: doc,
    });
    return data;
  }

  /** Send a video */
  async sendVideo(to: string, video: { link?: string; id?: string; caption?: string }) {
    const { data } = await this.client.post(`/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'video',
      video,
    });
    return data;
  }

  /** Send an audio message */
  async sendAudio(to: string, audio: { link?: string; id?: string }) {
    const { data } = await this.client.post(`/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'audio',
      audio,
    });
    return data;
  }

  /** Send a location */
  async sendLocation(to: string, location: { latitude: number; longitude: number; name?: string; address?: string }) {
    const { data } = await this.client.post(`/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'location',
      location,
    });
    return data;
  }

  /** Send interactive reply buttons (up to 3) */
  async sendButtons(to: string, body: string, buttons: Array<{ id: string; title: string }>, opts?: { header?: string; footer?: string }) {
    const { data } = await this.client.post(`/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(opts?.header ? { header: { type: 'text', text: opts.header } } : {}),
        body: { text: body },
        ...(opts?.footer ? { footer: { text: opts.footer } } : {}),
        action: {
          buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
        },
      },
    });
    return data;
  }

  /** Send interactive list message */
  async sendList(to: string, body: string, buttonText: string, sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>, opts?: { header?: string; footer?: string }) {
    const { data } = await this.client.post(`/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(opts?.header ? { header: { type: 'text', text: opts.header } } : {}),
        body: { text: body },
        ...(opts?.footer ? { footer: { text: opts.footer } } : {}),
        action: { button: buttonText, sections },
      },
    });
    return data;
  }

  /** Send a reaction emoji */
  async sendReaction(to: string, messageId: string, emoji: string) {
    const { data } = await this.client.post(`/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: messageId, emoji },
    });
    return data;
  }

  /** Mark a message as read */
  async markAsRead(messageId: string) {
    const { data } = await this.client.post(`/${this.phoneId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
    return data;
  }

  // ── Media ──────────────────────────────────────────────────

  /** Get media URL from media ID */
  async getMediaUrl(mediaId: string) {
    const { data } = await this.client.get(`/${mediaId}`);
    return data;
  }

  /** Delete media */
  async deleteMedia(mediaId: string) {
    const { data } = await this.client.delete(`/${mediaId}`);
    return data;
  }

  // ── Templates ──────────────────────────────────────────────

  /** List message templates */
  async listTemplates(opts?: { limit?: number; status?: string }) {
    const params: Record<string, any> = {};
    if (opts?.limit) params.limit = opts.limit;
    if (opts?.status) params.status = opts.status;
    const { data } = await this.client.get(`/${this.wabaId}/message_templates`, { params });
    return data;
  }

  /** Create a message template */
  async createTemplate(payload: {
    name: string;
    language: string;
    category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
    components: any[];
  }) {
    const { data } = await this.client.post(`/${this.wabaId}/message_templates`, payload);
    return data;
  }

  /** Delete a template by name */
  async deleteTemplate(name: string) {
    const { data } = await this.client.delete(`/${this.wabaId}/message_templates`, {
      params: { name },
    });
    return data;
  }

  // ── Phone Numbers ──────────────────────────────────────────

  /** List phone numbers for the business account */
  async listPhoneNumbers() {
    const { data } = await this.client.get(`/${this.wabaId}/phone_numbers`);
    return data;
  }

  /** Get phone number details */
  async getPhoneNumber(phoneNumberId?: string) {
    const { data } = await this.client.get(`/${phoneNumberId || this.phoneId}`);
    return data;
  }

  // ── Business Profile ───────────────────────────────────────

  /** Get business profile */
  async getBusinessProfile() {
    const { data } = await this.client.get(`/${this.phoneId}/whatsapp_business_profile`, {
      params: { fields: 'about,address,description,email,profile_picture_url,websites,vertical' },
    });
    return data;
  }

  /** Update business profile */
  async updateBusinessProfile(profile: {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    websites?: string[];
    vertical?: string;
  }) {
    const { data } = await this.client.post(`/${this.phoneId}/whatsapp_business_profile`, {
      messaging_product: 'whatsapp',
      ...profile,
    });
    return data;
  }

  // ── Webhook processing ────────────────────────────────────

  /** Parse incoming webhook payload */
  parseWebhook(body: any): {
    messages: Array<{
      id: string;
      from: string;
      timestamp: string;
      type: string;
      text?: { body: string };
      image?: any;
      document?: any;
      video?: any;
      audio?: any;
      location?: any;
      interactive?: any;
      contactName?: string;
    }>;
    statuses: Array<{
      id: string;
      status: string;
      timestamp: string;
      recipientId: string;
    }>;
  } {
    const messages: any[] = [];
    const statuses: any[] = [];

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        if (!value) continue;

        const contacts = value.contacts ?? [];
        for (const msg of value.messages ?? []) {
          const contact = contacts.find((c: any) => c.wa_id === msg.from);
          messages.push({
            ...msg,
            contactName: contact?.profile?.name,
          });
        }

        for (const st of value.statuses ?? []) {
          statuses.push({
            id: st.id,
            status: st.status,
            timestamp: st.timestamp,
            recipientId: st.recipient_id,
          });
        }
      }
    }

    return { messages, statuses };
  }
}

export const whatsappService = new WhatsAppService();
