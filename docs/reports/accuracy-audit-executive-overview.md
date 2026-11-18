## Accuracy audit: executive overview and team scores

I checked everything against the code, the live API (admin, company `novatech`) and the Postgres snapshot. I did not edit any files and did not call `POST /company-insights`, because it writes rows to the DB.

**Background that matters for most findings:**
- The newest KPI snapshot for every active team is dated **2025-12-07**, about 11 months before today.
- All of those snapshots are `manually_edited = TRUE`.
- None of the pages show an "as of" date, so the old data is presented as current.

### CRITICAL: fabricated or random values shown as real

1. **Pipeline Health is hardcoded to 96.**
   - Where: `server/routes/analytics.ts:2456` (`const pipelineHealthScore = 96; // (Constant as requested)`) and again at `:2591`.
   - What users see: "Pipeline Health 96 / CI/CD Stability" in the hero and the dashboard tile.
   - It also carries 25% of the weight in `engineeringHealthScore` (`:2459`), and the 96 is saved into `company_kpi_snapshots`. All 4 history rows contain 96.
   - The real company average of `pipeline_stages.success_rate` is 95.11. Those rows come from the 5-minute `pipelineSeeder` (`Math.random`), so they are synthetic as well.
   - Fix: compute it from real pipeline data, or show "—".

2. **Task Sizing Accuracy is random, and its label is always "Well estimated".**
   - Where: `server/routes/teams.ts:192` sets `taskSizingAccuracy: 0.85 + Math.random() * 0.3`. It is shown in `TeamDetailView.tsx:627-706`.
   - The range 0.85–1.15 can never trip the `<0.85` (Overestimated) or `>1.15` (Underestimated) labels, so every team reads "Well estimated". The value also changes on every reload.
   - The real column `kpi_snapshots.sizing_accuracy` exists and is ignored.
   - Fix: use `k.sizing_accuracy`, or `null` and show "—".

3. **The team Overall Quality Score card has a hardcoded "+5.2%" up arrow.**
   - Where: `TeamDetailView.tsx:739`. It appears on every team, including the one scoring 33.
   - Fix: remove it, or compute the change from `kpi-history` `qa_score`.

4. **Developer metrics are invented for team members with no DB row.**
   - Where: `TeamDetailView.tsx:462-473`. When a member has no data, it shows `happiness_score: Math.floor(Math.random()*30)+70`, plus random PR merge, review, focus and meeting times.
   - There is no "placeholder" marker anywhere in the UI.
   - Fix: show "No data".

5. **Per-KPI cards fill missing fields with random numbers.**
   - Where: `src/data/detailedKPIs.ts:80-85` (`getValue` returns `mockMin + Math.random()*(mockMax-mockMin)` whenever that field is null). It also builds 30 days of random `history` when a team has no data at all (`:64-77`). These feed TeamDetailView's category cards and charts.
   - Because this works field by field, a team with partial real data gets random values in the gaps.
   - In those cases `getStatus(null)` returns `'warning'`, so the badge doesn't even match the random number next to it.

6. **Developer Wellness, and therefore Engineering Health, are invented when there is no developer data.**
   - Where: `analytics.ts:2408-2410` uses `happiness || 75`, `focus || 4`, `meetings || 3`.
   - With no `developer_metrics` rows, the tile shows **83/100** (45 + 20 + 10 + 8) and happiness 75 goes into Engineering Health. A real average of 0 is also replaced by 75.
   - Fix: return `null` and show "—".

7. **The sync job writes `Math.random()` KPIs as real snapshots.**
   - `server/jobs/intervalSync.ts` runs at startup and every hour (imported in `server/index.ts:20`). Its `metricGenerators` (`:138-166`) are all `Math.random`, and `qa_score`/`status` are then recalculated from them.
   - Flakiness falls back to `1 + Math.random()*3` whenever there is no pipeline data (`:39, 75, 83`).
   - Today it skips these teams because their snapshots are manual. Any new or un-edited team gets random "measurements" every hour, which then appear in every view.
   - `syncMetrics.ts` (`generateMockKPIs`) is the same idea but is disabled.

### HIGH: wrong formula or wrong number

