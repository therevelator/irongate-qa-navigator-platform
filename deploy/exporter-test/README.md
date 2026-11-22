# Try the QE Navigator Exporter with made-up data

This folder runs the **QE Navigator Exporter** on your own machine next to **fake vendors**: a small service that answers
like GitHub, GitLab, Bitbucket, Jira, PagerDuty and SonarQube with made-up data, and accepts made-up credentials. The
Exporter reads them and sends the data to **QE Navigator at https://app.irongate.ie**, where you see it on the team pages.
Nothing else is installed: QE Navigator itself is the website.

> **Before you start:** the Exporter's endpoint (`POST /api/ingest/exporter/batch`) must be live on app.irongate.ie, and
> the company you use must exist there. Everything the fake vendors send is made up; use a test company (below: **Exporter
> Test Co**), never a customer's.

What the fake data covers, per team: about 180 days of CI runs (one a day, then one an hour for the last two days, so each
sync finds new runs), tests including flaky ones, coverage with changed lines, code scans (SARIF), production deployments
including failed ones, hotfixes and rollbacks, the commits they shipped, incidents (some linked to a deployment, some of
category infrastructure), two-week sprints with stories and bugs found in production or before release, story points,
estimates, time logged and blocked periods, SonarQube findings, and the KPI values no tool records (automation coverage
and automation ROI). The four data sets are named **payments**, **mobile**, **data** and **reporting**.

## 1. Prerequisites

| | macOS | Windows | Linux |
|---|---|---|---|
| Docker | Docker Desktop 4.30 or later (Apple Silicon or Intel) | Docker Desktop 4.30 or later with the WSL 2 back end | Docker Engine 25 or later with the Compose plugin (`docker compose version` ≥ 2.24) |
| Free port | 8788 on 127.0.0.1 (the setup page) | the same | the same |
| Browser | any, on the same machine | the same | the same |
| Internet | outbound HTTPS to app.irongate.ie | the same | the same |

All commands below run in a terminal (macOS: Terminal; Windows: PowerShell; Linux: a shell) **in this folder**
(`deploy/exporter-test`).

## 2. Get the images

**Either** load the two image files you were given (each is a `docker save | gzip` file):

```bash
docker load -i qe-exporter-0.3.0-amd64.tar.gz        # Apple Silicon: qe-exporter-0.3.0-arm64.tar.gz
docker load -i qe-fake-vendors-0.3.0-amd64.tar.gz    # Apple Silicon: qe-fake-vendors-0.3.0-arm64.tar.gz
docker images | grep -E "qe-exporter|qe-fake-vendors"   # both tagged 0.3.0
```

(PowerShell: the same commands; use `docker images | Select-String qe-` instead of grep.) Check the files first against
the sha256 sums you were given: `shasum -a 256 <file>` (macOS), `Get-FileHash <file>` (PowerShell), `sha256sum <file>` (Linux).

**Or** build them from the repository:

```bash
git clone https://github.com/therevelator/irongate-qa-navigator-platform.git
cd irongate-qa-navigator-platform
git checkout claude/wonderful-lamport-0a1h9w        # until the Exporter is on main
cd deploy/exporter-test
docker compose build                                 # builds qe-exporter:0.3.0 and qe-fake-vendors:0.3.0
```

The Exporter's build runs its type check and tests; it needs to reach registry.npmjs.org. Behind a TLS-inspecting proxy
pass its CA: `docker build --secret id=ca,src=/path/to/ca.pem -f exporter/Dockerfile -t qe-exporter:0.3.0 .` from the
repository root.

## 3. Start

```bash
docker compose up -d
docker compose logs exporter
```

The log shows the setup page link with a **one-time token**, for example:

```
qe-exporter 0.3.0 setup page: open this link in a browser on this machine (it works once):
  http://127.0.0.1:8788/?token=dcpo0UcOdtNfhX5bulbBUVFs8sX2HarT
```

