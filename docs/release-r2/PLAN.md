# IronGate QE Navigator — Release plan "R2" (shared by every agent; read fully)

Repo /home/user/irongate-qa-navigator-platform, branch `claude/wonderful-lamport-0a1h9w` (main == this branch at start, 404ef84).
Stack: React 19 + Vite + Tailwind v4 (src/, design primitives src/components/ui.tsx, accessible Modal src/components/Modal.tsx),
Express 5 + Postgres (server/; db helper src/lib/db.ts with `?` placeholders, `query/queryOne/transaction`; NUMERIC comes back as
string → Number()). Hosted on Netlify (netlify/functions/api.ts mounts the same routers as server/index.ts — any new router MUST be
mounted in BOTH). DB in production = Supabase Postgres 17. Local DB = .env (127.0.0.1). Shared formulas: server/lib/metricFormulas.ts.
Policy: server/lib/userPolicy.ts, server/middleware/access.ts (assertTeamAnalytics etc.), server/middleware/auth.ts (loads user from DB
per request). Membership: server/lib/teamMembership.ts. Role assignment: server/lib/roleAssignment.ts. Ingestion: server/lib/kpiIngest.ts,
server/routes/ingest.ts. Config inheritance: server/lib/configResolver.ts. Metric catalog (explanations): src/data/metricCatalog.ts.
Seed: server/seeds/demo*.ts (`npm run seed:demo`, `--fill-existing`, `seed:demo:check`, `seed:demo:clear`).

## Non-negotiable rules
1. **No AI attribution anywhere**: commit messages must not contain Co-Authored-By, Claude-Session, "Generated with", Claude, AI tool names.
   git user is configured as the owner — don't change it. Push only to `claude/wonderful-lamport-0a1h9w` (never main). If push is rejected:
   `git pull --no-rebase origin claude/wonderful-lamport-0a1h9w` then push. Never force-push, never `git reset --hard`.
2. **Never connect to Supabase** or any remote DB. Local only.
3. **Migrations**: new idempotent file(s) in supabase/migrations/ using YOUR assigned timestamp prefix (see phase). Additive and
   NON-DESTRUCTIVE: keep old columns/tables working (backfill new structures from old ones inside the migration; old columns may be
   kept in sync or marked deprecated, never dropped). Must run on Postgres 16 (local) and 17 (Supabase) as role postgres, no superuser
   features. Also update supabase/load files only if an existing agent pattern says so (check README). Apply locally with psql.
