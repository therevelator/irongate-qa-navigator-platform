# End-to-end user flows and their UI tests

Every user flow of the app, which roles can do it and which must not, and the Playwright tests that
cover the happy path and the negative cases. How to run them: [README.md](README.md).

Roles: **A** super admin (`admin@irongate.com`), **M** manager (`manager@`, department DevOps),
**L** team lead (`lead@`, The Away Team), **E** software engineer (`engineer@`, Mavericks),
**V** viewer (`viewer@`, The Away Team), **P** platform operator (a `platform_operators`
account, never a company user; `tests/e2e/support/operator.ts` in tests), **–** signed out. "All" = A M L E V.

Test references: `ID` is the id at the start of a test title in `tests/e2e/<area>/*.spec.ts` (search for
it, or run `--grep "ID "`); `legacy:<file> "<title>"` is one of the specs that existed before this
suite (`tests/e2e/*.spec.ts`, kept and tagged). API-level checks of the same rules are in `tests/api`.

Contents: [Where the flows come from](#where-the-flows-come-from) ·
[Coverage summary](#coverage-summary) · flows by area 1–17 ·
[Not testable in CI and how it is covered instead](#not-testable-in-ci-and-how-it-is-covered-instead) ·
[Found issues](#found-issues) · [Known accessibility issues](#known-accessibility-issues)

## Where the flows come from

Derived from the code, then checked against the documentation:

- **Routes**: `src/App.tsx` (`VIEW_TO_PATH`, `hasPermission`; unknown paths fall back to the overview,
  forbidden ones redirect there with the "You don't have access to …" message, `AccessDeniedNotice`) and `src/components/AuthWrapper.tsx` (public pages `/accept-invite`,
  `/pulse/answer`, `/forgot-password`, `/reset-password`; sign-in and registration).
- **Navigation per role**: `src/components/Layout.tsx` (`NAV_GROUPS` with the `server/lib/userPolicy.ts`
  rules, the operator entry from `GET /api/operator/status`, top bar: notifications bell, theme switch,
  pinning, sign out, sign out my other devices, pending-pulse banner).
- **Buttons with handlers and API calls**: every component in `src/components/**` (searched for
  `onClick`, `onSubmit`, `fetch(`, `data-testid`), mapped to `server/routes/*.ts`.
- **Docs**: `docs/PRODUCT_GUIDE.md` (sections 2, 5, 6, 7: screens, features, privacy, alerts),
  `ROLE_PERMISSIONS.md`, `README.md`; the existing specs in `tests/e2e`.

## Coverage summary

| | Count |
|---|---|
| Flows in this inventory (rows F1.1 … F17.4; F11.11 only points at F4.12) | **165** |
| Flows with a happy-path UI test | **134** of the 137 flows that have a happy path (F2.4, F12.3, F13.3 are covered by API tests); the other 15 are negative-only by nature (limits, refusals, failures) |
| Flows with at least one negative UI test | **109** (the rest have no meaningful negative case, e.g. show / hide a password, open a module from the hub) |
| UI tests (Playwright, `chromium` project) | **366** in 41 files: 73 existing (kept, tagged) + 293 new; no `test.fail` left |
| …tagged `@smoke` / `@negative` / `@a11y` / `@readonly` | 40 / 121 / 13 / 4 |
| Other tests (passing) | API 426 and database 29 (Jest); the golden baseline is untouched |

## 1. Sign-in and sessions

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F1.1 | Sign in with e-mail and password, see the overview with the role in the navigation | All | – | AUTH-01 (each role), LIVE-02 | AUTH-02 empty fields (nothing sent), AUTH-03 wrong password (message, e-mail kept), AUTH-04 unknown e-mail (same answer), AUTH-05 deactivated account, AUTH-12 500 with request id / unreachable server, AUTH-13 double click signs in once |
| F1.2 | Attempt limit (20 failed sign-ins per address per 15 min) | – | – | — | AUTH-06 "Too many attempts" |
| F1.3 | Show / hide the password | – | – | AUTH-07 | — |
| F1.4 | Demo account chips fill the form (demo mode) | – | – | AUTH-08 | AUTH-10 no chips when demo mode is off (stubbed providers) |
| F1.5 | SSO buttons (Google, Microsoft) when configured | – | – | AUTH-10 (stubbed providers, links to the API start URLs) | AUTH-09 no buttons when not configured; AUTH-11 unconfigured provider refused, `sso_error` shown and removed from the address |
| F1.6 | "Keep me signed in": unticked a browser-session cookie, ticked a cookie for the company sign-in lifetime; also for the SSO buttons | – | – | AUTH-14, AUTH-15 | API tests (`keep-signed-in.test.ts`, `sso.test.ts` SSO-012) |
| F1.7 | Sign out; Back / reload stay signed out | All | – | AUTH-20 | AUTH-20 (Back, reload, `/auth/me` 401) |
| F1.8 | Deep link opened while signed out opens after sign-in | All | – | AUTH-21, TV-05 | NAV-11 unknown address while signed out → sign-in |
| F1.9 | Session ended elsewhere (sign out everywhere / password reset): next request shows "Your session has ended", also after a reload, same page after signing in | All | – | AUTH-22 | PWR-07 (reloads), legacy:sessions "Sign out my other devices…" |
| F1.10 | Expired sign-in message | All | – | AUTH-23 | — |
| F1.11 | Sign out my other devices (confirm) | All | – | legacy:sessions "Sign out my other devices…" | AUTH-24 cancel changes nothing, AUTH-25 server error shown |
| F1.12 | Sign-in lifetime (Parameters → Sign-in) | A | M L E V | PAR-12, legacy:sessions "A super admin sets Sign-in lasts…" | PAR-05 not shown to a manager |
| F1.13 | Corrupted / forged session cookie | – | – | — | RES-09 → signed out, no broken page |
| F1.14 | Right after the sign-in form, a company that hides sample-data notices shows no banner (the sign-in answer carries the setting) | All | — | SIGN-SN-01, API `sample-notice.test.ts` SNH-003 | — |

## 2. Forgot / reset password

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F2.1 | Forgot password → e-mailed link → new password → sign in; link works once; token leaves the address bar, no Referer | – (anyone) | – | legacy:password-reset | PWR-01 bad format, PWR-02 unknown address (same answer, no e-mail), PWR-03 unreachable server, PWR-04 missing / wrong token, PWR-05 expired link (old password still works), PWR-06 weak / mismatched (nothing sent), legacy:password-reset (used link) |
| F2.2 | Reset ends the person's other sessions | – | – | PWR-07 | — |
| F2.3 | Administrator sends a reset link (Users → key button) | A, M, L (people they manage) | E V | PWR-08 | ORG-25 manager cannot act on the super admin |
| F2.4 | Administrator sets a password directly | A, M, L (people they manage) | E V | API tests (`password-reset.test.ts`) | NAV-04 API refusals |

## 3. Registration and invitations

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F3.1 | Create an organisation (registrant becomes its super admin) | – | – | REG-01 | REG-02 required fields, REG-03 names with markup / symbols, REG-04 mismatched / weak passwords (the invitation and reset rules, FI-18), REG-05 e-mail taken (form kept), REG-06 existing organisation name, REG-08 company e-mail domain taken (FI-05) |
| F3.1b | Public e-mail domains (gmail.com, …): every person creates their own organisation, nobody joins by domain | – | – | REG-09 | API tests (`registration.test.ts`), database test CDOM-001 … 004 |
| F3.2 | Back to sign-in from registration | – | – | REG-07 | — |
| F3.3 | Invite a person (link shown when e-mail is not configured) | A, M, L (within their grants) | E V | INV-01, legacy:organisation "Invite by email…" | INV-06 invalid / existing e-mail, INV-09 role options per inviter |
| F3.4 | Accept an invitation (exactly the invited role) | – | – | INV-01 | INV-04 expired, INV-05 wrong / incomplete link, INV-07 names / weak / reused e-mail name / mismatched, INV-08 opened while signed in |
| F3.5 | Resend (old link dies) and revoke an invitation | A, M, L | E V | INV-02, INV-03 | INV-02 old link refused, INV-03 revoked link refused |
| F3.6 | Invitations list (pending, show accepted and revoked) | A, M, L | E V | INV-01 | — |

## 4. Navigation, routes and the app frame

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F4.1 | Navigation entries per role | All | — | NAV-01 (each role, exact list) | NAV-01 (absent entries), OPS-01 (Platform entry) |
| F4.2 | Every allowed page opens from its address | All (per page) | — | NAV-02 (each role), LIVE-03 | — |
| F4.3 | Address of a page of another role → overview with "You don't have access to <page>." (alert, focused, dismissible) | — | per RESTRICTED_PAGES | — | NAV-03 (each role), legacy:*-rbac, legacy:organisation, legacy:metrics-quality |
| F4.4 | The API refuses what the UI hides (403 before the body is checked) | — | E V (and per rule) | — | NAV-04 (empty bodies), NAV-05 (refusal during an action shown), BRIEF-03, PAR-06, DEV-03, PUL-02, ACT-04, ALT-01, ORG-25, ORG-33, ING-03, MM-07, legacy:comprehensive-rbac, legacy:team-lead-rbac "API restrictions" |
| F4.5 | Unknown routes → overview | All | — | NAV-10, LIVE-04 | NAV-10 (markup and unicode in the path) |
| F4.6 | Back / Forward between pages, reload keeps page and `?team=` | All | — | NAV-12, NAV-13 | NAV-14 team outside scope in `?team=` |
| F4.7 | Navigation drawer: Escape, backdrop, focus back to the menu button | All | — | NAV-15 | — |
| F4.8 | Pin the navigation on wide screens (remembered) | All | — | NAV-16 | — |
| F4.9 | Brand button → overview | All | — | NAV-17 | — |
| F4.10 | Appearance menu: theme (Light, Dark, Graphite, Porcelain, Match system) and score display (Battery, Gauge), kept per browser, applied before the first paint; system preference only with Match system | All | — | UX-01, LIVE-04, APR-01, APR-02, APR-03, APR-04, APR-05, A11Y-20…24 | UX-02 |
| F4.11 | Phone layout (390 px) without sideways scrolling | All | — | UX-10, UX-11 (18 pages), UX-12, legacy:platform-operator, legacy:revenue-impact | UX-13 very long unicode names |
| F4.12 | Pending wellbeing-pulse banner (Answer now / Not today) | Members who have not answered | Others | legacy:pulse-reminders | legacy:pulse-reminders ("Not today") |
| F4.13 | Notifications bell (unread count, latest, mark read, acknowledge) | All | — | legacy:alerts-actions "…bell…" | legacy:alerts-actions (engineer cannot acknowledge) |
| F4.14 | Top bar: QE Navigator shield and name, company badge, name with job title (role label when empty) | All | — | HDR-01 (each role), HDR-04 (job title) | HDR-04 (only super admins set job titles) |
| F4.15 | "What you can do here": roles, scope and limits from the access policy; Escape / outside click close it | All | — | HDR-02 (viewer), HDR-03 (super admin) | HDR-02 ("You cannot …" list) |
| F4.16 | Phone top bar: company initials, account menu (name, title, sign out) | All | — | HDR-05 | — |
| F4.17 | TV mode entry in the navigation for every role (for the teams in scope) | All | — | HDR-06, NAV-01 | TV-04 |

## 5. Overview (dashboard)

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F5.1 | Company status (super admins) or "Your team(s)" (everyone else), KPI tiles, team grid of the analytics scope only | All | Teams outside the scope | DASH-01 (each role), legacy:*-rbac (cards = scope teams) | DASH-08 summary unavailable (teams still shown), DASH-09 team list 500 with request id (FI-07, fixed), DASH-10 offline, RES-05 summary never answers |
| F5.2 | QA score "based on n of m" | All | — | legacy:metrics-quality | — |
| F5.3 | Filters All / High performing / Needs attention | All | — | DASH-02 | DASH-02 (empty filter) |
| F5.4 | Search, department filter, sort and direction | All | — | DASH-03, DASH-04 | DASH-03 no match, markup typed in |
| F5.5 | Grid / list and cards per row (remembered) | All | — | DASH-05 | — |
| F5.6 | Teams vs KPI targets breakdown (tabs, open team, Escape) | All | — | DASH-06 | — |
| F5.7 | Open a team from its card, back | All | — | DASH-07, legacy:viewer-rbac | — |
| F5.8 | CSV export of the team list | All | — | legacy:compare-views-onboarding "CSV download…" | — |
| F5.9 | Executive briefing (AI) | A M L | E V | BRIEF-01 (stubbed AI, markup shown as text) | DASH-01 (button absent for E V), BRIEF-02 AI error, BRIEF-03 API refuses E |
| F5.10 | Saved views on the dashboard | All | — | legacy:compare-views-onboarding "Saved view round trip" | VIEW-02, VIEW-04 |
| F5.11 | "Includes sample data" banner | All | — | DASH-11 | DASH-11 (no banner without sample data) |
| F5.12 | Data older than a day: the latest snapshot with "Last updated <date>" (overview, team detail, TV) | All | — | LATEST-01 | — |
| F5.13 | Targets next to every status on cards, hero and gauges; battery colour by value (one scale) | All | — | TDH-05 | — |

## 6. Team detail, TV mode and the executive summary

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F6.1 | Team detail: KPI sections, sources, stale markers | Teams in scope | Other teams (no card; API 403) | TEAM-01 (each role), legacy:team-lead-rbac, legacy:viewer-rbac | TEAM-01 (other team refused), legacy:qa-engineer-rbac (API 403), TEAM-04 failing detail requests |
| F6.1a | QA score card: horizontal 3D battery with liquid (still with reduced motion), target, 30-day change, 30 / 90 day trend, rank, weakest input, people, Scrum Master / Product Owner | Teams in scope | — | TDH-01, TDH-02, TDH-07 (phone) | TDH-04 (reduced motion) |
| F6.1b | Every headline KPI shows status and target ("Watch: 70–80% · Target ≥ 80%") | Teams in scope | — | TDH-03 | — |
| F6.2 | Team members (names, e-mails) | Teams in scope | Others | TEAM-01, legacy:qa-engineer-rbac | TEAM-01 (other team: no members), legacy:qa-engineer-rbac "does NOT see Team Members…" |
| F6.3 | Team AI recommendations / developer recommendations | A, M (dept), L (own) | E V | legacy:team-lead-rbac "Team Detail (own team)" | legacy:qa-engineer-rbac, legacy:viewer-rbac "cannot see AI insights" |
| F6.4 | Formula mode ("Show formulas & data sources") and metric explanation | A | M L E V | TEAM-02 | TEAM-02 (manager has no switch) |
| F6.5 | Open TV mode from the team, Exit back | Teams in scope | — | TV-01 | — |
| F6.6 | E-mail TV link (mailto) and Copy link | Teams in scope | — | TEAM-03 | — |
| F6.7 | TV keys (1–4, arrows, T, R, S, Esc) and kiosk options (`theme`, `rotate`, `interval`, `panels`, `teams`) | Teams in scope | — | TV-02, TV-03, TVW-01 | — |
| F6.8 | TV for a team outside the scope ("Show my team"); the team picker lists the teams in scope only | — | Out of scope | — | TV-04 |
| F6.9 | TV link opened signed out → sign in → TV | Teams in scope | — | TV-05 | — |
| F6.10 | TV errors and lost connection (keeps last data) | — | — | — | TV-06 server error, TV-07 refresh fails |
| F6.11 | TV without a team (own team or "no team") | All | — | TV-08 | TV-08 |
| F6.12 | Tracked actions on TV (no owner names) | Teams in scope | — | legacy:alerts-actions "…TV mode shows it" | — |
| F6.14 | TV rotation between the chosen panels at the chosen interval (progress bar), then between the teams in scope (next team loaded ahead) | Teams in scope | Teams outside the scope in a link | TVW-01, TVW-02 | TVW-03 |
| F6.15 | TV "Set up the screen": interval, panels, teams, theme, rotation; address and copied kiosk link | Teams in scope | Without a panel | TVW-04 | TVW-05 |
| F6.16 | TV Alerts & actions and Wellbeing panels (team aggregates, pulse hidden below 3 responses, no comments) | Teams in scope | — | TVW-06 | API TVP-002 |
| F6.17 | TV themes (Light, Dark, Graphite, Porcelain) with accessibility checks; app theme back on exit | All | — | TVW-07, APR-05, A11Y-34 … 37 | — |
| F6.18 | TV recovers from a lost connection (keeps data, retries every 15 s, back on "online"); idle cursor and controls hidden; 4K layout | — | — | TVW-09, TVW-10 | TVW-08 |
| F6.19 | Executive summary on a phone (390 × 844): scope QA score, risks, most improved, money at risk, alerts, last week; no sideways scroll; tap targets ≥ 44 px | All (scope) | Money at risk for L E V | SUMUI-01, SUMUI-02, SUMUI-10, SUMUI-11, SUMUI-12 | SUMUI-03 |
| F6.20 | Executive summary offline copy, server error, share link; accessibility in four themes | All (scope) | — | SUMUI-04, SUMUI-06, A11Y-30 … 33 | SUMUI-04, SUMUI-05 |
| F6.21 | Forecasts on Team detail: a Forecast line on every KPI tile and the QA score ("Misses target ≥ 80% around …", "On track", "not enough data (reason)"), trend charts with the projected band, target and crossing | Teams in scope | — | IMP-01 | — |
| F6.22 | Recommendations: ranked, top 3 visible, the rest and the decided ones in accordions, evidence (tests, files, stages named), expected effect, next step, confidence; Recalculate; phone layout; four themes | Teams in scope (read); A, M (dept), L (own) act | E V act; other teams (API 403) | IMP-02, IMP-07, IMP-08, A11Y-42 … 45 | IMP-06 |
| F6.23 | Add to Action plan: a tracked action linked to the recommendation and its metric; the action shows the metric before / after with the dates | A, M (dept), L (own) | E V | IMP-03, IMP-04 | IMP-06 (API 403) |
| F6.24 | Dismiss a recommendation with a reason (who, when, why shown); Reopen | A, M (dept), L (own) | E V | IMP-05 | IMP-05 (Other without a reason) |
| F6.25 | Executive summary: "at this rate …" under each risk; KPIs forecast to miss within 8 weeks | All (scope) | — | IMP-09 | — |
| F6.13 | Team AI toggle | A, M, L (own) | E V | legacy:team-lead-rbac "Toggle AI" | legacy:team-lead-rbac |

## 7. Analytics, compare, saved views

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F7.1 | Analytics hub opens each module | All | — | AN-01 | — |
| F7.2 | Scope bar: department / team choice per role (fixed for L E V) | All | — | AN-02 (each role), legacy:team-lead-rbac "Static label" | NAV-14 |
| F7.3 | Each module renders for a team (flaky tests, test execution, technical debt, performance, CI/CD pipeline, developer productivity, wellbeing pulse, business impact, team rankings, reports) | All (teams in scope) | — | AN-03, legacy:super-admin-rbac, legacy:viewer-rbac | AN-06 scope unavailable, AN-07 ×6 module data 500 (timeline: FI-08, fixed), AN-08 / AN-09 developer productivity 500, offline, history (FI-06, fixed) |
| F7.4 | Team choice kept in the address across modules | All | — | AN-04, NAV-13 | — |
| F7.5 | CSV / PDF exports (module CSV, team PDF report) | All | — | AN-05, legacy:compare-views-onboarding | — |
| F7.6 | Technical debt module | All | — | AN-03, AN-05, A11Y-06 | AN-07 |
| F7.7 | Developer productivity: own row only for E V; opted-in rows for A M L; k-anonymous team figures | All | — | DEV-01, legacy:qa-engineer-rbac, legacy:pulse-survey "…below 3 opted-in developers" | AN-08, AN-09 |
| F7.8 | Developer insights opt-in (Users toggle) | A, M, L (people they manage) | E V; others' people | DEV-02 | DEV-03 API refuses a lead for a person not on their team |
| F7.9 | Business impact: money summary, what-if, details, "All teams" roll-up | All; roll-up A M | roll-up: L E V | BIZ-01 (each role), legacy:revenue-impact | BIZ-02 empty / huge / negative what-if, legacy:revenue-impact (roll-up API refuses E) |
| F7.10 | Compare teams (2–4 teams, window, only differences, CSV) | All (scope) | — | CMP-01, legacy:compare-views-onboarding | CMP-02 bad / too many ids and bad window, CMP-03 team outside scope, CMP-04 500, legacy:compare-views-onboarding (engineer scope) |
| F7.10a | Compare: status and target under every value ("Watch: 70–80% · Target ≥ 80%") | All (scope) | — | TDH-06 | — |
| F7.11 | Saved views (create, apply, update, delete) on dashboard, modules and compare | All | — | VIEW-03, legacy round trip | VIEW-02 empty name, markup, double click; VIEW-04 failed save |
| F7.12 | Share a saved view with the company / stop sharing | A | M L E V | VIEW-01 | VIEW-01 (manager: read-only, no share) |

## 8. Administration: manual metrics, targets, parameters

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F8.1 | Manual metrics: team values (only teams one may write) | A, M (dept), L (led) | E V | MM-01 | MM-02 nothing to save / no team, MM-03 coverage above 100 % refused, MM-05 500 / unreachable, MM-06 double click writes once, MM-07 API refuses another team, NAV-03 |
| F8.2 | Manual metrics for an earlier day (not in the future) | A M L | E V | MM-04 | MM-04 (max date) |
| F8.3 | Manual developer metrics, technical-debt impact, pipeline settings / stages, business-impact config | A M L (per section) | E V | API tests (`ingestion.test.ts`, `consistency.test.ts`); page renders in RES-01 | — |
| F8.4 | KPI targets at company / department / team level, with history | A (all levels), M (department, team) | L E V | PAR-01, legacy:metrics-quality | PAR-02 one value only / watch on the wrong side, PAR-03 out of range refused by the API, PAR-05 manager read-only at company level, PAR-06 API refuses |
| F8.5 | Apply to every department and team | A | M (FI-09, fixed) L E V | PAR-04 | PAR-05 (no option for a manager) |
| F8.6 | Configuration values (SLA, financial): company level by super admins only, managers their departments and teams | A (all levels), M (their departments / teams) | M at company level, L E V | PAR-10, API `config-scope.test.ts` | PAR-05 company scope read-only for a manager (API 403, CFG-001), PAR-11 negative value refused (FI-10), PAR-14 above the range refused by the page and the API (FI-10b); API tests (`settings-validation.test.ts`, `config-scope.test.ts`) |
| F8.7 | Expected update frequency (change, discard, save, reset) | A M | L E V | PAR-13 | NAV-03 |
| F8.8 | Ingestion log (sources, entries, filters) | A, M (their departments) | L E V | ING-01, ING-03, legacy:metrics-quality | ING-03 API refuses E, legacy:metrics-quality |

## 9. Onboarding, API keys, ingestion, demo data

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F9.1 | Onboarding checklist ticks steps from the real state | A (new organisation) | M L E V | ONB-01, ING-01 (data step), legacy:compare-views-onboarding | legacy:compare-views-onboarding "not shown to a QA manager" |
| F9.2 | Hide and show the checklist | A | — | ONB-02, legacy:compare-views-onboarding | — |
| F9.3 | API key: create (shown once), revoke (with cancel) | A | M L E V | ING-01 | ING-02 no name, manager has no keys; ING-01 revoked key refused (401) |
| F9.4 | KPIs sent with an API key appear in the Ingestion log (written / rejected with reason) | A (key holder) | — | ING-01 | ING-01 (value out of range rejected) |
| F9.5 | Sample data panel (load, logins) | A | M L E V | DEMO-02 (stubbed: server runs without `ENABLE_SYNTHETIC_DATA`) | DEMO-01 off on this server, DEMO-03 failure shown, DEMO-04 manager has none |
| F9.6 | Connect your CI: steps per CI tool (GitHub Actions, GitLab CI, Jenkins, Azure DevOps) with the endpoint and team id, tab keyboard navigation, test call (wrong key refused, valid key "Connected", nothing stored), last data received after a real JUnit upload, main branch saved | A | M L E V | CI-01 (tests/e2e/team/ci-evidence.spec.ts) | CI-01 wrong key, CI-02 manager has no Connect your CI, CIEV-03 status refused to an engineer |
| F9.7 | Evidence from CI on the team page: calculated metrics, flaky tests with proving runs, lowest-coverage files, slowest tests, failing stages; empty state without CI data | A M L E V (scope) | outside the scope | CIEV-01, CIEV-04 | CIEV-03 another team's evidence refused (403) |
| F9.8 | How this was calculated: from a KPI card and from a calculated metric: formula, values used, runs / confidence, source runs; computed value written as KPI source "computed" | A M L E V (scope) | — | CIEV-02 (with a11y check), CI-01 | — |

## 10. Alerts, notifications, digest, Slack, tracked actions

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F10.1 | Alerts of the scope (Notifications → Alerts, team filter) | All | — | legacy:alerts-actions | — |
| F10.2 | Acknowledge an alert | A, M (dept), L (own team) | E V | legacy:alerts-actions | legacy:alerts-actions (engineer has no button), ALT-01 API refuses E |
| F10.3 | Inbox (mark read, mark all read) | All | — | legacy:alerts-actions "…mark everything read" | — |
| F10.4 | Notification preferences (in-app, e-mail, minimum severity) | All | — | legacy:alerts-actions | DIG-03 nothing to save, failed save shown |
| F10.5 | Weekly digest option and test digest | A M L | E V | DIG-01, DIG-02 | DIG-02, legacy:alerts-actions (engineer has no digest) |
| F10.6 | Alert rules per level (on/off, parameters, inherit) | A (company), M (department, team) | L E V | ALR-01, ALR-02, legacy:alerts-actions | NAV-03 |
| F10.7 | "Evaluate alerts now" | A | M L E V | DIG-01 | PAR-05 (no Slack / evaluate card for a manager) |
| F10.8 | Slack webhook: save (masked), test message, remove | A | M L E V | SLK-01 (local receiver) | SLK-01 non-Slack URL refused, URL never shown again; PAR-05 |
| F10.9 | Tracked actions: create (owner, KPI, due date), edit, done with computed outcome, delete (with cancel) | A, M (dept), L (own team) | E V (create / edit / delete) | ACT-01, APL-01…04 (grouped by status, paging, remembered state), legacy:alerts-actions | ACT-02 title length and markup, ACT-03 double click creates one, ACT-05 failed save, ACT-04 API refuses E |
| F10.10 | Action owner changes the status of their own action only | Owner (any role) | Others | ACT-04 | ACT-04 (no status on others' actions, no edit) |

## 11. Wellbeing pulse

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F11.1 | Answer the survey in the app (once per period) | Members of the team | Non-members | legacy:pulse-survey | legacy:pulse-survey (admin not in team cannot answer), PUL-16 comment length |
| F11.2 | Results with k-anonymity (3 responses), response rate, trend | Teams in scope | — | legacy:pulse-survey, legacy:pulse-sending | legacy:pulse-survey (fewer than 3 responses: no results) |
| F11.3 | Comments visible to A M L only | A M L | E V | legacy:pulse-survey | — |
| F11.4 | Pulse page per role: send panel, cadence, reminders card | per role | per role | PUL-01 (each role) | PUL-01, PUL-02 API refuses sending (V) and cadence (L) |
| F11.5 | Cadence change (from the next period; choosing the current one cancels) | A M | L E V | PUL-10 | legacy:pulse-sending (lead read-only), PUL-02 |
| F11.6 | Send survey to the team | A M L | E V | PUL-17, legacy:pulse-sending | PUL-02 |
| F11.7 | Send reminder to those who have not answered | A M L | E V | PUL-18 (delivery stubbed) | PUL-17 (off when nothing was e-mailed) |
| F11.8 | Answer through the personal e-mailed link (no sign-in) | Link holder | — | legacy:pulse-sending | legacy:pulse-sending (used / wrong link), PUL-14 expired link, PUL-15 double submit records one answer, markup in the comment |
| F11.9 | Reminder / warning / escalation settings | A M L | E V | legacy:pulse-reminders | PUL-11 out of range (reason in the page's words, FI-12) |
| F11.10 | Escalation list of members who have not answered | People the escalation went to | Everyone else | PUL-12 | PUL-13 (manager not told: no list) |
| F11.11 | Pending-pulse banner | see F4.12 | | | |
| F11.12 | Personal links never shown in the app | — | Everyone | PUL-01, PUL-17, legacy:pulse-sending | — |

## 12. Organisation: users, teams, departments, assignments

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F12.1 | Departments: create, rename, delete (with cancel) | A | M L E V | ORG-01 | ORG-01 duplicate name, ORG-02 markup shown as text, NAV-03 |
| F12.2 | Move a team to another department (with the move plan) | A | M L E V | ORG-03 | — |
| F12.3 | Assign / remove department managers and team leads | A | M L E V | API tests (`team-department-move.test.ts`, `role-assignment.test.ts`) | — |
| F12.4 | Teams: create, edit, delete | A, M (their departments) | L E V | ORG-10, ORG-04 (Admin console), legacy:qa-manager-rbac | ORG-11 required fields, long unicode name; legacy:comprehensive-rbac "Team Lead cannot delete other teams" |
| F12.5 | Users: list per scope, search | A, M (dept), L (team) | E V | ORG-20, legacy:team-lead-rbac "Admin Users", legacy:qa-manager-rbac | RES-03 HTML 502, RES-04 offline (FI-04, fixed) |
| F12.6 | Add a user with a password | A, M, L | E V | ORG-20, legacy:super-admin-rbac | ORG-21 e-mail in use, weak password; ORG-22 markup in names |
| F12.7 | Edit a user (name, e-mail; role / department per rules) | A, M | L E V; self: name and e-mail only | ORG-20 | ORG-24 |
| F12.8 | Deactivate / activate a user | A, M, L (people they manage) | E V; self | ORG-20, legacy:team-lead-rbac "Toggle User Status" | ORG-24 not oneself, ORG-25 manager cannot touch the super admin (API 403), NAV-05 |
| F12.9 | Delete (= deactivate) a user (with confirmation) | A, M | L E V | ORG-20 | ORG-24 |
| F12.10 | Role assignments (chips): add, remove after a confirmation in the page | A, M, L (within grants) | E V; own assignments | ORG-23 | ORG-23 (Cancel and Escape keep the assignment) |
| F12.11 | Sign out everywhere for a user (Users → key button) | Whoever may reset the password | — | API tests (`sessions.test.ts`); AUTH-22 covers the effect | — |
| F12.12 | Admin console: organisation structure, create team / user / department | A M | L E V | ORG-04, legacy:qa-manager-rbac "admin panel" | NAV-03 |

## 13. Activity and user activity

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F13.1 | Activity log (filters, details) | A, M (their departments) | L E V | ORG-30, ORG-31, legacy:organisation | ORG-31 no match, legacy:organisation (engineer has no page) |
| F13.2 | Undo a reversible change (once) | A, M (within rules) | L E V | ORG-30 | ORG-30 (no second undo) |
| F13.3 | Activity CSV export | A M | L E V | API tests (`audit.test.ts`) and the shared export button (F5.8) | — |
| F13.4 | User activity: list, filters, request id search, CSV | A | M L E V | ORG-32, legacy:platform-operator "super admins see the user activity…" | ORG-32 unknown request id, ORG-33, legacy:platform-operator (manager refused, API 403) |
| F13.5 | Platform support visits and changes do NOT appear in the company's Activity log | A (reads) | — | OPS-06 | — |

## 14. Platform support (operator)

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F14.1 | Own sign-in at /operator (8-hour session, survives a reload) | P | Every company user | legacy:platform-operator, OPS-02 | legacy:platform-operator (wrong password; a company admin's credentials refused), OPS-01 (A M L E V: no entry, sign-in asked) |
| F14.2 | Overview tabs: overview (status badges, sessions, sign-ins, jobs or "No runs recorded yet", exact table counts), platform sign-ins, error search by request id; no access log tab | P | — | legacy:platform-operator, OPS-03 | OPS-03 unknown request id |
| F14.3 | Open a company (no reason asked), sections | P | — | legacy:platform-operator, OPS-06 | — |
| F14.4 | Repairs run at once; destructive actions wait for the in-page confirmation; errors with request id | P | — | legacy:platform-operator | OPS-04 confirmation tick / Cancel, OPS-05 failed action shows the request id |
| F14.5 | Sign out | P | — | legacy:platform-operator, OPS-02 | — |
| F14.6 | Phone layout | P | — | legacy:platform-operator "works at 390 px…" | — |
| F14.7 | Refresh sample data now (started in the background on Netlify, run directly elsewhere) | P | — | OPS-07 | OPS-05 failed action; API `platform-operator.test.ts` OP-011 (failed start, off) |
| F14.8 | Every module of a company in detail (all developer rows, single pulse answers and who answered, module rows); secrets never shown | P | — | OPS-08 | API `platform-operator.test.ts` OP-007 (no hash, token, webhook or credential) |
| F14.9 | Create a company (first person by password, Super admin by default, or another role: OPC-01b), add a department, a team and a person | P | — | OPC-01, OPC-01b; API `operator-crud.test.ts` OPC-003c | OPC-01 duplicate e-mail refused with the company app's message; API `operator-crud.test.ts` |
| F14.10 | A person's page: sign-in history, sessions with status, Revoke one session | P | — | OPC-02 | API `auth-events-sessions.test.ts` AE-005 (other sessions stay; another company's session 404) |
| F14.11 | Suspend a company: Suspended badge; its people see "access is suspended" at sign-in and on their open session; reactivate | P | — | OPC-03 | API `auth-events-sessions.test.ts` SU-001 (API keys, invitations), SU-002 (jobs skip) |
| F14.12 | Delete a team / a company only with the typed name | P | — | OPC-04 | OPC-04 wrong name keeps the button disabled |
| F14.13 | Last views per team, sessions, access log with CSV, sign-ins filtered | P | — | OPC-05 | — |
| F14.14 | Demo Data: sizes with a live preview, progress, then the shared password (shown once) and one sign-in per role level; Populate metrics fills teams without data and creates nobody | P | Every company user (API 401) | OPD-01; API `demo-data.test.ts` DD-002 … DD-005, DD-007, DD-008 | OPD-01 out-of-range size disables Generate; API `demo-data.test.ts` DD-001 (no token, company session, bad sizes), DD-006 (other companies untouched), DD-009 (background start failed: 502 with the reason) |

## 15. Accessibility

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F15.1 | No serious / critical axe violations on sign-in, forgot password, registration, overview, compare, pulse, technical debt, notifications, users, parameters, activity, team detail, navigation in dark mode; compare, users and team detail in dark mode | — | — | A11Y-01 … A11Y-13 | none accepted (KA11Y-01 … 04 fixed) |

## 16. Resilience (cross-cutting)

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F16.1 | Every page opens without an uncaught error | All | — | RES-01, AN-03, LIVE-03 | — |
| F16.2 | Slow server: loading state, then content | — | — | RES-02 | — |
| F16.3 | Proxy error page (HTML 502) | — | — | — | RES-03 |
| F16.4 | Offline and back online | — | — | — | RES-04, DASH-10 |
| F16.5 | A request that never answers does not block the rest | — | — | — | RES-05 |
| F16.6 | Reload in the middle of a flow sends nothing | — | — | — | RES-06 |
| F16.7 | Back while a dialog is open | — | — | — | RES-07 |
| F16.8 | Rapid clicks through the navigation | — | — | — | RES-08 |
| F16.9 | Markup in user input is shown as text, never run | — | — | — | DASH-03, REG-03, ORG-02, ORG-22, VIEW-02, ACT-02, BRIEF-01, PUL-15 |
| F16.10 | Double submits create one record | — | — | — | AUTH-13, MM-06, ACT-03, VIEW-02, PUL-15 |
| F16.11 | Very long and unicode text | — | — | — | UX-13, ORG-11, ACT-02, PUL-16 |

## 17. Read-only checks for a deployed site

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F17.1 | Sign-in screen and links | – | – | LIVE-01 | — |
| F17.2 | Sign in, overview, open a team | Any account | – | LIVE-02 | — |
| F17.3 | Every navigation page opens | Any account | – | LIVE-03 | — |
| F17.4 | Unknown address, theme, phone width | Any account | – | LIVE-04 | — |

## Not testable in CI and how it is covered instead

| What | Why not | Covered instead |
|---|---|---|
| Real Google / Microsoft single sign-on | Needs real identity provider accounts, consent screens and callbacks to a public URL | AUTH-10 (providers stubbed: buttons and their start URLs), AUTH-11 (unconfigured provider refused, error returned to the form), API tests `tests/api/sso.test.ts` (state, nonce, PKCE, token checks with a fake provider) |
| Real e-mail delivery (Resend / SMTP) | No credentials in CI; nothing may be sent to real addresses | The log mailer writes every e-mail to `MAIL_CAPTURE_FILE`; tests follow the links (PWR-08, legacy:password-reset, legacy:pulse-sending). `tests/api/mailer.test.ts` covers the channels |
| Groq AI (executive briefing, AI summaries) | External paid service | BRIEF-01 / BRIEF-02 stub `POST /api/analytics/company-insights`; rule-based fallbacks render in the modules (AN-03) |
| Slack | External service | SLK-01 uses a local HTTP receiver (`NOTIFY_SLACK_ALLOW_LOCAL=true`, never in production) |
| Scheduled jobs (hourly alert evaluation, automatic pulse sending and reminders, escalation, weekly digest, demo refresh, keep-alive) | Time-driven | Their results are seeded or triggered: PUL-12 seeds an escalation, DIG-01 "Evaluate alerts now" and test digest; API tests `pulse-reminders.test.ts`, `demo-refresh-job.test.ts`, `alerts.test.ts` |
| Pulse reminders with delivered e-mails | Reminders count delivered e-mails; the log mailer delivers none | PUL-17 checks the button is off without delivery; PUL-18 stubs the delivered state and the reminder answer |
| Sample data seeding (`ENABLE_SYNTHETIC_DATA=true`) | Off on test servers by design | DEMO-02 / DEMO-03 stub the status and the seed call |
| Netlify functions (production API) | CI runs the Express server | Both mount the same `server/routes/*`; API tests run against Express |
| `PLATFORM_OPERATOR_ALLOWED_IPS`, the 5-attempt operator lockout and the sign-in rate limit | Would lock the operator for 15 minutes for every later test | `tests/api/platform-operator.test.ts` OP-003b, OP-006, OP-013 |
| Full screen (F key in TV mode), clipboard of other browsers | Headless Chromium has no real full screen | TV-02 covers the other keys; TEAM-03 grants clipboard permission |
| PDF content | Binary output | AN-05 checks the download |
| Docker path of `npm run test:ui:local` | Not available in the container this suite was built in | The `TEST_DATABASE_URL` path is the same code after the database is up; `docker-compose.test.yml` is a plain `postgres:16` |
| The live site | Network policy of the build container | `npm run test:ui:remote` guard logic was checked (refuses without the flag / credentials, refuses `--grep`, `--list` shows only LIVE-*) |

## Found issues

Fixed (each with a test):

| # | Issue | Fix | Test |
|---|---|---|---|
| FI-01 | A wrong password or a taken e-mail showed no message on the sign-in / registration form, and what was typed was lost: the full-page loader replaced (unmounted) the form during the request | `AuthContext.isInitializing` drives the loader only for the first session check | AUTH-03, REG-05 |
| FI-02 | Sign-in / registration showed "Failed to fetch" or a JSON parse error on a network failure or a 5xx | Friendly messages with the request id | AUTH-12 |
| FI-04 | Users, Teams and Departments showed "No users / teams / departments found" when the list request failed | Load error with the request id | RES-03, RES-04 |
| FI-05 | Registering a second organisation with the same e-mail domain failed with a 500 ("Registration failed") on the unique `companies.domain` | 409 with a clear message | REG-08 |
| FI-07 | The overview showed "No teams match" when `GET /api/teams` failed | Load error with the request id | DASH-09, DASH-10 |
| FI-08 | Test execution showed "No test runs in this period" when its request failed | Load error | AN-07 (timeline) |
| FI-09 | Parameters offered "Apply to every department and team" (ticked by default) to managers; the API refuses it, so a manager's company-level save failed | Option shown and sent for super admins only | PAR-05 |
| FI-10 | Configuration values such as a P95 response time of −5 were stored as typed | The page refuses negative and non-numeric values (the API refuses them too: FI-10b) | PAR-11 |
| FI-19 | On a phone the Users toolbar (grid size, Export CSV, Invite, Add with password) was wider than the screen: the page scrolled sideways | The toolbar wraps | UX-11 (Users) |
| FI-11 | The create / edit user and department forms had labels not linked to their fields (unnamed fields for screen readers) | `htmlFor` / `id` | ORG-01, ORG-20 … ORG-23 |
| FI-20 | User activity rows are written in batches; a buffered row for an organisation deleted in the meantime broke the foreign key and lost every other row of the batch (a super admin then saw an empty User activity page) | That row alone is dropped | UAB-001 (database), ORG-32 |
| FI-21 | The local runner kept the server logs and the captured e-mails under `test-results/`, which Playwright empties when a run starts: e-mailed links were lost and PWR-08 failed on a full local run | Logs and e-mails go to `logs/ui-tests/` | PWR-08 |
| FI-03 | "Keep me signed in" was sent with the sign-in but ignored: the sign-in lasted the company's sign-in lifetime either way | Unticked: a browser-session cookie (no `Max-Age` / `Expires`); ticked: a persistent cookie for the company lifetime. The token expires after that lifetime either way and the per-request check still refuses older sessions. The choice is kept in the token, so "Sign out my other devices" and changing your own password keep it; the SSO buttons pass it through the provider round trip (`remember=1` in the signed state). Registration and invitations give a browser-session cookie. Same code for Express and the Netlify function (shared routes) | AUTH-14, AUTH-15; API `keep-signed-in.test.ts` KEEP-01 … 05, `sso.test.ts` SSO-012, `sessions.test.ts` SES-009 |
| FI-05b | One organisation per e-mail domain: a second person with a public domain (gmail.com, outlook.com) could not create an organisation | Product decision: public e-mail domains (`src/lib/emailDomains.ts`) never block a registration and may be shared by many organisations; a company domain still belongs to one organisation (409 with the clear message). Migration `20261124000000_public_email_domains.sql`: column `companies.email_domain_public`, the unique constraint `companies_domain` replaced by the partial unique index `companies_domain_company_unique`. Nothing joins or matches people by domain (invitations and SSO use the exact address); sample developers added to a company with a public domain get a reserved `.invalid` address instead of `@gmail.com` | REG-08, REG-09; API `registration.test.ts` REGAPI-01 … 04; database `companyDomain.test.ts` CDOM-001 … 004 |
| FI-06 | Developer productivity showed "No data recorded" when its requests failed (500) | Load error with the request id (developer metrics and the DDPS snapshot history) | AN-08, AN-09 |
| FI-10b | `POST /api/admin/configs` stored any value for any key | The page's rules, shared (`src/lib/configRules.ts`): SLA and financial values are numbers from 0 to a maximum; other keys need a valid name and short text; one refused value stores nothing. Expected update frequency (`PUT /api/settings/metric-intervals[/:key]`): a whole number from 1 to 100 and a known unit, the bulk save stores nothing when a row is refused | PAR-11, PAR-14; API `settings-validation.test.ts` CFGV-01 … 03 |
| FI-12 | Pulse validation showed API field names ("warningAfterDays must be a whole number from 0 to 30") | The reasons use the page's words for every reminder, escalation, cadence and automatic-sending check, and the survey answer check names the question | PUL-11; API `settings-validation.test.ts` CFGV-04 |
| FI-13 | The developer-insights opt-in button in Users was labelled "Enable / Disable AI Insights" and toasted "AI insights enabled" | "Enable / Disable developer insights" (title, accessible name, `aria-pressed`), toasts "Developer insights enabled / disabled" | DEV-02 |
| FI-14 | A page a role may not open redirected silently to the overview | The overview opens with an alert "You don't have access to <page>." (focused, dismissible, gone with the next page change), the same for every guarded route (`src/App.tsx`, `AccessDeniedNotice`) | NAV-03 (each role) |
| FI-15 | Some admin endpoints validated the body before checking permissions (a viewer posting an empty body to `/api/admin/users` got 400, not 403) | Audit of the mutating routes; a permission gate now runs first in create user, direct password reset, role assignments (add / remove), targets, alert rules, manual and developer metrics and every team-data write (`assertTeamWrite`), tracked action changes and saved-view sharing | NAV-04 (empty bodies, exact 403); API `permission-order.test.ts` PERM-01 … 03 |
| FI-16 | After a session ended elsewhere, the first refused request cleared the cookie; a reload then showed the plain sign-in screen without "Your session has ended" | The reason is kept for the tab (sessionStorage) and shown after a reload; removed by the next successful sign-in and by signing out. A browser that was signed in (cached user, removed only by signing out) but lost its cookie, for example when the refusal answered a request cut off by a reload, shows it too | AUTH-22, PWR-07 (both reload) |
| FI-17 | Removing a role assignment chip took effect on one click, without confirmation | A confirmation dialog in the page (Cancel / Escape keep it; no `window.confirm`) | ORG-23 |
| FI-18 | Registration accepted weaker passwords (8 characters, strength score) than invitations and resets; the API checked 8 characters | Registration uses the shared rules of `src/lib/passwordPolicy.ts` in the form (live checklist) and in the API (10+ characters, three classes, not the e-mail name); test passwords updated | REG-04; API `registration.test.ts` REGAPI-05, `security.test.ts` SEC-006 |
| FI-22 | The live site showed "No data" everywhere once the newest data was over a day old (the nightly sample-data refresh had not run yet): every daily input (test coverage, code quality) was then older than its update interval, so the QA score left it out and the overview ("No KPI snapshots recorded", "Insufficient data"), every team card, team detail, TV mode, compare and team rankings showed no score although the snapshots were there | Once the company's newest value (its data clock) is over a day old, the latest snapshots are read as of the end of that value's day (`latestReference` in `server/lib/kpiEvaluation.ts`), flagged `dataOutdated` with each team's `lastUpdated`; the screens say "Last updated <date>" (`LastUpdatedNote`). Nothing is invented; unchanged while the company's data is current (values older than their interval are still stale, also for a single team that stopped sending) | LATEST-01; API `latest-data.test.ts` LD-001 … 003 |
| FI-23 | On Netlify almost no user activity was recorded (sign-ins, page views and data requests missing; only some polled unread-count requests): the function waited at most 300 ms for the background writes, less than a round trip to the database in another region, and the instance is frozen as soon as the handler resolves; batches were also chained, so a write hanging on a connection dropped while frozen blocked every later batch | The handler awaits this invocation's writes (user activity and server errors) before it returns (cap 2.5 s), each batch is written on its own, writes left over from earlier invocations are not awaited | API `netlify-background-writes.test.ts` NBW-001 … 003 (runs the Netlify handler) |
| FI-24 | The operator's "Re-run demo refresh" ran the whole refresh inside the API function, longer than a Netlify function may run | "Refresh sample data now": on Netlify it starts the background function (signed token, as the nightly scheduler) and reports "started"; elsewhere it runs directly; recorded in `job_runs` | OPS-07; API `platform-operator.test.ts` OP-011 |
| FI-25 | The platform operator was a company user (an e-mail in `PLATFORM_OPERATOR_EMAILS` who re-entered the password): a company account held access to every company | Independent operator accounts (`platform_operators`, migration `20261125000000_platform_operators.sql`), never company users (triggers; register / add / invite refuse their addresses), own sign-in at /operator (8-hour httpOnly cookie, own token audience, lockout, rate limit), `npm run operator:create` | legacy:platform-operator, OPS-01, OPS-02; API `platform-operator.test.ts` OP-001 … 006, OP-013 |
| FI-26 | Support could not see the data a customer reported a problem with (single pulse answers, developer metrics of people who had not opted in, module data) | Full view of customer data; secrets (hashes, tokens, webhook, credentials) still never returned | OPS-08; API OP-007, OP-012 |
| FI-27 | On a database without the demo company the sign-in page still offered demo-account chips, and Load sample data on the hosted site created a separate company with shared, publicly known accounts | Chips only for demo accounts that exist and are active (and never on Netlify unless `DEMO_MODE=true`); on the hosted site Load sample data fills the own company only | AUTH (demo chips) unchanged locally; checked against the wiped database (scripts/reseed) |
| KA11Y-01 … 04 | Colour contrast below WCAG AA: greyed values on Compare (`text-slate-400`, and `opacity-80` on stale cells), role avatars, department line and small labels on Users, stale KPI values on Team detail, navigation group headings and the brand mark in dark mode | Greyed text `text-slate-500` / `dark:text-slate-400` everywhere it was `text-slate-400 dark:text-slate-500`, no opacity on stale cells, avatars on 700 shades, brand mark `dark:bg-brand-600` | A11Y-04, A11Y-08, A11Y-11, A11Y-12 (no known violations left), A11Y-13 (the same pages in dark mode) |

Recorded (larger, or a product decision; tests marked `test.fail` where a behaviour is asserted):

None open. Every issue recorded so far is in the table above.

## Known accessibility issues

axe-core (WCAG 2.1 A/AA), serious or critical. None are accepted: every page in A11Y-01 … A11Y-13 must have
zero serious or critical violations (the `known` lists in `tests/e2e/ux/accessibility.spec.ts` are empty).
The four colour-contrast issues listed here before (KA11Y-01 Compare teams, KA11Y-02 Users, KA11Y-03 Team
detail, KA11Y-04 navigation in dark mode) are fixed; see "Found issues". A new problem that has to be
accepted for a while is listed here and in that page's `known` list (the check fails when it disappears, so
the list stays current).
