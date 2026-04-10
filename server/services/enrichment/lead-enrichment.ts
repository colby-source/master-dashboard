import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { config } from '../../config';
import { pdlClient } from '../pdl-client';
import { apolloClient } from '../apollo-client';
import { millionverifierClient } from '../millionverifier-client';
import { hunterClient } from '../hunter-client';
import { linkedInService } from '../linkedin-service';
import { ghlService } from '../ghl-service';
import { wsServer } from '../../websocket/ws-server';
import { createAlert } from '../alert-service';
import { EnrichmentLead } from './types';
import { getCompanyConfig, updateLead, logEvent } from './helpers';
import { prefilterEmail } from './email-prefilter';
import { BMN_COMPANY_ID } from '../bmn/config';

export async function enrichLead(leadId: number): Promise<boolean> {
  const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
  if (!lead) return false;

  // BMN NEVER runs through enrichment — creators use personal
  // emails and don't need B2B enrichment/scoring. They flow: Instantly → GHL directly.
  if (lead.company_id === BMN_COMPANY_ID) {
    console.log(`[Enrichment] Skipping enrichment for BMN lead ${leadId} (${lead.email})`);
    return false;
  }

  updateLead(leadId, { status: 'enriching' });
  logEvent(leadId, lead.company_id, 'enrichment_started', null);

  try {
    const enrichmentData: any = {};
    const existingEnrichment = lead.enrichment_data ? (() => { try { return JSON.parse(lead.enrichment_data); } catch { return {}; } })() : {};

    // ── Tier 0: Free pre-filter (MX check + personal domain block) ──
    if (lead.email) {
      const prefilter = await prefilterEmail(lead.email, { companyId: lead.company_id });
      enrichmentData.prefilter = prefilter;

      if (!prefilter.passed) {
        // Still mark as enriched but flag why it was filtered
        updateLead(leadId, {
          enrichment_data: JSON.stringify(enrichmentData),
          status: 'enriched',
          instantly_push_status: 'excluded',
          enrichment_completeness: 10,
          enriched_at: new Date().toISOString(),
        });
        logEvent(leadId, lead.company_id, 'prefilter_rejected', {
          reason: prefilter.reason,
          domain: prefilter.domain,
        });
        saveDb();
        wsServer.broadcast({ type: 'enrichment_update', leadId, status: 'enriched' });
        return true;
      }
    }

    // ── Tier 1: Cheap enrichment (Apollo + MillionVerifier) ──
    // Apollo person + org enrichment replaces PDL ($0 vs $0.38/lead)
    // MillionVerifier replaces Hunter+AMF ($0.0003 vs $0.038/lead)
    const wave1: Promise<void>[] = [];

    // Apollo person enrichment (free — 10K credits/mo)
    if (lead.email && apolloClient.available) {
      wave1.push(
        apolloClient.enrichPerson({ email: lead.email }).then(apolloPerson => {
          if (apolloPerson) {
            enrichmentData.apollo_person = apolloPerson;
            if (!lead.first_name && apolloPerson.first_name) {
              updateLead(leadId, { first_name: apolloPerson.first_name });
            }
            if (!lead.last_name && apolloPerson.last_name) {
              updateLead(leadId, { last_name: apolloPerson.last_name });
            }
          }
        }).catch(err => { console.warn(`[Enrichment] Apollo person failed:`, err.message); })
      );
    }

    // Apollo org enrichment (free — from email domain)
    if (lead.email && apolloClient.available) {
      const domain = lead.email.split('@')[1];
      if (domain) {
        wave1.push(
          apolloClient.enrichOrganization({ domain }).then(apolloOrg => {
            if (apolloOrg) enrichmentData.apollo_org = apolloOrg;
          }).catch(err => { console.warn(`[Enrichment] Apollo org failed:`, err.message); })
        );
      }
    }

    // MillionVerifier email verification ($0.0003/email)
    if (lead.email && millionverifierClient.available) {
      wave1.push(
        millionverifierClient.verifyEmail(lead.email).then(mvResult => {
          if (mvResult) enrichmentData.email_verify = mvResult;
        }).catch(err => { console.warn(`[Enrichment] MillionVerifier failed:`, err.message); })
      );
    }

    await Promise.all(wave1);

    // ── Tier 2: LinkedIn scrape (depends on Apollo/PDL for linkedin_url) ──
    const linkedInUrl = enrichmentData.apollo_person?.linkedin_url
      || enrichmentData.pdl_person?.linkedin_url
      || existingEnrichment.linkedin_url;
    if (linkedInUrl) {
      try {
        // Check cache first (90-day TTL)
        const liCacheKey = `linkedin:${linkedInUrl}`;
        const cachedLi = queryOne(
          `SELECT response_data FROM enrichment_cache WHERE cache_key = ? AND created_at > datetime('now', '-90 days')`,
          [liCacheKey]
        );

        if (cachedLi?.response_data) {
          // Use cached LinkedIn profile
          enrichmentData.linkedin_profile = JSON.parse(cachedLi.response_data);
          console.log(`[Enrichment] LinkedIn cache hit for ${linkedInUrl}`);
        } else {
          // Scrape fresh and cache the result
          const profiles = await linkedInService.scrapeProfiles([linkedInUrl], 1);
          if (profiles?.length > 0) {
            const liProfile = profiles[0];
            enrichmentData.linkedin_profile = {
              headline: liProfile.headline || liProfile.title || '',
              summary: liProfile.summary || liProfile.about || '',
              experience: (liProfile.experience || liProfile.positions || []).slice(0, 5),
              education: (liProfile.education || []).slice(0, 3),
              skills: (liProfile.skills || []).slice(0, 10),
              location: liProfile.location || liProfile.addressLocality || '',
              connections: liProfile.connectionCount || liProfile.connections || null,
              recentPosts: (liProfile.posts || []).slice(0, 3).map((p: any) => ({
                text: (p.text || p.postContent || '').slice(0, 300),
                date: p.postedDate || p.date || '',
                likes: p.likeCount || p.numLikes || 0,
              })),
            };

            // Store in enrichment_cache
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 90);
            runSql(
              `INSERT OR REPLACE INTO enrichment_cache (cache_key, provider, response_data, expires_at) VALUES (?, ?, ?, ?)`,
              [liCacheKey, 'linkedin', JSON.stringify(enrichmentData.linkedin_profile), expiresAt.toISOString()]
            );
          }
        }

        // Backfill name from LinkedIn profile if missing
        const liData = enrichmentData.linkedin_profile;
        if (liData) {
          if (!lead.first_name && (liData.firstName || liData.first_name)) {
            updateLead(leadId, { first_name: liData.firstName || liData.first_name });
          }
          if (!lead.last_name && (liData.lastName || liData.last_name)) {
            updateLead(leadId, { last_name: liData.lastName || liData.last_name });
          }
        }
      } catch (liErr: any) {
        console.warn(`[Enrichment] LinkedIn scrape failed for ${linkedInUrl}:`, liErr.message);
      }
    }

    // ── Tier 3: Email finding fallback (if no email) ──
    if (!lead.email && lead.first_name && lead.last_name) {
      const orgDomain = enrichmentData.apollo_org?.website
        || enrichmentData.apollo_person?.organization_website
        || enrichmentData.pdl_company?.website;

      // Try Apollo person match by name + domain
      if (apolloClient.available && orgDomain) {
        const apolloByName = await apolloClient.enrichPerson({
          first_name: lead.first_name,
          last_name: lead.last_name,
          domain: orgDomain,
        });
        if (apolloByName?.email) {
          enrichmentData.apollo_found = apolloByName;
          updateLead(leadId, { email: apolloByName.email });
        }
      }

      // Fallback to Hunter email finder
      const currentLead = queryOne('SELECT email FROM enrichment_leads WHERE id = ?', [leadId]);
      if (!currentLead?.email && hunterClient.available && orgDomain) {
        const found = await hunterClient.findEmail(orgDomain, lead.first_name, lead.last_name);
        if (found?.email) {
          enrichmentData.hunter_found = found;
          updateLead(leadId, { email: found.email });
        }
      }
    }

    // Check known contact status
    const freshLead = queryOne('SELECT email FROM enrichment_leads WHERE id = ?', [leadId]);
    const emailForCheck = freshLead?.email || lead.email;
    const isKnown = await checkKnownContact(emailForCheck, lead.company_id);

    // Determine cold email eligibility
    const coldEmailStatus = await determineColdEmailStatus(lead, enrichmentData);

    // Check email verification — exclude invalid emails from cold outreach
    const emailInvalid = enrichmentData.email_verify
      ? millionverifierClient.isInvalid(enrichmentData.email_verify)
      : false;

    // Calculate enrichment completeness score (0-100)
    const completeness = calculateEnrichmentCompleteness(lead, enrichmentData);

    updateLead(leadId, {
      enrichment_data: JSON.stringify(enrichmentData),
      status: 'enriched',
      is_known_contact: isKnown ? 1 : 0,
      instantly_push_status: isKnown ? 'excluded' : emailInvalid ? 'excluded' : coldEmailStatus,
      enrichment_completeness: completeness,
      enriched_at: new Date().toISOString(),
    });

    logEvent(leadId, lead.company_id, 'enrichment_complete', {
      has_apollo: !!enrichmentData.apollo_person,
      has_apollo_org: !!enrichmentData.apollo_org,
      has_pdl: !!enrichmentData.pdl_person,
      has_linkedin: !!enrichmentData.linkedin_profile,
      has_email_verify: !!enrichmentData.email_verify,
      email_valid: enrichmentData.email_verify ? !millionverifierClient.isInvalid(enrichmentData.email_verify) : null,
      is_known_contact: isKnown,
      cold_email_status: isKnown ? 'excluded' : emailInvalid ? 'excluded' : coldEmailStatus,
    });

    saveDb();
    wsServer.broadcast({ type: 'enrichment_update', leadId, status: 'enriched' });
    return true;
  } catch (err: any) {
    console.error(`[Enrichment] enrichLead(${leadId}) error:`, err.message);
    updateLead(leadId, {
      status: 'failed',
      error_message: err.message,
      retry_count: (lead.retry_count || 0) + 1,
    });
    logEvent(leadId, lead.company_id, 'error', { error: err.message });
    return false;
  }
}

