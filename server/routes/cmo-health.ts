import { Router } from 'express';
import { runAllHealthChecks, runHealthCheck } from '../services/cmo-health-monitor';
import { queryAll } from '../db';

const router = Router();

// POST /api/cmo/health — run health checks for all companies
router.post('/health', async (_req, res) => {
  try {
    await runAllHealthChecks();
    res.json({ success: true, message: 'Health checks completed and digests sent' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cmo/health/:companyId — run health check for a specific company
router.post('/health/:companyId', async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId);
    const row = queryAll(
      `SELECT ec.company_id, ec.target_instantly_campaign_id, cp.company_name
       FROM enrichment_config ec
       LEFT JOIN company_playbooks cp ON cp.company_id = ec.company_id
       WHERE ec.company_id = ? AND ec.target_instantly_campaign_id IS NOT NULL`,
      [companyId]
    )[0] as any;

    if (!row) {
      return res.status(404).json({ error: `No active campaign found for company ${companyId}` });
    }

    const digest = await runHealthCheck(companyId, row.target_instantly_campaign_id, row.company_name || `Company ${companyId}`);
    res.json(digest);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