8. **Two different QA Score formulas write to the same `kpi_snapshots.qa_score` column.**
   - Manual entry (`metrics.ts` `POST /manual`): `cov*.30 + (100-escape)*.25 + (100-CFR)*.25 + codeQuality*.20`. The stored values match this; QualityCowboys = 87.26 → 87.
   - Sync job (`intervalSync.ts:236-243`): coverage, automation, defect density, code quality, first-time pass rate and flakiness. On the same rows this gives 79 / 95 / 74 instead of 87 / 100 / 81.
   - The tooltip (`TeamDetailView.tsx:146`) describes the sync formula. The formula text in `/team/:id/all` describes the manual one.
   - So the same team's score depends on which path wrote it last.
   - Separately, in manual entry a missing escape rate or CFR becomes 0 and counts as **100% good**. On a partial update, `qa_score` is recomputed from the submitted fields only, while `COALESCE` keeps the old values for the other columns, so the score no longer matches the stored metrics.

9. **Tech Debt Status counts inactive teams' debt.**
   - Where: `analytics.ts:2364-2386`. The SQL has no `t.is_active` filter, but the result is divided by the number of active teams.
   - Shown: **27.8**. Correct (active only): 100 − 570/9 = **36.7**. The inactive team MonsterCoders adds 80 weight.
   - The same leak inflates `/metrics/dashboard` openDefects: 43 instead of 37.

10. **The Team Technical Debt Score uses two different weight sets.**
    - `teams.ts:10-15`: 30/20/10/5. `metrics.ts:565-577` (`/team/:id/all`, shown in ManualMetricsInput): 20/10/5/2.
    - Mavericks shows **100** on the team page and **65** in the metrics view.
    - Its polarity is also opposite to the company tile: the team metric is "Lower is better", while the company "Technical debt" tile is captioned "Higher is healthier".

11. **`getDORALevel` treats a real 0 as missing.**
    - Where: `metrics.ts:906-909`, e.g. `Number(kpi.change_failure_rate) || 100`.
    - A team with 0% CFR, 0 h MTTR or 0 days lead time is scored as 100% / 999 and classified **Low**.
    - Fix: check for `null` explicitly.

12. **Developer Wellness uses a wrong join, and the hero and AI briefing disagree.**
    - `company-summary` (`analytics.ts:2400-2404`) joins through `team_members` instead of `dm.team_id`. It uses 3 of the 9 developer rows and can double-count people on several teams.
    - Hero shows wellness 60 and health 69. Using all active-team rows gives 63 and 70.
    - `company-insights` uses `dm.team_id` and its `kpiData` query (`:2521-2531`) has no `is_active` filter. Its average QA is 78.5 versus 87 in the hero, so the briefing and stored history use different numbers from the hero.

13. **"30-Day Health Trend" is not 30 days.**
    - Where: `analytics.ts:2631-2636` uses `ORDER BY snapshot_date ASC LIMIT 30`, which returns the oldest 30 rows ever. Rows are only written when someone clicks the button.
    - The current chart has 4 bars spanning 2025-12-07 to 2026-07-04 (`CompanyHeroSection.tsx:415`). The AI prompt is told this is "30-day trend data".
    - Fix: `WHERE snapshot_date >= CURRENT_DATE - 30`.

14. **`/metrics/analytics/history` would crash as soon as it has data.**
    - Where: `metrics.ts:44-55` calls `row.avg_x?.toFixed(2)`, but pg returns NUMERIC/AVG as strings (`db.ts:5-7`), so this throws "toFixed is not a function" and returns a 500.
    - It currently returns `[]` only because the data is stale.
    - Fix: `Number(row.avg_x).toFixed(2)`.

15. **The trend arrow colour ignores which direction is good.**
    - Where: `TeamDetailView.tsx:1097` always colours `up` green and `down` red. Rising defect density, flakiness, CFR, MTTR or build time shows green.
    - "% vs last period" compares the last two snapshots, whatever the gap between them.

### MEDIUM: misleading labels and inconsistencies

16. **Stale data is shown as current.** The hero and dashboard show 11-month-old snapshots with no date. `globalQaScoreTrend` (`analytics.ts:2194-2204`) defaults to 0 when the 7–14-day window is empty, so the summary says **"Quality metrics stable"**. That window also averages all snapshots, including inactive teams, against the latest score per active team.