/**
 * Deep-enrich a lead with PDL data. Only called for high-score leads (>= 70)
 * after initial scoring. Costs $0.28 (person) + $0.10 (company) = $0.38.
 */
export async function deepEnrichWithPdl(leadId: number): Promise<boolean> {
  const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
  if (!lead || !lead.email) return false;

  try {
    const enrichmentData = lead.enrichment_data ? JSON.parse(lead.enrichment_data) : {};

    // Skip if already has PDL data
    if (enrichmentData.pdl_person) return true;

    const deepWaves: Promise<void>[] = [];

    if (pdlClient.available) {
      deepWaves.push(
        pdlClient.enrichPerson(lead.email).then(pdlPerson => {
          if (pdlPerson) enrichmentData.pdl_person = pdlPerson;
        }).catch(err => { console.warn(`[DeepEnrich] PDL person failed:`, err.message); })
      );

      const domain = lead.email.split('@')[1];
      if (domain) {
        deepWaves.push(
          pdlClient.enrichCompany(domain).then(pdlCompany => {
            if (pdlCompany) enrichmentData.pdl_company = pdlCompany;
          }).catch(err => { console.warn(`[DeepEnrich] PDL company failed:`, err.message); })
        );
      }
    }

    await Promise.all(deepWaves);

    updateLead(leadId, {
      enrichment_data: JSON.stringify(enrichmentData),
    });
    logEvent(leadId, lead.company_id, 'deep_enrichment_complete', {
      has_pdl_person: !!enrichmentData.pdl_person,
      has_pdl_company: !!enrichmentData.pdl_company,
    });
    saveDb();
    return true;
  } catch (err: any) {
    console.error(`[DeepEnrich] deepEnrichWithPdl(${leadId}) error:`, err.message);
    return false;
  }
}

