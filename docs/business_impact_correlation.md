# Business impact: correlations and revenue impact

How the Business impact page (Analytics → Business impact) relates a team's quality metrics to its
business results. The full rules, with every edge case, are in
[PRODUCT_GUIDE.md, section 3.13](PRODUCT_GUIDE.md#313-business-impact-money-revenue-impact-and-correlations).

Results are exploratory. Correlation does not show causation: two monthly series that share a trend can
correlate without any causal link. The page says so next to the results.

The page itself explains all of this: **How this works** (an expander at the top of every tab,
`src/components/BusinessImpactHowItWorks.tsx`) covers what goes in, how links are found, how the money
figures are derived, which inputs are assumptions and what the labels mean; every figure and every tile on
Details opens **How this was calculated** with its formula, its inputs and its sample size.

## Data

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

## Correlations

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

## Revenue impact

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

## Sample data

The demo generator (`server/seeds/demoData.ts`, also used by the operator's Demo Data and Populate metrics and the
Meridian reseed) writes 12 months per team: quality as the month's averages of the team's daily KPI values
(deployments per month = weekly average × days ÷ 7), business KPIs following the team's health (revenue grows slowly
and moves with quality), context (downtime from the availability KPI), the correlations cache and the data status.
For a filled company it also adds the **Financial and ROI settings** the sample assumes, only where the company has
none of its own: developer hourly rate 85, support ticket cost 30, SLA breach penalty 2500 (company), and per team
the revenue per user (the team's sample revenue per active user) and the downtime cost per minute (the team's monthly
revenue ÷ 43 200 minutes). The sample technical debt's cost of delay uses the same rates.

## Who sees and edits what

Everyone with the team in scope reads Money, What-if and Details. The All teams roll-up is for super
admins and managers. Editing business data and running correlations: super admins, managers for their
departments, team leads for the teams they lead. See [ROLE_ACCESS.md](ROLE_ACCESS.md).
