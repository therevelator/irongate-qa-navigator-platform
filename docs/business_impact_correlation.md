# Business impact: correlations and revenue impact

How the Business impact page (Analytics → Business impact) relates a team's quality metrics to its
business results. The full rules, with every edge case, are in
[PRODUCT_GUIDE.md, section 3.13](PRODUCT_GUIDE.md#313-business-impact-money-revenue-impact-and-correlations).

Results are exploratory. Correlation does not show causation: two monthly series that share a trend can
correlate without any causal link. The page says so next to the results.

## Data

Monthly values per team, entered on the page (or by the session API, see
[INTEGRATION_GUIDE.md, section 5.2](INTEGRATION_GUIDE.md#52-business-impact-monthly-data-business-impact-money-what-if-details-all-teams)),
or sample data.

| Kind | Fields (`server/routes/analytics.ts`) |
|---|---|
| Quality metrics (`BI_QUALITY_FIELDS`) | test coverage, defect density, defect escape rate, MTTR, deployment frequency, lead time, code quality score, change failure rate |
| Business KPIs (`BI_KPI_FIELDS`) | monthly revenue, active users, churn rate, feature adoption rate, NPS, CSAT, support ticket volume |

Routes: `GET /api/analytics/business-impact-v2/:teamId`, and `POST` sub-routes `quality-metrics`,
`business-kpis`, `context`, `bulk-save` and `calculate-correlations`.

## Correlations

`CORRELATION_METHOD` in [`server/routes/analytics.ts`](../server/routes/analytics.ts):

- Pearson r for each quality × business pair, over the months where both values exist.
- Two-sided Student t-test, df = n − 2, exact p.
- Benjamini–Hochberg false-discovery-rate correction across all pairs tested for the team.
- **Significant when q < 0.05.**
- Needs at least 6 months of each series and 6 paired months. Pairs with zero variance are skipped.
- Strength label: |r| ≥ 0.7 strong, ≥ 0.5 moderate, ≥ 0.3 weak, otherwise none.

An optional written summary of the stored correlations uses the Groq service when `GROQ_API_KEY` is set
(`POST …/ai-analysis`, rate limited); it is labelled as model output. Without the key the page says so.

## Revenue impact

Code: [`server/lib/revenueImpact.ts`](../server/lib/revenueImpact.ts), [`server/lib/stats.ts`](../server/lib/stats.ts).
Routes: `GET /api/revenue-impact/teams/:teamId`, `GET /api/revenue-impact/teams/:teamId/what-if?metric=&change=`,
`GET /api/revenue-impact/rollup`.

- **Revenue per metric.** Ordinary least-squares slope b of monthly revenue on each quality metric, with
  its standard error, t-test (df = n − 2) and 95 % range. Shown from 6 paired months. Significant when
  p < 0.05; not corrected for multiple comparisons.
- **Where the money is going now:** quality below target (b × gap to the target, for significant
  slopes), open technical debt (monthly cost of delay), downtime (minutes × cost per minute), support
  tickets (tickets × ticket cost), churn (churn % × monthly revenue). The causes overlap, so there is no
  total.
- **What you gain when these are fixed**, biggest first, and **where to put the money first** (by
  monthly gain, or by return on cost for debt items with an effort estimate).
- **What-if:** projected monthly change = b × change, with the range; disabled when the slope is not
  significant; values outside the recorded range are flagged as extrapolation.
- **All teams:** the sum over the teams of the caller's scope (super admins: the company; managers:
  their departments).

Rates (hourly rate, ticket cost, revenue per user, downtime cost per minute, SLA penalty) come from
Parameters → Financial and ROI settings (team, else department, else company). Built-in defaults are
labelled "(default)".

## Who sees and edits what

Everyone with the team in scope reads Money, What-if and Details. The All teams roll-up is for super
admins and managers. Editing business data and running correlations: super admins, managers for their
departments, team leads for the teams they lead. See [ROLE_ACCESS.md](ROLE_ACCESS.md).