| What | Where |
|---|---|
| Exporter setup page | http://127.0.0.1:8788 (only from this machine; the link with the token) |
| Fake vendors | inside the stack only (the Exporter reaches them at http://localhost:8080) |
| QE Navigator | https://app.irongate.ie |

## 4. Create the API key in QE Navigator

1. Open https://app.irongate.ie and sign in as the **company admin of Exporter Test Co** (company id `TH6PD7J19747`).
2. Go to **Admin console → API keys → Create**, name it `exporter-test`, and copy the `igk_…` key (it is shown once).
3. Optional: **Admin console → Connect your CI** shows the company id and, later, the Exporter's status.

## 5. Set the Exporter up

1. Open the link from step 3 in a browser on the same machine. (If it says the link is not valid, it was already used:
   run `docker compose restart exporter` and take the new link from `docker compose logs exporter`.)
2. **1. QE Navigator API key**: leave the address as it is (`https://app.irongate.ie`), paste the key, click **Save key and
   load my company**. The page shows **Exporter Test Co** with its departments and teams: *Platform Engineering* (Payments
   API, Mobile App) and *Data & Analytics* (Data Pipeline, Reporting).
3. **Test data → Connect the fake vendors**: this adds GitHub (two repositories), GitLab, Bitbucket, Jira, PagerDuty,
   SonarQube and the KPI file, with made-up credentials, mapped by name: payments → Payments API, mobile → Mobile App,
   data → Data Pipeline, reporting → Reporting.
4. **3. Your tools**: click **Test connection** on each one; each says what it can read (for example "acme/payments-api:
   private, 227 completed workflow runs; environments: production, staging").
5. To map a data set to another team: in **2. Connect a tool**, choose the same tool and the same name, set the mapping
   rows, and **Save this tool** (it replaces the earlier one).

## 6. Preview, then sync

```bash
docker compose run --rm exporter check       # every source, the company, departments and teams, a dry run per team
docker compose run --rm exporter preview > preview.json     # the exact JSON; NOTHING is sent
docker compose run --rm exporter sync        # sends; the first sync reads 180 days and takes 15 to 30 minutes
```

`preview.json` shows every request: the URL, the headers (the key as `[redacted]`) and the body with `companyId`,
`departmentId` and `teamId`. Run `sync` again whenever you like: it sends only what is new (the fake vendors add a run
every hour). On Windows PowerShell use `docker compose run --rm exporter preview | Out-File -Encoding utf8 preview.json`.

## 7. See the result

In **app.irongate.ie** (as the company admin):

- **Teams → Payments API** (and the other three): the KPI cards (coverage, pass rates, flakiness, build time, deployment
  frequency, lead time, change failure rate, MTTR, MTBF, availability, sprint velocity, commitment, carryover, blocked
  time, sizing accuracy, code quality, automation coverage and ROI). Each card's **How this was calculated** shows QE
  Navigator's formula, the values used and the runs, reports, deployments or issues behind it.
- The team's **CI evidence** (flaky tests, lowest-coverage files, failing stages), **Delivery** (deployments, failed
  changes, incidents) and **Work and code quality** (sprints, escaped defects, findings) panels.
- **Administration → Ingestion log**: each batch, channel **Exporter**.
- **Admin console → Connect your CI → Exporter status**: the last heartbeat and each source's last success.

In the **operator panel** (https://app.irongate.ie/operator, platform operators only): **Exporter deliveries**: one row per
batch with the company, department, team, key, Exporter version and host, kind, item count, date range, size, result and
records stored; open a row for the sanitised preview; **CSV** exports the list. Rejected batches (wrong company, wrong
team, bad key) are listed too, with the reason.

To see exactly which accepted parameters were sent and stored, and which dashboard modules have data, run from the
repository root (Node 20+):

```bash
npx tsx scripts/exporter-coverage.ts --url https://app.irongate.ie --email <admin e-mail> --team <team id> --preview deploy/exporter-test/preview-all.json
#   QE_ADMIN_PASSWORD=<password> in the environment; make preview-all.json with:
#   docker compose run --rm exporter preview --all --since <the date of the first sync minus 180 days> > preview-all.json
```

Modules no machine can fill (team pulse, Business impact values, financial settings, technical debt items, developer
metrics) are listed as such: they are entered by people in the app.

## 8. Point the Exporter at your real tools

On the setup page, use **2. Connect a tool** with your real addresses and credentials (a read-only token, a service
account, an app password, or OAuth with your own OAuth app: register an app with the vendor with the redirect URI
`http://127.0.0.1:8788/oauth/callback`). The read-only permissions per tool: `exporter/README.md`. Remove the fake
sources first (**Remove** in the list). The fake-vendors container can stay; the Exporter only reads what is configured.

## 9. Stop and wipe

```bash
docker compose down        # stop (the config, credentials and state stay in the qe-exporter volume)
docker compose down -v     # stop and delete everything: config, credentials file, state, fake data
```

The data already sent stays in QE Navigator (delete the test company's teams' data there if you need to).

## 10. Troubleshooting

| Problem | What to do |
|---|---|
| `port is already allocated` (8788) | Another program uses it. In `docker-compose.yml` use another port, the same number in both places: `"127.0.0.1:8790:8790"` under fake-vendors' `ports`, and `["setup", "--port", "8790"]` as the exporter's command; then `docker compose up -d` and open `http://127.0.0.1:8790/?token=…` (the page accepts only the address and port it listens on). |
| The link says "not valid" | The token works once. `docker compose restart exporter`, then `docker compose logs exporter` for a new link. |
| "Open the link printed in the terminal" | The browser has no session: open the link with `?token=` again (after a restart, a new one). |
| The page cannot load the company (401) | The key is wrong or revoked: create a new one in Admin console → API keys. |
| 403 "companyId does not match this API key" / "teamId is not an active team of this department" | The key belongs to another company, or a team was moved or deactivated: save the key again on the page (it reloads the departments and teams) and save each tool again. |
| `check` says a source failed | The fake vendors may still be starting: `docker compose ps` (fake-vendors must be healthy), then try again. |
| Apple Silicon (M1–M4) | Load the `-arm64` files; or build with `docker compose build` on the Mac (both images build natively for arm64). The amd64 files also run under emulation, more slowly. |
| Windows: `docker compose` not found | Update Docker Desktop (Compose v2 is built in); in WSL use the same commands. |
| The first sync is slow | It sends about 180 days for four teams; QE Navigator recalculates every day of each batch. Later syncs take seconds. |
| Start over | `docker compose down -v`, then `docker compose up -d`. |

The fake vendors are for trying the Exporter only: they accept any non-empty credential and must never be exposed beyond
your machine (the compose file publishes only the setup page, on 127.0.0.1).
