# QE Navigator v2 plan

## Purpose

QE Navigator answers two questions:

1. **Improve** — for software development teams: *what should we do better, specifically, and what will it change?*
2. **Invest** — for the business: *where should we put money to raise quality and revenue, and what will it return?*

v1 shows the state of quality well, but its numbers are typed in or sent already calculated, and it does not yet say
why a number is bad or what it is worth fixing. v2 makes both answers trustworthy and specific.

## Principles

- **Raw data in, we calculate.** Customers send the output their tools already produce (test reports, coverage reports,
  pipeline and deployment events, incidents, issues, static-analysis findings). QE Navigator calculates every metric.
  Customers never compute a percentage for us.
- **Every number is traceable.** Each metric links to the runs, files, tests, deployments or issues it came from, and
  shows its formula.
- **No invented numbers.** Missing data shows as missing, with how much is missing (confidence). Money figures show their
  assumptions and a range, not a single false-precise number.
- **One API key, one ingestion log.** All raw endpoints use the company's existing API keys and are recorded in the
  ingestion log, like today. The v1 endpoint `POST /api/ingest/kpis` stays for existing users.
- **Same app, same repo.** v2 is added in layers and shipped phase by phase behind the existing tests.

## How it works

```
CI / tools ──raw files & events──▶ Raw ingestion API ──▶ Raw store (per company, kept 13 months)
                                                              │
                                                              ▼
                                               Calculation engine (on arrival + nightly)
                                                              │
                         ┌────────────────────────────────────┼─────────────────────────────┐
                         ▼                                    ▼                             ▼
             Daily KPI snapshots (existing)        Evidence (which tests, files,      Forecasts, recommendations,
             → dashboards, alerts, targets          services, changes)                 investment options
```

- **Parsers** turn each format into one internal shape (e.g. JUnit, TRX, Cucumber JSON → test results).
- **Calculation engine** writes the daily team metrics into the existing KPI tables with source `computed`, so every
  current page, alert and target keeps working, and records the evidence behind each value.
- **Recalculation**: raw data is kept, so a formula change or a late file re-runs history for the affected days.
- **Idempotency**: duplicates are ignored by commit + run id + attempt (tests, coverage, pipelines), event id
  (deployments, incidents) or issue key + change time (issues).

## Phases

### Phase 1 — Raw ingestion foundation: tests, coverage, pipelines (start now)

One CI step gives most of the quality picture.

| Endpoint | Accepts | Calculates |
|---|---|---|
| `POST /api/ingest/tests` | JUnit XML (also produced by pytest, Jest, Maven/Gradle, Playwright, Cypress), TRX, Cucumber JSON + team, commit, branch, run id, attempt | pass rate, first-time pass rate, flaky tests (same test both passed and failed on the same commit), execution time, test counts, slowest tests |
| `POST /api/ingest/coverage` | lcov, Cobertura XML, JaCoCo XML, Istanbul `coverage-final.json` / `json-summary` + team, commit, branch | line and branch coverage, per-file coverage, coverage of new / changed code, code size (lines) |
| `POST /api/ingest/pipelines` | pipeline run events: id, start, end, result, commit, branch, stages with durations | average build time, pipeline success rate, parallel test efficiency |

Also in phase 1:
- **Evidence views**: flaky-test list (with the runs that prove it), lowest-coverage files, slowest tests, failing stages.
- **"How this was calculated"** on every computed metric, with links to the source runs.
- **Connect your CI** screen: guided setup per tool (GitHub Actions, GitLab CI, Jenkins, Azure DevOps) with copy-paste
  steps, a test call, and the last data received.
- **Sample data** for demos generates raw runs too, so demos show the evidence views.

