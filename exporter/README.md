# qe-collector: the QE Navigator Collector

A small program you run **inside your own network**. It reads your CI (GitHub Actions, GitLab CI, Jenkins, Azure
DevOps), SonarQube, Jira, Linear, PagerDuty and Opsgenie with **your own read-only credentials**, calculates the metrics
there with **QE Navigator's own calculation engine** (the code the QE Navigator server runs, `packages/engine`), and sends
the results to QE Navigator over **outbound HTTPS only**. Your pipelines do not change.

- Your credentials never leave your network: they live in environment variables and are sent only to the tool they
  belong to (an artifact download that redirects to a storage host follows the redirect without them).
- Nothing connects into your network. The only optional listener is the local evidence page (`serve`), bound to
  localhost or an internal address.
- You choose what leaves (`privacy.mode`): **evidence** (default: calculated values with the evidence lists the app
  shows), **metrics** (values and counts only, no names at all) or **full** (minimised raw records; QE Navigator
  calculates). The raw records stay in a local copy on your side, so history can be recalculated after an update.
- `qe-collector preview` prints exactly what would be sent before anything is sent.
- One JavaScript file of about 390 KB, no runtime dependencies, Node 20 or later; or a distroless container image.
- `qe-agent` is the same program under its earlier name (the on-premises agent): the command, the old config file name
  `qe-agent.yaml`, `QE_AGENT_CONFIG` and an old state file keep working.

Security review: [SECURITY.md](SECURITY.md): data flow per mode, the exact fields per mode, permissions per vendor,
network requirements, verification of the bundle and the image.

## Quick start (5 minutes)

**1. Get the Collector.** The container image, built from the repository root (it bundles this folder and the shared engine):

```bash
docker build -f collector/Dockerfile -t qe-collector:0.2.0 .
```

or the single file, built with Node 20+ (dev tools only; no runtime dependencies):

```bash
cd collector && npm ci --ignore-scripts && npm run build      # dist/qe-collector.mjs and dist/SHA256SUMS
```

**2. Create a QE Navigator API key**: QE Navigator → Admin console → API keys → Create (name it `qe-collector`).
Admin console → Connect your CI → *QE Navigator Collector* generates a config file per CI and privacy mode with your
team ids filled in, and shows the Collector status once it runs.

**3. Write `qe-collector.yaml`** for your CI (no secrets in it; [config.example.yaml](config.example.yaml) has every option),
then set the secrets and run `check`, `preview`, `sync` (step 4).

### GitHub Actions

Token: a fine-grained personal access token with repository permissions **Actions: read, Contents: read, Deployments:
read, Metadata: read** on the repositories (or a GitHub App with the same permissions: `auth: app`, `appId`,
`installationId`, key in `GITHUB_APP_PRIVATE_KEY`).

```yaml
qeNavigator:
  url: https://app.irongate.ie
privacy:
  mode: evidence
state:
  path: /var/lib/qe-collector/state.json
sources:
  - type: github
    repos:                              # owner/name → QE Navigator team id
      acme/payments: team-payments
      acme/web: team-web
    environments: [production]          # deployments to these environments count
    # apiUrl: https://github.example.com/api/v3   (GitHub Enterprise Server)
    # artifacts: { tests: ["*test*"], coverage: ["*coverage*"], sarif: ["*sarif*"], maxMB: 50 }
```

```bash
export QE_API_KEY=igk_... GITHUB_TOKEN=github_pat_...
```

The Collector reads workflow runs, their jobs and steps, and the artifacts whose names match the patterns (JUnit / TRX /
Cucumber test reports, lcov / Cobertura / JaCoCo / Istanbul coverage, SARIF, recognised by content); keep uploading
your reports as artifacts (`actions/upload-artifact`) and nothing else changes.

### GitLab CI

Token: a personal, group or project access token with the **read_api** scope (role Reporter or above).

```yaml
sources:
  - type: gitlab
    projects:                           # group/project → team id
      acme/web: team-web
    environments: [production]
    # apiUrl: https://gitlab.example.com/api/v4   (self-managed)
```

```bash
export QE_API_KEY=igk_... GITLAB_TOKEN=glpat-...
```

Tests come from GitLab's test report API (your `artifacts:reports:junit`); coverage and SARIF from job artifacts whose job
or archive names match the patterns.

