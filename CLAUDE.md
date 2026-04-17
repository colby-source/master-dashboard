# Master Dashboard

Unified operations dashboard for multi-company outbound sales, lead enrichment, CRM management, and campaign execution.

## Stack

- **Backend:** Express 4.x, TypeScript, SQLite (sql.js, file-backed)
- **Frontend:** React 19, Vite, TailwindCSS, TanStack React Query, React Router 7
- **Real-time:** WebSocket (ws)
- **External APIs:** GHL, Instantly, PDL, Hunter, Meta Ads, WhatsApp, Apify, Claude AI

## Quick Start

```bash
npm install && cd client && npm install && cd ..
cp .env.example .env   # Fill in API keys
npm run dev            # Server :3001 + Client :5173
```

## Structure

```
server/
├── src/
│   ├── routes/       # Express route handlers (one file per domain)
│   ├── services/     # Business logic
│   ├── middleware/    # Auth, error handling, webhook verification
│   └── index.ts      # Server entry point
client/
├── src/
│   ├── pages/        # React pages (one per route)
│   ├── components/   # Shared UI components
│   ├── hooks/        # Custom React hooks
│   ├── lib/          # Utilities, API client
│   └── App.tsx       # Router setup
database/
├── migrations/       # SQL migration files
└── seeds/            # Seed data
data/                 # Runtime data (SQLite DB, campaign JSON)
```

## Key Business Flows

1. **Lead Enrichment Pipeline:** Lead → PDL+Hunter enrich → Claude AI score → Push to GHL → Push to Instantly
2. **CSV Bulk Import:** Upload → Map columns → Dedupe → Auto-process through pipeline
3. **Auto-Reply System:** Instantly webhook → Sentiment analysis → Generate response → Send
4. **GHL CRM Sync:** Bi-directional sync between dashboard and GoHighLevel

## Environment Variables

Required: `ANTHROPIC_API_KEY`, `PDL_API_KEY`, `HUNTER_API_KEY`, `INSTANTLY_API_KEY`
GHL: `GHL_COMPANY_[1-3]_ID`, `GHL_COMPANY_[1-3]_API_KEY`, `GHL_COMPANY_[1-3]_LOCATION_ID`
Meta: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`
WhatsApp: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
Apify: `APIFY_API_KEY` (required for Craigslist + FB Marketplace scrapers in Equipment Finder)
eBay (optional): `EBAY_APP_ID`, `EBAY_CERT_ID` (enables Browse API path; HTML fallback used otherwise)

See `.env.example` for full list.

## Known environment issues

### Apify TLS / MITM on certain networks

Symptom: `api.apify.com` requests fail with:
```
Hostname/IP does not match certificate's altnames: Host: api.apify.com. is not in the cert's altnames: ...
```
and the cert altnames list unrelated domains (often `*.camil.com.br` or similar).

Cause: a local HTTPS interceptor (corporate proxy, antivirus SSL inspection,
VPN) is MITM-ing the connection and returning a re-signed cert for the wrong
hostname. **This is a network/local-machine issue, not a code issue.**

Fixes, in order of preference:
1. Disable HTTPS inspection for `*.apify.com` in the MITM tool.
2. Add the MITM root CA to `NODE_EXTRA_CA_CERTS`.
3. **Dev-only escape hatch:** set `APIFY_ALLOW_INSECURE_TLS=true` in `.env` to
   skip cert validation *for Apify only* (see `server/services/apify-service.ts`).
   Never ship this to production — it disables TLS security for Apify traffic.

When Apify is unreachable, the Equipment Finder still runs; Craigslist + FB
Marketplace return empty but all 17 HTTP-based scrapers (Bidspotter,
Future4200, GovDeals, eBay, etc.) work normally.

## Validation Requirements

After ANY code change:
1. Run `npm run lint` — fix all linting errors
2. Run `npm run typecheck` or `npx tsc --noEmit` — fix all type errors
3. Run `npm test` — fix all failing tests
4. Run `npm run build` — fix all build errors

Do NOT consider a task complete until all validation passes.
If tests fail, analyze the failure, fix the code, and re-run. Repeat until all tests pass.

## Conventions

- TypeScript everywhere (no `.js` files in `server/src/` or `client/src/`)
- Express 4.x (NOT Express 5 — do not suggest v5 patterns)
- sql.js for SQLite (in-memory loaded from file, not better-sqlite3)
- TanStack React Query for all data fetching (no raw fetch/useEffect)
- React Router 7 for routing
- TailwindCSS for styling (no CSS modules, no styled-components)
- Pydantic-style validation not applicable — use Zod if schema validation needed
- WebSocket for real-time updates (enrichment progress, campaign status)
- All API keys via environment variables, never hardcoded