Status: **done**. Endpoints `POST /api/ingest/tests | coverage | pipelines` (raw body or multipart, several report files per
upload, gzip, 20 MB per request, format detection, 415 for unknown formats, safe XML without entities, idempotent per team +
commit + run + attempt, dry-run test call), migration `20261129000000_raw_ingestion_phase1.sql` (raw_uploads, test_runs,
test_results, flaky_test_evidence, coverage_reports, coverage_files, pipeline_runs_raw, pipeline_stage_runs, metric_evidence,
teams.main_branch; the v1 `pipeline_runs` table is a per-stage status table and stays as it is), calculation engine
`server/lib/calc/engine.ts` (on arrival, recalculation of affected days, nightly `calc-recompute`, KPI values with source
`computed`), evidence and "How this was calculated" on the team page, Connect your CI in the Admin console (super admins, like
API keys), sample raw data for demo and filled teams (`server/seeds/demoRaw.ts`; evidence only). Storage: per-test and
per-file rows and payloads 35 days, the rest 13 months. Tests: `tests/api/ingest-parsers.test.ts`, `raw-ingestion.test.ts`,
`tests/database/rawStore.test.ts`, UI `team/ci-evidence.spec.ts`, manual cases TC-ADM-045 … TC-ADM-050. Not in phase 1: forecasts on top
of the new data (phase 4).

### Phase 2 — Delivery and reliability

| Endpoint | Accepts | Calculates |
|---|---|---|
| `POST /api/ingest/deployments` | deploy events: environment, commit(s), time, result, rollback flag | deployment frequency, lead time for changes (first commit → production), change failure rate |
| `POST /api/ingest/commits` | commit list for a deploy (sha, authored and committed time) | lead time detail |
| `POST /api/ingest/incidents` | opened, acknowledged, resolved, severity, service, linked deployment | MTTR, MTBF, availability, incidents per deploy |

Status: **done**. Endpoints `POST /api/ingest/deployments | commits | incidents` (JSON, batches of up to 500 events, gzip, 5 MB,
400 / 413 / 415 as phase 1, idempotent by event id with updates, dry run; GitHub `deployment_status` / push and GitLab
deployment / push webhooks, PagerDuty v3 webhooks and REST exports, Opsgenie webhooks and exports mapped as they are; computed
values refused; authors stored as a salted hash only), migration `20261130000000_raw_ingestion_phase2_delivery.sql`
(`deployments_raw`, `deployment_commits`, `incidents_raw`, `incident_updates`, `service_teams`; `raw_uploads.kind` extended),
calculation `server/lib/calc/delivery.ts` (on arrival for the affected days, nightly in `calc-recompute`; KPI values with source
`computed` and `metric_evidence` with the deploys and incidents), team page Evidence → **Deliveries & incidents** (DORA tiles with
How this was calculated, recent production deploys, failed changes with reasons, incidents with duration and linked deploy),
Connect your CI → **Deployments and incidents** (steps per CI tool and per incident tool, service → team mapping, test call per
endpoint), sample deployments / commits / incidents (35 days) for demo and filled teams and a live-company SQL
(`raw-sample-sql.ts --delivery-only`). Retention 13 months. Tests: `tests/api/delivery-parsers.test.ts`,
`delivery-ingestion.test.ts`, `tests/database/deliveryStore.test.ts`, UI `team/delivery-evidence.spec.ts`, manual cases
TC-ADM-055 … TC-ADM-060.

### Phase 3 — Work and code quality

| Endpoint | Accepts | Calculates |
|---|---|---|
| `POST /api/ingest/issues` | Jira / Linear issue JSON: type, status changes, environment found in, story points, sprint, estimate and time logged | defect escape rate, defect density (with code size from coverage), velocity, commitment, carryover, blocked time, sizing accuracy |
| `POST /api/ingest/static-analysis` | SARIF (SonarQube, CodeQL, ESLint and others export it) | code quality score, findings by severity and rule, new vs fixed findings |

