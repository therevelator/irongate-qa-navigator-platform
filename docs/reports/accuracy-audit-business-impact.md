## Business Impact statistics audit (read-only, with one permitted recompute)

**Data change I made:** I ran `POST calculate-correlations` on team Mavericks (`team-1764026202608-vcbic0w8g`). It had no correlation rows before; it now has 56, 6 of them flagged significant. No other data was changed.

**How I checked:** I wrote an independent recomputation in a separate script (not kept in the repository). It uses Pearson r and an exact two-sided Student-t p-value (regularized incomplete beta), and I compared it with the stored `business_impact_correlations` rows and the live API output.

### CRITICAL

**C1. Alpha Team's correlations are hand-typed numbers that don't match its data.**
- **Where:** `db_snapshots/latest_snapshot.sql:180` (also `latest_snapshot.postgres.sql:90`), served by `GET /business-impact-v2/:teamId` (`analytics.ts:1333`).
- **What the user sees:** 20 rows with round values: r = 0.720, 0.680, -0.650, ... and 16 marked "significant".
- **Recomputed from the same team's monthly data:**

| Pair | Stored r | Actual r |
|---|---|---|
| test_coverage → monthly_revenue | 0.72 | 0.986 |
| code_quality_score → churn_rate | -0.61 | -1.000 |
| mttr_hours → nps_score | -0.48, "not significant" | -0.999, p < 1e-8 |

- Every stored row is wrong.
- **Fix:** delete these rows and recompute from the data, or remove them from the snapshot or seed. Also add a `source`/`is_demo` column.

**C2. "Regenerate Data" shows random synthetic data as findings, and "Save" stores it as real.**
- **Where:** `analytics.ts:1805-2015`, `BusinessImpactAnalysisV2.tsx:340-410`, `:1171`.
- The server builds KPIs directly from the quality metrics, so the correlations are built in. For example, revenue is `kpiBase * ... * (1 + qualityScore*correlationStrength*0.5 + noise)`.
- It returns "Realistic business impact data **seeded successfully**!" (`:1997`).
- The client replaces the table, charts, "Strongest Correlation", the "Significant Correlations" count and "Top Correlations" with this output. None of it is labelled as demo.
- "Save Current Data" then calls `bulk-save`, which writes it with `manually_edited=TRUE` and `data_source` defaulting to `'manual'`. After that it can't be told apart from real data. All 36 current rows say `data_source='manual'`, including Alpha's seed.
- The `randomCorrelation`/`expectedR` block (`:1929-1966`) is dead code.
- **Fix:** remove the endpoint and button from client-facing builds, or put it behind a demo flag. Tag the rows `data_source='synthetic'`, refuse to save synthetic data, and show a persistent "DEMO DATA" banner.

**C3. The p-value uses a normal approximation instead of Student-t, so it is anti-conservative at n = 6–12 and flags too many results as significant.**
- **Where:** `analytics.ts:1275-1281`.
- **Code:**
  ```js
  const t = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));
  const cdf = normalCdf(z); pValue = 2 * (1 - cdf);
  ```
  The t-statistic is right, but it is compared against a normal distribution instead of t with df = n-2.
- **Smallest |r| flagged significant at α = 0.05:**

| n | Correct (Student-t) | App (normal) | App's p at the correct cut-off |
|---|---|---|---|
| 6 | 0.811 | 0.700 | 0.0055 |
| 8 | 0.707 | 0.625 | 0.0144 |
| 12 | 0.576 | 0.527 | 0.0259 |

- **Live check on Mavericks:** the API flagged 6 of 56 pairs; the exact test gives 2. For example, lead_time_days → support_ticket_volume: r = 0.568, the app says p = 0.0289, the exact value is 0.0540.
- **LegacyCode Warriors (recomputed locally, not via the API):** 14 by the app's method vs 11 exact.
- The comment on line 1274 admits it is an "approximation".
- **Fix:** p = I_{df/(df+t²)}(df/2, 1/2), the regularized incomplete beta, as in my script; or use the `jstat` / `@stdlib` t CDF.

