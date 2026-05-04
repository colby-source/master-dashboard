# BMN Brand Launchpad — Dev Handoff

Client-facing onboarding portal for Brand Me Now creator/brand clients. Magic-link gated wizard collects intake → generates social strategy → uploads assets → admin reviews → approves → launches the 30-day sprint.

---

## 1. Stack

| Layer | Tech |
|---|---|
| Backend | Express 4.x, TypeScript, Node 20+ |
| Database | SQLite via `sql.js` (file-backed, in-memory loaded) |
| Frontend | React 19, Vite, TailwindCSS, TanStack React Query, React Router 7 |
| Storage | Google Drive (OAuth refresh-token flow) |
| AI | Anthropic Claude (strategy generation, content clip rewrites) |
| Process mgr | PM2 (dashboard always-on) |

Constraints: Express **4** only. SQLite via `sql.js` (NOT `better-sqlite3`). No `.js` files in `server/src/` or `client/src/`.

---

## 2. Repo Layout (Launchpad-only)

```
server/
├── routes/
│   ├── launchpad.ts                    # ADMIN routes      (mounted /api/launchpad)
│   └── launchpad-public.ts             # CLIENT routes     (mounted /api/launchpad-public)
└── services/launchpad/
    ├── launchpad-service.ts            # core CRUD, status transitions
    ├── magic-link-service.ts           # 64-char hex tokens, 7d TTL
    ├── claude-strategy-service.ts      # Claude → 7-module strategy
    ├── content-processor-service.ts    # article/PDF → clips
    ├── video-processor-service.ts      # video → transcript → clips
    ├── text-chopper-service.ts         # transcript → captions/hooks
    ├── longform-generator-service.ts   # blog/email long-form
    ├── deliverables-service.ts         # CSV calendar export, GDrive packaging
    ├── google-drive-service.ts         # GDrive OAuth + folder/file ops
    ├── brand-identity-service.ts       # logo/palette/voice (admin pre-bake)
    ├── catalog-service.ts              # PLDS catalog parser (SKU master)
    ├── cost-guard-service.ts           # per-brand $ caps on AI gen
    ├── quality-feedback-service.ts     # cohort metrics, drift detection
    ├── telemetry-service.ts            # funnel events, stale-session alerts
    ├── types.ts                        # shared TS contracts
    └── __tests__/                      # vitest

client/src/pages/
├── LaunchpadAdminPage.tsx              # /launchpad-admin (internal)
├── LaunchpadPublicPage.tsx             # /launchpad/:token  (client wizard)
└── _launchpad/
    ├── _primitives.tsx                 # Panel, PrimaryBtn, StepHeader (cream theme)
    ├── _types.ts                       # Session, ClipDto, etc.
    ├── _format.ts                      # display helpers
    ├── ProgressRail.tsx                # left-rail step indicator
    ├── StepWelcome.tsx                 # off-rail intro (only for fresh `invited`)
    ├── StepIdentity.tsx                # brand name / handle
    ├── StepAudience.tsx
    ├── StepCompetition.tsx
    ├── StepStory.tsx
    ├── StepProducts.tsx                # PLDS SKU picker + catalog
    ├── StepVoice.tsx
    ├── StepChannels.tsx
    ├── StepCompliance.tsx              # FDA/FTC universal acks
    ├── StepContent.tsx                 # clip approval UI
    ├── StepReview.tsx                  # 7-module review (standard flow)
    ├── StepGenerating.tsx              # spinner while Claude runs
    ├── StepBrandReview.tsx             # PRE-BAKED flow brand sign-off
    ├── StepAssetsReview.tsx            # PRE-BAKED flow asset sign-off
    ├── StepAssets.tsx                  # upload dropzones
    ├── StepSubmit.tsx                  # gate checklist + final submit
    └── ClipCard.tsx                    # per-clip approve/reject/regen

database/migrations/
├── 022_launchpad.sql                   # core tables
├── 023_launchpad_generation_lock.sql   # Claude run mutex
├── 024_launchpad_content_studio.sql    # clips, sources
├── 025_launchpad_video_processing.sql  # video jobs
└── 026_launchpad_hub_spoke_and_catalog.sql  # PLDS catalog, SKU mapping
```

---

## 3. Database Schema

Tables (see migrations 022–026):

| Table | Purpose |
|---|---|
| `launchpad_brands` | One row per brand. Status FSM (see §4). Holds `intake_data` JSON, `strategy_package` JSON, GDrive folder refs. |
| `launchpad_magic_links` | Tokens (64-char hex), 7-day TTL, multi-redeem until `expires_at` or `revoked_at`. |
| `launchpad_assets` | Uploaded files (logo, photos, video, finalized posts). Drive ID + URL stored. |
| `launchpad_module_reviews` | Per-module (1–7) admin review state: pending / approved / needs_changes. |
| `launchpad_status_log` | Full FSM transition audit trail (actor, from, to, note). |
| `launchpad_generation_locks` | Prevents concurrent Claude runs for same brand (023). |
| `launchpad_content_sources` / `launchpad_content_clips` | Article/video → clip pipeline (024–025). |
| `launchpad_catalog_skus` / `launchpad_brand_skus` | PLDS catalog + per-brand SKU selections (026). |
| `launchpad_brand_identity` | Pre-bake assets: logo, palette, voice (026). |

