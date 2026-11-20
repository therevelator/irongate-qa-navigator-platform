# CI/CD pipeline metrics

What QE Navigator shows about CI/CD pipelines, where each number comes from and how it is calculated.
Formulas are shared with [metrics_and_calculations.md](metrics_and_calculations.md).

There are two sources of pipeline data:

1. **Raw pipeline runs** (v2 phase 1), sent by the customer's CI to `POST /api/ingest/pipelines`. The
   calculation engine turns them into team KPIs and evidence. This is the recommended path.
2. **The CI/CD pipeline page** (Analytics → CI/CD pipeline), which reads stage tables
   (`pipeline_stages`, `pipeline_execution_summary`, `pipeline_config`). Today these tables hold sample
   data or values edited on the page; there is no ingestion endpoint for them.

## 1. Raw pipeline runs (v2 phase 1)

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

## 2. The CI/CD pipeline page

Component: [`src/components/PipelineVisualization.tsx`](../src/components/PipelineVisualization.tsx).
Routes in [`server/routes/analytics.ts`](../server/routes/analytics.ts):

| Route | What it returns |
|---|---|
| `GET /api/analytics/pipeline-stages?teamId=` | The team's stages (or the company's default stages when the team has none, read-only), each with duration, success rate, CPU, memory, cost per run and bottleneck score, plus the pipeline configuration |
| `GET /api/analytics/pipeline-history?days=14&teamId=` | Daily stage executions: total, successful, failed runs, failure rate and mean stage duration, from `pipeline_execution_summary` |
| `PUT /api/analytics/pipeline-stages/:id` | Edit a stage's values (marked as manually edited) |
| `GET`, `PUT /api/analytics/pipeline-config` | Savings assumptions: time savings %, cost savings %, cost per minute |

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

## 3. Company pipeline health

Shown on the overview and used in engineering health ([PRODUCT_GUIDE.md, 3.7 and 3.8](PRODUCT_GUIDE.md#37-pipeline-health-and-bottleneck-score)):

```
pipeline health = successful ÷ (successful + failed) pipeline runs in the last 30 days × 100
```

over company-level pipelines and active teams, from `pipeline_runs`. Running and cancelled runs are
excluded; no value without completed runs. Weight in engineering health: 0.25.