### Jenkins

User and API token of a dedicated user with **Overall/Read** and **Job/Read** on the jobs.

```yaml
sources:
  - type: jenkins
    baseUrl: https://jenkins.example.com
    user: qe-collector                  # or JENKINS_USER
    jobs:                               # folder/job → team id
      payments/main: team-payments
    deployJobs:                         # each build of these jobs is a production deployment
      payments/deploy-production: team-payments
```

```bash
export QE_API_KEY=igk_... JENKINS_TOKEN=11a2b3...
```

Stages come from the Pipeline Stage View API (`wfapi`), tests from the JUnit plugin, coverage and SARIF from archived
artifacts (`archiveArtifacts`).

### Azure DevOps

A personal access token with **Build (Read), Test Management (Read), Code (Read), Environment (Read)** (and **Release
(Read)** with `releases: true`).

```yaml
sources:
  - type: azure-devops
    orgUrl: https://dev.azure.com/acme
    project: Payments
    pipelines:                          # pipeline name (or definition id) → team id
      payments-ci: team-payments
    environments: [Production]
    # releases: true                    # classic release pipelines (vsrm.dev.azure.com)
```

```bash
export QE_API_KEY=igk_... AZURE_DEVOPS_TOKEN=...
```

### SonarQube, Jira, Linear, PagerDuty, Opsgenie

Add them to the same file (one `sources` entry each; see [config.example.yaml](config.example.yaml)): `type: sonarqube`
(`projects:` key → team, `SONAR_TOKEN`), `type: jira` (`JIRA_TOKEN`, `JIRA_EMAIL`), `type: linear` (`LINEAR_API_KEY`),
`type: pagerduty` (`PAGERDUTY_TOKEN`), `type: opsgenie` (`OPSGENIE_API_KEY`).

**4. Check, preview, sync:**

```bash
node dist/qe-collector.mjs check   -c qe-collector.yaml   # config, each source, QE Navigator; what would be read
node dist/qe-collector.mjs preview -c qe-collector.yaml   # exactly what would be sent in your mode; nothing is sent or stored
node dist/qe-collector.mjs sync    -c qe-collector.yaml   # first run: the last 90 days; then only what changed
```

With Docker:

```bash
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  -v "$PWD/qe-collector.yaml:/etc/qe-collector/qe-collector.yaml:ro" -v qe-collector-state:/var/lib/qe-collector \
  -e QE_API_KEY -e GITHUB_TOKEN qe-collector:0.2.0 check     # then preview, sync
```

Then schedule `sync` every 15 minutes: [Kubernetes CronJob](deploy/kubernetes/cronjob.yaml) (with a
[NetworkPolicy](deploy/kubernetes/networkpolicy.yaml)), [systemd timer](deploy/systemd/) or [cron](deploy/crontab.example).
Admin console → Connect your CI → *Collector status* shows the last heartbeat, the versions and each source's last success.

## Commands

| Command | What it does |
|---|---|
| `qe-collector check` | Validates the config; shows the privacy mode and which secrets are set (never their values); for each source authenticates and shows what will be read and what was found (repositories, environments, field ids, teams); calls QE Navigator with a dry run that validates the key and every team id. |
| `qe-collector preview` | Reads the sources and prints a JSON report: per source the window, what is new, skipped records with the reason, and **every request exactly as `sync` would send it in your mode** (URL, headers with the key redacted, body), each validated by QE Navigator's `dryRun=true`; and the heartbeat. `--offline`: no call to QE Navigator at all. `--all`: include what was already delivered. `--out FILE`. Writes no state and no local copy. |
| `qe-collector sync` | Reads what changed since the last run (the cursor minus `overlapMinutes`), keeps it in the local copy, then sends by privacy mode (evidence / metrics: the values of the last `recalcDays` days and of any day touched by new data that changed since they were sent; full: the new raw records), and ends with a heartbeat. Re-running sends nothing already delivered. |
| `qe-collector sync --since 2026-01-01` | Backfill from a date (QE Navigator keeps 13 months; incidents older than 364 days are skipped). |
| `qe-collector recalc --since 2026-01-01` | Recalculates from the local copy without reading any source, e.g. after a Collector update with a new engine version, and sends the values that changed (each recorded with the engine version). evidence and metrics modes. |
| `qe-collector serve` | The local evidence page (read-only): per team the values and the evidence behind them (flaky tests, lowest-coverage files, slowest and failing stages, failed deployments, escaped issues), from the local copy. `serve.host` (default 127.0.0.1) and `serve.port` (8787); basic auth when `QE_SERVE_USER` and `QE_SERVE_PASSWORD` are set (required for a wildcard address). Set `privacy.localEvidenceUrl` to its URL and QE Navigator links to it in metrics mode. |
| `qe-collector diagnose` | Writes a diagnostics file (`--out FILE`): versions, runtime, the config without secrets (which secret variables are set), per source the cursor, last success and error counts, the local copy's size. No record and no name. Nothing is sent: read it, then send it to support if you choose to. |

