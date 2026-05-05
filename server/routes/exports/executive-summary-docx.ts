import { Router, Request, Response } from 'express';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  TableRow,
  TableCell,
  Table,
  WidthType,
  ShadingType,
} from 'docx';
import { queryAll, queryOne } from '../../db';
import { heading, bodyText, bulletPoint } from './docx-helpers';
import { createLogger } from '../../utils/logger';
const log = createLogger('executive-summary-docx');

const router = Router();

router.get('/executive-summary.docx', async (_req: Request, res: Response) => {
  try {
    const summary = queryOne("SELECT COUNT(*) as active_campaigns FROM campaigns WHERE status = 'active'") || { active_campaigns: 0 };
    const openTasks = queryOne("SELECT COUNT(*) as count FROM tasks WHERE status != 'done'") || { count: 0 };
    const tasksDueToday = queryOne("SELECT COUNT(*) as count FROM tasks WHERE due_date = date('now') AND status != 'done'") || { count: 0 };
    const agentHealth = queryOne("SELECT AVG(success_rate) as avg FROM agents WHERE status = 'active'") || { avg: 100 };
    const unackAlerts = queryOne("SELECT COUNT(*) as count FROM alerts WHERE acknowledged = 0") || { count: 0 };
    const totalContacts = queryOne("SELECT COUNT(*) as count FROM enrichment_leads") || { count: 0 };
    const hotLeads = queryOne("SELECT COUNT(*) as count FROM enrichment_leads WHERE score_label = 'hot'") || { count: 0 };
    const warmLeads = queryOne("SELECT COUNT(*) as count FROM enrichment_leads WHERE score_label = 'warm'") || { count: 0 };
    const enrichedCount = queryOne("SELECT COUNT(*) as count FROM enrichment_leads WHERE status = 'enriched'") || { count: 0 };
    const approvedCount = queryOne("SELECT COUNT(*) as count FROM enrichment_leads WHERE instantly_push_status = 'pushed'") || { count: 0 };

    const totalImports = queryOne("SELECT COUNT(*) as count FROM bulk_imports") || { count: 0 };
    const totalImported = queryOne("SELECT COALESCE(SUM(inserted_count),0) as count FROM bulk_imports") || { count: 0 };
    const csvLeads = queryOne("SELECT COUNT(*) as count FROM enrichment_leads WHERE source = 'csv_import'") || { count: 0 };

    const companies = queryAll("SELECT id, name, color FROM companies ORDER BY id") || [];
    const campaigns = queryAll("SELECT name, status, stats_json FROM campaigns ORDER BY updated_at DESC LIMIT 10") || [];
    const agents = queryAll("SELECT name, status, type, success_rate, last_run FROM agents ORDER BY name") || [];
    const recentAlerts = queryAll("SELECT severity, message, source, created_at FROM alerts WHERE acknowledged = 0 ORDER BY created_at DESC LIMIT 10") || [];
    const topTasks = queryAll("SELECT title, priority, status FROM tasks WHERE status != 'done' ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 10") || [];

    const campaignRows = campaigns.map((c: any) => {
      const stats = typeof c.stats_json === 'string' ? JSON.parse(c.stats_json || '{}') : (c.stats_json || {});
      return new TableRow({
        children: [
          new TableCell({ width: { size: 3000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: c.name || '', size: 20 })] })] }),
          new TableCell({ width: { size: 1200, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: c.status || '', size: 20 })] })] }),
          new TableCell({ width: { size: 1200, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: `${stats.open_rate || 0}%`, size: 20 })] })] }),
          new TableCell({ width: { size: 1200, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: `${stats.reply_rate || 0}%`, size: 20 })] })] }),
          new TableCell({ width: { size: 1000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: `${stats.sent || 0}`, size: 20 })] })] }),
        ],
      });
    });

    const campaignTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            new TableCell({ width: { size: 3000, type: WidthType.DXA }, shading: { type: ShadingType.SOLID, color: '2d3748' }, children: [new Paragraph({ children: [new TextRun({ text: 'Campaign', bold: true, color: 'ffffff', size: 20 })] })] }),
            new TableCell({ width: { size: 1200, type: WidthType.DXA }, shading: { type: ShadingType.SOLID, color: '2d3748' }, children: [new Paragraph({ children: [new TextRun({ text: 'Status', bold: true, color: 'ffffff', size: 20 })] })] }),
            new TableCell({ width: { size: 1200, type: WidthType.DXA }, shading: { type: ShadingType.SOLID, color: '2d3748' }, children: [new Paragraph({ children: [new TextRun({ text: 'Open %', bold: true, color: 'ffffff', size: 20 })] })] }),
            new TableCell({ width: { size: 1200, type: WidthType.DXA }, shading: { type: ShadingType.SOLID, color: '2d3748' }, children: [new Paragraph({ children: [new TextRun({ text: 'Reply %', bold: true, color: 'ffffff', size: 20 })] })] }),
            new TableCell({ width: { size: 1000, type: WidthType.DXA }, shading: { type: ShadingType.SOLID, color: '2d3748' }, children: [new Paragraph({ children: [new TextRun({ text: 'Sent', bold: true, color: 'ffffff', size: 20 })] })] }),
          ],
        }),
        ...campaignRows,
      ],
    });

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              heading: HeadingLevel.TITLE,
              alignment: AlignmentType.CENTER,
              spacing: { after: 100 },
              children: [new TextRun({ text: 'Executive Summary', bold: true, size: 40 })],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 300 },
              children: [new TextRun({ text: `Master Dashboard — ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, size: 24, color: '666666' })],
            }),

            heading('Key Performance Indicators', HeadingLevel.HEADING_1),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ width: { size: 2000, type: WidthType.DXA }, shading: { type: ShadingType.SOLID, color: 'edf2f7' }, children: [new Paragraph({ children: [new TextRun({ text: 'Active Campaigns', bold: true, size: 22 })] })] }),
                    new TableCell({ width: { size: 1000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: `${summary.active_campaigns}`, size: 22 })] })] }),
                    new TableCell({ width: { size: 2000, type: WidthType.DXA }, shading: { type: ShadingType.SOLID, color: 'edf2f7' }, children: [new Paragraph({ children: [new TextRun({ text: 'Open Tasks', bold: true, size: 22 })] })] }),
                    new TableCell({ width: { size: 1000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: `${openTasks.count}`, size: 22 })] })] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ shading: { type: ShadingType.SOLID, color: 'edf2f7' }, children: [new Paragraph({ children: [new TextRun({ text: 'Agent Health', bold: true, size: 22 })] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${Math.round(agentHealth.avg || 100)}%`, size: 22 })] })] }),
                    new TableCell({ shading: { type: ShadingType.SOLID, color: 'edf2f7' }, children: [new Paragraph({ children: [new TextRun({ text: 'Unack. Alerts', bold: true, size: 22 })] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${unackAlerts.count}`, size: 22 })] })] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ shading: { type: ShadingType.SOLID, color: 'edf2f7' }, children: [new Paragraph({ children: [new TextRun({ text: 'Tasks Due Today', bold: true, size: 22 })] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${tasksDueToday.count}`, size: 22 })] })] }),
                    new TableCell({ shading: { type: ShadingType.SOLID, color: 'edf2f7' }, children: [new Paragraph({ children: [new TextRun({ text: 'Total Contacts', bold: true, size: 22 })] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${totalContacts.count}`, size: 22 })] })] }),
                  ],
                }),
              ],
            }),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            heading('Lead Pipeline', HeadingLevel.HEADING_1),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  tableHeader: true,
                  children: [
                    new TableCell({ shading: { type: ShadingType.SOLID, color: '2d3748' }, children: [new Paragraph({ children: [new TextRun({ text: 'Metric', bold: true, color: 'ffffff', size: 20 })] })] }),
                    new TableCell({ shading: { type: ShadingType.SOLID, color: '2d3748' }, children: [new Paragraph({ children: [new TextRun({ text: 'Count', bold: true, color: 'ffffff', size: 20 })] })] }),
                  ],
                }),
                new TableRow({ children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Hot Leads', size: 20 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${hotLeads.count}`, size: 20 })] })] }),
                ] }),
                new TableRow({ children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Warm Leads', size: 20 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${warmLeads.count}`, size: 20 })] })] }),
                ] }),
                new TableRow({ children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Enriched', size: 20 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${enrichedCount.count}`, size: 20 })] })] }),
                ] }),
                new TableRow({ children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Pushed to Cold Email', size: 20 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${approvedCount.count}`, size: 20 })] })] }),
                ] }),
              ],
            }),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            heading('Bulk CSV Imports', HeadingLevel.HEADING_1),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  tableHeader: true,
                  children: [
                    new TableCell({ shading: { type: ShadingType.SOLID, color: '2d3748' }, children: [new Paragraph({ children: [new TextRun({ text: 'Metric', bold: true, color: 'ffffff', size: 20 })] })] }),
                    new TableCell({ shading: { type: ShadingType.SOLID, color: '2d3748' }, children: [new Paragraph({ children: [new TextRun({ text: 'Count', bold: true, color: 'ffffff', size: 20 })] })] }),
                  ],
                }),
                new TableRow({ children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Total Imports', size: 20 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${totalImports.count}`, size: 20 })] })] }),
                ] }),
                new TableRow({ children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Total Leads Imported', size: 20 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${totalImported.count}`, size: 20 })] })] }),
                ] }),
                new TableRow({ children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'CSV Leads in System', size: 20 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${csvLeads.count}`, size: 20 })] })] }),
                ] }),
              ],
            }),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            heading('Companies', HeadingLevel.HEADING_1),
            ...companies.map((c: any) => bulletPoint(`${c.name} (ID: ${c.id})`)),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            heading('Campaign Performance (Top 10)', HeadingLevel.HEADING_1),
            campaignTable,
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            heading('Agent Status', HeadingLevel.HEADING_1),
            ...agents.map((a: any) =>
              new Paragraph({
                spacing: { after: 60 },
                children: [
                  new TextRun({ text: `${a.name}`, bold: true, size: 20 }),
                  new TextRun({ text: ` — ${a.status} | Type: ${a.type} | Success: ${a.success_rate}%${a.last_run ? ` | Last: ${a.last_run}` : ''}`, size: 20 }),
                ],
              }),
            ),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            heading('Active Alerts', HeadingLevel.HEADING_1),
            ...(recentAlerts.length > 0
              ? recentAlerts.map((a: any) =>
                  new Paragraph({
                    spacing: { after: 60 },
                    children: [
                      new TextRun({ text: `[${(a.severity || '').toUpperCase()}] `, bold: true, size: 20, color: a.severity === 'critical' ? 'e53e3e' : a.severity === 'warning' ? 'dd6b20' : '718096' }),
                      new TextRun({ text: `${a.message} (${a.source})`, size: 20 }),
                    ],
                  }),
                )
              : [bodyText('No active alerts.')]),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            heading('Priority Tasks', HeadingLevel.HEADING_1),
            ...(topTasks.length > 0
              ? topTasks.map((t: any) =>
                  new Paragraph({
                    spacing: { after: 60 },
                    children: [
                      new TextRun({ text: `[${(t.priority || '').toUpperCase()}] `, bold: true, size: 20 }),
                      new TextRun({ text: `${t.title} (${t.status})`, size: 20 }),
                    ],
                  }),
                )
              : [bodyText('No open tasks.')]),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename=Executive_Summary.docx');
    res.send(Buffer.from(buffer));
  } catch (err: any) {
    log.error('[Exports] Executive summary generation error: ' + err.message, err.stack);
    res.status(500).json({ error: 'Failed to generate executive summary document', detail: err.message });
  }
});

export default router;
