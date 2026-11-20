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

### Phase 2 — Delivery and reliability

| Endpoint | Accepts | Calculates |
|---|---|---|
| `POST /api/ingest/deployments` | deploy events: environment, commit(s), time, result, rollback flag | deployment frequency, lead time for changes (first commit → production), change failure rate |
| `POST /api/ingest/commits` | commit list for a deploy (sha, authored and committed time) | lead time detail |
| `POST /api/ingest/incidents` | opened, acknowledged, resolved, severity, service, linked deployment | MTTR, MTBF, availability, incidents per deploy |

### Phase 3 — Work and code quality

| Endpoint | Accepts | Calculates |
|---|---|---|
| `POST /api/ingest/issues` | Jira / Linear issue JSON: type, status changes, environment found in, story points, sprint, estimate and time logged | defect escape rate, defect density (with code size from coverage), velocity, commitment, carryover, blocked time, sizing accuracy |
| `POST /api/ingest/static-analysis` | SARIF (SonarQube, CodeQL, ESLint and others export it) | code quality score, findings by severity and rule, new vs fixed findings |

### Phase 4 — Improve (for teams)

- **Forecasts**: each metric projected 4–8 weeks ahead with a confidence band; "at this rate coverage misses its target
  on 18 Dec".
- **Recommendations**, ranked by expected effect, each with evidence and a concrete next step, for example:
  - "Fix these 12 flaky tests: they failed 41 runs last sprint and cost about 6 hours of reruns."
  - "Coverage of `loan-approval/` is 41 %; 70 % of escaped defects in the last quarter touched it."
  - "Build time doubled since 3 Nov; the `integration-tests` stage went from 4 to 11 minutes."
- One click turns a recommendation into an Action plan item; the action then shows whether the metric moved.

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

## Data model (new tables)

- `raw_uploads`: every file or event received (company, team, kind, format, commit, run id, size, hash, storage
  reference, parse status). Large files are stored compressed; raw data kept 13 months.
- `test_runs`, `test_results` (per test case: suite, name, status, duration, attempt, failure message hash),
  `flaky_test_evidence`.
- `coverage_reports`, `coverage_files` (per file: lines found / hit, branches found / hit).
- `pipeline_runs_raw`, `pipeline_stage_runs` (extends the existing pipeline tables where they fit).
- Phases 2–3: `deployments`, `deployment_commits`, `incidents`, `issues`, `issue_transitions`, `analysis_findings`.
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

1. Phase 1 — in progress.
2. Phase 2.
3. Phase 3.
4. Phases 4 and 5 (they need phases 1–3 data to be credible; forecasts can start after phase 1).
5. Phase 6 (the executive phone summary and TV mode can be built in parallel at any time).
