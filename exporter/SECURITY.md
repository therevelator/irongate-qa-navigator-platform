# QE Navigator Collector: security posture

This document is written for the security team that reviews and approves the Collector. Everything in it can be checked
against the code (`collector/src` and the shared calculation engine `packages/engine/src`, together about 9,000 lines of
TypeScript) and with `qe-collector preview`.

## 1. Summary

| Question | Answer |
|---|---|
| Where does it run? | Inside your network (container, Kubernetes CronJob, systemd timer or cron). |
| What does it connect to? | Outbound only: the tools you configure (read-only) and QE Navigator at `https://app.irongate.ie` (TCP 443). The only listener is the optional local evidence page (`qe-collector serve`), bound to 127.0.0.1 by default. |
| Which credentials does it hold? | Your read-only tool tokens and one QE Navigator ingestion key (`igk_…`), from environment variables or secret files. Each credential is sent only to the host it belongs to; an artifact download that redirects to a storage host follows the redirect **without** it. The QE Navigator key can only write ingestion data for your company (it cannot read anything). |
| What does it send? | It depends on `privacy.mode` (section 4): **evidence** (default) calculated values with the evidence lists the app shows; **metrics** values and counts only; **full** minimised raw records. Never descriptions, comments, failure messages or logs, finding messages, commit messages, names or e-mail addresses. `qe-collector preview` prints the exact bodies. |
| Where is the raw data? | In a local copy on the Collector's volume (JSON lines, files 0600, folders 0700, retention 400 days by default). In evidence and metrics modes it never leaves your network. |
| Runtime dependencies? | None. One bundled file (`qe-collector.mjs`, ~390 KB, not minified) built only from `collector/src` and `packages/engine/src`, using only Node's built-in modules (`http`, `https`, `tls`, `net`, `zlib`, `crypto`, `fs`, `path`). |
| Container? | Distroless Node 20, non-root (65532), no shell, read-only root file system, base images pinned by digest (about 171 MB, 45 MB compressed; the Collector itself is the one file). |

## 2. Data flow

```
 your network                                                                    |  internet
                                                                                 |
 GitHub / GitLab / Jenkins / Azure DevOps  <-- HTTPS GET (read-only token) --+   |
   (artifact zip) --302--> signed storage URL <-- GET, no credentials -------+   |
 SonarQube, Jira, Linear, PagerDuty, Opsgenie <-- HTTPS GET / GraphQL query -+   |
                                                                             |   |
                         +---------------------------------------------------+   |
 qe-collector.yaml ----->| qe-collector                                      |   |
 env / secret files ---->|  1 read (only what the calculations need)         |   |
                         |  2 normalise (records of the shared engine)       |   |
 local copy  <---------->|  3 keep in the local copy (JSON lines, retention) |   |
 (state folder)          |  4 calculate with the shared engine (per day)     |   |
                         |  5 by privacy.mode:                               |   |   +----------------------------+
                         |     evidence / metrics: values (+ evidence lists) |---+-->| QE Navigator               |
                         |       allow-list per mode (modes.ts)              | 443   | /api/ingest/collector/     |
                         |     full: raw records, field allow-list + policy  | out   |   metrics, heartbeat       |
                         |  6 heartbeat (versions, per-source status)        | only  | /api/ingest/* (full mode)  |
                         +---------------------------------------------------+       +----------------------------+
 qe-collector serve (optional, localhost): the evidence pages, from the local copy
```

