## Logical-inconsistency review: IronGate QE Navigator

I made no edits or writes. I verified every item below in the code, and marked items "live" where I also confirmed them through the API on :3000 or with read-only psql (`default_transaction_read_only=on`). The six excluded topics are left out. Another agent has uncommitted changes in admin.ts, metrics.ts, teams.ts, App.tsx, AdminPanel.tsx and TeamDetailView.tsx, so line numbers there may drift. The happiness_score numeric(3,1) overflow is already fixed by migration 20261117000000, so it is not listed.

### Critical

**C1. Registration lets anyone become super_admin of an existing company.**
- Where: `server/routes/auth.ts:39-125`.
- Inconsistency: the comment says "First registered user is always super_admin", but the code looks the company up by name (`LOWER(name)=LOWER(?)`) and reuses it. The new user is then inserted with `role='super_admin'` into that tenant. The Register UI says "You will be the administrator".
- Effect: registering with organisation name "NovaTech" gives full admin over the existing NovaTech tenant.
- Fix: refuse registration when the company already exists (409), or create the user without privileges pending an invite.

**C2. Two user-update endpoints apply contradictory rules.**
- Where: `server/routes/users.ts:91-150` (`PUT /api/users/:id`) and `DELETE /api/users/:id` (~155), used by `src/components/AdminPanel.tsx:378`; compared with `server/routes/admin.ts:255-300` (`PUT /api/admin/users/:id`).
- `PUT /api/users/:id`:
  - lets a qa_manager set any `role` (including super_admin), department or team on any user in the company;
  - has no hierarchy or department check.
- `PUT /api/admin/users/:id`: enforces `canCreateRole` and the department rule.
- `DELETE /api/users/:id`: hard-deletes, whereas `/admin/users/:id` soft-deactivates with ownership checks.
- `GET /api/users`: returns every active user with their email to any role. Live: a viewer gets 41 users there, but only 1 from `/api/admin/users`.
- Effect: privilege escalation from the Admin console. The same edit is allowed in the Admin console but refused (403) in the Users page.
- Fix: route AdminPanel through `/admin/users/:id` and remove or lock down the `/api/users` write and list routes.

**C3. Analytics team scoping is inverted.**
- Where: `server/routes/analytics.ts:16-27` (`getTeamIdForRole`).
- Inconsistency: every non-team_lead role gets "any team". So qa_engineer and viewer, whom the UI blocks from Analytics entirely (`App.tsx:136`, `Layout.tsx ANALYTICS_ROLES`), can read any team's data. team_lead is limited to their own team.
- Live, for another team's id: viewer and engineer get **200**, lead gets **403**, on:
  - `/analytics/technical-debt`
  - `/analytics/flaky-tests`
  - `/analytics/test-executions`
  - `/analytics/pipeline-stages`
  - `/analytics/business-impact-v2/:id`
  - `/analytics/ddps-history` (lead 403 on its team-scoped call)
- Fix: use `assertTeamRead` (or `canManageCompanyData`) and reject qa_engineer/viewer as the UI does.

### High

**H1. Integration secrets are readable by every role and never used.**
- Where: `admin.ts:931-1010` (`GET /admin/configs`, `/admin/configs/raw`) and `src/components/ParametersConfiguration.tsx:29-91`.
- Inconsistency:
  - The Parameters page, gated to super_admin/qa_manager, stores `jenkins_api_token`, `jira_api_token`, `groq_api_key`, `openai_api_key` and `ext_db_password` as plaintext rows.
  - Both GET routes have no role check (live: viewer gets 200).
  - No server code reads these keys; Groq uses `process.env.GROQ_API_KEY` (`server/lib/groq.ts:27`).
- Effect: secrets leak to viewers, and "Connect to Jenkins/Jira" does nothing.
- Fix: role-gate both GET routes and mask secret keys, or remove the integration sections until something consumes them.

**H2. The server trusts a 7-day JWT snapshot of role, department and team; the UI uses the database.**
- Where: `server/middleware/auth.ts:44-63` and `auth.ts` login/register `jwt.sign`, versus `/auth/me` (`auth.ts:271+`).
- Inconsistency: `/auth/me` re-reads the DB and returns 403 for deactivated users, so the SPA logs them out. `authenticateToken` never checks the DB.
- Effect: a deactivated user, or one whose role or team changed, keeps their old API rights for up to 7 days while the UI shows the new state.
- Fix: load role, department, team and `is_active` from the DB in `authenticateToken`, or shorten the token life and invalidate tokens on change.

