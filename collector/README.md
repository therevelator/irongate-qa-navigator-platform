# qe-collector: the QE Navigator Collector

A small program you run **inside your own network**. It reads Jira (Cloud, Server, Data Center), Linear,
PagerDuty and Opsgenie with **your own read-only credentials**, reduces every issue and incident to the few
fields QE Navigator's calculations need, and sends them to QE Navigator over **outbound HTTPS only**.

- Your credentials never leave your network: they live in environment variables of the Collector and are sent only to
  the tool they belong to.
- Nothing connects into your network. There is no listening port.
- `qe-collector preview` prints exactly what would be sent before anything is sent.
- One JavaScript file of about 120 KB, no runtime dependencies, Node 20 or later; or a distroless container image.

Security review: [SECURITY.md](SECURITY.md): data flow, the exact fields sent per source, permissions, network
requirements, verification of the bundle and the image.

## Quick start (5 minutes)

**1. Get the Collector.** Either the container image, built from this folder:

```bash
docker build -t qe-collector:0.2.0 .
```

or the single file, built with Node 20+ (the build has no runtime dependencies; dev tools only):

```bash
npm ci --ignore-scripts && npm run build      # dist/qe-collector.mjs and dist/SHA256SUMS
```

**2. Create a QE Navigator API key**: QE Navigator → Admin console → API keys → Create (name it `qe-collector`).
Admin console → Connect your CI → *On-premises agent* shows a config file with your team ids filled in.

**3. Write `qe-collector.yaml`** (start from [config.example.yaml](config.example.yaml); no secrets in it):

```yaml
qeNavigator:
  url: https://app.irongate.ie
state:
  path: /var/lib/qe-collector/state.json
sources:
  - type: jira
    baseUrl: https://your-site.atlassian.net
    email: qe-collector@example.com
    jql: project in (PAY, WEB)
    teams: { PAY: team-payments, WEB: team-web }     # Jira project key → QE Navigator team id
  - type: pagerduty
    services: { payments-api: team-payments }        # PagerDuty service → team id
```

**4. Set the secrets** as environment variables (or `VAR_FILE=/path` for Docker / Kubernetes secrets):

```bash
export QE_API_KEY=igk_...            # the key from step 2
export JIRA_TOKEN=...                # Jira Cloud API token (Server / DC: a Personal Access Token, with auth: bearer)
export PAGERDUTY_TOKEN=...           # PagerDuty read-only REST API key
```

**5. Check, preview, send:**

```bash
node dist/qe-collector.mjs check   -c qe-collector.yaml   # config, each source, QE Navigator; what would be read
node dist/qe-collector.mjs preview -c qe-collector.yaml   # exactly what would be sent, as JSON; nothing is sent
node dist/qe-collector.mjs sync    -c qe-collector.yaml   # first run: the last 90 days; then only what changed
```

With Docker:

```bash
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  -v "$PWD/qe-collector.yaml:/etc/qe-collector/qe-collector.yaml:ro" -v qe-collector-state:/var/lib/qe-collector \
  -e QE_API_KEY -e JIRA_TOKEN -e JIRA_EMAIL -e PAGERDUTY_TOKEN qe-collector:0.2.0 check     # then preview, sync
```

Then schedule `sync` every 15 minutes: [Kubernetes CronJob](deploy/kubernetes/cronjob.yaml) (with a
[NetworkPolicy](deploy/kubernetes/networkpolicy.yaml)), [systemd timer](deploy/systemd/) or
[cron](deploy/crontab.example). The requests appear in QE Navigator's ingestion log marked **agent**.

## Commands

| Command | What it does |
|---|---|
| `qe-collector check` | Validates the config; shows which secrets are set (never their values); for each source authenticates, shows what will be read (endpoints, JQL / query, fields, team mapping) and what was found (Jira field ids, readable teams and services); calls QE Navigator with a dry run that validates the key and every team id. |
| `qe-collector preview` | Reads the sources and prints a JSON report: per source the window, counts per team, skipped records with the reason, and **every request exactly as `sync` would send it** (URL, headers with the key redacted, body). Each batch is validated by QE Navigator's `dryRun=true` (nothing stored). `--offline`: no call to QE Navigator at all. `--all`: include records already delivered. `--out FILE`. Writes no state. |
| `qe-collector sync` | Sends what changed since the last run (the cursor minus `overlapMinutes`), in batches, and records the cursor. Re-running sends nothing that was already delivered. |
| `qe-collector sync --since 2026-01-01` | Backfill from a date (QE Navigator keeps 13 months; incidents older than 364 days are skipped). |

Options: `-c FILE` (default `$QE_COLLECTOR_CONFIG` or `./qe-collector.yaml`), `--source NAME`, `--state FILE`,
`--log-format json|text`, `-v / --verbose` (requests, retries, timings; never secrets).

