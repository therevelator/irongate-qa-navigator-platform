# Metrics and calculations

How every number in QE Navigator is calculated, with the code that does it. This is the formula
reference for engineers and analysts. The full description of each metric (why it matters, targets,
production sources, screens) is in [PRODUCT_GUIDE.md, section 3](PRODUCT_GUIDE.md#3-the-metrics).

Principle: **raw data in, we calculate.** Customers send the raw output of their tools (test reports,
coverage reports, pipeline runs, deployments, commits, incidents); the calculation engine turns it into
metrics and keeps the evidence. The older KPI ingestion API (`POST /api/ingest/kpis`), where a customer
sends a finished value, still works for companies not in live operation (all 23 KPIs have a raw source). Nothing is
invented: a metric without data shows "—" or "No data recorded".

## Contents

1. [Where values are stored](#1-where-values-are-stored)
2. [Status, targets, staleness, confidence](#2-status-targets-staleness-confidence)
3. [QA score](#3-qa-score)
4. [Calculation engine: tests, coverage, pipelines (v2 phase 1)](#4-calculation-engine-tests-coverage-pipelines-v2-phase-1)
5. [Calculation engine: delivery and reliability (v2 phase 2)](#5-calculation-engine-delivery-and-reliability-v2-phase-2)
6. [Calculation engine: work and code quality (v2 phase 3)](#6-calculation-engine-work-and-code-quality-v2-phase-3)
7. [Forecasts (v2 phase 4)](#7-forecasts-v2-phase-4)
8. [Recommendations (v2 phase 4)](#8-recommendations-v2-phase-4)
9. [Company and module metrics](#9-company-and-module-metrics)
10. [When calculations run](#10-when-calculations-run)
11. [Hours lost per week](#11-hours-lost-per-week)

Then, each with its own headings: [CI/CD pipeline metrics and the pipeline page](#cicd-pipeline-metrics-and-the-pipeline-page), [Flaky test intelligence](#flaky-test-intelligence), [Business impact: correlations and revenue impact](#business-impact-correlations-and-revenue-impact).

## 1. Where values are stored

- **One write path.** Every KPI value (from the ingestion API, Manual metrics, the calculation engine or
  sample data) goes through `recordKpiValues` in [`server/lib/kpiIngest.ts`](../server/lib/kpiIngest.ts).
  It validates the column against `KPI_COLUMNS` (23 writable columns with their ranges), stores the value
  in `metric_values` with the time it is for, and re-derives the team's `kpi_snapshots` for that day and
  later days ([`server/lib/metricValues.ts`](../server/lib/metricValues.ts)).
- **Provenance.** Each snapshot column records its source label, time and who recorded it in
  `kpi_snapshots.field_sources`. Computed values use the source `computed`.
- **Evidence.** Values from the calculation engine are also stored in `metric_evidence` with the formula,
  the inputs, the number of runs or events used and the ids of the source records. Team detail shows it
  under **How this was calculated** (`GET /api/ci/teams/:id/metrics/:metric`).
- **Carry-forward.** A snapshot day holds the latest value of each metric as of that day, so a partial
  update never wipes the other metrics.

## 2. Status, targets, staleness, confidence

- **Direction.** Each metric is higher-is-better or lower-is-better. Sizing accuracy is best at 1.0.
  Velocity and automation ROI have no direction and no status colour.
- **Thresholds.** Each metric has `good` (the target) and `warning`. Higher-is-better: value ≥ good is on
  target, ≥ warning is watch, below is off target. Lower-is-better reverses the comparisons. Defaults:
  `METRICS_CONFIG` in [`src/config/metricsConfig.ts`](../src/config/metricsConfig.ts).
- **Target lookup.** Team, then department, then company, then the code default, from `target_history`
  ([`server/lib/targets.ts`](../server/lib/targets.ts)). A value is judged against the target valid at the
  end of the value's UTC day.
- **Stale.** A value older than its expected update interval (`DEFAULT_METRIC_INTERVALS` in
  [`server/lib/metricIntervals.ts`](../server/lib/metricIntervals.ts), changeable in Update frequency) is
  greyed, not judged and left out of composites ([`server/lib/staleness.ts`](../server/lib/staleness.ts)).
- **Composite confidence.** Inputs used ÷ inputs expected: high at 90 % or more, medium at 50 % or more,
  else low (`CONFIDENCE_RULE` in [`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts)).
- **Calculation engine confidence.** Number of runs or events behind a computed value: high at 10 or
  more, medium at 3 or more, else low (`confidenceFor` in
  [`server/lib/calc/engine.ts`](../server/lib/calc/engine.ts)).
- **Battery and gauge colour** (one scale for every score, [`src/lib/batteryScale.ts`](../src/lib/batteryScale.ts)):
  below 30 red, 30–45 deep amber, 45–60 amber, 60–75 yellow, 75–90 light green, 90–100 green. The status
  text next to it ("On target", "Watch", "Off target" with the target) is judged against the target.

## 3. QA score

```
QA score = [ test coverage × 0.30
           + (100 − defect escape rate) × 0.25
           + (100 − change failure rate) × 0.25
           + code quality score × 0.20 ]
           ÷ (sum of the weights of the inputs that are recorded)
```

- Each term is limited to 0–100. Missing inputs are left out and the remaining weights re-normalised.
- No score when test coverage is missing or fewer than 2 of the 4 inputs are recorded.
- Rounded to a whole number. Status: ≥ 85 good, ≥ 70 warning, else critical (`QA_SCORE_THRESHOLDS`).
- Stored in `kpi_snapshots.qa_score` by the database trigger `kpi_snapshots_qa_score` (migration
  `20261117000000_kpi_integrity_and_ingestion.sql`). On screens, stale inputs count as not recorded
  (`qaScoreComposite`). The ingestion API refuses `qa_score` and `status` as inputs.
- Code: `computeQaScore`, `qaScoreComposite` in [`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts).

Example: coverage 82, escape rate 6, change failure rate not recorded, code quality 75.
(82 × 0.30 + 94 × 0.25 + 75 × 0.20) ÷ 0.75 = 63.1 ÷ 0.75 = 84.1, so the score is 84 (warning), based on
3 of 4 inputs.

## 4. Calculation engine: tests, coverage, pipelines (v2 phase 1)

Input: `POST /api/ingest/tests`, `POST /api/ingest/coverage`, `POST /api/ingest/pipelines` (formats and
examples in [INTEGRATION_GUIDE.md, section 4A](INTEGRATION_GUIDE.md#4a-raw-ingestion-tests-coverage-pipelines-v2)).
Raw tables: `test_runs`, `test_results`, `coverage_reports`, `coverage_files`, `pipeline_runs_raw`,
`pipeline_stage_runs`. Code: [`server/lib/calc/engine.ts`](../server/lib/calc/engine.ts).

Values are computed per team and UTC day. The main branch is `teams.main_branch`, or `main` / `master`
when it is not set; a run without a branch counts as a main-branch run.

| Metric | KPI column | Formula |
|---|---|---|
| Line coverage | `test_coverage` | lines hit ÷ lines found × 100, latest report of the day's latest main-branch commit |
| Branch coverage | — | branches hit ÷ branches found × 100, same report |
| Coverage of changed code | — | changed lines hit ÷ changed coverable lines × 100, latest report sent with a diff |
| Pass rate | — | passed ÷ (passed + failed + errors) × 100 over the day's main-branch test runs; skipped counted separately |
| First-time pass rate | `first_time_pass_rate` | pipeline runs whose first attempt passed ÷ runs × 100 (test runs' first attempts when there is no pipeline data) |
| Flaky tests | — | tests that both failed and passed on the same commit within the last 7 days (or failed, then passed in a rerun inside one run) |
| Test flakiness rate | `test_flakiness_rate` | flaky tests ÷ distinct tests run in the last 7 days × 100 |
| Test execution time | `test_execution_time_minutes` | median total test duration per run, minutes |
| Average build time | `avg_build_time_minutes` | median pipeline duration, minutes; cancelled runs excluded |
| Pipeline success rate | — | successful ÷ (successful + failed) pipeline runs × 100; cancelled runs excluded |
| Parallel test efficiency | `parallel_test_efficiency` | Σ shard durations ÷ (shards × longest shard) × 100, median over runs with parallel test stages |

A value that did not change is not written again. Flaky tests found this way are stored in
`flaky_test_evidence` with the failed and passed run ids.

## 5. Calculation engine: delivery and reliability (v2 phase 2)

Input: `POST /api/ingest/deployments`, `POST /api/ingest/commits`, `POST /api/ingest/incidents`
([INTEGRATION_GUIDE.md, section 4B](INTEGRATION_GUIDE.md#4b-raw-ingestion-deployments-commits-incidents-v2)).
Raw tables: `deployments_raw`, `deployment_commits`, `incidents_raw`. Code:
[`server/lib/calc/delivery.ts`](../server/lib/calc/delivery.ts).

Each value is computed per team and UTC day D over the **28 days ending D** (`WINDOW_DAYS`). The period
starts at the team's first event when that is later, and is at least 7 days, so a new team is not
diluted by empty weeks.

- **Production deploy:** a deploy to a production environment that reached it (result `success` or
  `rolled_back`). Rollback deploys and deploys that did not complete are not counted.
- **Failed change:** a production deploy that was rolled back, or was followed within
  `CHANGE_FAILURE_WINDOW_HOURS` (default 72) by a hotfix deploy of the same service, or is linked to an
  incident.
- **Outage:** an incident marked as outage, or of severity critical or high unless marked otherwise.

| Metric | KPI column | Formula |
|---|---|---|
| Deployment frequency | `deployment_frequency_per_week` | production deploys ÷ weeks in the period |
| Lead time for changes | `lead_time_days` | median over the period's production deploys of (deploy finished − first commit authored), days; deploys without commit times left out |
| Change failure rate | `change_failure_rate` | failed changes ÷ production deploys × 100 |
| MTTR | `mttr_hours` | median (resolved − opened) of incidents resolved in the 28 days, hours |
| MTBF | `mtbf_hours` | mean time between the starts of consecutive incidents of the same service, for incidents opened in the 28 days (the last earlier incident counts as the previous start), hours |
| System availability | `system_availability` | (1 − outage time ÷ time in the period) × 100; overlapping outages count once, open ones until now |
| Incidents per deploy | — | incidents opened ÷ production deploys in the period |
| Infrastructure failures | `infrastructure_failures` | incidents of category "infrastructure" opened in the 28 days (only when incidents carry a category) |

An event counts from the moment it happened, so a later rollback or incident changes values from its
own day on. Commit author e-mails are stored only as a salted hash.

**DORA level** from these four KPIs (`getDORALevel` in [`server/routes/metrics.ts`](../server/routes/metrics.ts)):
Elite (≥ 7 deploys/week, lead time < 1 day, CFR < 5 %, MTTR < 1 h), High (≥ 1, < 7 days, < 10 %, < 24 h),
Medium (≥ 0.25, < 30 days, < 15 %, < 168 h), else Low; Unknown when any input is missing.

## 6. Calculation engine: work and code quality (v2 phase 3)

Issues (Jira, Linear, JSON) and static analysis (SARIF) are calculated by
[`server/lib/calc/work.ts`](../server/lib/calc/work.ts) and [`server/lib/calc/quality.ts`](../server/lib/calc/quality.ts).
The rules are documented in [V2_PLAN.md](V2_PLAN.md) ("Calculation rules (phase 3)") and the input
formats in [INTEGRATION_GUIDE.md, section 4C](INTEGRATION_GUIDE.md#4c-raw-ingestion-issues-and-static-analysis-v2).

### Test automation (group `automation`)

Input: `POST /api/ingest/test-management` (test cases and executions of TestRail, Xray Cloud, Zephyr Scale) and the issues labelled
`test-automation`. Code: [`packages/engine/src/calc/automation.ts`](../packages/engine/src/calc/automation.ts),
[`server/lib/calc/automation.ts`](../server/lib/calc/automation.ts).

| Metric | KPI column | Formula |
|---|---|---|
| Test automation coverage | `automation_coverage` | automated test cases ÷ test cases × 100, over the cases known at the end of the day; archived cases not counted |
| Automation ROI | `automation_roi` | (time saved − time invested) ÷ time invested × 100 over the 30 days ending the day; time saved = Σ (manual estimate − run duration, never below 0) over the automated executions of cases with an estimate; time invested = time logged on the test-automation issues resolved in the period; no value without both |

### Developer metrics and performance (not KPIs)

- **Developer metrics** ([`server/lib/developerFromRaw.ts`](../server/lib/developerFromRaw.ts)), per opted-in developer over 30 days:
  PR merge time = mean hours opened → merged; code review time = mean hours opened → first review by someone else; meeting time =
  mean hours per working day in busy intervals inside the working hours (overlaps once); focus time = mean hours per working day in
  free blocks of at least 2 hours; context switches = mean number of separate busy blocks per working day; workload balance and DDPS
  as in section 9. Recalculated on arrival and nightly, with a daily snapshot.
- **Performance** ([`server/lib/ingest/performanceReports.ts`](../server/lib/ingest/performanceReports.ts)): p50, p95, p99, throughput
  per minute and error rate per request name are read from the k6, JMeter or Gatling result file; the page shows the latest run of
  each day. Nothing is aggregated across runs.

## 7. Forecasts (v2 phase 4)

Code: [`server/lib/forecast/math.ts`](../server/lib/forecast/math.ts) (pure maths),
[`server/lib/forecast/store.ts`](../server/lib/forecast/store.ts) (data and storage). Every KPI column and
the QA score are forecast per team.

1. **Weekly points.** The values of the last 26 weeks (one per recorded day) are grouped in 7-day buckets
   ending on the as-of day. Each bucket gives one point: the median value. A week without values gives
   no point; nothing is filled in.
2. **Trend.** A Theil–Sen line through the weekly medians: slope = median of the pairwise slopes,
   intercept = median of (y − slope × x). One odd week does not tilt the line.
3. **Band.** 80 % band from the spread around the line: σ = 1.4826 × median absolute deviation of the
   residuals; half-width at x = 1.2816 × σ × √(1 + 1/n + (x − x̄)² ÷ Sxx). Values are clamped to the
   metric's range.
4. **Horizon.** 8 weeks ahead.
5. **No forecast** (with the reason shown) when there are fewer than 6 weekly points, the history covers
   less than 5 weeks, the latest value is older than 21 days, or σ is more than 35 % of the series'
   usual level.
6. **Target crossing.** Day by day over the horizon, using the target valid on each future day. On target
   now and the line leaves the target: "will miss" (with the earliest and latest day from the band's
   edges). Off target now and the line reaches it: "will reach". Otherwise "on track" or "stays off".
7. **Confidence.** High with 12 or more weekly points and σ ≤ 10 % of the level; medium with 8 or more and
   ≤ 20 %; else low.

Forecasts are stored in `forecasts`, recommendations in `recommendations` (migration `20261130100000_forecasts_recommendations.sql`) and
read with `GET /api/improve/teams/:id`. A team is recalculated when it has none, when they are older than
20 hours, or when a newer value arrived.

## 8. Recommendations (v2 phase 4)

Code: [`server/lib/recommendations/rules.ts`](../server/lib/recommendations/rules.ts) (rules and ranking),
[`load.ts`](../server/lib/recommendations/load.ts) (the facts each rule reads),
[`store.ts`](../server/lib/recommendations/store.ts) (storage and refresh).

Each rule looks at one team's KPI history, forecasts and, where the team sends raw data, the tests,
files, stages, deploys and incidents behind the numbers. It returns at most one recommendation with its
evidence, a next step, the expected effect on one metric (a range) and a confidence. A rule without the
data it needs returns nothing.

"Needs attention" below means: off target now, or on target but forecast to miss it, and not already
forecast to reach the target.

| Rule key | Fires when | Metric |
|---|---|---|
| `flaky_tests` | flakiness needs attention, or is worsening and flaky tests are known; names up to 5 tests with failed runs and rerun time | `test_flakiness_rate` |
| `coverage_gap` | coverage needs attention; names up to 5 files that hold most uncovered lines in the latest report | `test_coverage` |
| `build_time_regression` | build time rose ≥ 25 % in 8 weeks and is off target or worsening; names the stage that grew most (≥ 60 s and ≥ 20 %) | `avg_build_time_minutes` |
| `escape_falling_coverage` | defect escape rate rose ≥ 2 points and coverage fell ≥ 2 points in 12 weeks, escape rate off target | `defect_escape_rate` |
| `sizing_drift` | sizing accuracy is more than ±0.15 from 1.0 and drifting away from it (12 weeks), or carryover is off target | `sprint_carryover` (when it has a target) |
| `wellbeing_blocked` | wellbeing pulse below 60 and blocked time off target | `blocked_time_hours` |
| `mttr_rising` | MTTR rose ≥ 25 % in 12 weeks and is off target or worsening | `mttr_hours` |
| `failing_stage` | a pipeline stage fails ≥ 15 % of at least 10 runs in 30 days and first-time pass rate needs attention | `first_time_pass_rate` |
| `technical_debt` | code quality needs attention and there are high or critical debt items or static-analysis findings | `code_quality_score` |
| `slow_tests` | test execution time needs attention; names the slowest tests of the last 7 days | `test_execution_time_minutes` |
| `change_failure` | change failure rate needs attention; names the service with the most failed changes | `change_failure_rate` |
| `availability` | availability needs attention and has a target; shows downtime per month against the allowed downtime | `system_availability` |

**Expected effect.** From the evidence where possible (for example: fixing the listed flaky tests removes
40–80 % of their share of the rate). Otherwise from the team's own history (`historyEffect`): from the
current value to half-way and all the way to the team's best weekly level of the last 26 weeks, or to the
target when the team once bettered it.

**Confidence.** High when the rule has raw CI evidence and the metric's forecast is not low confidence;
medium with raw evidence or a high-confidence forecast; else low.

**Ranking.** Score = (min(effect size, 5) + urgency) × confidence weight. Effect size = distance from the
current value to the middle of the expected range, in "watch bands" (|target − warning|). Urgency = 0.5
when the forecast says "will miss" or "worsening". Confidence weight: high 1, medium 0.7, low 0.4. Ties
keep the rule order above. At most 6 recommendations are kept.

**Decisions.** On Team detail, **Add to Action plan** creates a tracked action linked to the
recommendation and its metric (`POST /api/improve/recommendations/:id/accept`). **Dismiss** asks for a
reason (`…/dismiss`); **Reopen** undoes it (`…/reopen`); **Recalculate** refreshes the team
(`POST /api/improve/teams/:id/refresh`, rate limited by `IMPROVE_REFRESH_LIMIT`). Who may do what:
[ROLE_ACCESS.md](ROLE_ACCESS.md).

**Action outcomes.** A tracked action linked to a metric records the baseline value, then the value at
completion and 14 and 30 days later, judged improved, unchanged or worse
([`server/lib/actions.ts`](../server/lib/actions.ts)).

## 9. Company and module metrics

Short form; each item has the full rule in the Product guide section given.

| Metric | Formula | Code | Product guide |
|---|---|---|---|
| Company QA score and KPI averages | mean of team values weighted by active team size, over teams with a current value; also unweighted mean, median, 25th percentile, minimum | `distributionOf`, `metricFormulas.ts` | 3.9 |
| Teams vs KPI targets | of the four headline targets with a current value: ≥ 75 % met on track, 50–75 % at risk, < 50 % off track, fewer than 2 values not classified | `teamKpiTrack` | 3.4 |
| Technical debt score (team) | min(100, Σ severity weight of open items); critical 30, high 20, medium 10, low 5 | `TECH_DEBT_SEVERITY_WEIGHTS`, `metricFormulas.ts` | 3.5 |
| Tech debt ROI | investment = effort h × hourly rate; ROI % = (12 × monthly cost of delay − investment) ÷ investment × 100; payback = investment ÷ monthly cost of delay | `TECH_DEBT_ROI_FORMULA` | 3.5 |
| Delivery performance (company) | mean of team DORA level scores (Elite 100, High 80, Medium 60, Low 40) weighted by team size | `analytics.ts` | 3.6 |
| Pipeline health (company) | successful ÷ (successful + failed) pipeline runs in 30 days × 100 | `computeCompanyMetrics`, `analytics.ts` | 3.7 |
| Bottleneck score (stage) | min(100, duration factor + failure factor); duration factor = min(60, max(0, (z + 2) ÷ 4 × 60)); failure factor = (1 − success rate ÷ 100) × 40 | `BOTTLENECK_SCORE_FORMULA` | 3.7 |
| Engineering health (company) | weighted mean of the components with data: delivery 0.35, pipeline health 0.25, tech debt health 0.20, wellbeing 0.20 | `ENGINEERING_HEALTH_WEIGHTS`, `analytics.ts` | 3.8 |
| Developer metrics, workload balance, burnout risk, DDPS | see the guide | `src/data/advancedFeatures.ts`, `server/lib/developerHealth.ts` | 3.10 |
| Wellbeing pulse | team averages, shown only with at least 3 answers | `server/lib/pulse.ts`, `server/lib/privacy.ts` | 3.11, 6 |
| Business impact correlations | Pearson r, two-sided t-test, Benjamini–Hochberg FDR, significant at q < 0.05, at least 6 paired months | `CORRELATION_METHOD`, `analytics.ts` | 3.13 |
| Revenue impact | OLS slope of monthly revenue on each quality metric with 95 % range; what-if = slope × change | `server/lib/revenueImpact.ts`, `server/lib/stats.ts` | 3.13 |

## 10. When calculations run

| What | Long-running server (`npm run server`) | Netlify |
|---|---|---|
| Raw data → metrics | on arrival, in the ingestion request | on arrival |
| Nightly recompute of the last 8 days | `CALC_RECOMPUTE_CRON` (default `41 3 * * *`), `server/jobs/cleanupCron.ts` | `netlify/functions/calc-recompute.ts`, 03:41 UTC |
| Forecasts and recommendations of due teams | with the hourly alert evaluation, `server/jobs/alertsCron.ts` | `netlify/functions/alerts-evaluate.ts`, hourly at :15 |
| Alert evaluation and action outcomes | `ALERTS_EVALUATE_CRON` (default `15 * * * *`) | `netlify/functions/alerts-evaluate.ts` |
| Raw payload retention | daily cleanup; gzipped payloads, per-test / per-file rows and findings kept 13 months (396 days), with the rest of the raw store | `netlify/functions/db-keepalive.ts` |

Times are UTC.

## 11. Hours lost per week

Code: [`packages/engine/src/calc/lostHours.ts`](../packages/engine/src/calc/lostHours.ts) (pure),
[`server/lib/lostHours.ts`](../server/lib/lostHours.ts) (reads and stores). Tables `lost_hours_weekly`,
`lost_hours_state`. Pages: Time lost, Findings, Outcomes ([NEXT_MOVE.md](NEXT_MOVE.md)).

Twelve rolling 7-day windows ending at the end of the current day (UTC). Per team, week and cause:

| Cause | Hours |
|---|---|
| `slow_stage` | Σ over stages: (median duration of the week − the stage's lowest weekly median in the 12 weeks) × runs of the week ÷ 3600, when the difference ≥ 30 s and ≥ 10 % of the best. Successful stage runs; a weekly median needs 5 runs; a stage needs 2 such weeks |
| `flaky_rerun` | Σ duration of pipeline runs that failed and were followed by a successful run of the same pipeline on the same commit |
| `blocked` | Σ over issues and weekdays: hours in a blocked status or flagged that day × 8 ÷ 24 |
| `failed_change` | Σ over failed production changes (the change-failure definition of section 5): min(24, hours from the deploy to its rollback, hotfix or the linked incident's resolution) |
| `review_wait` | Σ over pull requests first reviewed that week: max(0, working hours from opened to first review − the team's lowest weekly median in the 12 weeks) |

Working hours between two instants: 8 for every 24 h on a weekday (UTC). Company figure: the sum over the teams in the
caller's scope. Team state: mean of the last four weeks against the mean of the first four; a move of at least one hour
and 15 % is *slipping* or *improving*. Refresh: when a page asks and the team's rows are older than 6 hours or from an
earlier day, and after the nightly recalculation. The limits of each rule are listed in
[NEXT_MOVE.md, section 3.1](NEXT_MOVE.md#31-hours-lost-per-week-the-calculation).

---

## CI/CD pipeline metrics and the pipeline page

What QE Navigator shows about CI/CD pipelines, where each number comes from and how it is calculated.
Formulas are shared with [metrics_and_calculations.md](metrics_and_calculations.md).

There are two sources of pipeline data:

1. **Raw pipeline runs** (v2 phase 1), sent by the customer's CI to `POST /api/ingest/pipelines`. The
   calculation engine turns them into team KPIs and evidence. This is the recommended path.
2. **The older stage tables** (`pipeline_stages`, `pipeline_execution_summary`), which hold sample data or
   values edited in Manual metrics. The CI/CD pipeline page reads them only for a team that never sent a
   pipeline run.

### 1. Raw pipeline runs (v2 phase 1)

**Sending.** One run per request or a batch, with its stages and their durations and results. Format,
fields and examples: [INTEGRATION_GUIDE.md, section 4A.2](INTEGRATION_GUIDE.md#4a2-pipeline-runs).
Stored in `pipeline_runs_raw` and `pipeline_stage_runs` (migration
`20261129000000_raw_ingestion_phase1.sql`).

**Metrics calculated** per team and UTC day ([`server/lib/calc/engine.ts`](../server/lib/calc/engine.ts)):

| Metric | KPI column | Formula |
|---|---|---|
| Average build time | `avg_build_time_minutes` | median pipeline duration, minutes; cancelled runs excluded |
| Pipeline success rate | — | successful ÷ (successful + failed) runs × 100; cancelled runs excluded |
| First-time pass rate | `first_time_pass_rate` | runs whose first attempt passed ÷ runs × 100 |
| Parallel test efficiency | `parallel_test_efficiency` | Σ shard durations ÷ (shards × longest shard) × 100, median over runs with parallel test stages |

Each value is stored with its evidence (formula, inputs, run ids). On Team detail, **Evidence from CI**
shows the slowest stages, and **How this was calculated** lists the runs behind a value
(`GET /api/ci/teams/:id/evidence`, `GET /api/ci/teams/:id/metrics/:metric`).

**Recommendations that use pipeline data** ([`server/lib/recommendations/rules.ts`](../server/lib/recommendations/rules.ts)):

- `build_time_regression`: build time rose at least 25 % in 8 weeks and is off target or worsening; names
  the stage whose median grew most (at least 60 s and 20 %, with 3 or more runs in each window).
- `failing_stage`: a stage fails at least 15 % of at least 10 runs in 30 days while first-time pass rate
  needs attention.

**Main branch.** Runs on the team's main branch count (Connect your CI → main branch,
`PUT /api/ci/teams/:id/main-branch`; default `main` or `master`). A run without a branch counts as a
main-branch run.

### 2. The CI/CD pipeline page

Component: [`src/components/PipelineVisualization.tsx`](../src/components/PipelineVisualization.tsx).
Routes in [`server/routes/analytics.ts`](../server/routes/analytics.ts):

| Route | What it returns |
|---|---|
| `GET /api/analytics/pipeline-stages?teamId=` | The team's stages (or the company's default stages when the team has none, read-only), each with duration, success rate, CPU, memory, cost per run and bottleneck score, plus the pipeline configuration |
| `GET /api/analytics/pipeline-history?days=14&teamId=` | Daily stage executions: total, successful, failed runs, failure rate and mean stage duration, from `pipeline_execution_summary` |
| `PUT /api/analytics/pipeline-stages/:id` | Edit a stage's values (marked as manually edited) |
| `GET`, `PUT /api/analytics/pipeline-config` | Savings assumptions: time savings %, cost savings %, cost per minute |

**Where the page's data comes from** ([`server/lib/analyticsFromRaw.ts`](../server/lib/analyticsFromRaw.ts)).
When the team sent pipeline runs (section 1), the page shows their stages (`stages_source: "ci"`):

| Value | Formula |
|---|---|
| Stage duration | mean duration of the stage's completed executions (successful or failed) in the last 30 days |
| Stage success rate | successful ÷ (successful + failed) executions × 100, same 30 days; skipped and cancelled executions are left out |
| Cost per run | stage duration in minutes × the cost per minute of the pipeline configuration |
| Order | the order in which the stages start within a run |
| Stage executions per day | completed stage executions of the runs of that day: total, successful, failed, mean duration |

CPU and memory are not in CI data and are not shown. Stages calculated this way cannot be edited
(Manual metrics shows them read-only). A team that never sent a pipeline run sees the older stage tables
(its own stages, else the company default stages).

The history counts **stage executions**, not end-to-end pipeline runs. An empty result shows an empty
state; nothing is simulated.

**Bottleneck score** per stage (`computeBottleneckScores`, `BOTTLENECK_SCORE_FORMULA` in
[`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts)):

```
bottleneck score = min(100, duration factor + failure factor), 1 decimal
duration factor  = min(60, max(0, (z + 2) ÷ 4 × 60))
                   z = (stage duration − mean stage duration) ÷ standard deviation of stage durations
failure factor   = (1 − success rate ÷ 100) × 40
```

Population standard deviation. No score when duration or success rate is missing. Bars turn amber above
40 and red above 70.

**Savings per stage** are arithmetic what-ifs, not forecasts: time saved per run = stage duration × time
savings %; cost saved per run = stage cost × cost savings %. The page says when the built-in default
assumptions are used.

**Who may edit.** The pipeline configuration (one setting per company): super admins and managers. A
stage: super admins, and managers for the stages of teams in their departments. Everyone with the team in
scope may read. See [ROLE_ACCESS.md](ROLE_ACCESS.md).

### 3. Company pipeline health

Shown on the overview and used in engineering health ([PRODUCT_GUIDE.md, 3.7 and 3.8](PRODUCT_GUIDE.md#37-pipeline-health-and-bottleneck-score)):

```
pipeline health = successful ÷ (successful + failed) pipeline runs in the last 30 days × 100
```

over the active teams in scope, from the pipeline runs they sent (`pipeline_runs_raw`, counted as the engine
counts them for the daily pipeline success rate). Cancelled runs are excluded; no value without completed
runs. Weight in engineering health: 0.25.


---

## Flaky test intelligence

How QE Navigator finds flaky tests, the flakiness KPI, and what the Flaky tests module shows.

A **flaky test** is a test that both failed and passed on the same code. Plain failures (a test that
fails every time on a commit) are real failures, not flakiness.

### 1. From raw test reports (recommended)

Send every test report of every CI run, including reruns, to `POST /api/ingest/tests` (JUnit XML, TRX or
Cucumber JSON; [INTEGRATION_GUIDE.md, section 4A](INTEGRATION_GUIDE.md#4a-raw-ingestion-tests-coverage-pipelines-v2)).
Send the attempt number of a rerun so reruns are counted.

The calculation engine ([`server/lib/calc/engine.ts`](../server/lib/calc/engine.ts)) then computes per
team and UTC day:

| Metric | Formula |
|---|---|
| Flaky tests | tests that both failed and passed on the same commit within the last 7 days, or failed and then passed in a rerun inside one run |
| Test flakiness rate (`test_flakiness_rate`) | flaky tests ÷ distinct tests run in the last 7 days × 100 |

Each flaky test is stored in `flaky_test_evidence` with the commit and the ids of the failed and passed
runs. On Team detail:

- **Evidence from CI** lists the flaky tests of the last 30 days with the runs that prove them
  (`GET /api/ci/teams/:id/evidence`).
- **How this was calculated** on the flakiness KPI shows the formula, the counts and the runs
  (`GET /api/ci/teams/:id/metrics/test_flakiness_rate`).

The flakiness KPI has a default target of ≤ 2 % (watch ≤ 5 %) and is one of the four headline KPI targets.

**Recommendation.** The `flaky_tests` rule fires when flakiness is off target, forecast to miss its target,
or worsening with flaky tests known. It names up to 5 tests with their failed runs and the rerun time, and
suggests quarantining them in CI and fixing them this sprint. Its expected effect assumes that fixing the
listed tests removes 40–80 % of their share of the rate. See
[metrics_and_calculations.md, section 8](metrics_and_calculations.md#8-recommendations-v2-phase-4).

### 2. The Flaky tests module (Analytics → Flaky tests)

Component: [`src/components/FlakyTestIntelligence.tsx`](../src/components/FlakyTestIntelligence.tsx).
Route: `GET /api/analytics/flaky-tests?teamId=` ([`server/routes/analytics.ts`](../server/routes/analytics.ts)).

When the team sent test reports (section 1), the module shows the same evidence as Team detail
([`server/lib/analyticsFromRaw.ts`](../server/lib/analyticsFromRaw.ts), `source: "ci"`), per test (up to 50,
highest score first):

- the test (suite › name) and the commits on which it failed and passed;
- **flaky runs**: the runs in which it failed on such a commit, in the last 30 days; its runs and passes in the
  same 30 days;
- **flakiness score** = flaky runs ÷ runs of the test in the last 30 days × 100;
- its last 20 results (pass or fail), first and last seen.

No pattern and no root cause are shown: QE Navigator receives test names, results and durations only (failure
messages and logs are never sent or kept), so no cause is derived.

A team that never sent a test report sees the older `flaky_tests` table (tracked flaky tests), which holds
sample data only. For those rows, per test (up to 50, highest stored flakiness score first):

- test name, stored flakiness score, failure pattern label, failures, passes and total runs, first and
  last seen;
- the last 20 recorded executions of the test (pass or fail), from `test_executions`;
- **root cause and suggested fix.** A root cause is shown as verified only when a person or tool stored
  one. Otherwise the page shows "Pattern: <label> (unverified, not derived from error logs)" and generic
  guidance for the pattern (timing, environment, data, network, unknown). No error log is analysed.

When the table has no rows for the team, the page shows an empty state; nothing is generated.

### 3. Sample data

With sample data on (operator **Demo Data** or **Populate metrics**, or `npm run seed:demo`), both the raw
test runs and the `flaky_tests` table are filled for demo teams. Sample rows are marked as sample and can
be removed. See the README, "Sample (demo) data".

### 4. Who sees what

Everyone with the team in their analytics scope sees the module and the evidence
([ROLE_ACCESS.md](ROLE_ACCESS.md)).


---

## Business impact: correlations and revenue impact

How the Business impact page (Analytics → Business impact) relates a team's quality metrics to its
business results. The full rules, with every edge case, are in
[PRODUCT_GUIDE.md, section 3.13](PRODUCT_GUIDE.md#313-business-impact-money-revenue-impact-and-correlations).

Results are exploratory. Correlation does not show causation: two monthly series that share a trend can
correlate without any causal link. The page says so next to the results.

The page itself explains all of this: **How this works** (an expander at the top of every tab,
`src/components/BusinessImpactHowItWorks.tsx`) covers what goes in, how links are found, how the money
figures are derived, which inputs are assumptions and what the labels mean; every figure and every tile on
Details opens **How this was calculated** with its formula, its inputs and its sample size.

### Data

Monthly values per team, entered on the page (or by the session API, see
[INTEGRATION_GUIDE.md, section 5.2](INTEGRATION_GUIDE.md#52-business-impact-monthly-data-business-impact-money-what-if-details-all-teams)),
or sample data.

| Kind | Fields (`server/routes/analytics.ts`) |
|---|---|
| Quality metrics (`BI_QUALITY_FIELDS`) | test coverage, defect density, defect escape rate, MTTR, deployment frequency, lead time, code quality score, change failure rate |
| Business KPIs (`BI_KPI_FIELDS`) | monthly revenue, active users, churn rate, feature adoption rate, NPS, CSAT, support ticket volume |

Units: one value per month. Deployment frequency is **deployments per month** (its KPI target is per week and
is converted with × 52 ÷ 12). Quality metrics are entered, or for sample data the month's average of the team's
daily KPI values (the values on Team detail, calculated from CI data where connected). Business KPIs are always
company data (finance, product analytics, CRM, surveys, support); QE Navigator does not measure them.

Routes: `GET /api/analytics/business-impact-v2/:teamId`, and `POST` sub-routes `quality-metrics`,
`business-kpis`, `context`, `bulk-save` and `calculate-correlations`.

### Correlations

`CORRELATION_METHOD` in [`server/routes/analytics.ts`](../server/routes/analytics.ts):

- Pearson r for each quality × business pair, over the months where both values exist, in the same month
  (no lag). Recalculated from the stored months on every page load (the stored correlation rows are a cache).
- Two-sided Student t-test, df = n − 2, exact p.
- Benjamini–Hochberg false-discovery-rate correction across all pairs tested for the team.
- **Significant when q < 0.05.**
- Needs at least 6 months of each series and 6 paired months. Pairs with zero variance are skipped.
- Strength label: |r| ≥ 0.7 strong, ≥ 0.5 moderate, ≥ 0.3 weak, otherwise none.

**Summary.** Details shows a summary written by fixed rules (`server/lib/correlationSummary.ts`, returned
as `plainSummary` by the GET): the months and pairs tested, the significant pairs in plain words (direction, r, q,
months), a warning when half or more of the pairs are significant (one shared movement, not many separate effects),
and, when none is, the strongest pair and the |r| needed for p < 0.05 with that many months. **Generate AI summary**
asks the Groq service when `GROQ_API_KEY` is set (`POST …/ai-analysis`, rate limited) and labels the text as AI
output; without the key, or when the provider fails, the endpoint returns the rule-based summary
(`source: 'rules'`) instead of an error.

### Revenue impact

Code: [`server/lib/revenueImpact.ts`](../server/lib/revenueImpact.ts), [`server/lib/stats.ts`](../server/lib/stats.ts).
Routes: `GET /api/revenue-impact/teams/:teamId`, `GET /api/revenue-impact/teams/:teamId/what-if?metric=&change=`,
`GET /api/revenue-impact/rollup`.

- **Revenue per metric.** Ordinary least-squares slope b of monthly revenue on each quality metric, with
  its standard error, t-test (df = n − 2) and 95 % range. Shown from 6 paired months. Significant when
  p < 0.05; not corrected for multiple comparisons.
- **Company-wide slope** (`pooledRevenueFit`). When the team's own slope is not significant (or the metric did not
  change), the company's teams are fitted together, each against its own averages: x = metric − team average,
  y = revenue ÷ team average revenue − 1; b = Σxy ÷ Σx² (share of revenue per +1 unit), SE with
  df = N − teams − 1, 95 % range, at least 2 teams of the same kind of source (sample or recorded) with 6 months each.
  If that slope is significant, the team's $ slope = b × the team's average monthly revenue, labelled
  **Company-wide evidence**; the team's own fit stays visible next to it. Only counts leave the company fit, no
  other team's figures.
- **Where the money is going now:** quality below target (b × gap to the target, for significant
  slopes; metrics below target are counted first, so a metric already at its target never hides a gap in a
  metric that moves with it), open technical debt (monthly cost of delay), downtime (minutes × cost per minute), support
  tickets (tickets × ticket cost), churn (churn % × monthly revenue). The causes overlap, so there is no
  total.
- **What you gain when these are fixed**, biggest first, and **where to put the money first** (by
  monthly gain, or by return on cost for debt items with an effort estimate).
- **What-if:** projected monthly change = b × change, with the range; disabled when the slope is not
  significant; values outside the recorded range are flagged as extrapolation.
- **All teams:** the sum over the teams of the caller's scope (super admins: the company; managers:
  their departments).

Rates (hourly rate, ticket cost, revenue per user, downtime cost per minute, SLA penalty) come from
Parameters → Financial and ROI settings (team, else department, else company). They are **assumptions the
company sets**; built-in defaults are labelled "(default)" and "Default rates".

Confidence labels: **Strong evidence** (the team's own slope, p < 0.01), **Some evidence** (p < 0.05),
**Company-wide evidence** (see above), **Cost estimate** (arithmetic on entered impact and the rates; no statistics).

What the page does not claim: that a metric causes revenue to move, a forecast, or that reaching a target brings the
money back. The figures are associations in the company's own monthly history.

### Sample data

The demo generator (`server/seeds/demoData.ts`, also used by the operator's Demo Data and Populate metrics and the
Meridian reseed) writes 12 months per team: quality as the month's averages of the team's daily KPI values
(deployments per month = weekly average × days ÷ 7), business KPIs following the team's health (revenue grows slowly
and moves with quality), context (downtime from the availability KPI), the correlations cache and the data status.
For a filled company it also adds the **Financial and ROI settings** the sample assumes, only where the company has
none of its own: developer hourly rate 85, support ticket cost 30, SLA breach penalty 2500 (company), and per team
the revenue per user (the team's sample revenue per active user) and the downtime cost per minute (the team's monthly
revenue ÷ 43 200 minutes). The sample technical debt's cost of delay uses the same rates.

### Who sees and edits what

Everyone with the team in scope reads Money, What-if and Details. The All teams roll-up is for super
admins and managers. Editing business data and running correlations: super admins, managers for their
departments, team leads for the teams they lead. See [ROLE_ACCESS.md](ROLE_ACCESS.md).
