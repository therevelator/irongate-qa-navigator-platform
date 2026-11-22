# QE Navigator Exporter: security posture

This document is written for the security team that reviews and approves the Exporter. Everything in it can be checked
against the code (`exporter/src`, about 7,000 lines of TypeScript) and with `qe-exporter preview`.

## 1. Summary

| Question | Answer |
|---|---|
| Where does it run? | Inside your network (container, Kubernetes CronJob, systemd timer or cron). |
| What does it connect to? | Outbound only: the tools you configure (read-only) and QE Navigator at `https://app.irongate.ie` (TCP 443). The only listener is the setup page while you run `qe-exporter setup`: 127.0.0.1 only, behind a one-time token. |
| Which credentials does it hold? | Your read-only tool credentials (tokens, app passwords, a GitHub App key, OAuth tokens of your own OAuth apps) and one QE Navigator API key (`igk_…`) that your company admin created. They come from environment variables, `VAR_FILE` files, or the credentials file the setup page writes (mode 0600 in a 0700 folder). Each credential is sent only to the host it belongs to; the QE Navigator key only to QE Navigator, as the Authorization header. Nothing is ever sent to QE Navigator about your tool credentials. |
| What does it send? | The raw data, as JSON envelopes `{ companyId, departmentId, teamId, source, kind, items }` (section 4): report files without messages, pipeline runs, deployments with commit times, incidents and issues through the field allow-list. **It calculates nothing**: QE Navigator does. Never descriptions, comments, failure messages, logs, finding messages, commit messages, names, e-mail addresses or credentials. `qe-exporter preview` prints the exact bodies and sends nothing. |
| How is the right team guaranteed? | Every envelope names the company, the department and the team. QE Navigator checks them against the API key before reading anything else (section 5); a wrong id writes nothing. |
| Where is the data kept on your side? | Nowhere: the state file holds cursors and SHA-256 fingerprints only. |
| Runtime dependencies? | None. One bundled file (`qe-exporter.mjs`, ~280 KB, not minified) built only from `exporter/src`, using only Node's built-in modules (`http`, `https`, `tls`, `net`, `zlib`, `crypto`, `fs`, `path`, `os`). |
| Container? | Distroless Node 20, non-root (65532), no shell, read-only root file system, base images pinned by digest (about 171 MB, 45 MB compressed). |

## 2. Data flow

```
 your network                                                                     |  internet
                                                                                  |
 GitHub / GitLab / Bitbucket / Jenkins / Azure DevOps <-- HTTPS GET (read-only) -+|
   (artifact zip) --302--> signed storage URL <-- GET, no credentials -----------+|
 SonarQube, Jira, Linear, PagerDuty, Opsgenie <-- HTTPS GET / GraphQL query -----+|
                                                                                 ||
 qe-exporter.json (no secrets) -->+--------------------------------------------+ ||
 credentials.json (0600) -------->| qe-exporter                                | ||
 env / VAR_FILE ----------------->|  1 read what changed since the cursor      | ||
                                  |  2 keep only the raw fields QE Navigator   | ||   +---------------------------------+
 state.json (cursors) <---------->|    needs; strip messages, names, authors   |-++-->| QE Navigator                    |
                                  |  3 one envelope per team and kind, with    | 443  | POST /api/ingest/exporter/batch |
 setup page 127.0.0.1:8788 ------>|    companyId, departmentId, teamId         | out  |   checks the 3 ids, then parses,|
 (only while you run setup)       |  4 heartbeat (version, source status)      | only |   stores and calculates         |
                                  +--------------------------------------------+      +---------------------------------+
```

