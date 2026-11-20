# Flaky tests

How QE Navigator finds flaky tests, the flakiness KPI, and what the Flaky tests module shows.

A **flaky test** is a test that both failed and passed on the same code. Plain failures (a test that
fails every time on a commit) are real failures, not flakiness.

## 1. From raw test reports (recommended)

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

## 2. The Flaky tests module (Analytics → Flaky tests)

Component: [`src/components/FlakyTestIntelligence.tsx`](../src/components/FlakyTestIntelligence.tsx).
Route: `GET /api/analytics/flaky-tests?teamId=` ([`server/routes/analytics.ts`](../server/routes/analytics.ts)).

It reads the `flaky_tests` table (tracked flaky tests), not the raw CI evidence above. Today this table
holds sample data; there is no ingestion endpoint for it.

What it shows, per test (up to 50, highest stored flakiness score first):

- test name, stored flakiness score, failure pattern label, failures, passes and total runs, first and
  last seen;
- the last 20 recorded executions of the test (pass or fail), from `test_executions`;
- **root cause and suggested fix.** A root cause is shown as verified only when a person or tool stored
  one. Otherwise the page shows "Pattern: <label> (unverified, not derived from error logs)" and generic
  guidance for the pattern (timing, environment, data, network, unknown). No error log is analysed.

When the table has no rows for the team, the page shows an empty state; nothing is generated.

## 3. Sample data

With sample data on (operator **Demo Data** or **Populate metrics**, or `npm run seed:demo`), both the raw
test runs and the `flaky_tests` table are filled for demo teams. Sample rows are marked as sample and can
be removed. See the README, "Sample (demo) data".

## 4. Who sees what

Everyone with the team in their analytics scope sees the module and the evidence
([ROLE_ACCESS.md](ROLE_ACCESS.md)).
