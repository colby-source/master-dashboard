import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

// Persistent Chrome profile for LinkedIn automation.
// User logs in once manually; cookies persist across restarts.
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = path.join(process.env.USERPROFILE || 'C:\\Users\\colby', '.linkedin-automation');
const CDP_PORT = 9223; // Separate from any user Chrome instance

interface VoyagerProfile {
  profileUrn: string;
  firstName: string;
  lastName: string;
  headline: string;
}

class LinkedInBrowserService {
  private browser: Browser | null = null;
  private launching = false;

  /** Launch Chrome with persistent profile (or reconnect if already running) */
  async ensureBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;

    // Try connecting to existing instance first
    try {
      this.browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}` });
      if (this.browser.connected) {
        console.log('[LinkedIn Browser] Reconnected to existing Chrome');
        return this.browser;
      }
    } catch {
      // Not running, launch fresh
    }

    if (this.launching) {
      // Wait for another launch call to complete
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (this.browser?.connected) return this.browser;
      throw new Error('Chrome launch already in progress');
    }

    this.launching = true;
    try {
      // Ensure profile dir exists
      if (!fs.existsSync(PROFILE_DIR)) {
        fs.mkdirSync(PROFILE_DIR, { recursive: true });
      }

      console.log('[LinkedIn Browser] Launching Chrome with persistent profile...');
      this.browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        userDataDir: PROFILE_DIR,
        headless: false, // Must be visible so user can log in
        args: [
          `--remote-debugging-port=${CDP_PORT}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--window-size=1280,900',
        ],
        defaultViewport: null,
      });

      // Handle disconnect
      this.browser.on('disconnected', () => {
        console.log('[LinkedIn Browser] Chrome disconnected');
        this.browser = null;
      });

      console.log('[LinkedIn Browser] Chrome launched successfully');
      return this.browser;
    } finally {
      this.launching = false;
    }
  }

  /** Get or create a LinkedIn tab */
  private async getLinkedInPage(): Promise<Page> {
    const browser = await this.ensureBrowser();
    const pages = await browser.pages();

    // Find existing LinkedIn tab
    for (const page of pages) {
      const url = page.url();
      if (url.includes('linkedin.com') && !url.includes('/login') && !url.includes('/authwall')) {
        return page;
      }
    }

    // No authenticated LinkedIn tab — navigate to LinkedIn
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Check if we got redirected to login
    const url = page.url();
    if (url.includes('/login') || url.includes('/authwall')) {
      throw new Error(
        'LinkedIn login required. Please log into LinkedIn in the automation Chrome window, then retry.'
      );
    }

    return page;
  }

  /** Check if LinkedIn session is authenticated */
  async isAuthenticated(): Promise<boolean> {
    try {
      const page = await this.getLinkedInPage();
      return !page.url().includes('/login') && !page.url().includes('/authwall');
    } catch {
      return false;
    }
  }

  /** Open LinkedIn login page for manual auth */
  async openLoginPage(): Promise<void> {
    const browser = await this.ensureBrowser();
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('[LinkedIn Browser] Login page opened — user must log in manually');
  }

  /** Look up a LinkedIn profile URN by vanity name */
  async lookupProfile(vanityName: string): Promise<VoyagerProfile> {
    const page = await this.getLinkedInPage();

    const result = await page.evaluate(async (vanity: string) => {
      const csrfToken = document.cookie.match(/JSESSIONID="?([^";]+)/)?.[1] || '';
      const res = await fetch(
        `https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${vanity}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-19`,
        {
          headers: {
            'csrf-token': csrfToken,
            'x-restli-protocol-version': '2.0.0',
          },
        }
      );

      if (!res.ok) {
        return { error: `Profile lookup failed: ${res.status}` };
      }

      const data = await res.json() as any;
      const el = data.elements?.[0];

      if (!el) {
        return { error: 'Profile not found in response' };
      }

      // Extract fsd_profile URN from experienceCardUrn or objectUrn
      // experienceCardUrn format: urn:li:fsd_profileCard:(PROFILE_ID,EXPERIENCE,en_US)
      let profileUrn = el.entityUrn || '';
      if (!profileUrn.includes('fsd_profile')) {
        const cardUrn = el.experienceCardUrn || '';
        const idMatch = cardUrn.match(/\(([^,)]+)/);
        if (idMatch) {
          profileUrn = `urn:li:fsd_profile:${idMatch[1]}`;
        }
      }

      return {
        profileUrn,
        firstName: el.firstName || '',
        lastName: el.lastName || '',
        headline: el.headline || '',
      };
    }, vanityName);

    if ('error' in result) throw new Error(result.error as string);
    return result as VoyagerProfile;
  }

  /** Send a LinkedIn connection request via Voyager API */
  async sendConnectionRequest(profileUrl: string, message: string): Promise<{ success: boolean; invitationUrn?: string; error?: string }> {
    // Extract vanity name from URL
    const vanityMatch = profileUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
    if (!vanityMatch) {
      return { success: false, error: `Invalid LinkedIn URL: ${profileUrl}` };
    }
    const vanityName = vanityMatch[1];

    // Look up profile URN
    let profileUrn: string;
    try {
      const profile = await this.lookupProfile(vanityName);
      profileUrn = profile.profileUrn;
      console.log(`[LinkedIn Browser] Found profile: ${profile.firstName} ${profile.lastName} (${profileUrn})`);
    } catch (err: any) {
      return { success: false, error: `Profile lookup failed: ${err.message}` };
    }

    // Send connection request
    const page = await this.getLinkedInPage();
    const truncatedMessage = message.slice(0, 280);

    const result = await page.evaluate(async (urn: string, msg: string) => {
      const csrfToken = document.cookie.match(/JSESSIONID="?([^";]+)/)?.[1] || '';
      try {
        const res = await fetch(
          'https://www.linkedin.com/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreate',
          {
            method: 'POST',
            headers: {
              'csrf-token': csrfToken,
              'x-restli-protocol-version': '2.0.0',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              inviteeProfileUrn: urn,
              customMessage: msg,
            }),
          }
        );

        if (!res.ok) {
          const text = await res.text();
          return { success: false, error: `Voyager API ${res.status}: ${text.slice(0, 200)}` };
        }

        const data = await res.json() as any;
        return {
          success: true,
          invitationUrn: data.value?.invitationUrn || data.value?.entityUrn || 'sent',
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }, profileUrn, truncatedMessage);

    if (result.success) {
      console.log(`[LinkedIn Browser] Connection sent to ${vanityName}: ${result.invitationUrn}`);
    } else {
      console.error(`[LinkedIn Browser] Failed for ${vanityName}: ${result.error}`);
    }

    return result;
  }

  /** Check sent invitations and return those that were accepted */
  async getAcceptedInvitations(): Promise<Array<{
    profileUrn: string;
    vanityName: string;
    firstName: string;
    lastName: string;
    acceptedAt: string;
  }>> {
    const page = await this.getLinkedInPage();

    const result = await page.evaluate(async () => {
      const csrfToken = document.cookie.match(/JSESSIONID="?([^";]+)/)?.[1] || '';
      try {
        // Fetch sent invitations — LinkedIn returns recently accepted ones too
        const res = await fetch(
          'https://www.linkedin.com/voyager/api/relationships/sentInvitationViewEntities?invitationType=CONNECTION&start=0&count=100&q=invitationType',
          {
            headers: {
              'csrf-token': csrfToken,
              'x-restli-protocol-version': '2.0.0',
            },
          }
        );
        if (!res.ok) return { error: `Invitations API ${res.status}`, accepted: [] };
        const data = await res.json() as any;
        const elements = data.elements || [];
        // Filter to accepted invitations
        const accepted = elements
          .filter((el: any) => el.invitation?.status === 'ACCEPTED')
          .map((el: any) => {
            const invitee = el.invitation?.toMember || {};
            const vanity = (invitee.publicIdentifier || invitee.vanityName || '');
            return {
              profileUrn: invitee.entityUrn || '',
              vanityName: vanity,
              firstName: invitee.firstName || '',
              lastName: invitee.lastName || '',
              acceptedAt: el.invitation?.sentTime ? new Date(el.invitation.sentTime).toISOString() : new Date().toISOString(),
            };
          });
        return { accepted };
      } catch (err: any) {
        return { error: err.message, accepted: [] };
      }
    });

    if ('error' in result && result.error) {
      console.warn(`[LinkedIn Browser] getAcceptedInvitations warning: ${result.error}`);
    }
    return result.accepted || [];
  }

  /** Send a direct message to a 1st-degree connection via Voyager messaging API */
  async sendDirectMessage(vanityName: string, messageText: string): Promise<{ success: boolean; error?: string }> {
    const page = await this.getLinkedInPage();

    // First look up the profile to get the member URN
    let profileUrn: string;
    try {
      const profile = await this.lookupProfile(vanityName);
      profileUrn = profile.profileUrn;
    } catch (err: any) {
      return { success: false, error: `Profile lookup failed: ${err.message}` };
    }

    // Extract the member ID from the fsd_profile URN
    // Format: urn:li:fsd_profile:ABC123 → we need urn:li:member:ABC123
    // Or we can use the miniProfile approach
    const memberIdMatch = profileUrn.match(/fsd_profile:(.+)/);
    if (!memberIdMatch) {
      return { success: false, error: `Could not extract member ID from URN: ${profileUrn}` };
    }
    const memberId = memberIdMatch[1];

    const result = await page.evaluate(async (mId: string, msg: string) => {
      const csrfToken = document.cookie.match(/JSESSIONID="?([^";]+)/)?.[1] || '';
      try {
        // Use the messaging API to send a DM
        const res = await fetch(
          'https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage',
          {
            method: 'POST',
            headers: {
              'csrf-token': csrfToken,
              'x-restli-protocol-version': '2.0.0',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              dedupeByClientGeneratedToken: false,
              mailboxUrn: 'urn:li:fsd_profile:me',
              message: {
                body: {
                  text: msg,
                },
                originToken: crypto.randomUUID(),
                renderContentUnions: [],
              },
              hostRecipientUrns: [`urn:li:fsd_profile:${mId}`],
            }),
          }
        );

        if (!res.ok) {
          const text = await res.text();
          return { success: false, error: `Messaging API ${res.status}: ${text.slice(0, 200)}` };
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }, memberId, messageText);

    if (result.success) {
      console.log(`[LinkedIn Browser] DM sent to ${vanityName}`);
    } else {
      console.error(`[LinkedIn Browser] DM failed for ${vanityName}: ${result.error}`);
    }
    return result;
  }

  /** Check if a specific profile has replied to our messages */
  async checkForReply(vanityName: string): Promise<{ hasReply: boolean; lastMessage?: string }> {
    const page = await this.getLinkedInPage();

    let profileUrn: string;
    try {
      const profile = await this.lookupProfile(vanityName);
      profileUrn = profile.profileUrn;
    } catch {
      return { hasReply: false };
    }

    const memberIdMatch = profileUrn.match(/fsd_profile:(.+)/);
    if (!memberIdMatch) return { hasReply: false };
    const memberId = memberIdMatch[1];

    const result = await page.evaluate(async (mId: string) => {
      const csrfToken = document.cookie.match(/JSESSIONID="?([^";]+)/)?.[1] || '';
      try {
        // Get conversation with this person
        const res = await fetch(
          `https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerConversations?q=participants&participants=List(urn%3Ali%3Afsd_profile%3A${encodeURIComponent(mId)})&count=1`,
          {
            headers: {
              'csrf-token': csrfToken,
              'x-restli-protocol-version': '2.0.0',
            },
          }
        );
        if (!res.ok) return { hasReply: false };
        const data = await res.json() as any;
        const convo = data.elements?.[0];
        if (!convo) return { hasReply: false };

        // Check if the last message is from them (not us)
        const lastMsg = convo.lastMessage;
        if (!lastMsg) return { hasReply: false };

        const senderUrn = lastMsg.sender?.entityUrn || '';
        const isFromThem = senderUrn.includes(mId);
        return {
          hasReply: isFromThem,
          lastMessage: isFromThem ? (lastMsg.body?.text || '') : undefined,
        };
      } catch {
        return { hasReply: false };
      }
    }, memberId);

    return result;
  }

  /** Close the automation browser */
  async close(): Promise<void> {
    if (this.browser?.connected) {
      await this.browser.close();
      this.browser = null;
      console.log('[LinkedIn Browser] Chrome closed');
    }
  }

  /** Get browser status */
  get status(): { running: boolean; connected: boolean } {
    return {
      running: this.browser !== null,
      connected: this.browser?.connected || false,
    };
  }
}

export const linkedInBrowserService = new LinkedInBrowserService();
