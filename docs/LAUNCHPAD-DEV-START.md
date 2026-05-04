# Launchpad — Dev Start

Single-page setup. Read in order. Should take <15 minutes to a working local wizard.

---

## 1. Clone

```bash
git clone https://github.com/colby-source/master-dashboard.git
cd master-dashboard
npm install
(cd client && npm install)
```

---

## 2. Get secrets

Owner will share a vault entry titled `Launchpad Dev Bundle` with the values below. Copy `.env.example` to `.env`, then paste:

```
ANTHROPIC_API_KEY=...
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DRIVE_REFRESH_TOKEN=...
GOOGLE_DRIVE_BMN_CLIENTS_ROOT_FOLDER_ID=...   # use the _DEV sandbox folder, not prod
LAUNCHPAD_FROM_EMAIL=colby@brandmenow.co
LAUNCHPAD_MAGIC_LINK_TTL_DAYS=7
LAUNCHPAD_MAX_ASSET_SIZE_MB=50
```

---

## 3. Run

```bash
npm run dev
```

- Server: http://localhost:3001
- Wizard: http://localhost:5173
- Admin:  http://localhost:5173/launchpad-admin

---

## 4. Open the wizard

http://localhost:5173/launchpad/05884791cbe062a9f11a37b69a140d8c5c5b3776e30e74b2c5bb430e3331ebef

Token expires 2026-05-11. To re-issue:

```bash
curl -X POST http://localhost:3001/api/launchpad/brands/lpb_51cd78d6401ecc3a/magic-link
```

---

## 5. Read these next

1. [LAUNCHPAD-DEV-HANDOFF.md](LAUNCHPAD-DEV-HANDOFF.md) — full architecture, schema, API, conventions
2. [LAUNCHPAD-DEV-ONBOARDING.md](LAUNCHPAD-DEV-ONBOARDING.md) — branch policy, scope, day-1 checklist
3. [../CLAUDE.md](../CLAUDE.md) — project-wide conventions

---

## 6. Open issues

- [#1 — port-drop bug](https://github.com/colby-source/master-dashboard/issues/1)
- [#2 — per-claim FDA flagging](https://github.com/colby-source/master-dashboard/issues/2)
- [#3 — catalog parser brittleness](https://github.com/colby-source/master-dashboard/issues/3)

---

## 7. Validate before any PR

```bash
npm run lint
npm run typecheck   # or: npx tsc --noEmit
npm test
npm run build
```

All four must pass. No `console.log` in production code.
