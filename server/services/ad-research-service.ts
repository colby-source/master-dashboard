import { claudeService } from './claude-service';
import { getDb } from '../db';

// ── Types ────────────────────────────────────────────────────────

interface CompetitorAdInsight {
  id: number;
  page_name: string;
  creative_body: string | null;
  creative_link_title: string | null;
  winner_score: number;
  days_active: number;
  analysis: Record<string, unknown> | null;
}

export interface ResearchContext {
  competitorAds: CompetitorAdInsight[];
  brandContext: BrandContext;
  compiledAt: string;
}

interface BrandContext {
  name: string;
  tagline: string;
  fund: string;
  preferredReturn: string;
  targetIRR: string;
  minimum: string;
  structure: string;
  disclaimer: string;
  colors: { navy: string; gold: string; ctaOrange: string };
}

export interface StrategicBrief {
  id?: number;
  messagingAngles: string[];
  audienceInsights: string[];
  competitiveGaps: string[];
  recommendedHooks: string[];
  ctaStrategies: string[];
  visualDirection: string[];
  rawText: string;
  createdAt: string;
}

export interface AdCopyVariant {
  angle: string;
  headline: string;
  primaryText: string;
  description: string;
  ctaType: string;
  complianceNote: string;
}

// ── Constants ────────────────────────────────────────────────────

const GPC_BRAND_CONTEXT: BrandContext = {
  name: 'Granite Park Capital',
  tagline: 'Vertically Integrated Real Estate Private Equity',
  fund: '$100M affordable housing BTR fund',
  preferredReturn: '8% preferred return',
  targetIRR: '19.2% target IRR',
  minimum: '$250,000',
  structure: '506(c) Regulation D — general solicitation permitted, accredited investors only',
  disclaimer:
    'This offering is available only to verified accredited investors under Rule 506(c) of Regulation D. Past performance is not indicative of future results.',
  colors: { navy: '#0C1C54', gold: '#C4B49C', ctaOrange: '#FE9A00' },
};

const AD_ANGLES = [
  { key: 'irr_returns', label: 'IRR/Returns focused', hook: '19.2% target IRR, 8% preferred return' },
  { key: 'housing_mission', label: 'Housing mission focused', hook: 'Affordable housing with institutional returns' },
  { key: 'tax_benefits', label: 'Tax benefits focused', hook: 'Cost segregation, depreciation, 1031 exchange' },
  { key: 'social_proof', label: 'Social proof focused', hook: '$100M fund, vertically integrated' },
  { key: 'scarcity_urgency', label: 'Scarcity/urgency focused', hook: 'Limited allocation remaining, $250K minimum' },
] as const;

const LOG_PREFIX = '[AdResearch]';

// ── Service ──────────────────────────────────────────────────────

class AdResearchService {
  private tablesReady = false;

  private async ensureTables(): Promise<void> {
    if (this.tablesReady) return;
    const db = await getDb();
    db.run(
      `CREATE TABLE IF NOT EXISTS ad_research_briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brief_json TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`
    );
    db.run(
      `CREATE TABLE IF NOT EXISTS ad_research_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        angle TEXT NOT NULL,
        headline TEXT NOT NULL,
        primary_text TEXT NOT NULL,
        description TEXT NOT NULL,
        cta_type TEXT NOT NULL,
        compliance_note TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`
    );
    this.tablesReady = true;
  }

  /**
   * Pull top-scoring competitor ads and combine with GPC brand context.
   */
  async compileResearchContext(): Promise<ResearchContext> {
    console.log(`${LOG_PREFIX} Compiling research context...`);
    const db = await getDb();

    const results = db.exec(
      `SELECT id, page_name, creative_body, creative_link_title, winner_score, days_active, analysis_json
       FROM competitor_ads
       WHERE winner_score > 60
       ORDER BY winner_score DESC
       LIMIT 20`
    );

    const competitorAds: CompetitorAdInsight[] = [];

    if (results.length > 0) {
      for (const row of results[0].values) {
        competitorAds.push({
          id: row[0] as number,
          page_name: row[1] as string,
          creative_body: row[2] as string | null,
          creative_link_title: row[3] as string | null,
          winner_score: row[4] as number,
          days_active: row[5] as number,
          analysis: parseJsonSafe(row[6] as string | null),
        });
      }
    }

    console.log(`${LOG_PREFIX} Found ${competitorAds.length} high-scoring competitor ads`);

    return {
      competitorAds,
      brandContext: GPC_BRAND_CONTEXT,
      compiledAt: new Date().toISOString(),
    };
  }