4. **Every number shown must be real** (or explicitly labelled sample data). Missing → "—"/empty state. One definition per metric
   (shared helpers; import, don't retype). Labels must match calculations.
5. **Security**: every new endpoint is authenticated, scoped to the caller's company, and checked with the shared policy helpers
   (no ad-hoc role checks). Role matrix: super_admin = company; qa_manager = their department(s); team_lead = their team(s);
   qa_engineer/viewer = their team, individual developer data only their own. Cross-company access impossible. Add API tests for
   every new endpoint covering allowed + forbidden cases.
6. **UI**: design system (ui.tsx), light AND dark (`dark:` pairs), accessible (labels, keyboard, focus, aria), responsive (390px and
   1440px), no emoji/gradients/glows, existing palette (slate, brand-*, green/amber/red for status). Toasts via the existing toaster.
7. **Verification before you report** (all must pass):
   - `npx tsc --noEmit -p tsconfig.app.json` clean; `npx tsc --noEmit -p tsconfig.server.json` only the pre-existing import.meta error;
   - `npm run build` succeeds;
   - API tests: start API with `API_RATE_LIMIT_MAX=10000`, then `npx jest --config jest.config.cjs tests/api` all pass;
   - relevant e2e specs if you touched gated UI (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`);
   - screenshots light+dark of every new/changed screen in scratchpad/r2/<your-phase>/ — look at them critically and fix issues;
   - leave the local DB as you found it (except your migrations + seed refresh).
   Environment: `service postgresql start`; from repo root `nohup npx tsx server/index.ts > /tmp/api.log 2>&1 &`,
   `nohup npx vite --port 5173 --host > /tmp/vite.log 2>&1 &` (check if already running; restart the API after server changes).
   Logins (password demo123): admin@irongate.com (super_admin), manager@irongate.com, lead@irongate.com, engineer@irongate.com,
   viewer@irongate.com; Northwind sample users e.g. alex.morgan@northwind.example. Screenshot helper:
   /tmp/claude-0/-home-user/3061e665-38e0-537b-ac16-1bf45adbbcb9/scratchpad/shoot3.cjs (THEME=light|dark) and shoot-scope.cjs (LOGIN=email).
8. **Ownership**: only edit files listed for your phase unless strictly necessary; for shared files (App.tsx, Layout.tsx, admin.ts,
   teams.ts, analytics.ts, metrics.ts, userPolicy.ts) re-read immediately before each edit and change surgically (never rewrite whole
   files). Commit in small logical commits.
9. Update README.md (concise section per feature) and the seed (demo data must populate any new table so the demo looks complete;
   keep seed idempotent/removable and `seed:demo:check` at 100%).
10. Final report: what was built, decisions taken, migrations (paths), endpoints, test results, screenshot paths, open items.

## Phases & scope

### Phase 1A — Quick UI (timestamp: none)
- **Grid 1/2/3**: on the dashboard team section add a column-density control (1, 2, 3 columns) next to Grid/List (grid mode only);
  remember in localStorage; responsive caps (1 col on mobile, max 2 on tablet).
- **Team TV / meeting mode**: route `/tv` (and `?team=<id>`), full-screen, no sidebar/topbar chrome, designed for a large screen at
  distance (1920×1080 and 3840×2160; also works at 1366×768). Shows ONLY the selected team: name, department, lead, big 3D QA battery
  (HeroBattery), status, the key KPIs with targets + status colour and trend vs previous snapshot, a few small trend charts, current
  recommendations/actions (if available), "data as of", a clock. Auto-refresh every 60s (also listens to the existing live-refresh
  event), optional auto-rotate through panels, keyboard: F = fullscreen (Fullscreen API), T = theme, Esc = exit. Dark theme by default
  on TV, light available. Team picker respects role scope (reuse AnalyticsScopeContext / /api/analytics/scope). Entry points: "Open TV
  mode" button on Team detail and in the scope bar. Respect privacy: no individual developer data on TV (team aggregates only).
  Owns: NewDashboard.tsx (grid control only), new src/components/TeamTvView.tsx (+ subcomponents), App.tsx route (surgical),
  TeamDetailView.tsx (button only, surgical).

### Phase 1B — Organisation & roles (timestamp 20261119000000)
- **Explicit role assignments**: new table `role_assignments(id, company_id, user_id, role, scope_type 'company'|'department'|'team',
  scope_id, created_at, created_by, revoked_at)`. A user may have several (e.g. qa_manager of 2 departments; team_lead of 2 teams;
  member of several teams). Backfill from users.role/department_id/primary_team_id, teams.lead_id, team_members. users.role etc. stay as
  "primary/display" columns kept in sync by the server (derived: highest role; primary dept/team). ALL access decisions (userPolicy,
  access.ts, analytics scope, team membership, manager lists, lead names) read assignments through one module
  (e.g. server/lib/assignments.ts). Team lead single source of truth: a team_lead assignment on the team (teams.lead_id kept in sync for
  compatibility; no other fallback logic). Update roleAssignment.ts, teamDepartment.ts, teamMembership.ts, admin UI (Departments manager
  / lead dialogs, Users edit) to support multiple assignments (add/remove assignment chips). Department move semantics unchanged
  (managers stay).
- **Change history + undo**: table `audit_log(id, company_id, actor_id, action, entity_type, entity_id, before jsonb, after jsonb,
  created_at, undone_at, undone_by)`. Record every org/role/team/department/user/assignment/config change. Admin "Activity" page
  (super_admin; qa_manager sees own department's) with filters and an Undo button for reversible actions (role/assignment changes,
  team move, team lead change, department rename, user deactivate) — undo re-applies `before` in a transaction after checking nothing
  newer conflicts (else explain).
- **Invitations**: table `invitations(id, company_id, email, role, scope_type, scope_id, token_hash, invited_by, expires_at, accepted_at,
  revoked_at)`. Admin/manager (within scope rules) invites by email → link `/accept-invite?token=…` where the person sets name+password
  (strength rules) and gets the assignments. Email sending via a pluggable mailer (server/lib/mailer.ts): SMTP if SMTP_* env set, else
  log + show the copyable link in the UI (no silent failure). Admin can revoke/resend. Users page "Invite" replaces creating users with
  a password (keep admin-create path for demo but mark it).
- **SSO**: Google and Microsoft (OIDC) sign-in, enabled only when GOOGLE_CLIENT_ID/SECRET or MS_CLIENT_ID/SECRET/TENANT env are set;
  login page shows the buttons only when enabled (/api/auth/providers). Matches an existing active user or an open invitation by
  verified email; never auto-creates users otherwise; same cookie session as password login. Proper state/nonce/PKCE. Document setup.
- Demo accounts: keep working (demo), but the login page "demo accounts" chips only render when DEMO_MODE=true (default true locally,
  set on Netlify by the coordinator).
  Owns: server/lib/{assignments,audit,mailer,sso}.ts (new), userPolicy.ts, access.ts, roleAssignment.ts, teamDepartment.ts,
  teamMembership.ts, auth.ts routes+middleware, admin.ts, users.ts, departments.ts, UsersView.tsx, DepartmentsView.tsx,
  DepartmentTeams.tsx, RoleAssignment.tsx, AdminPanel.tsx, Login.tsx, new src/components/{ActivityLog,AcceptInvite,InviteDialog}.tsx,
  App.tsx/Layout.tsx (routes/nav, surgical).

### Phase 2 — Metrics storage & ingestion quality (timestamp 20261120000000)  [after 1B]
- **Per-metric values**: table `metric_values(id, company_id, team_id, metric_key, value numeric, recorded_at timestamptz (the time the
  value is FOR), received_at, source, source_ref, idempotency_key, actor_id, superseded_by)`. kpi_ingest writes here with the caller's
  recordedAt honoured (backfill allowed, sensible max age), then refreshes the team's kpi_snapshots for the affected date(s) (snapshots
  become a derived per-day view = latest value per metric as of that day; keep the table so all readers keep working; qa trigger keeps
  working). Backfill metric_values from existing kpi_snapshots + field_sources in the migration. Manual metrics go through the same path.
- **Staleness**: a metric is stale when now − recorded_at > its expected interval (metric_update_intervals / config resolver). Stale
  values are shown greyed with "stale since"; composite scores (QA score, engineering health, etc.) exclude stale inputs.
- **Confidence on composites**: every composite returns {value, inputsUsed, inputsTotal, confidence 'high'|'medium'|'low'} and a
  minimum-inputs rule (e.g. QA score needs coverage + ≥2 of 4); UI shows "based on n of m inputs" everywhere the score appears
  (dashboard hero, team cards, team detail, TV, PDF). The DB trigger and computeQaScore stay identical (update both + the equality test).
- **Company aggregates**: weight by active team size (members) with the unweighted mean available, plus distribution: median, worst
  quartile (P25), min, count. Dashboard hero shows weighted mean + median + "weakest 25%".
- **Target history**: table `target_history(id, company_id, scope_type, scope_id, metric_key, good, warning, valid_from, valid_to,
  changed_by)`; writes from Parameters/metricsConfig overrides; every judgement of a past value uses the target valid at that value's
  date (helper targetAt(scope, metric, date)). Backfill current targets valid_from = earliest snapshot.
- **Ingestion log + idempotency**: every ingest/manual write recorded in `ingestion_log(id, company_id, api_key_id, actor_id, source,
  received_at, status 'accepted'|'partial'|'rejected', items jsonb summary, errors jsonb, idempotency_key)`. `Idempotency-Key` header (or
  per-item key) → duplicate requests return the original result without writing twice. Admin page "Ingestion log" (super_admin; managers
  their dept) with filters, error details, and per-source last-received.
- **Sample-data banner**: when any value on the current screen comes from source 'synthetic', show a slim, dismissible-per-session
  banner "Includes sample data" (+ per-value marker in formula mode). Driven by field_sources/metric_values.source, not by company name.
  Owns: kpiIngest.ts, ingest.ts, metricFormulas.ts, configResolver.ts, metrics.ts, teams.ts, analytics.ts (company metrics), new
  server/lib/{metricValues,staleness,targets,ingestionLog}.ts, NewDashboard/TeamDetailView/HeroBattery (confidence + stale display),
  ManualMetricsInput.tsx, ParametersConfiguration.tsx, MetricIntervalsConfig.tsx, new IngestionLog.tsx, SampleDataBanner.tsx, seeds.

### Phase 3 — Features (run in parallel after Phase 2)
**3A Alerts, digest, tracked actions** (timestamp 20261121000000)
- Alert rules (per company with dept/team overrides): threshold breach (status turns warning/critical), metric stale, score drop ≥ N
  points in 7 days, ingestion failures. Table `alerts(id, company_id, team_id, rule, metric_key, severity, message, created_at,
  acknowledged_at/by, resolved_at)`; evaluator runs after every ingest/manual write and on a schedule.
- Notification channels: in-app (bell in top bar with unread count, list, acknowledge), email (mailer from 1B), Slack incoming webhook
  (per company, configured in Parameters; secrets masked). Per-user preferences (immediate vs weekly digest, channels).
- Weekly digest for managers/leads (their scope): score changes, alerts, stale metrics, actions due. Netlify Scheduled Function
  (netlify/functions/weekly-digest.ts with `config.schedule`) + local cron in server/index.ts; also an admin "Send test digest" button.
- Also add the DB keep-alive: netlify/functions/db-keepalive.ts scheduled `0 6,18 * * *` doing `SELECT 1` (no secrets in logs).
- **Tracked actions**: recommendations (rule-based/AI) → "Create action" with owner (user in scope), due date, status (open, in progress,
  done, dropped), linked metric + baseline value; table `team_actions`. Shown on Team detail ("Action plan"), TV mode, digest. When done,
  record outcome: metric value at completion and after 14/30 days vs baseline → "improved/unchanged/worse" (computed, not claimed).
  Owns: new server/lib/{alerts,notifications,digest,actions}.ts, new routes alerts.ts/actions.ts (mount in both servers),
  netlify/functions/*, new UI NotificationsBell.tsx, ActionsPanel.tsx, notification prefs page, Layout.tsx (bell only, surgical),
  TeamDetailView.tsx (actions panel, surgical), ParametersConfiguration.tsx (alert + slack settings section, surgical).
**3B Compare, saved views, CSV, onboarding** (timestamp 20261121100000)
- Side-by-side team comparison page (2–4 teams in scope): KPIs with targets, QA/confidence, trend sparklines, differences highlighted.
- Saved views: name + filters/scope/sort/grid density for dashboard, analytics modules and comparison; per user, optional share with
  company (admin) — table `saved_views`; quick switcher.
- CSV export on every table/list view and comparison (respecting scope & privacy; values exactly as shown, plus raw numbers).
- Onboarding checklist for a new organisation (super_admin): create departments, add teams, invite people, set targets, send first data
  (API key / manual metrics), with progress computed from real state; dismissible; shown on dashboard when incomplete.
  Owns: new CompareTeams.tsx, SavedViews*.tsx, csv util, OnboardingChecklist.tsx, routes compare/savedViews (new files), NewDashboard
  (surgical hooks), analytics module pages (export button only, surgical), App/Layout nav (surgical).
**3C Privacy & wellbeing** (timestamp 20261121200000)
- k-anonymity: any aggregate of individual developer data (team/department averages, DDPS team stats, workload, burnout counts) is
  suppressed ("Not shown: fewer than 3 contributors") when fewer than 3 opted-in developers contribute; enforced in the API.
- Pulse survey: short anonymous wellbeing survey (5 questions, 1–5 scale + optional comment), per team cadence (weekly/biweekly) set by
  lead/manager; responses stored without user id linkage in results (store participation separately to prevent duplicates);
  results shown only as aggregates with ≥3 responses; trend over time. "Wellbeing (survey)" becomes the wellbeing signal; "Workload
  balance (derived)" remains a separate workload signal and is no longer described as wellbeing anywhere; engineering health uses
  survey wellbeing when available (else excluded, not substituted).
  Owns: new server/lib/{privacy,pulse}.ts, routes pulse.ts, new PulseSurvey*.tsx, developer endpoints in analytics.ts/teams.ts/metrics.ts
  (surgical), DeveloperProductivity.tsx, TeamDetailView.tsx members/wellbeing parts (surgical), developerHealth.ts.

### Phase 4 — Integration QA & review (no new features)
Full verification: all tests, e2e for every role, migrations applied from scratch on a fresh DB in order (initial → all new) and on a
copy of the dev DB, seed + check 100%, build, a security re-test of every new endpoint per role, an independent code review of the full
diff since 404ef84 (correctness, security, consistency with rules above), screenshot tour of every page light+dark, and fixes.

## Carry-over items found during R2 (assign in Phase 2 / Phase 4)
- GET /api/teams/:id returns member names+emails and /api/teams/:id/kpi-history are only company-checked → apply the shared
  team-read policy (members/emails only to roles allowed to see people; analytics scope for history). (Phase 2 owns teams.ts)
- Demo users manager@irongate.com and viewer@irongate.com point to non-existent primary teams (team-pulsars, team-grid) → seed fix
  (assign to real teams via assignments; additive/removable) so every demo role sees data. (Phase 2 seed)
- TV mode: add stale + confidence display (Phase 2) and tracked actions on the Focus panel (Phase 3A).
- teamKpiTrack / TV targets must use target history once it exists (Phase 2).
- Phase 1B done (role_assignments via server/lib/assignments.ts is now the ONLY source of access; use its helpers; audit every change
  via server/lib/audit.ts; mailer server/lib/mailer.ts exists). The IronGate demo admin (admin@irongate.com) primary team
  `team-quasars` does not exist → the Users page bulk developer-metrics call returns 400 → fix in seed (Phase 2) and make that endpoint
  degrade gracefully when the caller has no team.
- Migration 20261119000000 only tested on PG16; Phase 4 must also run all migrations on a PG17 container if available (else note).

## Phase 2 done (commit 4832246, CI green run 44371374374) — notes for Phase 3/4
- All metric writes go through `metric_values` (server/lib/kpiIngest.ts write path); kpi_snapshots is DERIVED via DB functions
  refresh_kpi_snapshots/backfill_metric_values. Never write kpi_snapshots directly. Alerts (3A) should hook the same write path.
- Staleness + confidence helpers exist (see server/lib for stale/confidence/targets); target history table `target_history` and
  GET/PUT /api/targets. Judge any value against the target valid on its date. Ingestion log table `ingestion_log`.
- Company aggregates are team-size weighted. Sample-data banner driven by source 'synthetic'.
- canViewTeamMembers in server/lib/userPolicy.ts gates member names/emails; /kpi-history is analytics-scope only.
- Golden tests (tests/api/golden.test.ts + golden/expected-changes.json) fail on ANY output change: if your phase deliberately changes
  a golden output, add each path to expected-changes.json with a reason; never regenerate the baseline.
- Open for Phase 4: PG17 migration run; /api/metrics/dashboard, /metrics/analytics/* averages and Team rankings not staleness-aware;
  other analytics pages still on default thresholds instead of target history; hosted demo data goes stale a day after seeding
  (consider making 3A's scheduled function or a seed "refresh-dates" step keep demo data fresh when DEMO_MODE=true);
  GET /api/analytics/pipeline-stages 400 for caller without team; supabase/load schema files not updated.

## Phase 3 parallel-work rules
- Each 3x agent works in its OWN git worktree on its own local branch (r2-3a / r2-3b / r2-3c) created from 4832246, commits there,
  and does NOT push. The orchestrator merges the three branches into claude/wonderful-lamport-0a1h9w afterwards.
- Own DB + ports per agent (never use the shared irongate_dev DB or ports 3000/5173):
  3A: DB irongate_r2_3a, API 3101, Vite 5201 · 3B: DB irongate_r2_3b, API 3102, Vite 5202 · 3C: DB irongate_r2_3c, API 3103, Vite 5203.
  Create the DB with scripts/ci/prepare-db.sh (read it for the env vars it needs). Symlink node_modules from
  /home/user/irongate-qa-navigator-platform/node_modules; copy its .env and override DB name/ports. Vite must proxy /api to your API port
  (check vite.config for how the proxy target is set; use an env var or a local untracked override, don't commit port changes).
- Shared files (server/index.ts, netlify/functions/api.ts mounts, App.tsx routes, Layout.tsx nav, TeamDetailView.tsx, NewDashboard.tsx,
  README, seed script) — edit surgically, keep each change small and self-contained to make merges easy.

## Phase 3B merged (930835a, pushed). Phase 4 fix-list additions
- Compare page: the worst-value marker says "LOWEST" even for lower-is-better metrics (tech debt 75 marked LOWEST) — rename to
  "Weakest"/"Worst" so it reads correctly for both directions.
- 3B open items: no CSV on sub-tables (team detail members, admin console members, department team list, reports preview);
  saved-view rename has no UI; e2e/frontend hardcode ports 3000/5173.
