# Master Dashboard — Operations Guide

## Quick Start

```bash
# 1. Install dependencies
npm install && cd client && npm install && cd ..

# 2. Copy environment template and fill in API keys
cp .env.example .env

# 3. Start development (server + client)
npm run dev

# Server: http://localhost:3001
# Client: http://localhost:5173
# WebSocket: ws://localhost:3001/ws
```

---

## Architecture

```
Browser (React 19 + Vite)
    ↓ HTTP / WebSocket
Express API (port 3001)
    ↓
SQLite (sql.js, file-backed)
    ↓
External APIs: GHL, Instantly, PDL, Hunter, Meta, WhatsApp, Apify, Claude AI
```

**Stack:** TypeScript everywhere. Express 4.x backend, React 19 frontend, SQLite via sql.js, TailwindCSS, TanStack React Query, React Router 7.

---

## Environment Variables

### Required

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude AI (scoring, campaign writer, assistant) |
| `PDL_API_KEY` | People Data Labs — lead enrichment |
| `HUNTER_API_KEY` | Hunter.io — email verification |
| `INSTANTLY_API_KEY` | Instantly — cold email platform |

### GHL CRM (per company)

```
GHL_COMPANY_1_ID=
GHL_COMPANY_1_API_KEY=
GHL_COMPANY_1_LOCATION_ID=
GHL_COMPANY_2_ID=
GHL_COMPANY_2_API_KEY=
GHL_COMPANY_2_LOCATION_ID=
GHL_COMPANY_3_ID=
GHL_COMPANY_3_API_KEY=
GHL_COMPANY_3_LOCATION_ID=
```

### Meta / Facebook Ads

```
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
META_BASE_URL=https://graph.facebook.com/v19.0
```

### WhatsApp Business

```
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
```

### Other Integrations

```
APIFY_API_TOKEN=
OPENCLAW_WS_URL=ws://192.168.1.220:18789
LINKEDIN_API_KEY=
INSTAGRAM_ACCESS_TOKEN=
N8N_WEBHOOK_URL=
```

### Webhook HMAC Secrets

```
WEBHOOK_SECRET_RB2B=
WEBHOOK_SECRET_GHL=
WEBHOOK_SECRET_META=
WEBHOOK_SECRET_INSTANTLY=
WEBHOOK_SECRET_N8N=
```

### Server Config

```
PORT=3001
DATABASE_PATH=./data/master-dashboard.db
DASHBOARD_API_KEY=           # Optional — enables API key auth if set
ENRICHMENT_AUTO_ENABLED=true
ENRICHMENT_STALE_DAYS=90
```

---

## Frontend Pages

| URL | Page | What It Does |
|-----|------|--------------|
| `/` | Dashboard | Main overview — metrics, alerts, recent activity |
| `/campaigns` | Campaigns | View/manage cold email campaigns (Instantly) |
| `/campaigns/:id` | Campaign Detail | Stats, leads, pause/activate for one campaign |
| `/outbound` | Outbound | Multi-channel outbound messaging |
| `/writer` | Campaign Writer | AI-powered campaign copy generator (Claude) |
| `/contacts` | Contacts | Browse GHL contacts |
| `/contacts/:id` | Contact Detail | Full contact profile with notes, tags, tasks |
| `/enrichment` | Enrichment | Lead enrichment pipeline — enrich, score, push |
| `/pipelines` | Pipelines | GHL sales pipelines and opportunities |
| `/agents` | Agents | Autonomous bot management |
| `/tasks` | Tasks | Task/TODO management |
| `/analytics` | Analytics | Charts and metrics dashboards |
| `/meta-ads` | Meta Ads | Facebook/Meta ad campaign manager |
| `/linkedin` | LinkedIn | LinkedIn outreach integration |
| `/instagram` | Instagram | Instagram integration |
| `/whatsapp` | WhatsApp | WhatsApp Business messaging |
| `/discoveries` | AI Discoveries | AI-powered prospect discovery |
| `/competitors` | Competitors | Competitor website monitoring |
| `/scraping` | Scraping | Apify web scraping tools |
| `/openclaw` | OpenClaw | OpenClaw gateway |
| `/btr` | BTR Conference | Conference/event tracking |
| `/ai-assistant` | AI Assistant | Conversational AI with tool use |
| `/settings` | Settings | System configuration |
| `/guide` | Guide | Help documentation |

