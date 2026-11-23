# Documentation

Every document, what it is for and who reads it. One document per subject: if two would overlap, the smaller one is
a section of the bigger one.

## Start here

| Document | What it is for | Readers |
|---|---|---|
| [README](../README.md) | Overview, getting started, sample data, the main features with their code, tests and CI | everyone |
| [PRODUCT_GUIDE.md](PRODUCT_GUIDE.md) | The full product reference: the need, roles, every metric, how data gets in, every screen, privacy, alerts, configuration | product, engineering, customer success |
| [NEXT_MOVE.md](NEXT_MOVE.md) | Time lost, Findings, Outcomes and Data readiness: why they exist, what they solve, why a customer buys them, how each page works and how it is built | everyone |

## Using it

| Document | What it is for | Readers |
|---|---|---|
| [USER_GUIDE.md](USER_GUIDE.md) | How to use the screens, by task; signing in, passwords, sessions and roles | company users |
| [ADMIN_PANEL_GUIDE.md](ADMIN_PANEL_GUIDE.md) | Running a company (people, teams, parameters, logs) and the platform operator panel | company administrators, IronGate support |
| [ROLE_ACCESS.md](ROLE_ACCESS.md) | Who can see and do what, per role and page, derived from the code | everyone; testers for expected results |

## Data in

| Document | What it is for | Readers |
|---|---|---|
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Sending data: API keys, every raw ingestion kind, the KPI ingestion API, examples per CI tool | developers at customer companies |
| [DATA_FLOW.md](DATA_FLOW.md) | What each input feeds, field by field, with the example requests in [examples/ingest/](examples/ingest/) | engineering, integrators |
| [exporter/README.md](../exporter/README.md), [exporter/SECURITY.md](../exporter/SECURITY.md) | The QE Navigator Exporter: sources, configuration, what leaves the customer's network | developers and security at customer companies |
| [integration-examples/](integration-examples/) | Runnable scripts (Python, Node, curl) referenced by the integration guide | developers at customer companies |

## How the numbers are calculated

| Document | What it is for | Readers |
|---|---|---|
| [metrics_and_calculations.md](metrics_and_calculations.md) | Every formula with the code that computes it: QA score, calculation engine, hours lost, forecasts, recommendations, pipeline metrics, flaky tests, business impact | engineering, analysts |
| [METRICS_API_INDEX.md](METRICS_API_INDEX.md) | Where each metric is defined and every API route by area | engineering, integrators |

## Engineering and operations

| Document | What it is for | Readers |
|---|---|---|
| [TECHNICAL_DOCUMENTATION.md](TECHNICAL_DOCUMENTATION.md) | Architecture, code map, request flow, data model; running it locally; commands at a glance; authentication and authorisation in the code | engineering |
| [server/README.md](../server/README.md) | The API server's layout | engineering |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Supabase, Netlify or a Node service, environment variable names, migrations, scheduled functions | operations |
| [SECURITY.md](../SECURITY.md), [SECURITY_REVIEW.md](SECURITY_REVIEW.md) | Security controls, secrets handling, deployment checklist; the dated review of 2026-10-20 and its fixes | engineering, operations, auditors |
| [scripts/reseed/README.md](../scripts/reseed/README.md) | Reseeding a hosted demo with one showcase company | operations |

## Testing

| Document | What it is for | Readers |
|---|---|---|
| [testing/README.md](testing/README.md) | Running the Playwright UI suite locally, in CI and against a deployed site; adding tests | engineering, QA |
| [testing/E2E_FLOWS.md](testing/E2E_FLOWS.md) | Every user flow, the roles allowed and refused, and the tests that cover it | QA |
| [testing/MANUAL_TEST_CASES.md](testing/MANUAL_TEST_CASES.md) | The UI tests as manual test cases (also as `.xlsx`) | QA |
| [tests/README.md](../tests/README.md) | What is in the `tests/` folders | engineering |

## Plans, market and background

| Document | What it is for | Readers |
|---|---|---|
| [V2_PLAN.md](V2_PLAN.md) | The v2 plan ("raw data in, we calculate"): phases, the status of each, and the calculation rules | product, engineering |
| [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) | Competitors and positioning (sources checked 18 Nov 2026) | product, sales |
| [pitch/README.md](pitch/README.md) | Source of the pitch deck | sales |
| [reports/](reports/README.md) | Point-in-time accuracy audits, the consistency report and the R2 final review. Findings have since been fixed; read as background | engineering |

Documents that described earlier states of the product (status reports, fix logs, old setup guides, early roadmaps)
were removed on 23 Nov 2026; they are in the git history (`docs/archive/` before that date).