**C4. 56 hypothesis tests with no multiple-comparison correction, on trending time series.**
- **Where:** `analytics.ts:1600-1628`.
- At α = 0.05, about 2.8 false positives are expected by chance alone.
- After Bonferroni or Benjamini–Hochberg correction, Mavericks and LegacyCode Warriors have **0** significant pairs, against the 6 and 14 the app would show.
- Monthly series that both trend (like Alpha's monotone seed) give |r| ≈ 0.99 for every pair just from shared time. These are spurious.
- **Fix:**
  - Apply BH-FDR and show q-values.
  - Correlate first differences, or detrended series.
  - Label the results "exploratory, n=12".

### HIGH

**H1. Wrong results at the edges.**
- **Where:** `analytics.ts:1270, 1276`.
- r = ±1 (possible with n = 6) gets `pValue = 1`, so it is shown as "strong, not significant". It should be p ≈ 0.
- A constant series gets r = 0 with label "none" and p = 1 instead of "undefined (zero variance)".
- The `n<3` path returns r = 0, which reads as a real "no correlation".
- **Fix:** return `null` for zero variance, p = 0 when |r| = 1, and skip pairs with null r.

**H2. The "Calculate Correlations" button doesn't exist, so stored results go stale.**
- **Where:** `BusinessImpactAnalysisV2.tsx:416`. `calculateCorrelations` is defined but never wired to a button; the empty state at `:1348` tells users to click it.
- So correlations shown after data is edited are never recomputed. That is how Alpha's fabricated rows (C1) survive.
- Mavericks and LegacyCode Warriors had full data but no correlations before my run.
- **Fix:** add the button, or recompute automatically after `bulk-save`. Show `calculated_at` next to the results.

**H3. `GET /analytics/business-impact` returns hard-coded and random dollar and correlation figures as real data.**
- **Where:** `analytics.ts:1129-1171`.
- The fallback contains hard-coded values such as `revenue_impact: 4178000, correlation_strength: 0.85`. It is live: for the `novatech` company it returns exactly these.
- The other source, `business_impact_metrics`, is filled by `server/jobs/analyticsSync.ts:86-96, 453-463`. That job runs on a daily cron and uses `randomBetween(5000,50000)` for revenue and `randomBetween(0.5,0.95)` for correlation.
- The consumer, `BusinessImpactAnalysis.tsx`, is not routed in `App.tsx` (only V2 is), so no client sees it today. The API is still reachable.
- That component also contains:
  - Hard-coded "insights" (`:147, :153, :159`), e.g. "Defect escape rate > 8% leads to 15% drop in NPS".
  - `Math.random()` historical chart data (`:17-25`).
  - Invented what-if revenue numbers: `revenue_impact*0.1` / `0.2` (`:401, :447, :454`), and NPS = `customer_satisfaction*0.1`.
  - The label "Avg NPS" on a CSAT average.
- `/metrics/business-impact-config` just stores user-typed `correlation_strength` and `revenue_impact` with no computation.
- **Fix:** delete the V1 endpoint, the component, and the random seeding of `business_impact_metrics`. At minimum return 404 or empty instead of the fallback.

**H4. Zero values are saved as missing.**
- **Where:** `analytics.ts:1407-1415`, `:1457-1467`.
- `metrics.x || null` turns a real 0 into NULL. That affects churn 0%, NPS 0, change-failure 0 and defect density 0. Those pairs are dropped silently and n shrinks.
- COALESCE upserts also mean a value can never be cleared.
- **Fix:** use `?? null`.

### MEDIUM

**M1. Language claims causation from correlation.**
- `V2.tsx:956`: "help identify which quality improvements **drive** the most business impact".
- `:1150`: "indicate quality improvements strongly **drive** business outcomes". This line also says "(red +1.000)", but positive values are shown green.
- `:1429`: "As quality improves, business results improve **proportionally**".
- `:1153`: "Realistic correlations typically range from 0.3 to 0.8". There is no source for this.
- The AI prompt (`analytics.ts:2087-2091`) asks the model which metrics to "prioritize" for "investment decisions", which invites causal claims.
- **Fix:** reword to "move together; does not show cause". Add an explicit caveat about confounders and trends in the UI and in the prompt.

**M2. The p-value explanation is wrong.**
- `V2.tsx:1441-1442` says: "tells you if the relationship is real... less than a 5% probability the correlation happened by chance".
- That is the standard misreading. A p-value is the probability of seeing a correlation at least this strong if there were no real relationship.

**M3. Colours treat any positive r as good.**
- Green or blue for positive and red or orange for negative (`:521-535`) ignores that higher defects, MTTR, lead time and churn are bad.
- Example: a "+0.568" lead_time → support_tickets correlation is coloured as a good result.
- The "Strongest Correlation" value is always green (`:739`), even when negative.

**M4. Strength labels ignore significance and sample size.**
- r = 0.75 at n = 6 is labelled "strong" while p = 0.086.
- Show the label only when significant after correction, or show a confidence interval.
- The label cut-offs (0.3 / 0.5 / 0.7) are the same on server and client.
- The legend at `:1430-1434` leaves out the -0.3 to -0.5 band.

**M5. Minimum sample size is checked differently on client and server.**
- The client's "Correlation Ready" (`:564-571`, `:770-781`) counts months with any quality field and any KPI field.
- The server checks both table row counts ≥ 6 (`:1562`) and ≥ 6 non-null pairs per pair (`:1614`). That part is correctly enforced.
- `GET` `isCorrelationReady` (`:1366`) counts rows, not non-null values. So "Ready: Yes" can appear when no pair has 6 values.

**M6. Mismatches between what is shown and what is used.**
- "Data Points" = `paired × 15` (`:762`) assumes no nulls.
- The heading "Top Correlations (Realistic Data)" (`:969`) appears on real data.
- "Data is generated automatically on page load with realistic correlations" (`:1167`) is false and makes real data look fake.
- The AI prompt hard-codes "12 consecutive months" (`:2062, :2074`) whatever n is.
- AI analysis uses the correlations stored in the database, not the regenerated ones on screen. The client sends `{correlations}`, which the server ignores.

### What IS correct
- **Pearson r:** `analytics.ts:1252-1270` is the standard sample formula; the n vs n-1 factor cancels. It matches my recomputation to 3 decimals on all 56 Mavericks pairs.
- **Pairing:** pairs are matched by `month_year` across the two tables (`:1584-1612`), and nulls are dropped pairwise, not zero-filled.
- **t-statistic:** t = r·√((n-2)/(1-r²)) is right, and the test is two-sided. Only the reference distribution is wrong (C3).
- **Minimum sample enforcement:** ≥ 6 non-null pairs is enforced on the server before computing.
- **Strength labels:** the thresholds are identical on server and client.
- **AI analysis:**
  - It rebuilds its input from the database and sanitises it.
  - The client adds an "AI-Generated" disclaimer.
  - The HTML is passed through DOMPurify.
- **ROI formula:** `calculateROI` (`:540`), used by technical debt rather than business impact, is a transparent formula with configurable rates. It has no invented multipliers.