Options: `-c FILE` (default `$QE_COLLECTOR_CONFIG`, `$QE_AGENT_CONFIG` or `./qe-collector.yaml`), `--source NAME`,
`--state FILE`, `--log-format json|text`, `-v / --verbose` (requests, retries, timings; never secrets).

**Exit codes** (for schedulers): `0` ok · `1` internal error · `2` configuration or usage · `3` a source could not be read
(auth, network, API error) · `4` QE Navigator refused or could not be reached · `5` another run holds the lock · `6` some
records or values were refused by QE Navigator (the others were delivered).

## Configuration

One YAML (or JSON) file; secrets only from the environment. Unknown keys and anything that looks like a secret
(`token`, `apiKey`, `password`, `salt`, …) are refused, so a typo never silently changes behaviour.

| Setting | Default | |
|---|---|---|
| `qeNavigator.url` | `https://app.irongate.ie` | https only (http only for localhost). |
| `qeNavigator.apiKeyEnv` | `QE_API_KEY` | Env var of the `igk_` key. |
| `qeNavigator.caFile` / `http.caFile` | | Extra CA (PEM) added to the system roots, e.g. a TLS-inspecting proxy. Verification is never turned off. |
| `qeNavigator.requestsPerMinute` | `50` | Client-side limit (the API allows 60 per minute per key). |
| `privacy.mode` | `evidence` | `full`, `evidence` or `metrics` (what each sends: [SECURITY.md](SECURITY.md)). |
| `privacy.localEvidenceUrl` | | metrics mode: the URL of your `serve` page, linked from "How this was calculated". |
| `privacy.sendTitles` / `sendLinks` / `people` | `false` / `false` / `none` | full mode: issue / incident titles, links back to your tools (also CI run links), people as `HMAC-SHA256(QE_PEOPLE_SALT, id)`. |
| `state.path` | `./qe-collector-state.json` | Cursors and fingerprints; written atomically. |
| `state.dataDir` | `<state folder>/qe-collector-data` | The local copy of the records (JSON lines, one file per month; files 0600, folders 0700). |
| `state.retentionDays` / `detailDays` | `400` / `35` | How long the local copy keeps records, and per-test results and per-file coverage. |
| `recalcDays` | `35` | Days recalculated on every sync (values change while late data arrives). |
| `mainBranches` | | `team id: branch` when a team's main branch is not main or master. |
| `serve.host` / `port` / `userEnv` / `passwordEnv` | `127.0.0.1` / `8787` / `QE_SERVE_USER` / `QE_SERVE_PASSWORD` | The local evidence page. |
| `heartbeat` | `true` | Send the heartbeat (versions and per-source status; no data). |
| `backfillDays` | `90` | First run window. |
| `overlapMinutes` | `10` | Re-read before the cursor each run (clock skew; nothing is sent twice). |
| `http.timeoutSeconds` / `maxRetries` / `maxRetryWaitSeconds` | `30` / `5` / `120` | Every request has a timeout; 429 / 5xx / rate-limit 403 / network errors are retried with jitter and Retry-After. |

