# Release R2 — final review (Phase 4)

Independent review of the full R2 diff (`git diff 404ef84..172dd6a`, 224 files, about 52,000 lines added) plus the
fixes made in Phase 4. Scope: correctness, security (authorisation of every new endpoint per role, cross-company
access, token handling for invitations / SSO / pulse links, Slack secret, CSV injection, SQL injection, rate limits),
privacy (k-anonymity, pulse anonymity) and consistency with the release rules (shared policy helpers, one definition
per metric, real numbers only).

Every endpoint added in R2 is now exercised per role by `tests/api/r2-security-matrix.test.ts` (super_admin,
qa_manager, team_lead, qa_engineer, viewer, another company, anonymous); the Phase 4 fixes by `tests/api/r2-fixes.test.ts`
and `tests/database/demoRefresh.test.ts`. Both run in CI.

## Summary

| Severity | Found | Fixed | Deferred / accepted |
|---|---|---|---|
| Critical | 0 | — | — |
| High | 0 | — | — |
| Medium | 7 | 7 | 0 |
| Low | 13 | 9 | 4 |

No critical or high issue was found. The security matrix found no endpoint that a role outside its documented scope
could use, and no cross-company read or write.

## What was checked and held

- **Authorisation of new endpoints**: actions, alerts (+ rules, evaluate), notifications (+ preferences, digest,
  Slack settings), compare (+ CSV), saved views, onboarding, pulse (results, answer, cadence, auto-send, send, remind,
  personal links), revenue impact (team, what-if, roll-up), TV, targets, ingestion log, role assignments, change
  history + undo, invitations, SSO, providers. Each uses the helpers of `server/lib/userPolicy.ts` /
  `server/lib/alertPolicy.ts`, scopes every query to the caller's company, and answers an id of another company like
  an unknown id (403/404 without data).
- **Tokens**: invitation tokens (`igi_`, 256-bit, SHA-256 at rest, single use in one statement, expiry, revocation,
  resend rotates); pulse links (hashed, single use, bound to user / team / period, `Cache-Control: no-store`);
  SSO (state + nonce + PKCE S256 in a signed 10-minute cookie, ID token signature / issuer / audience / expiry /
  nonce verified, verified e-mail only, never creates accounts outside an open invitation).
- **Slack webhook**: AES-256-GCM at rest, write-only (responses carry a masked hint), host allow-list
  (`hooks.slack.com`; loopback only with `NOTIFY_SLACK_ALLOW_LOCAL` outside production), never in the audit log.
- **CSV**: `src/lib/csv.ts` quotes per RFC 4180 and neutralises formula-leading cells (`= + - @ TAB CR`) except plain
  signed numbers; the server CSV (compare) uses the same function.
- **SQL**: all values are bound parameters; the only interpolations are column lists from code constants and
  clamped integers (`LIMIT`).
- **Rate limits**: login / register (20 per 15 min), invitation and SSO routes (60 per 15 min), AI routes (10/min),
  ingestion (60/min), global API limit.
- **Privacy**: every aggregate of individual developer data goes through `server/lib/developerAggregates.ts` (≥ 3
  opted-in contributors); pulse results, comments and response counts are shown only with ≥ 3 responses; answers are
  stored without a user link, participation separately, rows shuffled on write; no audit entry for answers.
- **Migrations**: additive and idempotent; all run from scratch and twice more on PostgreSQL 16.15 and 17.11, and on a
  copy of the development database (see the Phase 4 report).

## Findings

