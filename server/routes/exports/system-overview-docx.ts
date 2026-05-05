import { Router, Request, Response } from 'express';
import { Document, Packer } from 'docx';
import { queryAll, queryOne } from '../../db';
import {
  SystemStats,
  buildCoverPage,
  buildTableOfContents,
  buildExecutiveOverview,
  buildArchitectureSection,
  buildLiveStatistics,
  buildFeatureInventory,
} from './system-overview-sections';
import {
  buildDetailedSections,
  buildClosingSections,
} from './system-overview-details';
import { createLogger } from '../../utils/logger';
const log = createLogger('system-overview-docx');

const router = Router();

router.get('/system-overview.docx', async (_req: Request, res: Response) => {
  try {
    // ── Gather live data ──────────────────────────────────────
    const totalCompanies = queryOne("SELECT COUNT(*) as count FROM companies") || { count: 0 };
    const totalLeads = queryOne("SELECT COUNT(*) as count FROM enrichment_leads") || { count: 0 };
    const totalCampaigns = queryOne("SELECT COUNT(*) as count FROM campaigns") || { count: 0 };
    const activeCampaigns = queryOne("SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'") || { count: 0 };
    const totalAgents = queryOne("SELECT COUNT(*) as count FROM agents") || { count: 0 };
    const totalTasks = queryOne("SELECT COUNT(*) as count FROM tasks") || { count: 0 };
    const totalAlerts = queryOne("SELECT COUNT(*) as count FROM alerts") || { count: 0 };
    const totalEvents = queryOne("SELECT COUNT(*) as count FROM events") || { count: 0 };
    const hotLeads = queryOne("SELECT COUNT(*) as count FROM enrichment_leads WHERE score_label = 'hot'") || { count: 0 };
    const warmLeads = queryOne("SELECT COUNT(*) as count FROM enrichment_leads WHERE score_label = 'warm'") || { count: 0 };
    const enrichedLeads = queryOne("SELECT COUNT(*) as count FROM enrichment_leads WHERE status IN ('enriched','scored','pushed')") || { count: 0 };
    const totalImports = queryOne("SELECT COUNT(*) as count FROM bulk_imports") || { count: 0 };
    const companies = queryAll("SELECT id, name FROM companies ORDER BY id") || [];

    const genDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const stats: SystemStats = {
      totalCompanies: totalCompanies.count,
      totalLeads: totalLeads.count,
      hotLeads: hotLeads.count,
      warmLeads: warmLeads.count,
      enrichedLeads: enrichedLeads.count,
      totalCampaigns: totalCampaigns.count,
      activeCampaigns: activeCampaigns.count,
      totalAgents: totalAgents.count,
      totalTasks: totalTasks.count,
      totalAlerts: totalAlerts.count,
      totalEvents: totalEvents.count,
      totalImports: totalImports.count,
    };

    // ── Assemble document from section builders ───────────────
    const doc = new Document({
      styles: {
        paragraphStyles: [
          {
            id: 'customNormal',
            name: 'Custom Normal',
            basedOn: 'Normal',
            run: { size: 22, font: 'Calibri' },
          },
        ],
      },
      sections: [
        {
          properties: {},
          children: [
            ...buildCoverPage(genDate),
            ...buildTableOfContents(),
            ...buildExecutiveOverview(),
            ...buildArchitectureSection(),
            ...buildLiveStatistics(stats, genDate),
            ...buildFeatureInventory(),
            ...buildDetailedSections(),
            ...buildClosingSections(companies, genDate),
          ],
        },
      ],
    });

    // ── Generate and send ─────────────────────────────────────
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename=Master_Dashboard_System_Overview.docx');
    res.send(Buffer.from(buffer));
  } catch (err: any) {
    log.error('[Exports] System overview generation error: ' + err.message, err.stack);
    res.status(500).json({ error: 'Failed to generate system overview document', detail: err.message });
  }
});

export default router;