Per source (`sources[]`): `type`, `name` (keys the state; default the type), `tokenEnv`, the team mapping (below),
`defaultTeam` (used when a record's repository / project / service is not mapped; else it is skipped and reported),
`caFile`, `enabled`. CI sources: `artifacts` (`tests`, `coverage`, `sarif` name globs; `maxMB`, default 50), `maxRunsPerRepo`
(default 500 per run).

| Source | Team mapping | Settings | Secrets (default names) |
|---|---|---|---|
| `github` | `repos` (owner/name → team) | `apiUrl`, `auth: token \| app`, `appId`, `installationId`, `privateKeyEnv`, `workflows`, `branches`, `environments` | `GITHUB_TOKEN` or `GITHUB_APP_PRIVATE_KEY` |
| `gitlab` | `projects` (group/project or id → team) | `apiUrl`, `environments` | `GITLAB_TOKEN` |
| `jenkins` | `jobs` (folder/job → team) | `baseUrl`, `user` / `userEnv`, `deployJobs`, `deployEnvironment`, `allowHttp` | `JENKINS_TOKEN`, `JENKINS_USER` |
| `azure-devops` | `pipelines` (name or definition id → team) | `orgUrl`, `project`, `environments`, `releases`, `releasesUrl` | `AZURE_DEVOPS_TOKEN` |
| `sonarqube` | `projects` (project key → team) | `baseUrl`, `auth: bearer \| basic`, `branch`, `allowHttp` | `SONAR_TOKEN` |
| `jira` | `teams` (project key → team) | `baseUrl`, `auth: basic` (Cloud) or `bearer` (Server / DC), `email` / `emailEnv`, `jql`, `fields`, `pageSize`, `allowHttp` | `JIRA_TOKEN`, `JIRA_EMAIL` |
| `linear` | `teams` (team key → team) | `teamKeys`, `apiUrl` | `LINEAR_API_KEY` |
| `pagerduty` | `services` (service → team), `teams` (PagerDuty team → team) | `categories`, `serviceIds`, `apiUrl` | `PAGERDUTY_TOKEN` |
| `opsgenie` | `teams` (Opsgenie team → team), `services` (tag `service:<name>` → team) | `region: us \| eu`, `categories`, `query` | `OPSGENIE_API_KEY` |

Proxy: `HTTPS_PROXY` (with optional `user:password@`) and `NO_PROXY` (hosts, `.domain`, `*.domain`, `host:port`, IPv4 CIDR).

## How the values are calculated

With the shared engine (`packages/engine`), the code the QE Navigator server runs: tests (pass rate, first-time pass
rate, flaky tests and flakiness, execution time), coverage (line, branch, changed code), pipelines (build time, success
rate, parallel efficiency), DORA (deployment frequency, lead time, change failure rate), reliability (MTTR, MTBF,
availability, incidents per deploy, infrastructure failures), work (escape rate, defect density, velocity, commitment,
carryover, blocked time, sizing accuracy) and code quality (score, findings, new and fixed), per team and UTC day. The
rules are in QE Navigator's docs/INTEGRATION_GUIDE.md (4A.3, 4B.4, 4C.3). Every value is sent with the engine version;
QE Navigator shows "Calculated by your QE Navigator Collector (engine x.y.z)" in "How this was calculated". A test in the
QE Navigator repository (`tests/api/engine-crosscheck.test.ts`) proves the server and the engine give identical values for
the same data.

## Development

```bash
npm ci --ignore-scripts
npm run typecheck
npm test                    # builds the bundle, then unit, vendor stand-in, privacy-mode and bundle tests (node:test)
npm run sync-allow-list     # vendor server/lib/ingest/fieldAllowList.ts (the shared allow-list) into src/vendor/
```

Layout: `src/sources/*` read the issue and incident tools, `src/sources/ci/*` the CI and SonarQube connectors (with
`common.ts`: artifact reading), `src/store.ts` the local copy, `src/calc.ts` the engine over it, `src/modes.ts` what
evidence and metrics modes send, `src/rawPayloads.ts` what full mode sends for CI records, `src/vendor/fieldAllowList.ts`
the shared allow-list (a byte-for-byte copy of QE Navigator's), `src/policy.ts` the stricter send policy for issues and
incidents, `src/sender.ts` delivery, `src/serve.ts` the local evidence page, `src/diagnose.ts` the diagnostics file,
`src/http.ts` HTTP with proxy, CA, timeouts and retries, `src/yaml.ts` a strict YAML subset parser (no YAML dependency).
The bundle contains only `collector/src` and `packages/engine/src` (the build refuses anything else). End-to-end tests
against a real QE Navigator: `tests/api/collector-e2e.test.ts` and `tests/api/collector-modes-e2e.test.ts` in the QE
Navigator repository.

Choose a licence before publishing (`package.json` says UNLICENSED).
