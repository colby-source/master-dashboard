import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { equipmentFinderService } from '../services/equipment-finder/equipment-finder-service';
import { createLogger } from '../utils/logger';

const log = createLogger('equipment-finder-route');
const router = Router();

const SearchRequestSchema = z.object({
  query: z.string().min(1),
  topN: z.number().int().min(1).max(50).default(10),
  minScore: z.number().min(0).max(100).default(0),
  sources: z.array(z.string()).optional(),
});

router.get('/sources', (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        sources: equipmentFinderService.registeredSources,
      },
    });
  } catch (err) {
    log.error('sources endpoint failed', { error: String(err) });
    res.status(500).json({ success: false, error: String(err) });
  }
});

router.post('/search', async (req: Request, res: Response) => {
  try {
    const parsed = SearchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues });
    }
    const { query, topN, minScore, sources } = parsed.data;

    const result = await equipmentFinderService.search(query, { topN, minScore, sources });

    res.json({
      success: true,
      data: {
        query: result.query,
        marketSummary: result.marketSummary,
        totalFound: result.totalFound,
        sourcesSearched: result.sourcesSearched,
        durationMs: result.durationMs,
        results: result.ranked.map((r) => ({
          listing: r.listing,
          dealScore: r.dealScore,
        })),
      },
    });
  } catch (err) {
    log.error('search endpoint failed', { error: String(err) });
    res.status(500).json({ success: false, error: String(err) });
  }
});

router.get('/history', (_req: Request, res: Response) => {
  try {
    const rows = equipmentFinderService.getRecentSearches(20);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

router.get('/top-deals', (_req: Request, res: Response) => {
  try {
    const rows = equipmentFinderService.getTopCachedDeals(20);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