1. **Read.** Each connector asks only for what QE Navigator's calculations need (section 7 lists the endpoints). List
   endpoints that return more (a run's actor, a Jira issue's other fields, a SonarQube issue's message and author) are
   dropped in step 2 and never sent.
2. **Minimise.** Report files are sent as files, but failure messages, stack traces, test output and properties are
   removed from JUnit / TRX / xUnit, error messages and attachments from Cucumber, messages, code flows and snippets from
   SARIF; a file that declares XML entities is not sent. A CI that gives its test results only as JSON (GitLab's test
   report API, Jenkins' JUnit plugin, Azure DevOps test runs, Bitbucket's test reports) and SonarQube's issues are written
   out as a JUnit or SARIF file with names, statuses, times, rules, severities and locations only. Deployments carry
   their commits as sha and times (no author, no message). The coverage of changed code gets the changed **line numbers**
   of a commit (from the patch hunks), never the code. Issues and incidents go through the shared field allow-list
   (`src/vendor/fieldAllowList.ts`, the same list QE Navigator applies) and then the Exporter's stricter send policy
   (`src/policy.ts`); a record that still contains an e-mail address is not sent.
3. **Send.** One envelope per team and kind (at most 50 report items, 100 runs, 500 events or 1,000 issues; 15 MB at most),
   gzip, an `Idempotency-Key` derived from the body, at most 50 requests per minute. A refused item is isolated and reported;
   the others are delivered.
4. **Heartbeat**: version, per source the last success and failed-run count (section 4.3).

## 3. What is never sent

Descriptions, comments, attachments, work logs, custom free-text fields, labels other than environment / type, components,
priorities; test failure messages, stack traces and output; build logs and scripts; finding messages and code; commit
messages; workflow, pipeline, job and run actors; deployment creators; sprint goals; alert and incident descriptions, notes
and details; **any name, user name, account id or e-mail address of a person**; **any credential**. Titles and links only
with `privacy.sendTitles` / `sendLinks` (default off); people only as `HMAC-SHA256(QE_PEOPLE_SALT, stable id)` computed here
(QE Navigator never receives the salt). Commit authors, where a source gives them in a commit list, are turned into a
salted hash by QE Navigator and never stored as names.

## 4. Exact fields

### 4.1 The envelope

`POST /api/ingest/exporter/batch` with `Authorization: Bearer igk_…`, `Content-Encoding: gzip`, `User-Agent: qe-exporter/<version>`,
`X-Exporter-Host: <hostLabel>`, `Idempotency-Key: qe-exporter:<sha256 of the body>`:

```json
{ "companyId": "…", "departmentId": "…", "teamId": "…", "source": "github", "kind": "pipeline-runs", "items": [ … ] }
```

### 4.2 Items per kind

| Kind | Fields |
|---|---|
| `pipeline-runs` | `id`, `attempt`, `name` (workflow / pipeline / job), `commit`, `branch`, `startedAt`, `finishedAt`, `durationSeconds`, `result`, `url` (only with `sendLinks`), `stages[]` (`name`, `kind` only when the CI says it, `parallelGroup` for matrix / sharded jobs, times, `durationSeconds`, `result`) |
| `test-report` | `commit`, `branch`, `run`, `attempt`, `startedAt`, `format` (when written out here), `files[]` (`name`, `content`: the minimised report text) |
| `coverage` | the same, plus `changedLines` (`{"path": [line numbers]}` of the run's commit) |
| `sarif` | the same, plus `repo`, `loc` (lines of code, SonarQube); one minimised SARIF file per item |
| `deployments` | `id`, `environment`, `production`, `service`, `commit`, `previousCommit`, `startedAt`, `finishedAt`, `result`, `rollbackOf`, `hotfix`, `url` (only with `sendLinks`), `commits[]` (`sha`, `authoredAt`, `committedAt`) |
| `issues` | `key`, `type`, `status`, `statusCategory`, `resolution`, `environment` (production / pre-release only), `storyPoints`, `estimateHours`, `timeLoggedHours`, `createdAt`, `resolvedAt`, `updatedAt`, `sprints[]` (id, state, dates; names with `sendTitles`), `transitions[]` (status / sprint / flagged changes with their times); opt-in `title`, `url`, `assigneeHash` (`qe-exporter check` prints the list for your settings) |
| `incidents` | `id`, `service`, `severity`, `status`, `at`, `openedAt`, `acknowledgedAt`, `resolvedAt`, `updates[]` (status, time), `deploymentId`, `category`, `outage`; opt-in `title`, `url`, `responderHash` |
| `kpis` | `recordedAt`, `metrics` (QE Navigator KPI columns → numbers, from your own KPI file) |

### 4.3 Heartbeat (every run)

`POST /api/ingest/exporter/heartbeat`: `exporter`, `version`, `node`, `platform`, `teams` (a count), and per source `name`,
`type`, `lastSuccessAt`, `errors` (failed runs since the last success), `lastErrorAt`, `lastErrorKind` (`auth`, `network`,
`http <status>`, …). No data and no error message (an error message can name a host or a resource).

## 5. How QE Navigator validates the ids

Before an envelope's items are read, QE Navigator (`server/routes/ingestExporter.ts`) checks, for the API key that signed
the request (valid, not revoked):

1. `companyId`, `departmentId` and `teamId` are all present (else `400`);
2. `companyId` is the key's company (else `403`, and nothing is written);
3. `departmentId` is a department of that company (else `403`);
4. `teamId` is an **active** team of that department **and** that company (else `403`);
5. no item names another team, and no service or project-key mapping is used: the envelope's team is the only one the
   items can be written to.

"Another company's id" and "an id that does not exist" get exactly the same answer, so the endpoint reveals nothing about
other companies. `GET /api/ingest/exporter/context` lists only the key's own company, departments and active teams. Every
item is then checked by the same handler as the rest of the ingestion API (a dry run that writes nothing); one refused item
refuses the batch. A dry run (`?dryRun=true`) writes nothing at all. Each batch is logged in your company's ingestion log
(channel Exporter) and, for QE Navigator's platform operators, in an operator log with a sanitised preview (no file
contents, no credentials; the preview is cleared after 30 days, the row without it is kept 13 months).

## 6. Network requirements

| Direction | Destination | Port | Why |
|---|---|---|---|
| out | `app.irongate.ie` (or your `qeNavigator.url`) | TCP 443 | delivery and heartbeat (HTTPS, TLS 1.2+) |
| out | the tools you configure: `api.github.com` (or GHES), `gitlab.com` (or yours), `api.bitbucket.org` (or your Bitbucket Data Center), your Jenkins, `dev.azure.com` (and `vsrm.dev.azure.com` with `releases: true`), your SonarQube or `sonarcloud.io`, your Jira, `api.linear.app`, `api.pagerduty.com`, `api.opsgenie.com` / `api.eu.opsgenie.com` | TCP 443 | reading |
| out | artifact storage hosts the CI redirects downloads to (signed URLs) | TCP 443 | artifact zips, fetched **without** credentials |
| out | the OAuth token endpoint of a vendor (only with OAuth: `github.com`, your GitLab, `bitbucket.org`, `api.linear.app`) | TCP 443 | token refresh |
| out | DNS | 53 | name resolution |
| in | none (the setup page listens on 127.0.0.1 only while you run it) | | |

An HTTPS proxy is supported (`HTTPS_PROXY`, `NO_PROXY`, CONNECT tunnel, proxy credentials redacted from logs). Private or
TLS-inspecting CAs are added with `caFile` (added to the system roots); certificate verification cannot be turned off.
`http://` is accepted only for `localhost`, and for Jira, Jenkins, SonarQube and Bitbucket Data Center only with
`allowHttp: true`. A redirect of a download to a plain-http host is refused. A source's credentials are never sent to any
host other than its base URL (a "next" link or a download URL pointing elsewhere is refused or fetched without them).

## 7. Permissions needed in each tool (read-only)

| Tool | Credential | Minimum permission | Endpoints read |
|---|---|---|---|
| GitHub (PAT) | Fine-grained personal access token of a dedicated account | Repository permissions **Actions: read, Contents: read, Deployments: read, Metadata: read** on the repositories | `GET /repos/{r}`, `/actions/runs`, `/actions/runs/{id}/attempts/{n}/jobs`, `/actions/runs/{id}/artifacts`, `/actions/artifacts/{id}/zip` (302 to storage), `/deployments`, `/deployments/{id}/statuses`, `/compare/{a}...{b}`, `/commits/{sha}`, `/environments` |
| GitHub (App) | A GitHub App installed on the repositories; private key in `GITHUB_APP_PRIVATE_KEY` | The same four read permissions; no write permission, no webhook | the same, plus `POST /app/installations/{id}/access_tokens` (a short-lived installation token; changes nothing) |
| GitHub (OAuth) | A token from your own OAuth app (setup page) | GitHub's OAuth scope for private repositories (`repo`) includes write: prefer the App or a fine-grained token | the same |
| GitLab | Personal, group or project access token, or OAuth with your own application | Scope **read_api**; role Reporter on the projects | `GET /projects/:id`, `/pipelines`, `/pipelines/:pid`, `/pipelines/:pid/jobs`, `/pipelines/:pid/test_report`, `/jobs/:id/artifacts`, `/deployments`, `/repository/compare`, `/environments` |
| Bitbucket Cloud | Username + app password (or API token), Basic; or OAuth with your own consumer, Bearer | **Account: Read, Repositories: Read, Pipelines: Read** | `GET /repositories/{ws}/{repo}`, `/pipelines/`, `/pipelines/{uuid}/steps/`, `/pipelines/{uuid}/steps/{step}/test_reports/test_cases`, `/environments/`, `/deployments/`, `/commits/{sha}?exclude=` |
| Bitbucket Data Center | HTTP access token, Bearer | **Read** on the repositories | `GET /rest/api/1.0/projects/{p}/repos/{r}`, `/commits`, `/commits/{id}/builds`, `/commits/{id}/deployments` |
| Jenkins | User + API token (Basic) of a dedicated user | **Overall/Read**, **Job/Read** (no Build, Configure, ExtendedRead) | `GET <job>/api/json`, `<job>/<n>/wfapi/describe`, `<job>/<n>/testReport/api/json`, `<job>/<n>/artifact/<path>` |
| Azure DevOps | Personal access token | **Build (Read), Test Management (Read), Code (Read), Environment (Read)**; **Release (Read)** only with `releases: true` | `GET _apis/build/definitions`, `/build/builds`, `/build/builds/{id}`, `/timeline`, `/artifacts`, `/changes`, `_apis/test/runs`, `/test/Runs/{id}/results`, `/test/codecoverage`, `_apis/distributedtask/environments`, `/environmentdeploymentrecords`; `vsrm`: `_apis/release/deployments` |
| SonarQube / SonarCloud | User token (Bearer; `auth: basic` for older servers) | **Browse** on the projects (no Execute Analysis, no Administer) | `GET /api/project_analyses/search`, `/api/issues/search`, `/api/measures/component`, `/api/qualitygates/project_status` (check only) |
| Jira Cloud | API token of a dedicated account, Basic auth with its e-mail | *Browse projects* on the projects in the JQL | `myself`, `field`, `status`, `search/jql`, `search/approximate-count` (POST, read-only count), `issue/{key}/changelog` |
| Jira Server / Data Center | Personal Access Token of a dedicated user, Bearer | *Browse projects* | `myself`, `field`, `status`, `search`, `issue/{key}?expand=changelog` |
| Linear | Personal API key, permission **Read**, or OAuth with your own application (scope read) | Membership of the teams read | GraphQL queries only (no mutation exists in the code) |
| PagerDuty | **Read-only** REST API key | | `GET /log_entries`, `GET /incidents/{id}/log_entries`, `GET /services` (check) |
| Opsgenie | API integration key with **Read** access only | | `GET /v2/alerts`, `GET /v2/teams` |
| QE Navigator | Company API key `igk_…` (Admin console → API keys) | Ingestion only: writes data for your company's teams, reads nothing. Use one key per Exporter so it can be revoked alone. | |

Rate limits are respected: 429 / 5xx and GitHub's secondary limits (403 with Retry-After) are retried with jittered backoff
and Retry-After; when a response says no requests are left (`X-RateLimit-Remaining: 0`), the next request waits for the reset.

## 8. Secrets, state and logs

- **Where credentials live**: environment variables, `VAR_FILE` files (Docker / Kubernetes secrets), or the setup page's
  credentials file (`qe-exporter-credentials/credentials.json` next to the config: the folder is created 0700, the file is
  written 0600 atomically; a file readable by others is refused). An environment variable wins over the file. The config
  file never holds a secret: the loader refuses secret-looking keys.
- Secrets are held in memory, registered with the logger and replaced by `[redacted]` wherever they would appear.
  Authorization headers, `user:password@` in URLs and fields named like credentials are always redacted. `preview` shows
  `Authorization: Bearer [redacted]`; `check` and the setup page say only "set" or "missing".
- The state file (`state.path`, mode 0600, atomic write) holds per source a cursor, the last success, error counts and
  item id → SHA-256 fingerprint of what was delivered. No data.
- Logs: one JSON object per line on stderr (or text on a terminal): counts, ids of skipped items with the reason, timings,
  HTTP status codes. `--verbose` adds request paths and retries, never headers or bodies.
- A lock file next to the state prevents overlapping runs (exit code 5).
- `qe-exporter diagnose` writes a file you can read and choose to send: version, config without secrets, which secrets are
  set and where from (environment or credentials file), cursors, error counts. No record, no name, no secret.

## 9. The setup page

Listens on 127.0.0.1 (or `::1` / `localhost`); any other address is refused. In the container image it listens on the
container's interface (`QE_EXPORTER_SETUP_IN_CONTAINER=1`) and must be published to 127.0.0.1 on the host
(`-p 127.0.0.1:8788:8788`). A random one-time token is printed in the terminal; the first request with it receives a session
cookie (HttpOnly, SameSite=Strict) and the token stops working; every page and API without the cookie answers 401, a wrong
token 403. Requests with another `Host` header (DNS rebinding) and writes with another `Origin` are refused.
`Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline'; …; frame-ancestors 'none'`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`; every value is HTML-escaped. Secrets
entered on it go to the credentials file only and are never echoed back. OAuth uses your own OAuth app with the redirect
`http://127.0.0.1:<port>/oauth/callback` and a random `state` (PKCE for GitLab); QE Navigator is not involved.

## 10. Verifying the bundle and the image

The bundle is deterministic: the same source and the same esbuild version (pinned in `package-lock.json`) give the same
bytes. The build refuses any input outside `exporter/src`.

```bash
cd exporter
npm ci --ignore-scripts          # dev tools only: esbuild, typescript, tsx, @types/node (exact versions, lock file)
npm run build                    # prints the size and the SHA-256, writes dist/SHA256SUMS
sha256sum -c dist/SHA256SUMS
```

The image: `docker build -f exporter/Dockerfile -t qe-exporter:0.3.0 .` from the repository root
(`exporter/Dockerfile.dockerignore` sends only the Exporter and the shared allow-list) runs the type check, the allow-list
drift check, the build and the tests, then copies only `qe-exporter.mjs` and `SHA256SUMS` into a distroless base pinned by
digest. To check the file inside an image against your own build:

```bash
docker run --rm --entrypoint /nodejs/bin/node qe-exporter:0.3.0 -e \
  "const f=require('fs');console.log(require('crypto').createHash('sha256').update(f.readFileSync('/app/qe-exporter.mjs')).digest('hex'))"
```

## 11. Review before anything is sent

```bash
node qe-exporter.mjs preview -c qe-exporter.json --out preview.json   # no QE Navigator request at all; no key needed
```

## 12. What has been verified, and what not

Verified: unit and stand-in tests for every connector (pagination, rate limits, auth failures, redirects without
credentials, expired and oversized artifacts, zip bombs, XML entities), the minimisation of report files, the setup page
(loopback only, the token, Host and Origin checks, the credentials file's modes, no secret in logs, preview or diagnostics),
and end-to-end tests against a local QE Navigator with stand-in vendors. Not verified: runs against the real GitHub, GitLab,
Bitbucket, Jenkins, Azure DevOps, SonarQube, Jira, Linear, PagerDuty and Opsgenie services, and the OAuth flows against
the real vendors (the stand-ins follow their documented responses; a first `check` and `preview` on your side is the real
test).

## 13. Reporting a vulnerability

See the QE Navigator [SECURITY.md](../SECURITY.md) (responsible disclosure). Please include the Exporter version
(`qe-exporter --version`).
