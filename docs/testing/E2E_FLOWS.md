# End-to-end user flows and their UI tests

Every user flow of the app, which roles can do it and which must not, and the Playwright tests that
cover the happy path and the negative cases. How to run them: [README.md](README.md).

Roles: **A** super admin (`admin@irongate.com`), **M** manager (`manager@`, department DevOps),
**L** team lead (`lead@`, The Away Team), **E** software engineer (`engineer@`, Mavericks),
**V** viewer (`viewer@`, The Away Team), **P** platform operator (an e-mail in
`PLATFORM_OPERATOR_EMAILS`; `admin@` in tests), **–** signed out. "All" = A M L E V.

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
  forbidden ones redirect there) and `src/components/AuthWrapper.tsx` (public pages `/accept-invite`,
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
| Flows in this inventory (rows F1.1 … F17.4; F11.11 only points at F4.12) | **145** |
| Flows with a happy-path UI test | **126** of the 130 flows that have a happy path (F2.4, F12.3, F13.3 are covered by API tests; F1.6 is a recorded issue with a `test.fail`); the other 15 are negative-only by nature (limits, refusals, failures) |
| Flows with at least one negative UI test | **104** (the rest have no meaningful negative case, e.g. show / hide a password, open a module from the hub) |
| UI tests (Playwright, `chromium` project) | **340** in 38 files: 73 existing (kept, tagged) + 267 new |
| …tagged `@smoke` / `@negative` / `@a11y` / `@readonly` | 40 / 120 / 12 / 4 |
| Other tests (unchanged, passing) | API 354 and database 24 (Jest); the golden baseline is untouched |

## 1. Sign-in and sessions

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F1.1 | Sign in with e-mail and password, see the overview with the role in the navigation | All | – | AUTH-01 (each role), LIVE-02 | AUTH-02 empty fields (nothing sent), AUTH-03 wrong password (message, e-mail kept), AUTH-04 unknown e-mail (same answer), AUTH-05 deactivated account, AUTH-12 500 with request id / unreachable server, AUTH-13 double click signs in once |
| F1.2 | Attempt limit (20 failed sign-ins per address per 15 min) | – | – | — | AUTH-06 "Too many attempts" |
| F1.3 | Show / hide the password | – | – | AUTH-07 | — |
| F1.4 | Demo account chips fill the form (demo mode) | – | – | AUTH-08 | AUTH-10 no chips when demo mode is off (stubbed providers) |
| F1.5 | SSO buttons (Google, Microsoft) when configured | – | – | AUTH-10 (stubbed providers, links to the API start URLs) | AUTH-09 no buttons when not configured; AUTH-11 unconfigured provider refused, `sso_error` shown and removed from the address |
| F1.6 | "Keep me signed in" | – | – | — | AUTH-14 `test.fail` → FI-03 |
| F1.7 | Sign out; Back / reload stay signed out | All | – | AUTH-20 | AUTH-20 (Back, reload, `/auth/me` 401) |
| F1.8 | Deep link opened while signed out opens after sign-in | All | – | AUTH-21, TV-05 | NAV-11 unknown address while signed out → sign-in |
| F1.9 | Session ended elsewhere (sign out everywhere / password reset): next request shows "Your session has ended", same page after signing in | All | – | AUTH-22 | PWR-07, legacy:sessions "Sign out my other devices…" |
| F1.10 | Expired sign-in message | All | – | AUTH-23 | — |
| F1.11 | Sign out my other devices (confirm) | All | – | legacy:sessions "Sign out my other devices…" | AUTH-24 cancel changes nothing, AUTH-25 server error shown |
| F1.12 | Sign-in lifetime (Parameters → Sign-in) | A | M L E V | PAR-12, legacy:sessions "A super admin sets Sign-in lasts…" | PAR-05 not shown to a manager |
| F1.13 | Corrupted / forged session cookie | – | – | — | RES-09 → signed out, no broken page |

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
| F3.1 | Create an organisation (registrant becomes its super admin) | – | – | REG-01 | REG-02 required fields, REG-03 names with markup / symbols, REG-04 mismatched / weak passwords, REG-05 e-mail taken (form kept), REG-06 existing organisation name, REG-08 e-mail domain taken (FI-05, fixed) |
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
| F4.3 | Address of a page of another role → overview (there is no separate access-denied page, FI-14) | — | per RESTRICTED_PAGES | — | NAV-03 (each role), legacy:*-rbac, legacy:organisation, legacy:metrics-quality |
| F4.4 | The API refuses what the UI hides | — | E V (and per rule) | — | NAV-04, NAV-05 (refusal during an action shown), BRIEF-03, PAR-06, DEV-03, PUL-02, ACT-04, ALT-01, ORG-25, ORG-33, ING-03, MM-07, legacy:comprehensive-rbac, legacy:team-lead-rbac "API restrictions" |
| F4.5 | Unknown routes → overview | All | — | NAV-10, LIVE-04 | NAV-10 (markup and unicode in the path) |
| F4.6 | Back / Forward between pages, reload keeps page and `?team=` | All | — | NAV-12, NAV-13 | NAV-14 team outside scope in `?team=` |
| F4.7 | Navigation drawer: Escape, backdrop, focus back to the menu button | All | — | NAV-15 | — |
| F4.8 | Pin the navigation on wide screens (remembered) | All | — | NAV-16 | — |
| F4.9 | Brand button → overview | All | — | NAV-17 | — |
| F4.10 | Dark / light theme (kept per browser, system preference ignored) | All | — | UX-01, LIVE-04 | UX-02 |
| F4.11 | Phone layout (390 px) without sideways scrolling | All | — | UX-10, UX-11 (18 pages), UX-12, legacy:platform-operator, legacy:revenue-impact | UX-13 very long unicode names |
| F4.12 | Pending wellbeing-pulse banner (Answer now / Not today) | Members who have not answered | Others | legacy:pulse-reminders | legacy:pulse-reminders ("Not today") |
| F4.13 | Notifications bell (unread count, latest, mark read, acknowledge) | All | — | legacy:alerts-actions "…bell…" | legacy:alerts-actions (engineer cannot acknowledge) |

## 5. Overview (dashboard)

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F5.1 | Company status, KPI tiles, team grid | All | — | DASH-01 (each role), legacy:*-rbac | DASH-08 summary unavailable (teams still shown), DASH-09 team list 500 with request id (FI-07, fixed), DASH-10 offline, RES-05 summary never answers |
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

## 6. Team detail and TV mode

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F6.1 | Team detail: KPI sections, sources, stale markers | All (any team) | — | TEAM-01 (each role), legacy:team-lead-rbac, legacy:viewer-rbac | TEAM-04 failing detail requests |
| F6.2 | Team members (names, e-mails) | Teams in scope | Others | TEAM-01, legacy:qa-engineer-rbac | TEAM-01 (other team: no members), legacy:qa-engineer-rbac "does NOT see Team Members…" |
| F6.3 | Team AI recommendations / developer recommendations | A, M (dept), L (own) | E V | legacy:team-lead-rbac "Team Detail (own team)" | legacy:qa-engineer-rbac, legacy:viewer-rbac "cannot see AI insights" |
| F6.4 | Formula mode ("Show formulas & data sources") and metric explanation | A | M L E V | TEAM-02 | TEAM-02 (manager has no switch) |
| F6.5 | Open TV mode from the team, Exit back | Teams in scope | — | TV-01 | — |
| F6.6 | E-mail TV link (mailto) and Copy link | Teams in scope | — | TEAM-03 | — |
| F6.7 | TV keys (1–3, arrows, T, R, Esc) and kiosk options (`theme`, `rotate`) | Teams in scope | — | TV-02, TV-03 | — |
| F6.8 | TV for a team outside the scope ("Show my team") | — | Out of scope | — | TV-04 |
| F6.9 | TV link opened signed out → sign in → TV | Teams in scope | — | TV-05 | — |
| F6.10 | TV errors and lost connection (keeps last data) | — | — | — | TV-06 server error, TV-07 refresh fails |
| F6.11 | TV without a team (own team or "no team") | All | — | TV-08 | TV-08 |
| F6.12 | Tracked actions on TV (no owner names) | Teams in scope | — | legacy:alerts-actions "…TV mode shows it" | — |
| F6.13 | Team AI toggle | A, M, L (own) | E V | legacy:team-lead-rbac "Toggle AI" | legacy:team-lead-rbac |

## 7. Analytics, compare, saved views

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F7.1 | Analytics hub opens each module | All | — | AN-01 | — |
| F7.2 | Scope bar: department / team choice per role (fixed for L E V) | All | — | AN-02 (each role), legacy:team-lead-rbac "Static label" | NAV-14 |
| F7.3 | Each module renders for a team (flaky tests, test execution, technical debt, performance, CI/CD pipeline, developer productivity, wellbeing pulse, business impact, team rankings, reports) | All (teams in scope) | — | AN-03, legacy:super-admin-rbac, legacy:viewer-rbac | AN-06 scope unavailable, AN-07 ×6 module data 500 (timeline: FI-08, fixed), AN-08 `test.fail` → FI-06 |
| F7.4 | Team choice kept in the address across modules | All | — | AN-04, NAV-13 | — |
| F7.5 | CSV / PDF exports (module CSV, team PDF report) | All | — | AN-05, legacy:compare-views-onboarding | — |
| F7.6 | Technical debt module | All | — | AN-03, AN-05, A11Y-06 | AN-07 |
| F7.7 | Developer productivity: own row only for E V; opted-in rows for A M L; k-anonymous team figures | All | — | DEV-01, legacy:qa-engineer-rbac, legacy:pulse-survey "…below 3 opted-in developers" | AN-08 (FI-06) |
| F7.8 | Developer insights opt-in (Users toggle) | A, M, L (people they manage) | E V; others' people | DEV-02 | DEV-03 API refuses a lead for a person not on their team |
| F7.9 | Business impact: money summary, what-if, details, "All teams" roll-up | All; roll-up A M | roll-up: L E V | BIZ-01 (each role), legacy:revenue-impact | BIZ-02 empty / huge / negative what-if, legacy:revenue-impact (roll-up API refuses E) |
| F7.10 | Compare teams (2–4 teams, window, only differences, CSV) | All (scope) | — | CMP-01, legacy:compare-views-onboarding | CMP-02 bad / too many ids and bad window, CMP-03 team outside scope, CMP-04 500, legacy:compare-views-onboarding (engineer scope) |
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
| F8.6 | Configuration values (SLA, financial) | A M | L E V | PAR-10 | PAR-11 negative value refused (FI-10) |
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
| F10.9 | Tracked actions: create (owner, KPI, due date), edit, done with computed outcome, delete (with cancel) | A, M (dept), L (own team) | E V (create / edit / delete) | ACT-01, legacy:alerts-actions | ACT-02 title length and markup, ACT-03 double click creates one, ACT-05 failed save, ACT-04 API refuses E |
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
| F11.9 | Reminder / warning / escalation settings | A M L | E V | legacy:pulse-reminders | PUL-11 out of range (reason shown; FI-12) |
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
| F12.10 | Role assignments (chips): add, remove | A, M, L (within grants) | E V; own assignments | ORG-23 | — (no confirmation on removal: FI-17) |
| F12.11 | Sign out everywhere for a user (Users → key button) | Whoever may reset the password | — | API tests (`sessions.test.ts`); AUTH-22 covers the effect | — |
| F12.12 | Admin console: organisation structure, create team / user / department | A M | L E V | ORG-04, legacy:qa-manager-rbac "admin panel" | NAV-03 |

## 13. Activity and user activity

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F13.1 | Activity log (filters, details) | A, M (their departments) | L E V | ORG-30, ORG-31, legacy:organisation | ORG-31 no match, legacy:organisation (engineer has no page) |
| F13.2 | Undo a reversible change (once) | A, M (within rules) | L E V | ORG-30 | ORG-30 (no second undo) |
| F13.3 | Activity CSV export | A M | L E V | API tests (`audit.test.ts`) and the shared export button (F5.8) | — |
| F13.4 | User activity: list, filters, request id search, CSV | A | M L E V | ORG-32, legacy:platform-operator "super admins see the user activity…" | ORG-32 unknown request id, ORG-33, legacy:platform-operator (manager refused, API 403) |
| F13.5 | Platform support entries in the company's Activity log | A (reads) | — | OPS-06 | — |

## 14. Platform support (operator)

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F14.1 | Step up with the password (30-minute session in memory) | P | All other users | legacy:platform-operator | legacy:platform-operator (wrong password), OPS-01 (M L E V: not available), OPS-02 reload asks again |
| F14.2 | Overview tabs: overview, error search by request id, access log | P | — | OPS-03 | OPS-03 unknown request id |
| F14.3 | Open a company with a reason (≥ 3 characters), sections | P | — | legacy:platform-operator, OPS-06 | OPS-04 short reason, Cancel |
| F14.4 | Repair actions (reason + confirmation), errors with request id | P | — | legacy:platform-operator | OPS-05 failed action shows the request id |
| F14.5 | Leave | P | — | legacy:platform-operator | — |
| F14.6 | Phone layout | P | — | legacy:platform-operator "works at 390 px…" | — |

## 15. Accessibility

| ID | Flow | Can | Must not | Happy path | Negative |
|---|---|---|---|---|---|
| F15.1 | No serious / critical axe violations on sign-in, forgot password, registration, overview, compare, pulse, technical debt, notifications, users, parameters, activity, team detail, navigation in dark mode | — | — | A11Y-01 … A11Y-12 | known issues KA11Y-01 … 04 below |

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
| `PLATFORM_OPERATOR_ALLOWED_IPS` and the 5-attempt step-up lock | Would lock the operator for 15 minutes for every later test | `tests/api/platform-operator.test.ts` |
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
| FI-10 | Configuration values such as a P95 response time of −5 were stored as typed | The page refuses negative and non-numeric values (the API still accepts any value: see FI-10b) | PAR-11 |
| FI-19 | On a phone the Users toolbar (grid size, Export CSV, Invite, Add with password) was wider than the screen: the page scrolled sideways | The toolbar wraps | UX-11 (Users) |
| FI-11 | The create / edit user and department forms had labels not linked to their fields (unnamed fields for screen readers) | `htmlFor` / `id` | ORG-01, ORG-20 … ORG-23 |

Recorded (larger, or a product decision; tests marked `test.fail` where a behaviour is asserted):

| # | Issue | Test |
|---|---|---|
| FI-03 | "Keep me signed in" is sent with the sign-in but the server ignores it: the sign-in lasts the company's sign-in lifetime either way. Remove the checkbox or implement it (e.g. a browser-session cookie when unticked) | AUTH-14 (`test.fail`) |
| FI-05b | One organisation per e-mail domain: a second person with a public domain (gmail.com, outlook.com) cannot create an organisation. Product decision | REG-08 documents the message |
| FI-06 | Developer productivity shows "No data recorded" when its requests fail (500), instead of an error | AN-08 (`test.fail`) |
| FI-10b | `POST /api/admin/configs` stores any value for any key (no server-side validation of the numeric settings) | PAR-11 covers the page |
| FI-12 | Pulse reminder validation shows the API field name: "warningAfterDays must be a whole number from 0 to 30" | PUL-11 |
| FI-13 | The developer-insights opt-in button in Users is labelled "Enable / Disable AI Insights" and toasts "AI insights enabled", although it switches developer insights | DEV-02 |
| FI-14 | A page a role may not open redirects silently to the overview; there is no access-denied message | NAV-03 |
| FI-15 | Some admin endpoints validate the body before checking permissions (a viewer posting an empty body to `/api/admin/users` gets 400, not 403) | NAV-04 uses a valid body |
| FI-16 | After a session ends elsewhere, the first refused request clears the cookie; a reload after that shows the plain sign-in screen without "Your session has ended" | PWR-07 / AUTH-22 trigger a request instead of reloading |
| FI-17 | Removing a role assignment chip takes effect on one click, without confirmation (deleting a user or department asks) | ORG-23 |
| FI-18 | Registration accepts weaker passwords (8 characters, strength score) than invitations and resets (10 characters, 3 classes, no e-mail name); the API only checks 8 characters | REG-04 |

## Known accessibility issues

axe-core (WCAG 2.1 A/AA), serious or critical, existing before this suite; the tests list them per page
and fail if a new rule appears or a listed one disappears:

| # | Page | Rule | Elements |
|---|---|---|---|
| KA11Y-01 | Compare teams | color-contrast | Greyed (stale / not judged) values `text-slate-400` |
| KA11Y-02 | Users | color-contrast | Role badges and avatar initials in the user cards |
| KA11Y-03 | Team detail | color-contrast | Stale KPI values (`text-slate-400`, `data-stale`) |
| KA11Y-04 | Navigation, dark mode | color-contrast | Group headings (`dark:text-slate-500`) and the brand mark text |
