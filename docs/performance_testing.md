# Performance Testing Metrics

## Overview
Performance Testing Metrics provides a consolidated view of API endpoint health, combining response time trends, load-test projections, and SLA compliance insights. The React component (`src/components/PerformanceTesting.tsx`) retrieves recent metrics, smooths out historical data for charting, and surfaces optimization guidance per endpoint.

## Key Features
1. **Time-range analytics** – switch between last 24 hours, 7 days, or 30 days. The API call uses the `days` query parameter, so backend data windows stay in sync.
2. **Endpoint selector** – dropdown to focus the Response Time Trends chart on a single endpoint without needing a "select all" option.
3. **Response Time Trends chart** – visualizes P50/P95/P99 percentiles with dynamic tooltips and summary cards.
4. **Load Test Results chart** – simulates concurrency sweeps to highlight degradation points and throughput changes.
5. **Endpoint cards** – per-endpoint KPIs, mini-trends, recommendations, SLA compliance, and expandable detailed analysis.
6. **Dark-mode support** – all highlight cards, tables, and analysis panels adapt colors for readability.

## SLA Configuration
SLA thresholds are now editable from **Admin → Parameters Config**. The new page (`src/components/ParametersConfiguration.tsx`) lets managers/super admins set:

- P95 response-time target (ms)
- Error-rate threshold (%)
- Uptime commitment (%)

Values persist in the browser via `localStorage` and broadcast a `slaConfigUpdated` event so every open Performance Testing tab re-reads the config instantly.

Implementation details:
- Config helpers live in `src/utils/slaConfig.ts` (`loadSLAConfig`, `saveSLAConfig`, defaults, and event dispatch)
- `PerformanceTesting.tsx` subscribes to `slaConfigUpdated` and renders UI text/tooltips using the live values
- Endpoint cards, error-rate messaging, and the SLA Compliance panel all reference `slaConfig`

> Tip: if you need environment-wide defaults, update `DEFAULT_SLA_CONFIG` in `slaConfig.ts` and redeploy.

## Data Flow
1. Fetch `/analytics/performance-metrics?days=<1|7|30>` using the signed-in user token.
2. Transform each metric into an `ExtendedPerformanceMetric` with calculated `performance_score` and `response_times`.
3. Generate `trendData` per selected endpoint by deriving synthetic but realistic P50/P95/P99 points.
4. Build `loadTestData` for the capacity chart.
5. Render summary header, filters, charts, and endpoint cards referencing the derived data.

## Extensibility Tips
- **Real metrics**: Replace synthetic trend/load data with actual timeseries inputs once backend provides them per endpoint.
- **SLA overrides**: Accept `slaConfig` props to allow per-tenant thresholds without recompiling.
- **Alerts**: Hook `degradedEndpoints` into notifications for instant escalation.
- **Persistence**: Cache the selected endpoint/time range in localStorage to persist dashboard state between visits.

## File Reference
- `src/components/PerformanceTesting.tsx` – main UI and logic
- `docs/performance_testing.md` – this guide for onboarding and configuration
