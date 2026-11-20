# Documentation index

Every current document, what it is for and who reads it. Older documents (status reports, fix logs,
old setup guides, early roadmaps and marketing drafts) are in [archive/](archive/README.md); they are kept
for the record and are not accurate today.

## Start here

| Document | What it is for | Readers |
|---|---|---|
| [README](../README.md) | Overview, getting started, sample data, the main features with their code, tests and CI | everyone |
| [QUICK_START.md](QUICK_START.md) | Run it locally in a few steps | developers |
| [QUICK_REFERENCE.md](QUICK_REFERENCE.md) | Commands, addresses and files at a glance | developers |

## Product

| Document | What it is for | Readers |
|---|---|---|
| [PRODUCT_GUIDE.md](PRODUCT_GUIDE.md) | The full product reference: the need, roles, every metric, how data gets in, every screen, privacy, alerts, configuration | product, engineering, customer success |
| [USER_GUIDE.md](USER_GUIDE.md) | How to use the screens, by task | company users |
| [ADMIN_PANEL_GUIDE.md](ADMIN_PANEL_GUIDE.md) | Running a company (people, teams, parameters, logs) and the platform operator panel | company administrators, IronGate support |
| [ROLE_ACCESS.md](ROLE_ACCESS.md) | Who can see and do what, per role and page, derived from the code | everyone; testers for expected results |
| [V2_PLAN.md](V2_PLAN.md) | The v2 plan ("raw data in, we calculate"): phases, the status of each, and the calculation rules. Phase 5 (Invest) is planned, not built | product, engineering |
| [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) | Competitors and positioning (sources checked 18 Nov 2026) | product, sales |
| [pitch/README.md](pitch/README.md) | Source of the pitch deck | sales |

## Metrics

| Document | What it is for | Readers |
|---|---|---|
| [metrics_and_calculations.md](metrics_and_calculations.md) | Every formula with the code that computes it: QA score, calculation engine, forecasts, recommendations, company metrics | engineering, analysts |
| [METRICS_API_INDEX.md](METRICS_API_INDEX.md) | Where each metric is defined and every API route by area | engineering, integrators |
| [CI_CD_PIPELINE_METRICS.md](CI_CD_PIPELINE_METRICS.md) | Pipeline metrics from raw runs and the CI/CD pipeline page | engineering |
| [flaky_test_intelligence.md](flaky_test_intelligence.md) | How flaky tests are found and what the Flaky tests module shows | engineering, QA |
| [business_impact_correlation.md](business_impact_correlation.md) | Business impact correlations and revenue impact | product, analysts |

## Integration

| Document | What it is for | Readers |
|---|---|---|
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Sending data: API keys, raw ingestion (tests, coverage, pipelines, deployments, commits, incidents, issues, static analysis), the KPI ingestion API, examples per CI tool | developers at customer companies |
| [integration-examples/](integration-examples/) | Runnable scripts (Python, Node, curl) referenced by the integration guide | developers at customer companies |

## Engineering and operations

| Document | What it is for | Readers |
|---|---|---|
| [TECHNICAL_DOCUMENTATION.md](TECHNICAL_DOCUMENTATION.md) | Architecture, code map, request flow, data model | engineering |
| [server/README.md](../server/README.md) | The API server's layout | engineering |
| [authentication/AUTH_DEVELOPER_GUIDE.md](authentication/AUTH_DEVELOPER_GUIDE.md) | Sign-in, sessions, SSO, invitations, API keys, authorisation in the code | engineering |
| [authentication/AUTH_USER_GUIDE.md](authentication/AUTH_USER_GUIDE.md) | Signing in, passwords, sessions and roles, for users | company users |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Supabase, Netlify or a Node service, environment variable names, migrations, scheduled functions | operations |
| [SECURITY.md](../SECURITY.md) | Security controls, secrets handling, deployment checklist, reporting | engineering, operations |
| [SECURITY_REVIEW.md](SECURITY_REVIEW.md) | The dated security review of 2026-10-20 and its fixes | engineering, auditors |
| [scripts/reseed/README.md](../scripts/reseed/README.md) | Reseeding a hosted demo with one showcase company | operations |

## Testing

| Document | What it is for | Readers |
|---|---|---|
| [testing/README.md](testing/README.md) | Running the Playwright UI suite locally, in CI and against a deployed site; adding tests | engineering, QA |
| [testing/E2E_FLOWS.md](testing/E2E_FLOWS.md) | Every user flow, the roles allowed and refused, and the tests that cover it | QA |
| [testing/MANUAL_TEST_CASES.md](testing/MANUAL_TEST_CASES.md) | The UI tests as manual test cases (also as `.xlsx`) | QA |
| [tests/README.md](../tests/README.md) | What is in the `tests/` folders | engineering |

## Reports (background)

| Document | What it is for | Readers |
|---|---|---|
| [reports/](reports/README.md) | Point-in-time accuracy audits, the consistency report and the R2 final review. Findings have since been fixed; read as background | engineering |
| [archive/](archive/README.md) | Historical documents, not current | anyone checking history |