---

## Key Business Flows

### 1. Lead Enrichment Pipeline

The core revenue flow. Takes raw leads and enriches them through multiple stages:

```
Lead arrives (webhook, CSV, or manual)
  → Enrich (PDL + Hunter APIs — company, title, phone, email verification)
  → Score (Claude AI — 0-100 score, cold/warm/hot label)
  → Push to GHL (create/update CRM contact)
  → Push to Instantly (add to cold email campaign)
  → Monitor replies → Auto-reply orchestration
```

**Where:** `/enrichment` page
**API:** `POST /api/enrichment/leads/:id/process` (full pipeline)
**Bulk:** `POST /api/enrichment/bulk-process` (multiple leads)

### 2. CSV Bulk Import

Upload CSV files of cold leads, map columns, and auto-process:

```
Upload CSV → Map columns → Preview → Import
  → Deduplicates by email + company
  → Creates leads with source='csv_import'
  → Optionally auto-processes through enrichment pipeline
  → Real-time progress via WebSocket
```

**Where:** "Upload CSV" button on `/enrichment` page
**API:** `POST /api/enrichment/bulk-upload`

### 3. Auto-Reply System

When prospects reply to cold emails:

```
Reply arrives via Instantly webhook
  → Match to original lead
  → Sentiment analysis (Claude AI)
  → Generate response based on company playbook
  → Schedule and send reply
  → Update thread status
```

**Config:** `/api/enrichment/config/:companyId` — toggle `auto_reply_enabled`
**Stats:** `/api/enrichment/auto-reply-stats`

### 4. GHL CRM Sync

Bi-directional sync between dashboard and GoHighLevel:

```
Dashboard → GHL: Push enriched leads as contacts
GHL → Dashboard: Webhook on contact.created/updated
```

**Webhooks:** `POST /api/enrichment/webhook/ghl`
**Manual sync:** GHL service methods in `server/services/ghl-service.ts`

### 5. Campaign Management (Instantly)

Create and manage cold email campaigns:

```
Create campaign → Add leads → Activate → Monitor
  → Track open rates, reply rates
  → Pause/resume campaigns
  → Handle bounces and replies
```

**Where:** `/campaigns` page
**API:** `/api/instantly/campaigns`

---

## API Endpoints — Full Reference

### Companies `/api/companies`
```
GET    /                  List all companies
POST   /                  Create company
GET    /:id               Get company by ID
PUT    /:id               Update company
DELETE /:id               Delete company
```

### Tasks `/api/tasks`
```
GET    /                  List tasks (filter: company_id, status, assignee)
POST   /                  Create task
PUT    /:id               Update task
DELETE /:id               Delete task
```

### Campaigns `/api/campaigns`
```
GET    /                  List campaigns
POST   /                  Create campaign
GET    /:id/detail        Campaign details
POST   /:id/pause         Pause campaign
POST   /:id/activate      Activate campaign
GET    /accounts           Connected email accounts
GET    /leads              Campaign leads
```

### Metrics `/api/metrics`
```
GET    /                  Latest metrics
GET    /charts            Chart data
GET    /summary           Dashboard summary
```

### Alerts `/api/alerts`
```
GET    /                  List alerts
POST   /:id/acknowledge   Acknowledge alert
```

### Events `/api/events`
```
GET    /                  List events (audit log)
```

### Enrichment `/api/enrichment`

**Leads:**
```
GET    /leads              List leads (paginated, filterable)
GET    /leads/search       Search leads
POST   /leads              Create lead
GET    /leads/:id          Get lead
GET    /leads/:id/full     Get lead with enrichment data
GET    /leads/:id/audit-log  Lead audit trail
```

**Processing:**
```
POST   /leads/:id/enrich           Run enrichment (PDL + Hunter)
POST   /leads/:id/score            AI scoring (Claude)
POST   /leads/:id/push-ghl         Push to GHL CRM
POST   /leads/:id/process          Full pipeline
POST   /leads/:id/approve-cold-email   Approve for cold email
POST   /leads/:id/exclude-cold-email   Exclude from cold email
```

