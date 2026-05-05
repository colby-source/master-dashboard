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
import { createLogger } from '../../utils/logger';
import { classifySegment } from './segment-router';
import { runTier05DomainIntel } from './tier-05-domain-intel';
import { computeScoreHint, minScoreHintForTier2 } from './score-hint';
import { inGlobalSuppression, inHnwSuppression } from './tier-0-gates';
import { logCostEvent } from './cost-ledger';
import { cacheGet, cacheSet } from './cache-layer';
const log = createLogger('lead-enrichment');

export async function enrichLead(leadId: number): Promise<boolean> {
  const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as EnrichmentLead | null;
  if (!lead) return false;

  // BMN NEVER runs through enrichment — creators use personal
  // emails and don't need B2B enrichment/scoring. They flow: Instantly → GHL directly.
  if (lead.company_id === BMN_COMPANY_ID) {
    log.info(`[Enrichment] Skipping enrichment for BMN lead ${leadId} (${lead.email})`);
    return false;
  }

  // ── Segment router: classify every lead into a single segment tag ──
  // Drives PDL gate, auto-approval, stale TTL, and personal-email tolerance.
  const segment = classifySegment(lead);
  if (!lead.segment || lead.segment !== segment) {
    updateLead(leadId, { segment });
  }

  updateLead(leadId, { status: 'enriching' });
  logEvent(leadId, lead.company_id, 'enrichment_started', { segment });

  try {
    const enrichmentData: any = {};
    const existingEnrichment = lead.enrichment_data ? (() => { try { return JSON.parse(lead.enrichment_data); } catch { return {}; } })() : {};

    // ── Global + HNW suppression check (free) ──
    // Moved AHEAD of paid enrichment so known-bad leads never cost a cent.
    // FIX M-5: single exclusion helper — replaces two near-identical mark-excluded blocks.
    // Note: we do NOT route through runTier0Gates here because the upstream prefilterEmail
    // call below does different work (personal-domain gate with company-specific rules).
    // Suppression is strictly a pre-paid-work gate; everything else stays in prefilter.
    const markExcluded = (scope: 'global' | 'hnw'): void => {
      updateLead(leadId, {
        status: 'enriched',
        instantly_push_status: 'excluded',
        enrichment_completeness: 5,
        enriched_at: new Date().toISOString(),
      });
      logEvent(leadId, lead.company_id, 'suppression_rejected', { scope });
      saveDb();
    };
    if (lead.email) {
      const domain = lead.email.split('@')[1]?.toLowerCase() ?? null;
      if (inGlobalSuppression(lead.email, domain)) {
        markExcluded('global');
        return true;
      }
      if ((segment === 'FAMILY_OFFICE' || segment === 'HNW_INDIVIDUAL')
          && inHnwSuppression({
            first_name: lead.first_name,
            last_name: lead.last_name,
            firm: (existingEnrichment as any).apollo_org?.name ?? null,
          })) {
        markExcluded('hnw');
        return true;
      }
    }

    // ── Tier 0: Free pre-filter (MX check + personal domain block) ──
    // NOTE: For FAMILY_OFFICE / HNW_INDIVIDUAL, personal emails are NOT hard-rejected —
    // they route to Tier P (manual approval + LI + firm confirm). We skip the personal-email
    // block for those segments by passing companyId=BMN (which bypasses the check in prefilter).
    if (lead.email) {
      const prefilterOpts = (segment === 'FAMILY_OFFICE' || segment === 'HNW_INDIVIDUAL')
        ? { companyId: BMN_COMPANY_ID }
        : { companyId: lead.company_id };
      const prefilter = await prefilterEmail(lead.email, prefilterOpts);
      enrichmentData.prefilter = prefilter;
      enrichmentData.segment = segment;

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
          segment,
        });
        saveDb();
        wsServer.broadcast({ type: 'enrichment_update', leadId, status: 'enriched' });
        return true;
      }
    }

    // ── Tier 0.5: Free domain intelligence (WHOIS, DMARC, MX provider, firm regex) ──
    if (lead.email) {
      try {
        const domainIntel = await runTier05DomainIntel({
          email: lead.email,
          firm: (existingEnrichment as any).apollo_org?.name ?? null,
        });
        enrichmentData.domain_intel = domainIntel;
        updateLead(leadId, { domain_intel: JSON.stringify(domainIntel) });
      } catch (err: any) {
        log.warn(`[Enrichment] Tier 0.5 domain intel failed: ${err.message}`);
      }
    }

    // ── Tier 1: Cheap enrichment (Apollo + conditional MillionVerifier) ──
    // Apollo person + org enrichment replaces PDL ($0 vs $0.38/lead).
    // MV now only fires when Apollo did NOT stamp email as verified — saves ~30-50% of MV cost.
    const domain = lead.email?.split('@')[1] ?? null;
    const [apolloPersonResult, apolloOrgResult] = await Promise.all([
      (lead.email && apolloClient.available)
        ? apolloClient.enrichPerson({ email: lead.email }).catch((err: any) => { log.warn(`[Enrichment] Apollo person failed:`, err.message); return null; })
        : Promise.resolve(null),
      (domain && apolloClient.available)
        ? apolloClient.enrichOrganization({ domain }).catch((err: any) => { log.warn(`[Enrichment] Apollo org failed:`, err.message); return null; })
        : Promise.resolve(null),
    ]);

    if (apolloPersonResult) {
      enrichmentData.apollo_person = apolloPersonResult;
      if (!lead.first_name && apolloPersonResult.first_name) {
        updateLead(leadId, { first_name: apolloPersonResult.first_name });
      }
      if (!lead.last_name && apolloPersonResult.last_name) {
        updateLead(leadId, { last_name: apolloPersonResult.last_name });
      }
      logCostEvent({
        lead_id: leadId, tier: '1', vendor: 'apollo', endpoint: 'enrichPerson',
        cost_usd: 0, result_status: 'hit',
      });
    } else if (lead.email && apolloClient.available) {
      logCostEvent({
        lead_id: leadId, tier: '1', vendor: 'apollo', endpoint: 'enrichPerson',
        cost_usd: 0, result_status: 'miss',
      });
    }
    if (apolloOrgResult) {
      enrichmentData.apollo_org = apolloOrgResult;
      logCostEvent({
        lead_id: leadId, tier: '1', vendor: 'apollo', endpoint: 'enrichOrganization',
        cost_usd: 0, result_status: 'hit',
      });
    }

    // MV short-circuit: if Apollo already stamped verified, skip MV entirely ($0.0003 saved per hit).
    const apolloVerified = apolloPersonResult?.email_status === 'verified';
    if (lead.email && millionverifierClient.available && !apolloVerified) {
      try {
        const mvResult = await millionverifierClient.verifyEmail(lead.email);
        if (mvResult) enrichmentData.email_verify = mvResult;
        logCostEvent({
          lead_id: leadId, tier: '1', vendor: 'millionverifier', endpoint: 'verify',
          cost_usd: 0.0003, result_status: mvResult ? 'hit' : 'miss',
        });
      } catch (err: any) {
        log.warn(`[Enrichment] MillionVerifier failed:`, err.message);
        logCostEvent({
          lead_id: leadId, tier: '1', vendor: 'millionverifier', endpoint: 'verify',
          cost_usd: 0, result_status: 'error', error_message: err.message,
        });
      }
    } else if (apolloVerified) {
      // Mirror Apollo's verification so downstream code sees a consistent shape.
      enrichmentData.email_verify = { result: 'ok', source: 'apollo_verified_passthrough' };
      logCostEvent({
        lead_id: leadId, tier: '1', vendor: 'millionverifier', endpoint: 'verify',
        cost_usd: 0, result_status: 'skipped', error_message: 'apollo_verified',
      });
    }

    // ── Compute deterministic score_hint (free) — gates Tier 2 LinkedIn scrape ──
    const scoreHint = computeScoreHint({
      segment,
      domain_intel: enrichmentData.domain_intel ?? {
        is_freemail: false, is_role: false, whois_age_days: null,
        mx_provider: 'other', has_dmarc: false, has_spf: false,
        tranco_rank: null, firm_name_signal_match: false, email_company_match: null,
      },
      title: apolloPersonResult?.title ?? null,
      apollo_person_has_title: !!apolloPersonResult?.title,
      linkedin_url_present: !!apolloPersonResult?.linkedin_url,
    });
    enrichmentData.score_hint = scoreHint;
    updateLead(leadId, { score_hint: scoreHint });

    // ── Tier 2: LinkedIn scrape (depends on Apollo/PDL for linkedin_url) ──
    // GATED: score_hint ≥ minimum for segment (typically 60). Saves ~50-70% of Apify LI cost.
    const linkedInUrl = enrichmentData.apollo_person?.linkedin_url
      || enrichmentData.pdl_person?.linkedin_url
      || existingEnrichment.linkedin_url;
    const tier2GatePass = scoreHint >= minScoreHintForTier2(segment);
    if (linkedInUrl && !tier2GatePass) {
      log.info(`[Enrichment] Skipping Tier 2 LinkedIn for lead ${leadId} — score_hint ${scoreHint} < min for ${segment}`);
      logCostEvent({
        lead_id: leadId, tier: '2', vendor: 'apify_linkedin', endpoint: 'profile_scrape',
        cost_usd: 0, result_status: 'skipped', error_message: `score_hint:${scoreHint}`,
      });
    }
    if (linkedInUrl && tier2GatePass) {
      try {
        // FIX H-7: route through unified cache-layer. Previous raw queryOne bypassed
        // expires_at (used created_at) and the namespaced key format, diverging from
        // every other vendor and making cache-hit metrics unreliable.
        const cachedLi = cacheGet<NonNullable<typeof enrichmentData.linkedin_profile>>('linkedin', linkedInUrl);
        if (cachedLi) {
          enrichmentData.linkedin_profile = cachedLi;
          log.info(`[Enrichment] LinkedIn cache hit for ${linkedInUrl}`);
        } else {
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
            cacheSet('linkedin', linkedInUrl, enrichmentData.linkedin_profile);
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
        log.warn(`[Enrichment] LinkedIn scrape failed for ${linkedInUrl}:`, liErr.message);
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
    log.error(`[Enrichment] enrichLead(${leadId}) error:`, err.message);
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
        }).catch(err => { log.warn(`[DeepEnrich] PDL person failed:`, err.message); })
      );

      const domain = lead.email.split('@')[1];
      if (domain) {
        deepWaves.push(
          pdlClient.enrichCompany(domain).then(pdlCompany => {
            if (pdlCompany) enrichmentData.pdl_company = pdlCompany;
          }).catch(err => { log.warn(`[DeepEnrich] PDL company failed:`, err.message); })
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
    log.error(`[DeepEnrich] deepEnrichWithPdl(${leadId}) error:`, err.message);
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

  log.info(`[KnownContacts] Starting GHL import for company ${companyId}...`);
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
      log.info(`[KnownContacts] Progress: ${imported} new contacts imported (${checked} checked so far)`);
    }
  }

  if (imported > 0) saveDb();
  log.info(`[KnownContacts] Imported ${imported} new known contacts from GHL (${checked} total checked)`);
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