| # | Severity | Where | Issue | Status |
|---|---|---|---|---|
| M-1 | Medium | `server/lib/userPolicy.ts` `canReadTeamDetail`; `server/middleware/access.ts` `assertTeamRead` | QA managers could read per-team metric detail (history, velocity, metric bundles) of **any** team of the company, contradicting the documented scope (their departments). | Fixed: `canReadTeamDetail` = analytics scope. Test: SEC-R2-002, FIX-005, MATRIX-004 (updated). |
| M-2 | Medium | `server/routes/teams.ts` `GET /:id/ai-suggestions`, `userPolicy.ts` `canRequestTeamInsights` | Ad-hoc role check, and QA managers could trigger AI insights (and the Groq call) for teams outside their departments. | Fixed: `canRequestTeamInsights(actor, team)` = the roles that see individual developers on that team; checked before any AI call. Test: FIX-005. |
| M-3 | Medium | `server/routes/metrics.ts` `POST /developer` | Each call replaced the whole row: an omitted field was stored as empty (silent data loss); no range checks (database error → 500); the developer only had to be in the company, not on the team. | Fixed: partial update (omitted keeps, `null` clears), range checks (400), developer must be assigned to the team. Test: FIX-001. |
| M-4 | Medium | `server/routes/analytics.ts` `PUT /technical-debt/:id/impact` | Omitted fields were cleared. | Fixed: partial update, ranges, empty body 400. Test: FIX-002. |
| M-5 | Medium | `server/lib/userPolicy.ts` `canViewDeveloperRow` | Treated an unset (`NULL`) `developer_insights_enabled` as opted in (`!== false`), while every SQL aggregate requires `= TRUE` and the column is nullable. Latent privacy leak of individual rows. | Fixed: explicit opt-in (`=== true`). Test: FIX-008. |
| M-6 | Medium | `src/components/ManualMetricsInput.tsx` | Team list filtered by display role and primary department / team: a QA manager of two departments or a lead of two teams could not enter data for the second one (multi-assignment regression). | Fixed: `canWriteTeamData` per team. |
| M-7 | Medium | `/api/metrics/dashboard`, `/api/metrics/analytics/teams`, `/analytics/history`, Team rankings | Not staleness-aware: stale values were averaged and ranked; the dashboard QA average used the stored score with stale inputs. | Fixed: shared snapshot evaluation (stale values left out, QA composite without stale inputs, company average = team-size weighted definition); rankings grey out and do not rank stale values and colour with each team's target history. Test: FIX-006. |
| L-1 | Low | `analytics.ts` business-impact month, bulk-save; `metrics.ts` business-impact-config | No range validation: overflow / invalid values gave 500. | Fixed: shared ranges (`server/lib/inputRanges.ts`), 400 naming the field (and month). Test: FIX-003. |
| L-2 | Low | `server/index.ts`, `netlify/functions/api.ts` error handlers | A body over the JSON limit answered 413 `Internal server error`. | Fixed: one shared handler (`server/middleware/errorHandler.ts`): 413 `Payload too large`, 400 `Bad request`, 415. Test: FIX-004. |
| L-3 | Low | `metrics.ts` `POST /manual`, `/developer`; `analytics.ts` seed-data, update-daily, company-insights; `src/App.tsx`, `Layout.tsx`, `NewDashboard.tsx`, `TeamTvView.tsx`, formula-mode switches | Ad-hoc role lists instead of the shared helpers (rule 5). | Fixed: `canWriteTeamData` via `assertTeamWrite`, `canManageSampleData`, `canRequestExecutiveBriefing`, `canManageCompanyConfig`, `canOpenUserAdmin`, `canWriteSomeTeamData`, `canUseFormulaMode`, `canRequestTeamInsights` in API, routes and navigation. |
| L-4 | Low | `GET /api/analytics/*` without `teamId` | 400 for a caller without a primary team (e.g. a QA manager). | Fixed: default team of the caller's analytics scope. Test: FIX-007. |
| L-5 | Low | `src/components/CompareTeams.tsx` | Worst value labelled "LOWEST" also for lower-is-better metrics. | Fixed: "Weakest" (direction-aware tooltip). |
| L-6 | Low | `src/config/metricsConfig.ts`, Manual metrics | Sprint velocity had dead good / warning thresholds (40 / 25) and was coloured and given a target in Manual metrics although the guide says no target; Manual metrics showed "> 200 %" for automation ROI (no target) and a ±10 % sizing tolerance (Team detail: ±15 %). | Fixed: `noTarget` (never coloured, "No target"), shared sizing tolerance. |
| L-7 | Low | `src/components/NewDashboard.tsx` | Gauge bands hard-coded. | Fixed: `COMPOSITE_INDEX_BANDS` in `server/lib/metricFormulas.ts`. |
| L-8 | Low | Business impact, Admin console at 390 px | Tab bar scrolled sideways; Admin console header and rows overflowed by 222 px. | Fixed: a select on phones; wrapping header and rows. |
| L-9 | Low | Docs | `ROLE_PERMISSIONS.md` stale; Product guide said "who have not opted out" (default is opt-in); integration guide described the old write semantics and 413 body. | Fixed: rewritten from `userPolicy.ts`; guides updated. |
| L-10 | Low | `server/lib/notifications.ts` | The Slack encryption key falls back to `JWT_SECRET`: rotating it makes the stored webhook unreadable (handled: 409 "enter it again"). | Accepted; owner should set `SETTINGS_ENCRYPTION_KEY` on Netlify. |
| L-11 | Low | `/api/pulse/link`, `/link/respond` | Only the global API rate limit. Tokens are 256-bit, so guessing is infeasible; a tighter per-IP limit would block offices behind one NAT. | Accepted. |
| L-12 | Low | Older admin screens (`AdminPanel.tsx`, `UsersView.tsx`) | Some buttons still decided from the display role. The API enforces the shared rules, so this is a display-only inconsistency. | Deferred: larger refactor of R1 screens; listed in the Product guide. |
| L-13 | Low | Hosted demo | Sample history stops at the seeding day. | Fixed: `npm run seed:demo -- --refresh-dates` (sample teams only, additive, idempotent; local unless `--allow-remote`). Test: REFRESH-001/002. Running it on the hosted database is for the owner. |

## Deferred items (with reasons)

- **CSV on sub-tables** (team-detail members, admin-console members, department team list, report preview) and a
  **rename UI for saved views**: features, not fixes; no behaviour is wrong today.
- **Ingestion API for monthly business series, debt items, pipeline runs and test executions**: new API surface
  (design, idempotency, logging) beyond Phase 4.
- **Business-impact `deployment_frequency` per month vs KPI per week**: labelled correctly on both screens
  ("/mo" vs "/week"); unifying the unit changes stored data semantics and needs a migration plan.
- **Formula mode for other roles**: kept super-admin only (product decision), documented, now a shared helper
  (`canUseFormulaMode`).
- **L-12** (display-role checks in older admin screens): UI-only, needs a careful pass over R1 screens.
- **Default targets duplicated in SQL** (`default_kpi_targets`) and the "tech debt score" vs "tech debt health" naming:
  guarded by the MV-002 equality test; renaming touches stored config keys.
