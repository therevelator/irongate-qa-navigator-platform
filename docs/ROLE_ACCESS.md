# Who can see and do what (role access)

Derived from the code, not from intentions: [`server/lib/userPolicy.ts`](../server/lib/userPolicy.ts) (every rule),
[`server/lib/alertPolicy.ts`](../server/lib/alertPolicy.ts) (alerts, actions, notifications),
[`src/lib/viewAccess.ts`](../src/lib/viewAccess.ts) (which pages open and which navigation entries show) and the routes
in [`server/routes`](../server/routes). The API enforces every rule below; the UI only hides what the API would refuse.
The **"What you can do here"** button (question mark in the top bar) shows the same rules for the signed-in person,
generated from the same code ([`src/lib/accessSummary.ts`](../src/lib/accessSummary.ts)).

Access comes from **role assignments**: a role on a scope. One person can hold several (for example a viewer of two teams,
or a manager of two departments); their access is the union. Data never crosses companies.

| Role (screen name) | Key | Assigned on |
|---|---|---|
| Platform operator | (table `platform_operators`, not a company role) | the platform |
| Super admin | `super_admin` | the company |
| Manager | `qa_manager` | a department |
| Team lead | `team_lead` | a team |
| Software engineer | `qa_engineer` | a team |
| Viewer | `viewer` | a team |

## In plain English

