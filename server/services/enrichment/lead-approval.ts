import { queryAll, queryOne, saveDb } from '../../db';
import { ghlService } from '../ghl-service';
import { instantlyService } from '../instantly-service';
import { wsServer } from '../../websocket/ws-server';
import { EnrichmentLead } from './types';
import { getCompanyConfig, updateLead, logEvent } from './helpers';
import { claudeService } from '../claude-service';
import { generateEmailSequence, sequenceToCustomVariables } from './email-generator';
import { createLogger } from '../../utils/logger';
const log = createLogger('lead-approval');

// Enrichment custom field definitions for GHL contact cards
export const ENRICHMENT_CUSTOM_FIELDS = [
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

export const MAX_PUSH_RETRIES = 3;

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
        log.info(`[Enrichment] Created GHL custom field: ${fieldDef.name} (${created.id})`);
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
    log.error(`[Enrichment] No GHL client for company ${lead.company_id}`);
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
        log.warn(`[Enrichment] pushToGhl(${leadId}): could not create GHL contact, skipping`);
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
      } catch { /* expected */ }
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
    log.error(`[Enrichment] pushToGhl(${leadId}) error:`, err.message);
    updateLead(leadId, { ghl_push_status: 'failed', error_message: err.message });
    logEvent(leadId, lead.company_id, 'error', { error: err.message, step: 'ghl_push' });
    return false;
  }
}

export async function approveForColdEmail(leadId: number, campaignId: string): Promise<boolean> {
  const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
  if (!lead || !lead.email) return false;

  if (lead.instantly_push_status === 'excluded') {
    log.warn(`[Enrichment] Lead ${leadId} is excluded from cold email`);
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
        log.warn(`[Enrichment] Email generation failed for lead ${leadId}, falling back to snippet mode:`, err.message);
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
        log.warn(`[Enrichment] Low personalization confidence (${confidence}) for lead ${leadId}`);
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
    log.error(`[Enrichment] approveForColdEmail(${leadId}) error:`, err.message);
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
      log.info(`[Enrichment] Retry #${currentRetry} succeeded for lead ${lead.id}`);
    } else {
      log.warn(`[Enrichment] Retry #${currentRetry}/${MAX_PUSH_RETRIES} failed for lead ${lead.id}`);
    }
  }

  if (retried > 0) {
    log.info(`[Enrichment] Retried ${retried} failed pushes, ${succeeded} succeeded`);
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