export async function reEnrichStale(companyId?: number): Promise<number> {
  // Import processLead lazily to avoid circular dependency
  const { processLead } = await import('./lead-processing');

  const staleDays = config.enrichmentStaleDays;
  const params: any[] = [];
  let where = `WHERE enriched_at < datetime('now', '-${staleDays} days') AND status != 'failed'`;
  if (companyId) {
    where += ' AND company_id = ?';
    params.push(companyId);
  }

  const staleLeads = queryAll(`SELECT id FROM enrichment_leads ${where} LIMIT 50`, params);
  let count = 0;

  for (const lead of staleLeads) {
    const ok = await processLead(lead.id);
    if (ok) count++;
  }

  if (count > 0) {
    createAlert('enrichment', 'info', `Re-enriched ${count} stale leads`, 'enrichment-service');
  }

  return count;
}

export async function checkKnownContact(email: string | null, companyId: number): Promise<boolean> {
  if (!email) return false;

  // Check known_contacts table
  const known = queryOne(
    'SELECT id FROM known_contacts WHERE email = ? AND (company_id = ? OR company_id IS NULL)',
    [email.toLowerCase(), companyId]
  );
  if (known) return true;

  // Check GHL for existing contact with interactions
  const ghlClient = ghlService.getClient(companyId);
  if (ghlClient) {
    try {
      const result = await ghlClient.searchContacts(email);
      const contacts = result?.contacts || [];
      for (const contact of contacts) {
        if (contact.email === email && contact.tags?.length > 0) {
          return true; // Has tags = existing relationship
        }
      }
    } catch {
      // GHL search failed, not a blocker
    }
  }

  return false;
}