- **Platform operator** (IronGate platform support). Signs in on a separate panel (`/operator`), never as a company
  user. Sees every company and may read and change everything in it (people, teams, departments, targets, settings,
  API keys, sessions; suspend or delete a company), through the company app's own rules. No reason is asked and nothing
  an operator does is logged (not in the company's Activity log, not anywhere else). Sees no company dashboards through
  the company app.
  Only the operator has **Demo Data** (departments, teams and people with a year of sample data, one shared password
  shown once) and **Populate metrics** (a year of sample data for a company's teams without data) on a company: the
  `/api/operator/companies/:companyId/demo-data`, `…/populate-metrics` and `…/demo-data/jobs/…` routes answer 401 to
  everyone else, company super admins included. The people it creates get ordinary company roles: Manager of their
  department, Team lead (Scrum Master), Software engineer, and Viewer for the Product Owner (a team member, so they
  take the team's pulse; a viewer who is not a team member never gets the pulse survey).
- **Super admin.** Sees every team of the company and everything in it, and may change everything: people and their
  access, departments, teams, KPI targets, parameters, expected update frequency, alert rules, Slack, API keys, session
  length, sample data and job titles. Reads the change history, the ingestion log and the user activity log.
- **Manager.** Sees the teams of the departments they manage (and nothing of other departments): dashboards, trends,
  Compare, TV mode, Analytics, the revenue roll-up of those teams, and individual developer rows of people who opted in.
  Manages those teams and their people (below manager), sets their targets, parameters and alert rules (company-wide
  values stay the super admin's), and reads the change history
  and ingestion log of their departments.
- **Team lead.** Sees the teams they lead or belong to. Writes those teams' data (manual metrics, alerts, tracked actions,
  sending the wellbeing pulse), sees individual rows of people who opted in, and manages software engineers and viewers of
  the teams they lead. Cannot change company settings or targets.
- **Software engineer.** Sees the teams they belong to (read-only), their own individual developer row only, and answers
  the wellbeing pulse of their teams. Can update the status of a tracked action they own.
- **Viewer** (Product Owner, stakeholder, auditor). Sees the teams they are assigned to, read-only, and nothing of other
  teams. A viewer of one team (for example Olivia Grant, Product Owner of Payments Core) sees that team on the overview,
  its team detail, TV mode, Compare (that team only) and the Analytics modules; any other team's page and API answer
  403.

## Scope rule (one rule for every page)

A team is **in scope** for a person when one of their assignments covers it (`canViewTeamAnalytics`):

| Assignment | Teams in scope |
|---|---|
| Super admin (company) | every team of the company |
| Manager (department) | every team of that department |
| Team lead / Software engineer / Viewer (team) | that team |

The overview list (`GET /api/teams`), the overview summary (`GET /api/analytics/company-summary`, which says
`scope.companyWide` false and is computed over the teams in scope for everyone but super admins), team detail
(`GET /api/teams/:id`), KPI history, TV mode (`GET /api/tv/teams` lists the teams in scope for the picker), Compare, the Analytics modules, revenue impact, pulse results, alerts,
tracked actions, saved views (teams outside scope are left out when applied), `/api/metrics/analytics/*`,
`/api/metrics/dashboard` and `/api/departments/:id` all use it. Individual developer rows have a second rule: your own
row always; other people's only for super admins, managers and team leads of the team, and only for people who opted in
to developer insights. Averages of individuals and pulse results are shown only with at least 3 contributors.

The **directory** (names of departments and teams, used to assign people and send invitations: `/api/admin/teams`,
`/api/admin/departments`) is company-visible to people who manage users; it carries no KPIs.

## Matrix

"Scope" = the teams in scope as above. "Own" = the person's own data. "—" = not offered (navigation entry hidden; the
API answers 403; a typed address opens the overview with "You don't have access to …").

### Dashboards and analytics

| Page / module | Super admin | Manager | Team lead | Software engineer | Viewer |
|---|---|---|---|---|---|
| Overview: summary, gauges, team cards | company | scope (department) | scope | scope | scope |
| Team detail (KPIs, targets, trends, QA score card) | any team | scope | scope | scope | scope |
| Team detail: members table | all members, metrics of opted-in people | same, in scope | same, in scope | own row | own row |
| Team detail: team and developer recommendations | scope | scope | scope | — | — |
| Team detail: Evidence from CI, How this was calculated (`GET /api/ci/teams/:id/evidence`, `…/metrics/:metric`) | any team | scope | scope | scope | scope |
| TV mode (`/tv?team=`, team picker, rotation through the teams of the scope; team figures, open alerts, wellbeing pulse with the 3-response minimum) | any team | scope | scope | scope | scope |
| Executive summary (`/summary`, `GET /api/summary`: QA score, risks, most improved, alerts, last week's changes) | company | their departments | their teams | their teams | their teams |
| Executive summary: money at risk (the revenue roll-up of the scope) | company | their departments | — | — | — |
| Compare teams | 2–4 teams of the company | of scope | of scope | of scope | of scope |
| Analytics: Flaky tests, Test execution, Technical debt, Performance, CI/CD pipeline | any team | scope | scope | scope | scope |
| Analytics: Developer productivity | rows of opted-in people | same, in scope | same, in scope | own row, team averages (≥ 3) | own row, team averages (≥ 3) |
| Analytics: Team rankings | teams of the company (by department) | scope | scope | scope | scope |
| Analytics: Reports (PDF) | any team | scope | scope | scope | scope |
| Business impact: Money, What-if, Details | any team | scope | scope | scope | scope |
| Business impact: All teams (revenue roll-up) | company | their departments | — | — | — |
| Business impact: edit business data, correlations | any team | their departments | teams they lead | — | — |
| Executive briefing (AI) | company | scope | scope | — | — |
| "Show formulas & data sources" | yes | — | — | — | — |
| Saved views: use own and shared views | yes | yes | yes | yes | yes |
| Saved views: share with the company / stop sharing | yes | — | — | — | — |

### Wellbeing pulse

| | Super admin | Manager | Team lead | Software engineer | Viewer |
|---|---|---|---|---|---|
| Answer the survey | teams they are assigned to | teams they are assigned to | their teams | their teams | their teams |
| Results (team averages, ≥ 3 answers) | any team | scope | scope | scope | scope |
| Free-text comments (with the aggregate) | any team | scope | scope | — | — |
| Send the survey and reminders | any team | their departments | teams they lead | — | — |
| Cadence and automatic sending | any team | their departments | — | — | — |
| Non-response handling (warnings, reminders, escalation) | any team | their departments | teams they lead | — | — |

### Alerts, actions, notifications

| | Super admin | Manager | Team lead | Software engineer | Viewer |
|---|---|---|---|---|---|
| See alerts (bell, Notifications page) | company (incl. company-level alerts) | scope | scope | scope | scope |
| Acknowledge alerts | any team, company-level | their departments | teams they lead | — | — |
| Alert rules | read, change company / department / team | read; change their departments and teams | — | — | — |
| "Evaluate alerts now", Slack channel | yes | — | — | — | — |
| Tracked actions: see | any team | scope | scope | scope | scope |
| Tracked actions: create, edit, delete | any team | their departments | teams they lead | — | — |
| Tracked actions: change status | yes | yes | yes | actions they own | actions they own |
| Notification preferences, inbox | own | own | own | own | own |
| Weekly digest (e-mail) | company | scope | scope | — | — |

### Administration

| Page / section | Super admin | Manager | Team lead | Software engineer | Viewer |
|---|---|---|---|---|---|
| Users page | everyone | users of their departments | users of the teams they lead | — | — |
| Edit a user's profile and assignments; delete (= deactivate) | anyone but themselves | users ranked below manager in their departments | — | — | — |
| Activate / deactivate, reset password, developer-insights toggle | anyone but themselves | users below manager in their departments | users below team lead in their teams | — | — |
| Give / remove assignments, invitations | any | team lead, software engineer, viewer on teams of their departments | software engineer, viewer on teams they lead | — | — |
| Job titles (users.job_title) | yes | — | — | — | — |
| Teams page | all teams (create, edit, delete) | directory of all teams; create, edit, delete in their departments; QA scores of scope | directory of all teams; QA scores of scope (read-only) | — | — |
| Departments page, move teams, assign managers and leads | yes | — | — | — | — |
| Admin console (organisation structure) | yes | yes (their departments manageable) | — | — | — |
| Admin console: API keys (ingestion), Sample data | yes | — | — | — | — |
| Admin console: Connect your CI (steps, test call, last data received, main branch; `GET /api/ci/status`, `PUT /api/ci/teams/:id/main-branch`) | yes | — (managers have no API keys either) | — | — | — |
| Parameters (financial and pipeline settings) | company, departments, teams; "apply to every department and team" | their departments and teams only (company-level values read-only: the page cannot save them and the API answers 403) | — | — | — |
| KPI targets (with history) | company, department, team | department and team, in their departments | — | — | — |
| Expected update frequency | yes | yes | — | — | — |
| Session settings (how long sign-ins last) | yes | — | — | — | — |
| Manual metrics (team KPIs, developer metrics) | any team | their departments | teams they lead | — | — |
| Ingestion log | company | entries of their departments | — | — | — |
| Activity (change history, undo) | company | entries of their departments | — | — | — |
| User activity log | company | — | — | — | — |
| Onboarding checklist | yes | — | — | — | — |
| Own profile (name, e-mail), sign out other devices | yes | yes | yes | yes | yes |

Nobody may change their own role, department or team, give themselves an assignment, or manage someone of their own
rank or above.

## Navigation

The navigation drawer and the Analytics hub show only the pages the person may open at all
([`src/lib/viewAccess.ts`](../src/lib/viewAccess.ts), unit test `tests/api/view-access.test.ts`):

| Entry | Shown to |
|---|---|
| Overview, Notifications (bell), TV mode (for the teams in scope) | everyone |
| Executive summary | super admins, managers (the address opens for every role with a team in scope, for that scope) |
| Analytics and its modules, Compare teams | everyone with at least one team in scope |
| Users, Teams | super admins, managers, team leads |
| Departments, User activity | super admins |
| Activity, Ingestion log, Admin console, Update frequency, Parameters | super admins, managers |
| Manual metrics | super admins, managers, team leads |

Pages that open with limited data (Developer productivity with only your own row, the Business impact page without the
roll-up tab) stay in the navigation.

## Tests

- API: `tests/api/viewer-scope.test.ts` (a viewer of one team: other teams' detail, history, Analytics, revenue,
  pulse, alerts, actions and Compare answer 403; allowed for someone with that team in scope; the summary and metrics
  reads cover the scope only; the TV picker lists her team only), `tests/api/tv-mode.test.ts`, `tests/api/role-matrix.test.ts`, `tests/api/r2-security-matrix.test.ts`,
  `tests/api/team-read-policy.test.ts`, `tests/api/analytics-scope.test.ts`.
- UI: `tests/e2e/viewer-rbac.spec.ts`, `tests/e2e/navigation/role-navigation.spec.ts` (visible entries per role) and the
  other `*-rbac.spec.ts` suites.
