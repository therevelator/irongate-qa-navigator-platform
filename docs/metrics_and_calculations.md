# Metrics and calculations

How every number in QE Navigator is calculated, with the code that does it. This is the formula
reference for engineers and analysts. The full description of each metric (why it matters, targets,
production sources, screens) is in [PRODUCT_GUIDE.md, section 3](PRODUCT_GUIDE.md#3-the-metrics).

Principle: **raw data in, we calculate.** Customers send the raw output of their tools (test reports,
coverage reports, pipeline runs, deployments, commits, incidents); the calculation engine turns it into
metrics and keeps the evidence. The older KPI ingestion API (`POST /api/ingest/kpis`), where a customer
sends a finished value, still works and is used for metrics that have no raw source yet. Nothing is
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