Indices documented inline in each migration.

---

## 4. Brand Status FSM

```
invited → intake_started → intake_complete → strategy_generated
        → assets_uploading → submitted → in_review
                                       → needs_changes → (back to assets_uploading)
                                       → approved → launched
                                       → rejected
```

`approved` is the **hard gate** — no GHL workflows, Meta Ads, or store launches fire for the brand until then. Every transition writes to `launchpad_status_log`.

---

## 5. Two Wizard Flows

The public wizard at `/launchpad/:token` runs one of two rails based on whether the admin pre-baked brand identity:

| Flow | Trigger | Steps |
|---|---|---|
| **Standard** (12-step) | `isPrebakedBrand(session) === false` | Welcome → Identity → Audience → Competition → Story → Products → Voice → Channels → Compliance → Generating → Content → Review → Assets → Submit |
| **Pre-baked** (6-step) | Admin called `seal-prep` and uploaded identity before issuing magic link | Welcome → BrandReview → AssetsReview → Compliance → Content → Submit |

The dual rail logic lives in [LaunchpadPublicPage.tsx](../client/src/pages/LaunchpadPublicPage.tsx) (`STEPS_STANDARD` vs `STEPS_PREBAKED`). Welcome is off-rail and only renders for fresh `invited` brands with no intake.

`StepSubmit` enforces a gate checklist (`prebaked` mode requires brand+assets+compliance acks; standard mode requires compliance only) before unlocking the submit button.

---

## 6. API Surface

### Admin (`/api/launchpad/*`)

```
GET    /brands                          List + filter
GET    /brands/:id                      Detail
POST   /brands                          Create + auto-create GDrive folder
PATCH  /brands/:id/intake               Manual intake edit
POST   /brands/:id/assets               Admin upload (multer)
POST   /brands/:id/seal-prep            Mark brand identity as pre-baked
POST   /brands/:id/magic-link           Issue token (returns URL)
GET    /brands/:id/links                List active/expired tokens
POST   /brands/:id/generate-strategy    Trigger Claude run (locked)
POST   /brands/:id/review/:moduleNumber Approve / request changes per module
POST   /brands/:id/approve              Final approval (gate to launch)
POST   /brands/:id/deliver              Package GDrive deliverables
GET    /brands/:id/calendar.csv         30-day calendar export
POST   /brands/:id/reject               Hard reject
POST   /brands/:id/request-changes      Soft reject with notes
POST   /brands/:id/mark-launched        Flip to `launched`
POST   /brands/:id/content/generate     Process article/video → clips
GET    /brands/:id/content/clips        List clips
GET    /brands/:id/content/sources      List sources
POST   /clips/:clipId/approve           Admin override
POST   /clips/:clipId/reject            Admin override
GET    /brands/:id/identity             Brand identity (logo/palette/voice)
PATCH  /brands/:id/identity             Update identity
PUT    /brands/:id/skus                 Set selected SKUs
GET    /brands/:id/skus                 Get selected SKUs
GET    /catalog                         PLDS catalog
POST   /catalog/refresh                 Re-parse PLDS source
GET    /telemetry/funnel                Step-by-step conversion
GET    /telemetry/stale                 Sessions stuck > N days
GET    /cost/spend                      Per-brand AI spend
GET    /catalog/drift                   SKU changes since last snapshot
POST   /catalog/drift/:id/ack           Acknowledge drift
POST   /brands/:id/metrics              Record quality checkpoint
GET    /brands/:id/metrics              Read metrics
GET    /quality/cohorts                 Cross-cohort quality view
```

### Public (`/api/launchpad-public/*`)

All routes take `:token` as path param and validate via `magic-link-service`. Rate-limited per token (`middleware/launchpad-rate-limit.ts`).

```
GET    /session/:token                          Resolve token → brand+intake+status
POST   /intake/:token                            Save intake form
POST   /generate-strategy/:token                 Kick off Claude run
PATCH  /strategy/:token/module/:n                Client edits module
POST   /upload/:token            (multipart)     Asset upload (50MB cap)
GET    /assets/:token                            List uploaded assets
GET    /reviews/:token                           Module review status
POST   /submit/:token                            Final submit (FSM → submitted)
POST   /content/generate/:token                  Trigger content gen
POST   /content/upload-article/:token            Article upload (rate-limited)
GET    /content/sources/:token
GET    /content/clips/:token
POST   /content/clips/:token/:clipId/approve
POST   /content/clips/:token/:clipId/reject
PATCH  /content/clips/:token/:clipId/day         Reassign to day 1–30
POST   /content/clips/:token/:clipId/regenerate  Claude re-roll
POST   /content/upload-video/:token              Video upload (rate-limited)
GET    /identity/:token                          Pre-baked identity
PATCH  /identity/:token                          Client tweaks (in pre-baked flow)
GET    /catalog/:token                           PLDS catalog (token-gated)
GET    /catalog/:token/categories                Categories list
GET    /skus/:token                              Selected SKUs
PUT    /skus/:token                              Set selected SKUs
GET    /calendar/:token/csv                      30-day calendar download
```