**Bulk:**
```
POST   /bulk-approve-cold-email    Approve multiple leads
POST   /bulk-enrich                Enrich multiple leads
POST   /bulk-process               Process multiple leads
POST   /re-enrich-stale            Re-enrich old leads
```

**Stats & Config:**
```
GET    /stats                      Enrichment statistics
GET    /events                     Event log
GET    /auto-reply-stats           Reply performance
GET    /config/:companyId          Company enrichment config
PUT    /config/:companyId          Update config
```

**Rules & Contacts:**
```
GET    /cold-email-rules           List rules
POST   /cold-email-rules           Create rule
DELETE /cold-email-rules/:id       Delete rule
GET    /known-contacts             Known contacts (exclusion list)
POST   /known-contacts             Add known contact
DELETE /known-contacts/:id         Remove known contact
POST   /known-contacts/import-ghl  Import from GHL
```

**Reply Threads:**
```
GET    /threads                    List reply threads
GET    /threads/:id                Thread details + messages
POST   /threads/:id/reply          Send reply
PUT    /threads/:id/status         Update thread status
```

**Playbooks:**
```
GET    /playbooks/:companyId       Get company playbook
PUT    /playbooks/:companyId       Update playbook
```

### Webhooks `/api/enrichment/webhook/` (no auth required)
```
POST   /ghl                GHL contact events
POST   /meta-ad            Meta lead ads
POST   /rb2b               RB2B website visitors
POST   /instantly          Instantly replies & bounces
POST   /n8n                N8N workflow callbacks
```

### Bulk Upload `/api/enrichment/bulk-upload`
```
POST   /                   Submit CSV leads
GET    /                   List all imports
GET    /:id                Import status/progress
POST   /:id/cancel         Cancel import
```

### GHL `/api/ghl`

**Contacts:**
```
GET    /status                     Connection status
GET    /contacts                   Search contacts
GET    /contacts/:id               Contact details
POST   /contacts                   Create contact
PUT    /contacts/:id               Update contact
POST   /contacts/:id/tags          Add tags
DELETE /contacts/:id/tags          Remove tags
GET    /contacts/:id/tasks         Contact tasks
GET    /contacts/:id/notes         Contact notes
POST   /contacts/:id/notes         Create note
```

**Workflows & Pipelines:**
```
POST   /contacts/:id/workflow/:workflowId    Add to workflow
DELETE /contacts/:id/workflow/:workflowId    Remove from workflow
GET    /pipelines                  Pipelines for company
GET    /pipelines/all              All pipelines
GET    /opportunities              Pipeline opportunities
```

**Other:**
```
GET    /campaigns                  GHL campaigns
GET    /conversations              Search conversations
POST   /messages                   Send message
GET    /tags                       Available tags
GET    /custom-fields              Custom fields
GET    /templates                  SMS/email templates
GET    /location                   Location info
```

### Instantly `/api/instantly`
```
GET    /campaigns                  List campaigns
GET    /campaigns/count-launched   Active campaign count
GET    /campaigns/search-by-contact  Search by contact email
GET    /campaigns/:id              Campaign details
POST   /campaigns                  Create campaign
PATCH  /campaigns/:id              Update campaign
DELETE /campaigns/:id              Delete campaign
POST   /campaigns/:id/pause        Pause
POST   /campaigns/:id/activate     Activate
POST   /campaigns/:id/duplicate    Duplicate
POST   /campaigns/:id/share        Share
POST   /campaigns/:id/export       Export
GET    /campaigns/:id/sending-status  Sending status
```

### Meta Ads `/api/meta-ads`
```
GET    /account                    Account info
GET    /insights                   Campaign insights
GET    /insights/breakdown         Insights by dimension
GET    /insights/time-series       Time-series data
GET    /campaigns                  List campaigns
GET    /campaigns/live             Live campaigns only
POST   /campaigns                  Create campaign
PATCH  /campaigns/:id              Update campaign
```