  /**
   * Generate a strategic brief from competitor analysis + GPC fund context.
   */
  async generateStrategicBrief(context?: ResearchContext): Promise<StrategicBrief> {
    await this.ensureTables();
    const researchContext = context ?? (await this.compileResearchContext());
    console.log(`${LOG_PREFIX} Generating strategic brief...`);

    if (!claudeService.available) {
      throw new Error(`${LOG_PREFIX} Claude API key not configured`);
    }

    const competitorSummary = researchContext.competitorAds
      .map((ad, i) => {
        const analysisStr = ad.analysis ? JSON.stringify(ad.analysis) : 'No analysis available';
        return `${i + 1}. "${ad.page_name}" (Score: ${ad.winner_score}, Active ${ad.days_active} days)
   Copy: ${ad.creative_body ?? 'N/A'}
   Headline: ${ad.creative_link_title ?? 'N/A'}
   Analysis: ${analysisStr}`;
      })
      .join('\n\n');

    const brand = researchContext.brandContext;

    const prompt = `You are an expert ad strategist for real estate private equity funds.

BRAND CONTEXT:
- Name: ${brand.name}
- Tagline: "${brand.tagline}"
- Fund: ${brand.fund}
- Returns: ${brand.preferredReturn}, ${brand.targetIRR}
- Minimum Investment: ${brand.minimum}
- Structure: ${brand.structure}

COMPETITOR AD ANALYSIS (Top ${researchContext.competitorAds.length} ads by winner score):
${competitorSummary || 'No competitor ads found — generate brief from brand context alone.'}

Based on this competitive landscape and brand positioning, produce a strategic advertising brief. Return ONLY valid JSON with this exact structure:

{
  "messagingAngles": ["angle1", "angle2", ...],
  "audienceInsights": ["insight1", "insight2", ...],
  "competitiveGaps": ["gap1", "gap2", ...],
  "recommendedHooks": ["hook1", "hook2", ...],
  "ctaStrategies": ["cta1", "cta2", ...],
  "visualDirection": ["direction1", "direction2", ...]
}

Each array should contain 3-5 items. Focus on what differentiates ${brand.name} from competitors.
Remember this is a 506(c) offering — all messaging must be appropriate for accredited investor solicitation.`;

    const client = claudeService.getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    const rawText = block.type === 'text' ? block.text : '';

    const parsed = extractJson<Omit<StrategicBrief, 'id' | 'rawText' | 'createdAt'>>(rawText);
    if (!parsed) {
      throw new Error(`${LOG_PREFIX} Failed to parse strategic brief JSON from Claude response`);
    }

    const brief: StrategicBrief = {
      messagingAngles: parsed.messagingAngles ?? [],
      audienceInsights: parsed.audienceInsights ?? [],
      competitiveGaps: parsed.competitiveGaps ?? [],
      recommendedHooks: parsed.recommendedHooks ?? [],
      ctaStrategies: parsed.ctaStrategies ?? [],
      visualDirection: parsed.visualDirection ?? [],
      rawText,
      createdAt: new Date().toISOString(),
    };

    await this.saveBrief(brief);
    console.log(`${LOG_PREFIX} Strategic brief generated and saved`);

    return brief;
  }

  /**
   * Generate 5 ad copy variants across different messaging angles.
   */
  async generateAdCopyVariants(brief?: StrategicBrief): Promise<AdCopyVariant[]> {
    await this.ensureTables();
    const strategicBrief = brief ?? (await this.getLatestBrief());
    if (!strategicBrief) {
      throw new Error(`${LOG_PREFIX} No strategic brief available. Generate one first.`);
    }

    console.log(`${LOG_PREFIX} Generating ad copy variants...`);

    if (!claudeService.available) {
      throw new Error(`${LOG_PREFIX} Claude API key not configured`);
    }

    const anglesDescription = AD_ANGLES.map(
      (a) => `- "${a.key}": ${a.label} — hook: "${a.hook}"`
    ).join('\n');

    const prompt = `You are an expert ad copywriter for real estate private equity.

STRATEGIC BRIEF:
- Messaging Angles: ${JSON.stringify(strategicBrief.messagingAngles)}
- Audience Insights: ${JSON.stringify(strategicBrief.audienceInsights)}
- Competitive Gaps: ${JSON.stringify(strategicBrief.competitiveGaps)}
- Recommended Hooks: ${JSON.stringify(strategicBrief.recommendedHooks)}
- CTA Strategies: ${JSON.stringify(strategicBrief.ctaStrategies)}

BRAND: Granite Park Capital — $100M affordable housing BTR fund
RETURNS: 8% preferred return, 19.2% target IRR
MINIMUM: $250,000
COMPLIANCE: 506(c) Regulation D — accredited investors only

Generate exactly 5 ad copy variants, one for each angle:
${anglesDescription}

Return ONLY valid JSON as an array of objects with this structure:
[
  {
    "angle": "irr_returns",
    "headline": "max 40 characters",
    "primaryText": "max 125 characters",
    "description": "max 30 characters",
    "ctaType": "Learn More | Sign Up | Apply Now | Get Started"
  }
]

CONSTRAINTS:
- headline: max 40 characters
- primaryText: max 125 characters
- description: max 30 characters
- Each variant MUST include appropriate compliance language or reference to accredited investor status
- Do NOT include specific past performance claims as guarantees
- Use "target" or "projected" for return figures`;

    const client = claudeService.getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    const rawText = block.type === 'text' ? block.text : '';

    const parsed = extractJson<Array<Omit<AdCopyVariant, 'complianceNote'>>>(rawText);
    if (!parsed || !Array.isArray(parsed)) {
      throw new Error(`${LOG_PREFIX} Failed to parse ad copy variants JSON from Claude response`);
    }

    const variants: AdCopyVariant[] = parsed.map((v) => ({
      angle: v.angle,
      headline: v.headline,
      primaryText: v.primaryText,
      description: v.description,
      ctaType: v.ctaType,
      complianceNote: GPC_BRAND_CONTEXT.disclaimer,
    }));

    await this.saveVariants(variants);
    console.log(`${LOG_PREFIX} Generated ${variants.length} ad copy variants`);

    return variants;
  }