**Exit codes** (for schedulers): `0` ok · `1` internal error · `2` configuration or usage · `3` a source could not be
read (auth, network, API error) · `4` QE Navigator refused or could not be reached · `5` another run holds the lock ·
`6` some records were refused by QE Navigator (the others were delivered).

## Configuration

One YAML (or JSON) file; secrets only from the environment. Unknown keys and anything that looks like a secret
(`token`, `apiKey`, `password`, `salt`, …) are refused, so a typo never silently changes behaviour.

| Setting | Default | |
|---|---|---|
| `qeNavigator.url` | `https://app.irongate.ie` | https only (http only for localhost). |
| `qeNavigator.apiKeyEnv` | `QE_API_KEY` | Env var of the `igk_` key. |
| `qeNavigator.caFile` / `http.caFile` | | Extra CA (PEM) added to the system roots, e.g. a TLS-inspecting proxy. Verification is never turned off. |
| `qeNavigator.requestsPerMinute` | `50` | Client-side limit (the API allows 60 per minute per key). |
| `privacy.sendTitles` | `false` | Send issue / incident titles (e-mails and links in them are masked). |
| `privacy.sendLinks` | `false` | Send a link back to the issue / incident (names your internal host). |
| `privacy.people` | `none` | `hash`: assignee / first responder as `HMAC-SHA256(QE_PEOPLE_SALT, id)`; the salt stays with you. |
| `state.path` | `./qe-collector-state.json` | Cursor and fingerprints; written atomically. |
| `backfillDays` | `90` | First run window. |
| `overlapMinutes` | `10` | Re-read before the cursor each run (clock skew; nothing is sent twice). |
| `http.timeoutSeconds` / `maxRetries` / `maxRetryWaitSeconds` | `30` / `5` / `120` | Every request has a timeout; 429 / 5xx / network errors are retried with jitter and Retry-After. |

Per source (`sources[]`): `type`, `name` (keys the state; default the type), `tokenEnv`, `teams`, `defaultTeam`
(used when a record's project / team / service is not mapped; else the record is skipped and reported), `caFile`,
`enabled`.

| Source | Settings | Secrets (default names) |
|---|---|---|
| `jira` | `baseUrl`, `auth: basic` (Cloud, e-mail + API token) or `bearer` (Server / DC Personal Access Token), `email` or `emailEnv`, `jql` (without ORDER BY), `teams` (project key → team), `fields` (`storyPoints`, `sprint`, `environment`, `flagged`: auto-detected by name like QE Navigator does, overridable), `pageSize`, `allowHttp` | `JIRA_TOKEN`, `JIRA_EMAIL` |
| `linear` | `teams` (team key → team), `teamKeys` (default the keys of `teams`), `apiUrl` | `LINEAR_API_KEY` |
| `pagerduty` | `services` (service name or id → team), `teams` (PagerDuty team name → team), `categories` (service → category, e.g. infrastructure), `serviceIds`, `apiUrl` | `PAGERDUTY_TOKEN` |
| `opsgenie` | `region: us | eu`, `teams` (Opsgenie team name → team), `services` (alert tag `service:<name>` → team), `categories`, `query` | `OPSGENIE_API_KEY` |

Proxy: `HTTPS_PROXY` (with optional `user:password@`) and `NO_PROXY` (hosts, `.domain`, `*.domain`, `host:port`,
IPv4 CIDR).

## Where the data goes in QE Navigator

Issues go to `POST /api/ingest/issues` and incidents to `POST /api/ingest/incidents` in QE Navigator's own JSON
shape (docs/INTEGRATION_GUIDE.md 4B and 4C), at most 1,000 issues / 500 incidents and well under 10 / 5 MB per
request, gzip-compressed, with an `Idempotency-Key` derived from the body (a retried request is never written twice)
and the User-Agent `qe-collector/<version>`. QE Navigator calculates defect escape rate, velocity, commitment, carryover,
blocked time and sizing accuracy from the issues, and MTTR, MTBF, availability and infrastructure failures from the
incidents.

## Development

```bash
npm ci --ignore-scripts
npm run typecheck
npm test                    # builds the bundle, then unit, mock-server and bundle tests (node:test)
npm run sync-allow-list     # vendor server/lib/ingest/fieldAllowList.ts (the shared allow-list) into src/vendor/
```

Layout: `src/sources/*` read and map each tool, `src/vendor/fieldAllowList.ts` is the shared allow-list (a byte-for-byte
copy of QE Navigator's), `src/policy.ts` the Collector's stricter send policy, `src/privacy.ts` applies both,
`src/sender.ts` batches and delivers, `src/state.ts` the cursor, `src/http.ts` HTTP with proxy, CA, timeouts and retries,
`src/yaml.ts` a strict YAML subset parser (so there is no YAML dependency). The end-to-end test against a real QE
Navigator is `tests/api/agent-e2e.test.ts` in the QE Navigator repository.

This folder is self-contained (its own package.json, no imports from outside it) so it can move to its own repository;
choose a licence before publishing it (`package.json` says UNLICENSED).
