# qe-exporter: the QE Navigator Exporter

A small program you run **inside your own network**: a Docker container, or one JavaScript file for Node 20+. You connect
your tools in it (GitHub Actions, GitLab CI, Bitbucket Cloud or Data Center, Jenkins, Azure DevOps, SonarQube, Jira, Linear,
PagerDuty, Opsgenie) with whatever authentication each tool supports. It reads the **raw** data and sends it to QE
Navigator as **JSON** over outbound HTTPS, with an API key your company admin creates in QE Navigator.

- **QE Navigator calculates everything. The Exporter calculates nothing.** It sends test and coverage report files as
  files, pipeline runs, deployments with their commits, incidents and issues; QE Navigator parses, stores and calculates
  (the dashboards, "How this was calculated" and the evidence panels show QE Navigator's values).
- **Every request names your company, the department and the team** (`companyId`, `departmentId`, `teamId`). QE Navigator
  checks all three against the API key and refuses the request if any of them is not yours, so no data can land in the
  wrong team.
- **Your credentials stay with you**: in environment variables or a credentials file with mode 0600 in a 0700 folder.
  They are never logged, never sent to QE Navigator, and `diagnose` and `preview` never show them. Each credential goes
  only to the tool it belongs to.
- **Nothing connects into your network.** The only listener is the setup page while you use it, on 127.0.0.1, behind a
  one-time token.
- **No free text leaves**: failure messages, stack traces, logs, descriptions, comments, commit messages, names and
  e-mail addresses are stripped (details: [SECURITY.md](SECURITY.md)).
- `qe-exporter preview` prints exactly the JSON that would be sent, with the three ids, and sends nothing.

`qe-collector` and `qe-agent` are the same program under its earlier names: those commands, the old config file names
(`qe-collector.yaml`, `qe-agent.yaml`), `QE_COLLECTOR_CONFIG` / `QE_AGENT_CONFIG` and old state files keep working.
Settings of the earlier releases that no longer apply (`privacy.mode`, the local copy, `recalcDays`, `serve`,
`mainBranches`) are ignored with a warning. `recalc` and `serve` were removed: there is nothing to calculate here.

## Five-minute start

**1. Create an API key in QE Navigator** (company admin): Admin console → API keys → Create (name it after the machine,
e.g. `exporter-build-1`). Copy the `igk_…` key: it is shown once.

**2. Get the Exporter**, as a container image (built from the repository root):

```bash
docker build -f exporter/Dockerfile -t qe-exporter:0.4.0 .
```

or the single file (Node 20+, no runtime dependencies):

```bash
cd exporter && npm ci --ignore-scripts && npm run build      # dist/qe-exporter.mjs and dist/SHA256SUMS
```

**3. Open the setup page:**

```bash
docker run --rm -it -p 127.0.0.1:8788:8788 -v qe-exporter:/var/lib/qe-exporter qe-exporter:0.4.0 setup
#   or: node dist/qe-exporter.mjs setup -c ./qe-exporter.json
```

It prints a link such as `http://127.0.0.1:8788/?token=…`. Open it in a browser on the same machine (the link works once;
the page then keeps a session cookie). On the page:

1. **API key**: paste the key. The page loads your company, its departments and teams from QE Navigator.
2. **Connect a tool**: choose it, enter its address and credentials (or connect with OAuth, below), and map each
   repository / project / pipeline / service to a department and team. **Test connection** shows what the Exporter can
   read with those credentials.
3. Repeat for each tool. **Save** writes the config file (`qe-exporter.json`, no secrets in it) and the credentials file.

**4. Preview, then sync:**

```bash
docker run --rm -v qe-exporter:/var/lib/qe-exporter qe-exporter:0.4.0 check     # every source and QE Navigator
docker run --rm -v qe-exporter:/var/lib/qe-exporter qe-exporter:0.4.0 preview   # the exact JSON; nothing is sent
docker run --rm -v qe-exporter:/var/lib/qe-exporter qe-exporter:0.4.0 sync      # first run: the last 90 days
```

Then run `sync` every 15 minutes: a [Kubernetes CronJob](deploy/kubernetes/cronjob.yaml) with a
[NetworkPolicy](deploy/kubernetes/networkpolicy.yaml), a [systemd timer](deploy/systemd/) or [cron](deploy/crontab.example).
Admin console → Connect your CI → *Exporter status* shows the last heartbeat and each source's last success.

To try it with made-up data and no real tools: [deploy/exporter-test/README.md](../deploy/exporter-test/README.md).

## The setup page

- Listens on **127.0.0.1** only (also `::1` or `localhost`); any other address is refused. In the container it listens on
  the container's own interface, and `-p 127.0.0.1:8788:8788` publishes it to 127.0.0.1 on your machine only.
- Protected by a **one-time token** printed in the terminal; without it (or with a wrong one) every page and API answers
  401 / 403. Requests for another host name and writes from another site are refused.
- Secrets typed on the page go **only** to the credentials file (0600, in a 0700 folder next to the config:
  `qe-exporter-credentials/credentials.json`). The page shows "set", never a value.
- **OAuth** uses **your own OAuth app**: register an app with the vendor, set its redirect URI to
  `http://127.0.0.1:8788/oauth/callback`, and enter its client id and secret on the page. QE Navigator has no OAuth app,
  never sees your client secret or tokens, and is not part of the redirect. Tokens are refreshed before a run when they
  expire.
- Prefer files? Everything the page does can be written by hand: [config.example.yaml](config.example.yaml) has every
  option, and secrets come from environment variables (or `VAR_FILE`).

## Authentication and read-only permissions per tool

| Tool | Authentication | Read-only permissions |
|---|---|---|
| GitHub Actions (github.com, Enterprise Server) | Fine-grained token (`GITHUB_TOKEN`); a GitHub App (`auth: app`, `appId`, `installationId`, key in `GITHUB_APP_PRIVATE_KEY`); or OAuth with your own OAuth app (`auth: oauth`) | Repository permissions **Actions: read, Contents: read, Deployments: read, Metadata: read**. GitHub's OAuth scopes for private repositories (`repo`) include write: prefer the GitHub App or a fine-grained token. |
| GitLab CI (gitlab.com, self-managed) | Personal, group or project access token (`GITLAB_TOKEN`); or OAuth with your own GitLab application (`auth: oauth`) | Scope **read_api**, role Reporter on the projects. |
| Bitbucket Cloud | Username + app password or API token (`BITBUCKET_USERNAME`, `BITBUCKET_APP_PASSWORD`); or OAuth with your own OAuth consumer (`auth: oauth`) | **Account: Read, Repositories: Read, Pipelines: Read** (on the app password, or the consumer's permissions). |
| Bitbucket Data Center | HTTP access token (`BITBUCKET_TOKEN`, Bearer): personal, project or repository token | **Read** (repository read). |
| Jenkins | User + API token (`JENKINS_USER`, `JENKINS_TOKEN`) of a dedicated user | **Overall/Read**, **Job/Read**. |
| Azure DevOps | Personal access token (`AZURE_DEVOPS_TOKEN`) of a service account | **Build, Test Management, Code, Environment: Read** (and **Release: Read** with `releases: true`). |
| SonarQube / SonarCloud | User token (`SONAR_TOKEN`; `auth: basic` for older servers) | **Browse** on the projects. |
| Jira Cloud | Service account e-mail + API token (`JIRA_EMAIL`, `JIRA_TOKEN`) | **Browse projects** on the projects of the JQL. |
| Jira Server / Data Center | Personal access token (`JIRA_TOKEN`, `auth: bearer`) | **Browse projects**. |
| Linear | Personal API key (`LINEAR_API_KEY`); or OAuth with your own OAuth application | Scope **read**. |
| PagerDuty | REST API key (`PAGERDUTY_TOKEN`) | A **read-only** API key. |
| Opsgenie | API key (`OPSGENIE_API_KEY`) | An API integration key with **Read** access only. |
| KPI file | none (a local file your scripts write) | — |

OAuth sign-in is offered where the vendor supports an authorization-code flow for an app you register yourself: GitHub,
GitLab, Bitbucket Cloud and Linear. Jira Cloud's OAuth (3LO) is not offered yet: use a service account's API token.

## What is read and what is sent

| Source | Read | Sent (envelope kind) |
|---|---|---|
| GitHub Actions | workflow runs, jobs and steps, artifacts whose names match `artifacts.*` (zip archives opened in memory), deployments to production environments with their statuses, the commits between deployments, the lines a run's commit changed | `pipeline-runs`, `test-report` and `coverage` (the files), `sarif`, `deployments` with `commits` |
| GitLab CI | pipelines, jobs (retries included), the test report API (written out as a JUnit file), job artifacts, deployments, compare | the same |
| Bitbucket Cloud | pipelines with their steps and timings, step test reports (written out as a JUnit file), environments, deployments, commits | `pipeline-runs`, `test-report`, `deployments` with `commits` |
| Bitbucket Data Center | commits, the builds your CI reports on them, deployments | `pipeline-runs`, `deployments` with `commits` (Data Center keeps only test counts, so no test report is sent) |
| Jenkins | builds, Pipeline stages (`wfapi`), the JUnit plugin's results (written out as a JUnit file), archived artifacts, deployment jobs (a redeploy of an earlier commit is sent as the rollback of the previous deployment) | `pipeline-runs`, `test-report`, `coverage`, `sarif`, `deployments` |
| Azure DevOps | builds and timelines, test runs (written out as a JUnit file), code coverage, artifacts, environment deployments, releases | the same |
| SonarQube | the latest analysis, open issues (written out as one SARIF file), lines of code; with `coverage: true` also the coverage totals (lines and conditions to cover, uncovered), written out as a coverage file of totals | `sarif`, `coverage` (optional) |
| Jira, Linear | issues with their changelog, sprints | `issues` |
| PagerDuty, Opsgenie | incidents / alerts with their status changes | `incidents` |
| KPI file | `{ "items": [{ "team", "recordedAt", "metrics": { "automation_coverage": 61.5 } }] }` | `kpis` |

The exact fields: [SECURITY.md](SECURITY.md). The JSON envelope: QE Navigator's docs/INTEGRATION_GUIDE.md, section 4D.

## Commands

| Command | What it does |
|---|---|
| `qe-exporter setup` | The setup page (above). `--port`, `--host` (loopback only). |
| `qe-exporter check` | Validates the config; shows which secrets are set (never their values); for each source authenticates and shows what will be read; loads your company, departments and teams from QE Navigator, checks every mapped team and its department, and sends one dry run per team (nothing is stored). |
| `qe-exporter preview` | Reads the sources and prints a JSON report: per source the window, what is new per team and kind, skipped records with the reason, and **every request exactly as `sync` would send it** (URL, headers with the key redacted, the body with `companyId`, `departmentId`, `teamId`). **Nothing is sent** (no request to QE Navigator at all) and nothing is stored. `--all`: include what was already delivered. `--out FILE`. |
| `qe-exporter sync` | Reads what changed since the last run (the cursor minus `overlapMinutes`) and sends it, then a heartbeat. Re-running sends nothing already delivered. |
| `qe-exporter sync --since 2026-01-01` | Backfill from a date (QE Navigator keeps 13 months; incidents older than 364 days are skipped). |
| `qe-exporter diagnose` | Writes a diagnostics file (`--out FILE`): versions, the config without secrets (which secrets are set and where from), per source the cursor, last success and error counts. No record and no name. Nothing is sent. |

Options: `-c FILE` (default `$QE_EXPORTER_CONFIG`, else `./qe-exporter.yaml`, `./qe-exporter.json`, or an earlier release's
file), `--source NAME`, `--state FILE`, `--log-format json|text`, `-v / --verbose` (requests, retries, timings; never
secrets). `QE_NAVIGATOR_URL` overrides `qeNavigator.url`.

**Exit codes** (for schedulers): `0` ok · `1` internal error · `2` configuration or usage (also: company or a team's
department missing) · `3` a source could not be read · `4` QE Navigator refused (an id that is not yours: 403) or could not
be reached · `5` another run holds the lock · `6` some items were refused (the others were delivered).

## Configuration

One JSON or YAML file (the setup page writes JSON, which is valid YAML too); secrets only from the environment or the
credentials file. Unknown keys and anything that looks like a secret (`token`, `apiKey`, `password`, `salt`, …) are refused.

| Setting | Default | |
|---|---|---|
| `qeNavigator.url` | `https://app.irongate.ie` | https only (http only for localhost). `QE_NAVIGATOR_URL` overrides it. |
| `qeNavigator.companyId` | | Your company id (Admin console → Connect your CI; the setup page fills it in). |
| `teams` | | QE Navigator team id → the id of its department. Every mapped team needs one. |
| `qeNavigator.apiKeyEnv` | `QE_API_KEY` | Name of the key's variable (or credentials file entry). |
| `qeNavigator.caFile` / `http.caFile` | | Extra CA (PEM) added to the system roots, e.g. a TLS-inspecting proxy. Verification is never turned off. |
| `qeNavigator.requestsPerMinute` | `50` | Client-side limit (the API allows 60 per minute per key). |
| `privacy.sendTitles` / `sendLinks` / `people` | `false` / `false` / `none` | Issue and incident titles, links back to your tools, people as `HMAC-SHA256(QE_PEOPLE_SALT, id)`. |
| `state.path` | `./qe-exporter-state.json` | Cursors and fingerprints only (no data); written atomically. |
| `credentials.path` | `<config folder>/qe-exporter-credentials/credentials.json` | The setup page's credentials file (0600, folder 0700). |
| `hostLabel` | the host name | A short name of this machine, sent as `X-Exporter-Host` (shown to QE Navigator's operators). |
| `heartbeat` | `true` | Send the heartbeat (version and per-source status; no data). |
| `backfillDays` | `90` | First run window. |
| `overlapMinutes` | `10` | Re-read before the cursor each run. |
| `http.timeoutSeconds` / `maxRetries` / `maxRetryWaitSeconds` | `30` / `5` / `120` | Every request has a timeout; 429 / 5xx / rate-limit 403 / network errors are retried with jitter and Retry-After. |

Per source (`sources[]`): `type`, `name`, `tokenEnv`, the team mapping, `defaultTeam`, `caFile`, `enabled`. CI sources:
`artifacts` (`tests`, `coverage`, `sarif` name globs; `maxMB`, default 50), `maxRunsPerRepo` (default 500).

| Source | Team mapping | Settings |
|---|---|---|
| `github` | `repos` (owner/name → team) | `apiUrl`, `auth: token \| app \| oauth`, `appId`, `installationId`, `privateKeyEnv`, `workflows`, `branches`, `environments` |
| `gitlab` | `projects` (group/project or id → team) | `apiUrl`, `auth: token \| oauth`, `environments` |
| `bitbucket` | `repos` (workspace/repo → team) | `apiUrl`, `auth: app-password \| oauth`, `username` / `usernameEnv`, `environments` |
| `bitbucket-dc` | `repos` (PROJECT/repo → team) | `baseUrl`, `environments`, `allowHttp` |
| `jenkins` | `jobs` (folder/job → team) | `baseUrl`, `user` / `userEnv`, `deployJobs`, `deployEnvironment`, `allowHttp` |
| `azure-devops` | `pipelines` (name or definition id → team) | `orgUrl`, `project`, `environments`, `releases`, `releasesUrl` |
| `sonarqube` | `projects` (project key → team) | `baseUrl`, `auth: bearer \| basic`, `branch`, `coverage` (default `false`: turn it on for teams whose CI keeps no coverage report, e.g. Bitbucket; leave it off when your CI already sends coverage files), `allowHttp` |
| `jira` | `teams` (project key → team) | `baseUrl`, `auth: basic` (Cloud) or `bearer` (Server / DC), `email` / `emailEnv`, `jql`, `fields`, `pageSize`, `allowHttp` |
| `linear` | `teams` (team key → team) | `teamKeys`, `apiUrl` |
| `pagerduty` | `services` (service → team), `teams` (PagerDuty team → team) | `categories`, `serviceIds`, `apiUrl` |
| `opsgenie` | `teams`, `services` (tag `service:<name>`) | `region: us \| eu`, `categories`, `query` |
| `kpis` | `teams` (the file's team key → team) | `path` |

Proxy: `HTTPS_PROXY` (with optional `user:password@`) and `NO_PROXY` (hosts, `.domain`, `*.domain`, `host:port`, IPv4 CIDR).

## Development

```bash
npm ci --ignore-scripts
npm run typecheck
npm test                    # builds the bundle, then the unit, vendor stand-in, setup page and bundle tests (node:test)
npm run sync-allow-list     # vendor server/lib/ingest/fieldAllowList.ts (the shared allow-list) into src/vendor/
```

Layout: `src/sources/*` the issue and incident tools, `src/sources/ci/*` the CI and code-quality connectors (with
`common.ts`: the items they produce and the report files found in artifacts), `src/minimise.ts` what is stripped from report
files, `src/zip.ts` the ZIP reader (a copy of the server's, with its limits), `src/sender.ts` the envelopes and delivery,
`src/setup.ts` the setup page, `src/credentials.ts` the credentials file, `src/oauth.ts` OAuth with your own app,
`src/policy.ts` the send policy for issues and incidents, `src/vendor/fieldAllowList.ts` the shared allow-list,
`src/diagnose.ts`, `src/http.ts`, `src/yaml.ts`. The bundle contains only `exporter/src` (the build refuses anything else).
End-to-end tests against a real QE Navigator: `tests/api/exporter-e2e.test.ts` in the QE Navigator repository.

Choose a licence before publishing (`package.json` says UNLICENSED).
