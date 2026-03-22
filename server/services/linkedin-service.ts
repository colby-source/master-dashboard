import { apifyService } from './apify-service';
import { linkedInBrowserService } from './linkedin-browser-service';
import { claudeService } from './claude-service';
import { apolloClient } from './apollo-client';
import { config } from '../config';
import { queryAll, queryOne, runSql, saveDb } from '../db';
import { wsServer } from '../websocket/ws-server';

// LinkedIn service orchestrates Apify scrapers + lead enrichment
// Connection requests use Puppeteer + Voyager API (browser-based)
// Scraping still uses Apify actors

const ACTORS = {
  profileScraper: 'anchor/linkedin-profile-scraper',
  companyScraper: 'anchor/linkedin-company-scraper',
  searchScraper: 'curious_coder/linkedin-search-scraper',
  postScraper: 'curious_coder/linkedin-post-scraper',
  jobScraper: 'helloworlds/linkedin-jobs-scraper',
  salesNavScraper: 'curious_coder/linkedin-sales-navigator-search-scraper',
};

class LinkedInService {
  // ── Profile Scraping ───────────────────────────────────────

  async scrapeProfiles(urls: string[], maxItems = 10): Promise<any> {
    return apifyService.runActorSync(ACTORS.profileScraper, {
      startUrls: urls.map(url => ({ url })),
      maxItems,
    }, { timeout: 120 });
  }

