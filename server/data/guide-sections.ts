const guideSections = [
  {
    title: 'Dashboard',
    description: 'Your command center. See active campaigns, open tasks, agent health, alerts, and events at a glance.',
    steps: [
      { title: 'View Executive Summary', detail: 'The top row shows 5 cards: Active Campaigns, Open Tasks, Agent Health %, Due Today, and Alerts. These auto-refresh every 60 seconds.' },
      { title: 'Company Scorecard', detail: 'Shows per-company breakdown of campaigns, contacts enriched, and pipeline value. Use the company selector in the sidebar to filter.' },
      { title: 'Charts & Analytics', detail: 'Visual charts for campaign performance over time. Hover over data points for exact values.' },
      { title: 'Alerts Feed', detail: 'Real-time alerts for bounced emails, failed agents, and anomalies. Click Acknowledge to dismiss.' },
      { title: 'Events Timeline', detail: 'Live feed of everything happening: enrichments, emails sent, replies received, agent runs, and more.' },
      { title: 'Dashboard AI Chat', detail: 'Ask questions about your data directly. Try: "What\'s my best performing campaign?" or "How many leads were enriched today?"' },
    ],
    aiCommands: ['Show me the dashboard summary', 'What are my active alerts?', 'How many campaigns are active?'],
  },
  {
    title: 'Campaigns',
    description: 'Manage cold email campaigns synced from Instantly. View performance, drill into sequences, and monitor delivery.',
    steps: [
      { title: 'View All Campaigns', detail: 'Navigate to Campaigns to see a list of all campaigns with open rate, reply rate, sent count, and status.' },
      { title: 'Campaign Detail View', detail: 'Click a campaign to see its full sequence: each email step with send/open/reply counts, timing delays, and contact list.' },
      { title: 'Pause/Resume Campaign', detail: 'Use the status toggle or the AI assistant: "Pause campaign Q1 Outreach".' },
      { title: 'Monitor Delivery', detail: 'Check bounce rates and delivery status. High bounce rates trigger automatic alerts.' },
      { title: 'AI Campaign Variations', detail: 'Go to Campaign Writer to let AI analyze your best campaign and generate 3 new variations.' },
    ],
    aiCommands: ['Show me all campaigns', 'Pause campaign [name]', 'Activate campaign [name]'],
  },
  {
    title: 'Contacts',
    description: 'Full CRM contact database. Search, filter, sort, and drill into any contact for their complete profile.',
    steps: [
      { title: 'Browse Contacts', detail: 'Sortable data table with columns: Name, Email, Company, Score, Source, Status, Cold Email Status, Last Activity.' },
      { title: 'Search & Filter', detail: 'Use the search box for name/email/company. Filter by status, score label (Hot/Warm/Cold), source, or company.' },
      { title: 'Contact Detail Page', detail: 'Click any contact for their full profile: contact info, enrichment data, AI score with reasoning, email conversations, and activity timeline.' },
      { title: 'Enrich a Contact', detail: 'Click "Re-Enrich" to pull fresh data from People Data Labs and update the score.' },
      { title: 'Approve for Cold Email', detail: 'Click "Approve" to push an enriched contact to Instantly for cold email outreach.' },
      { title: 'Exclude from Outreach', detail: 'Click "Exclude" to permanently block a contact from cold email campaigns.' },
    ],
    aiCommands: ['Search contacts named "John"', 'Show me hot leads', 'Enrich contact [email]', 'Approve contact [email] for cold email'],
  },
  {
    title: 'Enrichment',
    description: 'Lead enrichment pipeline powered by People Data Labs and Hunter.io.',
    steps: [
      { title: 'View Enrichment Queue', detail: 'See leads pending enrichment, currently processing, and recently completed with their scores.' },
      { title: 'Trigger Manual Enrichment', detail: 'Select a lead and click "Enrich" to pull data from PDL and verify the email with Hunter.' },
      { title: 'Review AI Scoring', detail: 'After enrichment, Claude AI scores each lead 0-100 based on your company ICP.' },
      { title: 'Configure Scoring Rules', detail: 'In Settings, customize the scoring prompt, ICP criteria, and threshold levels.' },
      { title: 'Auto-Processing Pipeline', detail: 'When auto_approve is enabled, leads above the threshold are automatically pushed to GHL and Instantly.' },
      { title: 'Upload CSV (Bulk Import)', detail: 'Click "Upload CSV" in the Enrichment panel header to import cold leads in bulk. See the dedicated Bulk CSV Upload section below for the full walkthrough.' },
    ],
    aiCommands: ['Show enrichment stats', 'Enrich contact [email]', 'Process lead [email]'],
  },
  {
    title: 'Bulk CSV Upload',
    description: 'Upload CSV files of cold leads in bulk. Leads are automatically deduplicated, inserted, and optionally run through the full enrichment pipeline (enrich, score, GHL push, cold email) without any manual work.',
    steps: [
      { title: 'Open the Upload Dialog', detail: 'Navigate to the Enrichment panel from the sidebar. Click the "Upload CSV" button in the top-right corner of the panel header. This opens a multi-step upload wizard.' },
      { title: 'Step 1 — Select Your CSV File', detail: 'Drag and drop a .csv file onto the drop zone, or click "browse" to select one from your computer. The file is parsed entirely in your browser — nothing is uploaded until you confirm. Also select the Company this data belongs to from the dropdown (e.g., Granite Park Capital, Brand Me Now, Tikkun).' },
      { title: 'Step 2 — Map Your Columns', detail: 'The system auto-detects common header names (Email, First Name, Last Name, Phone, Company, Job Title, LinkedIn URL). Review the mapping and adjust any columns using the dropdown selectors. Email is required — if your CSV has a different header (e.g., "Email Address"), map it to "Email". Set any irrelevant columns to "Skip".' },
      { title: 'Step 3 — Preview & Configure', detail: 'Review a preview of the first 5 rows with your mapped columns. The summary shows total rows, rows with valid emails, and how many will be imported. Toggle "Auto-process through enrichment pipeline" ON to automatically enrich, score, and push leads after import. Optionally select a target Instantly campaign to auto-approve qualifying leads for cold email.' },
      { title: 'Step 4 — Upload & Monitor Progress', detail: 'Click "Upload & Process" to begin. The dialog shows real-time progress: how many leads were inserted, duplicates skipped, errors encountered, and leads processed through enrichment. A progress bar tracks enrichment completion. You can cancel processing mid-batch if needed — already-inserted leads remain in the system.' },
      { title: 'After Upload', detail: 'Imported leads appear in the Enrichment panel with source "csv_import". If auto-process was enabled, leads will have enrichment data, AI scores, and cold email status already populated. Use the existing filters to find and manage your imported leads.' },
      { title: 'CSV Format Requirements', detail: 'Your CSV must include an Email column (required). Optional columns: First Name, Last Name, Phone, Company Name, Job Title, LinkedIn URL. The system handles common header variations automatically (e.g., "email_address", "firstname", "mobile").' },
      { title: 'Deduplication', detail: 'Leads are deduplicated by email + company. If a lead with the same email already exists for the selected company, it is skipped and counted as a duplicate. This prevents double-importing the same contacts.' },
      { title: 'Large Batches', detail: 'You can upload CSVs with 1,000+ rows. The system processes leads in batches of 5 with rate-limiting to respect API limits (People Data Labs, Hunter.io, Claude AI). Processing happens in the background — you can close the dialog and check back later.' },
      { title: 'View Past Imports', detail: 'All imports are tracked with their status (processing, complete, cancelled), row counts, and error details for auditing and troubleshooting.' },
    ],
    aiCommands: [],
  },
  {
    title: 'Pipelines',
    description: 'GoHighLevel CRM pipeline management. Track deal stages and move contacts.',
    steps: [
      { title: 'View Pipeline Stages', detail: 'See all pipeline stages with contact counts.' },
      { title: 'Push Contacts to GHL', detail: 'Enriched contacts can be pushed to GoHighLevel with tags and custom fields.' },
    ],
    aiCommands: ['Push contact [email] to GHL'],
  },
  {
    title: 'Agents',
    description: 'Automated background workers that run on schedules.',
    steps: [
      { title: 'View Agent Status', detail: 'See all agents with their status, type, success rate, and last run time.' },
      { title: 'Check Agent History', detail: 'Click an agent to see its run history with timestamps, durations, and error logs.' },
    ],
    aiCommands: ['Show all agents'],
  },
  {
    title: 'Tasks',
    description: 'Task management for your team.',
    steps: [
      { title: 'View Tasks', detail: 'See all tasks organized by status: To Do, In Progress, Done.' },
      { title: 'Create a Task', detail: 'Click "New Task" or tell the AI: "Create a task to follow up with John".' },
      { title: 'Complete a Task', detail: 'Mark tasks as done when finished.' },
    ],
    aiCommands: ['Show open tasks', 'Create a task: [title]', 'Complete task #[id]'],
  },
  {
    title: 'AI Assistant',
    description: 'Chat with AI to control the entire dashboard using natural language.',
    steps: [
      { title: 'Open AI Assistant', detail: 'Navigate to the AI Assistant page from the sidebar.' },
      { title: 'Type a Command', detail: 'Type what you want in plain English. Examples: "Show me all hot leads", "Create a task to call John".' },
      { title: 'Review Actions', detail: 'The AI will show what actions it took along with the results.' },
      { title: 'Navigation Commands', detail: 'Say "Go to contacts" and the AI will navigate for you.' },
    ],
    aiCommands: ['Show me all hot leads', 'Create a task to follow up with John', 'Go to contacts page'],
  },
  {
    title: 'Meta Ads',
    description: 'Monitor and manage Meta advertising campaigns.',
    steps: [
      { title: 'Connect Account', detail: 'Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in your .env file.' },
      { title: 'View Ad Performance', detail: 'See campaign-level metrics: impressions, clicks, CTR, spend, CPC, and conversions.' },
    ],
    aiCommands: [],
  },
  {
    title: 'Competitors',
    description: 'Monitor competitor websites and social media for changes.',
    steps: [
      { title: 'Add a Competitor', detail: 'Enter a competitor website URL and social links.' },
      { title: 'View Changes', detail: 'See a timeline of detected changes: pricing updates, messaging shifts, and social activity.' },
    ],
    aiCommands: ['Show competitor updates'],
  },
  {
    title: 'Settings',
    description: 'Configure enrichment rules, AI scoring prompts, company playbooks, and integration credentials.',
    steps: [
      { title: 'Enrichment Config', detail: 'Set auto-enrich rules, scoring thresholds, and default company ICP prompts.' },
      { title: 'Company Playbooks', detail: 'Configure AI auto-reply playbooks per company.' },
      { title: 'Integration Keys', detail: 'Manage API keys for Instantly, GHL, Meta, PDL, Hunter, Apify, and other integrations.' },
    ],
    aiCommands: [],
  },
];

export { guideSections };
