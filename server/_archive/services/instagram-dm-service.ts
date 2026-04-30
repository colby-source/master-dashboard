import { queryAll, queryOne, runSql, saveDb } from '../db';
import { apifyService } from './apify-service';
import { instagramService } from './instagram-service';
import { wsServer } from '../websocket/ws-server';

class InstagramDmService {
  // ── Campaign CRUD ─────────────────────────────────────────

  async createCampaign(data: {
    name: string;
    lead_source?: string;
    lead_source_value?: string;
    ig_session_cookie?: string;
    dm_actor_id?: string;
    daily_limit?: number;
    delay_min?: number;
    delay_max?: number;
  }) {
    const result = runSql(
      `INSERT INTO ig_dm_campaigns (name, lead_source, lead_source_value, ig_session_cookie, dm_actor_id, daily_limit, delay_min, delay_max)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.lead_source || null,
        data.lead_source_value || null,
        data.ig_session_cookie || null,
        data.dm_actor_id || 'leeerob/instagram-dm-sender',
        data.daily_limit ?? 20,
        data.delay_min ?? 60,
        data.delay_max ?? 180,
      ]
    );
    saveDb();
    const id = (result as any)?.lastInsertRowid ?? (result as any)?.changes;
    return this.getCampaign(id) ?? { id };
  }

  getCampaigns() {
    return queryAll('SELECT * FROM ig_dm_campaigns ORDER BY created_at DESC');
  }

  getCampaign(id: number) {
    return queryOne('SELECT * FROM ig_dm_campaigns WHERE id = ?', [id]);
  }

  updateCampaign(id: number, data: Record<string, any>) {
    const allowed = ['name', 'status', 'lead_source', 'lead_source_value', 'ig_session_cookie', 'dm_actor_id', 'daily_limit', 'delay_min', 'delay_max', 'total_sent', 'total_replies'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const key of allowed) {
      if (key in data) {
        sets.push(`${key} = ?`);
        vals.push(data[key]);
      }
    }
    if (!sets.length) return this.getCampaign(id);
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    runSql(`UPDATE ig_dm_campaigns SET ${sets.join(', ')} WHERE id = ?`, vals);
    saveDb();
    return this.getCampaign(id);
  }

  deleteCampaign(id: number) {
    runSql('DELETE FROM ig_dm_steps WHERE campaign_id = ?', [id]);
    runSql('DELETE FROM ig_dm_leads WHERE campaign_id = ?', [id]);
    runSql('DELETE FROM ig_dm_campaigns WHERE id = ?', [id]);
    saveDb();
  }

  // ── Step CRUD ─────────────────────────────────────────────

  addStep(campaignId: number, messageTemplate: string, delayHours = 0) {
    const maxOrder = queryOne(
      'SELECT COALESCE(MAX(step_order), 0) as mx FROM ig_dm_steps WHERE campaign_id = ?',
      [campaignId]
    );
    const nextOrder = ((maxOrder as any)?.mx ?? 0) + 1;
    runSql(
      'INSERT INTO ig_dm_steps (campaign_id, step_order, message_template, delay_hours) VALUES (?, ?, ?, ?)',
      [campaignId, nextOrder, messageTemplate, delayHours]
    );
    saveDb();
    return this.getSteps(campaignId);
  }

  getSteps(campaignId: number) {
    return queryAll(
      'SELECT * FROM ig_dm_steps WHERE campaign_id = ? ORDER BY step_order ASC',
      [campaignId]
    );
  }

  updateStep(id: number, data: { message_template?: string; delay_hours?: number; step_order?: number }) {
    const sets: string[] = [];
    const vals: any[] = [];
    if (data.message_template !== undefined) { sets.push('message_template = ?'); vals.push(data.message_template); }
    if (data.delay_hours !== undefined) { sets.push('delay_hours = ?'); vals.push(data.delay_hours); }
    if (data.step_order !== undefined) { sets.push('step_order = ?'); vals.push(data.step_order); }
    if (!sets.length) return;
    vals.push(id);
    runSql(`UPDATE ig_dm_steps SET ${sets.join(', ')} WHERE id = ?`, vals);
    saveDb();
  }

  deleteStep(id: number) {
    runSql('DELETE FROM ig_dm_steps WHERE id = ?', [id]);
    saveDb();
  }

  // ── Lead Management ───────────────────────────────────────

  addLeads(campaignId: number, leads: Array<{
    username: string;
    full_name?: string;
    bio?: string;
    followers?: number;
    following?: number;
    engagement_rate?: number;
    profile_pic_url?: string;
    scraped_data_json?: string;
  }>) {
    let added = 0;
    for (const l of leads) {
      const exists = queryOne(
        'SELECT id FROM ig_dm_leads WHERE campaign_id = ? AND username = ?',
        [campaignId, l.username]
      );
      if (exists) continue;
      runSql(
        `INSERT INTO ig_dm_leads (campaign_id, username, full_name, bio, followers, following, engagement_rate, profile_pic_url, scraped_data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          campaignId, l.username, l.full_name || null, l.bio || null,
          l.followers ?? null, l.following ?? null, l.engagement_rate ?? null,
          l.profile_pic_url || null, l.scraped_data_json || null,
        ]
      );
      added++;
    }
    saveDb();
    return { added, total: leads.length };
  }

  getLeads(campaignId: number, status?: string) {
    if (status) {
      return queryAll(
        'SELECT * FROM ig_dm_leads WHERE campaign_id = ? AND status = ? ORDER BY created_at DESC',
        [campaignId, status]
      );
    }
    return queryAll(
      'SELECT * FROM ig_dm_leads WHERE campaign_id = ? ORDER BY created_at DESC',
      [campaignId]
    );
  }

  updateLeadStatus(leadId: number, status: string, extra?: { reply_text?: string; error_message?: string }) {
    const sets = ['status = ?'];
    const vals: any[] = [status];
    if (extra?.reply_text !== undefined) { sets.push('reply_text = ?'); vals.push(extra.reply_text); }
    if (extra?.error_message !== undefined) { sets.push('error_message = ?'); vals.push(extra.error_message); }
    if (status === 'sent') { sets.push("last_contacted_at = datetime('now')"); }
    vals.push(leadId);
    runSql(`UPDATE ig_dm_leads SET ${sets.join(', ')} WHERE id = ?`, vals);
    saveDb();
  }

  // ── Import from Hashtag ───────────────────────────────────

  async importFromHashtag(campaignId: number, hashtag: string, maxPosts = 50) {
    wsServer.broadcast({ type: 'ig_dm_progress', campaignId, message: `Scraping hashtag #${hashtag}...` });

    const rawData = await instagramService.scrapeHashtag([hashtag], maxPosts);
    const items: any[] = Array.isArray(rawData) ? rawData : rawData?.items ?? [];

    // Extract unique usernames from posts
    const leadsMap = new Map<string, any>();
    for (const post of items) {
      const username = post.ownerUsername || post.username;
      if (!username || leadsMap.has(username)) continue;
      leadsMap.set(username, {
        username,
        full_name: post.ownerFullName || post.fullName || '',
        bio: '',
        followers: post.ownerFollowers || null,
        engagement_rate: null,
        profile_pic_url: post.profilePicUrl || '',
        scraped_data_json: JSON.stringify(post),
      });
    }

    const leads = Array.from(leadsMap.values());
    const result = this.addLeads(campaignId, leads);

    this.updateCampaign(campaignId, { lead_source: 'hashtag', lead_source_value: hashtag });
    wsServer.broadcast({ type: 'ig_dm_progress', campaignId, message: `Imported ${result.added} leads from #${hashtag}` });
    return result;
  }

  // ── Import from Competitor Followers ──────────────────────

  async importFromCompetitor(campaignId: number, username: string, maxFollowers = 50) {
    wsServer.broadcast({ type: 'ig_dm_progress', campaignId, message: `Scraping followers of @${username}...` });

    // Scrape the competitor's profile and their recent posts' commenters/likers
    const rawData = await instagramService.scrapeProfiles([username], maxFollowers);
    const profiles: any[] = Array.isArray(rawData) ? rawData : rawData?.items ?? [];

    const leadsMap = new Map<string, any>();

    for (const profile of profiles) {
      // Get engaged users from latest posts
      const latestPosts = profile.latestPosts || [];
      for (const post of latestPosts) {
        // From post commenters
        const comments = post.comments || post.latestComments || [];
        for (const c of comments) {
          const u = c.ownerUsername || c.username;
          if (u && !leadsMap.has(u)) {
            leadsMap.set(u, {
              username: u,
              full_name: c.ownerFullName || '',
              bio: '',
              followers: null,
              engagement_rate: null,
              profile_pic_url: c.profilePicUrl || '',
            });
          }
        }
      }

      // Also add the profile itself if there are tagged users
      const taggedUsers = profile.taggedUsers || [];
      for (const t of taggedUsers) {
        const u = t.username || t;
        if (typeof u === 'string' && !leadsMap.has(u)) {
          leadsMap.set(u, {
            username: u,
            full_name: t.fullName || '',
            bio: '',
            followers: null,
            engagement_rate: null,
            profile_pic_url: '',
          });
        }
      }
    }

    const leads = Array.from(leadsMap.values());
    const result = this.addLeads(campaignId, leads);

    this.updateCampaign(campaignId, { lead_source: 'competitor', lead_source_value: username });
    wsServer.broadcast({ type: 'ig_dm_progress', campaignId, message: `Imported ${result.added} leads from @${username}'s engagement` });
    return result;
  }

  // ── Template Rendering ────────────────────────────────────

  renderTemplate(template: string, lead: any): string {
    return template
      .replace(/\{\{username\}\}/g, lead.username || '')
      .replace(/\{\{full_name\}\}/g, lead.full_name || lead.username || '')
      .replace(/\{\{bio_snippet\}\}/g, (lead.bio || '').slice(0, 80));
  }

  // ── DM Execution ──────────────────────────────────────────

  async startCampaign(campaignId: number) {
    this.updateCampaign(campaignId, { status: 'active' });
    wsServer.broadcast({ type: 'ig_dm_progress', campaignId, message: 'Campaign started' });
    return this.sendNextBatch(campaignId);
  }

  async pauseCampaign(campaignId: number) {
    this.updateCampaign(campaignId, { status: 'paused' });
    wsServer.broadcast({ type: 'ig_dm_progress', campaignId, message: 'Campaign paused' });
    return this.getCampaign(campaignId);
  }

  async sendNextBatch(campaignId: number) {
    const campaign: any = this.getCampaign(campaignId);
    if (!campaign || campaign.status !== 'active') {
      return { sent: 0, message: 'Campaign is not active' };
    }

    const steps: any[] = this.getSteps(campaignId);
    if (!steps.length) {
      return { sent: 0, message: 'No sequence steps configured' };
    }

    // Get pending leads for current step
    const pendingLeads: any[] = queryAll(
      'SELECT * FROM ig_dm_leads WHERE campaign_id = ? AND status = ? LIMIT ?',
      [campaignId, 'pending', campaign.daily_limit || 20]
    );

    if (!pendingLeads.length) {
      this.updateCampaign(campaignId, { status: 'completed' });
      wsServer.broadcast({ type: 'ig_dm_progress', campaignId, message: 'All leads processed — campaign completed' });
      return { sent: 0, message: 'No pending leads' };
    }

    const step = steps[0]; // First step for pending leads
    let sentCount = 0;

    for (const lead of pendingLeads) {
      try {
        const message = this.renderTemplate(step.message_template, lead);

        // Run DM via Apify actor
        const actorId = campaign.dm_actor_id || 'leeerob/instagram-dm-sender';
        await apifyService.runActor(actorId, {
          sessionCookie: campaign.ig_session_cookie,
          username: lead.username,
          message,
        });

        this.updateLeadStatus(lead.id, 'sent');
        runSql('UPDATE ig_dm_leads SET current_step = ? WHERE id = ?', [step.step_order, lead.id]);
        sentCount++;

        // Update campaign counters
        runSql('UPDATE ig_dm_campaigns SET total_sent = total_sent + 1 WHERE id = ?', [campaignId]);

        wsServer.broadcast({
          type: 'ig_dm_sent',
          campaignId,
          lead: { id: lead.id, username: lead.username },
          step: step.step_order,
          message: `DM sent to @${lead.username}`,
        });

        // Random delay between sends
        const delayMs = (campaign.delay_min + Math.random() * (campaign.delay_max - campaign.delay_min)) * 1000;
        await new Promise(r => setTimeout(r, delayMs));

      } catch (err: any) {
        this.updateLeadStatus(lead.id, 'failed', { error_message: err.message });
        wsServer.broadcast({
          type: 'ig_dm_error',
          campaignId,
          lead: { id: lead.id, username: lead.username },
          error: err.message,
        });
      }
    }

    saveDb();
    return { sent: sentCount, total: pendingLeads.length };
  }

  // ── Stats ─────────────────────────────────────────────────

  getCampaignStats(campaignId: number) {
    const total = queryOne('SELECT COUNT(*) as c FROM ig_dm_leads WHERE campaign_id = ?', [campaignId]) as any;
    const pending = queryOne('SELECT COUNT(*) as c FROM ig_dm_leads WHERE campaign_id = ? AND status = ?', [campaignId, 'pending']) as any;
    const sent = queryOne('SELECT COUNT(*) as c FROM ig_dm_leads WHERE campaign_id = ? AND status = ?', [campaignId, 'sent']) as any;
    const replied = queryOne('SELECT COUNT(*) as c FROM ig_dm_leads WHERE campaign_id = ? AND status = ?', [campaignId, 'replied']) as any;
    const failed = queryOne('SELECT COUNT(*) as c FROM ig_dm_leads WHERE campaign_id = ? AND status = ?', [campaignId, 'failed']) as any;
    const skipped = queryOne('SELECT COUNT(*) as c FROM ig_dm_leads WHERE campaign_id = ? AND status = ?', [campaignId, 'skipped']) as any;

    return {
      total: total?.c ?? 0,
      pending: pending?.c ?? 0,
      sent: sent?.c ?? 0,
      replied: replied?.c ?? 0,
      failed: failed?.c ?? 0,
      skipped: skipped?.c ?? 0,
      replyRate: (sent?.c ?? 0) > 0 ? Math.round(((replied?.c ?? 0) / (sent?.c ?? 0)) * 100) : 0,
    };
  }
}

export const instagramDmService = new InstagramDmService();
