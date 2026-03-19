import {
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
import { heading, bodyText, bulletPoint } from './docx-helpers';

// ── Local helpers ──────────────────────────────────────────
export function sectionGap() {
  return new Paragraph({ spacing: { after: 240 }, children: [] });
}

export function boldBodyText(label: string, value: string) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 22 }),
      new TextRun({ text: value, size: 22 }),
    ],
  });
}

// ── Cover page ─────────────────────────────────────────────
export function buildCoverPage(genDate: string): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 2400 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: 'MASTER DASHBOARD', bold: true, size: 56, font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: 'Command Center', size: 40, color: '4a5568', font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [new TextRun({ text: 'Complete System Overview & Capabilities Document', size: 24, color: '718096', font: 'Calibri', italics: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: `Generated: ${genDate}`, size: 22, color: '999999' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: 'CONFIDENTIAL \u2014 For Internal Use Only', size: 20, color: 'cc0000', bold: true })],
    }),
  ];
}

// ── Table of contents ──────────────────────────────────────
export function buildTableOfContents(): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 800 }, children: [] }),
    heading('Table of Contents', HeadingLevel.HEADING_1),
    bodyText('1.  Executive Overview'),
    bodyText('2.  System Architecture'),
    bodyText('3.  Live System Statistics'),
    bodyText('4.  Feature Inventory (24 Modules)'),
    bodyText('5.  Lead Enrichment & Scoring Pipeline'),
    bodyText('6.  Cold Email Campaign Engine'),
    bodyText('7.  AI-Powered Reply Management'),
    bodyText('8.  CRM Integration (GoHighLevel)'),
    bodyText('9.  Social Media Outreach Suite'),
    bodyText('10. Advertising Management (Meta Ads)'),
    bodyText('11. Web Scraping & Data Collection'),
    bodyText('12. Competitor Intelligence'),
    bodyText('13. Business Intelligence & AI Insights'),
    bodyText('14. Task Management & Team Coordination'),
    bodyText('15. Conference & Networking Coordinator'),
    bodyText('16. Infrastructure & Automation Agents'),
    bodyText('17. Bulk CSV Import System'),
    bodyText('18. Data Export & Reporting'),
    bodyText('19. External API Integrations (15+)'),
    bodyText('20. Real-Time WebSocket Architecture'),
    bodyText('21. Key Automated Workflows'),
    bodyText('22. Multi-Tenant Company Architecture'),
    sectionGap(),
  ];
}

// ── Section 1: Executive overview ──────────────────────────
export function buildExecutiveOverview(): Paragraph[] {
  return [
    heading('1. Executive Overview', HeadingLevel.HEADING_1),
    bodyText('The Master Dashboard is a proprietary, enterprise-grade command center that consolidates sales operations, marketing automation, lead intelligence, and multi-channel outreach into a single unified platform. It was purpose-built to eliminate the need for switching between dozens of disconnected SaaS tools.'),
    sectionGap(),
    bodyText('The platform orchestrates the full revenue pipeline:'),
    bulletPoint('Data Intake \u2014 Ingest leads from CSV uploads, LinkedIn scraping, Instagram scraping, Meta Ads, webhooks, and manual entry'),
    bulletPoint('Enrichment \u2014 Automatically enrich every lead with People Data Labs (company, job title, location, social profiles) and verify emails with Hunter.io'),
    bulletPoint('AI Scoring \u2014 Claude AI scores each lead 0-100 against your custom Ideal Customer Profile, categorizing as Hot, Warm, Cool, or Cold'),
    bulletPoint('CRM Sync \u2014 Qualified leads are automatically pushed to GoHighLevel with tags, custom fields, and workflow triggers'),
    bulletPoint('Cold Email \u2014 Approved leads are imported to Instantly campaigns with multi-step sequences, A/B testing, and warmup management'),
    bulletPoint('Reply Handling \u2014 Incoming replies are analyzed by AI for sentiment, and intelligent auto-responses are generated using company-specific playbooks'),
    bulletPoint('Conversion Tracking \u2014 Track leads from first touch through meeting booked, proposal sent, and deal won'),
    sectionGap(),
    boldBodyText('Core Value Proposition', 'One platform replaces Instantly + GoHighLevel + People Data Labs + Hunter.io + Apify + Meta Ads Manager + a spreadsheet for tracking. Everything is connected, automated, and AI-enhanced.'),
    sectionGap(),
  ];
}

