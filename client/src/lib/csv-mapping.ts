// Auto-detect CSV column headers → enrichment lead field mappings

export const LEAD_FIELDS = [
  { key: 'email', label: 'Email', required: true },
  { key: 'first_name', label: 'First Name', required: false },
  { key: 'last_name', label: 'Last Name', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'company_name', label: 'Company Name', required: false },
  { key: 'job_title', label: 'Job Title', required: false },
  { key: 'linkedin_url', label: 'LinkedIn URL', required: false },
  { key: 'skip', label: '(Skip)', required: false },
] as const;

export type LeadFieldKey = (typeof LEAD_FIELDS)[number]['key'];

const HEADER_PATTERNS: Record<string, RegExp[]> = {
  email: [/e[-_]?mail/i, /email.?address/i, /^e[-_]?mail$/i],
  first_name: [/first.?name/i, /^first$/i, /^fname$/i, /given.?name/i],
  last_name: [/last.?name/i, /^last$/i, /^lname$/i, /sur.?name/i, /family.?name/i],
  phone: [/phone/i, /mobile/i, /cell/i, /tel/i],
  company_name: [/company/i, /organization/i, /org/i, /employer/i],
  job_title: [/title/i, /position/i, /role/i, /job/i],
  linkedin_url: [/linkedin/i, /li.?url/i],
};

/** Strip BOM and normalize whitespace from a header string */
export function cleanHeader(raw: string): string {
  return raw.replace(/^\uFEFF/, '').trim();
}

export function autoDetectMapping(headers: string[]): Record<string, LeadFieldKey> {
  const mapping: Record<string, LeadFieldKey> = {};
  const usedFields = new Set<string>();

  for (const header of headers) {
    const normalized = cleanHeader(header);
    let matched = false;

    for (const [field, patterns] of Object.entries(HEADER_PATTERNS)) {
      if (usedFields.has(field)) continue;
      if (patterns.some(p => p.test(normalized))) {
        mapping[header] = field as LeadFieldKey;
        usedFields.add(field);
        matched = true;
        break;
      }
    }

    if (!matched) {
      mapping[header] = 'skip';
    }
  }

  return mapping;
}

export function applyMapping(
  rows: Record<string, string>[],
  mapping: Record<string, LeadFieldKey>
): Record<string, string>[] {
  return rows.map(row => {
    const lead: Record<string, string> = {};
    for (const [csvCol, field] of Object.entries(mapping)) {
      if (field === 'skip') continue;
      const value = row[csvCol]?.trim();
      if (value) lead[field] = value;
    }
    return lead;
  });
}
