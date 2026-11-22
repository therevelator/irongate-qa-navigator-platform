# qe-agent security posture

This document is written for the security team that reviews and approves the agent. Everything in it can be
checked against the code in this folder (`src/`, about 3,000 lines of TypeScript) and with `qe-agent preview`.

## 1. Summary

| Question | Answer |
|---|---|
| Where does it run? | Inside your network (container, Kubernetes CronJob, systemd timer or cron). |
| What does it connect to? | Outbound only: your Jira / Linear / PagerDuty / Opsgenie (read-only), and QE Navigator at `https://app.irongate.ie` (TCP 443). It opens no listening port; nothing connects to it. |
| Which credentials does it hold? | Your read-only tool tokens and one QE Navigator ingestion key (`igk_…`), from environment variables or secret files. Each credential is sent only to the host it belongs to; the QE Navigator key can only write ingestion data for your company (it cannot read anything). |
| What does it send? | Only the fields in section 4, after two allow-lists. No descriptions, comments, attachments, free text, names or e-mail addresses. `qe-agent preview` prints the exact bodies. |
| Runtime dependencies? | None. One bundled file (`qe-agent.mjs`, ~120 KB, not minified) using only Node's built-in modules (`http`, `https`, `tls`, `net`, `zlib`, `crypto`, `fs`, `path`). |
| Container? | Distroless Node 20, non-root (65532), no shell, read-only root file system, base images pinned by digest. |

## 2. Data flow

```
 your network                                                        |  internet
                                                                     |
 +-----------------+  HTTPS GET (read-only token)                    |
 | Jira Cloud / DC |<---------------------+                          |
 +-----------------+                      |                          |
 +-----------------+  HTTPS POST (GraphQL  |                          |
 | Linear          |<--- query, read key)-+                          |
 +-----------------+                      |                          |
 +-----------------+  HTTPS GET            |                          |
 | PagerDuty       |<---------------------+                          |
 +-----------------+                      |                          |
 +-----------------+  HTTPS GET            |                          |
 | Opsgenie        |<---------------------+                          |
 +-----------------+                      |                          |
                                 +--------+---------------------+    |
  qe-agent.yaml (no secrets) --->| qe-agent                     |    |
  env / secret files ----------->|  1 read (only needed fields)  |    |
  state.json (cursors, hashes)<->|  2 map to QE Navigator JSON   |    |
                                 |  3 shared field allow-list    |    |
                                 |  4 agent send policy (typed)  |    |    +------------------------+
                                 |  5 e-mail scan, batch, gzip   |----+--->| QE Navigator           |
                                 +------------------------------+ HTTPS    | POST /api/ingest/issues|
                                    (optional HTTPS_PROXY)        443 out  | POST /api/ingest/      |
                                                                  only     |      incidents         |
                                                                           +------------------------+
```

1. **Read.** Jira is asked only for the fields the calculations need (`fields=issuetype,status,…`; never
   `*all`, description, comment, attachment, worklog). Linear's GraphQL query names only the needed fields.
   PagerDuty log entries and Opsgenie alerts are list endpoints that return more than needed; those extra
   fields exist only in memory and are dropped in steps 2–4.
2. **Map** to QE Navigator's JSON shape. Classification happens here: an issue's environment text (often free
   text) becomes only `production` or `pre-release`; labels decide only the type and the environment and are not sent.
3. **Shared allow-list** (`src/vendor/fieldAllowList.ts`): the same list QE Navigator applies on its side
   (a byte-for-byte copy of `server/lib/ingest/fieldAllowList.ts`, checked by a test). Anything not on it is dropped;
   raw person fields are dropped (the agent never passes a salt to it).
4. **Send policy** (`src/policy.ts`): a stricter, typed list. Each value must match its type (enum, ISO 8601 UTC time,
   number in range, 16–64 hex characters for a hash); opt-in fields need their setting.
5. **Last check**: a record that still contains an e-mail address anywhere is not sent (reported as skipped).
   Then batching (≤ 1,000 issues / ≤ 500 incidents, ≤ 9 / 4.5 MB), gzip, `Idempotency-Key`, delivery.

## 3. What is never sent

Descriptions, comments, attachments, work logs, custom free-text fields, sprint goals, labels, components,
priorities, due dates, versions, project and team names, alert / incident descriptions, notes, details, sources and
aliases, escalation policies, and **any name, user name, account id or e-mail address of a person**. Titles and links
only with `sendTitles` / `sendLinks` (default off). People only with `privacy.people: hash`, as
`HMAC-SHA256(QE_PEOPLE_SALT, stable id)` truncated to 32 hex characters, computed in the agent with a salt that
QE Navigator never receives (so it can neither reverse nor recompute the hash).