// ── Section 2: Architecture ────────────────────────────────
export function buildArchitectureSection(): (Paragraph | Table)[] {
  return [
    heading('2. System Architecture', HeadingLevel.HEADING_1),
    heading('Technology Stack', HeadingLevel.HEADING_2),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: [
          new TableCell({ shading: { type: ShadingType.SOLID, color: '1a202c' }, children: [new Paragraph({ children: [new TextRun({ text: 'Layer', bold: true, color: 'ffffff', size: 20 })] })] }),
          new TableCell({ shading: { type: ShadingType.SOLID, color: '1a202c' }, children: [new Paragraph({ children: [new TextRun({ text: 'Technology', bold: true, color: 'ffffff', size: 20 })] })] }),
          new TableCell({ shading: { type: ShadingType.SOLID, color: '1a202c' }, children: [new Paragraph({ children: [new TextRun({ text: 'Purpose', bold: true, color: 'ffffff', size: 20 })] })] }),
        ] }),
        ...([
          ['Frontend', 'React + TypeScript + Vite', 'Modern SPA with hot reload'],
          ['UI Framework', 'Tailwind CSS + Shadcn/UI', 'Professional component library'],
          ['Backend', 'Express.js + TypeScript', 'REST API with 100+ endpoints'],
          ['Database', 'SQLite (sql.js)', 'Embedded DB with 30-second auto-save'],
          ['Real-Time', 'WebSocket', 'Live progress, alerts, sync events'],
          ['AI Engine', 'Claude API (Haiku + Sonnet)', 'Scoring, reply analysis, auto-responses'],
          ['State Mgmt', 'TanStack React Query', 'Server state caching + auto-refresh'],
          ['Charts', 'Recharts', 'Bar, pie, radar, trend visualizations'],
        ] as [string, string, string][]).map(([layer, tech, purpose]) =>
          new TableRow({ children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: layer, size: 20 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: tech, size: 20 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: purpose, size: 20 })] })] }),
          ] }),
        ),
      ],
    }),
    sectionGap(),
  ];
}

// ── Section 3: Live statistics (needs data) ────────────────
export interface SystemStats {
  totalCompanies: number;
  totalLeads: number;
  hotLeads: number;
  warmLeads: number;
  enrichedLeads: number;
  totalCampaigns: number;
  activeCampaigns: number;
  totalAgents: number;
  totalTasks: number;
  totalAlerts: number;
  totalEvents: number;
  totalImports: number;
}

export function buildLiveStatistics(stats: SystemStats, genDate: string): (Paragraph | Table)[] {
  const rows: [string, string, string][] = [
    ['Companies Managed', `${stats.totalCompanies}`, ''],
    ['Total Leads in System', `${stats.totalLeads}`, ''],
    ['Hot Leads', `${stats.hotLeads}`, 'e53e3e'],
    ['Warm Leads', `${stats.warmLeads}`, 'dd6b20'],
    ['Enriched Leads', `${stats.enrichedLeads}`, ''],
    ['Total Campaigns', `${stats.totalCampaigns} (${stats.activeCampaigns} active)`, ''],
    ['Automation Agents', `${stats.totalAgents}`, ''],
    ['Tasks Tracked', `${stats.totalTasks}`, ''],
    ['Alerts Generated', `${stats.totalAlerts}`, ''],
    ['System Events Logged', `${stats.totalEvents}`, ''],
    ['CSV Bulk Imports', `${stats.totalImports}`, ''],
  ];

  return [
    heading('3. Live System Statistics', HeadingLevel.HEADING_1),
    bodyText(`The following data is pulled live from the database as of ${genDate}:`),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: [
          new TableCell({ shading: { type: ShadingType.SOLID, color: '2b6cb0' }, children: [new Paragraph({ children: [new TextRun({ text: 'Metric', bold: true, color: 'ffffff', size: 20 })] })] }),
          new TableCell({ shading: { type: ShadingType.SOLID, color: '2b6cb0' }, children: [new Paragraph({ children: [new TextRun({ text: 'Value', bold: true, color: 'ffffff', size: 20 })] })] }),
        ] }),
        ...rows.map(([label, value, color]) =>
          new TableRow({ children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: label, size: 20 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: value, size: 20, bold: true, ...(color ? { color } : {}) })] })] }),
          ] }),
        ),
      ],
    }),
    sectionGap(),
  ];
}

