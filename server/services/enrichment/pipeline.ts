import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { config } from '../../config';
import { pdlClient } from '../pdl-client';
import { apolloClient } from '../apollo-client';
import { millionverifierClient } from '../millionverifier-client';
import { hunterClient } from '../hunter-client';
import { anymailfinderClient } from '../anymailfinder-client';
import { linkedInService } from '../linkedin-service';
import { ghlService } from '../ghl-service';
import { instantlyService } from '../instantly-service';
import { wsServer } from '../../websocket/ws-server';
import { createAlert } from '../alert-service';
import { EnrichmentLead } from './types';
import { getCompanyConfig, updateLead, logEvent } from './helpers';
import { scoreLead } from './scoring';
import { syncOpportunityStage } from './opportunity-pipeline';
import { prefilterEmail } from './email-prefilter';
import { claudeService } from '../claude-service';
import { generateEmailSequence, sequenceToCustomVariables } from './email-generator';

export async function enrichLead(leadId: number): Promise<boolean> {
  const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
  if (!lead) return false;

  // BMN (company_id=2) NEVER runs through enrichment — creators use personal
  // emails and don't need B2B enrichment/scoring. They flow: Instantly → GHL directly.
  if (lead.company_id === 2) {
    console.log(`[Enrichment] Skipping enrichment for BMN lead ${leadId} (${lead.email})`);
    return false;
  }

  updateLead(leadId, { status: 'enriching' });
  logEvent(leadId, lead.company_id, 'enrichment_started', null);

  try {
    let enrichmentData: any = {};
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

// Enrichment custom field definitions for GHL contact cards
const ENRICHMENT_CUSTOM_FIELDS = [
  { name: 'Enrichment Score', dataType: 'NUMERICAL', key: 'score' },
  { name: 'Score Label', dataType: 'TEXT', key: 'score_label' },
  { name: 'Score Reasoning', dataType: 'LARGE_TEXT', key: 'score_reasoning' },
  { name: 'Job Title', dataType: 'TEXT', key: 'job_title' },
  { name: 'Company', dataType: 'TEXT', key: 'company_name' },
  { name: 'Industry', dataType: 'TEXT', key: 'industry' },
  { name: 'LinkedIn URL', dataType: 'TEXT', key: 'linkedin_url' },
  { name: 'Location', dataType: 'TEXT', key: 'location' },
  { name: 'Email Verified', dataType: 'TEXT', key: 'email_verified' },
  { name: 'Enrichment Source', dataType: 'TEXT', key: 'enrichment_source' },
] as const;

// Cache of custom field IDs per company to avoid repeated API calls
const customFieldCache = new Map<number, Map<string, string>>();

async function ensureCustomFields(companyId: number): Promise<Map<string, string>> {
  // Return cached mapping if available
  const cached = customFieldCache.get(companyId);
  if (cached && cached.size > 0) return cached;

  const ghlClient = ghlService.getClient(companyId);
  if (!ghlClient) return new Map();

  const fieldMap = new Map<string, string>();

  // Get existing custom fields
  const existing = await ghlClient.getCustomFields();
  const existingByName = new Map(existing.map((f: any) => [f.name, f.id]));

  for (const fieldDef of ENRICHMENT_CUSTOM_FIELDS) {
    const existingId = existingByName.get(fieldDef.name);
    if (existingId) {
      fieldMap.set(fieldDef.key, existingId);
    } else {
      // Create the custom field
      const created = await ghlClient.createCustomField({
        name: fieldDef.name,
        dataType: fieldDef.dataType,
      });
      if (created?.id) {
        fieldMap.set(fieldDef.key, created.id);
        console.log(`[Enrichment] Created GHL custom field: ${fieldDef.name} (${created.id})`);
      }
    }
  }

  customFieldCache.set(companyId, fieldMap);
  return fieldMap;
}

export async function pushToGhl(leadId: number): Promise<boolean> {
  const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
  if (!lead) return false;

  const companyConfig = getCompanyConfig(lead.company_id);
  const ghlClient = ghlService.getClient(lead.company_id);
  if (!ghlClient) {
    console.error(`[Enrichment] No GHL client for company ${lead.company_id}`);
    return false;
  }

  try {
    const enrichmentData = lead.enrichment_data ? JSON.parse(lead.enrichment_data) : {};
    // Prefer Apollo data, fall back to PDL for deep-enriched leads
    const apolloPerson = enrichmentData.apollo_person;
    const apolloOrg = enrichmentData.apollo_org;
    const pdlPerson = enrichmentData.pdl_person;
    const pdlCompany = enrichmentData.pdl_company;
    const liProfile = enrichmentData.linkedin_profile;

    // Ensure enrichment custom fields exist in GHL
    const fieldMap = await ensureCustomFields(lead.company_id);

    // Build standard field updates
    const updates: any = {};
    const companyName = apolloPerson?.organization_name || apolloOrg?.name || pdlPerson?.job_company_name || pdlCompany?.name;
    if (companyName) updates.companyName = companyName;

    const linkedInUrl = apolloPerson?.linkedin_url || pdlPerson?.linkedin_url;
    if (linkedInUrl) updates.website = linkedInUrl;

    // Build custom field values for contact card
    const customField: Record<string, string | number> = {};

    if (lead.score !== null && lead.score !== undefined && fieldMap.has('score')) {
      customField[fieldMap.get('score')!] = lead.score;
    }
    if (lead.score_label && fieldMap.has('score_label')) {
      customField[fieldMap.get('score_label')!] = lead.score_label.toUpperCase();
    }
    if (lead.score_reasoning && fieldMap.has('score_reasoning')) {
      customField[fieldMap.get('score_reasoning')!] = lead.score_reasoning.slice(0, 5000);
    }
    if (fieldMap.has('job_title')) {
      const title = apolloPerson?.title || pdlPerson?.job_title || liProfile?.headline || '';
      if (title) customField[fieldMap.get('job_title')!] = title;
    }
    if (fieldMap.has('company_name')) {
      const company = apolloPerson?.organization_name || apolloOrg?.name || pdlPerson?.job_company_name || pdlCompany?.name || '';
      if (company) customField[fieldMap.get('company_name')!] = company;
    }
    if (fieldMap.has('industry')) {
      const industry = apolloPerson?.organization_industry || apolloOrg?.industry || pdlPerson?.industry || pdlCompany?.industry || '';
      if (industry) customField[fieldMap.get('industry')!] = industry;
    }
    if (fieldMap.has('linkedin_url')) {
      const liUrl = apolloPerson?.linkedin_url || pdlPerson?.linkedin_url || '';
      if (liUrl) customField[fieldMap.get('linkedin_url')!] = liUrl;
    }
    if (fieldMap.has('location')) {
      const location = apolloPerson?.location || pdlPerson?.location_name || liProfile?.location || '';
      if (location) customField[fieldMap.get('location')!] = location;
    }
    if (fieldMap.has('email_verified')) {
      const mvQuality = enrichmentData.email_verify?.quality;
      const hunterStatus = enrichmentData.hunter_verify?.status;
      const verified = mvQuality || hunterStatus || 'unknown';
      customField[fieldMap.get('email_verified')!] = verified;
    }
    if (fieldMap.has('enrichment_source')) {
      customField[fieldMap.get('enrichment_source')!] = lead.source || 'unknown';
    }

    // Convert custom fields to GHL v2 array format: [{ id, field_value }]
    const customFields = Object.entries(customField).map(([id, value]) => ({
      id,
      field_value: String(value),
    }));
    if (customFields.length > 0) {
      updates.customFields = customFields;
    }

    // If lead has a pseudo ghl_contact_id (CSV/cold import), create in GHL first
    let contactId = lead.ghl_contact_id;
    const isPseudoId = contactId.startsWith('csv_') || contactId.startsWith('cold_') || contactId.startsWith('meta_') || contactId.startsWith('rb2b_');

    if (isPseudoId) {
      // Create with standard fields only — GHL rejects customFields on create
      const { customFields: _cf, ...standardUpdates } = updates;
      const created = await ghlClient.createContact({
        email: lead.email,
        firstName: lead.first_name || undefined,
        lastName: lead.last_name || undefined,
        phone: lead.phone || undefined,
        ...standardUpdates,
      });
      if (created?.id) {
        contactId = created.id;
        updateLead(leadId, { ghl_contact_id: contactId });
        // Apply custom fields via update (GHL v2 array format)
        if (customFields.length > 0) {
          await ghlClient.updateContact(contactId, { customFields });
        }
      } else {
        console.warn(`[Enrichment] pushToGhl(${leadId}): could not create GHL contact, skipping`);
        updateLead(leadId, { ghl_push_status: 'failed', error_message: 'GHL contact creation failed' });
        return false;
      }
    } else if (Object.keys(updates).length > 0) {
      await ghlClient.updateContact(contactId, updates);
    }

    // Add tags
    const tagPrefix = companyConfig?.ghl_tag_prefix || 'enriched';
    const tags: string[] = [`${tagPrefix}:processed`];
    if (lead.score_label) tags.push(`${tagPrefix}:${lead.score_label}`);
    if (lead.is_known_contact) tags.push(`${tagPrefix}:known-contact`);

    const leadTags = lead.tags ? JSON.parse(lead.tags) : [];
    for (const tag of leadTags) {
      tags.push(`${tagPrefix}:${tag}`);
    }

    await ghlClient.addContactTags(contactId, tags);

    // Add comprehensive enrichment note with all available data
    const noteLines: string[] = ['═══ ENRICHMENT REPORT ═══', ''];

    // ── Person Info ──
    const noteTitle = apolloPerson?.title || pdlPerson?.job_title || liProfile?.headline;
    const noteCompany = apolloPerson?.organization_name || pdlPerson?.job_company_name || apolloOrg?.name;
    const noteIndustry = apolloPerson?.organization_industry || pdlPerson?.industry || apolloOrg?.industry;
    const noteLocation = apolloPerson?.location || pdlPerson?.location_name || liProfile?.location;
    const noteLinkedIn = apolloPerson?.linkedin_url || pdlPerson?.linkedin_url;

    noteLines.push('── PERSON ──');
    if (lead.first_name || lead.last_name) noteLines.push(`Name: ${[lead.first_name, lead.last_name].filter(Boolean).join(' ')}`);
    if (lead.email) noteLines.push(`Email: ${lead.email}`);
    if (lead.phone) noteLines.push(`Phone: ${lead.phone}`);
    if (noteTitle) noteLines.push(`Title: ${noteTitle}`);
    if (noteCompany) noteLines.push(`Company: ${noteCompany}`);
    if (noteIndustry) noteLines.push(`Industry: ${noteIndustry}`);
    if (noteLocation) noteLines.push(`Location: ${noteLocation}`);
    if (noteLinkedIn) noteLines.push(`LinkedIn: ${noteLinkedIn}`);

    // ── Apollo Person Details ──
    if (apolloPerson) {
      if (apolloPerson.seniority) noteLines.push(`Seniority: ${apolloPerson.seniority}`);
      if (apolloPerson.departments?.length) noteLines.push(`Departments: ${apolloPerson.departments.join(', ')}`);
      if (apolloPerson.employment_history?.length) {
        noteLines.push(`Experience: ${apolloPerson.employment_history.length} roles`);
        for (const role of apolloPerson.employment_history.slice(0, 3)) {
          noteLines.push(`  • ${role.title || 'N/A'} at ${role.organization_name || 'N/A'}${role.start_date ? ` (${role.start_date}${role.end_date ? ' - ' + role.end_date : ' - Present'})` : ''}`);
        }
      }
    }

    // ── Company/Org Data ──
    if (apolloOrg || pdlCompany) {
      noteLines.push('', '── COMPANY ──');
      const orgName = apolloOrg?.name || pdlCompany?.name;
      const orgWebsite = apolloOrg?.website_url || pdlCompany?.website;
      const orgSize = apolloOrg?.estimated_num_employees || pdlCompany?.employee_count;
      const orgFounded = apolloOrg?.founded_year || pdlCompany?.founded;
      const orgRevenue = apolloOrg?.annual_revenue_printed || pdlCompany?.annual_revenue;
      const orgDescription = apolloOrg?.short_description || pdlCompany?.description;

      if (orgName) noteLines.push(`Company: ${orgName}`);
      if (orgWebsite) noteLines.push(`Website: ${orgWebsite}`);
      if (orgSize) noteLines.push(`Size: ~${orgSize} employees`);
      if (orgFounded) noteLines.push(`Founded: ${orgFounded}`);
      if (orgRevenue) noteLines.push(`Revenue: ${orgRevenue}`);
      if (orgDescription) noteLines.push(`About: ${orgDescription.slice(0, 300)}`);
    }

    // ── LinkedIn Profile ──
    if (liProfile) {
      noteLines.push('', '── LINKEDIN ──');
      if (liProfile.summary) noteLines.push(`Summary: ${liProfile.summary.slice(0, 500)}`);
      if (liProfile.connections) noteLines.push(`Connections: ${liProfile.connections}`);
      if (liProfile.skills?.length) noteLines.push(`Skills: ${liProfile.skills.slice(0, 10).join(', ')}`);
      if (liProfile.education?.length) {
        for (const edu of liProfile.education.slice(0, 2)) {
          noteLines.push(`Education: ${edu.school || edu.schoolName || 'N/A'}${edu.degree ? ' — ' + edu.degree : ''}`);
        }
      }
      if (liProfile.posts?.length) {
        noteLines.push(`Recent Posts: ${liProfile.posts.length}`);
        for (const post of liProfile.posts.slice(0, 2)) {
          const snippet = (post.text || post.content || '').slice(0, 150);
          if (snippet) noteLines.push(`  • "${snippet}..."`);
        }
      }
    }

    // ── Email Verification ──
    const mvResult = enrichmentData.email_verify;
    const hunterResult = enrichmentData.hunter_verify;
    if (mvResult || hunterResult) {
      noteLines.push('', '── EMAIL VERIFICATION ──');
      if (mvResult) {
        noteLines.push(`MillionVerifier: ${mvResult.quality || mvResult.result || 'checked'}`);
      }
      if (hunterResult) {
        noteLines.push(`Hunter: ${hunterResult.status || 'checked'} (score: ${hunterResult.score || 'N/A'})`);
      }
    }

    // ── AI Scoring ──
    noteLines.push('', '── AI SCORING ──');
    if (lead.score !== null) noteLines.push(`Score: ${lead.score}/100 (${(lead.score_label || 'unscored').toUpperCase()})`);
    if (lead.score_reasoning) noteLines.push(`Reasoning: ${lead.score_reasoning}`);
    if (lead.tags) {
      try {
        const parsedTags = JSON.parse(lead.tags);
        if (parsedTags.length) noteLines.push(`Tags: ${parsedTags.join(', ')}`);
      } catch {}
    }

    // ── Personalizations ──
    const personalizations = enrichmentData.personalizations;
    if (personalizations) {
      noteLines.push('', '── PERSONALIZATIONS ──');
      if (personalizations.opener) noteLines.push(`Opener: ${personalizations.opener}`);
      if (personalizations.painPoint) noteLines.push(`Pain Point: ${personalizations.painPoint}`);
      if (personalizations.cta) noteLines.push(`CTA: ${personalizations.cta}`);
    }

    noteLines.push('', `── Source: ${lead.source || 'unknown'} | Enriched: ${new Date().toISOString().slice(0, 10)} ──`);

    await ghlClient.createContactNote(contactId, noteLines.join('\n'));

    updateLead(leadId, { ghl_push_status: 'pushed', pushed_at: new Date().toISOString() });
    logEvent(leadId, lead.company_id, 'ghl_pushed', { tags, custom_fields_set: customFields.length });

    saveDb();
    wsServer.broadcast({ type: 'enrichment_update', leadId, status: 'ghl_pushed' });
    return true;
  } catch (err: any) {
    console.error(`[Enrichment] pushToGhl(${leadId}) error:`, err.message);
    updateLead(leadId, { ghl_push_status: 'failed', error_message: err.message });
    logEvent(leadId, lead.company_id, 'error', { error: err.message, step: 'ghl_push' });
    return false;
  }
}

export async function approveForColdEmail(leadId: number, campaignId: string): Promise<boolean> {
  const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
  if (!lead || !lead.email) return false;

  if (lead.instantly_push_status === 'excluded') {
    console.warn(`[Enrichment] Lead ${leadId} is excluded from cold email`);
    return false;
  }

  try {
    const enrichmentData = lead.enrichment_data ? JSON.parse(lead.enrichment_data) : {};
    const personalizations = enrichmentData.personalizations || {};

    const ap = enrichmentData.apollo_person;
    const pp = enrichmentData.pdl_person;
    const ao = enrichmentData.apollo_org;
    const pc = enrichmentData.pdl_company;

    // ── Generate full personalized email sequence via Claude ──
    let emailSequence = null;
    if (claudeService.available) {
      try {
        emailSequence = await generateEmailSequence(leadId, lead.company_id);
      } catch (err: any) {
        console.warn(`[Enrichment] Email generation failed for lead ${leadId}, falling back to snippet mode:`, err.message);
      }
    }

    // Build custom variables — full personalized bodies if available, else fallback to snippets
    let customVars: Record<string, any>;
    if (emailSequence && emailSequence.steps.length >= 3) {
      customVars = sequenceToCustomVariables(emailSequence, {
        score: lead.score,
        score_label: lead.score_label,
        job_title: ap?.title || pp?.job_title || '',
        company: ap?.organization_name || pp?.job_company_name || '',
        industry: ap?.organization_industry || pp?.industry || '',
        source: lead.source,
        // Keep legacy vars for backward compatibility with existing templates
        opener: personalizations.opener || '',
        pain_point: personalizations.painPoint || '',
        cta: personalizations.cta || '',
      });

      // Store generated sequence in enrichment data for tracking/learning
      const updatedData = {
        ...enrichmentData,
        generated_email_sequence: emailSequence,
      };
      updateLead(leadId, { enrichment_data: JSON.stringify(updatedData) });
    } else {
      // Fallback: use scoring snippets only (legacy mode)
      const confidence = Number(personalizations.confidence) || 0;
      if (confidence < 0.4 && personalizations.opener) {
        console.warn(`[Enrichment] Low personalization confidence (${confidence}) for lead ${leadId}`);
        logEvent(leadId, lead.company_id, 'low_personalization_confidence', { confidence });
      }

      customVars = {
        score: lead.score,
        score_label: lead.score_label,
        job_title: ap?.title || pp?.job_title || '',
        company: ap?.organization_name || pp?.job_company_name || '',
        industry: ap?.organization_industry || pp?.industry || '',
        opener: personalizations.opener || '',
        pain_point: personalizations.painPoint || '',
        cta: personalizations.cta || '',
        source: lead.source,
      };
    }

    const result = await instantlyService.addLeadsToCampaign(campaignId, [{
      email: lead.email,
      first_name: lead.first_name || undefined,
      last_name: lead.last_name || undefined,
      company_name: ap?.organization_name || ao?.name || pp?.job_company_name || pc?.name || undefined,
      custom_variables: customVars,
    }]);

    if (result) {
      updateLead(leadId, {
        instantly_push_status: 'pushed',
        instantly_campaign_id: campaignId,
        pushed_at: new Date().toISOString(),
      });
      logEvent(leadId, lead.company_id, 'instantly_pushed', {
        campaignId,
        personalized: !!emailSequence,
        strategy: emailSequence?.strategy || 'snippet_mode',
      });
      saveDb();
      wsServer.broadcast({ type: 'enrichment_update', leadId, status: 'instantly_pushed' });
      return true;
    }
    return false;
  } catch (err: any) {
    console.error(`[Enrichment] approveForColdEmail(${leadId}) error:`, err.message);
    updateLead(leadId, { instantly_push_status: 'failed', error_message: err.message });
    logEvent(leadId, lead.company_id, 'error', { error: err.message, step: 'instantly_push' });
    return false;
  }
}

export async function bulkApproveForColdEmail(leadIds: number[], campaignId: string): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  for (const id of leadIds) {
    const ok = await approveForColdEmail(id, campaignId);
    if (ok) success++;
    else failed++;
  }
  return { success, failed };
}

const MAX_PUSH_RETRIES = 3;

/**
 * Retry failed Instantly pushes — called on a schedule (e.g., every 15 min).
 * Only retries leads with retry_count < MAX_PUSH_RETRIES.
 */
export async function retryFailedInstantlyPushes(): Promise<{ retried: number; succeeded: number }> {
  const failedLeads = queryAll(
    `SELECT el.id, el.company_id, ec.default_campaign_id
     FROM enrichment_leads el
     JOIN enrichment_config ec ON el.company_id = ec.company_id
     WHERE el.instantly_push_status = 'failed'
       AND COALESCE(el.retry_count, 0) < ?
       AND ec.default_campaign_id IS NOT NULL
     ORDER BY el.updated_at ASC
     LIMIT 50`,
    [MAX_PUSH_RETRIES]
  );

  let retried = 0;
  let succeeded = 0;

  for (const lead of failedLeads) {
    retried++;
    const currentRetry = (lead.retry_count || 0) + 1;
    updateLead(lead.id, { retry_count: currentRetry });

    const ok = await approveForColdEmail(lead.id, lead.default_campaign_id);
    if (ok) {
      succeeded++;
      console.log(`[Enrichment] Retry #${currentRetry} succeeded for lead ${lead.id}`);
    } else {
      console.warn(`[Enrichment] Retry #${currentRetry}/${MAX_PUSH_RETRIES} failed for lead ${lead.id}`);
    }
  }

  if (retried > 0) {
    console.log(`[Enrichment] Retried ${retried} failed pushes, ${succeeded} succeeded`);
  }
  return { retried, succeeded };
}

export function excludeFromColdEmail(leadId: number, reason?: string): void {
  updateLead(leadId, { instantly_push_status: 'excluded' });
  const lead = queryOne('SELECT company_id FROM enrichment_leads WHERE id = ?', [leadId]);
  if (lead) {
    logEvent(leadId, lead.company_id, 'cold_email_excluded', { reason });
  }
  saveDb();
}

export async function processLead(leadId: number): Promise<boolean> {
  // BMN (company_id=2) NEVER runs through the enrichment pipeline
  const checkLead = queryOne('SELECT company_id FROM enrichment_leads WHERE id = ?', [leadId]);
  if (checkLead?.company_id === 2) {
    console.log(`[Enrichment] Skipping processLead for BMN lead ${leadId}`);
    return false;
  }

  const enriched = await enrichLead(leadId);
  if (!enriched) return false;

  const scored = await scoreLead(leadId);
  if (!scored) return false;

  // Gated deep-enrich: only spend PDL credits on high-value leads (score >= 80)
  const scoredLead = queryOne('SELECT score, company_id FROM enrichment_leads WHERE id = ?', [leadId]);
  if (scoredLead && scoredLead.score >= 80 && pdlClient.available) {
    await deepEnrichWithPdl(leadId);
    // Re-score with deeper data for more accurate classification
    await scoreLead(leadId);
  }

  // Auto-push to GHL if enabled
  if (scoredLead) {
    const companyConfig = getCompanyConfig(scoredLead.company_id);
    if (companyConfig?.auto_push_ghl) {
      await pushToGhl(leadId);
    }

    // Auto-approve for cold email if lead qualifies
    if (companyConfig?.default_campaign_id) {
      const threshold = companyConfig.auto_approve_threshold || 70;
      const freshLead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
      if (freshLead && freshLead.score !== null && freshLead.score >= threshold
        && freshLead.instantly_push_status === 'awaiting_approval'
        && !freshLead.is_known_contact) {
        // Verify email is not invalid
        const enrichmentData = freshLead.enrichment_data ? (() => { try { return JSON.parse(freshLead.enrichment_data); } catch { return {}; } })() : {};
        const emailInvalid = enrichmentData.email_verify
          ? millionverifierClient.isInvalid(enrichmentData.email_verify)
          : false;

        if (!emailInvalid) {
          await approveForColdEmail(leadId, companyConfig.default_campaign_id);
          logEvent(leadId, scoredLead.company_id, 'auto_approved_cold_email', {
            score: freshLead.score,
            threshold,
            campaign_id: companyConfig.default_campaign_id,
          });
        }
      }
    }

    // ── LinkedIn outreach for hot leads ──────────────────────────
    const liLead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
    if (liLead && liLead.score !== null && liLead.score >= (companyConfig?.score_threshold_hot || 80)) {
      const liEnrichData = liLead.enrichment_data ? (() => { try { return JSON.parse(liLead.enrichment_data); } catch { return {}; } })() : {};
      const linkedInUrl = liEnrichData.linkedin_url
        || liEnrichData.apollo_person?.linkedin_url
        || liEnrichData.pdl_person?.linkedin_url
        || liEnrichData.linkedin_profile?.url
        || '';

      if (linkedInUrl && liLead.linkedin_outreach_status === 'none') {
        try {
          const playbook = queryOne('SELECT * FROM company_playbooks WHERE company_id = ?', [liLead.company_id]);
          const message = await claudeService.generateLinkedInMessage(liEnrichData, {
            company_description: playbook?.company_description,
            value_propositions: playbook?.value_propositions,
            target_icp: playbook?.target_icp,
            tone: playbook?.tone,
          });

          updateLead(leadId, {
            linkedin_outreach_status: 'queued',
            linkedin_message: message,
          });

          logEvent(leadId, liLead.company_id, 'linkedin_outreach_queued', {
            score: liLead.score,
            linkedin_url: linkedInUrl,
            message_preview: message.slice(0, 100),
          });

          wsServer.broadcast({
            type: 'enrichment_update',
            leadId,
            linkedin_outreach_status: 'queued',
          });

          console.log(`[Enrichment] Lead ${leadId} (${liLead.first_name} ${liLead.last_name}) queued for LinkedIn outreach — score ${liLead.score}`);
        } catch (err: any) {
          console.error(`[Enrichment] LinkedIn message generation failed for lead ${leadId}:`, err.message);
        }
      }
    }
  }

  return true;
}

export async function reEnrichStale(companyId?: number): Promise<number> {
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

export async function bulkProcessImport(
  importId: number,
  leadIds: number[],
  targetCampaignId?: string
): Promise<void> {
  const batchSize = 5;
  let processedCount = 0;

  for (let i = 0; i < leadIds.length; i += batchSize) {
    // Check if cancelled
    const importRecord = queryOne('SELECT status FROM bulk_imports WHERE id = ?', [importId]);
    if (importRecord?.status === 'cancelled') {
      wsServer.broadcast({ type: 'bulk_import_cancelled', import_id: importId, processed: processedCount });
      return;
    }

    const batch = leadIds.slice(i, i + batchSize);

    for (const leadId of batch) {
      try {
        await processLead(leadId);

        // If target campaign specified, auto-approve for cold email
        if (targetCampaignId) {
          const lead = queryOne('SELECT instantly_push_status FROM enrichment_leads WHERE id = ?', [leadId]);
          if (lead?.instantly_push_status === 'awaiting_approval') {
            await approveForColdEmail(leadId, targetCampaignId);
          }
        }
      } catch (err: any) {
        console.error(`[BulkImport] Failed to process lead ${leadId}:`, err.message);
      }

      processedCount++;

      // Update import record
      runSql(
        `UPDATE bulk_imports SET processed_count = ?, updated_at = datetime('now') WHERE id = ?`,
        [processedCount, importId]
      );
      saveDb();

      // Broadcast progress
      wsServer.broadcast({
        type: 'bulk_import_progress',
        import_id: importId,
        processed: processedCount,
        total: leadIds.length,
        percent: Math.round((processedCount / leadIds.length) * 100),
      });
    }

    // Small delay between batches to respect rate limits
    if (i + batchSize < leadIds.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Mark complete
  runSql(
    `UPDATE bulk_imports SET status = 'complete', processed_count = ?, updated_at = datetime('now') WHERE id = ?`,
    [processedCount, importId]
  );
  saveDb();

  wsServer.broadcast({
    type: 'bulk_import_complete',
    import_id: importId,
    processed: processedCount,
    total: leadIds.length,
  });
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

/** Valid funnel stages in order of progression. */
const FUNNEL_STAGES = [
  'pending',
  'enriching',
  'enriched',
  'scored',
  'pushed',
  'meeting_set',
  'subscription_docs_sent',
  'committed',
  'funded',
] as const;

/**
 * Advance a lead to a new funnel stage. Validates the stage name
 * and logs the transition.
 */
export function advanceLeadStage(leadId: number, newStage: string): boolean {
  if (!FUNNEL_STAGES.includes(newStage as any)) {
    return false;
  }

  const lead = queryOne('SELECT id, company_id, status FROM enrichment_leads WHERE id = ?', [leadId]);
  if (!lead) return false;

  const oldStage = lead.status;
  updateLead(leadId, { status: newStage });
  logEvent(leadId, lead.company_id, 'stage_advanced', { from: oldStage, to: newStage });
  saveDb();

  wsServer.broadcast({ type: 'enrichment_update', leadId, status: newStage, previousStatus: oldStage });

  // Sync GHL opportunity stage (async, non-blocking)
  syncOpportunityStage(leadId, newStage).catch(err => {
    console.error(`[Pipeline] Failed to sync opportunity stage for lead ${leadId}:`, err.message);
  });

  return true;
}

/**
 * Fast-track processing for high-value event attendees.
 * - Tags each lead as 'event_attendee'
 * - Enriches + scores via processLead
 * - Auto-approves for cold email (skips manual approval)
 * - Auto-pushes to GHL regardless of config
 * - Sets referral_source to the event name
 */
export async function fastTrackEventAttendees(
  companyId: number,
  leadIds: number[],
  eventName: string,
  targetCampaignId?: string
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  for (const leadId of leadIds) {
    try {
      const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ? AND company_id = ?', [leadId, companyId]);
      if (!lead) { failed++; continue; }

      // Tag as event attendee and set referral source
      const existingTags: string[] = lead.tags ? (() => { try { return JSON.parse(lead.tags); } catch { return []; } })() : [];
      if (!existingTags.includes('event_attendee')) existingTags.push('event_attendee');
      if (eventName && !existingTags.includes(eventName)) existingTags.push(eventName);

      updateLead(leadId, {
        tags: JSON.stringify(existingTags),
        referral_source: eventName,
      });

      // Full enrich + score pipeline
      const ok = await processLead(leadId);
      if (!ok) { failed++; continue; }

      // Auto-push to GHL (bypass config check)
      await pushToGhl(leadId);

      // Auto-approve for cold email if campaign specified
      if (targetCampaignId) {
        const updated = queryOne('SELECT instantly_push_status FROM enrichment_leads WHERE id = ?', [leadId]);
        if (updated?.instantly_push_status === 'awaiting_approval') {
          await approveForColdEmail(leadId, targetCampaignId);
        }
      }

      logEvent(leadId, companyId, 'fast_track_complete', { event: eventName });
      processed++;
    } catch (err: any) {
      console.error(`[FastTrack] Failed lead ${leadId}:`, err.message);
      failed++;
    }
  }

  if (processed > 0) {
    createAlert('enrichment', 'info', `Fast-tracked ${processed} event attendees from "${eventName}"`, 'enrichment-service');
    saveDb();
  }

  wsServer.broadcast({
    type: 'fast_track_complete',
    event: eventName,
    processed,
    failed,
    total: leadIds.length,
  });

  return { processed, failed };
}

/**
 * Migrate all leads from one Instantly campaign to another, generating
 * Claude-personalized email sequences for each lead along the way.
 *
 * Processes in batches to respect rate limits. Emits WebSocket progress updates.
 */
export async function migrateCampaignWithPersonalization(
  fromCampaignId: string,
  toCampaignId: string,
  companyId: number,
  opts?: { batchSize?: number; delayMs?: number },
): Promise<{ migrated: number; failed: number; skipped: number; total: number }> {
  const batchSize = opts?.batchSize ?? 10;
  const delayMs = opts?.delayMs ?? 2000; // 2s between batches to respect Claude rate limits

  // Get all leads currently pushed to the old campaign
  const leads = queryAll(
    `SELECT id, email, first_name, last_name, enrichment_data, score, score_label, source
     FROM enrichment_leads
     WHERE company_id = ? AND instantly_campaign_id = ? AND instantly_push_status = 'pushed'
     ORDER BY id ASC`,
    [companyId, fromCampaignId],
  );

  const total = leads.length;
  let migrated = 0;
  let failed = 0;
  let skipped = 0;

  console.log(`[Migration] Starting campaign migration: ${total} leads from ${fromCampaignId} → ${toCampaignId}`);
  wsServer.broadcast({ type: 'migration_started', fromCampaignId, toCampaignId, total });

  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize);

    const batchPromises = batch.map(async (lead) => {
      try {
        const enrichmentData = lead.enrichment_data ? JSON.parse(lead.enrichment_data) : {};
        const personalizations = enrichmentData.personalizations || {};
        const ap = enrichmentData.apollo_person;
        const pp = enrichmentData.pdl_person;
        const ao = enrichmentData.apollo_org;
        const pc = enrichmentData.pdl_company;

        // Generate personalized email sequence via Claude
        let emailSequence = null;
        if (claudeService.available) {
          try {
            emailSequence = await generateEmailSequence(lead.id, companyId);
          } catch (err: any) {
            console.warn(`[Migration] Email generation failed for lead ${lead.id}: ${err.message}`);
          }
        }

        if (!emailSequence || emailSequence.steps.length < 3) {
          console.warn(`[Migration] Skipping lead ${lead.id} — no personalized sequence generated`);
          skipped++;
          return;
        }

        // Build custom variables with full personalized bodies
        const customVars = sequenceToCustomVariables(emailSequence, {
          score: lead.score,
          score_label: lead.score_label,
          job_title: ap?.title || pp?.job_title || '',
          company: ap?.organization_name || pp?.job_company_name || '',
          industry: ap?.organization_industry || pp?.industry || '',
          source: lead.source,
          opener: personalizations.opener || '',
          pain_point: personalizations.painPoint || '',
          cta: personalizations.cta || '',
        });

        // Push to new campaign
        const result = await instantlyService.addLeadsToCampaign(toCampaignId, [{
          email: lead.email,
          first_name: lead.first_name || undefined,
          last_name: lead.last_name || undefined,
          company_name: ap?.organization_name || ao?.name || pp?.job_company_name || pc?.name || undefined,
          custom_variables: customVars,
        }]);

        if (result) {
          // Update DB to point to new campaign
          const updatedData = { ...enrichmentData, generated_email_sequence: emailSequence };
          updateLead(lead.id, {
            instantly_campaign_id: toCampaignId,
            enrichment_data: JSON.stringify(updatedData),
          });
          logEvent(lead.id, companyId, 'campaign_migrated', {
            from: fromCampaignId,
            to: toCampaignId,
            personalized: true,
            strategy: emailSequence.strategy,
          });
          migrated++;
        } else {
          failed++;
        }
      } catch (err: any) {
        console.error(`[Migration] Lead ${lead.id} error:`, err.message);
        failed++;
      }
    });

    await Promise.all(batchPromises);
    saveDb();

    // Progress update
    const progress = Math.min(i + batchSize, total);
    console.log(`[Migration] Progress: ${progress}/${total} (migrated=${migrated}, failed=${failed}, skipped=${skipped})`);
    wsServer.broadcast({
      type: 'migration_progress',
      progress,
      total,
      migrated,
      failed,
      skipped,
    });

    // Rate limit pause between batches
    if (i + batchSize < leads.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log(`[Migration] Complete: ${migrated} migrated, ${failed} failed, ${skipped} skipped out of ${total}`);
  wsServer.broadcast({ type: 'migration_complete', migrated, failed, skipped, total });

  return { migrated, failed, skipped, total };
}
