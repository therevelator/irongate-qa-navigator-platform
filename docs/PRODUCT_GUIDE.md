# IronGate QE Navigator: Product Guide

What the product is, why it exists, every metric it shows (how it is calculated, what "good" means,
where the data comes from today and where it should come from in production), every screen, and how
to run it.

This guide was written from the code, which is the source of truth. Formulas, weights, thresholds and
default targets below are copied from the files they are defined in; the file is named next to each
one so you can check it. Paths are relative to the repository root (links work from `docs/`).

Contents

1. [What it is and the need it addresses](#1-what-it-is-and-the-need-it-addresses)
2. [Organisation and roles](#2-organisation-and-roles)
3. [The metrics](#3-the-metrics)
4. [How data gets in](#4-how-data-gets-in)
5. [Screens and features](#5-screens-and-features)
6. [Privacy and wellbeing](#6-privacy-and-wellbeing)
7. [Alerts, notifications, weekly digest and tracked actions](#7-alerts-notifications-weekly-digest-and-tracked-actions)
8. [Configuration and operations](#8-configuration-and-operations)
9. [Known limitations and what is next](#9-known-limitations-and-what-is-next)
10. [Glossary](#10-glossary)

---

## 1. What it is and the need it addresses

### The problem

QA and engineering leaders in organisations with more than a handful of teams usually face the same
four problems:

1. **No single, trustworthy view of quality across teams.** Coverage lives in SonarQube, defects in
   Jira, build times in Jenkins or GitHub Actions, incidents in PagerDuty. Every team reports in its own
   format, so comparing teams, or answering "is quality getting better or worse across the company?",
   takes a spreadsheet exercise every month.
2. **Numbers that cannot be explained.** Dashboards often show a "quality score" without saying how it
   was made, what it is missing, or whether a blank was silently treated as zero. When a team lead asks
   "why is my score 68?", nobody can answer, and the number loses credibility.
3. **Stale data presented as current.** A coverage figure from six weeks ago looks the same on a
   dashboard as one from this morning. Decisions get made on numbers that are no longer true.
4. **Privacy concerns about developer metrics.** Individual productivity data (focus time, meeting load,
   review speed) is useful for spotting overload, but it is easy to misuse as surveillance, and small-team
   averages can identify individuals.

### What IronGate QE Navigator is

A web application that gives QA and engineering leadership one place to see the quality, delivery and
wellbeing of every team, from a company overview down to a single team, with every number traceable to
its formula, its inputs, its source system and its age.

It collects team KPIs (pushed from CI, issue trackers, code analysis and other tools through an
ingestion API, or entered by hand), stores every value with its provenance, derives daily snapshots,
judges each value against a target that can differ per company, department or team and that keeps its
history, and rolls the results up into team and company scores.

### Who uses it

| Person | Typical questions |
|---|---|
| Head of QA / VP Engineering (super admin) | How healthy is engineering overall? Which teams are off target, and on what? Is it improving? |
| QA manager (one or more departments) | How do the teams in my departments compare? Where should I spend coaching time? |
| Team lead | How is my team doing against its targets? Is anyone overloaded? What should we work on next? |
| QA engineer | How is my team doing? What is my own workload picture? |
| Viewer (stakeholder, product manager) | Read-only view of the team's quality status. |

### Design principles (and where they are enforced)

| Principle | What it means in practice | Where |
|---|---|---|
| No invented numbers | Missing data is shown as "—" or "No data recorded", never as 0 or a guess. Composite scores leave missing inputs out instead of filling them. Sample data is off unless the server is started with `ENABLE_SYNTHETIC_DATA=true`, and any sample value on screen triggers an "Includes sample data" banner. | [`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts), [`server/lib/syntheticData.ts`](../server/lib/syntheticData.ts), [`src/components/SampleDataBanner.tsx`](../src/components/SampleDataBanner.tsx) |
| One definition per metric | Each formula is defined once and imported by both the API and the UI; the explanatory text shown to users is a constant next to the calculation, so the description cannot drift from the maths. | [`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts), [`src/config/metricsConfig.ts`](../src/config/metricsConfig.ts), [`src/data/metricCatalog.ts`](../src/data/metricCatalog.ts) |
| Every number explainable | "Show formulas & data sources" (formula mode) shows, for each metric on Team detail and Manual metrics, why it matters, the formula, thresholds, where it is stored, the source and time of the current value, and the production systems it should come from. Composites say "based on n of m inputs". (Formula mode is currently offered to super admins only, see section 9.) | [`src/data/metricCatalog.ts`](../src/data/metricCatalog.ts), [`src/components/MetricInfoModal.tsx`](../src/components/MetricInfoModal.tsx) |
| Staleness and confidence | Each metric has an expected update interval. A value older than that is stale: shown greyed with "Stale since …" and left out of every composite score. Composites report how many of their inputs they used, with a confidence level. | [`server/lib/staleness.ts`](../server/lib/staleness.ts), `CONFIDENCE_RULE` in [`metricFormulas.ts`](../server/lib/metricFormulas.ts) |
| Targets with history | Targets can be set per company, department or team; each change opens a new validity period. A value is always judged against the target that was valid on the value's date, so changing a target never rewrites history. | [`server/lib/targets.ts`](../server/lib/targets.ts) |
| Privacy by k-anonymity | Any average or count built from individual developers' data, and every survey result, is shown only when at least 3 people contribute; otherwise it says "Not shown: fewer than 3 contributors" and does not reveal the count. Developers can opt out of developer insights. Survey answers are stored without a user id or time. | [`server/lib/privacy.ts`](../server/lib/privacy.ts), [`server/lib/pulse.ts`](../server/lib/pulse.ts) |

---

## 2. Organisation and roles

### Structure

- **Company** (organisation, tenant). Registering creates a new company and makes the registrant its
  super admin. Data never crosses companies: every endpoint is scoped to the caller's company.
- **Department**: a group of teams (for example "Payments", "Platform"). Managed by one or more QA managers.
- **Team**: the unit metrics are recorded for. Has one team lead and any number of members. A team can be
  moved to another department.

Tables: `companies`, `departments`, `teams`, `users`, `team_members`, `role_assignments`
(migrations [`20261020000000_initial_schema.sql`](../supabase/migrations/20261020000000_initial_schema.sql) and
[`20261119000000_org_roles_audit_invitations.sql`](../supabase/migrations/20261119000000_org_roles_audit_invitations.sql)).

### Roles and assignments

Access comes from **role assignments** (table `role_assignments`): a role on a scope. A person can hold
several assignments, for example QA manager of two departments, or QA engineer on two teams. Every access
decision on the server and in the UI goes through the same rules in
[`server/lib/userPolicy.ts`](../server/lib/userPolicy.ts), with assignments loaded per request by
[`server/lib/assignments.ts`](../server/lib/assignments.ts), so a change takes effect on the person's next
request without signing in again. `users.role` (the highest role) and the primary department / team are
kept in step for display only.

| Role | Assigned on | Analytics scope (which teams' analytics, members, TV, compare) | Individual developer rows |
|---|---|---|---|
| `super_admin` | the company | every team of the company | everyone who has not opted out |
| `qa_manager` | a department (one or more) | the teams of those departments | everyone who has not opted out, on those teams |
| `team_lead` | a team (one or more; one lead per team) | those teams | everyone who has not opted out, on those teams |
| `qa_engineer` | a team (one or more) | those teams | own row only |
| `viewer` | a team (one or more) | those teams | own row only |

What each role may do (from `userPolicy.ts`; the navigation in [`src/components/Layout.tsx`](../src/components/Layout.tsx) follows it):

| Capability | super_admin | qa_manager | team_lead | qa_engineer | viewer |
|---|---|---|---|---|---|
| Overview (company dashboard; team KPIs are company-visible) | yes | yes | yes | yes | yes |
| Analytics modules, Compare teams, TV mode | all teams | their departments' teams | their teams | their teams | their teams |
| Team member names and e-mails (`canViewTeamMembers`) | any team | their departments | assigned teams | assigned teams | assigned teams |
| Manage users (activate / deactivate, reset password, developer-insights toggle) | anyone in the company except themselves | users of their departments ranked below QA manager | users of teams they lead ranked below team lead | no | no |
| Edit another user's profile and assignments; delete (= deactivate) | yes | users they manage | no | no | no |
| Grant / revoke assignments and send invitations | any grant | team lead, QA engineer, viewer on teams of their departments | QA engineer, viewer on teams they lead | no | no |
| Create / edit / delete teams | any | in their departments | no | no | no |
| Departments page, API keys, move teams, assign managers and leads | yes | no | no | no | no |
| Team data writes: Manual metrics, AI toggle, pulse cadence (`canWriteTeamData`) | any team | their departments | teams they lead | no | no |
| KPI targets | company, department, team | department and team, in their departments | no | no | no |
| Admin console, Update frequency, Parameters | yes | yes | no | no | no |
| Activity (change history), Ingestion log | whole company | entries of their departments | no | no | no |
| Answer the wellbeing pulse | teams they are assigned to | teams they are assigned to | yes | yes | yes |
| Read pulse comments | yes | yes | yes | no | no |
| Share saved views with the company; onboarding checklist | yes | no | no | no | no |
| Executive briefing (AI) | yes | yes | yes | no | no |
| See alerts and tracked actions | all teams | their departments' teams | their teams | their teams | their teams |
| Acknowledge alerts; create / edit / delete tracked actions | any team (plus company-level alerts) | their departments | teams they lead | no (an action's owner may change its status) | no (same) |
| Alert rules | change company, department, team | read; change department and team rules in their departments | no | no | no |
| Slack channel, "Evaluate alerts now" | yes | no | no | no | no |
| Weekly digest | yes | yes | yes | no | no |

Nobody can change their own role, department or team, grant themselves an assignment or manage someone
of their own rank or above. Editing yourself is limited to name and e-mail.

### Invitations

Users page → **Invite**: e-mail, role and team or department (within the same rules as granting an
assignment). The person opens `APP_URL/accept-invite?token=…`, sets a name and password (10 or more
characters, three of lower case / upper case / digit / symbol, not containing the e-mail name) or uses
SSO, and receives exactly that assignment. Tokens are 256-bit random values stored only as SHA-256
hashes, single use, revocable, and expire after `INVITE_TTL_HOURS` (default 168 hours = 7 days, limited to
1 to 720 hours). **Resend** issues a new link and invalidates the old one. With SMTP configured the
invitation is e-mailed; without it the API returns the link and the dialog shows it to copy. Code:
[`server/lib/invitations.ts`](../server/lib/invitations.ts), [`server/routes/orgAdmin.ts`](../server/routes/orgAdmin.ts).

### Single sign-on (Google, Microsoft)

Off unless configured. The login page asks `GET /api/auth/providers` and shows only configured buttons.
OpenID Connect with state, nonce and PKCE (S256); the ID token's signature, issuer, audience and expiry are
verified. A sign-in is accepted only when it matches an existing **active** user (by linked identity or
verified e-mail) or an **open invitation** for that verified e-mail; nobody else gets an account. Code:
[`server/lib/sso.ts`](../server/lib/sso.ts), [`server/routes/authSso.ts`](../server/routes/authSso.ts).

### Change history (Activity) and undo

Every organisation, role, assignment, team, department, user and settings change is recorded in
`audit_log` with who, when, what (before and after; secrets masked) and which departments it concerns.
Super admins see the whole company, QA managers their departments' entries.

**Undo** exists for assignment and role changes, manager and lead changes, team moves, department renames
and user deactivation. It restores the previous state in one transaction and is itself recorded. It is
refused, with the reason, when a newer change touches the same people / team / department, or when the
state was changed outside the history. QA managers may undo only user and assignment changes inside their
departments (not their own access, not manager or lead changes). Code: [`server/lib/audit.ts`](../server/lib/audit.ts).

### Demo mode

`DEMO_MODE=true` shows demo-account chips on the login page (admin, QA manager, lead, engineer, viewer of
the IronGate demo company). Default: on for local development, off when `NODE_ENV=production` or on
Netlify ([`server/routes/authSso.ts`](../server/routes/authSso.ts), `demoModeEnabled`). Demo mode is
independent of sample data (section 4.7).

---

## 3. The metrics

### 3.1 How to read any metric

- **Direction.** Each metric is either *higher is better* or *lower is better* (sizing accuracy: *closer to
  1.0 is better*; velocity and automation ROI: no direction, shown without a status colour).
- **Two thresholds per metric.** `good` (the target) and `warning` (the watch level). For a higher-is-better
  metric: value ≥ good = **on target** (green), ≥ warning = **watch** (amber), below = **off target**
  (red). For lower-is-better the comparisons are reversed (≤ good, ≤ warning). Defaults live in
  `METRICS_CONFIG` ([`src/config/metricsConfig.ts`](../src/config/metricsConfig.ts)); a company, department
  or team target replaces them (section 3.4).
- **Status band names in code** are `good` / `warning` / `critical`; the UI says on target / watch (or
  needs attention) / off target (or critical).
- **Stale.** A value older than its expected update interval is greyed, labelled "Stale since …", not
  judged against its target and left out of composites ([`server/lib/staleness.ts`](../server/lib/staleness.ts)).
  For a past day, staleness is measured at the end of that UTC day.
- **Confidence.** Every composite returns `{ value, inputsUsed, inputsTotal, confidence }` and the UI shows
  "based on n of m inputs" (or teams, or components). Confidence = inputs used ÷ inputs expected:
  **high** at 90 % or more, **medium** at 50 % or more, otherwise **low** (also low when there is no
  value). Stale and missing inputs are not used. (`CONFIDENCE_RULE`, [`metricFormulas.ts`](../server/lib/metricFormulas.ts).)
- **Provenance.** Each stored KPI value carries its source label (for example `sonarqube`, `jenkins`,
  `manual`, `synthetic`), the time the value is for, and who recorded it. Team detail shows "source · as of
  date".

### 3.2 Team KPIs

These are the 23 columns of `kpi_snapshots` that can be written (the whitelist `KPI_COLUMNS` in
[`server/lib/kpiIngest.ts`](../server/lib/kpiIngest.ts)). All are **measured** values: IronGate stores them
as sent and does not recompute them. The formula column says how the source system should calculate them
(from [`src/data/metricCatalog.ts`](../src/data/metricCatalog.ts)).

**Where they come from today:** the KPI ingestion API (`POST /api/ingest/kpis`, any source label) or Manual
metrics (source `manual`), or generated sample data (source `synthetic`). There are no built-in connectors.
**Where they should come from in production:** the systems in the last column, via a small job or CI step
that reads them and pushes to the ingestion API.

Default targets come from `METRICS_CONFIG` and are identical to the defaults the migration copies into
`target_history` (`default_kpi_targets()` in
[`20261120000000_metric_values_targets_ingestion_log.sql`](../supabase/migrations/20261120000000_metric_values_targets_ingestion_log.sql)).
Expected update intervals come from `DEFAULT_METRIC_INTERVALS` ([`server/lib/metricIntervals.ts`](../server/lib/metricIntervals.ts))
and can be changed per company in **Administration → Update frequency** (a "month" is 30 days).

#### Quality and testing

| Metric (`column`) | Formula (at the source) | Unit, range | Better | Target / watch | Update interval | Production source |
|---|---|---|---|---|---|---|
| Test coverage (`test_coverage`) | lines executed by automated tests ÷ total executable lines × 100 | %, 0–100 | higher | ≥ 80 / ≥ 70 | 1 day | SonarQube / SonarCloud `coverage`; JaCoCo (Java); Istanbul / nyc (JavaScript), via Jenkins or GitHub Actions |
| Test flakiness rate (`test_flakiness_rate`) | flaky test runs ÷ total test runs × 100 (flaky = same test failed and passed on the same commit) | %, 0–100 | lower | ≤ 2 / ≤ 5 | 1 day | JUnit XML across reruns; Jenkins test report API; GitHub Actions re-run attempts |
| Defect density (`defect_density`) | confirmed bugs in the period ÷ (lines of code ÷ 1,000) | defects per KLOC, 0–999.999 | lower | ≤ 0.5 / ≤ 1.0 | 1 week | Jira bug count (JQL) ÷ SonarQube `ncloc` |
| Defect escape rate (`defect_escape_rate`) | bugs found in production ÷ all bugs found × 100 | %, 0–100 | lower | ≤ 5 / ≤ 10 | 1 week | Jira bugs split by environment / "found in" field; optionally Zendesk / ServiceNow tickets linked to Jira |
| Code quality score (`code_quality_score`) | Maintainability rating × 0.40 + Reliability × 0.35 + Security × 0.25, ratings A=100, B=80, C=60, D=40, E=20 (the Manual metrics calculator; an integration may send its own 0–100 score) | 0–100, whole number | higher | ≥ 80 / ≥ 60 | 1 day | SonarQube `sqale_rating`, `reliability_rating`, `security_rating` |
| Test automation coverage (`automation_coverage`) | automated test cases ÷ total test cases × 100 | %, 0–100 | higher | ≥ 70 / ≥ 50 | 1 week | TestRail, Xray (Jira), Zephyr Scale |
| Automation ROI (`automation_roi`) | (time saved − time invested) ÷ time invested × 100 | %, −9,999.99 to 9,999.99 | none (no target) | — | 1 month | TestRail / Xray run times; Jira worklogs / Tempo |

#### Speed and efficiency

| Metric (`column`) | Formula (at the source) | Unit, range | Better | Target / watch | Update interval | Production source |
|---|---|---|---|---|---|---|
| Average build time (`avg_build_time_minutes`) | sum of build durations ÷ number of builds | minutes, whole number | lower | ≤ 10 / ≤ 20 | 1 hour | Jenkins build durations; GitHub Actions run timing; GitLab pipeline duration |
| Test execution time (`test_execution_time_minutes`) | duration of the full automated suite | minutes, whole number | lower | ≤ 15 / ≤ 30 | 1 hour | JUnit `<testsuite time>`; Jenkins test report; GitHub Actions job timing |
| Deployment frequency (`deployment_frequency_per_week`) | successful production deployments ÷ weeks in the period | per week, 0–9,999.99 | higher | ≥ 5 / ≥ 2 | 1 week | GitHub deployments (environment production); Argo CD sync history; Jenkins deploy job |
| Lead time for changes (`lead_time_days`) | average(production deploy time − commit time) over changes deployed | days, 0–99.99 | lower | ≤ 3 / ≤ 7 | 1 day | GitHub / GitLab commit times + deploy time from the pipeline |
| Mean time to recovery (`mttr_hours`) | total time from incident start to recovery ÷ incidents | hours, 0–9,999.99 | lower | ≤ 2 / ≤ 8 | 1 day | PagerDuty, Opsgenie incident timelines; rollback / hotfix deploy times |
| Parallel test efficiency (`parallel_test_efficiency`) | (sequential time ÷ parallel wall-clock time) ÷ workers × 100 | %, 0–100 | higher | ≥ 80 / ≥ 60 | 1 day | GitHub Actions matrix job timings; Jenkins Pipeline stage timings |

#### Agile and process

| Metric (`column`) | Formula (at the source) | Unit, range | Better | Target / watch | Update interval | Production source |
|---|---|---|---|---|---|---|
| Sprint velocity (`sprint_velocity`) | story points of issues Done at sprint close | points, whole number | none (no target; compare only with the team's own history) | — | 2 weeks | Jira Software Agile REST API / velocity chart |
| Sprint commitment rate (`sprint_commitment_rate`) | completed points ÷ points committed at sprint start × 100 (can exceed 100) | %, 0–999.99 | higher | ≥ 90 / ≥ 75 | 2 weeks | Jira sprint report / Agile REST API |
| Sprint carryover (`sprint_carryover`) | points not completed at close ÷ committed points × 100 | %, 0–100 | lower | ≤ 10 / ≤ 20 | 2 weeks | Jira sprint report / Agile REST API |
| First-time pass rate (`first_time_pass_rate`) | stories with 0 QA rejections ÷ stories tested × 100 | %, 0–100 | higher | ≥ 85 / ≥ 70 | 1 day | Jira (status transitions back from QA); optionally test management |
| Blocked time (`blocked_time_hours`) | Σ (unblocked time − blocked time) over the sprint's tickets | hours, whole number | lower | ≤ 4 / ≤ 12 | 1 day | Jira (blocked flag / status history) |
| Task sizing accuracy (`sizing_accuracy`) | actual effort ÷ estimated effort (1.0 = perfect) | ratio, 0–99.99 | closer to 1.0 | within ±0.15 of 1.0 / within ±0.3 (Team detail colours only; no stored target) | 2 weeks | Jira time tracking; Tempo Timesheets |

#### Reliability and stability

| Metric (`column`) | Formula (at the source) | Unit, range | Better | Target / watch | Update interval | Production source |
|---|---|---|---|---|---|---|
| Change failure rate (`change_failure_rate`) | deployments that caused a failure ÷ total deployments × 100 | %, 0–100 | lower | ≤ 5 / ≤ 15 | 1 week | Deployment pipeline (rollbacks, hotfixes); PagerDuty / Opsgenie incidents linked to deploys; optionally Jira |
| Mean time between failures (`mtbf_hours`) | total operational hours ÷ failures | hours, whole number | higher | ≥ 720 / ≥ 168 | 1 week | PagerDuty / Opsgenie; Datadog / Prometheus |
| System availability (`system_availability`) | (total time − downtime) ÷ total time × 100 | %, 3 decimals, up to 100.000 | higher | ≥ 99.9 / ≥ 99 | 1 day | Datadog SLOs; Prometheus; Statuspage / uptime monitors |
| Infrastructure failures (`infrastructure_failures`) | count of test / pipeline failures caused by infrastructure in the period | count per month, whole number | lower | ≤ 1 / ≤ 3 | 1 week | Jenkins / GitHub Actions failure classification; JUnit reports |

#### Why each KPI matters (one line each)

- **Test coverage**: code no test runs can break unnoticed; a low or falling number is an early warning. Input to the QA score (30 %).
- **Flakiness**: each false failure costs investigation and a re-run, and erodes trust in red builds until real failures slip through.
- **Defect density**: normalises bug counts by code size so large and small systems can be compared.
- **Defect escape rate**: the most direct measure of how well testing protects users. Input to the QA score (25 %).
- **Code quality**: maintainability, reliability and security findings in one number; a leading indicator of future defects. Input to the QA score (20 %).
- **Automation coverage**: automated tests run on every change at almost no cost, so more automation means faster releases.
- **Automation ROI**: whether automation investment pays back.
- **Build time / test execution time / parallel efficiency**: how long engineers wait for feedback; usually the cheapest productivity wins.
- **Deployment frequency, lead time, change failure rate, MTTR**: the four DORA delivery metrics (section 3.6). Change failure rate is also a QA score input (25 %).
- **Velocity, commitment, carryover, sizing accuracy**: predictability of delivery; velocity is a planning tool, never a performance score.
- **First-time pass rate**: rework between developer and tester; high means clear acceptance criteria.
- **Blocked time**: pure waste in the flow, usually fixable by management (dependencies, environments, approvals).
- **MTBF, availability, infrastructure failures**: stability of the service and of CI itself.

### 3.3 QA score (team)

The single 0–100 quality number per team, shown as a battery on the dashboard, team cards, Team detail and TV.

```
QA Score = [ Test Coverage × 0.30
           + (100 − Defect Escape Rate) × 0.25
           + (100 − Change Failure Rate) × 0.25
           + Code Quality Score × 0.20 ]
           ÷ (sum of the weights of the inputs that are recorded)
```

- Each term is limited to 0–100. Missing inputs are left out, not counted as 0 or 100; the remaining weights
  are re-normalised by dividing by their sum.
- **No score** when Test Coverage is missing or fewer than 2 of the 4 inputs are recorded.
- Rounded to a whole number.
- **Status:** ≥ 85 good, ≥ 70 warning, otherwise critical (`QA_SCORE_THRESHOLDS = { good: 85, warning: 70 }`).
- **Confidence:** "based on n of 4 inputs". On screens that show current values, stale inputs are treated
  as not recorded (`qaScoreComposite`), so a team whose coverage is stale has no current QA score.
- **Stored** in `kpi_snapshots.qa_score` and `status` by the database trigger `kpi_snapshots_qa_score`
  (function `compute_qa_score`, migration
  [`20261117000000_kpi_integrity_and_ingestion.sql`](../supabase/migrations/20261117000000_kpi_integrity_and_ingestion.sql)),
  with the same rules as `computeQaScore()`. The stored value uses every input the snapshot holds; the
  stale-aware value is computed when shown. The ingestion API rejects `qa_score` and `status`.
- Code: `computeQaScore`, `qaScoreComposite` in [`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts).

Worked example: coverage 82, escape rate 6, change failure rate not recorded, code quality 75.
Weighted sum = 82 × 0.30 + 94 × 0.25 + 75 × 0.20 = 24.6 + 23.5 + 15.0 = 63.1; weights used = 0.75;
score = 63.1 ÷ 0.75 = 84.1 → **84 (warning)**, based on 3 of 4 inputs (confidence medium).

### 3.4 Targets, "Teams vs KPI targets", "Needs attention", "High performing"

**Target history** ([`server/lib/targets.ts`](../server/lib/targets.ts), table `target_history`). A target is a
`good` and a `warning` level for one metric, set at company, department or team scope with a validity period.
Saving a change closes the current row and opens a new one. Lookup order: team, then department, then
company, then the code default (`METRICS_CONFIG`). The direction never changes. Every judgement uses the
target valid at the value's date (the end of its UTC day). The 20 metrics that can have a target are listed
in `TARGET_METRICS` (every KPI above except velocity, automation ROI and sizing accuracy). Set in
**Administration → Parameters → KPI targets** (`GET/PUT /api/targets`); every change is in the Activity history.

**The four headline KPI targets** (`KPI_TARGETS`, defaults): coverage ≥ 80 %, automation ≥ 70 %, flakiness ≤ 2 %,
escape rate ≤ 5 %. These drive the following rules.

**Teams vs KPI targets** (`teamKpiTrack`, Company status on the dashboard). Of the four KPI targets, take those
with a current (recorded, not stale) value, each judged against the target valid at the value's date:

| Bucket | Rule |
|---|---|
| On track | at least 75 % of them met |
| At risk | 50 % to under 75 % met |
| Off track | under 50 % met |
| Not classified | fewer than 2 current values |

The counts and the per-team breakdown both come from `GET /api/analytics/company-summary` (`kpiStatus`,
`kpiStatusTeams`), produced by the same function, so a tab's list always equals its count.

**Needs attention** (`teamAttentionIssues`): QA score below 70 (critical), or any of the four KPIs off its
target. Returns the reasons, for example "Test coverage 72.4% (target ≥80%)". Used by the Company status card
and the dashboard's "Needs attention" filter.

**High performing** (dashboard filter): QA score ≥ 85 and no attention issue (every current headline KPI on target).

### 3.5 Technical debt

**Technical debt score (team, 0–100, lower is better):**

```
Technical Debt Score = MIN(100, Σ severity weight of open items)
  critical = 30, high = 20, medium = 10, low = 5
  items with status resolved or wont_fix are excluded; 0 = no open debt
```

Target ≤ 30, watch ≤ 60 (`METRICS_CONFIG.technicalDebtScore`). Calculated on each request from the team's
`technical_debt` rows (`TECH_DEBT_SEVERITY_WEIGHTS`, `techDebtScoreFromWeight`); it is not stored as a snapshot,
so it has no history line.

**Tech debt health (company, 0–100, higher is better)**, shown in Company status and used in engineering health:

```
Tech debt health = max(0, 100 − min(100, Σ severity weight of open items of active teams ÷ number of active teams))
```

No value when no debt items are tracked. The company summary also reports a resolution rate
(resolved or won't fix ÷ all items × 100). Code: `computeCompanyMetrics` in
[`server/routes/analytics.ts`](../server/routes/analytics.ts).

**Per-item ROI** (Technical debt page, `TECH_DEBT_ROI_FORMULA`):

```
Investment            = effort hours × developer hourly rate
Monthly cost of delay = support tickets/mo × support ticket cost
                      + downtime min/mo × downtime cost per minute
                      + affected users × revenue per user per month × revenue impact % ÷ 100
                      + SLA breaches/mo × SLA breach penalty
Annual savings        = monthly cost of delay × 12
ROI %                 = (annual savings − investment) ÷ investment × 100
Payback months        = investment ÷ monthly cost of delay
```

Cost inputs come from **Parameters → Financial and ROI settings** (team overrides company). Built-in defaults,
labelled as defaults when used: developer hourly rate $75, support ticket cost $25, revenue per user per month
$50, downtime cost per minute $100, SLA breach penalty $1,000. The per-item inputs (tickets, downtime minutes,
affected users, revenue impact, SLA breaches) are edited in **Manual metrics → Technical Debt ROI Impact**.

**Where debt items come from:** today only sample data (there is no ingestion endpoint for debt items).
In production: SonarQube issues / technical-debt measures and Jira issues labelled as debt.

### 3.6 DORA and delivery performance

**DORA level per team** (`getDORALevel` in [`server/routes/metrics.ts`](../server/routes/metrics.ts), identical bands in
`classifyDoraLevel` in `analytics.ts`):

| Level | Deployments / week | Lead time | Change failure rate | MTTR |
|---|---|---|---|---|
| Elite | ≥ 7 | < 1 day | < 5 % | < 1 h |
| High | ≥ 1 | < 7 days | < 10 % | < 24 h |
| Medium | ≥ 0.25 | < 30 days | < 15 % | < 168 h |
| Low | otherwise | | | |
| Unknown | any of the four inputs not recorded (or, on the dashboard, stale) | | | |

All four conditions of a level must hold. A recorded 0 is a real value; only missing is unknown.

**Delivery performance (company, "Delivery (DORA)" on the dashboard):** mean of per-team level scores
(Elite 100, High 80, Medium 60, Low 40), weighted by team size, over teams that can be classified. Confidence
"based on n of m teams". Sources: as the four KPIs in section 3.2.

### 3.7 Pipeline health and bottleneck score

**Pipeline health (company):** successful pipeline runs ÷ (successful + failed) runs in the last 30 days × 100,
for company-level pipelines and active teams; running and cancelled runs are excluded; no value without completed
runs. Production source: Jenkins / GitHub Actions / GitLab run results. Today: `pipeline_runs`, filled only by
sample data.

**Bottleneck score (per pipeline stage, CI/CD pipeline page,** `BOTTLENECK_SCORE_FORMULA`**):**

```
Bottleneck score = min(100, duration factor + failure factor), 1 decimal
duration factor  = min(60, max(0, (z + 2) ÷ 4 × 60)),  z = (stage duration − mean stage duration) ÷ std. dev. of stage durations
failure factor   = (1 − success rate ÷ 100) × 40
```

Population standard deviation; no score when duration or success rate is missing. Bars turn amber above 40 and
red above 70.

### 3.8 Engineering health (company)

```
Engineering health = weighted mean of the components that have data
  Delivery performance (DORA)  0.35
  Pipeline health              0.25
  Tech debt health             0.20
  Wellbeing (survey)           0.20
```

(`ENGINEERING_HEALTH_WEIGHTS` in `analytics.ts`.) A component without data is left out and the remaining
weights are re-normalised; it is never replaced by another signal (in particular, workload balance never stands
in for the survey). Confidence: "based on n of 4 components". Rounded to a whole number.

The dashboard colours the company gauges (engineering health, delivery, tech debt health, pipeline health) green
at ≥ 80 and amber at ≥ 60 (`INDEX_GOOD` / `INDEX_WARN` in [`NewDashboard.tsx`](../src/components/NewDashboard.tsx));
the wellbeing gauge uses the wellbeing bands (≥ 70, ≥ 50).

### 3.9 Company aggregates

The global QA score and the company KPI averages (coverage, escape rate, automation, flakiness) are
(`COMPANY_AGGREGATE_TEXT`, `distributionOf` in [`metricFormulas.ts`](../server/lib/metricFormulas.ts)):

- the **mean of the team values weighted by active team size** (active assigned members; a team with no members
  counts as 1);
- over active teams with a **current** value (stale and missing values left out, never counted as 0);
- reported with the **unweighted mean, median, 25th percentile ("weakest 25 %": the weakest quarter of teams is at
  or below it), minimum and count** (`globalQaScoreDistribution`, `kpiAveragesUnweighted`). Percentiles use linear
  interpolation between closest ranks.

**Trend:** the weighted global QA score now minus the same measure over each team's latest snapshot dated 7–14
days ago (with the inputs stale on that day left out). No trend (not "stable") when that window has no scored
snapshots.

**Risk level:** global QA score ≥ 85 stable, ≥ 70 watch, below at risk; no score = insufficient data.

**Company summary text** is rule-based (no AI): the trend, the number of teams below their coverage target, the
automation average against the company target in force today, and the "as of" date.

### 3.10 Developer metrics: workload balance, burnout risk, DDPS, developer recommendations

**Inputs** (table `developer_metrics`, one current row per developer and team): PR merge time (hours), code review
turnaround (hours), focus time (hours/day), meeting time (hours/day), context switches (per day). Thresholds
(`METRICS_CONFIG`):

| Input | Better | Target / watch |
|---|---|---|
| PR merge time | lower | ≤ 4 h / ≤ 24 h |
| Code review turnaround | lower | ≤ 2 h / ≤ 4 h |
| Focus time | higher | ≥ 5 h/day / ≥ 3 h/day |
| Meeting time | lower | ≤ 2 h/day / ≤ 4 h/day |
| Context switches | lower | ≤ 3/day / ≤ 6/day |

Today: entered in **Manual metrics → Developer Productivity Metrics** (`POST /api/metrics/developer`; super admin,
QA manager, team lead) or sample data. The KPI ingestion API does not accept developer metrics. Production:
GitHub / GitLab (PR opened → merged, review requested → first review), Google Calendar / Microsoft 365 (meeting
hours, free blocks of focus time), issue tracker / IDE activity (context switches).

**Workload balance (derived), 0–100, higher is better, target ≥ 70, watch ≥ 50** (`calculateWorkloadBalance` in
[`src/data/advancedFeatures.ts`](../src/data/advancedFeatures.ts)):

```
40 % × focus ÷ (focus + meetings)
+ 30 % × (10 − context switches) ÷ 10
+ 15 % × (4 − meeting h) ÷ 4
+ 7.5 % × (24 − PR h) ÷ 24
+ 7.5 % × (8 − review h) ÷ 8
each term floored at 0, scaled to 0–100
```

Stored in the column `developer_metrics.happiness_score` for historical reasons. It is a workload signal, **not** a
happiness survey and **not** wellbeing, and not part of engineering health. The company summary reports it
separately as `workloadBalanceIndex`.

**Burnout risk (derived)** (`computeBurnoutRisk`): **high** when focus < 3 h/day, meetings > 5 h/day or context
switches > 10/day; **moderate** when focus < 4 h/day, meetings > 4 h/day or context switches > 7/day; otherwise
**low**; not rated when any of the three inputs is missing. A rule on workload data, not a medical or personal
assessment. Calculated when shown; not stored.

**DDPS, Daily Developer Productivity Score (0–100)** (`computeDdps`):

```
DDPS = clamp(raw, 0, 75) ÷ 75 × 100, rounded to 1 decimal
raw  = Focus + Meetings + Context switches + PR merge + Review + Balance
  Focus            = min(focus hours ÷ 5, 1) × 50
  Meetings         = 0 (≤ 1 h), −3 (≤ 2 h), −6 (≤ 3 h), −10 (> 3 h)
  Context switches = 0 (≤ 2/day), −5 (≤ 4), −10 (≤ 6), −15 (> 6)
  PR merge time    = +10 (< 4 h), +5 (< 8 h), 0 (< 24 h), −5 (< 48 h), −10 (≥ 48 h)
  Review turnaround= +5 (< 2 h), +2 (< 4 h), 0 (< 8 h), −5 (≥ 8 h)
  Balance          = max(0, 100 − 25 × max(0, focus hours + meeting hours − 8)) ÷ 10
```

The maximum raw total is 75, hence the rescale. PR merge and review times are elapsed times, so they are not counted
as hours worked. No score when any input is missing. Bands (`DDPS_BANDS`): Exceptional ≥ 80, High ≥ 60, Moderate
≥ 40, Low below. History (`developer_productivity_snapshots`, 1 day to 6 months) recalculates the score from each
snapshot's inputs. DDPS is meant to show where the environment gets in the way, not to rank individuals.

**Developer recommendations** (`assessDeveloper` in [`server/lib/developerHealth.ts`](../server/lib/developerHealth.ts)):
concerns of weight 2: focus < 3 h/day, meetings > 4 h/day, context switches > 6/day; weight 1: PR merge time > 24 h,
review turnaround > 4 h. Status **at-risk** at total weight ≥ 3, **needs-attention** at ≥ 1, otherwise **healthy**; a
developer with no metric recorded at all is needs-attention. Missing values are "not measured" and never count as good;
praise only when there are no concerns and every input was measured. Workload balance is not counted again. With
`GROQ_API_KEY` set and AI enabled for the team, a language model may write the summary and suggestion text; the status
always comes from the rules.

**Team averages** of all of the above (team DDPS, average inputs, average workload balance, burnout counts) are subject to
the k-anonymity rule (section 6): contributors are active QA engineers and team leads assigned to the team who opted in to
developer insights and have all five inputs recorded ([`server/lib/developerAggregates.ts`](../server/lib/developerAggregates.ts)).

### 3.11 Wellbeing (survey)

The wellbeing signal of the product, from the anonymous **pulse survey** ([`server/lib/pulseRules.ts`](../server/lib/pulseRules.ts)).
Five statements, answered 1 (strongly disagree) to 5 (strongly agree), plus an optional comment of up to 500 characters:

1. My workload over this period was manageable.
2. I had enough uninterrupted time for focused work.
3. I felt supported by my team when I needed help.
4. I usually ended the day with energy left.
5. I feel positive about the coming weeks in this team.

```
Wellbeing (survey), 0–100 = (mean of all answers on the 1–5 scale − 1) ÷ 4 × 100   (rounded to 1 decimal)
```

Over the responses of one **closed** period, shown only with at least 3 responses. Bands: on target ≥ 70, watch ≥ 50,
below low (`WELLBEING_BANDS`). Periods: weekly or every two weeks per team (default every two weeks, counted from Monday
2026-01-05); results show up to 12 closed periods as a trend.

**Company / department value:** each team's latest closed period with at least 3 responses (teams below 3 left out),
weighted by responses. In the API this is `developerWellnessIndex`. It feeds engineering health (20 %).

Source today and in production: only the IronGate pulse survey. There is deliberately no import: answers can only be
given by the people themselves.

### 3.12 Quality analytics: flaky tests, test execution, performance

| Module | What it shows | Calculation notes | Data today | Production source |
|---|---|---|---|---|
| Flaky tests | Up to 50 flaky tests of the team, sorted by stored flakiness score, with failure pattern, recent runs, root cause and suggested fix | Pattern guidance is generic text per stored pattern label; when no root cause is stored the API says "unverified, not derived from error logs" | Sample data only | JUnit results across reruns from Jenkins / GitHub Actions; a flaky-test detector |
| Test execution | Suite runs over time (pass / fail / duration), filters, execution flow | Stored run results | Sample data only | CI test reports (JUnit XML), TestRail runs |
| Performance | Daily p50 / p95 / p99 response time per endpoint, error rate, SLA breaches | An endpoint is in breach when its p95 is above **Parameters → Performance SLA → P95 response time** (default 500 ms) or its error rate above the error-rate threshold (default 1 %) | Sample data only | k6 / JMeter / Gatling results, APM (Datadog, New Relic) |

The team-level flakiness KPI (`test_flakiness_rate`) is separate from the per-test list. When sample generation is on,
it is calculated from pipeline runs: a test-stage run is flaky when it failed on a commit on which the same stage also
passed; rate = flaky failed runs ÷ all test-stage runs in the last 7 days × 100
([`server/jobs/intervalSync.ts`](../server/jobs/intervalSync.ts)).

### 3.13 Business-impact correlations

The Business impact page relates a team's monthly quality metrics to its business KPIs
(`business-impact-v2` endpoints in [`server/routes/analytics.ts`](../server/routes/analytics.ts)):

- **Quality metrics** (`BI_QUALITY_FIELDS`): test coverage, defect density, defect escape rate, MTTR, deployment frequency,
  lead time, code quality score, change failure rate.
- **Business KPIs** (`BI_KPI_FIELDS`): monthly revenue, active users, churn rate, feature adoption rate, NPS, CSAT, support
  ticket volume.
- **Method** (`CORRELATION_METHOD`): Pearson r for each quality × business pair over the months where both exist; two-sided
  Student t-test (df = n − 2, exact); Benjamini–Hochberg false-discovery-rate correction across all pairs tested for the
  team; **significant when q < 0.05**. Needs at least 6 months of each series and 6 paired months; pairs with zero variance
  are skipped. Strength label: |r| ≥ 0.7 strong, ≥ 0.5 moderate, ≥ 0.3 weak, else none.
- **Caveat shown with the results:** correlation does not show causation; monthly series that share a trend can correlate
  without any causal link. Results are exploratory.
- **Data today:** entered by hand on the page (monthly quality metrics, business KPIs, optional context) or sample data
  (`data_source = 'synthetic'`). Production: quality from the KPI history; business KPIs from finance / BI (revenue), product
  analytics (Amplitude, Mixpanel: active users, adoption), CRM / billing (churn), survey tools (NPS, CSAT), Zendesk /
  ServiceNow (ticket volume).
- An optional **AI summary** (needs `GROQ_API_KEY`) describes the stored correlations; it is labelled as model output.

### 3.14 Team rankings

Active teams of the selected team's department ranked by a chosen column (default the latest QA score; also the KPI
columns), with competition ranking (equal values share a rank) and teams without a value listed last without a rank. No
points, badges or achievements are invented ([`src/components/TeamGamification.tsx`](../src/components/TeamGamification.tsx)).

---

## 4. How data gets in

### 4.1 The one write path

Manual entry (`POST /api/metrics/manual`), machine ingestion (`POST /api/ingest/kpis`) and the sample-data generators all call
`recordKpiValues()` in [`server/lib/kpiIngest.ts`](../server/lib/kpiIngest.ts), so they validate, store and derive identically:

1. Validate each column against `KPI_COLUMNS` (unknown column, non-number or out-of-range value = error; integer columns are
   rounded). `null` / empty means "not provided" and never clears a stored value. `qa_score` and `status` are refused.
2. Store each value in **`metric_values`**: team, metric, value, `recorded_at` (the time the value is *for*), `received_at`,
   source, actor, idempotency key, source reference, ingestion log id. A second value for the same team, metric and
   `recorded_at` is a correction: the earlier one is marked superseded.
3. Re-derive **`kpi_snapshots`** (database function `refresh_kpi_snapshots`): a snapshot day holds, for each metric, the latest
   non-superseded value recorded before the end of that UTC day. A backdated value updates its day and the later days on which
   no newer value exists; a day without a snapshot gets one.
4. The database trigger computes the QA score and status of each affected snapshot.
5. Open dashboards are told to refresh (WebSocket event; not available on Netlify).

**Provenance and carry-forward.** Each snapshot field has `field_sources.<column> = { source, recorded_at, recorded_by,
carried_forward }`. `carried_forward` is true when the value shown on a day was recorded on an earlier day. Carry-forward is
what lets a partial update (say, only coverage) leave the other metrics in place; staleness (section 3.1) is what stops an old
carried-forward value from being treated as current.

### 4.2 KPI ingestion API

`POST /api/ingest/kpis` ([`server/routes/ingest.ts`](../server/routes/ingest.ts)).

- **Authentication:** `Authorization: Bearer igk_…`. A super admin creates keys in **Admin console → API keys**. The key is shown
  once; only its SHA-256 hash is stored. A key belongs to one company and can write any team in it. Revoked or unknown key: 401;
  team of another company: 403.
- **Body:** `{ "teamId", "source", "recordedAt"?, "metrics": { column: number }, "idempotencyKey"?, "sourceRef"? }`, or an array of
  up to 100 such items.
  - `source`: 1–50 characters (lower-case letters, digits, `_`, `-`, `.`), for example `jenkins`, `jira`, `sonarqube`. `manual` is
    reserved for the app.
  - `recordedAt`: ISO 8601 time the values are for; default now; at most 5 minutes in the future; up to 365 days back (backfill).
  - `idempotencyKey` (per item, 1–200 characters): an item already written with this key for the team is skipped and reported as
    `duplicate`.
  - `sourceRef`: free text up to 500 characters (build id, URL).
- **All or nothing by default:** the whole batch is validated first and written in one transaction; any invalid item gives 400 and
  nothing is written. With `?partial=true` the valid items are written and the others reported per item (207, `status: "partial"`).
- **`Idempotency-Key` header:** a retried request with the same key (same API key, same body) returns the stored result with
  `Idempotent-Replayed: true` and writes nothing; the same key with a different body gets 422; concurrent duplicates wait for the
  first and replay it; a rejected request does not bind its key.
- **Rate limit:** 60 requests per minute per key.

Example (values are placeholders):

```bash
curl -X POST "https://<host>/api/ingest/kpis?partial=true" \
  -H "Authorization: Bearer $IRONGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sonar-build-4812" \
  -d '{
        "teamId": "<team id>",
        "source": "sonarqube",
        "recordedAt": "2026-11-17T08:00:00Z",
        "sourceRef": "build 4812",
        "metrics": { "code_quality_score": 82, "test_coverage": 78.4 }
      }'
```

The response gives the snapshot day, the resulting QA score and status, which metrics were updated, which were carried forward,
and whether the item was a duplicate.

### 4.3 Manual metrics

**Administration → Manual metrics** (super admin, QA manager, team lead; team scope enforced by the server). Sections: current
metrics, team KPIs by category (with calculators such as the code-quality rating calculator), developer productivity metrics per
member, technical-debt ROI impact per item, and CI/CD pipeline stages. Team KPIs go through the same path as the API with source
`manual`, can be backdated with a "recorded at" time, and appear in the ingestion log.

### 4.4 Ingestion log

Every request (accepted, partial or rejected; API and Manual metrics) is recorded in `ingestion_log` with its items, errors and
response: **Administration → Ingestion log** (super admins; QA managers see requests that touched their departments' teams), with a
per-source "last received" overview. This is where you check whether CI integrations are still sending. Code:
[`server/lib/ingestionLog.ts`](../server/lib/ingestionLog.ts).

### 4.5 Expected update frequency and staleness

**Administration → Update frequency** sets, per company, how often each metric is expected to receive a value (defaults in section
3.2). It schedules nothing; it only decides when a value becomes stale.

### 4.6 Configuration inheritance

Settings in the `configs` table (Performance SLA, financial settings and others) resolve team, then department, then company
([`server/lib/configResolver.ts`](../server/lib/configResolver.ts)). Keys that look like credentials are never returned to the browser.

### 4.7 Sample (synthetic) data and the banner

- `npm run seed:demo` creates a fictional company, **Northwind Payments (Sample data)**: 4 departments, 10 teams, 57 users in all
  roles, about 120 days of daily KPI history, developer productivity, pipeline runs, test cases and executions, flaky tests,
  performance, technical debt, 12 months of business-impact data, pulse answers, saved views, target history and ingestion log
  entries, plus sample alerts, notifications, preferences, alert rules and tracked actions. `--fill-existing` fills real companies' teams where a module would otherwise be empty, `seed:demo:clear` removes every demo
  row, `seed:demo:check` reports coverage. See the README for all options.
- Sample KPI values carry source `synthetic`. **"Includes sample data"** appears (dismissible for the session) whenever a value on the
  screen comes from that source, never based on the company name; in formula mode such values carry a "Sample" marker.
- The background generators (KPI sync, pipeline seeder, daily analytics drift) only run with `ENABLE_SYNTHETIC_DATA=true`, and skip the
  demo company. A super admin can also load sample data in **Admin console → Sample data** when that flag is on.

---

## 5. Screens and features

### Overview (dashboard)

Why: the one-page answer to "how is quality across the company, and which teams need help?"
([`src/components/NewDashboard.tsx`](../src/components/NewDashboard.tsx)).

- **Company status**: the **Global QA score** battery (team-size-weighted, with risk badge, trend vs 7–14 days ago, "based on n of m
  teams", and the distribution: unweighted mean, median, weakest 25 %, minimum), the rule-based summary sentence, "data as of" and the
  oldest team snapshot date.
- **Executive gauges** (battery indicators): Engineering health, Delivery (DORA), Wellbeing (survey), Tech debt health, Pipeline
  health, each with its basis ("Excludes … (no data)", "n teams with all 4 DORA inputs", "n of m teams · k responses", "n open of m
  items", "n of m runs passed, 30 days").
- **Company averages** of coverage, automation, flakiness and escape rate against the company targets in force today.
- **Teams vs KPI targets**: the on track / at risk / off track counts; clicking opens a breakdown per team (QA score, as-of date, the
  targets not met with their gap, the ones met, and "based on n of 4 inputs") ([`KpiStatusModal.tsx`](../src/components/KpiStatusModal.tsx)).
- **Team performance**: the latest snapshot of every team as cards or a list. Filters All / High performing / Needs attention, search,
  department, sort (QA score, name, department, coverage, automation, flakiness, escape rate, deploys per week), **Grid / List** and
  **cards per row 1, 2 or 3** (remembered in the browser; phones always 1 column, tablets at most 2). Card colour is the QA status;
  grey means no data.
- **Views** (saved views), **CSV export** of the team list, the **onboarding checklist** (super admins of a new organisation) and the
  **Executive briefing** button.

### Notifications (bell and page)

Why: problems should reach the people who can act, without them watching the dashboard. The **bell** in the top bar shows the unread
count and latest items (mark read, acknowledge); the **Notifications** page has three tabs: alerts of your scope, your inbox and your
preferences (section 7).

### Team detail

Why: everything about one team in one place, with each number explained
([`src/components/TeamDetailView.tsx`](../src/components/TeamDetailView.tsx)).

- Header tiles: QA score (with confidence), technical debt score, task sizing accuracy and key KPIs.
- KPI sections Quality & testing, Speed & efficiency, Agile & process, Reliability & stability: each KPI with value, target valid at
  its date, status, "source · as of date", stale marker and history chart.
- Wellbeing (survey) result and a link to the pulse survey; Team members with their latest workload metrics (only for people who may see
  the team's people, and without metrics for those who opted out); Team recommendations (rule-based or AI); Developer recommendations.
- **Action plan**: the team's tracked actions with owner, due date, status, linked KPI, baseline and computed outcome; **Create action**
  from a recommendation (section 7).
- **Open TV mode** and, for super admins, the **Show formulas & data sources** switch (formula mode) that opens the metric explanation
  for any value.
- Team KPIs are company-visible; member names and e-mails only within the team's analytics scope.

### Team TV mode

Why: a wall or meeting-room screen that keeps one team's quality visible without anyone logging in each time (`/tv?team=<id>`,
[`TeamTvView.tsx`](../src/components/TeamTvView.tsx), `GET /api/tv/teams/:id`).

- Team name, department, lead, member count; QA score battery with status and change since the previous snapshot; six key KPIs (test
  coverage, automation coverage, test flakiness, defect escape rate, change failure rate, deployments) with value, target, status,
  change and a 90-day sparkline; "data as of" and a clock.
- Two more panels: 90-day trends with the target line of each day, and focus areas (KPIs off target, the team's tracked actions without
  owner names, plus recommended actions for team leads and above).
- Team aggregates only: no member list, no individual data. Refreshes every 60 s, on the live "metrics updated" event and when the tab
  becomes visible; a failed refresh keeps the last data and says so.
- Keys: F full screen, T light/dark, R auto-rotate every 20 s, arrows or 1–3 to switch panels, Esc exit. Kiosk URL options
  `?team=<id>&theme=light|dark&rotate=1`. Scales from 1366×768 to 3840×2160.

### Compare teams

Why: side-by-side evidence for coaching and resourcing decisions (`/compare`, [`server/lib/compare.ts`](../server/lib/compare.ts)).

- Two to four teams of your analytics scope; window 7 to 90 days (default 30).
- Per metric (QA score, technical debt score and every KPI with a target): latest value, target valid at its date, status, change over the
  window with a sparkline, stale values greyed (not judged, not compared), sample-data markers; QA score with "based on n of 4 inputs".
- Best value marked per row. A row is **highlighted** when the teams are in different status bands, or the gap between the best and worst
  current value is at least 10 % of the target; "Only rows that differ" filters to those.
- Selection lives in the URL (`?teams=…&days=…&diff=1`); server-built CSV (`GET /api/compare/teams.csv`).

### Saved views

Why: leaders return to the same slices every week. A saved view stores choices, never data: dashboard filter, search, department, sort,
layout and cards per row; an analytics module's department and team; compared teams, window and "only differences". Per user; a super
admin can share views with the whole company (read-only for others) and stop sharing any shared view. Teams outside the viewer's scope are
left out when a view is applied ([`server/lib/savedViews.ts`](../server/lib/savedViews.ts)).

### CSV export

On the dashboard team list, Compare teams, Users, Teams, Departments, Activity, Ingestion log and the analytics modules. Values exactly as
shown plus a "(raw)" column with the unrounded number; filters and sort as on screen; UTF-8 with BOM; cells that could be read as
spreadsheet formulas are neutralised. Exports contain only what the screen received (same scope and privacy rules), never developer e-mail
addresses ([`src/lib/csv.ts`](../src/lib/csv.ts)).

### Onboarding checklist

Why: a new organisation should reach its first useful dashboard quickly. Shown to super admins while any step is open: create departments,
add teams, invite people (someone besides the administrators, or an open / accepted invitation), set KPI targets (a target set by a person;
built-in defaults do not count), send the first data (an accepted ingestion request or a non-sample stored value). Progress is computed from
the real state on each load; the card can be hidden and shown again ([`server/lib/onboarding.ts`](../server/lib/onboarding.ts)).

### Analytics modules

All roles can open them, each for the teams in their analytics scope, chosen in the **Analytics scope bar** (department and team; with
**Open TV mode** and saved views).

| Module | What it shows | Why it exists |
|---|---|---|
| Flaky tests | Flaky tests with pattern, recent runs, root cause and fix (section 3.12) | Flakiness wastes time and hides real failures |
| Test execution | Suite run history, execution flow | See whether test runs are getting slower or less stable |
| Technical debt | Debt items with severity, status, effort, cost of delay, ROI, payback; effort-vs-cost chart (section 3.5) | Make the business case for paying debt down |
| Performance | Response times per endpoint, SLA breaches (section 3.12) | Catch performance regressions before customers do |
| CI/CD pipeline | Stage flow, average duration and success rate per stage, bottleneck score, stage executions over 14 days (section 3.7) | Find the stage that slows delivery |
| Developer productivity | Team tiles (k-anonymous), DDPS by developer, recorded DDPS snapshots, developer list and recommendations (section 3.10) | Spot overload and slow review loops; fix the environment, not the person |
| Wellbeing pulse | The survey and its results (sections 3.11 and 6) | Ask the team directly how it is doing |
| Business impact | Monthly quality and business series, correlation matrix, strongest correlations, AI summary (section 3.13) | Connect quality work to business outcomes, with honest statistics |
| Team rankings | Department teams ranked by a chosen KPI (section 3.14) | Friendly comparison inside a department |
| Reports | A PDF report for the selected team: QA score with confidence and 14 KPIs (coverage, automation, escape rate, defect density, change failure rate, flakiness, code quality, deployments, lead time, MTTR, build time, first-time pass rate, commitment rate, availability) | A shareable snapshot for reviews and steering meetings |

### Developer productivity and individual data

QA engineers and viewers see only their own row. Team leads, QA managers and super admins see the rows of developers in their scope who have
not opted out. Team tiles come from the k-anonymous team summary. Only your own row is exported when you may not see others.

### Administration

| Page | Who | What |
|---|---|---|
| Admin console | super admin, QA manager | Organisation structure, team members, create users / teams; **API keys** and **Sample data** (super admin) |
| Manual metrics | super admin, QA manager, team lead | Section 4.3 |
| Update frequency | super admin, QA manager | Expected interval per metric (staleness) |
| Parameters | super admin, QA manager | **KPI targets** (with history), **Alert rules**, **Notification channels** (Slack, test digest, evaluate now; super admin), **Performance SLA** (p95 response time, error-rate threshold), **Financial and ROI settings**; each field says which page reads it |
| Ingestion log | super admin, QA manager (their departments) | Section 4.4 |
| Activity | super admin, QA manager (their departments) | Change history with filters and undo (section 2) |
| Users, Teams, Departments | see section 2 | Assignments (chips), invitations, team lead / manager changes, team moves |

### Executive AI briefing

**Executive briefing** on the dashboard (super admin, QA manager, team lead): a side panel with a short executive summary (biggest risk,
biggest win) and three recommendations, written by a language model (Groq) from the same numbers as the company summary and the company
snapshots of the last 30 days. It is told that "no data" means not measured. Requires `GROQ_API_KEY`; without it the panel says so. Opening
it also stores today's company snapshot in `company_kpi_snapshots`. Team recommendations and the business-impact summary use the same AI
service when enabled; their rule-based fallbacks always work.

---

## 6. Privacy and wellbeing

### The k-anonymity rule

Defined once in [`server/lib/privacy.ts`](../server/lib/privacy.ts):

> An aggregate of individual data is shown only when at least **3** people contribute. Otherwise the API returns no value (null) with
> `privacy: { suppressed: true, contributors: null, reason: "Not shown: fewer than 3 contributors" }` and does not reveal how many people
> there were. Zero contributors is plain "no data".

**Who contributes** to developer aggregates: active QA engineers and team leads assigned to the team, who opted in to developer insights
(`users.developer_insights_enabled`) and have all five inputs recorded. Someone who opted out is left out of every aggregate, including the
ones they can see themselves.

**Where it applies:**

- Team summary of `GET /api/analytics/developer-metrics` (team averages, DDPS, workload balance, burnout counts; the Developer productivity
  tiles).
- `GET /api/analytics/ddps-history`: team statistics and every daily point (a day with fewer developers is not shown).
- `GET /api/metrics/team/:teamId/all`: developer averages, workload balance, team burnout risk.
- The status counts of `GET /api/teams/:id/developer-ai-suggestions`.
- The company summary: workload balance and burnout of the averages use only teams that reach 3 themselves, so a suppressed team can never be
  worked out by subtracting visible teams from the total.
- Pulse survey results and comments (at least 3 responses per period).

Individual rows follow the role rules of section 2 (own row for QA engineers and viewers; leads, managers and admins see people who opted in).

### Survey anonymity design

- Answers are stored in `pulse_responses` **without user id or time**, only team and period.
- Who answered which period is stored separately in `pulse_participation`, only to refuse a second answer (409). It cannot be matched to an
  answer: each new answer rewrites the period's whole answer set in random order with fresh ids in one transaction, so ids, row order and
  transaction ids reveal nothing. No audit entry is written for an answer.
- Results: only **closed** periods (never the running one, so results never move after one person answers), only aggregates, only with at
  least 3 responses. Comments follow the same rule, are sorted alphabetically, and are shown to leads, managers and admins only. Members see
  their team's averages.
- Cadence (weekly or every two weeks) is set by the team lead, the department's QA managers and super admins, effective from the next period
  (recorded in Activity).
- Tables have row level security switched on with no policies (migration
  [`20261121200000_privacy_pulse_survey.sql`](../supabase/migrations/20261121200000_privacy_pulse_survey.sql)), so they are reachable only
  through the API.

### Residual risks (by design, documented)

- With k = 3, a person who answered a 3-response period knows their own answers and therefore the sum of the other two.
- Database superusers could read dead row versions before vacuum; the API never exposes rows.
- Developer metrics individual rows are visible to leads, managers and admins for people who have not opted out; opting out is per person
  (users page toggle).

---

## 7. Alerts, notifications, weekly digest and tracked actions

Code: [`server/lib/alerts.ts`](../server/lib/alerts.ts), [`alertPolicy.ts`](../server/lib/alertPolicy.ts),
[`notifications.ts`](../server/lib/notifications.ts), [`digest.ts`](../server/lib/digest.ts), [`actions.ts`](../server/lib/actions.ts),
[`server/jobs/alertsCron.ts`](../server/jobs/alertsCron.ts), `netlify/functions/`. Migration:
[`20261121000000_alerts_digest_actions.sql`](../supabase/migrations/20261121000000_alerts_digest_actions.sql) (new tables `alert_rules`, `alerts`,
`notifications`, `notification_preferences`, `company_notification_settings`, `notification_deliveries`, `team_actions`; nothing existing is
changed).

**Why:** a dashboard only helps when someone looks at it. Alerts and the digest bring problems to the right people, and tracked actions close
the loop by checking, from stored data, whether an action actually moved the metric.

### Alert rules

Set in **Administration → Parameters → Alert rules** (`GET/PUT /api/alerts/rules`). Team settings override department settings, which override
company settings, which override the defaults. Company rules: super admins; department and team rules: super admins and that department's QA
managers (QA managers can read them).

| Rule | Fires when | Severity | Defaults |
|---|---|---|---|
| KPI off target (`threshold_breach`) | a current, non-stale KPI value is at watch or off target against the target valid at its date (as on Team detail) | warning (watch) or critical (off target) | on, alert from warning |
| Metric stale (`metric_stale`) | one or more KPIs are older than their expected update interval; one alert per team listing them | info | on |
| QA score drop (`score_drop`) | the QA score (stale inputs left out) fell by at least N points within D days | warning; critical at twice the drop | on, N = 10 points, D = 7 days |
| Ingestion failures (`ingestion_failure`) | at least C rejected or partial ingestion requests in the last H hours, per team named in them (company-level when none) | warning | on, C = 1, H = 24 |

**Evaluation:** after every KPI write (Manual metrics, ingestion API, generators) and every hour (local `server/jobs/alertsCron.ts`, default
`15 * * * *`; Netlify Scheduled Function `netlify/functions/alerts-evaluate.ts`); super admins also have **Evaluate alerts now**. Exactly one open
alert per condition: refreshed while the condition holds, resolved when it is gone. Team leads, the department's QA managers and super admins can
**acknowledge** an alert (recorded in Activity).

### Notifications

- **Bell** in the top bar (unread count, latest, mark read, acknowledge) and a **Notifications** page (`/notifications`: alerts of your scope,
  inbox, preferences).
- People assigned to a team, and its department's QA managers, are told about its alerts at the severity they chose; company-wide roles about
  critical team alerts only.
- **Preferences** per person: in-app on/off, an e-mail for each alert, the weekly digest (super admins, QA managers, team leads), minimum
  severity. Defaults: in-app on, no immediate e-mail, digest on for leads and above, from warning.
- E-mail goes through the one mailer (SMTP when configured, otherwise written to the server log). Every e-mail and Slack message goes through
  an outbox (`notification_deliveries`) with a dedupe key and up to 3 attempts.

### Slack

Super admins, **Parameters → Notification channels**: one incoming webhook per company (must be a `https://hooks.slack.com/…` URL), posting alerts
from a chosen severity and optionally a weekly summary. Stored AES-256-GCM encrypted with a key derived from `SETTINGS_ENCRYPTION_KEY` (else
`JWT_SECRET`; if that key changes the webhook must be entered again). Only a masked hint is ever returned; the URL never appears in logs, the
change history or the delivery log. **Send test message** checks it.

### Weekly digest

Mondays 07:00 UTC (`netlify/functions/weekly-digest.ts`, `0 7 * * 1`; locally `DIGEST_CRON`). Per recipient, for the teams in their scope: QA
score now vs 7 days earlier (with "based on n of m inputs"), alerts opened and still open, stale metrics, actions overdue / due in the next 7 days
/ completed with their outcome. At most one per person per ISO week. **Send test digest** (Notifications → Preferences; Parameters for super
admins) sends yours immediately.

### Tracked actions

**Team detail → Action plan**, TV focus panel and the digest (`/api/actions`):

- Created by team leads, the department's QA managers and super admins, by hand or with **Create action** on a recommendation.
- Owner (someone who has the team in scope), due date, status (open, in progress, done, dropped), optionally a linked KPI. The owner may change
  the status.
- **Baseline:** the latest stored value of the linked KPI when the action is created.
- **Outcome (computed, never typed in):** the stored value at completion, and the latest value recorded up to 14 and 30 days after completion,
  compared with the baseline. **Improved** or **worse** when it moved by more than 2 % of the baseline (at least 0.01) in the KPI's direction,
  otherwise **unchanged**; "no new data" when nothing was recorded in that window.
- TV mode shows the actions without owner names.

### Database keep-alive

`netlify/functions/db-keepalive.ts` runs `SELECT 1` at 06:00 and 18:00 UTC (`0 6,18 * * *`), logging only ok / failed, so a hosted database on a
plan that pauses idle projects stays available.

### Configuration

`SETTINGS_ENCRYPTION_KEY` (recommended in production: a long random string), `ALERTS_CRON=false` (turn the local schedule off, for example on a
second instance), `ALERTS_EVALUATE_CRON` and `DIGEST_CRON` (local schedules, UTC), `NOTIFY_SLACK_ALLOW_LOCAL=true` (tests only; ignored in
production). The Slack webhook itself is entered in the app, not in the environment. On Netlify the three scheduled functions need no further
setup.

---

## 8. Configuration and operations

### Environment variables

Only names and purposes are listed here. Never commit real values; `.env` is git-ignored and `.env.example` is the template. Variables prefixed
`VITE_` are bundled into browser JavaScript and must never hold secrets.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string (SSL disabled automatically for localhost). Alternatively `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| `DB_POOL_MAX` | no | Connections per server / function instance (default 10, or 3 on Netlify) |
| `JWT_SECRET` | yes | Signs session tokens. Also the fallback key for encrypting the Slack webhook when `SETTINGS_ENCRYPTION_KEY` is not set |
| `PORT` | no | API port (default 3000) |
| `FRONTEND_URL` | no | Allowed browser origin(s) for CORS |
| `ENABLE_SYNTHETIC_DATA` | no | `true` enables the sample-data generators and the in-app "Load sample data". Off by default |
| `DEMO_MODE` | no | `true` shows demo account chips on the login page. Default on locally, off in production / on Netlify |
| `GROQ_API_KEY` | no | Enables AI text: executive briefing, team and developer recommendation text, business-impact summary. Without it the rule-based versions are used |
| `APP_URL` | for invitations, SSO, e-mail and Slack links | Public URL of the app (invitation links, SSO redirect and return, links in alert e-mails, digest and Slack). On Netlify defaults to `URL` |
| `API_PUBLIC_URL` | no | Only when the API has its own origin (local development) |
| `INVITE_TTL_HOURS` | no | Invitation lifetime, default 168 (1 to 720) |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | no | Outgoing e-mail (invitations, alert e-mails, weekly digest). Without `SMTP_HOST` nothing is sent: messages are logged and invitation links are shown to copy |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Google sign-in (redirect URI `<APP_URL>/api/auth/sso/google/callback`) |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` | no | Microsoft sign-in (redirect URI `<APP_URL>/api/auth/sso/microsoft/callback`; a single tenant is recommended) |
| `GOOGLE_OIDC_DISCOVERY_URL`, `MS_OIDC_DISCOVERY_URL` | no | Override the OpenID discovery documents (testing) |
| `API_RATE_LIMIT_MAX` | no | General API rate limit per minute (default 300); raise it for local end-to-end runs |
| `VITE_DISABLE_WEBSOCKET` | no | Front-end switch to turn the live-update socket off |
| `SETTINGS_ENCRYPTION_KEY` | recommended in production | Key for encrypting the Slack webhook (a long random string); without it a key is derived from `JWT_SECRET` |
| `ALERTS_CRON` | no | `false` turns the local alert / digest schedule off (for example on a second instance) |
| `ALERTS_EVALUATE_CRON`, `DIGEST_CRON` | no | Local schedules in UTC (defaults `15 * * * *` hourly and `0 7 * * 1` Monday 07:00) |
| `NOTIFY_SLACK_ALLOW_LOCAL` | tests only | Accepts a local `http://127.0.0.1:<port>/` webhook; ignored in production |

The Slack webhook is entered in **Parameters → Notification channels**, not in the environment.

### Deployment

- A single Node service (Railway: `npm run server:prod` serves the built app from `dist/`), or
- Netlify: static site plus `netlify/functions/api.ts`, which mounts the same routers. On Netlify there are no long-running cron jobs and no
  WebSocket (dashboards refresh on load and on their own timers). Three Netlify Scheduled Functions replace the local schedule:
  `alerts-evaluate` (hourly, `15 * * * *`), `weekly-digest` (Monday 07:00 UTC) and `db-keepalive` (06:00 and 18:00 UTC).
- On the long-running server, `server/jobs/alertsCron.ts` evaluates alerts hourly (and once 20 s after start), computes due action
  outcomes, sends pending notifications and runs the weekly digest.
- Schema: apply `supabase/migrations/` in timestamp order. Migrations are additive and idempotent.

### Getting started and seed commands

```bash
npm install
cp .env.example .env              # set DATABASE_URL and JWT_SECRET
npm run server                    # API on http://localhost:3000
npm run dev                       # app on http://localhost:5173

npm run seed:demo                 # demo company (local databases only unless --allow-remote)
npm run seed:demo -- --fill-existing
npm run seed:demo:check           # coverage per company, team and module; exit code 1 below 100 %
npm run seed:demo:clear           # remove all demo rows
npm run seed:demo -- --sql out/demo-seed.sql   # SQL files instead of a connection (preferred for hosted databases)
```

Demo sign-ins use the password `demo123` (sample data only).

### Tests and CI

```bash
npx tsc --noEmit -p tsconfig.app.json      # frontend types
npx tsc --noEmit -p tsconfig.server.json   # API types
npm run test:api                           # API tests (API running on :3000)
npm run test:db                            # database tests
npm run test:e2e                           # Playwright role tests (API and app running)
```

API suites cover the role matrix, analytics scope, ingestion, targets, audit, invitations, SSO, mailer, privacy and pulse, TV mode, compare /
views / onboarding, security and "golden" outputs (`tests/api/golden.test.ts` fails on any unexpected output change). Database suites check
the schema, the QA score trigger against `computeQaScore` for every stale combination, `metric_values` derivation and the pulse schema.

**CI** (`.github/workflows/ci.yml`, GitHub Actions) runs on every push, pull request and on demand: `quality` (typechecks, ESLint report,
build), `api-and-db` (Postgres 16 prepared like production by `scripts/ci/prepare-db.sh`, demo seed, API and database suites) and `e2e` (all
Playwright specs, HTML report as an artifact).

---

## 9. Known limitations and what is next

### Data sources

- **No native connectors.** There are no built-in Jenkins, Jira, SonarQube, GitHub, TestRail, PagerDuty or Datadog integrations. Every team
  KPI must be pushed to the ingestion API by a job or CI step you run, or entered by hand. The metric catalog lists, per KPI, the exact field or
  API to read in each system.
- **Only team KPIs can be ingested.** Developer metrics, technical-debt items, pipeline runs and stages, test cases and executions, flaky tests and
  performance results have no ingestion endpoint. Developer metrics, debt-item impact and pipeline stages can be edited in Manual metrics; the rest
  is populated only by sample data today.
- **Developer metrics have no history from manual entry.** `developer_metrics` holds one current row per developer and team; DDPS history
  (`developer_productivity_snapshots`) is written only by the seed.
- **Company snapshots are stored only when someone opens the executive briefing**, so the briefing's 30-day history depends on usage.
- **Hosted demo data ages.** Sample history stops at the day it was seeded; values then turn stale (planned: a refresh step).

### Open items from the release plan and README

- Not yet staleness- or target-history-aware: `/api/metrics/dashboard`, `/metrics/analytics/*` averages and Team rankings; other analytics pages
  still use default thresholds instead of target history.
- `GET /api/analytics/pipeline-stages` answers 400 for a caller without a team.
- Migrations tested on PostgreSQL 16; a run on PostgreSQL 17 (Supabase) is planned.
- Compare teams marks the worst value "LOWEST" even for lower-is-better metrics (to be renamed "Weakest").
- No CSV on some sub-tables (team-detail members, admin-console members, department team list, report preview); saved views cannot be renamed in
  the UI.
- Formula mode is offered to super admins only.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| Analytics scope | The teams a person may open in analytics, compare, TV and member lists: all (super admin), their departments' teams (QA manager), their assigned teams (others) |
| Assignment | A role on a scope (company, department or team) in `role_assignments`; a person can hold several |
| Automation coverage | Share of test cases that run automatically |
| Carried forward | A snapshot value that was recorded on an earlier day and is still the latest value |
| Change failure rate (CFR) | Share of deployments that cause a failure needing rollback, hotfix or incident |
| Composite | A score built from other values (QA score, engineering health, delivery, company averages) |
| Confidence | Inputs used ÷ inputs expected: high ≥ 90 %, medium ≥ 50 %, else low |
| DDPS | Daily Developer Productivity Score, 0–100, from focus, meetings, context switches, PR and review times |
| Defect escape rate | Share of bugs found in production rather than by the team |
| DORA | The four delivery metrics from the DevOps Research and Assessment programme: deployment frequency, lead time, change failure rate, MTTR |
| Engineering health | Company composite: delivery 35 %, pipeline 25 %, tech debt health 20 %, wellbeing (survey) 20 % |
| Field sources | Per-value provenance in a snapshot: source, recorded at, recorded by, carried forward |
| Formula mode | "Show formulas & data sources": explanation of any metric (formula, thresholds, storage, source, production systems) |
| Idempotency key | A client-chosen key that makes a retried request or item write nothing twice |
| Ingestion log | Record of every write request (API and manual) with its outcome |
| k-anonymity (k = 3) | Aggregates of individual data are shown only when at least 3 people contribute |
| KPI snapshot | One row per team and day holding the latest value of each KPI as of that day (`kpi_snapshots`) |
| KPI targets (headline four) | Coverage ≥ 80 %, automation ≥ 70 %, flakiness ≤ 2 %, escape rate ≤ 5 % by default |
| Metric value | One stored measurement with its time and source (`metric_values`), the raw data behind snapshots |
| MTBF / MTTR | Mean time between failures / mean time to recovery |
| Needs attention | QA score below 70 or any headline KPI off target |
| On track / at risk / off track | Share of current headline KPI targets met: ≥ 75 %, 50–75 %, < 50 % (needs at least 2) |
| Pulse survey | Five-question anonymous wellbeing survey per team, weekly or every two weeks |
| QA score | Team quality composite of coverage (30 %), 100 − escape rate (25 %), 100 − CFR (25 %), code quality (20 %); good ≥ 85, warning ≥ 70 |
| recordedAt | The time a value is for (not when it was received); allows backfill up to 365 days |
| Sample data | Generated, fictional values marked source `synthetic`; flagged on screen |
| Stale | Older than the metric's expected update interval; shown greyed and left out of composites |
| Target history | Targets with validity periods per company, department or team; values are judged against the target valid on their date |
| Technical debt score / tech debt health | Team: severity-weighted open debt, 0–100, lower is better. Company: 100 minus open weight per team, higher is better |
| Watch | The band between target and warning level (amber) |
| Wellbeing (survey) | (mean answer − 1) ÷ 4 × 100 over a closed survey period with at least 3 responses |
| Workload balance (derived) | 0–100 workload signal from developer metrics, stored as `happiness_score`; not wellbeing |
