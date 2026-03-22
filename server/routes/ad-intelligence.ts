import { Router, Request, Response } from 'express';
import { adLibraryService, DEFAULT_SEARCH_TERMS } from '../services/ad-library-service';
import { scoreAllAds, getTopAds, getScoringSummary } from '../services/ad-scoring-service';
import { geminiImageService } from '../services/gemini-image-service';
import { adResearchService } from '../services/ad-research-service';
import { adLauncherService } from '../services/ad-launcher-service';
import { queryAll, queryOne, runSql, saveDb } from '../db';
import { claudeService } from '../services/claude-service';

// Helper to call Claude API
async function askClaude(prompt: string, maxTokens = 2000): Promise<string> {
  const client = claudeService.getClient();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

const router = Router();

// ── Discovery ────────────────────────────────────────────────────

// Search Meta Ad Library
router.post('/discover/search', async (req: Request, res: Response) => {
  try {
    const { searchTerms, activeOnly, limit, platforms } = req.body;
    const terms = searchTerms || DEFAULT_SEARCH_TERMS.slice(0, 5);

    const results: { term: string; found: number; stored: number }[] = [];

    for (const term of terms) {
      const ads = await adLibraryService.searchAds({
        search_terms: term,
        ad_active_status: activeOnly ? 'ACTIVE' : undefined,
        limit: limit || 50,
        publisher_platforms: platforms,
      });

      const stored = await adLibraryService.storeAds(ads, term);
      results.push({ term, found: ads.length, stored });
    }

    // Auto-score after discovery
    const scoring = scoreAllAds();

    res.json({
      success: true,
      data: {
        searchResults: results,
        totalFound: results.reduce((sum, r) => sum + r.found, 0),
        totalStored: results.reduce((sum, r) => sum + r.stored, 0),
        scoring,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search by specific page IDs (monitor known competitors)
router.post('/discover/by-page', async (req: Request, res: Response) => {
  try {
    const { pageIds, limit } = req.body;
    if (!pageIds?.length) {
      return res.status(400).json({ success: false, error: 'pageIds required' });
    }

    const ads = await adLibraryService.searchAdsPaginated(
      { search_terms: '', ad_active_status: 'ACTIVE', limit: limit || 50 },
    );
    const stored = await adLibraryService.storeAds(ads, 'page_monitor');

    res.json({ success: true, data: { found: ads.length, stored } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get default search terms
router.get('/discover/search-terms', (_req: Request, res: Response) => {
  res.json({ success: true, data: DEFAULT_SEARCH_TERMS });
});

// ── Stored Ads (Browse & Filter) ─────────────────────────────────

router.get('/ads', (req: Request, res: Response) => {
  try {
    const { limit, offset, sortBy, searchTerm, minScore, activeOnly } = req.query;
    const result = adLibraryService.getStoredAds({
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
      sortBy: sortBy as string,
      searchTerm: searchTerm as string,
      minScore: minScore ? parseInt(minScore as string) : undefined,
      activeOnly: activeOnly === 'true',
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/ads/:id', (req: Request, res: Response) => {
  try {
    const ad = adLibraryService.getAdById(parseInt(req.params.id));
    if (!ad) return res.status(404).json({ success: false, error: 'Ad not found' });
    res.json({ success: true, data: ad });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get competitor pages (grouped view)
router.get('/pages', (_req: Request, res: Response) => {
  try {
    const pages = adLibraryService.getCompetitorPages();
    res.json({ success: true, data: pages });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Scoring ──────────────────────────────────────────────────────

router.post('/score', (_req: Request, res: Response) => {
  try {
    const result = scoreAllAds();
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/score/summary', (_req: Request, res: Response) => {
  try {
    const summary = getScoringSummary();
    res.json({ success: true, data: summary });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/score/top', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const ads = getTopAds(limit);
    res.json({ success: true, data: ads });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Analysis (Claude AI) ─────────────────────────────────────────

// Batch analyze top ads (must be before /:id to avoid route conflict)
router.post('/analyze/batch', async (req: Request, res: Response) => {
  try {
    const limit = req.body.limit || 10;
    const ads = getTopAds(limit);
    const results: any[] = [];

    for (const ad of ads) {
      if (ad.analysis_json) {
        results.push({ id: ad.id, status: 'already_analyzed' });
        continue;
      }
      try {
        // Simplified analysis for batch
        const prompt = `Briefly analyze this real estate fund ad in 2-3 sentences. What's working, what's not?
Page: ${ad.page_name} | Body: ${(ad.creative_body || '').slice(0, 200)} | Days active: ${ad.days_active}`;
        const analysis = await askClaude(prompt);
        adLibraryService.updateAdAnalysis(ad.id, { summary: analysis }, ad.winner_score);
        results.push({ id: ad.id, status: 'analyzed' });
      } catch (err: any) {
        results.push({ id: ad.id, status: 'error', error: err.message });
      }
    }

    res.json({ success: true, data: results });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Analyze single ad
router.post('/analyze/:id', async (req: Request, res: Response) => {
  try {
    const ad = adLibraryService.getAdById(parseInt(req.params.id));
    if (!ad) return res.status(404).json({ success: false, error: 'Ad not found' });

    const prompt = `Analyze this competitor real estate fund advertisement. Score each dimension 1-10 and provide actionable insights for Granite Park Capital (a 506(c) affordable housing fund with $250K minimum, 7% preferred return, Section 8 + LIHTC strategy).

COMPETITOR AD:
- Page: ${ad.page_name}
- Headline: ${ad.creative_link_title || 'N/A'}
- Body: ${ad.creative_body || 'N/A'}
- CTA: ${ad.creative_link_description || 'N/A'}
- Platforms: ${ad.platforms || 'N/A'}
- Days Active: ${ad.days_active}
- Winner Score: ${ad.winner_score}/100

Analyze:
1. **Hook Strength** (1-10): How attention-grabbing is the opening?
2. **Copy Quality** (1-10): Persuasiveness, clarity, emotional triggers
3. **CTA Effectiveness** (1-10): Clear action, urgency, friction reduction
4. **Compliance** (1-10): Proper disclaimers, accredited investor language
5. **Differentiation** (1-10): Unique value props vs. generic claims
6. **Visual Strategy** (assessment): What visual approach are they using?

Then provide:
- **What GPC Can Steal**: Top 2-3 elements to adapt
- **What GPC Can Beat**: Weaknesses to exploit
- **Suggested GPC Ad Hook**: A better opening line for GPC

Return as JSON with keys: hookStrength, copyQuality, ctaEffectiveness, compliance, differentiation, visualStrategy, whatToSteal, whatToBeat, suggestedHook, overallAssessment`;

    const analysis = await askClaude(prompt);

    // Try to parse JSON from response
    let parsedAnalysis: any;
    try {
      const jsonMatch = analysis.match(/\{[\s\S]*\}/);
      parsedAnalysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: analysis };
    } catch {
      parsedAnalysis = { raw: analysis };
    }

    const analysisScore = parsedAnalysis.hookStrength && parsedAnalysis.copyQuality
      ? Math.round(
          (parsedAnalysis.hookStrength + parsedAnalysis.copyQuality +
           parsedAnalysis.ctaEffectiveness + parsedAnalysis.compliance +
           parsedAnalysis.differentiation) * 2
        )
      : ad.winner_score;

    adLibraryService.updateAdAnalysis(parseInt(req.params.id), parsedAnalysis, analysisScore);

    res.json({ success: true, data: { analysis: parsedAnalysis, score: analysisScore } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Creative Generation ──────────────────────────────────────────

router.post('/create/copy', async (req: Request, res: Response) => {
  try {
    const { style, format, competitorInsights, customContext } = req.body;

    // Get top competitor insights if not provided
    const insights = competitorInsights || getTopAds(5).map(ad => ({
      page: ad.page_name,
      body: (ad.creative_body || '').slice(0, 150),
      score: ad.winner_score,
    }));

    const prompt = `You are creating Facebook/Instagram ad copy for Granite Park Capital, a 506(c) real estate private equity fund.

FUND DETAILS:
- Granite Park Capital Affordable Housing Fund II, L.P.
- $50M target, $100M hard cap
- Fund I delivered 179% return on equity in 2 years
- 7% preferred return, quarterly distributions
- Section 8 + LIHTC strategy (government-backed rents + tax credits)
- $250K minimum, accredited investors only
- GP: Marc Menowitz, 4th-generation, 17,000+ units, ~$2B portfolio
- Colby Watkins is the face of the ads

COMPETITOR INTELLIGENCE:
${JSON.stringify(insights, null, 2)}

${customContext ? `ADDITIONAL CONTEXT:\n${customContext}\n` : ''}

STYLE: ${style || 'professional'}
FORMAT: ${format || 'feed_square'}

Generate 3 ad variants. For each, provide:
1. headline (max 40 chars)
2. body (max 125 chars for primary text)
3. description (max 30 chars)
4. cta (e.g., "Learn More", "Apply Now", "Book a Call")
5. hook_type (e.g., "statistic", "question", "authority", "pain_point", "social_proof")

IMPORTANT COMPLIANCE:
- Include "Accredited investors only" or "506(c)" reference
- Never guarantee returns — use "targeting" or "projected"
- Include "Past performance is not indicative of future results" in body if referencing Fund I

Return as JSON array of 3 variants.`;

    const response = await askClaude(prompt, 3000);

    let variants: any[];
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      variants = jsonMatch ? JSON.parse(jsonMatch[0]) : [{ raw: response }];
    } catch {
      variants = [{ raw: response }];
    }

    // Store generated variants
    for (const v of variants) {
      if (v.headline) {
        runSql(
          `INSERT INTO generated_ad_creatives (title, headline, body, cta, style, format, source_competitor_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            v.headline,
            v.headline,
            v.body || '',
            v.cta || 'Learn More',
            style || 'professional',
            format || 'feed_square',
            JSON.stringify(insights.map((i: any) => i.page)),
          ]
        );
      }
    }
    saveDb();

    res.json({ success: true, data: variants });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate image for a creative
router.post('/create/image', async (req: Request, res: Response) => {
  try {
    if (!geminiImageService.available) {
      return res.status(400).json({ success: false, error: 'Gemini API key not configured' });
    }

    const { headline, body, cta, style, format, includeText } = req.body;

    const result = await geminiImageService.generateAdCreative({
      headline: headline || 'Invest in Affordable Housing',
      body: body || '7% Preferred Return | Government-Backed Income',
      cta: cta || 'Learn More',
      style: style || 'professional',
      format: format || 'feed_square',
      includeText: includeText ?? false,
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate multiple image variants
router.post('/create/image-variants', async (req: Request, res: Response) => {
  try {
    if (!geminiImageService.available) {
      return res.status(400).json({ success: false, error: 'Gemini API key not configured' });
    }

    const { variants, formats, style, includeText } = req.body;

    const results = await geminiImageService.generateAdVariants(
      {
        headline: '',
        body: '',
        cta: 'Learn More',
        style: style || 'professional',
        format: 'feed_square',
        includeText: includeText ?? false,
      },
      variants || [{ headline: 'Invest Smart', body: 'Government-backed returns' }],
      formats || ['feed_square'],
    );

    res.json({ success: true, data: results });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List generated images
router.get('/create/images', (_req: Request, res: Response) => {
  try {
    const images = geminiImageService.listGeneratedImages();
    res.json({ success: true, data: images });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Generated Creatives (stored) ─────────────────────────────────

router.get('/creatives', (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    const where = status ? 'WHERE status = ?' : '';
    const params = status ? [status] : [];
    const creatives = queryAll(
      `SELECT * FROM generated_ad_creatives ${where} ORDER BY created_at DESC LIMIT 50`,
      params
    );
    res.json({ success: true, data: creatives });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/creatives/:id', (req: Request, res: Response) => {
  try {
    const { status, meta_ad_id, meta_campaign_id } = req.body;
    const updates: string[] = [];
    const params: any[] = [];

    if (status) { updates.push('status = ?'); params.push(status); }
    if (meta_ad_id) { updates.push('meta_ad_id = ?'); params.push(meta_ad_id); }
    if (meta_campaign_id) { updates.push('meta_campaign_id = ?'); params.push(meta_campaign_id); }
    updates.push("updated_at = datetime('now')");

    runSql(
      `UPDATE generated_ad_creatives SET ${updates.join(', ')} WHERE id = ?`,
      [...params, req.params.id]
    );
    saveDb();

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Brand Config ─────────────────────────────────────────────────

router.get('/brand', (_req: Request, res: Response) => {
  res.json({ success: true, data: geminiImageService.getBrandConfig() });
});

// ── Stats Overview ───────────────────────────────────────────────

router.get('/stats', (_req: Request, res: Response) => {
  try {
    const totalAds = queryOne('SELECT COUNT(*) as count FROM competitor_ads')?.count || 0;
    const activeAds = queryOne('SELECT COUNT(*) as count FROM competitor_ads WHERE delivery_stop IS NULL')?.count || 0;
    const avgScore = queryOne('SELECT AVG(winner_score) as avg FROM competitor_ads WHERE winner_score > 0')?.avg || 0;
    const totalCreatives = queryOne('SELECT COUNT(*) as count FROM generated_ad_creatives')?.count || 0;
    const launchedCreatives = queryOne("SELECT COUNT(*) as count FROM generated_ad_creatives WHERE status = 'launched'")?.count || 0;
    const uniquePages = queryOne('SELECT COUNT(DISTINCT page_id) as count FROM competitor_ads')?.count || 0;

    res.json({
      success: true,
      data: {
        totalAds,
        activeAds,
        avgScore: Math.round(avgScore),
        totalCreatives,
        launchedCreatives,
        uniqueCompetitors: uniquePages,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Research (Strategic Brief + Ad Copy Variants) ────────────────

// Generate strategic brief from competitor analysis + GPC context
router.post('/research/brief', async (_req: Request, res: Response) => {
  try {
    const brief = await adResearchService.generateStrategicBrief();
    res.json({ success: true, data: brief });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get the latest strategic brief
router.get('/research/brief', async (_req: Request, res: Response) => {
  try {
    const brief = await adResearchService.getLatestBrief();
    if (!brief) return res.json({ success: true, data: null });
    res.json({ success: true, data: brief });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate 5 ad copy variants from strategic brief
router.post('/research/variants', async (_req: Request, res: Response) => {
  try {
    const variants = await adResearchService.generateAdCopyVariants();
    res.json({ success: true, data: variants });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run full research pipeline (context → brief → variants)
router.post('/research/pipeline', async (_req: Request, res: Response) => {
  try {
    const result = await adResearchService.fullResearchPipeline();
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get compiled research context (competitor ads + brand info)
router.get('/research/context', async (_req: Request, res: Response) => {
  try {
    const context = await adResearchService.compileResearchContext();
    res.json({ success: true, data: context });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Launch (Meta Campaign Management) ───────────────────────────

// Launch campaign from approved creatives
router.post('/launch', async (req: Request, res: Response) => {
  try {
    const { creativeIds, dailyBudget, campaignName } = req.body;
    if (!creativeIds?.length) {
      return res.status(400).json({ success: false, error: 'creativeIds required' });
    }
    const result = await adLauncherService.launchCampaign(creativeIds, {
      dailyBudget,
      campaignName,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get launch status for all launched creatives
router.get('/launch/status', async (_req: Request, res: Response) => {
  try {
    const status = await adLauncherService.getLaunchStatus();
    res.json({ success: true, data: status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Monitor performance of launched ads
router.post('/launch/monitor', async (_req: Request, res: Response) => {
  try {
    const report = await adLauncherService.monitorPerformance();
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Scale winning ad sets (increase budget by 20%)
router.post('/launch/scale', async (req: Request, res: Response) => {
  try {
    const { maxDailyBudget } = req.body;
    await adLauncherService.scaleWinners(maxDailyBudget);
    res.json({ success: true, message: 'Winners scaled successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Pause underperforming ads
router.post('/launch/pause', async (req: Request, res: Response) => {
  try {
    const { minDays, minSpend, minCtr } = req.body;
    await adLauncherService.pauseUnderperformers(minDays, minSpend, minCtr);
    res.json({ success: true, message: 'Underperformers paused' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Cleanup ──────────────────────────────────────────────────────

router.post('/prune', (req: Request, res: Response) => {
  try {
    const daysOld = req.body.daysOld || 180;
    const pruned = adLibraryService.pruneOldAds(daysOld);
    res.json({ success: true, data: { pruned } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
