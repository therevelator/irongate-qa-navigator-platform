# IronGate QE Navigator

[![CI](https://github.com/therevelator/irongate-qa-navigator-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/therevelator/irongate-qa-navigator-platform/actions/workflows/ci.yml)

Quality-engineering metrics for engineering organisations: team KPIs, a company dashboard,
analytics modules and user / team administration.

Every number shown comes from the database. Missing data is shown as "—" or "No data
recorded", never as an invented value. Sample-data generators exist for demos but are off
unless the API is started with `ENABLE_SYNTHETIC_DATA=true`.

## Documentation

| Document | What it covers |
|---|---|
| [docs/PRODUCT_GUIDE.md](docs/PRODUCT_GUIDE.md) | What the product is and the need it addresses, roles, every metric with its formula, target, data source today and in production, how data gets in, every screen, privacy, alerts and operations |
| [docs/INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md) | For developers: sending data to the platform (API keys, the KPI ingestion API, every metric's unit and range, backfill, retries) with curl / Node / Python / CI examples, runnable scripts in [docs/integration-examples/](docs/integration-examples/), and what cannot be sent via API yet |
| [docs/COMPETITIVE_ANALYSIS.md](docs/COMPETITIVE_ANALYSIS.md) | Direct and adjacent competitors, gaps and positioning (sources checked 18 Nov 2026) |
| [docs/pitch/](docs/pitch/) | Source of the 11-slide pitch deck, with speaker notes and the placeholders to fill |
| [docs/DOCUMENTATION_INDEX.md](docs/DOCUMENTATION_INDEX.md) | Every current document, what it is for and who reads it; old documents are in [docs/archive/](docs/archive/) |
| [docs/reports/](docs/reports/) | The accuracy audits and the consistency report that led to the "no invented numbers" fixes |
| [docs/ROLE_ACCESS.md](docs/ROLE_ACCESS.md) | **Who can see and do what**: a plain-English summary per role and the matrix per page and module (scope rules), derived from the code |
| [docs/reports/r2-final-review.md](docs/reports/r2-final-review.md) | Release R2 final review: findings, fixes, deferred items; per-role security matrix in `tests/api/r2-security-matrix.test.ts` |

## Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS 4, Recharts (`src/`)
- API: Express 5 on Node, PostgreSQL via `pg` (`server/`; DB helper `src/lib/db.ts`)
- Deployment: a single Node service (Railway, `npm run server:prod` serves `dist/`) or
  Netlify (static site + `netlify/functions/api.ts`; no cron jobs or WebSocket there)
- Schema: `supabase/migrations/` (apply in timestamp order)

## Getting started

```bash
npm install
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm run server                # API on http://localhost:3000
npm run dev                   # app on http://localhost:5173
```

Registering creates a **new** organisation and makes you its super admin. People join an
existing organisation only by invitation (Users page → **Invite**), see
[Organisation, roles and access](#organisation-roles-and-access).

- **E-mail domain.** A company address (`you@acme.com`) ties the organisation to that domain: a second
  organisation with `acme.com` is refused ("An organisation already uses the e-mail domain acme.com. Ask
  its administrator to invite you."). A public address (gmail.com, outlook.com, hotmail.com, yahoo.com,
  icloud.com, proton.me, …: the list is `src/lib/emailDomains.ts`) never blocks a registration: any
  number of organisations may be registered with it, and such people can also be invited into other
  organisations in any role. Nothing ever adds a person to an organisation, or matches one, because of
  a shared e-mail domain (single sign-on matches the exact verified address or an open invitation).
  Column `companies.email_domain_public`, partial unique index `companies_domain_company_unique`
  (migration `supabase/migrations/20261124000000_public_email_domains.sql`).
- **Password.** The same rules as accepting an invitation and resetting a password, in the form and in
  the API: 10 to 128 characters, three of lower case / upper case / number / symbol, and not containing
  the part of the e-mail address before the @ (`src/lib/passwordPolicy.ts`).

## Sample (demo) data

One command fills every table with a fictional, internally consistent company for demos:
**Northwind Payments (Sample data)**: 4 departments, 10 teams, 57 users in all roles, about
120 days of daily KPI history up to today (some teams strong, some struggling, slowly
trending), plus developer productivity, CI/CD pipeline runs, test cases, executions and flaky
tests, performance metrics, technical debt with financial impact, 12 months of business-impact
data and company KPI snapshots. KPI values are marked `field_sources.<column>.source =
'synthetic'`. Business-impact rows have `data_source = 'synthetic'`. Organisation data
includes the role assignments (one manager, Sofia Lindqvist, manages two departments; some
engineers belong to two teams), a short change history (the department rename can be undone)
and sample invitations (pending, expired, accepted, revoked; their links never work).

```bash
npm run seed:demo                              # demo company -> DATABASE_URL (local hosts only)
npm run seed:demo -- --fill-existing           # also fill existing companies' teams that lack data
npm run seed:demo:clear                        # remove all demo rows again (both modes)
npm run seed:demo -- --sql out/demo-seed.sql   # demo company as SQL files (no DB connection)
npm run seed:demo -- --fill-existing --sql out/demo-fill.sql   # fill as SQL (reads the local DB to plan)
npm run seed:demo:clear -- --sql out/demo-clear.sql
npm run seed:demo:check                        # coverage: every active team x analytics module, in its window
npm run seed:demo -- --refresh-dates           # keep demo data current: add the missing recent days (sample teams only)
```

**Keeping hosted demo data current** (`--refresh-dates`, optional `--today YYYY-MM-DD`): sample
history stops at the day it was seeded, so a hosted demo turns stale a day later. The refresh adds
the missing days up to today for the demo company (when it exists) and for the teams of existing
companies that already hold sample (`demo-`) rows. It never changes or deletes a row, never gives
sample data to a team that has none (a real team created after seeding stays empty), leaves every
group with real data alone (the same checks as `--fill-existing`) and adds nothing when run twice on
the same day. Like every seed command it refuses a database host other than localhost / 127.0.0.1
unless `--allow-remote` is passed. On Netlify it runs **every night** on its own (see "Nightly demo
refresh" below), so the hosted demo stays current without anyone running it. To refresh by hand, for
example before a demo, run it from a trusted machine:
`DATABASE_URL=<hosted connection string> npm run seed:demo -- --refresh-dates --allow-remote`
(check `seed:demo:check` afterwards).

**Fill existing companies** (`--fill-existing`, optional `--company <id>`, repeatable): every
active team of every non-demo company gets the same model wherever the analytics pages would
otherwise be empty. Data is grouped, and a group is skipped only when the team already has real
rows *in the window the page shows*:

| Group | Counts as present when the team has real… |
|---|---|
| KPI snapshots | a snapshot in the last 30 days (then the team keeps its real KPI history) |
| Test executions, daily test totals, performance | rows in the last 7 days |
| Pipeline | runs and daily summaries in the last 7 days |
| Team analytics | a week ending in the last 14 days |
| Sprints | a sprint ending in the last 60 days |
| Business impact | at least 6 of the last 12 months |
| Test cases, flaky tests, tech debt, metric update times | any rows (a team with real test cases but no flaky tests gets demo flaky test cases) |

Developers are handled one by one. Every developer of an active team whose latest real
productivity snapshot is older than 30 days gets 180 days of snapshots, and every developer
without a `developer_metrics` row for the team gets one. A team with fewer than 3 software engineers,
or fewer than 3 developers who share developer insights (team figures need 3, see
[Privacy and wellbeing](#privacy-and-wellbeing)), gets demo developer users (password
`demo123`). Every active team gets anonymous pulse-survey answers for the closed periods of the
last 16 weeks (some teams weekly, the rest every two weeks); per company the smallest team gets
only 2 answers per period, so its results show as "Not shown: fewer than 3 contributors". No
participation rows are seeded, so real users can still answer the running period. Each company
also gets company KPI snapshots. Every added row has a `demo-` id; the
integer-keyed snapshot tables use ids of 1,000,000,000 or more. `seed:demo:clear` removes them.
In the SQL output, each group is wrapped in a `DO` block that checks again, when it runs, that
the team exists and still lacks that data. That makes it safe to apply on a copy of the
database that differs from the one it was planned on.

`npm run seed:demo:check [-- --company <id>]` prints, per company and team, which modules have
data in their windows. It covers KPI, developer metrics, DDPS (30 days and 6 months), test cases,
flaky tests, test executions (7 days), pipeline history (14 days), runs (30 days) and stages,
performance (7, 30 and 90 days), tech debt, business impact (6 paired months) and revenue impact
(12 months with monthly revenue), sprints, team analytics and metric
update times. It exits with code 1 below 100 %.

The seed also writes the stored values behind the KPI snapshots (`metric_values`), a sample
KPI target history (Northwind raised its coverage target from 75 % to 80 % 45 days ago; Checkout
Core set its own escape-rate target 30 days ago), sample ingestion log entries, and, with
`--fill-existing`, gives each IronGate demo sign-in (`admin@`, `manager@`, `lead@`, `engineer@`,
`viewer@irongate.com`) that has no team a demo assignment on a real team of their department
(removed again by `seed:demo:clear`). `seed:demo:check` also checks metric values and that every
demo sign-in has a team.

Alerts and actions (sample): the alerts today's generated KPIs raise (judged exactly as the
evaluator does, so it adopts them), in-app notifications for Northwind's leads and managers, a few
notification preferences, alert rules (a company score-drop rule, team overrides) and, on every
active team without real ones, tracked actions (in progress, open / overdue, done 20 days ago and,
on Northwind, done 35 days ago). Baselines are read from the stored values when the seed runs and
outcomes are computed by the server. `seed:demo:check` checks that every active team has tracked
actions; `seed:demo:clear` also removes alerts, notifications and actions of demo teams.

Seeded flaky tests have no stored root cause, so the API reports their pattern guidance as
unverified.

- **Sign in**: password `demo123` for every demo user. For example, `alex.morgan@northwind.example`
  (super admin), `priya.raman@…` (manager), `olivia.bennett@…` (team lead),
  `mia.thompson@…` (software engineer) and `hannah.brooks@…` (viewer).
- **Additive and idempotent**: every row has an id starting with `demo-`, or belongs to the
  demo company or its users (for tables with integer or composite keys). Every insert is
  `ON CONFLICT DO NOTHING`, and the values come from a seeded PRNG, so a second run on the
  same day adds nothing. A run on a later day only adds the new days. Other companies and
  their existing rows are never changed. `seed:demo:clear` deletes only demo rows, in
  foreign-key order.
- **SQL mode**: `--sql` writes one transaction per file, split into numbered parts of up to
  ~1.4 MB (`demo-seed-01.sql`, `demo-seed-02.sql`, …). Apply the seed parts in order after
  the migrations, then the fill parts. Use `--today YYYY-MM-DD` to fix the last day of history.
- **In the app**: a super admin can choose **Administration → Admin console → Sample data → Load sample data**
  (`POST /api/analytics/seed-data`). This runs the same seed for the demo company and fills the
  admin's own company. It is only available when the API
  runs with `ENABLE_SYNTHETIC_DATA=true`. Otherwise the button is disabled and the endpoint
  returns 409. The background random generators enabled by that flag skip the demo company.
- The CLI refuses a non-local `DATABASE_URL` unless you pass `--allow-remote`. For a hosted
  database, prefer the SQL files.

## Self-serve demo sandbox (/try)

`/try` lets a website visitor explore the product with no sign-up: pick **CTO**, **Head of QA**, **Team lead** or
**Engineer** and start exploring **Northwind Bank — demo**, a fictional company (2 departments, 5 teams, a year of
every module, forecasts, recommendations, action plans, business impact) built with the same generators as the
Meridian showcase. Sessions last up to two hours, need no password and have server-side limits (no e-mails, no
administration, no API keys, no sign-in changes, no exports of people's activity, no other company, no
sample-data generators, no paid AI); a banner on every page links to booking a demo and starting a pilot.

| Part | Where |
|---|---|
| Build, reset, sessions | [`server/lib/sandbox.ts`](server/lib/sandbox.ts), rules in [`server/lib/sandboxConfig.ts`](server/lib/sandboxConfig.ts) |
| API | `GET` / `POST /api/auth/sandbox` ([`server/routes/authSandbox.ts`](server/routes/authSandbox.ts)); the gate in `authenticateToken` |
| Nightly reset | `netlify/functions/sandbox-reset.ts` (02:47 UTC) → `sandbox-reset-background.ts`; the Node service's cron (`SANDBOX_RESET_CRON`) |
| Operator | Overview → **Demo sandbox**: state, sessions, **Reset sandbox now** (`GET /api/operator/sandbox`, `POST /api/operator/sandbox/reset`) |
| By hand | `DATABASE_URL=… npx tsx scripts/sandbox/build.ts [--allow-remote] [--status]` |
| UI | [`src/components/TryDemo.tsx`](src/components/TryDemo.tsx), [`src/components/SandboxBanner.tsx`](src/components/SandboxBanner.tsx) |

No migration: the first reset (nightly, by the operator, or triggered by the first visit of `/try`) builds the
sandbox on a new database. Details: [docs/DEPLOYMENT_GUIDE.md, section 8](docs/DEPLOYMENT_GUIDE.md#8-demo-sandbox-try),
[SECURITY.md](SECURITY.md), [docs/ROLE_ACCESS.md](docs/ROLE_ACCESS.md#demo-sandbox-visitors-try).

## Where metrics come from

- **KPI ingestion API** (below): the supported way to feed metrics from CI, issue trackers,
  code analysis and other tools. There are no built-in Jenkins / Jira / SonarQube connectors.
- **Manual metrics** page: the same server path, for values entered by hand.
- **Expected update frequency** (Administration): how often each metric should receive a
  value. It schedules nothing; a value older than its interval is stale: shown greyed and left
  out of composite scores (see [Staleness, confidence, …](#staleness-confidence-company-aggregates-and-kpi-targets)).

## Definitions

One definition per metric, shared by server and UI:

- QA score, technical-debt score, DDPS, burnout risk: `server/lib/metricFormulas.ts`
- KPI thresholds and dashboard targets: `src/config/metricsConfig.ts` (`METRICS_CONFIG`,
  `KPI_TARGETS`, `teamAttentionIssues`, `teamKpiTrack`); QA score bands come from `QA_SCORE_THRESHOLDS`
- Developer health rules: `server/lib/developerHealth.ts`. "Workload balance (derived)"
  (`developer_metrics.happiness_score`) is calculated from focus, meetings, context switches,
  PR and review times; it is a workload signal, not a survey score and not wellbeing, and is not counted twice.
- Wellbeing (survey) and the pulse survey: `server/lib/pulseRules.ts` (questions, periods, score)
  and `server/lib/pulse.ts`; privacy threshold for aggregates of individual data: `server/lib/privacy.ts`.
- Config inheritance (team, then department, then company): `server/lib/configResolver.ts`
- Team membership (primary team or `team_members`): `server/lib/teamMembership.ts`
- Who may do what: `server/lib/userPolicy.ts` (see [docs/ROLE_ACCESS.md](docs/ROLE_ACCESS.md))

## Dashboard

- **Cards per row (1, 2 or 3)**: next to Grid / List in the Team performance section (grid
  view only). Remembered in the browser. Phones always show 1 column, tablets at most 2.
- **Teams vs KPI targets**: the on track / at risk / off track counts in Company status open
  a breakdown (per team: QA score, as-of date, the targets not met with their gap, the ones
  met collapsed, "based on n of 4 inputs" for the QA score). Rule (`teamKpiTrack`): of the four
  KPI targets with a current (not stale) value (coverage, automation, flakiness, escape rate),
  judged with the target valid at the value's date, on track = at least 75% met, at risk = 50%
  to 75%, off track = under 50%; fewer than two = not classified. The counts and
  the list both come from `GET /api/analytics/company-summary` (`kpiStatus`,
  `kpiStatusTeams`), computed by the same function.

## Organisation, roles and access

Migration: `supabase/migrations/20261119000000_org_roles_audit_invitations.sql` (backfills
everything from the existing data; nothing is dropped).

**Role assignments.** Access comes from `role_assignments`: a role on a scope, and a person may
have several. Quality is a shared responsibility, so the names on screen are Super admin,
**Manager** (key `qa_manager`), Team lead, **Software engineer** (key `qa_engineer`) and Viewer. The
keys did not change (database, API, integrations); the names come from one map,
`server/lib/roleLabels.ts`.

| Role | Assigned on | Sees / may |
|---|---|---|
| super_admin | the company | everything in the company |
| qa_manager | a department (one or more) | the teams of those departments; manages their teams and users |
| team_lead | a team (one or more; one lead per team) | those teams, other developers' rows there, team data writes |
| qa_engineer / viewer | a team (one or more) | those teams; individual developer data only their own |

- Every access decision reads the assignments through `server/lib/assignments.ts` (loaded per
  request by the auth middleware) and the rules in `server/lib/userPolicy.ts`; the UI uses the
  same rules. A change applies on the person's next request, without signing in again.
- The team lead is the team's `team_lead` assignment (single source of truth).
  `users.role` (highest role), `department_id`, `primary_team_id`, `teams.lead_id`,
  `departments.manager_id` and `team_members` are kept in step for compatibility.
- **Users page:** each person shows assignment chips (role · team / department); **Add** and the
  chip's **×** give or remove an assignment (super admin: any; manager: team roles in their
  departments; team lead: engineers / viewers of their teams; never your own, never someone of
  your rank or above). The edit form still sets the primary assignment.
- **Departments page:** "Assign department manager" adds a department (other departments stay);
  "Change lead" replaces the team's lead, who stays on the team as a software engineer. Moving a team
  to another department moves its members' departments; managers stay in theirs and lose the
  team.

**Change history (Activity page).** Every organisation, role, assignment, team, department,
user and settings change is recorded in `audit_log` with who, when, what (before / after; secrets
masked) and the departments it concerns. Super admins see the whole company, managers the
changes of their departments, with filters. **Undo** exists for assignment and role changes,
manager / lead changes, team moves, department renames and user deactivation. An undo restores
the previous state in one transaction and is itself recorded; it is refused, with the reason,
when a newer change touches the same people / team / department, or when the state was changed
outside the history. Managers may undo user changes inside their departments, not their own.

**Invitations.** Users page → **Invite**: email, role and team / department (within the same
rules as assignments). The person opens `APP_URL/accept-invite?token=…`, sets name and password
(10+ characters, three of lower / upper / digit / symbol, not containing the email name; or uses
SSO) and gets exactly that assignment. Tokens are 256-bit random, stored only as SHA-256, single
use, expire after 7 days (`INVITE_TTL_HOURS`) and can be revoked; **Resend** issues a new link and
the old one stops working. With e-mail configured (Resend or SMTP, see **E-mail** below) the email is
sent; otherwise the API returns the link and the dialog shows it to copy (nothing fails silently). "Add with password" remains for
demos and scripted setups.

**Forgot password (reset by e-mail).** The sign-in screen has **Forgot password?**. The person
enters their e-mail address; the answer is always the same ("If an account exists for that e-mail,
we've sent a link") and takes about the same time, so nobody can test which addresses have an
account. Only an **active** user gets an e-mail. The link `APP_URL/reset-password?token=…` works
**once** and expires after **60 minutes**; a newer link closes the older ones. The new password
follows the invitation rules above. After the change the person signs in again (no automatic
sign-in), and gets a second e-mail: "Your password was changed; if this wasn't you, contact your
administrator". A lockout is cleared. In **Users**, the key button (reset password) also offers
**Send reset link**: the same e-mail, for whoever may reset that person's password today (super
admins, managers of the person's department, team leads for their teams, each only for people ranked
below them, and everyone for themselves). The direct reset stays.

- Tokens: 32 random bytes (base64url, prefix `igr_`); the database stores only the SHA-256 (table
  `password_resets`, one row per link, with expiry, used / closed time and the request's address).
- The reset page removes the token from the address bar at once and sends no Referer.
- Limits: 5 requests per 15 minutes per address and 3 per hour per e-mail address (the address is
  hashed), 10 failed resets per 15 minutes per address.
- The Activity log records "Password reset requested" and "Password changed via e-mail link"; the
  User activity log records the requests by route only. Neither ever holds the token.
- A completed reset signs the person out on every device (see **Sessions** below).

Migration: `supabase/migrations/20261123400000_password_resets.sql`. Endpoints:
`POST /api/auth/forgot-password { email }`, `POST /api/auth/reset-password { token, password }`,
`POST /api/admin/users/:id/send-reset-link`.

**Sessions (sign out everywhere, how long a sign-in lasts).** A sign-in is a signed cookie. The
server checks two limits on every request, from the user row it loads anyway:

- **Keep me signed in** (sign-in form; it also applies to the Google / Microsoft buttons under it):
  unticked, the cookie is a browser-session cookie (no `Max-Age` / `Expires`), dropped when the browser
  closes; ticked, it is persistent with a max age of the company's sign-in lifetime. Either way the
  token expires after that lifetime and the check below refuses an older session. Registration and
  accepting an invitation give a browser-session cookie. "Sign out my other devices" and changing your
  own password re-issue the cookie with the same choice.

- **Sign out everywhere.** `users.sessions_valid_after`: a session issued before it is refused. It is
  set by a reset with the e-mail link, an administrator's direct reset, changing your own password,
  **Sign out my other devices** (the screen icon next to Sign out, in the navigation: this browser gets a
  new cookie and stays signed in), the administrator's **Sign out everywhere** (Users, key button; same
  permission as resetting the password) and the platform support action of the same name. It
  also marks the person's session rows revoked. Deactivating a user still blocks at once.
  The value is truncated to the second, so a session started in that same second stays valid.
- **Sign-in lasts** (Parameters → Sign-in, super admins only): 1 hour, 8 hours, 1 day, 7 days
  (default), 14 days or 30 days. A session older than the current value is refused, so shortening it
  signs out anyone signed in for longer at once. At sign-in the token's expiry (and, with "Keep me
  signed in", the cookie's max age) are set from it, so a longer value applies from the next sign-in. Stored as the company
  config `session_lifetime_hours`; the generic settings endpoint refuses that key. Changes are in
  the Activity log.

A refused session answers `401` with `code` `session_ended` or `session_expired` and the header
`X-Session-Ended`; the app then shows the sign-in screen with "Your session has ended. Please sign
in again." (or "Your sign-in has expired…") and opens the same address after sign-in. The reason is
kept for the browser tab (sessionStorage), so it is still shown after a reload; the next successful
sign-in removes it.
Migration: `supabase/migrations/20261123500000_sessions_valid_after.sql`. Endpoints:
`POST /api/auth/sessions/sign-out-others`, `POST /api/admin/users/:id/sign-out-everywhere`,
`GET|PUT /api/admin/session-settings { lifetimeHours }`,
`POST /api/operator/companies/:companyId/users/:userId/sign-out-everywhere { confirm: true }`,
`POST /api/operator/companies/:companyId/sessions/:sessionId/revoke { confirm: true }` (one session).

**E-mail.** All e-mail of the app (invitations, password resets, pulse surveys, alerts, the weekly
digest) goes through one mailer. The first configured channel wins: **Resend** (`RESEND_API_KEY`),
then **SMTP** (`SMTP_HOST`), otherwise nothing is sent and the message is written to the server log
(links to copy are shown where the app has them). The sender is `MAIL_FROM`
(e.g. `IronGate QE Navigator <no-reply@qe.example.com>`); `SMTP_FROM` is the fallback.

Set up Resend (https://resend.com):

1. Create a Resend account.
2. **Domains → Add domain**: enter the domain you send from (e.g. `qe.example.com`, or a subdomain
   such as `mail.example.com`). Choose the region nearest your users.
3. Add the DNS records Resend shows (an MX and a TXT record for SPF, a TXT record for DKIM; DMARC is
   recommended) at your DNS provider. Wait until the domain shows **Verified**. Resend only sends
   from verified domains.
4. **API Keys → Create API key**: permission **Sending access**, limited to that domain. Copy it
   (it starts with `re_`; it is shown once).
5. On Netlify (Site configuration → Environment variables) or in `.env`, set `RESEND_API_KEY` to the
   key and `MAIL_FROM` to a sender on the verified domain, e.g.
   `IronGate QE Navigator <no-reply@qe.example.com>`. Set `APP_URL` to the public URL of the app
   (Netlify's `URL` is used when unset). Redeploy.
6. Check: **Parameters → Notification channels** says "Email is sent through Resend". Send a test
   digest, or use **Forgot password?** with your own address.

Without `MAIL_FROM` the Resend test sender `onboarding@resend.dev` is used, which only delivers to
the Resend account's own address. A failed send (for example an unverified domain) is reported as
"not sent", logged without the key and listed in the platform operator panel (server errors).

**Single sign-on (Google, Microsoft).** Off unless configured; the login page asks
`GET /api/auth/providers` and shows only the configured buttons. OpenID Connect with state,
nonce and PKCE (S256); the ID token's signature (provider JWKS), issuer, audience and expiry are
checked. A sign-in matches an existing **active** user by linked identity or verified email, or
an **open invitation** for that verified email; anyone else is refused (no account is created).
It sets the same session cookie as the password login.

Setup: register a web application with the provider and add the redirect URI
`<APP_URL>/api/auth/sso/google/callback` (Google Cloud console → APIs & Services → Credentials →
OAuth client ID) or `<APP_URL>/api/auth/sso/microsoft/callback` (Microsoft Entra → App
registrations; accounts in your organisation; add a client secret; optional claim `email`). Then set:

| Variable | Purpose |
|---|---|
| `APP_URL` | public URL of the app, e.g. `https://qe.example.com` (invitation links, SSO redirect URI and return); on Netlify defaults to `URL` |
| `API_PUBLIC_URL` | only when the API has its own origin (local development: `http://localhost:3000`, the default) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | enable Google sign-in |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` | enable Microsoft sign-in; `MS_TENANT` = your tenant id or domain (a single tenant is recommended: its addresses are trusted; with `organizations` only verified email claims are accepted) |
| `RESEND_API_KEY`, `MAIL_FROM` | send all e-mail through Resend (see **E-mail** above); `MAIL_FROM` needs a domain verified in Resend |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | send e-mail through SMTP instead (used when `RESEND_API_KEY` is not set; without either, links are shown to copy) |
| `INVITE_TTL_HOURS` | invitation lifetime, default 168 |
| `DEMO_MODE` | `true` shows the demo account chips on the login page; default on locally, off in production / on Netlify |

Endpoints: `GET|POST /api/admin/users/:id/assignments`, `DELETE /api/admin/users/:id/assignments/:assignmentId`,
`GET /api/admin/audit`, `GET /api/admin/audit/facets`, `POST /api/admin/audit/:id/undo`,
`GET|POST /api/admin/invitations`, `POST /api/admin/invitations/:id/resend|revoke`,
`GET /api/auth/providers`, `GET /api/auth/sso/:provider/start|callback`,
`GET /api/auth/invitations/:token`, `POST /api/auth/invitations/accept`,
`POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `POST /api/admin/users/:id/send-reset-link`.

## Executive summary (phones)

`/summary`: the quality of the person's scope readable in one minute on a 390 px phone (and on a desktop), from one call,
`GET /api/summary` ([`server/routes/summary.ts`](server/routes/summary.ts), rules in
[`server/lib/executiveSummary.ts`](server/lib/executiveSummary.ts)). In the navigation for super admins and managers; every
role with a team in scope may open the link, and sees their own scope (a manager their departments, a team lead their team).

- The scope's QA score (Battery or Gauge, as chosen in Appearance) with status, target and the change since last week (the
  overview's own figure over the same teams), and the teams vs KPI targets (on track / at risk / off track).
- **Biggest risks** (3): teams with the QA score below its target or a tracked KPI off target, lowest QA score first, each item with
  its value, target and the change since last week, and "At this rate …" from the team's forecast of that metric. **At this rate**:
  KPIs on target now but forecast to miss it within 8 weeks, soonest first. **Most improved** (3): the biggest QA score rises since last week.
- **Money at risk**: the Business impact revenue roll-up over the scope as a range per month and per year, the cost of delay of open
  technical debt, how it is estimated and a link to the assumptions (Business impact → All teams). Super admins and managers only.
- **Open alerts** (the Alerts page counts) and **since last week**: QA score change, teams up / down, status changes, alerts opened /
  resolved, tracked actions done / new / overdue. "Last week" is each team's latest snapshot dated 7 to 14 days ago.
- Offline-ish: the last summary is kept in the browser (per person, removed at sign-out) and shown with the time it was loaded when
  the network is gone; it reloads when the connection returns, when the page is shown again and every 5 minutes.
- **Share link** copies `/summary` (or opens the phone's share sheet): whoever opens it signs in and sees their own scope.

## Team TV mode

A full-screen view for a wall or meeting-room screen, read from across the room, that needs no interaction once started:
`/tv?team=<id>`. Open it from the team's page (Team detail): **Open TV mode**, **E-mail TV link** (opens your mail
app with the team's TV link filled in) or **Copy link**. Whoever opens the link signs in and lands on
that team's TV screen, if the team is in their scope (a signed-out visit keeps the address through
sign-in). **TV mode** is also in the navigation for every role, with a team picker listing the teams of
their scope (`GET /api/tv/teams`).

- Shows the team name, department, lead and member count, the QA score (battery or gauge) with its
  status and change since the previous snapshot, "data as of", a clock, and four panels: **Key KPIs** (six KPIs with value,
  target, status, change and a 90-day sparkline), **Trends** (90 days with target lines), **Alerts & actions** (the team's open
  alerts by severity, most urgent first, or the KPIs off target when there is none; the tracked actions without owner names, or
  recommended actions) and **Wellbeing** (the anonymous pulse: the latest closed period's score and answers, the trend; hidden below
  3 responses; never comments). Team aggregates only: no member list and no individual developer data.
- **Rotation**: auto-rotate moves through the chosen panels every N seconds and, after the last one, on to the next chosen team
  (all the teams of the scope, or a list); the next team is loaded ahead, a thin bar shows the time left. **Set up the screen** (S, or
  the Set up button) chooses the interval (10 s to 5 min), panels, teams, theme and rotation, and copies the screen link.
- Scope: the analytics rule. Admins any team, managers the teams of their department,
  team leads / engineers / viewers their own team. `GET /api/tv/teams/:id` answers 403 for
  any other team (also another company's team or an unknown id); teams outside the scope in a link are ignored.
- Refreshes every 60 s, on the live "metrics updated" event and when the tab becomes
  visible; a lost connection keeps the last data on screen, says so, retries every 15 s and reloads as soon as the browser is online.
- Keys: **F** full screen (if the browser refuses, a message suggests F11), **T** theme (Light, Dark, Graphite, Porcelain; remembered
  separately from the app theme; dark by default, Graphite with a glass app theme), **R** auto-rotate, **S** set up,
  **← →** or **1–4** panels, **Esc** exit. The controls bar appears on mouse move and hides after 4 s, with the cursor.
- Kiosk URL options: `?team=<id>&theme=light|dark|graphite|porcelain&rotate=1&interval=<seconds>&panels=kpis,trends,focus,pulse&teams=all|<id>,<id>`
  (`theme=light|dark` keeps the glass family of a glass app theme). The layout scales with the
  screen (1 rem = 1/120 of a 16:9 width: identical at 1366×768, 1920×1080 and 3840×2160) and keeps the screen awake where the browser allows it.

## KPI ingestion API

External systems (CI, issue tracker, code analysis) push team KPIs to `POST /api/ingest/kpis`.
Manual entry in the app uses the same server path (`server/lib/kpiIngest.ts`), so both behave identically:

- **Auth:** `Authorization: Bearer igk_…`. A super admin creates keys in **Admin console → API keys**. The key is shown once; only its SHA-256 hash is stored. A key belongs to one company and can write any team in it. Revoked keys get `401`; a team from another company gets `403`.
- **Body:** `{ "teamId", "source", "recordedAt"?, "metrics": { column: number }, "idempotencyKey"?, "sourceRef"? }`, or an array of up to 100 such items.
  - `source` is a label such as `jenkins`, `jira` or `sonarqube` (`manual` is reserved for the app).
  - `recordedAt` is the time the values are **for** (ISO 8601). It defaults to now, cannot be in the future and can be up to 365 days back (backfill).
  - `metrics` keys are `kpi_snapshots` columns from the whitelist in `KPI_COLUMNS` (`server/lib/kpiIngest.ts`), for example `test_coverage`, `defect_escape_rate`, `change_failure_rate`, `code_quality_score`, `deployment_frequency_per_week`, `lead_time_days` or `mttr_hours`. Values are range-checked, and integer columns are rounded to whole numbers. `null` means "not provided" and does not clear a stored value.
  - `idempotencyKey` (per item): an item already written with this key for the team is skipped and reported as `duplicate`.
- **All or nothing / partial:** by default the whole batch is validated first and written in one transaction; any invalid item → `400`, nothing written. With `?partial=true` the valid items are written and the others are reported per item (`207`, `status: "partial"`).
- **Idempotency-Key header:** a retried request with the same key (same API key, same body) returns the stored result with `Idempotent-Replayed: true` and writes nothing; the same key with a different body gets `422`. Concurrent duplicates wait for the first and then replay it. A rejected request does not bind its key.
- **Storage:** every value is stored in `metric_values` (team, metric, value, `recorded_at`, `received_at`, source, actor, keys). `kpi_snapshots` is derived from it per day: a day holds the latest value of each metric recorded before the end of that day (UTC). A backdated value updates that day and the later days on which no newer value exists; a day without a snapshot gets one. The same team, metric and `recorded_at` sent again is a correction (the earlier value is marked superseded).
- **Provenance:** each field's `{source, recorded_at, recorded_by, carried_forward}` is in `kpi_snapshots.field_sources`. The team page shows "source · as of date".
- **QA score:** `qa_score` and `status` cannot be supplied. A database trigger computes them from the stored inputs using the same rules as `computeQaScore` in `server/lib/metricFormulas.ts`.
- **Ingestion log:** every request (accepted, partial or rejected; API and Manual metrics) is recorded with its items, errors and response: **Administration → Ingestion log** (super admins; managers see requests that touched their departments' teams), with per-source "last received".
- **Rate limit:** 60 requests per minute per key. Open dashboards refresh automatically after each write.

```bash
curl -X POST "https://<host>/api/ingest/kpis?partial=true" \
  -H "Authorization: Bearer $IRONGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sonar-build-4812" \
  -d '{
        "teamId": "<team id>",
        "source": "sonarqube",
        "recordedAt": "2026-11-17T08:00:00Z",
        "metrics": { "code_quality_score": 82, "test_coverage": 78.4 }
      }'
# → {"status":"accepted","ingestionId":"…","result":{"teamId":"…","snapshotDate":"2026-11-17","recordedAt":"2026-11-17T08:00:00.000Z",
#     "qaScore":<0–100 or null>,"status":"good|warning|critical|null","updated":["code_quality_score","test_coverage"],
#     "carriedForward":["defect_escape_rate", …],"duplicate":false},"items":[…]}
```

## Improve: forecasts and recommendations (v2 phase 4)

What the team should do next and what it will change, from the team's own data. Migration
`supabase/migrations/20261130100000_forecasts_recommendations.sql` (tables `forecasts`, `recommendations`,
`team_actions.recommendation_id`).

- **Forecasts** ([`server/lib/forecast/math.ts`](server/lib/forecast/math.ts), stored by
  [`server/lib/forecast/store.ts`](server/lib/forecast/store.ts)): for every KPI with history and the QA score, a Theil–Sen trend
  through the weekly medians of the last 26 weeks, an 80 % band from the residuals (σ = 1.4826 × MAD), projected 8 weeks ahead,
  clamped to the metric's range; the day it crosses its target (the target valid on each future day; earliest / latest from the band)
  or "on track" / "stays off target"; or "not enough data" with the reason (fewer than 6 weeks with values, under 5 weeks of history,
  latest value older than 21 days, too noisy). Wording shared by the app and the summary: `src/lib/forecastText.ts`.
- **Recommendations** ([`server/lib/recommendations/rules.ts`](server/lib/recommendations/rules.ts), deterministic, unit-tested;
  facts from [`load.ts`](server/lib/recommendations/load.ts), storage and decisions in [`store.ts`](server/lib/recommendations/store.ts)):
  flaky tests, coverage gap by file, build-time regression with the stage that grew, defect escape rising while coverage falls, sizing
  drift, low wellbeing with blocked time, MTTR rising (with incidents), a failing stage, high-severity debt, slowest tests, change
  failures (with failed deploys), availability. Each: evidence, next step, expected effect (a range) and confidence; ranked by expected
  effect in watch bands × confidence (+ urgency when the forecast worsens), at most 6. Status open / accepted (→ a tracked action) /
  dismissed (reason); an accepted or dismissed one keeps its evidence; a rule that no longer fires hides its open recommendation.
- **API** ([`server/routes/improve.ts`](server/routes/improve.ts)): `GET /api/improve/teams/:id` (analytics scope, like the KPI
  history; recalculated first when due), `POST /api/improve/teams/:id/refresh`, `POST /api/improve/recommendations/:id/accept`
  (`{ ownerId?, dueDate?, title? }`), `…/dismiss` (`{ reason }`), `…/reopen` (who may create actions: super admins, the department's
  managers, the team's leads). Actions (`GET /api/actions`) carry `recommendation` and `movement` (the metric before / after from
  the snapshot history). `GET /api/summary` adds `forecast` to each risk item and `upcoming`.
- **Recalculation**: the hourly `alerts-evaluate` job (Netlify function and the server's cron) recalculates, with the time left of a
  25 s budget, the teams that are due (no forecasts yet, older than 20 hours, or older than their newest value), oldest first; the team
  page and the summary recalculate a due team when read; **Recalculate** on the page does it now. After the migration, production
  backfills itself this way; `npx tsx scripts/reseed/improve-refresh.ts --company <id>` does one company at once (the reseed build
  runs it before the export).
- **UI**: Team detail → Forecast line on every KPI tile and the QA score card, trend charts with the projected band, target and
  crossing; Recommendations above the Action plan (top 3, more and decided ones in accordions, Add to Action plan, Dismiss, Reopen,
  Recalculate). Tests: `tests/api/forecast-math.test.ts`, `recommendation-rules.test.ts`, `improve.test.ts`;
  `tests/e2e/team/improve.spec.ts`.

## Raw CI ingestion and the calculation engine (v2 phase 1)

Customers send the **raw output** of their tools; QE Navigator calculates every metric (docs/V2_PLAN.md). Same API keys,
rate limit and ingestion log as `/api/ingest/kpis`. Full reference: docs/INTEGRATION_GUIDE.md section 4A (and 8.4 for GitHub
Actions, GitLab CI, Jenkins and Azure DevOps).

- `POST /api/ingest/tests`: JUnit XML (pytest, Jest, Maven / Gradle, Playwright, Cypress), TRX, Cucumber JSON.
- `POST /api/ingest/coverage`: lcov, Cobertura, JaCoCo, Istanbul `coverage-final.json` / json-summary; optional unified diff
  (`diff`) or `changedLines` for coverage of changed code.
- `POST /api/ingest/pipelines`: pipeline run events with stages (JSON).
- Upload as the raw body with query parameters (`team`, `commit`, `branch`, `run`, `attempt`, `format`, `startedAt`,
  `dryRun`) or multipart (`report` file(s) + the same fields); gzip accepted; 20 MB per request (100 MB decompressed); format
  detected; unknown → `415` with the supported list; idempotent per team + commit + run + attempt; safe XML (no entities).
- Code: `server/lib/ingest/` (safe XML reader, parsers, multipart / gzip body, raw store), `server/routes/ingestRaw.ts`,
  `server/lib/calc/engine.ts` (calculation rules; writes KPI values with source `computed` and `metric_evidence`),
  `server/routes/ci.ts` (evidence, "How this was calculated", Connect your CI status). Migration
  `supabase/migrations/20261129000000_raw_ingestion_phase1.sql`.
- Jobs: `netlify/functions/calc-recompute.ts` (nightly, last 8 days of the teams with real CI data, 25 s budget; locally `CALC_RECOMPUTE_CRON`; sample teams are refreshed by demo-refresh), raw-store retention in
  `db-keepalive` (payloads and per-test / per-file rows 35 days, the rest 13 months).
- UI: team page → **Evidence from CI** and **How this was calculated**; Admin console → **Connect your CI**.
- Sample data: demo and filled teams get 14 days of sample raw CI data (`server/seeds/demoRaw.ts`; evidence only, never KPI
  values; off with `SAMPLE_RAW_DATA=false`).

```bash
gzip -c junit.xml | curl -sS --fail-with-body -X POST \
  "https://<host>/api/ingest/tests?team=<team id>&commit=$SHA&branch=main&run=$RUN_ID&attempt=1" \
  -H "Authorization: Bearer $IRONGATE_API_KEY" -H "Content-Encoding: gzip" --data-binary @-
# → 201 {"status":"accepted","format":"junit","counts":{…},"computed":[{"day":"…","metrics":[{"key":"pass_rate","value":…}]}]}
```


## Delivery and reliability from raw events (v2 phase 2)

Deployments, commits and incidents are sent **raw**; QE Navigator calculates deployment frequency, lead time for changes,
change failure rate, MTTR, MTBF, availability, incidents per deploy and infrastructure failures (computed values are refused).
Full reference: docs/INTEGRATION_GUIDE.md section 4B (8.5 for the steps per CI tool).

- `POST /api/ingest/deployments`: deploy events (id, environment, service, commit / commits / commit range, start, finish,
  result `success` / `failure` / `rolled_back`, `rollbackOf`, `hotfix`); GitHub `deployment_status` and GitLab deployment
  webhooks are understood as they are.
- `POST /api/ingest/commits`: the commits of a deploy or a push (sha, authored / committed time; authors kept only as a salted
  hash); GitHub and GitLab push webhooks as they are.
- `POST /api/ingest/incidents`: incidents created and updated by id (opened / acknowledged / resolved, severity, service,
  outage, category, linked deployment); PagerDuty v3 webhooks and REST exports, Opsgenie webhooks and exports as they are.
- JSON (gzip accepted), at most 500 events and 5 MB per request; same API keys, rate limit, ingestion log, `Idempotency-Key`
  and `dryRun=true` as phase 1; idempotent by event id (a changed event updates); `400` / `413` / `415` name the problem.
  An event's team: its own `team`, the query `team`, or the **service → team mapping** (Connect your CI, `PUT /api/ci/services`).
- Code: `server/lib/ingest/deliveryEvents.ts` (parsers and webhook mappings), `server/lib/ingest/deliveryStore.ts`,
  `server/routes/ingestDelivery.ts`, `server/lib/calc/delivery.ts` (rules: 28-day window "as of" each day, failed change =
  rolled back, hotfix of the same service within 72 h, or a linked incident), `server/routes/ci.ts`
  (`GET /api/ci/teams/:id/delivery`, service mappings). Migration `supabase/migrations/20261130000000_raw_ingestion_phase2_delivery.sql`
  (`deployments_raw`, `deployment_commits`, `incidents_raw`, `incident_updates`, `service_teams`).
- Values go to the KPI columns `deployment_frequency_per_week`, `lead_time_days`, `change_failure_rate`, `mttr_hours`,
  `mtbf_hours`, `system_availability`, `infrastructure_failures` (source `computed`) with `metric_evidence`; late events
  recalculate the affected days; the nightly `calc-recompute` includes teams with deployments or incidents; retention 13 months.
- UI: team page → Evidence → **Deliveries & incidents** (DORA tiles with How this was calculated, recent production deploys,
  failed changes, incidents); Admin console → Connect your CI → **Deployments and incidents** (steps per tool, service mapping).
- Sample data: 35 days of sample deployments, commits and incidents per demo / filled team, following the team stories
  (`server/seeds/demoRaw.ts`); for a live company `npx tsx scripts/reseed/raw-sample-sql.ts … --delivery-only`.

```bash
curl -sS --fail-with-body -X POST "https://<host>/api/ingest/deployments?team=<team id>" \
  -H "Authorization: Bearer $IRONGATE_API_KEY" -H "Content-Type: application/json" \
  -d '{"id":"rel-42","environment":"production","service":"payments-api","commit":"9f8e7d6c","finishedAt":"2026-11-18T10:09:00Z","result":"success"}'
curl -sS --fail-with-body -X POST "https://<host>/api/ingest/incidents?team=<team id>" \
  -H "Authorization: Bearer $IRONGATE_API_KEY" -H "Content-Type: application/json" \
  -d '{"id":"INC-7","severity":"SEV2","service":"payments-api","openedAt":"2026-11-18T11:00:00Z","resolvedAt":"2026-11-18T11:40:00Z","deploymentId":"rel-42"}'
```

## Work and code quality from raw issues and SARIF (v2 phase 3)

Issues and static-analysis reports are sent **raw**; QE Navigator calculates defect escape rate, defect density, sprint
velocity, commitment rate, carryover, blocked time, sizing accuracy and the code quality score with findings by severity and
rule and new vs fixed findings (computed values are refused). Full reference: docs/INTEGRATION_GUIDE.md section 4C (8.6 for
the steps per tool).

- `POST /api/ingest/issues`: Jira (REST search result with `expand=changelog,names`, one issue, `jira:issue_*` webhooks), Linear
  (GraphQL export, Issue webhooks) or QE Navigator JSON (`issues`, `sprints`); JSON, gzip, at most 1,000 issues and 10 MB.
  Idempotent by issue key + change time (a changed issue updates; every status, sprint and flag change kept once). Team: the
  issue's own, the query `team`, or the project key mapped like a service (Connect your CI).
- `POST /api/ingest/static-analysis`: SARIF 2.1.0 (SonarQube, CodeQL, ESLint, Semgrep, …) as the body or multipart `report`,
  with `team`, `repo`, `branch`, `commit`, `run`, `attempt`, `loc`; idempotent per team + commit + run + attempt.
- **Code quality score** = round(100 × e^(−weighted findings per 1,000 lines ÷ 20)), weights critical 10, high 5, medium 2,
  low 0.5, info 0, over the latest main-branch report of each repository and tool; lines of code sent with the report, else
  the latest coverage report's lines found. Defect density = production bugs of 28 days ÷ KLOC (coverage lines found).
- Code: `server/lib/ingest/issueEvents.ts` (Jira / Linear / JSON mapping), `server/lib/ingest/sarif.ts`,
  `server/lib/ingest/workStore.ts`, `server/routes/ingestWork.ts`, `server/lib/calc/work.ts`, `server/lib/calc/quality.ts`,
  `server/routes/ci.ts` (`GET /api/ci/teams/:id/work`). Migration
  `supabase/migrations/20261201000000_raw_ingestion_phase3_work_quality.sql` (`issue_sprints`, `issues`, `issue_transitions`,
  `analysis_reports`, `analysis_findings`; `raw_uploads.kind` extended).
- Values go to the KPI columns `defect_escape_rate`, `defect_density`, `sprint_velocity`, `sprint_commitment_rate`,
  `sprint_carryover`, `blocked_time_hours`, `sizing_accuracy`, `code_quality_score` (source `computed`) with `metric_evidence`;
  the nightly `calc-recompute` includes teams with issues or reports. Retention: findings 35 days (the latest report keeps
  them), reports, sprints and resolved issues 13 months.
- UI: team page → Evidence → **Work & code quality** (sprint and defect tiles, last closed sprints, escaped defects, blocked
  and carried-over issues, sizing, code quality tiles, latest reports, findings by rule, new and fixed findings; every tile
  opens How this was calculated); Admin console → Connect your CI → **Issues and code quality**. Recommendations use the
  escaped defects, the mis-sized and blocked issues and the high-severity findings.
- Sample data: a year of issues and weekly SonarQube reports per demo / filled team **derived from the team's own KPI history**
  (sprints of `sprint_velocity`, blocked time, sizing, escape rate, density and score of the snapshots;
  `server/seeds/demoWork.ts`); for a live company `npx tsx scripts/reseed/raw-sample-sql.ts … --work-only`.

```bash
curl -sS --fail-with-body -X POST "https://<host>/api/ingest/issues?team=<team id>" \
  -H "Authorization: Bearer $IRONGATE_API_KEY" -H "Content-Type: application/json" \
  -d '{"issues":[{"key":"PAY-102","type":"bug","status":"Open","environment":"production","createdAt":"2026-11-19T08:30:00Z"}]}'
curl -sS --fail-with-body -X POST "https://<host>/api/ingest/static-analysis?team=<team id>&commit=$SHA&branch=main&run=$RUN" \
  -H "Authorization: Bearer $IRONGATE_API_KEY" -F report=@results/javascript.sarif
```

## Staleness, confidence, company aggregates and KPI targets

Migration: `supabase/migrations/20261120000000_metric_values_targets_ingestion_log.sql` (tables
`metric_values`, `target_history`, `ingestion_log`; backfills values from `kpi_snapshots` and the
current targets; existing snapshot rows are not rewritten).

- **Staleness** (`server/lib/staleness.ts`): a value is stale when it is older than its expected
  update interval (**Administration → Update frequency**). Stale values are shown greyed with
  "Stale since …" and are left out of composites: the QA score, KPI targets (on track / needs
  attention), company averages and DORA. For a past day, staleness is measured at the end of that day.
- **Confidence** (`metricFormulas.ts`: `qaScoreComposite`, `composite`, `CONFIDENCE_RULE`): every
  composite returns `{ value, inputsUsed, inputsTotal, confidence }` and the UI says "Based on n of m
  inputs" (high ≥ 90 % of inputs, medium ≥ 50 %, otherwise low): dashboard hero (teams), engineering
  health (components), team cards, team detail, TV, the KPI-status breakdown and the PDF report. The QA
  score keeps its minimum-inputs rule (coverage plus at least 2 of 4). `kpi_snapshots.qa_score` stays the
  score of every input the snapshot holds (database trigger); leaving a stale input out is exactly
  treating it as not recorded (checked against the database function for every stale combination).
- **Company aggregates** (`COMPANY_AGGREGATE_TEXT`): the global QA score, KPI averages and DORA are
  means weighted by active team size (assigned members; a team with none counts as 1), with the
  unweighted mean, median, 25th percentile ("weakest 25 %"), minimum and count in
  `globalQaScoreDistribution` / `kpiAveragesUnweighted`. The trend compares like with like (weighted, 7–14 days ago).
- **KPI targets with history** (`server/lib/targets.ts`, **Administration → Parameters → KPI targets**,
  `GET/PUT /api/targets`): good / watch levels per company, department or team, each with a validity
  period; a change closes the current row and opens a new one. Team > department > company > default
  (`METRICS_CONFIG`). Every judgement of a value uses the target valid at that value's date (the end of
  its UTC day): team cards, team detail, `teamKpiTrack` / `teamAttentionIssues`, the company summary and
  TV (trend charts draw the target of each day). Company targets: super admins; department and team
  targets: super admins and that department's managers. Changes are in the Activity history.
- **Apply to every department and team** (Parameters, company-wide scope, super admins, on by
  default): saving the system configuration (`POST /api/admin/configs` with `applyToAll: true`)
  removes the department and team values of those settings, and saving the KPI targets
  (`PUT /api/targets` with `applyToAll: true`, allowed without changes) ends every department and team
  target, so the company values apply everywhere. Earlier values keep the target valid at their date.
  Each run is recorded in Activity (`config.apply_all` / `targets.apply_all`; an unchanged save is
  `*.confirm`).
- **Sample data banner**: "Includes sample data" appears (dismissible for the session) when a value on
  the screen comes from source `synthetic` (`field_sources` / `metric_values.source`), never from the
  company name; with "Show formulas & data sources" on, such values carry a "Sample" marker. A demo
  company can hide the banner, the markers, the TV label and the PDF / CSV notes with
  `companies.settings.hideSampleDataNotice = true` (set for the Meridian showcase by `scripts/reseed`).
- **One scope for every page** (see [docs/ROLE_ACCESS.md](docs/ROLE_ACCESS.md)): the overview list and
  summary, team detail (KPIs, members, history), TV mode, Compare and the Analytics modules show the
  teams of the caller's analytics scope only (`canViewTeamAnalytics`: super admin every team, a manager the
  teams of their departments, everyone else the teams they are assigned to); another team answers 403.
  Until this change the overview listed every team and team detail showed any team's KPIs, while
  Compare, TV mode and Analytics were scoped. Super admins see "Company status"; everyone else "Your
  team(s)" (`GET /api/analytics/company-summary` returns `scope`). TV mode is in everyone's navigation; its
  team picker (`GET /api/tv/teams`) lists the teams in scope.

## Top bar, targets everywhere, battery colours

- **Top bar** (`src/components/Layout.tsx`, `src/components/HeaderParts.tsx`): the QE Navigator shield
  (logo V3, `public/brand/`: master `irongate-logo-v3.png` / `.webp` at 1024 px, header shields `qe-shield-{40,80,120,240}.{webp,png}` trimmed to the shield, favicon, apple-touch icon on a dark tile, `irongate-logo-pdf.png` for PDF report headers) and name, the page title; on the right the
  company badge, the person with their job title (`users.job_title`, migration
  `20261126000000_users_job_title.sql`, set by super admins on the Users page; the role label when empty),
  **What you can do here** (generated from `server/lib/userPolicy.ts` by `src/lib/accessSummary.ts`), the
  bell, the **Appearance** menu (theme: Light, Dark, Graphite, Porcelain, Match system; score display: Battery or Gauge; kept in the
  browser and applied before the first paint: `src/lib/appearance.ts`, `src/styles/themes.css`, `src/components/ScoreVisual.tsx`)
  and the account menu. The navigation shows only pages the person may open
  (`src/lib/viewAccess.ts`, also used by the router).
- **Targets next to every status** (`src/lib/targetText.ts`): "Off target · Target ≥ 80%", "Watch: 70–80% ·
  Target ≥ 80%", with the target valid at the value's date.
- **Battery colours** (`src/lib/batteryScale.ts`): <30 red, 30–45 deep amber, 45–60 amber, 60–75 yellow,
  75–90 light green, 90–100 green, for every battery.
- Meridian job titles for an existing database: `scripts/reseed/job_titles.sql` (UPDATE by e-mail).

## Compare teams, saved views, CSV export and onboarding

Migration: `supabase/migrations/20261121100000_saved_views_onboarding.sql` (tables `saved_views` and
`onboarding_state`; additive, idempotent).

- **Compare teams** (`/compare`, navigation **Compare teams**; `server/lib/compare.ts`,
  `GET /api/compare/teams?ids=a,b[,c,d]&days=7..90`): two to four teams of your analytics scope side by
  side. Per metric (QA score, technical debt score and every KPI with a target): the latest value, the
  target valid at the value's date (target history) and the status against it, the change over the
  window with a sparkline, stale values greyed (not judged, not compared) and sample-data markers; the
  QA score shows "based on n of 4 inputs". The best value of each row is marked; a row is highlighted
  when the teams are in different status bands or the gap is at least 10 % of the target ("Only rows
  that differ" filters to those). The choice lives in the URL (`?teams=…&days=…&diff=1`). Scope: every
  team must pass `canCompareTeams` (= `canViewTeamAnalytics`); otherwise one 403 (also for another
  company's team or an unknown id). Team aggregates only.
- **Saved views** (`/api/saved-views`, `server/lib/savedViews.ts`, the **Views** switcher on the
  dashboard, in the Analytics scope bar of every module and on Compare teams): a named set of choices,
  never data: dashboard filter, search, department, sort, layout and cards per row; the analytics
  module's department and team; the compared teams, window and "only differences". Views are per
  user; a super admin can share their views with the whole company and stop sharing any shared view
  (recorded in Activity). Shared views are read-only for everyone else. Team ids in a view must be in
  the saver's scope; applying a view leaves out teams outside the viewer's scope, and the API refuses
  them anyway.
- **CSV export** (`src/lib/csv.ts`, `ExportCsvButton`): on the dashboard team list, Compare teams
  (server-built: `GET /api/compare/teams.csv`, one row per team and metric), Users, Teams, Departments,
  Activity, Ingestion log and the analytics modules (flaky tests, technical debt, pipeline stages,
  performance records, test runs, developer productivity, team rankings, business-impact
  correlations). Values exactly as shown plus a "(raw)" column with the unrounded number; filters and
  sort as on screen; UTF-8 with BOM. Text cells starting with `= + - @`, TAB or CR get a leading `'`
  (CSV formula injection); plain numbers are left alone. Exports contain only what the screen received
  from the API (same scope and privacy rules); developer productivity exports only your own row when
  your role may not see other developers, and no export contains developer e-mail addresses.
- **Onboarding checklist** (`server/lib/onboarding.ts`, `GET /api/onboarding`, dashboard of super
  admins): create departments, add teams, invite people, set KPI targets, send the first data (API key
  or manual metrics; sample data does not count). Progress is computed from the real state on every
  load; the card shows while a step is open and can be hidden (`POST /api/onboarding/dismiss`, shown
  again with `/restore`; both recorded in Activity). The KPI targets step is also done when a super
  admin saves the company-wide settings or targets in Parameters, even unchanged. Once every step has
  been done the checklist is never shown again (`onboarding_state.completed_at`, migration
  `20261122100000_onboarding_completed.sql`), even if a step later reads as open.
- Demo seed: every company gets sample views of its first super admin (two shared), ids `demo-sv-…`;
  `seed:demo:check` requires them, `seed:demo:clear` removes them.

## Privacy and wellbeing

Migrations: `supabase/migrations/20261121200000_privacy_pulse_survey.sql` (tables `pulse_cadences`,
`pulse_responses`, `pulse_participation`) and `20261122200000_pulse_cadence_sending.sql` (monthly and
quarterly cadences; tables `pulse_settings`, `pulse_sends`, `pulse_recipients`, `pulse_links`); row level
security on, no policies.

- **k-anonymity** (`server/lib/privacy.ts`, one helper for every endpoint): an aggregate of individual
  developer data is returned only when at least **3** people contribute; otherwise its values are
  `null` with `privacy: { suppressed: true, contributors: null, reason: "Not shown: fewer than 3
  contributors" }` (the count is not revealed; 0 contributors is plain "no data"). Contributors are
  active software engineers and team leads assigned to the team who opted in to developer insights and have
  all five inputs recorded (`server/lib/developerAggregates.ts`). Applied to: the team summary of
  `GET /api/analytics/developer-metrics` (team averages, DDPS, workload balance, burnout counts; the
  Developer productivity tiles now come from it), `GET /api/analytics/ddps-history` (team statistics and
  each daily point), `GET /api/metrics/team/:teamId/all` (developer averages, workload balance, team
  burnout risk), the status counts of `GET /api/teams/:id/developer-ai-suggestions`, and the company
  summary (workload balance and burnout of the averages: only teams that reach 3 themselves, so a
  suppressed team can never be worked out from the total). Individual rows keep the existing rules
  (software engineers and viewers see only their own; leads, managers and admins see people who opted in).
- **Pulse survey** (**Delivery → Wellbeing pulse**, also from Team detail): five statements on a 1–5
  scale plus an optional comment (≤ 500 characters), once per person, team and period. A team is asked
  **every week, every two weeks, every month or every three months** (team-wide; default every two
  weeks, counted from Monday 2026-01-05). **Managers decide**: the department's managers and super
  admins (not team leads) change it, effective from the next period (Activity log). Weeks are counted
  from the day the cadence starts; months and quarters are calendar months and quarters (Jan–Mar,
  Apr–Jun, …). A change to monthly or quarterly starts when the running period ends; that first period
  runs to the end of the month / quarter (or, if that leaves fewer than 7 days, to the end of the next
  one). Pure rules in `server/lib/pulseRules.ts` (`periodFor`, `planCadenceChange`).
  - **Send survey to the team** (pulse page and Team detail → Wellbeing (survey); the team lead, the
    department's managers and super admins): e-mails every active member assigned to the team who
    has not been sent it yet a **personal single-use link** for the running period
    (`APP_URL/pulse/answer?token=igp_…`). Only the token's sha256 is stored (`pulse_links`); a link is
    bound to one user, team and period, expires when the period ends, and is used up by answering
    (through the link or in the app). The token authenticates only that submission: no session, no other
    access. The page shows "Sent to N of M members on <date>", who has **not been sent** it yet (sending
    is not answering), answers so far as a count only from 3 on, and a send log. **Send reminder to those
    who haven't answered** e-mails the members without an answer (read server-side from the
    participation list); the UI and the API return only a count, and not even that when it would reveal
    that 1 or 2 people answered; one reminder per 24 hours. Personal links are never returned by the
    API or shown to anyone but the recipient's mailbox, so nobody can answer as someone else.
  - **Without e-mail** (neither `RESEND_API_KEY` nor `SMTP_HOST` set) nothing is e-mailed: the page says e-mail is not configured and
    that members can answer in the app (Analytics → Wellbeing pulse); the send is still logged as "not
    e-mailed". In development the log mailer prints the message; `MAIL_CAPTURE_FILE` (ignored in
    production) also writes it to a file for end-to-end tests.
  - **Automatic sending**: when a manager first sets a team's cadence, automatic sending is switched on
    from the next period (managers and admins can turn it off or on per team). An hourly job
    (`server/jobs/pulseCron.ts`, `PULSE_SEND_CRON` default `40 * * * *`, `PULSE_CRON=false` turns it off;
    on Netlify `netlify/functions/pulse-auto-send.ts`) sends the survey once per team and period, during
    the first quarter of the period (at least 2 days); a unique index on `pulse_sends` makes a second run
    or a second scheduler send nothing. Expired links are deleted after 30 days.
  - **Response rate** per closed period = responses ÷ members the survey was e-mailed to (at most 100 %),
    shown with the period's results (only when the results are shown, i.e. ≥ 3 responses).
  - Answers are stored **without user id or time** (only team and period). **Your answers are
    anonymous. Your manager can see whether you have responded, not what you answered.** Who answered
    which period is stored separately (`pulse_participation`, no time): to refuse a second answer
    (409), to send reminders, and for the escalation below. Each answer rewrites the period's answer
    set in random order with fresh ids in one transaction, so ids, row order and transaction ids do not
    tell whose answer is whose. No audit entry and no user activity row is written for an answer.
  - **Non-response warning, reminders and escalation** (migration
    `20261123200000_pulse_reminders_escalation.sql`; set per team by the team lead, the department's QA
    managers and super admins, `canSetPulseReminders`, on the Wellbeing pulse page; every change in
    Activity). Counted from the day the period's survey went out: after `warning_after_days` (default 2)
    a member who has not answered sees a banner across the app ("Your team's wellbeing pulse is waiting
    — it takes 1 minute. Your answers are anonymous.", only about themselves, hidden for the day with
    "Not today"); automatic reminder e-mails every `reminder_every_days` (default 3; on by default) to
    members who have not answered, at most one a day per person and never after the period ends; after
    `escalate_after_days` (default 5) **once per team and period** the team lead and / or the
    department's managers (`escalate_to`, default both; nobody in that role: the company's super admins,
    and the page says so) get a notification (in-app, and e-mail when their immediate e-mails are on)
    with the **names of members who have not answered** and the response rate, never anything about
    answers. They can also see the list on the team's pulse page, updated once a day (a daily snapshot,
    so it never shows when someone answered; a member who answers drops off the next day). Short periods shorten the
    delays so the escalation always lands before the period ends (shown as the values for this period).
    Reminders and escalations run in the hourly pulse job; `GET /api/pulse/pending` feeds the banner and
    `PUT /api/pulse/teams/:teamId/settings` saves the settings.
  - Results: only **closed** periods (never the running one, so results never move after one person
    answers), only aggregates, only with **≥ 3 responses**; comments with the same rule, sorted
    alphabetically, for leads, managers and admins only. Members see their team's averages.
  - **Wellbeing (survey)** = (mean answer − 1) ÷ 4 × 100 (0–100; on target ≥ 70, watch ≥ 50). It is the
    wellbeing signal everywhere: Team detail, the dashboard's Company status (teams' latest closed
    period with ≥ 3 responses, weighted by responses; teams below 3 left out) and **engineering health**
    (delivery 35 %, pipeline 25 %, debt 20 %, wellbeing 20 %). Without survey results the wellbeing
    component is left out (not replaced by workload balance) and the confidence shows 3 of 4 components.
    `developerWellnessIndex` in the API is this survey value; workload balance is `workloadBalanceIndex`.
- Endpoints (authenticated, company-scoped, `server/lib/userPolicy.ts`): `GET /api/pulse/teams/:teamId`
  (`canViewPulseResults`: the team's analytics scope; send status only with `canSendPulseSurvey`),
  `POST /api/pulse/teams/:teamId/responses` (`canTakePulseSurvey`: assigned to the team),
  `PUT /api/pulse/teams/:teamId/cadence` and `PUT /api/pulse/teams/:teamId/auto-send` (`canSetPulseCadence`:
  manager of the department, super admin), `POST /api/pulse/teams/:teamId/send` and `…/remind`
  (`canSendPulseSurvey`: the team lead, manager of the department, super admin),
  `PUT /api/pulse/teams/:teamId/settings` (`canSetPulseReminders`: the team lead, manager of the
  department, super admin) and `GET /api/pulse/pending` (the caller's own pending surveys). Without a session, the
  token being the credential: `POST /api/pulse/link` `{ token }` (what the answer page shows; no personal
  data) and `POST /api/pulse/link/respond` `{ token, answers, comment }`. Cadence changes, sends, reminders
  and automatic-sending changes are in the Activity log; answers never are.
- Residual risk, by design of k = 3: someone who answered themselves knows their own answers and so the
  sum of the other two in a 3-response period. Database superusers could read dead row versions before
  vacuum; the API never exposes rows.

## Alerts, notifications, weekly digest and tracked actions

Migration: `supabase/migrations/20261121000000_alerts_digest_actions.sql` (tables `alert_rules`,
`alerts`, `notifications`, `notification_preferences`, `company_notification_settings`,
`notification_deliveries`, `team_actions`; nothing existing is changed).

- **Alert rules** (`server/lib/alerts.ts`, **Administration → Parameters → Alert rules**,
  `GET/PUT /api/alerts/rules`): *KPI off target* (a current, non-stale value at watch = warning or off
  target = critical against the target valid at its date, as on Team detail), *Metric stale*
  (one info alert per team listing its stale KPIs), *QA score drop* (at least N points within D days;
  critical at twice the drop), *Ingestion failures* (rejected or partial requests to the ingestion API
  in the last H hours, per team named in them; company-level when none). Team settings override
  department settings, which override company settings, which override the defaults. Who may change
  them follows KPI targets (company: super admins; department / team: super admins and that
  department's managers); managers can read them.
- **Evaluation**: after every KPI write (Manual metrics, ingestion API, generators) and every hour
  (`server/jobs/alertsCron.ts` locally, `netlify/functions/alerts-evaluate.ts` on Netlify; super admins
  also have **Evaluate alerts now**). One open alert per condition; it is refreshed while the condition
  holds and resolved when it is gone. Team leads, the department's managers and super admins can
  **acknowledge** an alert (recorded in the Activity history).
- **Notifications**: the **bell** in the top bar (unread count, latest, mark read, acknowledge) and the
  **Notifications** page (`/notifications`: alerts of your scope, inbox, preferences). People assigned
  to a team (and its department's managers) are told about its alerts at the severity they chose;
  company-wide roles about critical team alerts only. **Preferences** per person: in-app on/off, an email
  for each alert, the weekly digest (super admins, managers, team leads), minimum severity
  (defaults: in-app, no immediate email, digest on for leads and above, from warning). Email goes
  through the one mailer (Resend when `RESEND_API_KEY` is set, else SMTP when `SMTP_*` is set,
  otherwise written to the server log).
- **Slack** (super admins, Parameters → Notification channels): one incoming webhook per company,
  posts alerts from a chosen severity and optionally a weekly summary. The URL must be a
  `https://hooks.slack.com/…` webhook; it is stored AES-256-GCM encrypted (key derived from
  `SETTINGS_ENCRYPTION_KEY`, else `JWT_SECRET`; if that key changes the webhook must be entered again),
  only a masked hint is ever returned, and it never appears in logs, the change history or the
  delivery log. **Send test message** checks it. Every email / Slack message goes through an outbox
  (`notification_deliveries`) with a dedupe key and up to 3 attempts.
- **Weekly digest** (`server/lib/digest.ts`): Mondays 07:00 UTC (`netlify/functions/weekly-digest.ts`;
  locally `DIGEST_CRON`), per recipient for the teams in their scope: QA score now vs 7 days earlier
  (with "based on n of m inputs"), alerts opened and still open, stale metrics, actions overdue / due in
  the next 7 days / completed with their outcome. At most one per person and ISO week. **Send test
  digest** (Notifications → Preferences, and Parameters for super admins) sends yours now.
- **Tracked actions** (`server/lib/actions.ts`, `/api/actions`, **Team detail → Action plan**, TV
  focus panel, digest): created by team leads, the department's managers and super admins, by hand
  or with **Create action** on a recommendation; an owner who has the team in scope, a due date, a
  status (open, in progress, done, dropped) and optionally a linked KPI. The **baseline** is the latest
  stored value of that KPI when the action is created; the **outcome** is computed from the stored
  values at completion and 14 and 30 days later (improved / worse when it moved more than 2 % of the
  baseline in the KPI's direction, otherwise unchanged; "no new data" when nothing was recorded in that
  window) — never typed in. The owner may change the status. TV mode shows the actions without owner
  names.
- **Database keep-alive**: `netlify/functions/db-keepalive.ts` runs `SELECT 1` at 06:00 and 18:00 UTC
  (logs only ok / failed).
- **Nightly demo refresh**: `netlify/functions/demo-refresh.ts` (02:17 UTC) starts
  `demo-refresh-background.ts`, which does the same work as `seed:demo -- --refresh-dates`: it adds
  the missing recent days of sample data and never changes, deletes or adds to real data. Two
  functions because a scheduled function may run 30 seconds and the refresh takes longer (a
  background function may run 15 minutes). The call is signed with an HMAC of `DEMO_REFRESH_SECRET`
  (or `JWT_SECRET`), so a request to the public URL without it does nothing. Logs counts only. Turn it
  off with `DEMO_REFRESH_ENABLED=false`, for a deployment with no demo data. The platform support
  panel's **Refresh sample data now** starts the same background function on demand (on a
  long-running server it runs directly).
- **Data older than a day**: when the company's newest value is over a day old, the latest snapshots
  are shown as they stood then, with "Last updated <date>", instead of every daily input turning stale
  and the dashboards showing "No data" (`latestReference`, `server/lib/kpiEvaluation.ts`). A single
  team that stopped sending while the others are current stays stale, as before.

Environment (all optional; the Slack webhook is entered in the app, not in the environment):
`SETTINGS_ENCRYPTION_KEY` (recommended in production, a long random string; otherwise `JWT_SECRET` is
used), `APP_URL` (link in emails / Slack; Netlify's `URL` is used when unset), `RESEND_API_KEY` and
`MAIL_FROM`, or `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (email; without them
emails are logged), `PULSE_CRON=false` /
`PULSE_SEND_CRON` (automatic pulse-survey e-mail), `ALERTS_CRON=false`
(turn the local schedule off), `ALERTS_EVALUATE_CRON` / `DIGEST_CRON` (local schedule, UTC),
`NOTIFY_SLACK_ALLOW_LOCAL=true` (tests only, ignored in production: accept a `http://127.0.0.1:<port>/`
webhook). On Netlify the three scheduled functions run without further setup (Scheduled Functions).

## Business impact: money and revenue impact

**Delivery → Business impact** opens on **Money**, three plain-language sections for the selected team
(`GET /api/revenue-impact/teams/:teamId`; formulas in `server/lib/revenueImpact.ts`, statistics in
`server/lib/stats.ts`). Amounts are $/month and $/year (= month × 12), rounded ($12.4k, $149k, $1.24M);
a missing input shows "—" with the reason. Every line has **How is this calculated?** (formula, inputs,
months used, r, p, n, range, rates with "(default)" where a built-in rate is used); for super admins the
**Show formulas & data sources** switch opens the metric catalog entry of each section.

1. **Where the money is going now** (causes overlap, so they are not added up):
   - *Quality below target* = Σ over metrics with a significant slope of slope × (target valid today − latest
     value); a met target adds 0; metrics whose monthly series correlate at |r| ≥ 0.7 with one already counted
     (taken by smallest p first) are not added again. Range = Σ (CI low × gap, CI high × gap).
   - *Open technical debt* = Σ over open items with impact data of tickets × support ticket cost + downtime
     min × downtime cost per minute + affected users × revenue per user per month × revenue impact % + SLA
     breaches × SLA penalty (the technical-debt ROI formula and the same Financial and ROI settings).
   - *Incidents and downtime* = latest month's downtime minutes × downtime cost per minute.
   - *Support tickets* = latest month's tickets × support ticket cost.
   - *Customers leaving* = churn % × monthly revenue of the latest month (churned customers assumed average).
2. **What you gain when these are fixed**, biggest first (5 shown, "Show all"): each counted quality gap
   (slope × gap, with the 95% range and "Strong evidence" p < 0.01 / "Some evidence" p < 0.05), each open
   debt item (its monthly cost of delay; fix cost = effort hours × developer hourly rate) and downtime above
   the availability target ((downtime − (100 − target %) × minutes in the month) × cost per minute). Targets
   whose gap is associated with lower revenue are listed as not counted.
3. **Where to put the money first**: the same fixes ranked by monthly gain, or by return on cost (yearly gain ÷
   fix cost, payback = fix cost ÷ monthly gain) where a debt item has an effort estimate.

**Revenue per metric** (Details → "How sure are we?"): ordinary least-squares slope b of monthly revenue on
each quality metric over the months with both values: b = Σ(x − x̄)(y − ȳ) ÷ Σ(x − x̄)², SE(b) = √(SSE ÷ (n − 2)
÷ Σ(x − x̄)²), t = b ÷ SE with df = n − 2 (exact two-sided p), 95% CI = b ± t(0.975, n − 2) × SE, r and R² = r².
Shown from 6 paired months (else how many are missing); significant when p < 0.05, exploratory, not corrected
for multiple comparisons ("associated with", never "causes"). Sample and recorded months are never fitted
together: when both exist only the months with the source of the latest month are used.
**What-if**: change × b with the range and ×12; disabled (with the reason) without a significant slope;
values outside the recorded range are flagged as extrapolation. **Details** also holds the monthly trend chart,
the correlation matrix (Pearson, BH-FDR), the AI summary and the metric definitions, collapsed.
**All teams** (super admins: company; managers: their departments; `GET /api/revenue-impact/rollup
[?departmentId=]`, `canViewRevenueRollup`): the sum of the team figures with the teams that have none and why;
CSV export. Every endpoint checks the analytics scope (`assertTeamAnalytics`). No migration.

Demo data: 12 months of business-impact data per team (`data_source = 'synthetic'`, sample-data banner); the
sample revenue follows team health with modest growth so the associations are plausible. `seed:demo:check`
requires 12 months with monthly revenue per team.

## User activity log and platform support

**User activity** (Organisation → User activity, super admins only). Every sign-in, failed sign-in
(when the e-mail belongs to a user), API request (reads included), screen opened, CSV export and
API-key ingestion request of the company's users, for 90 days. Each row: who (name and e-mail at the
time, or the API key name and prefix), the route pattern (`/api/teams/:id`, never the raw address or
query string), the team or other entity from the path, status, duration, client IP, browser and the
request id. Request and response bodies, query strings, headers, cookies, tokens and passwords are
never stored. Answering the wellbeing pulse is not recorded at all (its time could be matched to an
anonymous answer). Filters: user, dates, action type, team, errors only, request id; CSV export
(itself recorded). Tell your staff about it (for example in your privacy notice for employees).
The Netlify function writes a request's rows (and any server error) before it returns, waiting at
most 2.5 s (`netlify/functions/api.ts`). Code: `server/lib/userActivity.ts`, `server/routes/activity.ts`; migration
`supabase/migrations/20261123100000_user_activity.sql`.

**Request ids and the server error log.** Every API response has an `X-Request-Id` header; 5xx JSON
bodies are `{ "error": "…", "requestId": "…" }`. Each 5xx and each failed scheduled job is stored in
`server_errors` (route pattern, error name, message, stack up to 4 KB, company, user; never bodies,
headers, cookies or query strings) for 30 days. Scheduled job runs are stored in `job_runs`.
Retention runs in `db-keepalive` (Netlify) or `server/jobs/cleanupCron.ts` (long-running server).

**Platform support panel** (`/operator`, IronGate platform support). Operators are their own
accounts (`platform_operators`, migration `20261125000000_platform_operators.sql`), never users of a
company; create one with `npm run operator:create -- --email … --name "…"` (bcrypt cost 12). Off while
no operator exists. Own sign-in at `/operator` (8-hour session in the httpOnly cookie
`irongate_operator`, its own token audience, lockout after 5 failures, rate limited per IP).

*What it shows.* Overview: every company with its status (active / suspended), users, teams, sessions
valid now, sign-ins and failed sign-ins of the last 7 days, countries seen (30 days), last data,
stale share, open alerts, errors; scheduled jobs ("No runs recorded yet" while `job_runs` is empty);
database size and the main tables (exact `count(*)` below 200 000 rows, else the live-row
statistic, so a TRUNCATE and reload never shows 0); sign-in events of every company (also failed
sign-ins of unknown e-mails); search by request id. Per company: organisation, users (last sign-in
with time, IP, country, city, browser / OS / device, sessions now, last seen, failed sign-ins),
each person's page (profile, role assignments, teams, every sign-in, every session with its status
valid / expired / ended / revoked and a **Revoke** button, recent activity), sessions, sign-ins
(filters: user, outcome, type, IP, country, dates, request id; CSV), **Last views** (latest view of
each team and department from the user activity log, by whom, and the most active viewers), the
access log (the company's user activity: every request and screen, filters incl. IP; CSV), settings
and targets, data, modules, alerts and actions, the wellbeing pulse, the Activity log and server errors.

*What it changes.* Everything in any company: create a company (first department, team and a first person with a password
or an invitation: super admin by default, or manager of the first department, team lead / software
engineer / viewer of the first team), rename it, its e-mail domain, "hide the sample-data
notices", how long sign-ins last, **suspend / reactivate**, delete it (type its name); departments
(create, edit, managers, delete); teams (create, edit, move, lead, archive / restore, delete for good
with the typed name); people (create with a password or invite, edit name / e-mail, role and primary
team, role assignments at company / department / team scope, set a password, send a reset link, sign
out everywhere, deactivate / reactivate, clear a lockout, delete with the typed e-mail); invitations
(create, resend, revoke); KPI targets, configuration values, update intervals and alert rules at
company, department or team scope; API keys (create: the key is shown once; then the prefix only;
revoke); saved views (rename, share, delete); single sessions (revoke). Changes the company app also
offers run **the company app's own handler** on the server (same validation and rules, as a super
admin of that company without a user id: `forward()` in `server/routes/operator.ts`). Destructive
actions are confirmed in the page; the API wants `{ confirm: true }`. No reason is asked for.

*Sample data for a sales demo* (company view, `server/lib/demoGenerate.ts`, `server/seeds/demoOrg.ts`,
`src/components/operator/OperatorDemoData.tsx`). **Demo Data** opens a modal: Departments (1–10), Teams
per department (1–8), Members per team (3–12), with a preview ("Creates 3 departments, 9 teams, 57
people and one year of data": members per team plus one manager per department). It creates, in one
transaction, departments and teams with product-aligned names that the company does not use yet, a
department manager each (Manager, "Head of … Engineering"), Scrum teams (Product Owner = Viewer and
team member, Scrum Master = Team lead, the rest Software engineers with job titles such as Senior
Backend Engineer, QA Automation Engineer, Mobile Engineer, UX Designer, DevOps Engineer), international
names, role assignments, team members, primary teams and join dates over the last ~13 months. E-mails
are `first.last@<company domain>`, or `first.last@<company-slug>.example` when the company's domain is a
public e-mail domain. Everyone gets ONE generated password (about 80 bits; only its bcrypt hash is
stored), shown once in the modal with one sign-in per role level. The company's sample-data notice is
hidden. A job then writes ONE YEAR of every module for the new teams with the demo seed's model
(`runFillExisting` with a year-long `SampleShape`): KPI snapshots and metric values, company snapshots,
pipelines with releases at each team's sprint end plus hotfixes, test runs, flaky tests, technical
debt, DORA, performance, developer productivity (from each person's join date), sprint velocity, a
pulse every two weeks (answers and comments from team members only) and, from the Meridian showcase
content, retro actions of every sprint, alert history, an API key with its CI ingestion log, a
completed onboarding and a raised coverage target. Teams get different stories (strong, struggling,
improving, dip and recovery, declining). Every data row is a sample row, so the nightly refresh keeps
them current and "Remove sample data" removes them. A second run adds new departments and teams.
**Populate metrics** writes the same year for every team of the company that has no data yet, without
creating anyone (a team without a team lead or engineer is skipped; teams with sample data are only
topped up). Only that company is touched; one job per company at a time (409 otherwise).
Jobs are rows of `demo_data_jobs` (migration `20261128000000_demo_data_jobs.sql`) and `job_runs`
(`demo-data`). On Netlify the API answers 202 and starts the background function
`netlify/functions/demo-data-background.ts` (15 minutes) with an HMAC of the job id
(`DEMO_REFRESH_SECRET`, else `JWT_SECRET`); a long-running server runs the job in-process. The modal
polls the job (progress, then done with the password, or the error). Every statement is a multi-row
INSERT or a server-side INSERT … SELECT: 3 × 3 × 8 (75 people) with a year of data is about 370 round
trips and 193 000 rows (~12 s on a local database, ~60 s at 150 ms per round trip).
API: `POST /api/operator/companies/:companyId/demo-data { departments, teamsPerDepartment, membersPerTeam }`,
`POST …/populate-metrics`, `GET …/demo-data/jobs/:jobId` and `…/demo-data/jobs/latest`.

*Not logged.* Nothing an operator does is logged: no entry in the company's Activity log
(`recordAudit` is a no-op inside an operator request, `server/lib/platformContext.ts`), no user
activity row, and `platform_access_log` is no longer written (the table stays, unused). Support
tickets are tracked in a separate system. Secrets are never shown: password, API key and token
hashes, invitation and reset links, the Slack webhook and integration credentials ("set" / "not set").
Code: `server/routes/operator.ts`, `server/lib/operator.ts`, `src/components/operator/`.

**Suspending a company** (e.g. until an invoice is paid; `companies.status`, `suspended_reason`,
`suspended_at`, `suspended_by`, `suspended_until`, `billing_note`): its people cannot sign in (after
the right password: `403 { code: "company_suspended", error: "Your organisation's access is
suspended. Contact your administrator." }`, shown on the sign-in page); every open session is refused
on its next request with the same 403 and the header `X-Session-Ended: company_suspended` (the app
shows the sign-in page with the message) and its session rows are marked revoked; API keys and
ingestion answer 403 `company_suspended`; invitations cannot be accepted; the scheduled jobs (alert
evaluation, pulse sends and reminders, weekly digest, sample data refresh) skip it. Reactivating lets
people sign in again (sessions ended by the suspension stay ended).

**Sign-in events and sessions** (migration `20261127000000_company_suspension_auth_events_sessions.sql`).
`auth_events`: every sign-in (password, registration, invitation, SSO Google / Microsoft, password
reset) and every failed one (unknown e-mail: only a keyed hash of the e-mail, no company; wrong
password; deactivated; suspended company), with the client IP (`clientIp`), the location from
Netlify's `x-nf-geo` header (base64 JSON: city, country, subdivision) or `x-country`, trusted only
inside the Netlify function (nothing when absent, e.g. locally), the user agent and its browser / OS /
device. `user_sessions`: one row per issued company session, its id is the token's `jti` (issued,
expires by the company lifetime, persistent or browser session, method, IP / country / city at issue,
last seen with IP and country, revoked when / by whom / why). The per-request check reads the row in
the same query as the user (`loadAccessContext`, no extra round trip); a revoked row is refused like
"signed out everywhere" (401 `session_ended`). `last_seen_at` is updated at most every 5 minutes, in
the background. Sign out everywhere, a password change or reset, "sign out my other devices" and a
suspension mark the rows revoked. Tokens from before this change have no `jti` and keep working.
Both tables are kept 180 days (daily cleanup in `db-keepalive` / `server/jobs/cleanupCron.ts`).

| Variable | Purpose |
|---|---|
| `PLATFORM_OPERATOR_ALLOWED_IPS` | Optional comma-separated client IPs; other addresses are refused |
| `LOG_CLEANUP_CRON` | Long-running server only: retention schedule (default `7 3 * * *`; `off` turns it off) |

## Tests

```bash
npx tsc --noEmit -p tsconfig.app.json      # frontend types
npx tsc --noEmit -p tsconfig.server.json   # API types
npm run test:api                           # API tests (need the API running on :3000)
npm run test:ui:local                      # the whole UI suite on your computer, one command (below)
npm run test:ui:local:smoke                # its @smoke subset (about a minute)
```

**UI tests (Playwright)**: every user flow per role with its negative cases, accessibility checks
and phone layouts. `npm run test:ui:local` prepares its own local test database (Docker, or a local
Postgres via `TEST_DATABASE_URL` in `.env.test`; never your `.env`, never a hosted database), starts the
API and the app, runs the suite and stops everything again. First time: `npx playwright install --with-deps chromium`.
How to run subsets, read the report and add tests: [docs/testing/README.md](docs/testing/README.md);
every flow and the tests that cover it: [docs/testing/E2E_FLOWS.md](docs/testing/E2E_FLOWS.md).

**CI** (`.github/workflows/ci.yml`, GitHub Actions tab) runs on every push to any branch, on
every pull request and on demand, in three jobs:

- `quality`: both typechecks, ESLint (report only: counts go to the job summary), `npm run build`;
- `api-and-db`: a Postgres 16 service prepared like production by `scripts/ci/prepare-db.sh`
  (initial schema, snapshot, later migrations in timestamp order, `seed:demo`,
  `seed:demo -- --fill-existing`), the API started by `scripts/ci/start-services.sh`, then the
  jest API and database suites;
- `e2e`: the same database and API plus the Vite app, then the `@smoke` Playwright subset as a fast
  gate (HTML report uploaded as an artifact).

**UI tests** (`.github/workflows/ui-tests.yml`) runs the full Playwright suite on pushes to `main`,
pull requests, nightly and on demand (subset: all, smoke, negative, a11y or a grep string), in four
shards merged into one HTML report artifact (`ui-tests-report`).

The same scripts work locally against an empty local database:
`DATABASE_URL=postgres://…@127.0.0.1:5432/irongate_ci scripts/ci/prepare-db.sh`.

## Licence

Proprietary software of IronGate Software LTD. All rights reserved. See [LICENSE](LICENSE).