// ── Section 4: Feature inventory ───────────────────────────
export function buildFeatureInventory(): (Paragraph | Table)[] {
  const modules: [string, string, string][] = [
    ['1', 'Dashboard', 'Executive overview with KPIs, charts, alerts, events timeline, and AI chat assistant'],
    ['2', 'Campaigns', 'Email campaign management synced with Instantly \u2014 performance metrics, pause/resume'],
    ['3', 'Outbound Hub', 'Full Instantly platform integration \u2014 campaigns, leads, inbox, accounts, analytics'],
    ['4', 'Campaign Writer', 'AI-powered email variation generator \u2014 analyzes top campaigns, creates 3 new versions'],
    ['5', 'Contacts', 'Searchable CRM with advanced filtering by score, status, source, cold email status'],
    ['6', 'Enrichment', 'Lead scoring pipeline \u2014 enrich, score, approve, push. Multi-tab interface with rules engine'],
    ['7', 'Pipelines', 'GoHighLevel pipeline visualization \u2014 stages, opportunities, deal values'],
    ['8', 'Agents', 'Automation worker monitoring \u2014 success rates, run history, error logs, cost tracking'],
    ['9', 'Tasks', 'Team task management with Table and Kanban views \u2014 priority, due dates, assignees'],
    ['10', 'Analytics', 'Custom charts and reporting \u2014 campaign performance, task distribution, agent health'],
    ['11', 'Meta Ads', 'Facebook/Instagram ad management \u2014 spend tracking, KPIs, campaign CRUD, audience tools'],
    ['12', 'LinkedIn', 'Profile and company scraping \u2014 people search, employee lists, job search via Apify'],
    ['13', 'Instagram', 'Profile research, hashtag analysis, competitor comparison, engagement metrics'],
    ['14', 'Instagram DM', 'Automated DM campaigns \u2014 multi-step sequences, hashtag/competitor lead import'],
    ['15', 'WhatsApp', 'Cloud API messaging \u2014 text, templates, images, documents. Template and phone management'],
    ['16', 'Discoveries', 'AI-generated business insights \u2014 performance alerts, trends, milestones, action items'],
    ['17', 'Competitors', 'Website monitoring \u2014 content change detection, title/description tracking, status alerts'],
    ['18', 'Scraping Hub', 'Apify integration \u2014 Google, LinkedIn, Instagram, website scrapers. Run history and datasets'],
    ['19', 'OpenClaw ACP', 'Infrastructure control panel \u2014 machine status, terminal commands, diagnostics'],
    ['20', 'BTR Conference', 'Networking event coordinator \u2014 contact tiers, outreach stages, team assignment'],
    ['21', 'Guide', 'Interactive documentation \u2014 step-by-step feature walkthroughs'],
    ['22', 'AI Assistant', 'Natural language chatbot \u2014 ask questions about data, give commands, navigate the dashboard'],
    ['23', 'Campaign Detail', 'Deep drill-down for individual campaigns \u2014 per-step analytics, lead list, performance charts'],
    ['24', 'Contact Detail', 'Individual contact profile \u2014 enrichment data, AI score reasoning, email threads, activity log'],
  ];

  return [
    heading('4. Feature Inventory \u2014 24 Modules', HeadingLevel.HEADING_1),
    bodyText('The platform contains 24 distinct pages/modules, each accessible from the sidebar navigation:'),
    sectionGap(),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: [
          new TableCell({ shading: { type: ShadingType.SOLID, color: '1a202c' }, width: { size: 600, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: '#', bold: true, color: 'ffffff', size: 18 })] })] }),
          new TableCell({ shading: { type: ShadingType.SOLID, color: '1a202c' }, width: { size: 2400, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Module', bold: true, color: 'ffffff', size: 18 })] })] }),
          new TableCell({ shading: { type: ShadingType.SOLID, color: '1a202c' }, children: [new Paragraph({ children: [new TextRun({ text: 'Description', bold: true, color: 'ffffff', size: 18 })] })] }),
        ] }),
        ...modules.map(([num, name, desc]) =>
          new TableRow({ children: [
            new TableCell({ width: { size: 600, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: num, size: 18 })] })] }),
            new TableCell({ width: { size: 2400, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: name, bold: true, size: 18 })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: desc, size: 18 })] })] }),
          ] }),
        ),
      ],
    }),
    sectionGap(),
  ];
}
