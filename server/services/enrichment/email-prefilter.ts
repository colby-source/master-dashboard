import dns from 'dns';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

/**
 * Personal/free email domains that should be filtered out
 * before spending enrichment credits. These rarely yield
 * useful B2B data.
 */
const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'live.com',
  'msn.com',
  'mail.com',
  'ymail.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'gmx.com',
  'gmx.net',
  'fastmail.com',
  'hey.com',
  'tutanota.com',
  'inbox.com',
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'cox.net',
  'charter.net',
  'bellsouth.net',
  'earthlink.net',
  'optonline.net',
  'rocketmail.com',
]);

export interface PrefilterResult {
  passed: boolean;
  reason?: string;
  domain: string;
  isPersonalEmail: boolean;
  hasMxRecords: boolean;
}

/**
 * Free pre-filter that runs before any paid enrichment.
 * Checks:
 * 1. Email format validity
 * 2. Personal/free email domain blocklist
 * 3. MX record existence (domain can receive email)
 *
 * Returns { passed: true } if the email is worth enriching.
 */
export async function prefilterEmail(email: string): Promise<PrefilterResult> {
  const normalized = email.trim().toLowerCase();

  // Basic format check
  if (!normalized || !normalized.includes('@') || !normalized.includes('.')) {
    return {
      passed: false,
      reason: 'invalid_format',
      domain: '',
      isPersonalEmail: false,
      hasMxRecords: false,
    };
  }

  const domain = normalized.split('@')[1];
  if (!domain) {
    return {
      passed: false,
      reason: 'no_domain',
      domain: '',
      isPersonalEmail: false,
      hasMxRecords: false,
    };
  }

  // Check personal email domains
  const isPersonal = PERSONAL_DOMAINS.has(domain);
  if (isPersonal) {
    return {
      passed: false,
      reason: 'personal_email',
      domain,
      isPersonalEmail: true,
      hasMxRecords: true, // these all have MX records
    };
  }

  // MX record check — does this domain even accept email?
  let hasMx = false;
  try {
    const records = await resolveMx(domain);
    hasMx = records.length > 0;
  } catch {
    hasMx = false;
  }

  if (!hasMx) {
    return {
      passed: false,
      reason: 'no_mx_records',
      domain,
      isPersonalEmail: false,
      hasMxRecords: false,
    };
  }

  return {
    passed: true,
    domain,
    isPersonalEmail: false,
    hasMxRecords: true,
  };
}

/**
 * Check if a domain is a personal/free email provider.
 */
export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain.toLowerCase());
}
