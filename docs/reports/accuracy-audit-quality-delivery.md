## Audit: quality and delivery pages (read-only, nothing edited)

Most numbers on these pages are not measurements. Almost every table behind them is filled by random generators. Several components also make up more numbers in the browser. None of these pages tells the user that the data is sample data.

### How the synthetic data gets in
- **Pipeline seeder, every 5 minutes and at startup** (`server/jobs/intervalSync.ts:432`, startup `setTimeout` around :460, calling `runPipelineSeederForAllCompanies`): it rewrites `pipeline_stages` with `addVariance(base…)` blends (`pipelineSeeder.ts:145-177`). It inserts 3 fake runs per stage, with random SHA, branch and pass/fail, into `pipeline_runs` (`:228-257`). It then rebuilds `pipeline_execution_summary` and `pipeline_stage_history`. In the live DB, stages were updated today at 20:15 and there are 1,254 runs since yesterday.
- **Daily job at 00:30** (`analyticsSync.ts:584`, `updateDailyAnalytics`): it applies a `RANDOM()` drift to `pipeline_stages` and inserts random `business_impact_metrics`, `test_execution_runs` and `performance_metrics`.
- **`POST /analytics/seed-data`** (super admin, `seedAllAnalyticsData`): fills random `test_cases`, `flaky_tests`, `test_execution_runs`, `performance_metrics` (30 days) and `technical_debt`.
- **Hourly sync** (`intervalSync.ts:138-166`): writes `Math.random()` KPI values into `kpi_snapshots` for teams that are not excluded and not manually edited.
- **GET handlers that write on page load:**
  - `/pipeline-stages?teamId` copies the company default stages into team rows (`analytics.ts:~915`), and the 5-minute seeder then randomises them.
  - `/pipeline-config` inserts a default config.
- **GET handlers that invent data when the table is empty:** `/flaky-tests` returns 5 hard-coded tests with `Math.random()` histories (`analytics.ts:243-325`), and `/pipeline-history` returns a random 14-day history (`:852-869`).

The DB contents fit this: every `performance_metrics` row has a `pm-` prefix (generator ids), 40 of the `technical_debt` rows have `td-` prefixes, and `test_execution_runs` all have `ter-` prefixes.

## Findings, most severe first