**H3. Users and Teams pages offer actions the server rejects.**
- **Edit buttons the server refuses:**
  - Users page Edit (`canManageTargetUser`, `UsersView.tsx:265-272`) shows for team_lead, but `PUT /admin/users/:id` rejects team_lead (`admin.ts:261`).
  - Teams page Edit shows for a team_lead on their own team (`TeamsView.tsx:124-128`), but `PUT /admin/teams/:id` allows only admin and manager (`admin.ts:~560`).
- **Profile edits fail for admin and manager:** the edit form always sends the unchanged `role` (`UsersView.tsx:938`). `canCreateRole(super_admin,'super_admin')` and `canCreateRole(qa_manager,'qa_manager')` are false, so a super_admin or qa_manager editing themselves or a peer always gets 403.
- **Password reset:** the UI lets admin and manager reset anyone (`UsersView.tsx:287-295`). The server only allows users the caller created, or themselves (`admin.ts:64-72`, `426+`). Seeded users have `created_by` NULL (live, e.g. `10000004`), so resetting them always returns 403.
- **Viewer team:** "Primary Team (Optional) / No team" for viewers (`UsersView.tsx:884-897`), but `POST /admin/users` returns 400 without `teamId` (`admin.ts:155`).
- **Team-lead scope on create:** `POST /admin/users` does not limit a team_lead to their own team or department (`admin.ts:188-210`).
- Fix: align the client predicates with the server, skip the role check when the role is unchanged, and decide on one reset-password rule.

**H4. The same KPIs are judged against different targets in different places.**
- **Dashboard vs Team detail:** `analytics.ts:2121-2126` (`KPI_TARGETS`) and `NewDashboard.tsx:218-223` use flakiness ≤3% and escape rate ≤2%. `src/config/metricsConfig.ts:90-118`, which drives Team detail colours and team suggestions, uses flakiness good ≤2 and escape good ≤5. A team at 3% escape is "Needs attention" on the dashboard and green on Team detail.
- **QA score colours:** `TeamsView.tsx:251,320` uses 80/60, while the shared thresholds are 85/70 (`metricFormulas.ts QA_SCORE_THRESHOLDS`, dashboard, ManualMetricsInput).
- **Manual metrics targets** (`ManualMetricsInput.tsx:180-517`) disagree with `METRICS_CONFIG`:

  | Metric | Manual metrics | METRICS_CONFIG |
  |---|---|---|
  | Code quality | >85 | 80 |
  | Sprint commitment | >85 | 90 |
  | First-time pass | >75 | 85 |
  | MTBF | >100 h | 720 |
  | Blocked time | <15 h/sprint | 4 h |
  | Infrastructure failures | <5 per sprint | 1 per month |

- Fix: derive all of these from `METRICS_CONFIG` and the shared QA thresholds.

**H5. The Metric intervals page configures nothing.**
- Where: `server/routes/settings.ts`, `server/jobs/intervalSync.ts:83-112, 452-456`, `TeamDetailView.tsx:323-329`.
- Inconsistency:
  - Saved `metric_update_intervals` are never read; the sync uses hard-coded hourly/daily/weekly/monthly buckets, and the hourly cron runs all of them anyway.
  - `metric_last_updated` is never written, so `/settings/sync-status` is always empty.
  - The crons are skipped on Netlify and are synthetic-only.
  - Team detail still shows "updates every N <unit>" from these settings.
  - `sizing_accuracy` is synced but missing from `DEFAULT_METRIC_INTERVALS`.
- Fix: either make the sync honour the saved intervals, or relabel or remove the page and the "updates every" text.

### Medium

**M1. The team chosen on the Analytics page is ignored by six modules.**
- Where: `App.tsx:279-287`. Only Pipeline, Business impact and Developer productivity receive `teamId`. Flaky tests, Technical debt, Performance, Test execution, Rankings and Reports do not; their fetches have no team parameter.
- Effect: `FeaturesMenu.tsx:66` says "Showing analytics for X", but those modules show company-wide data.
- Fix: pass `teamId` through, or clear the label for those modules.

**M2. Team detail history says "No snapshots" when access is denied.**
- Where: `GET /teams/:id` has no read check (`teams.ts:318`), but `/teams/:id/kpi-history` uses `assertTeamRead`.
- Live: lead and viewer get 403 on another team's history.
- Effect: `TeamDetailView.tsx:343-347` treats non-OK as `{}`, so every metric reads "No snapshots in the last 90 days". This contradicts ROLE_PERMISSIONS.md ("anyone can view any team… metrics").
- Fix: use the same read rule on both endpoints, or show "not available for your role".