## 4. Exact fields sent per source

Issues (`POST /api/ingest/issues`, body `{"issues": [...]}`):

| Sent field | Jira (Cloud v3 / Server-DC v2) | Linear |
|---|---|---|
| `key` | `key` | `identifier` |
| `team` | QE Navigator team id from your mapping of `fields.project.key` | from your mapping of `team.key` |
| `type` | `fields.issuetype.name` / `.subtask` → bug, story, task, subtask, epic, spike, other | labels Bug / Defect → bug, Feature / Story → story, parent → subtask, else task |
| `status` | `fields.status.name` (workflow status name) | `state.name` |
| `statusCategory` | `fields.status.statusCategory.key` → todo / in_progress / done | `state.type` |
| `resolution` | `fields.resolution.name` | Done / Canceled |
| `environment` | `production` or `pre-release` only, classified from the found-in field, `fields.environment` or labels | from labels `env:…`, `production`, … |
| `storyPoints` | story points field (auto-detected or `fields.storyPoints`) | `estimate` |
| `estimateHours`, `timeLoggedHours` | `timeoriginalestimate`, `timespent` (seconds → hours) | — |
| `createdAt`, `resolvedAt`, `updatedAt` | `created`, `resolutiondate`, `updated` | `createdAt`, `completedAt` / `canceledAt`, `updatedAt` |
| `sprints[]` | `id`, `state`, `startedAt`, `endsAt`, `completedAt` of the sprint field (name only with `sendTitles`) | the cycle: `id`, dates (name "Cycle n" only with `sendTitles`) |
| `transitions[]` | changelog items of `status` (from / to status names, category), `Sprint` (sprint ids), `Flagged` (on / off), with times | history `fromState` / `toState` names and types, `fromCycle` / `toCycle` ids, with times |
| `title` (opt-in) | `fields.summary`, e-mails and links masked | `title`, masked |
| `url` (opt-in) | `<baseUrl>/browse/<key>` | `url` |
| `assigneeHash` (opt-in) | HMAC of `fields.assignee.accountId` (Server: `key` / `name`) | HMAC of `assignee.id` |

Incidents (`POST /api/ingest/incidents`, body `{"incidents": [...]}`):

| Sent field | PagerDuty | Opsgenie (alerts) |
|---|---|---|
| `id` | incident `id` | alert `id` |
| `team` | your mapping of the service (name or id), else of the PagerDuty team name | your mapping of the tag `service:<name>`, else of the Opsgenie team name |
| `service` | `service.summary` | tag `service:<name>` (or `entity`) |
| `severity` | `priority.summary` P1–P5, else `urgency` | `priority` P1–P5 |
| `status`, `at` | current status; time of the last status log entry | open / acknowledged / closed; `updatedAt` |
| `openedAt` | `created_at` | `createdAt` |
| `acknowledgedAt` | first `acknowledge_log_entry` | `createdAt + report.ackTime` |
| `resolvedAt` | `resolved_at` / last `resolve_log_entry` | `createdAt + report.closeTime` |
| `updates[]` | every trigger / acknowledge / unacknowledge / resolve entry: `{status, at}` | — |
| `deploymentId` | `metadata.deployment_id` when present | tag `deployment:<id>` |
| `category` | your `categories` mapping of the service | tag `category:<name>` or your mapping |
| `title`, `url`, `responderHash` (opt-in) | `title` (masked), `html_url`, HMAC of the acknowledging user's id | `message` (masked), —, HMAC of `report.acknowledgedBy` |

`qe-agent check` prints the field lists for your settings; `qe-agent preview` prints the records.

## 5. Network requirements

| Direction | Destination | Port | Why |
|---|---|---|---|
| out | `app.irongate.ie` (or your `qeNavigator.url`) | TCP 443 | delivery (HTTPS, TLS 1.2+) |
| out | your Jira site, `api.linear.app`, `api.pagerduty.com`, `api.opsgenie.com` / `api.eu.opsgenie.com` | TCP 443 | reading, only the sources you configure |
| out | DNS | 53 | name resolution |
| in | — | — | none: the agent opens no port |

An HTTPS proxy is supported (`HTTPS_PROXY`, `NO_PROXY`, CONNECT tunnel, proxy credentials redacted from logs). Private
or TLS-inspecting CAs are added with `caFile` (added to the system roots); certificate verification cannot be turned off
(there is no setting for it). `http://` is accepted only for `localhost`, and for a Jira only with `allowHttp: true`.
The agent refuses to send a source's credentials to any host other than that source's base URL.