export async function determineColdEmailStatus(lead: EnrichmentLead, enrichmentData: any): Promise<string> {
  const companyConfig = getCompanyConfig(lead.company_id);

  // Check exclusion rules
  const rules = queryAll(
    'SELECT * FROM cold_email_rules WHERE active = 1 AND (company_id = ? OR company_id IS NULL)',
    [lead.company_id]
  );

  for (const rule of rules) {
    if (rule.rule_type === 'source_exclude' && lead.source === rule.rule_value) {
      return 'excluded';
    }
    if (rule.rule_type === 'domain_exclude' && lead.email) {
      const domain = lead.email.split('@')[1]?.toLowerCase();
      if (domain === rule.rule_value.toLowerCase()) {
        return 'excluded';
      }
      // Also check if lead came FROM this domain (e.g., granitepark.co website leads)
      if (lead.source?.toLowerCase().includes(rule.rule_value.toLowerCase())) {
        return 'excluded';
      }
    }
    if (rule.rule_type === 'tag_exclude' && lead.tags) {
      const tags = JSON.parse(lead.tags);
      if (tags.includes(rule.rule_value)) {
        return 'excluded';
      }
    }
  }

  // Check email verification — don't cold email invalid emails
  const emailVerify = enrichmentData?.email_verify;
  if (emailVerify && millionverifierClient.isInvalid(emailVerify)) {
    return 'excluded';
  }
  // Fallback: check legacy verification data
  const hunterVerify = enrichmentData?.hunter_verify;
  if (hunterVerify && hunterVerify.status === 'invalid') {
    return 'excluded';
  }

  // Default: requires manual approval
  if (companyConfig?.cold_email_requires_approval) {
    return 'awaiting_approval';
  }

  return 'awaiting_approval'; // Always default to manual
}

export async function importKnownContactsFromGhl(companyId: number): Promise<number> {
  const ghlClient = ghlService.getClient(companyId);
  if (!ghlClient) return 0;

  console.log(`[KnownContacts] Starting GHL import for company ${companyId}...`);
  const contacts = await ghlClient.getAllContacts();
  let imported = 0;
  let checked = 0;

  for (const contact of contacts) {
    if (!contact.email) continue;
    checked++;

    const exists = queryOne(
      'SELECT id FROM known_contacts WHERE email = ? AND company_id = ?',
      [contact.email.toLowerCase(), companyId]
    );
    if (exists) continue;

    runSql(
      'INSERT INTO known_contacts (company_id, email, first_name, last_name, source) VALUES (?, ?, ?, ?, ?)',
      [companyId, contact.email.toLowerCase(), contact.firstName || null, contact.lastName || null, 'ghl_import']
    );
    imported++;

    if (imported % 100 === 0) {
      console.log(`[KnownContacts] Progress: ${imported} new contacts imported (${checked} checked so far)`);
    }
  }

  if (imported > 0) saveDb();
  console.log(`[KnownContacts] Imported ${imported} new known contacts from GHL (${checked} total checked)`);
  return imported;
}

/**
 * Calculate enrichment data completeness as a 0-100 score.
 * Weights: email (20), name (15), person data (20), org data (15),
 * LinkedIn (15), email verification (10), phone (5).
 */
function calculateEnrichmentCompleteness(lead: EnrichmentLead, enrichmentData: any): number {
  let score = 0;

  if (lead.email) score += 20;
  if (lead.first_name && lead.last_name) score += 15;
  if (lead.phone) score += 5;

  // Person data (Apollo or PDL)
  const person = enrichmentData.apollo_person || enrichmentData.pdl_person;
  if (person) {
    score += 10;
    const title = person.title || person.job_title;
    const liUrl = person.linkedin_url;
    if (title) score += 5;
    if (liUrl) score += 5;
  }

  // Org data (Apollo or PDL)
  if (enrichmentData.apollo_org || enrichmentData.pdl_company) score += 15;
  if (enrichmentData.linkedin_profile) score += 15;

  // Email verification (MillionVerifier, Hunter, or AMF)
  if (enrichmentData.email_verify || enrichmentData.hunter_verify || enrichmentData.amf_verify) score += 10;

  return Math.min(score, 100);
}