1. **Read.** Each connector asks only for what the calculations need (section 6 lists the endpoints). List endpoints that
   return more (a workflow run's actor, a Jira issue's other fields, a SonarQube issue's message and author) are dropped
   in step 2 and never stored or sent.
2. **Normalise** into the shared engine's records (`packages/engine/src/store/records.ts`): runs and stages with times and
   results, test cases with suite, name, status, duration and retries (no failure message or output), coverage per file
   (path, lines and branches found and hit), deployments with their commits (sha and times; no author, no message), findings
   (rule, severity, file, fingerprint; no message), issues and incidents through the shared field allow-list and the typed
   send policy (as before).
3. **Local copy** (`state.dataDir`): JSON lines, one folder per kind, one file per month; an unchanged record writes nothing;
   month files older than `state.retentionDays` (400) are deleted; per-test results and per-file coverage are dropped from
   records older than `state.detailDays` (35).
4. **Calculate** with the shared engine (`packages/engine`), the code QE Navigator runs, per team and UTC day.
5. **Send** by mode (section 4), batched, gzip, `Idempotency-Key`, at most 50 requests per minute.
6. **Heartbeat**: versions, mode, per source the last success and failed-run count (section 4.4).

## 3. What is never sent (any mode)

Descriptions, comments, attachments, work logs, custom free-text fields, labels, components, priorities; test failure
messages, stack traces and output; build logs; finding messages; commit messages; workflow, pipeline, job and run actors;
deployment creators; sprint goals; alert and incident descriptions, notes and details; **any name, user name, account id or
e-mail address of a person**; any credential. In full mode, titles and links only with `sendTitles` / `sendLinks` (default
off) and people only as `HMAC-SHA256(QE_PEOPLE_SALT, stable id)` computed here (QE Navigator never receives the salt).

## 4. Exact fields per privacy mode

### 4.1 metrics mode (no names at all)

`POST /api/ingest/collector/metrics`:

| Field | Content |
|---|---|
| `collector`, `engineVersion`, `mode` | `qe-collector/<version>`, the engine version, `metrics` |
| `localEvidenceUrl` | your `privacy.localEvidenceUrl`, if set (the app links to it) |
| `teams[].teamId` | QE Navigator team id |
| `teams[].days[].day` | YYYY-MM-DD |
| `…metrics[].key` | one of the 30 metric keys (e.g. `line_coverage`, `test_flakiness_rate`, `mttr`) |
| `…metrics[].value`, `sampleSize`, `recordedAt` | the value, the number of runs / deploys / incidents it is based on, the time it is for |
| `…metrics[].inputs` | numbers only: counts, medians, windows (e.g. `linesHit`, `linesFound`, `flakyTests`, `distinctTests`, `productionDeploys`, `failedChanges`, `escapedBugs`). Any text input (a report format, a sprint name, a branch) is dropped. |

Nothing else: no test name, file path, stage or job name, repository, deployment or incident id, issue key, commit sha or
title. A test (`test/modes.test.ts`) checks every string value of every body against this list and that none of the test
names, paths, stage names, keys or shas of the fixtures appear; QE Navigator refuses evidence or text inputs in metrics
mode.

### 4.2 evidence mode (default)

Everything of 4.1 (`mode`: `evidence`), plus these evidence lists and nothing else (both the Collector, `src/modes.ts`, and
QE Navigator, `server/lib/collectorIngest.ts`, enforce the list; an unknown field is refused):

| Where | Fields |
|---|---|
| `flaky_tests`, `test_flakiness_rate` → `evidence.flakyTests[]` (≤ 25) | test `name`, `suite`, `commit` (sha), `failedRuns` and `passedRuns` (counts) |
| `line_coverage` → `evidence.lowestFiles[]` (≤ 10) | file `path`, `linesFound`, `linesHit` |
| `change_failure_rate` → `evidence.failedDeployments[]` (≤ 50) | `deploymentId` (your CI's id), `reasons[]`: `type` (rolled_back / rollback / hotfix / incident), `ref` (the other deployment's or the incident's id), `at` |
| `escape_rate`, `defect_density` → `evidence.escaped[]` (≤ 50) | issue keys (e.g. `PAY-101`) |
| `teams[].evidence` (the team's evidence panel) | `asOf`; `flakyTests[]` (name, suite, commits, failedRuns, passedRuns, lastSeen); `lowestFiles[]` (path, lines and branches found and hit, coverage); `slowestStages[]` (stage / job name, runs, median and longest seconds); `failingStages[]` (stage / job name, runs, failed, failure rate, median seconds) |

A text containing an e-mail address is dropped by the Collector and refused by QE Navigator.

### 4.3 full mode (minimised raw records)

| Endpoint | Body |
|---|---|
| `POST /api/ingest/tests?team&commit&branch&run&attempt&startedAt&format=junit` | JUnit XML generated here: per test `classname` (suite), `name`, `time`, `<failure/>` / `<error/>` / `<skipped/>` without message, `<flakyFailure/>` per retry |
| `POST /api/ingest/coverage?…&format=lcov` | lcov generated here: per file `SF` (path), `LF`, `LH`, `BRF`, `BRH` (no line data) |
| `POST /api/ingest/pipelines?team` | per run `id`, `attempt`, `name` (workflow / pipeline / job), `commit`, `branch`, `startedAt`, `finishedAt`, `durationSeconds`, `result`, `url` (only with `sendLinks`), `stages[]` (`name`, `kind`, `parallelGroup`, times, `durationSeconds`, `result`) |
| `POST /api/ingest/deployments?team` | per deployment `id`, `environment`, `production`, `service`, `commit`, `previousCommit`, `startedAt`, `finishedAt`, `result`, `rollbackOf`, `hotfix`, `url` (only with `sendLinks`), `commits[]` (`sha`, `authoredAt`, `committedAt`) |
| `POST /api/ingest/static-analysis?…&repo&loc` | SARIF generated here: per finding `ruleId`, severity, file path, fingerprint (no message) |
| `POST /api/ingest/issues`, `/incidents` | as before: the shared field allow-list and the typed send policy (`src/policy.ts`; `qe-collector check` prints the field lists for your settings) |

### 4.4 Heartbeat (every mode, every run)

`POST /api/ingest/collector/heartbeat`: `collector`, `version`, `engineVersion`, `mode`, `localEvidenceUrl`, `node`,
`platform`, `teams` (a count), `store` (records, files, bytes of the local copy), and per source `name`, `type`,
`lastSuccessAt`, `errors` (failed runs since the last success), `lastErrorAt`, `lastErrorKind` (`auth`, `network`,
`http <status>`, …). No data and no error message (an error message can name a host or a resource).

## 5. Network requirements

| Direction | Destination | Port | Why |
|---|---|---|---|
| out | `app.irongate.ie` (or your `qeNavigator.url`) | TCP 443 | delivery and heartbeat (HTTPS, TLS 1.2+) |
| out | the tools you configure: `api.github.com` (or GHES), `gitlab.com` (or yours), your Jenkins, `dev.azure.com` (and `vsrm.dev.azure.com` with `releases: true`), your SonarQube or `sonarcloud.io`, your Jira, `api.linear.app`, `api.pagerduty.com`, `api.opsgenie.com` / `api.eu.opsgenie.com` | TCP 443 | reading |
| out | artifact storage hosts the CI redirects downloads to (GitHub: `*.blob.core.windows.net` / `pipelines.actions.githubusercontent.com`-style signed URLs; GitLab object storage) | TCP 443 | artifact zips, fetched **without** credentials |
| out | DNS | 53 | name resolution |
| in | optional: the local evidence page (`serve.host`:`serve.port`, default 127.0.0.1:8787) | TCP | only if you run `serve`; bind it to localhost or an internal address |

An HTTPS proxy is supported (`HTTPS_PROXY`, `NO_PROXY`, CONNECT tunnel, proxy credentials redacted from logs). Private or
TLS-inspecting CAs are added with `caFile` (added to the system roots); certificate verification cannot be turned off.
`http://` is accepted only for `localhost`, and for Jira, Jenkins and SonarQube only with `allowHttp: true`. A redirect of
a download to a plain-http host is refused. A source's credentials are never sent to any host other than its base URL
(a "next" link or a download URL pointing elsewhere is refused or fetched without them).

## 6. Permissions needed in each tool (read-only)

| Tool | Credential | Minimum permission | Endpoints read |
|---|---|---|---|
| GitHub (PAT) | Fine-grained personal access token of a dedicated account | Repository permissions **Actions: read, Contents: read, Deployments: read, Metadata: read** on the repositories | `GET /repos/{r}`, `/actions/runs`, `/actions/runs/{id}/attempts/{n}/jobs`, `/actions/runs/{id}/artifacts`, `/actions/artifacts/{id}/zip` (302 to storage), `/deployments`, `/deployments/{id}/statuses`, `/compare/{a}...{b}`, `/commits/{sha}`, `/environments` |
| GitHub (App) | A GitHub App installed on the repositories; private key in `GITHUB_APP_PRIVATE_KEY` | The same four read permissions; no write permission, no webhook | the same, plus `POST /app/installations/{id}/access_tokens` (a short-lived installation token; changes nothing) |
| GitLab | Personal, group or project access token | Scope **read_api**; role Reporter on the projects | `GET /projects/:id`, `/pipelines`, `/pipelines/:pid`, `/pipelines/:pid/jobs`, `/pipelines/:pid/test_report`, `/jobs/:id/artifacts`, `/deployments`, `/repository/compare`, `/environments` |
| Jenkins | User + API token (Basic) of a dedicated user | **Overall/Read**, **Job/Read** (no Build, Configure, ExtendedRead) | `GET <job>/api/json`, `<job>/<n>/wfapi/describe`, `<job>/<n>/testReport/api/json`, `<job>/<n>/artifact/<path>` |
| Azure DevOps | Personal access token | **Build (Read), Test Management (Read), Code (Read), Environment (Read)**; **Release (Read)** only with `releases: true` | `GET _apis/build/definitions`, `/build/builds`, `/build/builds/{id}`, `/timeline`, `/artifacts`, `/changes`, `_apis/test/runs`, `/test/Runs/{id}/results`, `/test/codecoverage`, `_apis/distributedtask/environments`, `/environmentdeploymentrecords`; `vsrm`: `_apis/release/deployments` |
| SonarQube / SonarCloud | User token (Bearer; `auth: basic` for older servers) | **Browse** on the projects (no Execute Analysis, no Administer) | `GET /api/project_analyses/search`, `/api/issues/search`, `/api/measures/component`, `/api/qualitygates/project_status` |
| Jira Cloud | API token of a dedicated account, Basic auth with its e-mail | *Browse projects* on the projects in the JQL | `myself`, `field`, `status`, `search/jql`, `search/approximate-count` (POST, read-only count), `issue/{key}/changelog` |
| Jira Server / Data Center | Personal Access Token of a dedicated user, Bearer | *Browse projects* | `myself`, `field`, `status`, `search`, `issue/{key}?expand=changelog` |
| Linear | Personal API key, permission **Read** | Membership of the teams read | GraphQL queries only (no mutation exists in the code) |
| PagerDuty | **Read-only** REST API key | | `GET /log_entries`, `GET /incidents/{id}/log_entries`, `GET /services` (check) |
| Opsgenie | API integration key with **Read** access only | | `GET /v2/alerts`, `GET /v2/teams` |
| QE Navigator | Company API key `igk_…` (Admin console → API keys) | Ingestion only: writes data for your company's teams, reads nothing. Use one key for the Collector so it can be revoked alone. | |

Rate limits are respected: 429 / 5xx and GitHub's secondary limits (403 with Retry-After) are retried with jittered backoff
and Retry-After; when a response says no requests are left (`X-RateLimit-Remaining: 0`), the next request waits for the reset.

## 7. Secrets, state, local copy and logs

- Secrets come only from environment variables or `VAR_FILE` files; the config loader refuses secret-looking keys in the
  file. Secrets are held in memory, registered with the logger and replaced by `[redacted]` wherever they would appear.
  Authorization headers, `user:password@` in URLs and fields named like credentials are always redacted. `preview` shows
  `Authorization: Bearer [redacted]`. `check` says only "set" or "MISSING".
- The state file (`state.path`, mode 0600, atomic write) holds per source a cursor, the last success, error counts and
  record id → SHA-256 fingerprint of what was delivered; per team and day a fingerprint of the values delivered.
- The local copy (`state.dataDir`) holds the normalised records of section 2.2 (no message, no person). Protect the volume
  like the tools' own data; delete it to forget everything (the next run reads `backfillDays` again).
- Logs: one JSON object per line on stderr (or text on a terminal): counts, ids of skipped records with the reason,
  timings, HTTP status codes. `--verbose` adds request paths and retries, never headers or bodies.
- A lock file next to the state prevents overlapping runs (exit code 5).
- `qe-collector diagnose` writes a file you can read and choose to send: versions, config without secrets, which secret
  variables are set, cursors, error counts, the local copy's size. No record, no name, no secret.

## 8. The local evidence page (`qe-collector serve`)

Read-only (GET and HEAD; anything else 405), no scripts, no external assets, no cookies; `Content-Security-Policy:
default-src 'none'; style-src 'unsafe-inline'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control:
no-store`; every value HTML-escaped. Binds to `serve.host` (default 127.0.0.1). A wildcard address (0.0.0.0, ::) is refused
unless basic auth is set (`QE_SERVE_USER` and `QE_SERVE_PASSWORD`, compared in constant time); put it behind your own TLS
proxy if it is reached over the network.

## 9. Verifying the bundle and the image

The bundle is deterministic: the same source and the same esbuild version (pinned in `package-lock.json`) give the same
bytes, on any machine and inside the image build. The build refuses any input outside `collector/src` and
`packages/engine/src`, and a test checks that the engine imports nothing but relative files and Node's `crypto` and `zlib`.

```bash
cd collector
npm ci --ignore-scripts          # dev tools only: esbuild, typescript, tsx, @types/node (exact versions, lock file)
npm run build                    # prints the size, the SHA-256 and the engine version, writes dist/SHA256SUMS
sha256sum -c dist/SHA256SUMS     # or compare with the SHA256SUMS published with a release
```

Reproduced for 0.2.0 (engine 1.0.0): `dist/qe-collector.mjs` 387,392 bytes, sha256
`2c1fc0c9f7870507b2ba402b55f58a1dde1a43e3b5e2beb966dcd7373ba111ea` (local build and inside `docker build`).

The image: `docker build -f collector/Dockerfile -t qe-collector:0.2.0 .` from the repository root
(`collector/Dockerfile.dockerignore` sends only the Collector, the engine and the shared allow-list) runs the type check,
the allow-list drift check, the engine tests, the build and the Collector's tests, then copies only `qe-collector.mjs` and
`SHA256SUMS` into a distroless base pinned by digest. To check the file inside an image against your own build (the image
has no shell, so use its Node):

```bash
docker run --rm --entrypoint /nodejs/bin/node qe-collector:0.2.0 -e \
  "const f=require('fs');console.log(require('crypto').createHash('sha256').update(f.readFileSync('/app/qe-collector.mjs')).digest('hex'))"
```

Push the image to your own registry and deploy it by digest. Update the base image digests in the Dockerfile deliberately
(`docker pull`, `docker image inspect --format '{{index .RepoDigests 0}}'`), then rebuild.

## 10. Air-gapped review (preview only)

```bash
node qe-collector.mjs preview -c qe-collector.yaml --offline --out preview.json   # no QE_API_KEY needed
```

It reads your tools with the configured credentials, writes no state and no local copy, makes no request to QE Navigator,
and `preview.json` contains every request body that `sync` would send in your privacy mode, and the heartbeat. Review it
(e.g. `jq '.requests[].body'`), search it for anything you consider sensitive, then decide. Without network access to the
tools at all, the tests (`npm test`) run the same code over realistic vendor responses (`test/fixtures/`, `test/ci-fixtures.ts`)
and prove what each mode sends.

## 11. What has been verified, and what not

Verified: unit and stand-in tests for every connector (pagination, rate limits, redirects without credentials, expired and
oversized artifacts, zip bombs, XML entities), the privacy modes, the local copy, the local page and diagnostics; end-to-end
tests against a local QE Navigator for every mode. Not verified: runs against the real GitHub, GitLab, Jenkins, Azure DevOps
and SonarQube services (the stand-ins follow their documented responses; a first `check` and `preview` on your side is the
real test).

## 12. Reporting a vulnerability

See the QE Navigator [SECURITY.md](../SECURITY.md) (responsible disclosure). Please include the Collector version
(`qe-collector --version`).