Status: **done**. Endpoints `POST /api/ingest/issues` (Jira REST search results with changelog and names, single issues and
`jira:issue_*` webhooks; Linear GraphQL exports and Issue webhooks; QE Navigator JSON with sprints; at most 1,000 issues and 10 MB,
gzip, 400 / 413 / 415 as before, idempotent by issue key + change time with updates and out-of-order protection, dry run; the
team from the issue, the query or the project key mapped like a service; computed values refused) and
`POST /api/ingest/static-analysis` (SARIF 2.1.0 as the body or multipart, one report per tool, severity from SonarQube severity /
impacts, CodeQL security-severity or the SARIF level, suppressed and absent results left out, fingerprints for new vs fixed,
idempotent per team + commit + run + attempt), migration `20261201000000_raw_ingestion_phase3_work_quality.sql` (`issue_sprints`,
`issues`, `issue_transitions`, `analysis_reports`, `analysis_findings`; `raw_uploads.kind` extended), calculation
`server/lib/calc/work.ts` and `server/lib/calc/quality.ts` (on arrival for the affected days, nightly in `calc-recompute`; KPI
values with source `computed` and `metric_evidence` with the issues and reports), team page Evidence → **Work & code quality**
(tiles with How this was calculated, last closed sprints, escaped defects, blocked / carried-over and mis-sized issues, latest
reports, findings by rule, new and fixed findings, score history), Connect your CI → **Issues and code quality** (Jira, Linear,
JSON steps, SARIF per CI tool, test calls), recommendations wired to the new evidence (escaped defects with their components,
mis-sized and blocked issues of the latest sprint, high-severity findings by rule), a year of sample issues and weekly SonarQube
reports derived from each team's KPI history (`server/seeds/demoWork.ts`) and a live-company SQL (`raw-sample-sql.ts
--work-only`). Retention: findings 35 days (the latest report keeps them), reports, closed sprints and resolved issues 13 months.
Tests: `tests/api/work-parsers.test.ts`, `work-ingestion.test.ts`, `tests/database/workStore.test.ts`, UI
`team/work-evidence.spec.ts` (WRK-01 … 05, CI-04, A11Y-46 … 49), manual cases TC-ADM-061 … TC-ADM-066.

### Phase 4 — Improve (for teams)

- **Forecasts**: each metric projected 4–8 weeks ahead with a confidence band; "at this rate coverage misses its target
  on 18 Dec".
- **Recommendations**, ranked by expected effect, each with evidence and a concrete next step, for example:
  - "Fix these 12 flaky tests: they failed 41 runs last sprint and cost about 6 hours of reruns."
  - "Coverage of `loan-approval/` is 41 %; 70 % of escaped defects in the last quarter touched it."
  - "Build time doubled since 3 Nov; the `integration-tests` stage went from 4 to 11 minutes."
- One click turns a recommendation into an Action plan item; the action then shows whether the metric moved.

Status: **done**. Forecasts (`server/lib/forecast/math.ts`): per team, every KPI with history and the QA score, Theil–Sen trend
through the weekly medians of 26 weeks, 80 % band from the residuals (1.4826 × MAD), 8 weeks ahead, the target crossing day by day
with the target valid on each future day (earliest / latest from the band's edges), or "not enough data" with the reason (fewer
than 6 weeks with values, history under 5 weeks, latest value older than 21 days, too noisy). Recommendations
(`server/lib/recommendations/rules.ts`, deterministic): flaky tests (the tests, failed runs, rerun time), coverage gap (the files
holding most uncovered lines and the points raising them adds), build-time regression (the stage that grew), defect escape rising
while coverage falls, sizing drift with carryover, low wellbeing with blocked time, MTTR rising (the longest incidents, time to
acknowledge), a failing stage, high-severity debt, the slowest tests, change failures (failed deploys per service), availability;
each with evidence, next step, expected effect as a range (from the evidence or the team's own best level of 26 weeks) and
confidence; ranked by expected effect in watch bands × confidence, at most 6. Stored in `forecasts` and `recommendations` (open /
accepted → linked action / dismissed with a reason; reopen), migration `20261130100000_forecasts_recommendations.sql` (also
`team_actions.recommendation_id`). API `GET /api/improve/teams/:id` (analytics scope; recalculated when due), `POST …/refresh`,
`POST /api/improve/recommendations/:id/accept | dismiss | reopen` (who may create actions). Recalculated by the hourly
`alerts-evaluate` job for the teams that are due (none yet, older than 20 h or older than their newest value) within the function's
time limit, so production backfills itself; `scripts/reseed/improve-refresh.ts` does a company at once. Team detail: Forecast line on
the KPI tiles and the QA score, trend charts with the projected band, target and crossing, Recommendations section above the Action
plan; actions show their recommendation and the metric before / after from the snapshot history. Executive summary: "at this rate …"
under each risk and the KPIs on target now but forecast to miss. Tests: `tests/api/forecast-math.test.ts`,
`recommendation-rules.test.ts`, `improve.test.ts`, UI `team/improve.spec.ts` (IMP-01 … 09, A11Y-42 … 45), manual cases in
"Team improve".

### Phase 5 — Invest (for the business)

- **Cost model** set once by a super admin: revenue per product / service per hour, average engineering cost per hour,
  cost per incident hour (or derived), working hours per week. Defaults are clearly marked as assumptions.
- **Cost of poor quality**, calculated from real events: downtime × revenue per hour, hours on rework, reruns, blocked
  work and incident response × cost per hour, escaped defects × average fix cost.
- **Investment options**, ranked by return: each with estimated cost, expected change in the metrics (from the team's own
  history and the forecasts), expected yearly saving or protected revenue as a range, payback time and confidence.
- **Simulator**: change an investment (e.g. "two weeks of automation in Lending Journey") and see the projected effect.
- Builds on the existing Business impact / revenue module.

### Phase 6 — Where people look

- **Executive summary for phones**: quality, money at risk, top 3 investments, top 3 risks; readable in one minute.
- **New TV mode**: built for a wall screen: large type, automatic rotation between teams and panels, live status,
  readable from across the room.
- Later: Slack / Microsoft Teams digests and alerts.

Status: **done** (executive summary and TV mode). `/summary` (`GET /api/summary`, one call, scoped like every page; money at risk
for super admins and managers) and the wall-screen TV mode (rotation between the teams in scope and the chosen panels, set-up dialog
and kiosk link, alerts and wellbeing panels, four themes, recovery after a lost connection, 1080p and 4K). Tests: API
`executive-summary.test.ts`, UI `summary/executive-summary.spec.ts` and `team/tv-wall-screen.spec.ts`, manual cases SUM-* and TVW-*.
No database change. Slack / Teams digests remain for later.

## Data model (new tables)

- `raw_uploads`: every file or event received (company, team, kind, format, commit, run id, size, hash, storage
  reference, parse status). Large files are stored compressed; raw data kept 13 months.
- `test_runs`, `test_results` (per test case: suite, name, status, duration, attempt, failure message hash),
  `flaky_test_evidence`.
- `coverage_reports`, `coverage_files` (per file: lines found / hit, branches found / hit).
- `pipeline_runs_raw`, `pipeline_stage_runs` (extends the existing pipeline tables where they fit).
- Phase 2 (done): `deployments_raw`, `deployment_commits`, `incidents_raw`, `incident_updates`, `service_teams`.
- Phase 3: `issues`, `issue_transitions`, `analysis_findings`.
- `metric_evidence`: for each computed metric value, the source records it was calculated from.
- Phases 4–5: `forecasts`, `recommendations`, `cost_model`, `investment_options`.

## Calculation rules (phase 1)

- **Line coverage** = lines hit ÷ lines found, over the latest report per commit on the team's main branch; branch
  coverage likewise. Per-file values come from the same report.
- **Coverage of changed code** = hit ÷ found over lines changed in the commit range (when the diff is supplied).
- **Pass rate** = passed ÷ (passed + failed) over the day's runs on the main branch; skipped tests are counted separately.
- **First-time pass rate** = share of pipeline runs whose first attempt passed.
- **Flaky test** = a test that both failed and passed on the same commit within 7 days (retries or reruns); the
  flakiness rate = flaky tests ÷ distinct tests run.
- **Test execution time** = median total test duration per run; **average build time** = median pipeline duration.
- Each value carries the number of runs it is based on; too few runs lowers the confidence shown.

## Calculation rules (phase 2)

- Per team and UTC day D, over the **28 days ending D**, "as of" the end of D (an event counts from the moment it happened, so
  a rollback or incident that arrives later changes the values from its own day on). The period starts at the team's first
  production deploy when that is later (at least 7 days).
- **Production deploy** = a deploy to a production environment (`production`, `prod`, `prd`, `live`, or `production: true`) that
  reached it (`success` or `rolled_back`); rollback deploys and deploys that did not complete are not counted.
- **Deployment frequency** = production deploys ÷ weeks in the period. **Lead time for changes** = median of (deploy finished −
  first commit authored) over the production deploys with commit times.
- **Change failure rate** = failed changes ÷ production deploys × 100; a **failed change** was rolled back (its result, or a
  rollback deploy names it), was followed within 72 h by a hotfix deploy of the same service, or has a linked incident.
- **MTTR** = median (resolved − opened) of the incidents resolved in the window. **MTBF** = mean time between consecutive
  incident starts of the same service. **Availability** = (1 − outage time ÷ period) × 100, outages = incidents marked as
  outage, else severity critical or high; overlaps counted once; open outages until now. **Incidents per deploy** = incidents
  opened ÷ production deploys. **Infrastructure failures** = incidents of category infrastructure (when categories are sent).
- Confidence from the number of deploys / incidents (high ≥ 10, medium 3–9, low < 3). Reliability values need incident data
  (a team that never sent incidents shows them as missing, not as 100 %).

## Calculation rules (phase 3)

- **Defects**, over the 28 days ending D (bugs opened in the window; resolved as won't do, duplicate, cannot reproduce, not a bug,
  … are not confirmed defects): **defect escape rate** = bugs found in production ÷ bugs with a known environment × 100 (bugs
  without an environment are left out and counted as such); **defect density** = bugs found in production ÷ (lines found of the
  latest main-branch coverage report ÷ 1,000); no coverage report, no density.
- **Sprints**: the latest sprint closed on or before D (at most 42 days before). **Velocity** = story points of the issues
  completed in it (done before it closed + 1 h, not in a later sprint that started first; epics and sub-tasks not counted).
  **Commitment rate** = completed points ÷ committed points × 100, committed = in the sprint at its start (from the Sprint
  changes when sent, else created before the start). **Carryover** = points of its issues not completed ÷ committed × 100 (at
  most 100). **Blocked time** = hours its issues spent in a blocked status (Blocked, On hold, Waiting, Impeded) or flagged,
  within the sprint, overlaps once. **Sizing accuracy** = time logged ÷ original estimate over its completed issues with both.
  Without sprints (Kanban): blocked time and sizing accuracy over the 14 days ending D.
- **Code quality score** = round(100 × e^(−w ÷ 20)), w = weighted findings per 1,000 lines of code (critical 10, high 5, medium 2,
  low 0.5, info 0) over the latest main-branch report of each repository and tool (at most 30 days old); lines of code sent with
  the report, else the latest coverage report's lines found; neither, no score. Findings, new findings (not in the previous
  report of the same repository, branch and tool) and fixed findings are summed over those reports.
- Confidence from the number of bugs / sprint issues / reports (high ≥ 10, medium 3–9, low < 3). On arrival: issues recalculate
  each change day and the 41 after it within 190 days; reports their day and the 30 after it.

## Success criteria

- A new customer connects CI in under 15 minutes and sees calculated coverage, flakiness and build metrics from their
  first runs.
- Every computed number opens to its evidence and formula.
- Teams act on recommendations (tracked through the Action plan) and see the effect.
- Executives get a ranked, costed list of investments with ranges and assumptions they can change.

## Risks and how we handle them

- **Format variety**: start with the most common formats per tool; reject unknown formats with a clear message and log it.
- **Large uploads**: stream and compress, limit size per upload, parse in background jobs on Netlify.
- **Privacy**: test and commit data can name people; individual developer views keep the existing opt-in and
  minimum-group rules.
- **Money estimates**: always shown as ranges with editable assumptions; never presented as exact.

## Order and status

1. Phase 1 — done (raw tests, coverage and pipelines, calculation engine, evidence, Connect your CI).
2. Phase 2 — done (deployments, commits, incidents, DORA and reliability metrics, deliveries evidence, service mapping).
3. Phase 3 — done (issues and SARIF, work and code-quality metrics, work evidence, recommendations wired).
4. Phases 4 and 5 (they need phases 1–3 data to be credible; forecasts can start after phase 1).
5. Phase 6 — done (executive phone summary and wall-screen TV mode); Slack / Teams digests later.