## 6. Permissions needed in each tool (read-only)

| Tool | Credential | Minimum permission |
|---|---|---|
| Jira Cloud | API token of a dedicated account, Basic auth with its e-mail | *Browse projects* on the projects in the JQL. No admin, no write. Endpoints: `myself`, `field`, `status`, `search/jql`, `search/approximate-count` (POST, read-only count), `issue/{key}/changelog`. |
| Jira Server / Data Center | Personal Access Token of a dedicated user, Bearer | *Browse projects* on those projects. Endpoints: `myself`, `field`, `status`, `search`, `issue/{key}?expand=changelog`. |
| Linear | Personal API key, permission **Read** | Membership of the teams read. GraphQL queries only (no mutation exists in the code). |
| PagerDuty | **Read-only** REST API key (Integrations → API Access Keys) or a user token of a read-only user | `GET /log_entries`, `GET /incidents/{id}/log_entries`, `GET /services` (check). |
| Opsgenie | API integration key with **Read** access only (no Create / Update / Delete / Configuration) | `GET /v2/alerts`, `GET /v2/teams` (optional: without it, map teams by id). |
| QE Navigator | Company API key `igk_…` (Admin console → API keys) | Ingestion only: it can write raw data for your company's teams and cannot read anything. Use one key for the agent so it can be revoked alone. |

## 7. Secrets, state and logs

- Secrets come only from environment variables or `VAR_FILE` files; the config loader refuses secret-looking keys in the
  file. Secrets are held in memory, registered with the logger and replaced by `[redacted]` wherever they would appear.
  Authorization headers, `user:password@` in URLs and fields named like credentials are always redacted. `preview`
  shows `Authorization: Bearer [redacted]`. `check` says only "set" or "MISSING".
- The state file (`state.path`, mode 0600, atomic write) holds per source a cursor (a time), the last success time and
  record id → SHA-256 fingerprint (24 hex) of what was delivered. No secret and no record content.
- Logs: one JSON object per line on stderr (or text on a terminal): counts, ids of skipped records with the reason,
  timings, HTTP status codes. `--verbose` adds request paths and retries, never headers or bodies.
- A lock file next to the state prevents overlapping runs (exit code 5).

## 8. Verifying the bundle and the image

The bundle is deterministic: the same source and the same esbuild version (pinned in `package-lock.json`) give the same
bytes, on any machine and inside the image build.

```bash
cd agent
npm ci --ignore-scripts          # dev tools only: esbuild, typescript, tsx, @types/node (exact versions, lock file)
npm run build                    # prints the size and SHA-256, writes dist/SHA256SUMS
sha256sum -c dist/SHA256SUMS     # or compare with the SHA256SUMS published with a release
```

Reproduced for 0.1.0: `dist/qe-agent.mjs` 119,934 bytes, sha256
`36757b6ebb7bee4b8082d3414a1ca3b17c0668ff948625fefbe2e3343405359a` (local build and inside `docker build`). The build
script refuses to bundle any file from outside `agent/src` (so no third-party code can end up in it).

The image: `docker build -t qe-agent:0.1.0 .` runs the type check, the build and the tests, then copies only
`qe-agent.mjs` and `SHA256SUMS` into a distroless base pinned by digest. To check the file inside an image against your own
build (the image has no shell, so use its Node):

```bash
docker run --rm --entrypoint /nodejs/bin/node qe-agent:0.1.0 -e \
  "const f=require('fs');console.log(require('crypto').createHash('sha256').update(f.readFileSync('/app/qe-agent.mjs')).digest('hex'))"
```

Push the image to your own registry and deploy it by digest. Update the base image digests in the Dockerfile
deliberately (`docker pull`, `docker image inspect --format '{{index .RepoDigests 0}}'`), then rebuild.

## 9. Air-gapped review (preview only)

The agent can be evaluated without ever contacting QE Navigator:

```bash
node qe-agent.mjs preview -c qe-agent.yaml --offline --out preview.json   # no QE_API_KEY needed
```

It reads your tools with the configured credentials, writes no state, makes no request to QE Navigator, and
`preview.json` contains every request body that `sync` would send. Review the file (e.g. `jq '.requests[].body'`),
search it for anything you consider sensitive, then decide. Without network access to the tools at all, the unit tests
(`npm test`) run the same mapping code over realistic vendor responses in `test/fixtures/` and prove that descriptions,
comments, e-mail addresses and names never appear in the output.

## 10. Reporting a vulnerability

See the QE Navigator [SECURITY.md](../SECURITY.md) (responsible disclosure). Please include the agent version
(`qe-agent --version`).
