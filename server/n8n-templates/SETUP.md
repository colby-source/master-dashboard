# N8N Workflow Templates — Enrichment Pipeline

## Quick Start

1. Open your N8N instance (default: http://localhost:5678)
2. Go to **Workflows** → **Import from File**
3. Import each `.json` file from this directory
4. Set the `DASHBOARD_BASE_URL` environment variable in N8N (default: `http://localhost:3001`)
5. Activate each workflow

## Workflows

| # | File | Trigger | Purpose |
|---|------|---------|---------|
| 01 | `01-ghl-contact-to-enrichment.json` | GHL Webhook | New/updated GHL contacts → enrichment pipeline |
| 02 | `02-meta-lead-ad-to-enrichment.json` | Meta Webhook | Facebook/Instagram lead ad forms → enrichment |
| 03 | `03-rb2b-visitor-to-enrichment.json` | RB2B Webhook | De-anonymized website visitors → enrichment |
| 04 | `04-instantly-reply-sentiment.json` | Instantly Webhook | Reply/bounce → Claude sentiment analysis |
| 05 | `05-stale-lead-re-enrichment.json` | Cron (Weekly) | Re-enrich leads older than 90 days |
| 06 | `06-linkedin-multi-channel.json` | HTTP POST | Apollo/LinkedIn CSV imports → enrich or LinkedIn DM |
| 07 | `07-enrichment-orchestrator.json` | HTTP POST | External orchestration of enrich → score pipeline |

## Environment Variables (N8N)

```
DASHBOARD_BASE_URL=http://localhost:3001
RB2B_WEBHOOK_SECRET=your-rb2b-secret
```

## Webhook URLs (configure in external services)

| Service | Webhook URL |
|---------|------------|
| GHL | `{N8N_URL}/webhook/ghl-contact-webhook` |
| Meta Lead Ads | `{N8N_URL}/webhook/meta-lead-webhook` |
| RB2B | `{N8N_URL}/webhook/rb2b-visitor-webhook` |
| Instantly | `{N8N_URL}/webhook/instantly-reply-webhook` |

## Architecture

```
External Service → N8N Webhook → Extract/Transform → Dashboard API → Enrichment Pipeline
                                                                    ↓
                                                              PDL → Hunter → Claude Score → GHL Push
                                                                                         → Cold Email (manual approval)
```

## Notes

- Workflows 01-04 are the **core pipeline** — import these first
- Workflow 05 is **maintenance** — keeps enrichment data fresh
- Workflow 06 is for **list building** — bulk imports from Apollo/LinkedIn
- Workflow 07 is **optional** — the Dashboard handles orchestration internally via sync cycle
- Cold email campaign assignment requires manual approval in the Dashboard UI
