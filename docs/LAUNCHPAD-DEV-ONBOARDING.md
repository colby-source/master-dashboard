# Launchpad — Dev Onboarding Checklist

Companion to [LAUNCHPAD-DEV-HANDOFF.md](LAUNCHPAD-DEV-HANDOFF.md). Walk a new dev through this on day one.

---

## 1. Repo Access

GitHub repo: `https://github.com/colby-source/master-dashboard`

Add via:
```
gh api -X PUT /repos/colby-source/master-dashboard/collaborators/<github-username> -f permission=push
```
Permission options: `pull` (read-only), `triage`, `push` (write — recommended), `maintain`, `admin`.

---

## 2. Secrets (share via 1Password / Bitwarden — NEVER paste in chat or commit)

Required for Launchpad work:

| Variable | Purpose | Source |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude (strategy + content gen) | console.anthropic.com |
| `GOOGLE_DRIVE_CLIENT_ID` | OAuth app | Google Cloud Console |
| `GOOGLE_DRIVE_CLIENT_SECRET` | OAuth app | Google Cloud Console |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Long-lived auth | OAuth playground (one-time) |
| `GOOGLE_DRIVE_BMN_CLIENTS_ROOT_FOLDER_ID` | **Use sandbox folder, NOT prod** | Created in step 3 |

Optional but recommended:
| Variable | Purpose |
|---|---|
| `LAUNCHPAD_FROM_EMAIL` | Override default sender for magic-link emails |
| `LAUNCHPAD_MAGIC_LINK_TTL_DAYS` | Default 7 |
| `LAUNCHPAD_MAX_ASSET_SIZE_MB` | Default 50 |

Hand off via shared vault entry titled `Launchpad Dev Bundle` containing the values above.

---

## 3. GDrive Sandbox

Create `BMN/Clients/_DEV/` under the BMN shared drive. Use that folder ID as `GOOGLE_DRIVE_BMN_CLIENTS_ROOT_FOLDER_ID` in the dev's `.env`. **Do not give them the prod root** — it would write test brands into your live client tree.

Steps (admin):
1. Open BMN/Clients/ in Google Drive.
2. New folder → `_DEV`.
3. Right-click → "Get link" → copy folder ID from URL (`/folders/<ID>`).
4. Drop ID in their vault entry.

---

## 4. Test Brand

Active test brand is preserved for the dev team:

- ID: `lpb_51cd78d6401ecc3a`
- Slug: `ui-redesign-demo`
- Status: `invited` (fresh, no intake)
- Token: `05884791cbe062a9f11a37b69a140d8c5c5b3776e30e74b2c5bb430e3331ebef`
- Expires: 2026-05-11
- URL: `http://localhost:5173/launchpad/05884791cbe062a9f11a37b69a140d8c5c5b3776e30e74b2c5bb430e3331ebef`

After expiry, re-issue:
```
curl -X POST http://localhost:3001/api/launchpad/brands/lpb_51cd78d6401ecc3a/magic-link
```

---

## 5. Branch & PR Policy

Pick one and tell the team in writing:

- **Option A — PR-only.** All work goes through pull requests against `master`. Owner approves before merge. Safest. Slower.
- **Option B — Direct push, post-hoc review.** Devs push to `master`, owner reviews after. Current de-facto state. Fastest. Risky for prod.
- **Option C — Feature branches + auto-merge on green CI.** Devs work on `feat/*` branches, CI runs validation gates (lint/typecheck/test/build), auto-merge on pass. Requires CI setup.

Recommended for handoff: **Option A** until trust is established, then revisit.

---

## 6. Scope of Work (give them this in writing)

Edit the section below before handing off.

### In scope
- [ ] _list bugs_ (e.g., port-drop, catalog parser brittleness)
- [ ] _list features_ (e.g., per-claim FDA flagging, additional steps)

### Out of scope
- GHL / Instantly / Meta Ads modules (not Launchpad — separate ownership)
- Database schema changes without owner approval
- New external API integrations without owner approval
- Production deployments (owner-only)

### Definition of done
- [ ] All four validation gates pass: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
- [ ] New code has tests (vitest in `server/services/launchpad/__tests__/`)
- [ ] Status FSM transitions logged via `launchpad_status_log`
- [ ] No `console.log` in production code paths
- [ ] No hardcoded secrets, paths, or brand IDs

---

## 7. Known Issues To File as GitHub Issues

Awaiting your authorization to file these on `colby-source/master-dashboard`:

1. **PM2 server port-drop bug.** `master-dashboard-server` shows PM2 `online` but is not bound to `:3001`. Fix is `pm2 restart master-dashboard-server`. Root cause unknown.
2. **Per-claim FDA flagging.** `StepCompliance.tsx` enforces universal acks only; per-claim language-level flagging not yet wired.
3. **PLDS catalog parser brittleness.** `catalog-service.ts` parses a structured doc; format changes break it. `/catalog/drift` surfaces deltas but doesn't auto-heal.

To file: tell me "file the launchpad issues" and I'll run `gh issue create` for each.

---

## 8. Day-One Checklist (give to the dev)

- [ ] Cloned repo, `npm install` + `(cd client && npm install)` clean
- [ ] `.env` populated from vault (sandbox GDrive folder, NOT prod)
- [ ] Read [CLAUDE.md](../CLAUDE.md) and [LAUNCHPAD-DEV-HANDOFF.md](LAUNCHPAD-DEV-HANDOFF.md)
- [ ] `npm run dev` boots server on `:3001` and Vite on `:5173`
- [ ] Loaded test brand wizard at the URL in §4 — sees Welcome screen
- [ ] Ran `npm run lint && npm run typecheck && npm test && npm run build` — all green
- [ ] Confirmed they understand the FSM (see §4 of HANDOFF doc)
- [ ] Confirmed they will NOT touch GHL/Instantly/Meta modules without asking
