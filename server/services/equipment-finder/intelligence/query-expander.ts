import { claudeService } from '../../claude-service';
import { createLogger } from '../../../utils/logger';
import type { SearchQuery } from '../types';

const log = createLogger('equipment-query-expander');

const SYSTEM_PROMPT = `You are an equipment-market expert. Parse natural-language searches for heavy equipment, industrial machinery, and vehicles into structured filters AND generate search-term expansions.

For each query, return JSON with these fields:
- equipment_type: Specific category (excavator, bulldozer, skid steer, etc.)
- make: Manufacturer if mentioned (CAT, John Deere, Komatsu, etc.)
- model: Model number/name if mentioned
- year_min / year_max: Year range if mentioned
- price_min / price_max: Price range in USD if mentioned
- hours_max: Max hours if mentioned
- mileage_max: Max miles if mentioned (for vehicles)
- condition_min: Minimum acceptable condition
- zip_code: Origin ZIP if location mentioned
- radius_miles: Search radius if mentioned
- expanded_terms: 5-10 synonyms (excavator → trackhoe, track hoe, digger)
- make_variations: Brand variations (CAT → Caterpillar, Cat)
- misspelling_variants: 3-5 common misspellings (excavator → excvator, exacavator)

Respond with ONLY the JSON object, no other text.`;

export async function expandQuery(rawQuery: string): Promise<SearchQuery> {
  const fallback: SearchQuery = {
    rawQuery,
    expandedTerms: [],
    makeVariations: [],
    misspellingVariants: [],
    sources: [],
  };

  if (!claudeService.available) {
    log.warn('Claude not available, skipping query expansion');
    return fallback;
  }

  try {
    const client = claudeService.getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: rawQuery }],
    });

    const block = response.content[0];
    if (block.type !== 'text') return fallback;
    const data = extractJson(block.text);
    if (!data) return fallback;

    return {
      rawQuery,
      equipmentType: data.equipment_type ?? undefined,
      make: data.make ?? undefined,
      model: data.model ?? undefined,
      yearMin: asInt(data.year_min),
      yearMax: asInt(data.year_max),
      priceMin: asNum(data.price_min),
      priceMax: asNum(data.price_max),
      hoursMax: asInt(data.hours_max),
      mileageMax: asInt(data.mileage_max),
      conditionMin: data.condition_min ?? undefined,
      zipCode: data.zip_code ?? undefined,
      radiusMiles: asInt(data.radius_miles),
      expandedTerms: Array.isArray(data.expanded_terms) ? data.expanded_terms : [],
      makeVariations: Array.isArray(data.make_variations) ? data.make_variations : [],
      misspellingVariants: Array.isArray(data.misspelling_variants) ? data.misspelling_variants : [],
      sources: [],
    };
  } catch (err) {
    log.error('Query expansion failed', { error: String(err) });
    return fallback;
  }
}

function extractJson(text: string): any | null {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\n?/, '').replace(/```$/, '').trim();
  }
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function asInt(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function asNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