**C1 – Critical – The Reports PDF is entirely mock data.** `src/components/PDFReportGenerator.tsx:24-60`, `getMockData()` ("Mock data - in production, this would come from your API"). It produces a pass rate of `94.5 + Math.random()*2`, coverage, bug counts, and trends like "+x% quality improvement". The team table is hard-coded (Nebula, Atlas, Sentinels, Voyagers, which are not the client's teams). It also includes hard-coded top issues and ROI figures ("$15,000 + days*100" cost savings). The PDF is titled "Executive Summary" and labelled "Confidential". The page is in the main nav as Delivery → Reports (`Layout.tsx:60`). "Avg Execution Time" is shown in "ms". **Fix:** hide the page, or build the PDF from real endpoints (kpi_snapshots, /teams). Until then, watermark every page "SAMPLE DATA".

**C2 – Critical – Fabricated charts and claims on the Performance page** (`PerformanceTesting.tsx`):
- The trend chart and the "Current P50/P95/P99" tiles come from `baseline + Math.sin(idx/3)*10 + (Math.random()-0.5)*15` (`:117-146`). They are not history. The "24h" view draws 24 hourly points even though the data is daily.
- "Load Test Results – Capacity Planning" is random data (`:150-155`). It sits next to hard-coded claims: "~700 concurrent users", "40% capacity headroom" (`:394-397`).
- Each endpoint card's sparkline is random (`:447`).
- "Uptime Target … ✅ Meeting SLA" is hard-coded with no data behind it (`:655-657`).
- **Fix:** plot the real `performance_metrics` rows by `recorded_date`. Delete the load-test section and the capacity text unless a real load-test source exists. Remove the uptime verdict.

**C3 – Critical – Pipeline numbers are random but labelled "manually configured".** `PipelineVisualization.tsx:530` says the data is "manually configured in Admin Panel > Manual Metrics Input". In fact the 5-minute seeder overwrites duration, success, CPU, memory and cost. It does skip rows with `manually_edited`. However `updateDailyAnalytics` (`analyticsSync.ts:430-439`) runs `UPDATE pipeline_stages … RANDOM() … WHERE company_id = ?` with no `manually_edited` filter, so values users entered get random drift every night. That update also has no lower bound on duration. **Fix:** stop both generators in production. Add `AND NOT COALESCE(manually_edited,false)` to the daily update. Correct the footnote, or show a "simulated" badge.

**C4 – Critical – Pipeline history invents failures and fake history.** `analytics.ts:838`: `minFailed = Math.max(1, Math.round(totalRuns*0.01)); adjustedFailed = Math.max(failedRuns, minFailed)`. This forces at least a 1% failure rate even when no runs failed, and lowers the success count to match. Lines `:852-869` return a random history when the table is empty. **Fix:** return the actual counts. Return `[]` when empty and show "No pipeline runs recorded".

**C5 – Critical – Flaky test "root cause" claims log analysis that never happens.** `analytics.ts:339-375` maps `failure_pattern` to canned text such as "timeout keyword detected in error logs" and "ECONNREFUSED keyword detected". No error log is read: the ingest/classifier is commented out at `:178-204`, and the stored `ft.root_cause` / `suggested_fix` columns are ignored. When no rows exist, 5 fabricated tests are returned (`:243-325`). All 7 real rows (`ft-`) are seed data. **Fix:**
- Show "Pattern: timing (unverified)" instead of claiming log evidence.
- Return `[]` when there are no rows.
- Mark the seeded rows as samples.

**C6 – Critical – Manual Metrics "Generate Team/Developer Metrics" buttons.** `ManualMetricsInput.tsx:551-830, 1591-1621, 1824-1857`. They fill random "excellent … horrible" values, which are then saved via `/metrics/manual` with `manually_edited = TRUE`. That makes them look like data a person entered, and it shields them from sync. **Fix:** remove the buttons in production, or save their output with a `is_sample` flag that the dashboards display.

**H1 – High – Tech-debt header "Cost of Delay $80K" adds up random legacy values.** `TechnicalDebtTracker.tsx:71` sums `d.cost_of_delay`. The server sends `Number(d.cost_of_delay) || roi.monthlyCost` (`analytics.ts:629`). For the 40 seeded `td-` rows, `cost_of_delay` is `randomBetween(100,5000)`. The cards show the computed `monthly_cost_of_delay` instead. Live example: one item shows $3,550.61 in the header sum but "$25 Monthly Loss" on its card. The header shows $79,758 against a computed total of $112,420. The priority matrix "Impact ($K)" axis (`:96`) and the "cost" sort (`:66`) use the same bad field. The `annual_savings || cost_of_delay*12` fallbacks (`:103, 151, 757, 848`) show savings that contradict an ROI of −100%. **Fix:** use `monthly_cost_of_delay` everywhere, drop the `cost_of_delay` fallbacks, and label the header "/month".

**H2 – High – Tech-debt "Priority Score" is random or zero.** It is seeded with `randomBetween(20,100)` (`analyticsSync.ts:359`), and 23 of 43 rows show 0.0. Nothing computes it, but it drives the default ordering and the matrix bubble size. **Fix:** compute it, for example from ROI, severity and cost of delay, or hide it.

**H3 – High – Financial-config inheritance is reversed.** `analytics.ts:523`: `ORDER BY team_id IS NOT NULL DESC` puts team overrides first, then the loop overwrites them with company values. Company settings therefore beat team settings. **Fix:** order `ASC` so the team rows are applied last. The UI also hard-codes "$75/hr", "$25/ticket" and so on (`TechnicalDebtTracker.tsx:528-615, 737`) even when the config differs. Render these from `financial_config`.

**H4 – High – Pipeline header metrics are wrong.**
- The company view has 19 stages with duplicate names (Build ×2, Unit Tests ×2, and so on), because both seeders create stages (`analyticsSync` adds "Checkout, Lint & Format…"). As a result "Duration" (`PipelineVisualization.tsx:294`) sums about 54 minutes instead of about 20. "Cost" is double-counted the same way.
- "Success" (`:295`) is the mean of the stage success rates. For a sequential pipeline the end-to-end success rate is the product of the stage rates (about 70%, not about 94%).
- The server uses `Number(s.success_rate) || 100` (`analytics.ts:968`), so a 0% stage displays as 100%.
- **Fixes:** remove the duplicates and add a unique key on (company, team, name). Compute success as Πrᵢ, or as successful pipeline runs ÷ total runs. Use `?? 100` only when the value is null.

**H5 – High – Pipeline history aggregates mislabelled.** `/pipeline-history` sums stage executions as "runs" and takes `AVG(avg_duration_seconds)` across stages, which is a mean of stage durations, not pipeline duration (`analytics.ts:818-826`). It ignores `teamId`, so the team view shows company-wide data. Cost uses the current `cost_per_run`, not the cost at run time (`pipelineSeeder.ts:289`). "Avg Failure Rate" is an unweighted mean of daily rates (`PipelineVisualization.tsx:433`). **Fix:** group by run or commit, weight by runs, and filter by team.

**H6 – High – QA Score formula treats missing data as perfect, and two formulas disagree.** `metrics.ts:305-319`:
- `Number(defect_escape_rate) || 0` gives a missing value (100−0)×0.25, a free 25 points. The same happens for change-failure rate.
- The UI sends only the metrics that were filled in (`ManualMetricsInput.tsx:1652`). A partial save (for example only sprint fields) recomputes the score as 50 → "critical" and overwrites the stored score (`qa_score = EXCLUDED.qa_score`), even though COALESCE keeps the old inputs.
- The hourly `recalculateQAScore` (`intervalSync.ts:236-245`) uses a different 6-factor formula. The displayed formula text (`ManualMetricsInput.tsx:1901`, `metrics.ts:713`) only matches the first formula.
- The snapshot placeholder stores `qa_score 0, status 'warning'` (`intervalSync.ts:187`), which contradicts the thresholds.
- **Fix:** compute from the merged row after the upsert. Return null or "insufficient data" when inputs are missing. Use one shared formula.

**H7 – High – Performance units and aggregation.** The DB column is `throughput_per_minute`, but the UI shows "/s" and "req/s" (`PerformanceTesting.tsx:186, 516`), off by 60×. "Avg P95" is a mean of p95 values over endpoint×day rows; averaging percentiles does not give a percentile. Error rate is not weighted by volume. The cards and the "Degraded" count work on raw rows, so one endpoint appears once per day. **Fix:**
- Label the unit "/min".
- Group to the latest row per endpoint.
- Say "mean of daily p95", or use the max or a weighted value.
- Count distinct endpoints.

**M1 – Medium – Inconsistent performance thresholds.** The score uses p95 <200/<500 (`:25`). SLA compliance uses `slaConfig.responseTimeMs` (default 500), so an endpoint can be "Poor/Requires Optimization" and "Meeting SLA" at the same time. The method is forced to `'GET'` (`:94`).

**M2 – Medium – Flaky-test labels.**
- "20-Day History" is really the last 20 executions, which span about a month.
- "Total Runs" shows `history.length`, capped at 20, while `total_runs` is ignored (`FlakyTestIntelligence.tsx:237, 317`).
- The flakiness score has no defined formula (stored 78 against a 75% failure rate). Under the industry definition, a test with a 65–75% failure rate is broken, not flaky; flakiness means pass/fail flips on the same commit.
- `test_flakiness_rate` in the KPIs is derived from synthetic `pipeline_runs`, counts pure failures at 0.5, caps at 15%, and falls back to `1 + Math.random()*3` (`intervalSync.ts:39, 75, 83`).

**M3 – Medium – Tech-debt "Average ROI".** It is the mean of the per-item percentages (2,428%) (`TechnicalDebtTracker.tsx:104`). Portfolio ROI should be (Σsavings − Σinvestment) / Σinvestment.

**M4 – Medium – Formula text that does not match the calculation in ManualMetricsInput.**
- Bottleneck text says "(duration / avg) × 50 + (100 − success_rate) × 3" (`:2493`), but the server uses a z-score×60 plus failure×40 formula.
- Defect density text says "× 1000", but the input is already in KLOC.
- Lead time text says "Median", but the input asks for "Average".

**L1 – Low – Test Execution Timeline display issues.** The duration shows as "1.5m 30s" because it mixes decimal minutes with `% 60` (`TestExecutionTimeline.tsx:747-767`). The API's `LIMIT 100` silently truncates the status counts. The data is entirely generated and is currently empty, because the latest run is 2026-07-03 and the page asks for 7 days.

## Where each page's numbers come from

| Page | Real DB / user input | Synthetic (generated by jobs) | Hard-coded / random in code |
|---|---|---|---|
| Flaky Tests | none in practice | all 7 `flaky_tests` rows and the `test_executions` history | 5 fallback tests and the root-cause text |
| Tech Debt | impact fields (where entered), ROI arithmetic | 40 `td-` rows: cost_of_delay, priority, effort, age | $75/$25/$100/$50/$1K labels |
| CI/CD Pipeline | rows marked `manually_edited` (until the nightly drift) | stages, runs, summary, history (every 5 min) | 1% failure floor, empty-state history, savings % defaults |
| Performance | none (all `pm-` rows) | all rows | trend chart, current p-values, load test, capacity text, uptime verdict |
| Test Execution | none | all `ter-` rows | — |
| Reports PDF | none | — | everything |
| Manual Metrics | user-entered inputs | hourly KPI generators | "Generate" buttons |

## What is correct
- Most of the formulas in ManualMetricsInput are right and guard against division by zero: coverage, escape rate, CFR, commitment and carry-over, automation ROI, availability, MTTR average.
- The tech-debt `calculateROI` arithmetic is right: monthly cost-of-delay components, ROI = (12×CoD − investment) / investment, payback = investment / monthly CoD, and Infinity is handled as null.
- The bottleneck z-score is internally consistent between the seeder and the GET handler.
- Flaky pass rate is computed correctly from the history it is given.
- The empty-state guards for Performance averages work.
- The flaky-history ordering and de-duplication work.