  /**
   * Retrieve the most recent strategic brief from the database.
   */
  async getLatestBrief(): Promise<StrategicBrief | null> {
    await this.ensureTables();
    const db = await getDb();

    const results = db.exec(
      `SELECT id, brief_json, raw_text, created_at
       FROM ad_research_briefs
       ORDER BY created_at DESC
       LIMIT 1`
    );

    if (results.length === 0 || results[0].values.length === 0) {
      return null;
    }

    const row = results[0].values[0];
    const briefData = parseJsonSafe(row[1] as string);
    if (!briefData) return null;

    return {
      id: row[0] as number,
      messagingAngles: (briefData as Record<string, string[]>).messagingAngles ?? [],
      audienceInsights: (briefData as Record<string, string[]>).audienceInsights ?? [],
      competitiveGaps: (briefData as Record<string, string[]>).competitiveGaps ?? [],
      recommendedHooks: (briefData as Record<string, string[]>).recommendedHooks ?? [],
      ctaStrategies: (briefData as Record<string, string[]>).ctaStrategies ?? [],
      visualDirection: (briefData as Record<string, string[]>).visualDirection ?? [],
      rawText: row[2] as string,
      createdAt: row[3] as string,
    };
  }

  /**
   * Run the full pipeline: compile context -> generate brief -> generate ad copy.
   */
  async fullResearchPipeline(): Promise<{ brief: StrategicBrief; variants: AdCopyVariant[] }> {
    console.log(`${LOG_PREFIX} Starting full research pipeline...`);

    const context = await this.compileResearchContext();
    const brief = await this.generateStrategicBrief(context);
    const variants = await this.generateAdCopyVariants(brief);

    console.log(`${LOG_PREFIX} Full research pipeline complete`);
    return { brief, variants };
  }

  // ── Private helpers ──────────────────────────────────────────

  private async saveBrief(brief: StrategicBrief): Promise<void> {
    const db = await getDb();

    db.run(
      `CREATE TABLE IF NOT EXISTS ad_research_briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brief_json TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`
    );

    const briefJson = JSON.stringify({
      messagingAngles: brief.messagingAngles,
      audienceInsights: brief.audienceInsights,
      competitiveGaps: brief.competitiveGaps,
      recommendedHooks: brief.recommendedHooks,
      ctaStrategies: brief.ctaStrategies,
      visualDirection: brief.visualDirection,
    });

    db.run(
      `INSERT INTO ad_research_briefs (brief_json, raw_text, created_at) VALUES (?, ?, ?)`,
      [briefJson, brief.rawText, brief.createdAt]
    );
  }

  private async saveVariants(variants: AdCopyVariant[]): Promise<void> {
    const db = await getDb();

    db.run(
      `CREATE TABLE IF NOT EXISTS ad_research_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        angle TEXT NOT NULL,
        headline TEXT NOT NULL,
        primary_text TEXT NOT NULL,
        description TEXT NOT NULL,
        cta_type TEXT NOT NULL,
        compliance_note TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`
    );

    for (const variant of variants) {
      db.run(
        `INSERT INTO ad_research_variants (angle, headline, primary_text, description, cta_type, compliance_note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [variant.angle, variant.headline, variant.primaryText, variant.description, variant.ctaType, variant.complianceNote]
      );
    }
  }
}

// ── Utility functions ────────────────────────────────────────────

function parseJsonSafe(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractJson<T>(text: string): T | null {
  // Try direct parse first
  try {
    return JSON.parse(text) as T;
  } catch {
    // Fall through
  }

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch {
      // Fall through
    }
  }

  // Try finding first JSON structure
  const jsonMatch = text.match(/[\[{][\s\S]*[\]}]/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      // Fall through
    }
  }

  return null;
}

export const adResearchService = new AdResearchService();