### Apify `/api/apify`
```
GET    /store                      List actors
GET    /actors/:actorId            Actor details
POST   /actors/:actorId/run        Run actor (async)
POST   /actors/:actorId/run-sync   Run actor (sync)
GET    /actors/:actorId/last-run   Last run result
GET    /runs                       List runs
GET    /runs/:runId                Run details
POST   /runs/:runId/abort          Abort run
POST   /runs/:runId/resurrect      Re-run
```

### WhatsApp `/api/whatsapp`
```
POST   /send/text                  Send text
POST   /send/template              Send template
POST   /send/image                 Send image
POST   /send/document              Send document
POST   /send/video                 Send video
POST   /send/audio                 Send audio
POST   /send/location              Send location
POST   /send/buttons               Interactive buttons
POST   /send/list                  List menu
POST   /send/reaction              Emoji reaction
POST   /mark-read                  Mark message read
```

### AI `/api/ai`
```
POST   /campaign-writer            Generate campaign copy (Claude)
POST   /query                      Ask Claude questions
GET    /chat-history               Chat history
DELETE /chat-history               Clear history
```

### AI Assistant `/api/ai-assistant`
```
POST   /                           Send message (Claude with tools)
```
Tools available: search_contacts, get_contact_details, create_lead, enrich_contact, score_contact, push_to_ghl, approve_cold_email, exclude_cold_email

### Exports `/api/exports`
```
GET    /system-overview.docx       Download system overview document
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `companies` | Sales companies/orgs |
| `campaigns` | Cold email campaigns |
| `tasks` | TODO/task tracking |
| `agents` | Autonomous bots |
| `agent_runs` | Bot execution log |
| `metrics` | Time-series metrics |
| `alerts` | System alerts |
| `events` | Audit log |
| `enrichment_leads` | Leads in enrichment pipeline |
| `enrichment_cache` | Cached API responses |
| `enrichment_config` | Per-company enrichment settings |
| `enrichment_events` | Lead processing audit trail |
| `cold_email_rules` | Auto-approve/exclude rules |
| `known_contacts` | Exclusion list for cold email |
| `company_playbooks` | Sales playbooks per company |
| `reply_threads` | Email conversation threads |
| `reply_messages` | Individual thread messages |
| `meta_ad_campaigns` | Facebook ad tracking |
| `ig_dm_campaigns` | Instagram DM campaigns |
| `ig_dm_leads` | Instagram DM targets |
| `ig_dm_steps` | DM sequence steps |
| `chat_history` | AI chat log |
| `assistant_chat_history` | AI assistant tool-call log |
| `integrations` | Service configs |
| `bulk_imports` | CSV import tracking |
| `competitor_changes` | Competitor monitoring log |

---

## WebSocket

**Connect:** `ws://localhost:3001/ws`

Messages are JSON with `{ type, timestamp, data }`. Events broadcast to all connected clients for real-time UI updates (lead enriched, campaign status change, bulk import progress, alerts).

---

## Migrations

Located in `database/migrations/`. Run automatically on server startup.

| File | Purpose |
|------|---------|
| `001_initial.sql` | All tables |
| `002_add_indexes.sql` | Performance indexes |

---

## Security

- **API Key Auth:** All routes (except webhooks) require `DASHBOARD_API_KEY` header
- **Webhook Verification:** HMAC signature validation on all inbound webhooks
- **CORS:** Whitelist restricted to localhost origins
- **SQL:** Parameterized queries only (no string concatenation)
- **Error Responses:** Standardized `{ success: false, error: { code, message } }` — no stack traces leaked

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port in use | Change `PORT` in `.env` or kill existing process |
| 401 on API calls | Set `DASHBOARD_API_KEY` in `.env` and pass as header |
| CORS errors | Add your origin to the whitelist in `server/index.ts` |
| Leads not enriching | Check `PDL_API_KEY` and `HUNTER_API_KEY` are set and have quota |
| GHL sync failing | Verify `GHL_COMPANY_*` credentials match your GHL account |
| Webhooks not arriving | Check HMAC secrets match what the sender configured |
| WebSocket disconnects | Verify server is running and client connects to correct port |
| Build fails | Run `cd client && npm install && npm run build` |

---

*Last updated: 2026-03-08*
