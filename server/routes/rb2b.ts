import { Router } from 'express';
import { queryAll, queryOne } from '../db';

const router = Router();

// GET /visitors — RB2B visitors with enrichment data
router.get('/visitors', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;
    const companyId = req.query.company_id as string | undefined;
    const search = req.query.search as string | undefined;

    let where = "el.source = 'rb2b'";
    const params: any[] = [];

    if (status) {
      where += ' AND el.status = ?';
      params.push(status);
    }
    if (companyId) {
      where += ' AND el.company_id = ?';
      params.push(parseInt(companyId));
    }
    if (search) {
      where += ' AND (el.email LIKE ? OR el.first_name LIKE ? OR el.last_name LIKE ? OR el.company_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const visitors = queryAll(
      `SELECT el.*,
              ee_first.event_data as first_visit_data
       FROM enrichment_leads el
       LEFT JOIN (
         SELECT enrichment_lead_id, event_data,
                ROW_NUMBER() OVER (PARTITION BY enrichment_lead_id ORDER BY created_at ASC) as rn
         FROM enrichment_events
         WHERE event_type = 'webhook_received'
       ) ee_first ON ee_first.enrichment_lead_id = el.id AND ee_first.rn = 1
       WHERE ${where}
       ORDER BY el.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const total = queryOne(
      `SELECT COUNT(*) as count FROM enrichment_leads el WHERE ${where}`,
      params
    ) as any;

    res.json({ visitors, total: total?.count ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /stats — RB2B visitor statistics
router.get('/stats', (req, res) => {
  try {
    const companyId = req.query.company_id as string | undefined;
    const companyFilter = companyId ? ' AND company_id = ?' : '';
    const companyParams = companyId ? [parseInt(companyId)] : [];

    const total = queryOne(
      `SELECT COUNT(*) as count FROM enrichment_leads WHERE source = 'rb2b'${companyFilter}`,
      companyParams
    ) as any;

    const today = queryOne(
      `SELECT COUNT(*) as count FROM enrichment_leads
       WHERE source = 'rb2b' AND date(created_at) = date('now')${companyFilter}`,
      companyParams
    ) as any;

    const thisWeek = queryOne(
      `SELECT COUNT(*) as count FROM enrichment_leads
       WHERE source = 'rb2b' AND created_at > datetime('now', '-7 days')${companyFilter}`,
      companyParams
    ) as any;

    const enriched = queryOne(
      `SELECT COUNT(*) as count FROM enrichment_leads
       WHERE source = 'rb2b' AND status = 'enriched'${companyFilter}`,
      companyParams
    ) as any;

    const scored = queryOne(
      `SELECT COUNT(*) as count FROM enrichment_leads
       WHERE source = 'rb2b' AND score IS NOT NULL${companyFilter}`,
      companyParams
    ) as any;

    const hotLeads = queryOne(
      `SELECT COUNT(*) as count FROM enrichment_leads
       WHERE source = 'rb2b' AND score_label = 'hot'${companyFilter}`,
      companyParams
    ) as any;

    const byStatus = queryAll(
      `SELECT status, COUNT(*) as count FROM enrichment_leads
       WHERE source = 'rb2b'${companyFilter}
       GROUP BY status ORDER BY count DESC`,
      companyParams
    );

    const dailyVolume = queryAll(
      `SELECT date(created_at) as day, COUNT(*) as count
       FROM enrichment_leads
       WHERE source = 'rb2b' AND created_at > datetime('now', '-30 days')${companyFilter}
       GROUP BY day ORDER BY day`,
      companyParams
    );

    const topPages = queryAll(
      `SELECT json_extract(ee.event_data, '$.page_url') as page_url, COUNT(*) as visits
       FROM enrichment_events ee
       JOIN enrichment_leads el ON ee.enrichment_lead_id = el.id
       WHERE el.source = 'rb2b' AND ee.event_type = 'webhook_received'
         AND json_extract(ee.event_data, '$.page_url') IS NOT NULL${companyFilter ? ' AND el.company_id = ?' : ''}
       GROUP BY page_url ORDER BY visits DESC LIMIT 10`,
      companyParams
    );

    res.json({
      total: total?.count ?? 0,
      today: today?.count ?? 0,
      thisWeek: thisWeek?.count ?? 0,
      enriched: enriched?.count ?? 0,
      scored: scored?.count ?? 0,
      hotLeads: hotLeads?.count ?? 0,
      byStatus,
      dailyVolume,
      topPages,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /visitors/:id — single visitor detail with all events
router.get('/visitors/:id', (req, res) => {
  try {
    const { id } = req.params;
    const visitor = queryOne(
      `SELECT * FROM enrichment_leads WHERE id = ? AND source = 'rb2b'`,
      [id]
    );

    if (!visitor) {
      return res.status(404).json({ error: 'Visitor not found' });
    }

    const events = queryAll(
      `SELECT * FROM enrichment_events WHERE enrichment_lead_id = ? ORDER BY created_at DESC`,
      [id]
    );

    res.json({ visitor, events });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