17. **The company DORA bands don't match `getDORALevel` or DORA itself.**
    - `analytics.ts:2447-2449`: High CFR <15%, Medium CFR <30% and MTTR <48 h.
    - `getDORALevel`: High CFR <10%, Medium CFR <15% and MTTR <168 h, which is close to DORA 2023.
    - Elite deploy frequency is "≥7/wk", which is daily, i.e. DORA "High". Elite should be on-demand, multiple deploys per day.
    - `deployment_frequency_per_week` is an `integer` column, so monthly deployers (0.25/wk) are stored as 0 and the Medium band can't be reached.
    - The company score is calculated from cross-team averages, which outliers skew.
    - Company averages also turn null fields into 0 (`|| 0`, `:2439-2442`), which makes Elite thresholds easier to hit.

18. **QA thresholds conflict.**
    - Server status: good ≥85, warning ≥70.
    - riskLevel: at-risk <60, watch <75.
    - Dashboard "Needs attention" card lists teams below 85 (currently 33, 81, 83), but the table's "Needs attention" filter uses <75 (`NewDashboard.tsx:122`), so it shows only the 33.
    - Table tone is 85/75 (`:335`), while the global score progress bar uses `scoreTone` defaults of 80/60.

19. **Metric thresholds differ by page.**
    - MTTR: config 2/8 h, header card 1/4, `detailedKPIs` 1/24.
    - MTBF: config 720/168, card 120/72, `detailedKPIs` 100/50.
    - Defect escape rate: config ≤5% good vs company KPI target ≤2%.
    - Flakiness: ≤2 vs ≤3.
    - Coverage insight: 80/60 vs 80/70.
    - Build time: card ≤12, insight ≤10, `detailedKPIs` 10/15.
    - CFR insight: the ≤15% "moderate" case gets a green border (`TeamDetailView.tsx:1285`) next to amber text.

20. **Nulls are shown as good or bad.** `TeamDetailView.tsx:271-278` turns null into 0: MTTR "—" is labelled "Excellent", MTBF "Volatile", coverage "0.0% Low". `teams.ts:138` gives a team with no snapshot `qaScore: 0` and status `critical`.

21. **`/team/:id/all` formula text is wrong or unenforced.**
    - The "Avg Developer Happiness" formula describes a meeting/switch calculation, but the value is just `AVG(happiness_score)`.
    - "Active Developers (30d)" has no 30-day filter.
    - The QA formula text doesn't match stored sync-path scores (finding 8).
    - Burnout thresholds (focus <3) differ from company-summary (focus <2).

22. **Other labels.** The QA score is shown as "%" (`TeamDetailView.tsx:742`) instead of /100. "Work-Life Balance" is actually focus/(focus+meetings). The flakiness "calculation" (`intervalSync.ts:63-79`) counts pure failures ×0.5 and caps at 15%, which is not the standard definition (same test both passing and failing on the same commit).

### LOW

- `/api/teams` `metrics[].change/trend` (fake 2.5 / -0.1 / 3 / 1) and `velocity` (random) are fabricated, but no current UI reads them. They are still a risk to any API consumer.
- `topImproving` is just the top three scores, not teams that improved (not shown on screen).
- `/metrics/dashboard` labels average QA score as "Overall Pass Rate" and tech-debt items as "Open Defects". Only `Dashboard.tsx` uses it, and that component isn't imported.
- `slaConfig.ts:48-50`: `|| default` means a configured 0 can't be saved.
- `metricsAggregator.ts` is unused and divides by LOC and story points without checking for zero.
- `computeFocusRecommendation` no longer exists in `NewDashboard.tsx` (probably the concurrent edit).

### Checked and correct

- `globalQaScore` is the right average of the latest score per active team (87, matches the DB).
- avg coverage 80.5, defect escape rate 7.5, automation 73.9, flakiness 3.0: all correct one-decimal averages.
- kpiStatus 5/1/3 matches the stated thresholds.
- needsAttention's sorting and issue labels follow the code.
- The engineering health and wellness arithmetic is correct for its inputs (69 and 60 recomputed by hand).
- The tech-debt resolution-rate formula is correct (0%: no resolved items).
- `/teams` qaScore and status match the snapshots, and manual-path scores match their formula.
- `kpi-history` returns real snapshot data.
- `getDORALevel` bands are close to DORA 2023, apart from the zero bug.
- Divide-by-zero is guarded in the company averages.
- The Defects/KLOC unit is correct.
- NewDashboard uses real `/teams` KPI data and shows "—" for nulls in the table.