**M3. Developer metrics shown as missing, and the opt-out applied unevenly.**
- **Members table:** member metrics come only from `/developer-ai-suggestions` (`TeamDetailView.tsx:363-376`). That endpoint returns nothing when the team's AI toggle is off and drops opted-out users (`teams.ts:765`). The table then says "No metrics recorded".
- Live: The Away Team has 5 `developer_metrics` rows; 2 are returned.
- **Opt-out not enforced everywhere:** `/analytics/ddps-history` ignores `developer_insights_enabled` (`analytics.ts:~2600`). `/analytics/developer-metrics` (`analytics.ts:441`) does honour it.
- Fix: show "insights disabled" as its own state, and apply the opt-out in ddps-history.

**M4. Team membership has two sources of truth.**
- Inconsistency:
  - `memberCount` counts `team_members` (`teams.ts:~146`, `departments.ts:47`).
  - TeamsView counts `users.primary_team_id`.
  - Team detail merges both.
  - Editing a user's primary team (both PUT endpoints) does not touch `team_members`.
- Live: LegacyCode Warriors shows `memberCount` 0 with 4 primary members; QualityCowboys 0 vs 3; The Away Team 1 vs 5. `teams.lead_id` is NULL everywhere, so `teamLead` is always null.
- Fix: pick one source and keep it in sync.

**M5. Department delete, listing and creation disagree.**
- Inconsistency:
  - Delete is a soft delete (`admin.ts:900`), but `GET /admin/departments` and `/admin/departments/all` (`admin.ts:705-740`) do not filter `is_active`. `/api/departments` does.
  - The duplicate-name check includes inactive rows, so a deleted name can never be reused.
  - New ids are `dept-<slug>`, a globally unique primary key, so two companies cannot both have, say, "QA".
  - The duplicate handler checks MySQL's `'ER_DUP_ENTRY'` instead of Postgres `23505`, so it returns 500.
- Effect: a "deleted" department stays visible.
- Fix: add `AND is_active = true`, use UUID ids, and handle `23505`.

**M6. Manual metrics: role rules disagree and one input is never saved.**
- **Roles:** the UI is super_admin only (`App.tsx:141`, Layout). The server allows qa_manager and team_lead on `/metrics/manual` and `/metrics/developer` (`metrics.ts:284, 335`). The debt-impact and pipeline writes allow only admin and manager.
- **Lost input:** "Environment Startup Time" (`ManualMetricsInput.tsx:334-346`) is collected but not in the payload (`:1296-1322`) and has no column, so it is silently discarded. The comment says "22 metrics"; there are 24.
- Fix: choose one role set, and remove that metric or persist it.

**M7. Config inheritance is applied differently by each reader.**
- The Parameters page says "Team > department > company" (`ParametersConfiguration.tsx:255`).
- `getFinancialConfig` (`analytics.ts:492-523`) applies team, then company, and skips the department level.
- `/admin/configs?teamId=` without `departmentId` binds `department_id = NULL`, so department rows are dropped.
- The Performance page calls `fetchSLAConfig()` with no team (`PerformanceTesting.tsx:81`). Live: a saved team-level SLA for Alpha Team (600 ms / 1.5% / 90%) is never applied.
- `sla_uptime_percent` is read by nothing.
- Fix: one resolver (team, then department, then company) used by all readers.

**M8. "Wellbeing" is a derived score, but is shown and weighted as a separate signal.**
- Inconsistency: `happiness_score` is written as `calculateWorkloadBalance` of the same focus, meeting, context-switch, PR and review inputs (`ManualMetricsInput.tsx:155`, `advancedFeatures.ts:175-184`). It is presented as wellbeing or satisfaction:
  - dashboard caption "Focus, meetings, satisfaction" (`NewDashboard.tsx:191`);
  - a weight-2 concern plus an automatic "at-risk" in `developerHealth.ts`;
  - 0.6 of the wellness index.
- Effect: the same inputs are counted twice.
- Fix: rename it to workload balance and drop it from the concern weights, or capture a real survey score.

**M9. Tests are stale.**
- `package.json test:e2e` names `auth-spa.spec.ts`, `user-management-spa.spec.ts`, `permissions-spa.spec.ts` and `simple-test.spec.ts`, none of which exist (testDir `tests/e2e`). So `npm test` runs no e2e specs.
- Existing specs wait for testids that the redesign removed: `features-menu` (super-admin and team-lead specs), `user-menu-btn`, `team-ai-status`, `user-ai-status`.
- Fix: update the script and the selectors.