  async scrapeProfilesBySearch(searchQuery: string, maxResults = 25): Promise<any> {
    return apifyService.runActorSync(ACTORS.searchScraper, {
      searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchQuery)}`,
      maxResults,
    }, { timeout: 180 });
  }

  // ── Company Scraping ───────────────────────────────────────

  async scrapeCompanies(urls: string[]): Promise<any> {
    return apifyService.runActorSync(ACTORS.companyScraper, {
      startUrls: urls.map(url => ({ url })),
    }, { timeout: 120 });
  }

  async scrapeCompanyEmployees(companyUrl: string, maxResults = 50): Promise<any> {
    return apifyService.runActorSync(ACTORS.searchScraper, {
      searchUrl: companyUrl.replace(/\/$/, '') + '/people/',
      maxResults,
    }, { timeout: 180 });
  }

  // ── Post & Content Scraping ────────────────────────────────

  async scrapePosts(profileUrl: string, maxPosts = 20): Promise<any> {
    return apifyService.runActorSync(ACTORS.postScraper, {
      profileUrl,
      maxPosts,
    }, { timeout: 120 });
  }

  // ── Job Scraping ───────────────────────────────────────────

  async scrapeJobs(searchQuery: string, location?: string, maxResults = 25): Promise<any> {
    return apifyService.runActorSync(ACTORS.jobScraper, {
      searchUrl: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(searchQuery)}${location ? `&location=${encodeURIComponent(location)}` : ''}`,
      maxResults,
    }, { timeout: 180 });
  }

  // ── Lead Enrichment ────────────────────────────────────────
  // Takes scraped profiles and formats them as outreach-ready leads

  formatAsLeads(profiles: any[]): Array<{
    firstName: string;
    lastName: string;
    email: string;
    company: string;
    title: string;
    linkedInUrl: string;
    location: string;
  }> {
    return profiles.map((p: any) => ({
      firstName: p.firstName || p.first_name || '',
      lastName: p.lastName || p.last_name || '',
      email: p.email || p.emailAddress || '',
      company: p.companyName || p.company || p.currentCompany?.name || '',
      title: p.headline || p.title || p.currentCompany?.title || '',
      linkedInUrl: p.url || p.linkedInUrl || p.profileUrl || '',
      location: p.location || p.addressLocality || '',
    })).filter(l => l.firstName || l.lastName);
  }

  // ── Sales Navigator Search ────────────────────────────────

  async searchSalesNavigator(searchUrl: string, opts?: {
    maxPages?: number;
    scrapingMode?: 'Short' | 'Full' | 'Full + email search';
  }): Promise<any> {
    const cookie = config.linkedinLiAtCookie;
    if (!cookie) throw new Error('LINKEDIN_LI_AT cookie not configured');

    return apifyService.runActor(ACTORS.salesNavScraper, {
      cookie,
      searchUrl,
      searchType: 'People/Lead',
      pageLimit: opts?.maxPages ?? 100,
      scrapingMode: opts?.scrapingMode ?? 'Short',
    });
  }

  async searchSalesNavigatorSync(searchUrl: string, opts?: {
    maxPages?: number;
    scrapingMode?: 'Short' | 'Full' | 'Full + email search';
  }): Promise<any> {
    const cookie = config.linkedinLiAtCookie;
    if (!cookie) throw new Error('LINKEDIN_LI_AT cookie not configured');

    return apifyService.runActorSync(ACTORS.salesNavScraper, {
      cookie,
      searchUrl,
      searchType: 'People/Lead',
      pageLimit: opts?.maxPages ?? 100,
      scrapingMode: opts?.scrapingMode ?? 'Short',
    }, { timeout: 600 });
  }

  formatSalesNavAsLeads(results: any[]): Array<{
    firstName: string;
    lastName: string;
    company: string;
    title: string;
    linkedInUrl: string;
    location: string;
  }> {
    return results.map((p: any) => ({
      firstName: p.firstName || p.first_name || '',
      lastName: p.lastName || p.last_name || '',
      company: p.companyName || p.company || p.currentCompany || '',
      title: p.jobTitle || p.title || p.headline || '',
      linkedInUrl: p.publicUrl || p.profileUrl || p.salesNavigatorUrl || p.url || p.linkedInUrl || '',
      location: p.location || p.geo || '',
    })).filter(l => l.firstName || l.lastName);
  }

  // ── Async (non-blocking) versions ──────────────────────────

  async scrapeProfilesAsync(urls: string[], maxItems = 10): Promise<any> {
    return apifyService.runActor(ACTORS.profileScraper, {
      startUrls: urls.map(url => ({ url })),
      maxItems,
    });
  }

  async searchPeopleAsync(searchQuery: string, maxResults = 25): Promise<any> {
    return apifyService.runActor(ACTORS.searchScraper, {
      searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchQuery)}`,
      maxResults,
    });
  }

  async scrapeCompaniesAsync(urls: string[]): Promise<any> {
    return apifyService.runActor(ACTORS.companyScraper, {
      startUrls: urls.map(url => ({ url })),
    });
  }

  // ── LinkedIn Outreach (Connection Requests via Browser) ──

  /** Check if LinkedIn browser automation is available */
  get outreachReady(): boolean {
    // Browser service is always "ready" — it launches Chrome on demand
    // Authentication is checked at send time
    return true;
  }

  /** Get browser service status */
  get browserStatus() {
    return linkedInBrowserService.status;
  }

  /** Check if LinkedIn session is authenticated */
  async isAuthenticated(): Promise<boolean> {
    return linkedInBrowserService.isAuthenticated();
  }

  /** Open LinkedIn login page in automation browser */
  async openLoginPage(): Promise<void> {
    return linkedInBrowserService.openLoginPage();
  }

  /** Send a single connection request via Puppeteer + Voyager API */
  async sendConnectionRequest(profileUrl: string, message: string): Promise<any> {
    return linkedInBrowserService.sendConnectionRequest(profileUrl, message);
  }

  /** Send a single queued lead's connection request and update status */
  async sendOutreachForLead(leadId: number): Promise<{ success: boolean; error?: string }> {
    const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as any;
    if (!lead) return { success: false, error: 'Lead not found' };
    if (lead.linkedin_outreach_status !== 'queued') {
      return { success: false, error: `Lead status is "${lead.linkedin_outreach_status}", expected "queued"` };
    }

    const enrichment = lead.enrichment_data ? (() => { try { return JSON.parse(lead.enrichment_data); } catch { return {}; } })() : {};
    const linkedInUrl = enrichment.linkedin_url
      || enrichment.apollo_person?.linkedin_url
      || enrichment.pdl_person?.linkedin_url
      || enrichment.linkedin_profile?.url
      || '';

    if (!linkedInUrl) return { success: false, error: 'No LinkedIn URL found' };
    if (!lead.linkedin_message) return { success: false, error: 'No message generated' };

    try {
      // Mark as sending
      runSql(`UPDATE enrichment_leads SET linkedin_outreach_status = 'sending', updated_at = datetime('now') WHERE id = ?`, [leadId]);
      saveDb();
      wsServer.broadcast({ type: 'enrichment_update', leadId, linkedin_outreach_status: 'sending' });

      // Send via browser + Voyager API
      const result = await this.sendConnectionRequest(linkedInUrl, lead.linkedin_message);
      if (!result.success) {
        throw new Error(result.error || 'Connection request failed');
      }
      console.log(`[LinkedIn] Connection request sent for lead ${leadId} (${lead.first_name} ${lead.last_name}): ${result.invitationUrn}`);

      // Mark as sent
      runSql(`UPDATE enrichment_leads SET linkedin_outreach_status = 'sent', updated_at = datetime('now') WHERE id = ?`, [leadId]);
      saveDb();
      wsServer.broadcast({ type: 'enrichment_update', leadId, linkedin_outreach_status: 'sent' });

      return { success: true };
    } catch (err: any) {
      console.error(`[LinkedIn] Connection request failed for lead ${leadId}:`, err.message);
      // Revert to queued so it can be retried
      runSql(`UPDATE enrichment_leads SET linkedin_outreach_status = 'queued', updated_at = datetime('now') WHERE id = ?`, [leadId]);
      saveDb();
      wsServer.broadcast({ type: 'enrichment_update', leadId, linkedin_outreach_status: 'queued' });
      return { success: false, error: err.message };
    }
  }

  /** Process batch of queued leads (up to daily limit) */
  async processOutreachQueue(limit?: number): Promise<{
    sent: number;
    failed: number;
    errors: Array<{ leadId: number; error: string }>;
  }> {
    const maxToSend = Math.min(limit || config.linkedinDailyLimit, 20);

    // Get today's already-sent count
    const todaySent = queryOne(
      `SELECT COUNT(*) as count FROM enrichment_leads
       WHERE linkedin_outreach_status = 'sent'
       AND updated_at >= date('now')`,
    ) as any;
    const alreadySent = todaySent?.count || 0;
    const remaining = Math.max(0, config.linkedinDailyLimit - alreadySent);

    if (remaining === 0) {
      console.log(`[LinkedIn] Daily limit reached (${config.linkedinDailyLimit} sent today). Skipping.`);
      return { sent: 0, failed: 0, errors: [{ leadId: 0, error: `Daily limit reached (${alreadySent}/${config.linkedinDailyLimit})` }] };
    }

    const batchSize = Math.min(maxToSend, remaining);
    const leads = queryAll(
      `SELECT id FROM enrichment_leads
       WHERE linkedin_outreach_status = 'queued'
       AND linkedin_message IS NOT NULL
       ORDER BY score DESC, updated_at ASC
       LIMIT ?`,
      [batchSize],
    ) as any[];

    if (!leads.length) {
      console.log('[LinkedIn] No queued leads to send.');
      return { sent: 0, failed: 0, errors: [] };
    }

    console.log(`[LinkedIn] Processing ${leads.length} queued leads (${alreadySent} already sent today, limit ${config.linkedinDailyLimit})`);

    let sent = 0;
    let failed = 0;
    const errors: Array<{ leadId: number; error: string }> = [];

    // Send one at a time with delays to be safe
    for (const lead of leads) {
      const result = await this.sendOutreachForLead(lead.id);
      if (result.success) {
        sent++;
      } else {
        failed++;
        errors.push({ leadId: lead.id, error: result.error || 'Unknown error' });
      }

      // 3-5 second delay between sends to avoid rate limiting
      if (leads.indexOf(lead) < leads.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
      }
    }

    console.log(`[LinkedIn] Batch complete: ${sent} sent, ${failed} failed`);
    return { sent, failed, errors };
  }

  /** Catch-up: find hot leads that were scored but never queued for LinkedIn outreach */
  async queueMissedHotLeads(): Promise<number> {
    // Find scored leads with score >= hot threshold, not yet queued for LinkedIn
    const missed = queryAll(`
      SELECT el.id, el.first_name, el.last_name, el.email, el.score, el.company_id, el.enrichment_data
      FROM enrichment_leads el
      WHERE el.score >= 80
        AND el.linkedin_outreach_status = 'none'
        AND el.enrichment_data IS NOT NULL
      ORDER BY el.score DESC
      LIMIT 50
    `) as any[];

    console.log(`[LinkedIn] queueMissedHotLeads: found ${missed.length} hot leads to process`);

    let queued = 0;
    for (const lead of missed) {
      const enrichment = (() => { try { return JSON.parse(lead.enrichment_data); } catch { return {}; } })();
      let linkedInUrl = enrichment.linkedin_url
        || enrichment.apollo_person?.linkedin_url
        || enrichment.pdl_person?.linkedin_url
        || enrichment.linkedin_profile?.url
        || '';

      // If no LinkedIn URL, try Apollo person lookup by name + email domain
      if (!linkedInUrl && lead.first_name && lead.last_name && lead.email) {
        try {
          const domain = lead.email.split('@')[1];
          const apolloPerson = await apolloClient.enrichPerson({
            first_name: lead.first_name,
            last_name: lead.last_name,
            domain,
          });
          if (apolloPerson?.linkedin_url) {
            linkedInUrl = apolloPerson.linkedin_url;
            enrichment.apollo_person = apolloPerson;
            // Persist the enrichment data with new Apollo person data
            runSql(
              `UPDATE enrichment_leads SET enrichment_data = ?, updated_at = datetime('now') WHERE id = ?`,
              [JSON.stringify(enrichment), lead.id],
            );
            saveDb();
            console.log(`[LinkedIn] Apollo backfill found LI URL for lead ${lead.id} (${lead.first_name} ${lead.last_name}): ${linkedInUrl}`);
          }
        } catch (err: any) {
          console.warn(`[LinkedIn] Apollo backfill failed for lead ${lead.id}:`, err.message);
        }
      }

      if (!linkedInUrl) continue;

      try {
        const playbook = queryOne('SELECT * FROM company_playbooks WHERE company_id = ?', [lead.company_id]);
        const message = await claudeService.generateLinkedInMessage(enrichment, {
          company_description: playbook?.company_description,
          value_propositions: playbook?.value_propositions,
          target_icp: playbook?.target_icp,
          tone: playbook?.tone,
        });

        runSql(
          `UPDATE enrichment_leads SET linkedin_outreach_status = 'queued', linkedin_message = ?, updated_at = datetime('now') WHERE id = ?`,
          [message, lead.id],
        );
        saveDb();

        wsServer.broadcast({ type: 'enrichment_update', leadId: lead.id, linkedin_outreach_status: 'queued' });
        console.log(`[LinkedIn] Catch-up queued lead ${lead.id} (${lead.first_name} ${lead.last_name}) — score ${lead.score}`);
        queued++;
      } catch (err: any) {
        console.error(`[LinkedIn] Catch-up message gen failed for lead ${lead.id}:`, err.message);
      }
    }

    if (queued > 0) console.log(`[LinkedIn] Catch-up: queued ${queued} missed hot leads`);
    return queued;
  }

  // ── LinkedIn DM Sequence (Post-Connection) ──────────────

  /** Check for accepted connection requests and update lead statuses */
  async checkAcceptances(): Promise<number> {
    console.log('[LinkedIn] Checking for accepted connections...');

    let accepted: Awaited<ReturnType<typeof linkedInBrowserService.getAcceptedInvitations>>;
    try {
      accepted = await linkedInBrowserService.getAcceptedInvitations();
    } catch (err: any) {
      console.error('[LinkedIn] Failed to check acceptances:', err.message);
      return 0;
    }

    if (!accepted.length) {
      console.log('[LinkedIn] No accepted invitations found.');
      return 0;
    }

    // Get all leads with status 'sent' (connection request sent, awaiting acceptance)
    const sentLeads = queryAll(
      `SELECT id, enrichment_data, first_name, last_name FROM enrichment_leads
       WHERE linkedin_outreach_status = 'sent'`,
    ) as any[];

    let matched = 0;
    for (const invitation of accepted) {
      const vanity = invitation.vanityName?.toLowerCase();
      if (!vanity) continue;

      // Match against leads by vanity name in their LinkedIn URL
      const matchedLead = sentLeads.find((lead) => {
        const enrichment = (() => { try { return JSON.parse(lead.enrichment_data || '{}'); } catch { return {}; } })();
        const liUrl = (
          enrichment.linkedin_url
          || enrichment.apollo_person?.linkedin_url
          || enrichment.pdl_person?.linkedin_url
          || enrichment.linkedin_profile?.url
          || ''
        ).toLowerCase();
        return liUrl.includes(`/in/${vanity}`);
      });

      if (matchedLead) {
        runSql(
          `UPDATE enrichment_leads SET linkedin_outreach_status = 'connected', linkedin_connected_at = ?, linkedin_sequence_step = 0, updated_at = datetime('now') WHERE id = ?`,
          [invitation.acceptedAt || new Date().toISOString(), matchedLead.id],
        );
        saveDb();
        wsServer.broadcast({ type: 'enrichment_update', leadId: matchedLead.id, linkedin_outreach_status: 'connected' });
        console.log(`[LinkedIn] Connection accepted: lead ${matchedLead.id} (${matchedLead.first_name} ${matchedLead.last_name})`);
        matched++;

        // Remove from sentLeads so we don't double-match
        const idx = sentLeads.indexOf(matchedLead);
        if (idx >= 0) sentLeads.splice(idx, 1);
      }
    }

    if (matched > 0) console.log(`[LinkedIn] ${matched} new connections detected`);
    return matched;
  }

  /** Process DM sequence for connected leads */
  async processSequence(): Promise<{ sent: number; replied: number; errors: string[] }> {
    console.log('[LinkedIn] Processing DM sequence...');

    // Step delays: step 1 = 24h after connect, step 2 = 72h after step 1, step 3 = 168h after step 2
    const STEP_DELAYS_MS = [
      24 * 60 * 60 * 1000,   // Step 1: 24 hours
      72 * 60 * 60 * 1000,   // Step 2: 72 hours
      168 * 60 * 60 * 1000,  // Step 3: 168 hours (1 week)
    ];

    const leads = queryAll(
      `SELECT el.*, cp.company_description, cp.value_propositions, cp.target_icp, cp.tone, cp.booking_url
       FROM enrichment_leads el
       LEFT JOIN company_playbooks cp ON cp.company_id = el.company_id
       WHERE el.linkedin_outreach_status IN ('connected', 'messaging')
         AND el.linkedin_sequence_step < 3
       ORDER BY el.linkedin_sequence_step ASC, el.updated_at ASC`,
    ) as any[];

    if (!leads.length) {
      console.log('[LinkedIn] No leads in active sequence.');
      return { sent: 0, replied: 0, errors: [] };
    }

    let sent = 0;
    let replied = 0;
    const errors: string[] = [];

    for (const lead of leads) {
      const enrichment = (() => { try { return JSON.parse(lead.enrichment_data || '{}'); } catch { return {}; } })();
      const liUrl = (
        enrichment.linkedin_url
        || enrichment.apollo_person?.linkedin_url
        || enrichment.pdl_person?.linkedin_url
        || enrichment.linkedin_profile?.url
        || ''
      );
      const vanityMatch = liUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
      if (!vanityMatch) {
        errors.push(`Lead ${lead.id}: no vanity name in URL`);
        continue;
      }
      const vanityName = vanityMatch[1];

      // Check for reply first — if they replied, pause the sequence
      try {
        const replyCheck = await linkedInBrowserService.checkForReply(vanityName);
        if (replyCheck.hasReply) {
          runSql(
            `UPDATE enrichment_leads SET linkedin_outreach_status = 'replied', linkedin_dm_reply_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
            [lead.id],
          );
          // Record their reply in the DM messages table
          if (replyCheck.lastMessage) {
            runSql(
              `INSERT INTO linkedin_dm_messages (lead_id, step, direction, message, sent_at) VALUES (?, ?, 'inbound', ?, datetime('now'))`,
              [lead.id, lead.linkedin_sequence_step, replyCheck.lastMessage],
            );
          }
          saveDb();
          wsServer.broadcast({ type: 'enrichment_update', leadId: lead.id, linkedin_outreach_status: 'replied' });
          console.log(`[LinkedIn] Lead ${lead.id} (${lead.first_name} ${lead.last_name}) REPLIED — pausing sequence`);
          replied++;
          continue;
        }
      } catch (err: any) {
        console.warn(`[LinkedIn] Reply check failed for lead ${lead.id}:`, err.message);
      }

      // Check timing — is it time for the next step?
      const currentStep = lead.linkedin_sequence_step || 0;
      const referenceTime = currentStep === 0
        ? lead.linkedin_connected_at
        : lead.linkedin_last_dm_at;

      if (!referenceTime) {
        // No reference time — if step 0 and connected, use now as fallback
        if (currentStep === 0) {
          runSql(`UPDATE enrichment_leads SET linkedin_connected_at = datetime('now') WHERE id = ? AND linkedin_connected_at IS NULL`, [lead.id]);
          saveDb();
        }
        continue;
      }

      const elapsed = Date.now() - new Date(referenceTime).getTime();
      const requiredDelay = STEP_DELAYS_MS[currentStep];
      if (elapsed < requiredDelay) continue; // Not time yet

      // Generate DM for this step
      const nextStep = currentStep + 1;
      try {
        // Get previous DMs for context
        const previousDMs = queryAll(
          `SELECT step, direction, message FROM linkedin_dm_messages WHERE lead_id = ? ORDER BY created_at ASC`,
          [lead.id],
        ) as Array<{ step: number; direction: string; message: string }>;

        const dmText = await claudeService.generateLinkedInDM(
          nextStep,
          enrichment,
          {
            company_description: lead.company_description,
            value_propositions: lead.value_propositions,
            target_icp: lead.target_icp,
            tone: lead.tone,
            booking_url: lead.booking_url,
          },
          lead.linkedin_message || '',
          previousDMs,
        );

        // Send the DM
        const sendResult = await linkedInBrowserService.sendDirectMessage(vanityName, dmText);
        if (!sendResult.success) {
          throw new Error(sendResult.error || 'DM send failed');
        }

        // Record the message
        runSql(
          `INSERT INTO linkedin_dm_messages (lead_id, step, direction, message, sent_at) VALUES (?, ?, 'outbound', ?, datetime('now'))`,
          [lead.id, nextStep, dmText],
        );

        // Update lead status
        const newStatus = nextStep >= 3 ? 'sequence_done' : 'messaging';
        runSql(
          `UPDATE enrichment_leads SET linkedin_outreach_status = ?, linkedin_sequence_step = ?, linkedin_last_dm_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
          [newStatus, nextStep, lead.id],
        );
        saveDb();
        wsServer.broadcast({ type: 'enrichment_update', leadId: lead.id, linkedin_outreach_status: newStatus, linkedin_sequence_step: nextStep });
        console.log(`[LinkedIn] DM step ${nextStep} sent to lead ${lead.id} (${lead.first_name} ${lead.last_name})`);
        sent++;

        // Delay between DMs
        await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 5000));
      } catch (err: any) {
        console.error(`[LinkedIn] DM step ${nextStep} failed for lead ${lead.id}:`, err.message);
        errors.push(`Lead ${lead.id} step ${nextStep}: ${err.message}`);
      }
    }

    console.log(`[LinkedIn] Sequence processing done: ${sent} DMs sent, ${replied} replies detected`);
    return { sent, replied, errors };
  }

  /** Full daily run: catch up missed leads, then send the queue */
  async runDailyOutreach(): Promise<{
    newlyQueued: number;
    sent: number;
    failed: number;
    errors: Array<{ leadId: number; error: string }>;
  }> {
    console.log('[LinkedIn] === Daily Outreach Run ===');

    // Step 1: Queue any missed hot leads
    const newlyQueued = await this.queueMissedHotLeads();

    // Step 2: Send the queue
    const result = await this.processOutreachQueue();

    console.log(`[LinkedIn] Daily run complete: ${newlyQueued} newly queued, ${result.sent} sent, ${result.failed} failed`);
    return { newlyQueued, ...result };
  }
}

export const linkedInService = new LinkedInService();