Mounted in [server/index.ts](../server/index.ts):
```ts
app.use('/api/launchpad-public', launchpadPublicRouter);
app.use('/api/launchpad', launchpadRouter);
```

---

## 7. Environment Variables

Required for full functionality (see `.env.example`):

```bash
# Anthropic — strategy + content generation
ANTHROPIC_API_KEY=

# Google Drive — asset storage (OAuth refresh-token flow)
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
GOOGLE_DRIVE_BMN_CLIENTS_ROOT_FOLDER_ID=    # parent folder under BMN/Clients/

# Launchpad-specific
LAUNCHPAD_FROM_EMAIL=colby@brandmenow.co
LAUNCHPAD_MAGIC_LINK_TTL_DAYS=7
LAUNCHPAD_MAX_ASSET_SIZE_MB=50
```

Magic-link emails currently rely on existing email infra (SendGrid/SES wrapper in `server/services/email-*`). Swap if your team uses different provider.

---

## 8. Run / Build / Validate

```bash
# Install
npm install && (cd client && npm install)

# Dev (server :3001 + Vite :5173)
npm run dev

# Or PM2 (always-on production-like)
pm2 start ecosystem.config.js
pm2 logs master-dashboard-server

# Migrations run automatically at server boot via server/db-migrate.ts.
# To re-seed catalog: POST /api/launchpad/catalog/refresh

# Validation gates (all must pass before merge)
npm run lint
npm run typecheck    # or: npx tsc --noEmit
npm test
npm run build
```

Tests live in `server/services/launchpad/__tests__/`. Vitest. Add tests for any new service or status transition.

---

## 9. Known Issues / Gotchas

| Item | Detail |
|---|---|
| **Server port drops** | Occasionally `master-dashboard-server` shows PM2 `online` but is not bound to `:3001`. Fix: `pm2 restart master-dashboard-server`. Root cause not yet identified — investigation welcome. |
| **GDrive token expiry** | Refresh token can be revoked if Google account password changes. Re-issue via OAuth playground if uploads start 401-ing. |
| **Catalog parser** | PLDS source is a structured doc; parser in `catalog-service.ts` is brittle to format changes. `catalog/drift` endpoint surfaces deltas — review before approving. |
| **sql.js portability** | Whole DB is loaded in-memory and `saveDb()` writes the file. Long-running writes can collide; see existing `runSql` + `saveDb` patterns in routes. |
| **FDA compliance flagging** | `StepCompliance.tsx` enforces universal acks; per-claim flagging not yet wired. Roadmap item. |
| **Express version** | Express **4** only. Do NOT upgrade to 5 — middleware signatures differ and break the route layer. |

---

## 10. Quick Test Loop

1. Create a brand: `POST /api/launchpad/brands` with `{ brand_name, founder_email }`.
2. (Optional) Pre-bake: upload identity assets, then `POST /brands/:id/seal-prep`.
3. Issue magic link: `POST /brands/:id/magic-link` → returns `{ url }`.
4. Open `http://localhost:5173/launchpad/<token>` to walk the wizard.
5. Submit → admin reviews at `http://localhost:5173/launchpad-admin` → approve → launch.

Current valid test token (expires 2026-05-11):
`05884791cbe062a9f11a37b69a140d8c5c5b3776e30e74b2c5bb430e3331ebef` (brand: `UI Redesign Demo`, status `invited`, standard flow).

---

## 11. Recent Commits (context)

```
07fbd4b feat(launchpad): admin pre-bake flow — brand direction built before magic link
0c16777 feat(launchpad): light creator-ready theme + welcome intro screen
496a92a feat(launchpad): creator-ready UI revamp — glass morphism + gradient accents
```

Theme tokens in [_primitives.tsx](../client/src/pages/_launchpad/_primitives.tsx): cream `#FAFAF7` bg, slate-900 ink, cyan→teal gradient CTAs (`#1AE7F6` → `#0A9396`). Match these for any new step components.

---

## 12. Coding Conventions (project-wide)

- TypeScript everywhere — no `.js` in `server/src/` or `client/src/`.
- TanStack React Query for **all** data fetching — no raw `fetch` + `useEffect` in components.
- TailwindCSS only — no CSS modules, no styled-components.
- Zod for any schema validation at API boundaries.
- API keys from env vars — never hardcoded.
- Immutability: spread for updates, never mutate.
- Files: 200–400 lines typical, 800 max. Extract when growing.
- TDD for new features: tests first, then implementation.

See [CLAUDE.md](../CLAUDE.md) for the full project convention list.