**M10. `ROLE_PERMISSIONS` disagrees with actual enforcement.**
- Where: `admin.ts:19-56`, served by `GET /admin/permissions` and unused by the UI.
- Examples: it lists team_lead teams create/update = true and users update = true; the routes forbid both. It lists team_lead user delete = false; `DELETE /admin/users` allows it for users they created.
- Fix: delete it or generate it from the real checks.

### Low

- **L1. Dates shift a day outside UTC.** pg has no DATE parser, and code mixes `to_char` (company summary, performance) with `new Date(date).toISOString().split('T')[0]` (14 places in server/) and `String(snapshotDate).slice(0,10)` (PDF report). With `TZ=Europe/Berlin`, `2025-12-07` becomes `2025-12-06` (tested). Fix: `types.setTypeParser(1082, v => v)`.
- **L2. Dead or unlinked routes and features:**
  - `/manage-teams` (TeamManagement) has no nav entry, and `hasPermission` defaults to true, so any role reaches it by URL.
  - `TestCaseManagement.tsx` and `/analytics/test-cases` are unused.
  - `POST /metrics/sync` returns "success" and does nothing (`metrics.ts:273`).
  - `/admin/permissions`, `/api/departments`, `/settings/sync-metrics` and `/settings/sync-status` have no UI.
  - `src/services/dataAggregator.ts` is unused, yet `.env.example` documents `VITE_*` Jenkins/Jira/GitHub tokens for it. Those would be bundled into the client, and the file says "leave empty to use demo/mock data".
- **L3. Toasts appear twice.** `Layout.tsx:305` always renders a Toaster; `App.tsx:302` adds a second on the dashboard and `AdminPanel.tsx:507` a third.
- **L4. CORS mismatches.**
  - `src/config/api.ts` treats `127.0.0.1` as local dev, but `server/index.ts` only allows `http://127.0.0.1` with no port. Live: an `http://127.0.0.1:5173` preflight gets no Allow-Origin.
  - `netlify/functions/api.ts` allows any `*.netlify.app`, while `server/index.ts` deliberately uses exact matching.
  - Netlify has no cron jobs or WebSocket; Layout still opens `wss://host/ws`.
- **L5. More threshold sets for the same signals.**
  - DDPS "loss drivers": meetings >2.5, context switches >5, focus <4 (`analytics.ts:~2715`).
  - Wellness bands: focus ≥4 → 100, meetings ≤2 → 100 (`analytics.ts:2300-2303`).
  - `developerHealth`: focus <3, meetings >4, context switches >6.
- **L6. Two "Needs attention" definitions on one dashboard.** The card includes any KPI miss (even QA ≥85); the table filter is QA <70 (`NewDashboard.tsx:124`).
- **L7. ai-toggle scope differs from other team writes.** `PATCH /teams/:id/ai-toggle` lets a qa_manager toggle any company team (`teams.ts:~436`); `assertTeamWrite` limits managers to their department.
- **L8. Stale or contradictory docs:**
  - `ROLE_PERMISSIONS.md` says Analytics is open to all roles and team leads cannot create users.
  - `QA_SCORE_COLORS_UPDATED.md` documents 75/50/30 thresholds and a `TeamRow.tsx` that no longer exists.
  - The `docs/*MYSQL*` and `AIVEN_*` docs describe the old MySQL database.
  - DeveloperProductivity text says snapshots are "written by the snapshot job" and charts "stored 0–1 values". Only a seed writes snapshots, and the server recomputes DDPS from inputs.
  - A `tests/database/schema.test.ts` comment says users has no FKs; it has 4.

### Checked and consistent
- Every frontend `${API_URL}/…` call maps to an existing server route.
- `netlify/functions/api.ts` and `server/index.ts` mount the same 8 routers.
- Layout `NAV_GROUPS` roles match `App.hasPermission` for every linked view.
- The QA score formula and status (`computeQaScore`/`qaStatusFromScore`) are used by teams.ts, sync and manual entry. The dashboard, ManualMetricsInput and company summary use 85/70.
- The technical-debt weight SQL is shared by team score and company summary.
- DDPS is 0–1 from ddps-history and ×100 in the UI, matching its labels.
- `/teams/:id/ai-suggestions` and `developer-ai-suggestions` gating matches TeamDetailView's `canViewDeveloperInsights`.
- Departments pages are super_admin-only in both UI and server.
- `metric-intervals` endpoints are admin/manager-only, matching nav.
- `kpi_snapshots.status` CHECK matches the server's good/warning/critical.
- The `pipeline_runs.status` enum matches the pipeline-health query.
- The `technical_debt` `effort_hours` → `estimated_effort_hours` alias is consistent.
- SLA config keeps a configured 0.
