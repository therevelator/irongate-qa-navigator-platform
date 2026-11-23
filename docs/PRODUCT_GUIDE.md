# IronGate QE Navigator: Product Guide

What the product is, why it exists, every metric it shows (how it is calculated, what "good" means,
where the data comes from today and where it should come from in production), every screen, and how
to run it.

This guide was written from the code, which is the source of truth. Formulas, weights, thresholds and
default targets below are copied from the files they are defined in; the file is named next to each
one so you can check it. Paths are relative to the repository root (links work from `docs/`).

Contents

1. [What it is and the need it addresses](#1-what-it-is-and-the-need-it-addresses)
2. [Organisation and roles](#2-organisation-and-roles)
3. [The metrics](#3-the-metrics)
4. [How data gets in](#4-how-data-gets-in)
5. [Screens and features](#5-screens-and-features)
6. [Privacy and wellbeing](#6-privacy-and-wellbeing)
7. [Alerts, notifications, weekly digest and tracked actions](#7-alerts-notifications-weekly-digest-and-tracked-actions)
8. [Configuration and operations](#8-configuration-and-operations)
9. [Known limitations and what is next](#9-known-limitations-and-what-is-next)
10. [Glossary](#10-glossary)

---

## 1. What it is and the need it addresses

### The problem

Engineering leaders and managers in organisations with more than a handful of teams usually face the
same four problems:

1. **No single, trustworthy view of quality across teams.** Coverage lives in SonarQube, defects in
   Jira, build times in Jenkins or GitHub Actions, incidents in PagerDuty. Every team reports in its own
   format, so comparing teams, or answering "is quality getting better or worse across the company?",
   takes a spreadsheet exercise every month.
2. **Numbers that cannot be explained.** Dashboards often show a "quality score" without saying how it
   was made, what it is missing, or whether a blank was silently treated as zero. When a team lead asks
   "why is my score 68?", nobody can answer, and the number loses credibility.
3. **Stale data presented as current.** A coverage figure from six weeks ago looks the same on a
   dashboard as one from this morning. Decisions get made on numbers that are no longer true.
4. **Privacy concerns about developer metrics.** Individual productivity data (focus time, meeting load,
   review speed) is useful for spotting overload, but it is easy to misuse as surveillance, and small-team
   averages can identify individuals.

### What IronGate QE Navigator is

A web application that gives engineering leaders, managers and teams one place to see the quality, delivery and
wellbeing of every team (quality is a shared responsibility, not a separate QA function), from a company overview down to a single team, with every number traceable to
its formula, its inputs, its source system and its age.

It collects team KPIs (pushed from CI, issue trackers, code analysis and other tools through an
ingestion API, or entered by hand), stores every value with its provenance, derives daily snapshots,
judges each value against a target that can differ per company, department or team and that keeps its
history, and rolls the results up into team and company scores.

### Who uses it

Role names on screen: Super admin, Manager (`qa_manager`), Team lead, Software engineer (`qa_engineer`), Viewer. The keys in
brackets are what the database and the API use; they did not change.

| Person | Typical questions |
|---|---|
| VP Engineering / head of quality (super admin) | How healthy is engineering overall? Which teams are off target, and on what? Is it improving? |
| Manager (one or more departments) | How do the teams in my departments compare? Where should I spend coaching time? |
| Team lead | How is my team doing against its targets? Is anyone overloaded? What should we work on next? |
| Software engineer | How is my team doing? What is my own workload picture? |
| Viewer (stakeholder, product manager) | Read-only view of the team's quality status. |

### Design principles (and where they are enforced)

| Principle | What it means in practice | Where |
|---|---|---|
| No invented numbers | Missing data is shown as "—" or "No data recorded", never as 0 or a guess. Composite scores leave missing inputs out instead of filling them. Sample data is off unless the server is started with `ENABLE_SYNTHETIC_DATA=true`, and any sample value on screen triggers an "Includes sample data" banner. | [`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts), [`server/lib/syntheticData.ts`](../server/lib/syntheticData.ts), [`src/components/SampleDataBanner.tsx`](../src/components/SampleDataBanner.tsx) |
| One definition per metric | Each formula is defined once and imported by both the API and the UI; the explanatory text shown to users is a constant next to the calculation, so the description cannot drift from the maths. | [`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts), [`src/config/metricsConfig.ts`](../src/config/metricsConfig.ts), [`src/data/metricCatalog.ts`](../src/data/metricCatalog.ts) |
| Every number explainable | "Show formulas & data sources" (formula mode) shows, for each metric on Team detail and Manual metrics, why it matters, the formula, thresholds, where it is stored, the source and time of the current value, and the production systems it should come from. Composites say "based on n of m inputs". (Formula mode is currently offered to super admins only, see section 9.) | [`src/data/metricCatalog.ts`](../src/data/metricCatalog.ts), [`src/components/MetricInfoModal.tsx`](../src/components/MetricInfoModal.tsx) |
| Staleness and confidence | Each metric has an expected update interval. A value older than that is stale: shown greyed with "Stale since …" and left out of every composite score. Composites report how many of their inputs they used, with a confidence level. | [`server/lib/staleness.ts`](../server/lib/staleness.ts), `CONFIDENCE_RULE` in [`metricFormulas.ts`](../server/lib/metricFormulas.ts) |
| Targets with history | Targets can be set per company, department or team; each change opens a new validity period. A value is always judged against the target that was valid on the value's date, so changing a target never rewrites history. | [`server/lib/targets.ts`](../server/lib/targets.ts) |
| Privacy by k-anonymity | Any average or count built from individual developers' data, and every survey result, is shown only when at least 3 people contribute; otherwise it says "Not shown: fewer than 3 contributors" and does not reveal the count. Developers can opt out of developer insights. Survey answers are stored without a user id or time. | [`server/lib/privacy.ts`](../server/lib/privacy.ts), [`server/lib/pulse.ts`](../server/lib/pulse.ts) |

---

## 2. Organisation and roles

### Structure

- **Company** (organisation, tenant). Registering creates a new company and makes the registrant its
  super admin. Data never crosses companies: every endpoint is scoped to the caller's company.
  The company keeps the e-mail domain of its registrant. A company domain (acme.com) belongs to one
  company only: a second registration with it is refused with "An organisation already uses the e-mail
  domain acme.com. Ask its administrator to invite you." A public e-mail domain (gmail.com, outlook.com,
  hotmail.com, yahoo.com, icloud.com, proton.me and the others in `src/lib/emailDomains.ts`) never blocks
  a registration: many companies may share it. People with such addresses can create a company and can be
  invited into other companies in any role (member, team lead, manager). Nobody is ever added to a
  company, or matched to one, because of their e-mail domain: people join by invitation (or an account an
  administrator creates), and single sign-on matches only the exact verified address or an open
  invitation for it. The registration password follows the same rules as invitations and resets (10+
  characters, three of lower case / upper case / number / symbol, not containing the e-mail name).
- **Department**: a group of teams (for example "Payments", "Platform"). Managed by one or more managers.
- **Team**: the unit metrics are recorded for. Has one team lead and any number of members. A team can be
  moved to another department.

Tables: `companies`, `departments`, `teams`, `users`, `team_members`, `role_assignments`
(migrations [`20261020000000_initial_schema.sql`](../supabase/migrations/20261020000000_initial_schema.sql) and
[`20261119000000_org_roles_audit_invitations.sql`](../supabase/migrations/20261119000000_org_roles_audit_invitations.sql)).

### Roles and assignments

Access comes from **role assignments** (table `role_assignments`): a role on a scope. A person can hold
several assignments, for example manager of two departments, or software engineer on two teams. Every access
decision on the server and in the UI goes through the same rules in
[`server/lib/userPolicy.ts`](../server/lib/userPolicy.ts), with assignments loaded per request by
[`server/lib/assignments.ts`](../server/lib/assignments.ts), so a change takes effect on the person's next
request without signing in again. `users.role` (the highest role) and the primary department / team are
kept in step for display only.

| Role | Assigned on | Analytics scope (which teams' overview, team detail, analytics, members, TV, compare) | Individual developer rows |
|---|---|---|---|
| `super_admin` | the company | every team of the company | everyone who opted in to developer insights |
| `qa_manager` | a department (one or more) | the teams of those departments | everyone who opted in, on those teams |
| `team_lead` | a team (one or more; one lead per team) | those teams | everyone who opted in, on those teams |
| `qa_engineer` | a team (one or more) | those teams | own row only |
| `viewer` | a team (one or more) | those teams | own row only |

What each role may do (from `userPolicy.ts`; the navigation in [`src/components/Layout.tsx`](../src/components/Layout.tsx) follows it; the full matrix per page and module is [ROLE_ACCESS.md](ROLE_ACCESS.md)):

| Capability | super_admin | qa_manager | team_lead | qa_engineer | viewer |
|---|---|---|---|---|---|
| Overview (the teams of the analytics scope: company for super admins) | yes | yes | yes | yes | yes |
| Overview team list, team detail, Analytics modules, Compare teams, TV mode, executive summary, per-team metric detail (history, velocity) | all teams | their departments' teams | their teams | their teams | their teams |
| Team member names and e-mails (`canViewTeamMembers`) | any team | their departments | assigned teams | assigned teams | assigned teams |
| Manage users (activate / deactivate, reset password, developer-insights toggle) | anyone in the company except themselves | users of their departments ranked below manager | users of teams they lead ranked below team lead | no | no |
| Edit another user's profile and assignments; delete (= deactivate) | yes | users they manage | no | no | no |
| Grant / revoke assignments and send invitations | any grant | team lead, software engineer, viewer on teams of their departments | Software engineer, viewer on teams they lead | no | no |
| Create / edit / delete teams | any | in their departments | no | no | no |
| Departments page, API keys, move teams, assign managers and leads | yes | no | no | no | no |
| Team data writes: Manual metrics, AI toggle (`canWriteTeamData`) | any team | their departments | teams they lead | no | no |
| Wellbeing pulse: how often and whether automatically (`canSetPulseCadence`) | any team | their departments | no | no | no |
| Wellbeing pulse: send the survey and reminders (`canSendPulseSurvey`) | any team | their departments | teams they lead | no | no |
| KPI targets | company, department, team | department and team, in their departments | no | no | no |
| Admin console, Update frequency, Parameters | yes | yes | no | no | no |
| Activity (change history), Ingestion log | whole company | entries of their departments | no | no | no |
| Answer the wellbeing pulse | teams they are assigned to | teams they are assigned to | yes | yes | yes |

**Who takes the pulse survey.** The people who work in the team: its team lead, its software engineers and a viewer
listed as a member of the team (e.g. the Product Owner). A stakeholder with read access only (a viewer assignment
without team membership: a Head of Product, a Finance Controller, an external auditor) is never sent the survey,
cannot answer it, gets no reminder and no pending-survey banner, is never named as not having answered and is not
counted in the response rate (`PULSE_MEMBER_SQL` in [`server/lib/assignments.ts`](../server/lib/assignments.ts)).
| Read pulse comments | yes | yes | yes | no | no |
| Share saved views with the company; onboarding checklist | yes | no | no | no | no |
| Executive briefing (AI) | yes | yes | yes | no | no |
| Team AI recommendations | all teams | their departments' teams | teams they lead | no | no |
| Formula mode ("Show formulas & data sources") | yes | no | no | no | no |
| See alerts and tracked actions | all teams | their departments' teams | their teams | their teams | their teams |
| Acknowledge alerts; create / edit / delete tracked actions | any team (plus company-level alerts) | their departments | teams they lead | no (an action's owner may change its status) | no (same) |
| Alert rules | change company, department, team | read; change department and team rules in their departments | no | no | no |
| Slack channel, "Evaluate alerts now" | yes | no | no | no | no |
| Weekly digest | yes | yes | yes | no | no |

Nobody can change their own role, department or team, grant themselves an assignment or manage someone
of their own rank or above. Editing yourself is limited to name and e-mail.

A page a role may not open (an address typed in, an old link, or rights that changed while the page was
open) opens the overview with the message "You don't have access to <page>." (it can be dismissed and goes
with the next page change). The API answers such calls with `403` before it looks at the request body, so
a refusal never depends on, or describes, what a valid request would contain.

Removing a role assignment (the × on a chip in **Users**) asks for confirmation in the page first.

### Invitations

Users page → **Invite**: e-mail, role and team or department (within the same rules as granting an
assignment). The person opens `APP_URL/accept-invite?token=…`, sets a name and password (10 or more
characters, three of lower case / upper case / digit / symbol, not containing the e-mail name) or uses
SSO, and receives exactly that assignment. Tokens are 256-bit random values stored only as SHA-256
hashes, single use, revocable, and expire after `INVITE_TTL_HOURS` (default 168 hours = 7 days, limited to
1 to 720 hours). **Resend** issues a new link and invalidates the old one. With e-mail configured
(Resend or SMTP) the invitation is e-mailed; without it the API returns the link and the dialog shows it to copy. Code:
[`server/lib/invitations.ts`](../server/lib/invitations.ts), [`server/routes/orgAdmin.ts`](../server/routes/orgAdmin.ts).

### Forgot password (reset by e-mail)

The sign-in screen has a **Forgot password?** link. It opens a page that asks for the e-mail address.

- The answer is always the same: "If an account exists for that e-mail, we've sent a link". It takes
  about the same time whatever the address. So nobody can find out which addresses have an account.
- Only an **active** user gets an e-mail. A deactivated or unknown address gets nothing.
- The e-mail has a link to `APP_URL/reset-password?token=…`. The link works **once** and expires after
  **60 minutes**. Asking again sends a new link and the older one stops working. The e-mail says to ignore
  it if you did not ask for it.
- On the reset page you choose the new password twice. The rules are the invitation rules above.
- After the change you sign in with the new password. The reset never signs you in. You also get an
  e-mail: "Your password was changed; if this wasn't you, contact your administrator". A lockout from
  failed sign-ins (5 wrong passwords in a row lock the account for 15 minutes) is cleared.
- Limits: 5 requests per 15 minutes from one address, 3 per hour for one e-mail address, 10 failed
  resets per 15 minutes from one address.

**Send reset link (administrators).** In **Users**, the key button (reset password) now also offers
**Send reset link**. It sends the same e-mail. It is allowed to whoever may reset that person's password
directly: super admins, the managers of the person's department and team leads for their teams (ranked
below them), and everyone for themselves. Setting a password directly still works as before.

**Security.** The token is 32 random bytes. The database stores only its SHA-256 hash, in the table
`password_resets` (one row per link: expiry, when it was used or closed, the request's address, which
administrator sent it). The reset page removes the token from the address bar straight away and sends no
Referer. The Activity log records "Password reset requested" and "Password changed via e-mail link". The
User activity log records the requests by route only. Neither ever holds the token. A completed reset
signs the person out on every device (see **Sessions** below). Code: [`server/lib/passwordReset.ts`](../server/lib/passwordReset.ts),
[`src/components/PasswordReset.tsx`](../src/components/PasswordReset.tsx).

### Sessions

A sign-in is a signed cookie. The server checks two limits on every request.

**Keep me signed in.** On the sign-in screen (it also applies to the Google / Microsoft buttons). Unticked,
the cookie lasts until the browser is closed. Ticked, it stays for the company's sign-in lifetime (below).
Either way a sign-in never lasts longer than that lifetime. Creating an organisation and accepting an
invitation sign you in until the browser is closed. "Sign out my other devices" and changing your own
password keep your choice.

**Sign out everywhere.** These end every existing session of a person:

- a reset with the e-mail link, an administrator's direct password reset, changing your own password;
- **Sign out my other devices** (the screen icon next to Sign out, at the bottom of the navigation). This
  browser stays signed in; every other one is signed out;
- **Sign out everywhere** for a user in **Users** (key button). Allowed to whoever may reset that person's
  password. For yourself it works like "Sign out my other devices";
- the platform support action **Sign out everywhere** (or **Revoke** of a single session), and a
  suspension of the whole company.

The person's sessions show as revoked in the platform support panel (their `user_sessions` rows). Deactivating a user still blocks them at once.
Technically: `users.sessions_valid_after` is set to the current second, and a session issued before it is
refused. A session started within that same second stays valid.

**Sign-in lasts.** Parameters → **Sign-in**, super admins only: 1 hour, 8 hours, 1 day, 7 days (default),
14 days or 30 days. The current value applies to every request: shortening it signs out anyone signed in
for longer than the new limit. A longer value applies from the next sign-in (the cookie and the token are
issued for the value at sign-in). Every change is in the Activity log ("Sign-in lifetime"). There is no
idle timeout.

When a session ends this way the app shows the sign-in screen with "Your session has ended. Please sign in
again." or "Your sign-in has expired. Please sign in again." The message stays after a reload of that tab
and goes with the next successful sign-in. After signing in, the same page opens.
Code: [`server/lib/sessions.ts`](../server/lib/sessions.ts).

### E-mail

All e-mail (invitations, password resets, pulse surveys, alerts, weekly digest) goes through one mailer
([`server/lib/mailer.ts`](../server/lib/mailer.ts)). The first configured channel wins:

1. **Resend** when `RESEND_API_KEY` is set. The sender is `MAIL_FROM`, which must use a domain verified in
   Resend (setup steps in the README, section "Organisation, roles and access").
2. **SMTP** when `SMTP_HOST` is set.
3. Otherwise nothing is sent. The message is written to the server log, and the app shows links to copy
   where it has them.

A failed send is reported as "not sent" and listed in the operator panel's server errors. The API key is
never logged. **Parameters → Notification channels** shows which channel is in use; so does the platform
operator panel.

### Single sign-on (Google, Microsoft)

Off unless configured. The login page asks `GET /api/auth/providers` and shows only configured buttons.
OpenID Connect with state, nonce and PKCE (S256); the ID token's signature, issuer, audience and expiry are
verified. A sign-in is accepted only when it matches an existing **active** user (by linked identity or
verified e-mail) or an **open invitation** for that verified e-mail; nobody else gets an account. Code:
[`server/lib/sso.ts`](../server/lib/sso.ts), [`server/routes/authSso.ts`](../server/routes/authSso.ts).

### Change history (Activity) and undo

Every organisation, role, assignment, team, department, user and settings change is recorded in
`audit_log` with who, when, what (before and after; secrets masked) and which departments it concerns.
Super admins see the whole company, managers their departments' entries.

**Undo** exists for assignment and role changes, manager and lead changes, team moves, department renames
and user deactivation. It restores the previous state in one transaction and is itself recorded. It is
refused, with the reason, when a newer change touches the same people / team / department, or when the
state was changed outside the history. Managers may undo only user and assignment changes inside their
departments (not their own access, not manager or lead changes). Code: [`server/lib/audit.ts`](../server/lib/audit.ts).

### User activity log (super admins)

Organisation → **User activity** lists everything the company's users do, for 90 days: sign-ins,
failed sign-ins (when the e-mail belongs to one of your users), every API request (reads too), every
screen opened in the app (with its team), CSV exports and API-key ingestion requests. Each row shows
who (name and e-mail at the time, or the API key's name and prefix), what in plain words ("Viewed
team Payments – KPIs", "Changed targets"), status, duration, IP address, browser and the request id.

What it never stores: request or response bodies, query strings, headers, cookies, tokens or
passwords. Answering the wellbeing pulse is never recorded, because the time of an answer could be
matched to the anonymous answer. Not recorded either: the session check, this screen's own list
requests (opening it and exporting it are recorded) and platform support requests (not logged at
all, below).

Rows are written in batches in the background; the Netlify function writes a request's rows before it
returns (an instance is frozen as soon as it has answered), waiting at most 2.5 seconds.

Only super admins of the company see it (`canViewUserActivity`); managers do not. Filters: user,
dates, action type (sign-in, view, change, export, API ingestion, failed), team, errors only, request
id. CSV export of the filtered list (at most 10 000 rows), itself recorded.

**Tell your staff.** This is monitoring of employees. Customers should say so in their privacy notice
for employees (GDPR transparency), including the 90-day retention and who can see it.

Code: [`server/lib/userActivity.ts`](../server/lib/userActivity.ts),
[`server/routes/activity.ts`](../server/routes/activity.ts),
[`src/components/UserActivity.tsx`](../src/components/UserActivity.tsx).

### Platform support (product owner only)

IronGate platform support opens a panel at `/operator` that sees **every** company. It exists to
debug problems in production. Platform operators are their own accounts (table `platform_operators`,
migration `20261125000000_platform_operators.sql`), **never users of a company**: the same e-mail
address cannot be both (database triggers; registering, adding or inviting an operator's address is
refused). No active operator: the panel is off and every `/api/operator` route answers 404. Create or
update one with `npm run operator:create -- --email you@example.com --name "Your Name"` (asks for the
password; bcrypt cost 12, `$2b$12$…`) or an INSERT with a bcrypt hash.

**Signing in.** `/operator` is outside the company app, with its own sign-in (e-mail and password;
company accounts cannot sign in there and the company sign-in page does not mention it). A session
lasts 8 hours (httpOnly cookie `irongate_operator`, its own token audience: it is never accepted as a
company session and a company session is never accepted here). Five wrong passwords in a row lock
the account for 15 minutes; sign-ins are also rate limited per IP. `PLATFORM_OPERATOR_ALLOWED_IPS`
can limit it to known addresses (on Netlify the client address comes from Netlify's own
`x-nf-client-connection-ip` header, elsewhere from the trusted proxy). **Sign out** ends the session
at once.

**What it shows.** Overview: every company with its status (**Active** / **Suspended** badge),
users, teams, sessions valid now, sign-ins and failed sign-ins of the last 7 days, the countries
sign-ins came from (30 days), last data received, share of stale metric values, open alerts, errors in
the last 24 hours, last activity and a demo / sample flag; the last run of each scheduled job ("No runs
recorded yet" on a database without any); database size and the main tables (exact row counts below
200 000 rows); the **Sign-ins** of every company, including failed sign-ins with an e-mail that belongs
to nobody (only a keyed hash of that e-mail is kept). Per company:

- **Organisation**: departments, teams, members and their roles;
- **Users**: each person's status, assignments, last sign-in (time, IP, country and city, browser,
  OS and device), sessions now, last seen, failed sign-ins (7 days), invitations with status;
- a **person's page**: profile, role assignments and teams, every sign-in (successful and failed),
  every session (issued, expires, last seen, IP and country at issue and last seen, kept signed in or
  browser session, status **Valid / Expired / Ended / Revoked**, who revoked it) with **Revoke**, and
  the latest 100 requests;
- **Sessions** (all, or valid only), **Sign-ins** (filters: user, outcome, type, IP, country, dates,
  request id; CSV export), **Last views** (for each team and department: when it was last looked at
  and by whom, its views in 30 days and the three most active viewers; the most active viewers of the
  company), **Access log** (the company's user activity: every request and screen of its people and API
  keys, filters including IP, CSV export);
- settings and targets (with history), data per team (metric values, KPI snapshots with staleness and
  sample / real source, ingestion log, every person's developer metrics with whether they opted in),
  every analytics module's stored rows per team, alerts and actions, the wellbeing pulse (every single
  answer with its comment, and who answered; the app never stores which person gave which answer), the
  Activity log and server errors. Errors can be searched by request id across all companies.

Customer access by IronGate support is covered by the customer's written contract.

**What it changes.** Everything in any company, with the company app's own rules (the server runs the
company app's handler as a super admin of that company, without a user id):

- **Companies**: create (first department and team, and a first person with a password or an
  invitation; their role is Super admin by default, or Manager of the first department, or Team lead /
  Software engineer / Viewer of the first team: "Every company needs a super admin to manage it; you can
  also manage it yourself from this panel."), edit the name, e-mail domain, "hide the sample-data notices" and "Live data only" (section 4.3: metrics only from raw data, nothing typed), how long sign-ins last,
  **Suspend** / **Reactivate**, **Delete** (type the company's name; every table of the company goes);
- **Departments**: add, edit, add / remove managers, delete (refused while it has active teams or people);
- **Teams**: add, edit, move to another department, set the lead, archive / restore, delete for good
  (type the team's name; its data goes, its members keep their accounts);
- **People**: add with a password (any role, also super admin) or invite by e-mail, edit name and
  e-mail, role and primary team, add / remove role assignments (company, department, team), set a new
  password, send a reset link, sign out everywhere, deactivate / reactivate, clear a lockout, delete for
  good (type the e-mail address; the last super admin cannot be deleted);
- **Invitations** (create, resend, revoke; the link is never shown), **API keys** (create: the key is
  shown once; afterwards only its prefix; revoke), **KPI targets**, **configuration values**, **update
  intervals** and **alert rules** at company, department or team scope, **saved views** (rename, share,
  delete), single **sessions** (revoke);
- repairs: refresh sample data now (on Netlify it starts the background refresh function and reports
  "started"; the result appears under `demo-refresh-background`), recompute KPI snapshots, re-run the
  alert evaluation.
- **Demo Data** (something to show a prospect): a modal asks for Departments (1–10), Teams per
  department (1–8) and Members per team (3–12) and previews the result ("Creates 3 departments, 9
  teams, 57 people and one year of data": the members of every team plus one manager per department).
  It adds departments and teams with realistic product names the company does not use yet, a manager
  per department ("Head of … Engineering"), and Scrum teams: a Product Owner (Viewer, member of the
  team), a Scrum Master (Team lead) and software engineers with real job titles (Senior Backend
  Engineer, Frontend Engineer, QA Automation Engineer, Mobile Engineer, UX Designer, DevOps Engineer…),
  realistic international names, e-mails on the company's domain (`first.last@<company-slug>.example`
  when the company uses a public e-mail domain such as gmail.com) and join dates over the last year.
  Then one year of data in every module is written for the new teams (KPIs, pipelines with releases at
  sprint ends and hotfixes, tests, flaky tests, technical debt, DORA, performance, developer
  productivity, sprints, a pulse every two weeks answered by the team's members with comments, retro
  actions, alert history, business impact, targets, an API key with its ingestion log, completed
  onboarding), with different stories per team (steady and strong, struggling, improving, dip and
  recovery, declining). The modal shows progress, then **one shared password, shown once** (copy it),
  and one sign-in per role level (Manager, Team lead, Software engineer, Viewer). The company's
  sample-data notice is hidden; the data is sample data, so the nightly refresh keeps it current and
  **Remove sample data** removes it. Running it again adds more departments and teams;
- **Populate metrics**: one year of data in every module for every team of the company that has none
  yet (for an organisation that set up its own departments, teams and people). Nobody is created; a
  team without a team lead or software engineer is skipped. Only that company is changed.

Destructive actions (delete, deactivate, archive, suspend, revoke, sign out everywhere, set a password,
remove an assignment) are confirmed in the page; deletes need the typed name or e-mail. Nothing asks for a
reason. There is no impersonation and no SQL.

**Suspending a company** (until it pays, for example). Suspend asks for the reason (for operators),
optionally a "suspended until" date and a billing note. While suspended: its people cannot sign in (the
sign-in page says "Your organisation's access is suspended. Contact your administrator." after the right
password); every open session is refused on its next request with that message (the app returns to the
sign-in page); API keys and data ingestion are refused (`403 company_suspended`); invitations cannot be
accepted; the scheduled jobs (alerts, pulse sends and reminders, weekly digest, sample data refresh) skip
it. Nothing is deleted. Reactivate lets everyone sign in again; sessions ended by the suspension stay ended.

**Not logged.** Nothing an operator does is logged anywhere: not in the company's Activity log, not in
its user activity log, and not in a platform log (the former `platform_access_log` table is no longer
written). Support tickets are tracked in a separate system.

**Never shown (secrets, not customer data).** Password hashes, API key hashes (a new key once, at
creation), invitation, survey link and password reset tokens and links, session tokens, the Slack
webhook (only whether one is set) and integration credentials such as API tokens ("set" / "not set").

**Sign-in records.** Every sign-in of a company user (password, registration, invitation, Google or
Microsoft, password reset) and every failed sign-in is kept 180 days with the client IP, the country,
region and city (from Netlify's location header on the hosted site; nothing locally) and the browser,
OS and device. Every session the app issues is kept 180 days too (its id is in the session token), so
support can see whether a session is still valid and revoke it on its own.

**Request ids.** Every API response has an `X-Request-Id` header and every server error message
(5xx) includes `requestId`. A customer can quote it; support finds the error in `server_errors` (kept
30 days; never request bodies, headers, cookies or query strings).

Code: [`server/routes/operator.ts`](../server/routes/operator.ts),
[`server/lib/operator.ts`](../server/lib/operator.ts), [`server/lib/opsLog.ts`](../server/lib/opsLog.ts),
[`src/components/operator/`](../src/components/operator/).

### Demo mode

`DEMO_MODE=true` shows demo-account chips on the login page (admin, manager, lead, engineer, viewer of
the IronGate demo company). Default: on for local development, off when `NODE_ENV=production` or on
Netlify ([`server/routes/authSso.ts`](../server/routes/authSso.ts), `demoModeEnabled`). Only demo
accounts that exist and are active are offered (none on a database without the demo data). The same
setting decides whether **Load sample data** also creates the separate fictional sample company with
its shared accounts: in production / on Netlify it only fills the signed-in company's own teams.
Demo mode is independent of sample data (section 4.7).

### Self-serve demo sandbox (/try)

The website links to **/try** ("Explore the live demo — no sign-up"). The page explains what the visitor is
about to see (a fictional bank with two departments, five teams and a year of data), that it is sample data
and that it resets every night, and offers four roles: **CTO**, **Head of QA**, **Team lead**, **Engineer**.
**Start exploring** signs the visitor in as that persona of **Northwind Bank — demo** for up to two hours,
with no account and no password, and opens the overview.

- Built with the same generators as the Meridian showcase and the operator's Demo Data: KPIs for a year,
  evidence from CI (tests, coverage, pipelines, deployments, incidents, issues, static analysis), forecasts,
  recommendations, action plans with their history, alerts, wellbeing pulse, business impact and its
  financial settings. Every person is fictional, on the reserved domain `northwind-bank.example`.
- A banner on every page: "Demo sandbox — sample data, resets every night", with **Book a demo**
  (irongate.ie/navigator), **Start a pilot** (irongate.ie/navigator/pilot) and **Switch role** (back to /try).
  TV mode shows the same note in its footer. Signing out, or a session that ends, returns to /try.
- Visitors can browse everything their role sees, use TV mode, the executive summary and appearance
  settings, add recommendations to the action plan, dismiss or reopen them, change action statuses,
  acknowledge alerts. Nothing else changes: no e-mails or invitations, no administration, no API keys, no
  password or sign-in changes, no exports of people's activity, no access to any other company, no sample-data
  generators, no paid AI (the rule-based texts are shown). See [ROLE_ACCESS.md](ROLE_ACCESS.md#demo-sandbox-visitors-try).
- Every night at 02:47 UTC the sandbox is rebuilt from scratch with today's dates and every visitor session
  ends; the platform operator can also **Reset sandbox now**. New sessions are limited per address
  (20 an hour) and in total (300 open); `/try` is never indexed by search engines.

### Production reseed

`scripts/reseed/build.sh <out> [day]` builds `000_wipe.sql` (empties every public table except
`platform_operators`), `001.sql` … (one showcase company, Meridian Financial Technologies: three
Scrum teams with Product Owner, Scrum Master and Developers, a high-performing, a struggling and an
improving team; INSERTs only, each file standalone, password hashes as per-role placeholders) and `operator.sql` (the
platform support account, hash placeholder). See [`scripts/reseed/README.md`](../scripts/reseed/README.md).

---

## 3. The metrics

### 3.1 How to read any metric

- **Direction.** Each metric is either *higher is better* or *lower is better* (sizing accuracy: *closer to
  1.0 is better*; velocity and automation ROI: no direction, shown without a status colour).
- **Two thresholds per metric.** `good` (the target) and `warning` (the watch level). For a higher-is-better
  metric: value ≥ good = **on target** (green), ≥ warning = **watch** (amber), below = **off target**
  (red). For lower-is-better the comparisons are reversed (≤ good, ≤ warning). Defaults live in
  `METRICS_CONFIG` ([`src/config/metricsConfig.ts`](../src/config/metricsConfig.ts)); a company, department
  or team target replaces them (section 3.4).
- **Status band names in code** are `good` / `warning` / `critical`; the UI says on target / watch (or
  needs attention) / off target (or critical).
- **Stale.** A value older than its expected update interval is greyed, labelled "Stale since …", not
  judged against its target and left out of composites ([`server/lib/staleness.ts`](../server/lib/staleness.ts)).
  For a past day, staleness is measured at the end of that UTC day.
- **Last updated.** When the company's newest value (over all its active teams) is over a day old (no
  data import, or the sample data not refreshed overnight), the latest snapshots are read as they stood
  at the end of that value's day (what was current at the last update) instead of at now, so the overview,
  team detail, TV mode, compare and team rankings still show the latest values and QA scores, with
  "Last updated <date>" (`latestReference` in [`server/lib/kpiEvaluation.ts`](../server/lib/kpiEvaluation.ts);
  the API adds `lastUpdated` and `dataOutdated`). Nothing is invented. While the company's data is current
  nothing changes: a value older than its interval is still stale, also for a team that stopped sending.
- **Confidence.** Every composite returns `{ value, inputsUsed, inputsTotal, confidence }` and the UI shows
  "based on n of m inputs" (or teams, or components). Confidence = inputs used ÷ inputs expected:
  **high** at 90 % or more, **medium** at 50 % or more, otherwise **low** (also low when there is no
  value). Stale and missing inputs are not used. (`CONFIDENCE_RULE`, [`metricFormulas.ts`](../server/lib/metricFormulas.ts).)
- **Provenance.** Each stored KPI value carries its source label (for example `sonarqube`, `jenkins`,
  `manual`, `synthetic`), the time the value is for, and who recorded it. Team detail shows "source · as of
  date".

### 3.2 Team KPIs

These are the 23 columns of `kpi_snapshots` that can be written (the whitelist `KPI_COLUMNS` in
[`server/lib/kpiIngest.ts`](../server/lib/kpiIngest.ts)). A value sent to the KPI ingestion API or entered in
Manual metrics is stored as sent; the formula column says how the source system should calculate it (from
[`src/data/metricCatalog.ts`](../src/data/metricCatalog.ts)). When a team sends raw data (sections 4.2a to 4.2c),
QE Navigator calculates the metric itself (source `computed`; formulas in
[metrics_and_calculations.md](metrics_and_calculations.md)).

**Where they come from today:** the KPI ingestion API (`POST /api/ingest/kpis`, any source label) or Manual
metrics (source `manual`), generated sample data (source `synthetic`), values calculated from raw data (source `computed`: also
the raw data a customer's QE Navigator Exporter sends, section 4.2d; all 23 KPIs have a raw source) or finished KPI values an Exporter
sends from a KPI file when the company is not in live operation (source `exporter.<source>`).
**Where they should come from in production:** the systems in the last column, via a small job or CI step
that reads them and pushes to the ingestion API.

Default targets come from `METRICS_CONFIG` and are identical to the defaults the migration copies into
`target_history` (`default_kpi_targets()` in
[`20261120000000_metric_values_targets_ingestion_log.sql`](../supabase/migrations/20261120000000_metric_values_targets_ingestion_log.sql)).
Expected update intervals come from `DEFAULT_METRIC_INTERVALS` ([`server/lib/metricIntervals.ts`](../server/lib/metricIntervals.ts))
and can be changed per company in **Administration → Update frequency** (a "month" is 30 days).

#### Quality and testing

| Metric (`column`) | Formula (at the source) | Unit, range | Better | Target / watch | Update interval | Production source |
|---|---|---|---|---|---|---|
| Test coverage (`test_coverage`) | lines executed by automated tests ÷ total executable lines × 100 | %, 0–100 | higher | ≥ 80 / ≥ 70 | 1 day | SonarQube / SonarCloud `coverage`; JaCoCo (Java); Istanbul / nyc (JavaScript), via Jenkins or GitHub Actions |
| Test flakiness rate (`test_flakiness_rate`) | from raw test reports: flaky tests ÷ distinct tests run in the last 7 days × 100 (flaky = the same test failed and passed on the same commit); as a finished value: flaky test runs ÷ total test runs × 100 | %, 0–100 | lower | ≤ 2 / ≤ 5 | 1 day | JUnit XML across reruns; Jenkins test report API; GitHub Actions re-run attempts |
| Defect density (`defect_density`) | confirmed bugs in the period ÷ (lines of code ÷ 1,000) | defects per KLOC, 0–999.999 | lower | ≤ 0.5 / ≤ 1.0 | 1 week | Jira bug count (JQL) ÷ SonarQube `ncloc` |
| Defect escape rate (`defect_escape_rate`) | bugs found in production ÷ all bugs found × 100 | %, 0–100 | lower | ≤ 5 / ≤ 10 | 1 week | Jira bugs split by environment / "found in" field; optionally Zendesk / ServiceNow tickets linked to Jira |
| Code quality score (`code_quality_score`) | Maintainability rating × 0.40 + Reliability × 0.35 + Security × 0.25, ratings A=100, B=80, C=60, D=40, E=20 (the Manual metrics calculator; an integration may send its own 0–100 score) | 0–100, whole number | higher | ≥ 80 / ≥ 60 | 1 day | SonarQube `sqale_rating`, `reliability_rating`, `security_rating` |
| Test automation coverage (`automation_coverage`) | automated test cases ÷ total test cases × 100 (calculated from the test management records; archived cases not counted) | %, 0–100 | higher | ≥ 70 / ≥ 50 | 1 week | TestRail, Xray Cloud, Zephyr Scale (the Exporter) |
| Automation ROI (`automation_roi`) | (time saved − time invested) ÷ time invested × 100 | %, −9,999.99 to 9,999.99 | none (no target) | — | 1 month | TestRail / Xray run times; Jira worklogs / Tempo |

#### Speed and efficiency

| Metric (`column`) | Formula (at the source) | Unit, range | Better | Target / watch | Update interval | Production source |
|---|---|---|---|---|---|---|
| Average build time (`avg_build_time_minutes`) | sum of build durations ÷ number of builds | minutes, whole number | lower | ≤ 10 / ≤ 20 | 1 hour | Jenkins build durations; GitHub Actions run timing; GitLab pipeline duration |
| Test execution time (`test_execution_time_minutes`) | duration of the full automated suite | minutes, whole number | lower | ≤ 15 / ≤ 30 | 1 hour | JUnit `<testsuite time>`; Jenkins test report; GitHub Actions job timing |
| Deployment frequency (`deployment_frequency_per_week`) | successful production deployments ÷ weeks in the period | per week, 0–9,999.99 | higher | ≥ 5 / ≥ 2 | 1 week | GitHub deployments (environment production); Argo CD sync history; Jenkins deploy job |
| Lead time for changes (`lead_time_days`) | average(production deploy time − commit time) over changes deployed | days, 0–99.99 | lower | ≤ 3 / ≤ 7 | 1 day | GitHub / GitLab commit times + deploy time from the pipeline |
| Mean time to recovery (`mttr_hours`) | total time from incident start to recovery ÷ incidents | hours, 0–9,999.99 | lower | ≤ 2 / ≤ 8 | 1 day | PagerDuty, Opsgenie incident timelines; rollback / hotfix deploy times |
| Parallel test efficiency (`parallel_test_efficiency`) | (sequential time ÷ parallel wall-clock time) ÷ workers × 100 | %, 0–100 | higher | ≥ 80 / ≥ 60 | 1 day | GitHub Actions matrix job timings; Jenkins Pipeline stage timings |

#### Agile and process

| Metric (`column`) | Formula (at the source) | Unit, range | Better | Target / watch | Update interval | Production source |
|---|---|---|---|---|---|---|
| Sprint velocity (`sprint_velocity`) | story points of issues Done at sprint close | points, whole number | none (no target; compare only with the team's own history) | — | 2 weeks | Jira Software Agile REST API / velocity chart |
| Sprint commitment rate (`sprint_commitment_rate`) | completed points ÷ points committed at sprint start × 100 (can exceed 100) | %, 0–999.99 | higher | ≥ 90 / ≥ 75 | 2 weeks | Jira sprint report / Agile REST API |
| Sprint carryover (`sprint_carryover`) | points not completed at close ÷ committed points × 100 | %, 0–100 | lower | ≤ 10 / ≤ 20 | 2 weeks | Jira sprint report / Agile REST API |
| First-time pass rate (`first_time_pass_rate`) | from raw CI data: pipeline runs whose first attempt passed ÷ runs × 100; as a finished value: stories with 0 QA rejections ÷ stories tested × 100 | %, 0–100 | higher | ≥ 85 / ≥ 70 | 1 day | Jira (status transitions back from QA); optionally test management |
| Blocked time (`blocked_time_hours`) | Σ (unblocked time − blocked time) over the sprint's tickets | hours, whole number | lower | ≤ 4 / ≤ 12 | 1 day | Jira (blocked flag / status history) |
| Task sizing accuracy (`sizing_accuracy`) | actual effort ÷ estimated effort (1.0 = perfect) | ratio, 0–99.99 | closer to 1.0 | within ±0.15 of 1.0 / within ±0.3 (Team detail colours only; no stored target) | 2 weeks | Jira time tracking; Tempo Timesheets |

#### Reliability and stability

| Metric (`column`) | Formula (at the source) | Unit, range | Better | Target / watch | Update interval | Production source |
|---|---|---|---|---|---|---|
| Change failure rate (`change_failure_rate`) | deployments that caused a failure ÷ total deployments × 100 | %, 0–100 | lower | ≤ 5 / ≤ 15 | 1 week | Deployment pipeline (rollbacks, hotfixes); PagerDuty / Opsgenie incidents linked to deploys; optionally Jira |
| Mean time between failures (`mtbf_hours`) | total operational hours ÷ failures | hours, whole number | higher | ≥ 720 / ≥ 168 | 1 week | PagerDuty / Opsgenie; Datadog / Prometheus |
| System availability (`system_availability`) | (total time − downtime) ÷ total time × 100 | %, 3 decimals, up to 100.000 | higher | ≥ 99.9 / ≥ 99 | 1 day | Datadog SLOs; Prometheus; Statuspage / uptime monitors |
| Infrastructure failures (`infrastructure_failures`) | from raw incidents: incidents of category "infrastructure" opened in the 28 days (when incidents carry a category); as a finished value: count of test / pipeline failures caused by infrastructure in the period | count per month, whole number | lower | ≤ 1 / ≤ 3 | 1 week | Jenkins / GitHub Actions failure classification; JUnit reports |

#### Why each KPI matters (one line each)

- **Test coverage**: code no test runs can break unnoticed; a low or falling number is an early warning. Input to the QA score (30 %).
- **Flakiness**: each false failure costs investigation and a re-run, and erodes trust in red builds until real failures slip through.
- **Defect density**: normalises bug counts by code size so large and small systems can be compared.
- **Defect escape rate**: the most direct measure of how well testing protects users. Input to the QA score (25 %).
- **Code quality**: maintainability, reliability and security findings in one number; a leading indicator of future defects. Input to the QA score (20 %).
- **Automation coverage**: automated tests run on every change at almost no cost, so more automation means faster releases.
- **Automation ROI**: whether automation investment pays back.
- **Build time / test execution time / parallel efficiency**: how long engineers wait for feedback; usually the cheapest productivity wins.
- **Deployment frequency, lead time, change failure rate, MTTR**: the four DORA delivery metrics (section 3.6). Change failure rate is also a QA score input (25 %).
- **Velocity, commitment, carryover, sizing accuracy**: predictability of delivery; velocity is a planning tool, never a performance score.
- **First-time pass rate**: rework between developer and tester; high means clear acceptance criteria.
- **Blocked time**: pure waste in the flow, usually fixable by management (dependencies, environments, approvals).
- **MTBF, availability, infrastructure failures**: stability of the service and of CI itself.

### 3.3 QA score (team)

The single 0–100 quality number per team, shown as a battery on the dashboard, team cards, Team detail and TV.

**Battery colour** (every battery of the app, one scale in [`src/lib/batteryScale.ts`](../src/lib/batteryScale.ts)): below 30 red, 30–45
deep amber, 45–60 amber, 60–75 yellow, 75–90 light green, 90–100 solid green. The colour follows the value; the status text
(On target / Watch / Off target) is judged against the target and is always shown with it, e.g. "Off target · Target ≥ 85" or
"Watch: 70–85 · Target ≥ 85" ([`src/lib/targetText.ts`](../src/lib/targetText.ts)), on Team detail, the overview cards and gauges,
Compare, TV mode, Team rankings, pulse results and the PDF report, with the target valid at the value's date.

```
QA Score = [ Test Coverage × 0.30
           + (100 − Defect Escape Rate) × 0.25
           + (100 − Change Failure Rate) × 0.25
           + Code Quality Score × 0.20 ]
           ÷ (sum of the weights of the inputs that are recorded)
```

- Each term is limited to 0–100. Missing inputs are left out, not counted as 0 or 100; the remaining weights
  are re-normalised by dividing by their sum.
- **No score** when Test Coverage is missing or fewer than 2 of the 4 inputs are recorded.
- Rounded to a whole number.
- **Status:** ≥ 85 good, ≥ 70 warning, otherwise critical (`QA_SCORE_THRESHOLDS = { good: 85, warning: 70 }`).
- **Confidence:** "based on n of 4 inputs". On screens that show current values, stale inputs are treated
  as not recorded (`qaScoreComposite`), so a team whose coverage is stale has no current QA score
  (unless the company's newest value is over a day old: then "Last updated", section 3.1).
- **Stored** in `kpi_snapshots.qa_score` and `status` by the database trigger `kpi_snapshots_qa_score`
  (function `compute_qa_score`, migration
  [`20261117000000_kpi_integrity_and_ingestion.sql`](../supabase/migrations/20261117000000_kpi_integrity_and_ingestion.sql)),
  with the same rules as `computeQaScore()`. The stored value uses every input the snapshot holds; the
  stale-aware value is computed when shown. The ingestion API rejects `qa_score` and `status`.
- Code: `computeQaScore`, `qaScoreComposite` in [`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts).

Worked example: coverage 82, escape rate 6, change failure rate not recorded, code quality 75.
Weighted sum = 82 × 0.30 + 94 × 0.25 + 75 × 0.20 = 24.6 + 23.5 + 15.0 = 63.1; weights used = 0.75;
score = 63.1 ÷ 0.75 = 84.1 → **84 (warning)**, based on 3 of 4 inputs (confidence medium).

### 3.4 Targets, "Teams vs KPI targets", "Needs attention", "High performing"

**Target history** ([`server/lib/targets.ts`](../server/lib/targets.ts), table `target_history`). A target is a
`good` and a `warning` level for one metric, set at company, department or team scope with a validity period.
Saving a change closes the current row and opens a new one. Lookup order: team, then department, then
company, then the code default (`METRICS_CONFIG`). The direction never changes. Every judgement uses the
target valid at the value's date (the end of its UTC day). The 20 metrics that can have a target are listed
in `TARGET_METRICS` (every KPI above except velocity, automation ROI and sizing accuracy). Set in
**Administration → Parameters → KPI targets** (`GET/PUT /api/targets`); every change is in the Activity history.

**The four headline KPI targets** (`KPI_TARGETS`, defaults): coverage ≥ 80 %, automation ≥ 70 %, flakiness ≤ 2 %,
escape rate ≤ 5 %. These drive the following rules.

**Teams vs KPI targets** (`teamKpiTrack`, Company status on the dashboard). Of the four KPI targets, take those
with a current (recorded, not stale) value, each judged against the target valid at the value's date:

| Bucket | Rule |
|---|---|
| On track | at least 75 % of them met |
| At risk | 50 % to under 75 % met |
| Off track | under 50 % met |
| Not classified | fewer than 2 current values |

The counts and the per-team breakdown both come from `GET /api/analytics/company-summary` (`kpiStatus`,
`kpiStatusTeams`), produced by the same function, so a tab's list always equals its count.

**Attention issues** (`teamAttentionIssues`): QA score below 70 (critical), or any of the four KPIs off its
target. Returns the reasons, for example "Test coverage 72.4% (target ≥80%)". Used by the Company status card.

**Dashboard filters** (Team performance, `src/components/NewDashboard.tsx`): split the teams that have a QA score
by the team's QA score target (the "Target ≥ …" on its card, 85 unless set otherwise):
- **High performing:** QA score at or above the target.
- **Needs attention:** QA score below the target.

A KPI off its own target alone (for example flakiness 2.5% against ≤ 2%) does not put a team in "Needs
attention"; it shows in amber on the team's card. A team with no QA score is in neither filter.

### 3.5 Technical debt

**Technical debt score (team, 0–100, lower is better):**

```
Technical Debt Score = MIN(100, Σ severity weight of open items)
  critical = 30, high = 20, medium = 10, low = 5
  items with status resolved or wont_fix are excluded; 0 = no open debt
```

Target ≤ 30, watch ≤ 60 (`METRICS_CONFIG.technicalDebtScore`). Calculated on each request from the team's
`technical_debt` rows (`TECH_DEBT_SEVERITY_WEIGHTS`, `techDebtScoreFromWeight`); it is not stored as a snapshot,
so it has no history line.

**Tech debt health (company, 0–100, higher is better)**, shown in Company status and used in engineering health:

```
Tech debt health = max(0, 100 − min(100, Σ severity weight of open items of active teams ÷ number of active teams))
```

No value when no debt items are tracked. The company summary also reports a resolution rate
(resolved or won't fix ÷ all items × 100). Code: `computeCompanyMetrics` in
[`server/routes/analytics.ts`](../server/routes/analytics.ts).

**Per-item ROI** (Technical debt page, `TECH_DEBT_ROI_FORMULA`):

```
Investment            = effort hours × developer hourly rate
Monthly cost of delay = support tickets/mo × support ticket cost
                      + downtime min/mo × downtime cost per minute
                      + affected users × revenue per user per month × revenue impact % ÷ 100
                      + SLA breaches/mo × SLA breach penalty
Annual savings        = monthly cost of delay × 12
ROI %                 = (annual savings − investment) ÷ investment × 100
Payback months        = investment ÷ monthly cost of delay
```

Cost inputs come from **Parameters → Financial and ROI settings** (team overrides company). Built-in defaults,
labelled as defaults when used: developer hourly rate $75, support ticket cost $25, revenue per user per month
$50, downtime cost per minute $100, SLA breach penalty $1,000. The per-item inputs (tickets, downtime minutes,
affected users, revenue impact, SLA breaches) are edited in **Manual metrics → Technical Debt ROI Impact**.

**Where debt items come from:** today only sample data (there is no ingestion endpoint for debt items).
In production: SonarQube issues / technical-debt measures and Jira issues labelled as debt.

### 3.6 DORA and delivery performance

**DORA level per team** (`getDORALevel` in [`server/routes/metrics.ts`](../server/routes/metrics.ts), identical bands in
`classifyDoraLevel` in `analytics.ts`):

| Level | Deployments / week | Lead time | Change failure rate | MTTR |
|---|---|---|---|---|
| Elite | ≥ 7 | < 1 day | < 5 % | < 1 h |
| High | ≥ 1 | < 7 days | < 10 % | < 24 h |
| Medium | ≥ 0.25 | < 30 days | < 15 % | < 168 h |
| Low | otherwise | | | |
| Unknown | any of the four inputs not recorded (or, on the dashboard, stale) | | | |

All four conditions of a level must hold. A recorded 0 is a real value; only missing is unknown.

**Delivery performance (company, "Delivery (DORA)" on the dashboard):** mean of per-team level scores
(Elite 100, High 80, Medium 60, Low 40), weighted by team size, over teams that can be classified. Confidence
"based on n of m teams". Sources: as the four KPIs in section 3.2.

### 3.7 Pipeline health and bottleneck score

**Pipeline health (company):** successful pipeline runs ÷ (successful + failed) runs in the last 30 days × 100,
for company-level pipelines and active teams; running and cancelled runs are excluded; no value without completed
runs. Production source: Jenkins / GitHub Actions / GitLab run results. Today: `pipeline_runs`, filled only by
sample data.

**Bottleneck score (per pipeline stage, CI/CD pipeline page,** `BOTTLENECK_SCORE_FORMULA`**):**

```
Bottleneck score = min(100, duration factor + failure factor), 1 decimal
duration factor  = min(60, max(0, (z + 2) ÷ 4 × 60)),  z = (stage duration − mean stage duration) ÷ std. dev. of stage durations
failure factor   = (1 − success rate ÷ 100) × 40
```

Population standard deviation; no score when duration or success rate is missing. Bars turn amber above 40 and
red above 70.

### 3.8 Engineering health (company)

```
Engineering health = weighted mean of the components that have data
  Delivery performance (DORA)  0.35
  Pipeline health              0.25
  Tech debt health             0.20
  Wellbeing (survey)           0.20
```

(`ENGINEERING_HEALTH_WEIGHTS` in `analytics.ts`.) A component without data is left out and the remaining
weights are re-normalised; it is never replaced by another signal (in particular, workload balance never stands
in for the survey). Confidence: "based on n of 4 components". Rounded to a whole number.

The dashboard colours the company gauges (engineering health, delivery, tech debt health, pipeline health) green
at ≥ 80 and amber at ≥ 60 (`COMPOSITE_INDEX_BANDS` in [`metricFormulas.ts`](../server/lib/metricFormulas.ts), used by
[`NewDashboard.tsx`](../src/components/NewDashboard.tsx));
the wellbeing gauge uses the wellbeing bands (≥ 70, ≥ 50).

### 3.9 Company aggregates

The global QA score and the company KPI averages (coverage, escape rate, automation, flakiness) are
(`COMPANY_AGGREGATE_TEXT`, `distributionOf` in [`metricFormulas.ts`](../server/lib/metricFormulas.ts)):

- the **mean of the team values weighted by active team size** (active assigned members; a team with no members
  counts as 1);
- over active teams with a **current** value (stale and missing values left out, never counted as 0);
- reported with the **unweighted mean, median, 25th percentile ("weakest 25 %": the weakest quarter of teams is at
  or below it), minimum and count** (`globalQaScoreDistribution`, `kpiAveragesUnweighted`). Percentiles use linear
  interpolation between closest ranks.

**Trend:** the weighted global QA score now minus the same measure over each team's latest snapshot dated 7–14
days ago (with the inputs stale on that day left out). No trend (not "stable") when that window has no scored
snapshots.

**Risk level:** global QA score ≥ 85 stable, ≥ 70 watch, below at risk; no score = insufficient data.

**Company summary text** is rule-based (no AI): the trend, the number of teams below their coverage target, the
automation average against the company target in force today, and the "as of" date.

### 3.10 Developer metrics: workload balance, burnout risk, DDPS, developer recommendations

**Inputs** (table `developer_metrics`, one current row per developer and team): PR merge time (hours), code review
turnaround (hours), focus time (hours/day), meeting time (hours/day), context switches (per day). Thresholds
(`METRICS_CONFIG`):

| Input | Better | Target / watch |
|---|---|---|
| PR merge time | lower | ≤ 4 h / ≤ 24 h |
| Code review turnaround | lower | ≤ 2 h / ≤ 4 h |
| Focus time | higher | ≥ 5 h/day / ≥ 3 h/day |
| Meeting time | lower | ≤ 2 h/day / ≤ 4 h/day |
| Context switches | lower | ≤ 3/day / ≤ 6/day |

Where they come from: calculated from records (section 4.2f, [`server/lib/developerFromRaw.ts`](../server/lib/developerFromRaw.ts)):
PR merge time and review turnaround from the pull requests the Exporter reads (GitHub, GitLab, Bitbucket Cloud, Azure DevOps: opened →
merged, opened → first review by someone else), meeting time, focus time (free blocks of two hours or more) and context switches
(separate busy blocks per working day) from calendar free/busy (Google Calendar, Microsoft 365), over the last 30 days, for the people
who enabled developer insights. A row calculated this way has source `computed`. For companies not in live operation they can also be
entered in **Manual metrics → Developer Productivity Metrics** (`POST /api/metrics/developer`; super admin, manager, team lead), or be
sample data.

**Workload balance (derived), 0–100, higher is better, target ≥ 70, watch ≥ 50** (`calculateWorkloadBalance` in
[`src/data/advancedFeatures.ts`](../src/data/advancedFeatures.ts)):

```
40 % × focus ÷ (focus + meetings)
+ 30 % × (10 − context switches) ÷ 10
+ 15 % × (4 − meeting h) ÷ 4
+ 7.5 % × (24 − PR h) ÷ 24
+ 7.5 % × (8 − review h) ÷ 8
each term floored at 0, scaled to 0–100
```

Stored in the column `developer_metrics.happiness_score` for historical reasons. It is a workload signal, **not** a
happiness survey and **not** wellbeing, and not part of engineering health. The company summary reports it
separately as `workloadBalanceIndex`.

**Burnout risk (derived)** (`computeBurnoutRisk`): **high** when focus < 3 h/day, meetings > 5 h/day or context
switches > 10/day; **moderate** when focus < 4 h/day, meetings > 4 h/day or context switches > 7/day; otherwise
**low**; not rated when any of the three inputs is missing. A rule on workload data, not a medical or personal
assessment. Calculated when shown; not stored.

**DDPS, Daily Developer Productivity Score (0–100)** (`computeDdps`):

```
DDPS = clamp(raw, 0, 75) ÷ 75 × 100, rounded to 1 decimal
raw  = Focus + Meetings + Context switches + PR merge + Review + Balance
  Focus            = min(focus hours ÷ 5, 1) × 50
  Meetings         = 0 (≤ 1 h), −3 (≤ 2 h), −6 (≤ 3 h), −10 (> 3 h)
  Context switches = 0 (≤ 2/day), −5 (≤ 4), −10 (≤ 6), −15 (> 6)
  PR merge time    = +10 (< 4 h), +5 (< 8 h), 0 (< 24 h), −5 (< 48 h), −10 (≥ 48 h)
  Review turnaround= +5 (< 2 h), +2 (< 4 h), 0 (< 8 h), −5 (≥ 8 h)
  Balance          = max(0, 100 − 25 × max(0, focus hours + meeting hours − 8)) ÷ 10
```

The maximum raw total is 75, hence the rescale. PR merge and review times are elapsed times, so they are not counted
as hours worked. No score when any input is missing. Bands (`DDPS_BANDS`): Exceptional ≥ 80, High ≥ 60, Moderate
≥ 40, Low below. History (`developer_productivity_snapshots`, 1 day to 6 months) recalculates the score from each
snapshot's inputs. DDPS is meant to show where the environment gets in the way, not to rank individuals.

**Developer recommendations** (`assessDeveloper` in [`server/lib/developerHealth.ts`](../server/lib/developerHealth.ts)):
concerns of weight 2: focus < 3 h/day, meetings > 4 h/day, context switches > 6/day; weight 1: PR merge time > 24 h,
review turnaround > 4 h. Status **at-risk** at total weight ≥ 3, **needs-attention** at ≥ 1, otherwise **healthy**; a
developer with no metric recorded at all is needs-attention. Missing values are "not measured" and never count as good;
praise only when there are no concerns and every input was measured. Workload balance is not counted again. With
`GROQ_API_KEY` set and AI enabled for the team, a language model may write the summary and suggestion text; the status
always comes from the rules.

**Team averages** of all of the above (team DDPS, average inputs, average workload balance, burnout counts) are subject to
the k-anonymity rule (section 6): contributors are active software engineers and team leads assigned to the team who opted in to
developer insights and have all five inputs recorded ([`server/lib/developerAggregates.ts`](../server/lib/developerAggregates.ts)).

### 3.11 Wellbeing (survey)

The wellbeing signal of the product, from the anonymous **pulse survey** ([`server/lib/pulseRules.ts`](../server/lib/pulseRules.ts)).
Five statements, answered 1 (strongly disagree) to 5 (strongly agree), plus an optional comment of up to 500 characters:

1. My workload over this period was manageable.
2. I had enough uninterrupted time for focused work.
3. I felt supported by my team when I needed help.
4. I usually ended the day with energy left.
5. I feel positive about the coming weeks in this team.

```
Wellbeing (survey), 0–100 = (mean of all answers on the 1–5 scale − 1) ÷ 4 × 100   (rounded to 1 decimal)
```

Over the responses of one **closed** period, shown only with at least 3 responses. Bands: on target ≥ 70, watch ≥ 50,
below low (`WELLBEING_BANDS`). Periods: every week, two weeks, month or three months per team (default every two weeks,
counted from Monday 2026-01-05; section 6); results show up to 12 closed periods as a trend.

```
Response rate (per closed period) = responses ÷ members the survey was e-mailed to   (at most 100 %; shown only with the results)
```

**Company / department value:** each team's latest closed period with at least 3 responses (teams below 3 left out),
weighted by responses. In the API this is `developerWellnessIndex`. It feeds engineering health (20 %).

Source today and in production: only the IronGate pulse survey. There is deliberately no import: answers can only be
given by the people themselves.

### 3.12 Quality analytics: flaky tests, test execution, performance

| Module | What it shows | Calculation notes | Data today | Production source |
|---|---|---|---|---|
| Flaky tests | Up to 50 flaky tests of the team, sorted by stored flakiness score, with failure pattern, recent runs, root cause and suggested fix | Pattern guidance is generic text per stored pattern label; when no root cause is stored the API says "unverified, not derived from error logs" (for a team that sent test reports: the tests that failed and passed on the same commit, section 4.2a) | The test reports the team's CI sent; sample data for a team that never sent one | JUnit results across reruns from Jenkins / GitHub Actions; a flaky-test detector |
| Test execution | Suite runs over time (pass / fail / duration), filters, execution flow | One row per test report received (`test_runs`) | The test reports the team's CI sent; sample data for a team that never sent one | CI test reports (the Exporter, or the raw ingestion API) |
| Performance | Daily p50 / p95 / p99 response time per endpoint, error rate, SLA breaches | An endpoint is in breach when its p95 is above **Parameters → Performance SLA → P95 response time** (default 500 ms) or its error rate above the error-rate threshold (default 1 %) | The load-test result files the team's pipelines keep (k6, JMeter, Gatling; section 4.2f): the latest run of each day per endpoint. Sample data for a team that never sent one | k6 / JMeter / Gatling results (the Exporter reads them from the CI artifacts) |

The team-level flakiness KPI (`test_flakiness_rate`) is separate from the per-test list. When sample generation is on,
it is calculated from pipeline runs: a test-stage run is flaky when it failed on a commit on which the same stage also
passed; rate = flaky failed runs ÷ all test-stage runs in the last 7 days × 100
([`server/jobs/intervalSync.ts`](../server/jobs/intervalSync.ts)).

### 3.13 Business impact: money, revenue impact and correlations

The Business impact page relates a team's monthly quality metrics to its business KPIs
(`business-impact-v2` endpoints in [`server/routes/analytics.ts`](../server/routes/analytics.ts)):

- **Quality metrics** (`BI_QUALITY_FIELDS`): test coverage, defect density, defect escape rate, MTTR, deployment frequency,
  lead time, code quality score, change failure rate.
- **Business KPIs** (`BI_KPI_FIELDS`): monthly revenue, active users, churn rate, feature adoption rate, NPS, CSAT, support
  ticket volume.
- **Method** (`CORRELATION_METHOD`): Pearson r for each quality × business pair over the months where both exist (same month,
  no lag; recalculated from the stored months on every load); two-sided
  Student t-test (df = n − 2, exact); Benjamini–Hochberg false-discovery-rate correction across all pairs tested for the
  team; **significant when q < 0.05**. Needs at least 6 months of each series and 6 paired months; pairs with zero variance
  are skipped. Strength label: |r| ≥ 0.7 strong, ≥ 0.5 moderate, ≥ 0.3 weak, else none.
- **Caveat shown with the results:** correlation does not show causation; monthly series that share a trend can correlate
  without any causal link. Results are exploratory.
- **Data today:** entered by hand on the page (monthly quality metrics, business KPIs, optional context) or sample data
  (`data_source = 'synthetic'`). Production: quality from the KPI history; business KPIs from finance / BI (revenue), product
  analytics (Amplitude, Mixpanel: active users, adoption), CRM / billing (churn), survey tools (NPS, CSAT), Zendesk /
  ServiceNow (ticket volume).
- **Summary**: a rule-based summary of the correlations is always shown (`server/lib/correlationSummary.ts`: months and pairs
  tested, significant pairs in plain words, a shared-trend warning when half or more are significant, else the strongest pair
  and the |r| needed for p < 0.05). **Generate AI summary** (needs `GROQ_API_KEY`) replaces it with model output, labelled as
  such; without a provider, or when it fails, the rule-based summary is returned (`source: 'rules'`), never an error or an
  empty box.
- **How this works** (an expander at the top of every tab, `src/components/BusinessImpactHowItWorks.tsx`): what goes in
  (which metrics, entered vs calculated), how links are found (this section), how the money figures are derived, which inputs
  are assumptions the company sets, what the confidence labels mean and what the page does not claim. Every figure, and every
  tile on Details and All teams, opens **How this was calculated** with its formula, inputs and sample size.

**Revenue impact** (the Money, What-if, Details and All teams tabs; `server/lib/revenueImpact.ts`,
`server/lib/stats.ts`, `GET /api/revenue-impact/teams/:teamId`, `…/what-if?metric=&change=`, `GET /api/revenue-impact/rollup`).
Amounts are per month and per year (month × 12), rounded; a missing input shows "—" with the reason.

- **Revenue per metric (sensitivity).** For each of the eight quality metrics, the ordinary least-squares slope b of
  monthly revenue on the metric over the months with both values:

  ```
  b = Σ(x − x̄)(y − ȳ) ÷ Σ(x − x̄)²          a = ȳ − b·x̄
  SE(b) = √( Σ(y − a − b·x)² ÷ (n − 2) ÷ Σ(x − x̄)² )
  t = b ÷ SE(b), df = n − 2, exact two-sided p
  95 % range = b ± t(0.975, n − 2) × SE(b);  r = Pearson r;  R² = r²
  ```

  "$ per month associated with +1 unit of the metric". Shown from 6 paired months (else "needs k more");
  significant when p < 0.05, **exploratory, not corrected for multiple comparisons** (the Correlations matrix applies
  BH-FDR across all pairs). Sample and recorded months are never fitted together: when both exist, only the months
  with the kind of source of the latest month are used. In the page: Details → "How sure are we?" (Strong evidence
  p < 0.01, Some evidence p < 0.05, Company-wide evidence, Not significant).
- **Company-wide slope** (`pooledRevenueFit`): when the team's own slope is not significant or the metric did not change,
  the company's active teams with 6 or more paired months of the same kind of source are fitted together, each against its own
  averages (x = metric − team average, y = revenue ÷ team average revenue − 1; b = Σxy ÷ Σx²; SE with df = N − teams − 1;
  95 % range; at least 2 teams). If significant (p < 0.05), the team's slope = b × its average monthly revenue, tagged
  **Company-wide evidence**, with the team's own fit shown beside it. Only the count of teams and months leaves the fit.
- **Where the money is going now** (the causes overlap, so no total):
  quality below target = Σ over metrics with a significant slope of b × (target valid today − latest value), a met
  target adding 0, metrics below target taken first and then by smallest p, and a metric whose monthly series correlates at |r| ≥ 0.7 with one
  already counted not added again, range = Σ(CI low × gap, CI high × gap); open technical debt = Σ of the open items'
  monthly cost of delay (section 3.5, components shown); incidents and downtime = latest month's downtime minutes ×
  downtime cost per minute; support tickets = latest month's tickets × support ticket cost; customers leaving =
  churn % × monthly revenue of the latest month (assumes churned customers had average revenue). Deployment frequency
  is per month; its target is the weekly KPI target × 52 ÷ 12.
- **What you gain when these are fixed**, biggest first, five shown: each counted quality gap (b × gap with its range
  and evidence tag; metrics that move with it are named), each open debt item (its monthly cost of delay; fix cost =
  effort hours × developer hourly rate), downtime above the availability target ((downtime − (100 − target %) ÷ 100 ×
  minutes in the month) × downtime cost per minute). A gap whose b × gap is negative (reaching the target associated
  with lower revenue) is listed as not counted.
- **Where to put the money first**: the fixes by monthly gain, or by return on cost (yearly gain ÷ fix cost; payback =
  fix cost ÷ monthly gain) for debt items with an effort estimate.
- **What-if**: projected monthly change = b × change, range (CI low × change, CI high × change), yearly × 12; disabled
  with the reason when the slope is not significant; a value outside the recorded range is flagged as extrapolation.
- **All teams**: sum of the team figures over the teams of the caller's analytics scope (super admin: company, QA
  manager: their departments; optional department); teams without a figure are listed with the reason.
- Rates come from Parameters → Financial and ROI settings (team, else department, else company); they are assumptions the
  company sets, and built-in defaults are labelled "(default)". Sample data (demo generator, Populate metrics, Meridian)
  adds the rates it assumes where a company has none: hourly rate 85, ticket cost 30, SLA penalty 2500, and per team the
  revenue per user (its sample revenue per active user) and the downtime cost per minute (its monthly revenue ÷ 43 200).
- The page does **not** claim causation, forecasts or that reaching a target brings the money back. Production sources: finance / BI for revenue, product analytics for active users and churn,
  incident tooling for downtime, Zendesk / ServiceNow for tickets, SonarQube / Jira for debt items.

### 3.14 Team rankings

Active teams of the selected team's department ranked by a chosen column (default the latest QA score; also the KPI
columns), with competition ranking (equal values share a rank) and teams without a value listed last without a rank. No
points, badges or achievements are invented ([`src/components/TeamGamification.tsx`](../src/components/TeamGamification.tsx)).

---

## 4. How data gets in

### 4.1 The one write path

Manual entry (`POST /api/metrics/manual`), machine ingestion (`POST /api/ingest/kpis`) and the sample-data generators all call
`recordKpiValues()` in [`server/lib/kpiIngest.ts`](../server/lib/kpiIngest.ts), so they validate, store and derive identically:

1. Validate each column against `KPI_COLUMNS` (unknown column, non-number or out-of-range value = error; integer columns are
   rounded). `null` / empty means "not provided" and never clears a stored value. `qa_score` and `status` are refused.
2. Store each value in **`metric_values`**: team, metric, value, `recorded_at` (the time the value is *for*), `received_at`,
   source, actor, idempotency key, source reference, ingestion log id. A second value for the same team, metric and
   `recorded_at` is a correction: the earlier one is marked superseded.
3. Re-derive **`kpi_snapshots`** (database function `refresh_kpi_snapshots`): a snapshot day holds, for each metric, the latest
   non-superseded value recorded before the end of that UTC day. A backdated value updates its day and the later days on which
   no newer value exists; a day without a snapshot gets one.
4. The database trigger computes the QA score and status of each affected snapshot.
5. Open dashboards are told to refresh (WebSocket event; not available on Netlify).

**Provenance and carry-forward.** Each snapshot field has `field_sources.<column> = { source, recorded_at, recorded_by,
carried_forward }`. `carried_forward` is true when the value shown on a day was recorded on an earlier day. Carry-forward is
what lets a partial update (say, only coverage) leave the other metrics in place; staleness (section 3.1) is what stops an old
carried-forward value from being treated as current.

### 4.2 KPI ingestion API

`POST /api/ingest/kpis` ([`server/routes/ingest.ts`](../server/routes/ingest.ts)).

- **Authentication:** `Authorization: Bearer igk_…`. A super admin creates keys in **Admin console → API keys**. The key is shown
  once; only its SHA-256 hash is stored. A key belongs to one company and can write any team in it. Revoked or unknown key: 401;
  team of another company: 403.
- **Body:** `{ "teamId", "source", "recordedAt"?, "metrics": { column: number }, "idempotencyKey"?, "sourceRef"? }`, or an array of
  up to 100 such items.
  - `source`: 1–50 characters (lower-case letters, digits, `_`, `-`, `.`), for example `jenkins`, `jira`, `sonarqube`. `manual` is
    reserved for the app.
  - `recordedAt`: ISO 8601 time the values are for; default now; at most 5 minutes in the future; up to 365 days back (backfill).
  - `idempotencyKey` (per item, 1–200 characters): an item already written with this key for the team is skipped and reported as
    `duplicate`.
  - `sourceRef`: free text up to 500 characters (build id, URL).
- **All or nothing by default:** the whole batch is validated first and written in one transaction; any invalid item gives 400 and
  nothing is written. With `?partial=true` the valid items are written and the others reported per item (207, `status: "partial"`).
- **`Idempotency-Key` header:** a retried request with the same key (same API key, same body) returns the stored result with
  `Idempotent-Replayed: true` and writes nothing; the same key with a different body gets 422; concurrent duplicates wait for the
  first and replay it; a rejected request does not bind its key.
- **Rate limit:** 60 requests per minute per key.

Example (values are placeholders):

```bash
curl -X POST "https://<host>/api/ingest/kpis?partial=true" \
  -H "Authorization: Bearer $IRONGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sonar-build-4812" \
  -d '{
        "teamId": "<team id>",
        "source": "sonarqube",
        "recordedAt": "2026-11-17T08:00:00Z",
        "sourceRef": "build 4812",
        "metrics": { "code_quality_score": 82, "test_coverage": 78.4 }
      }'
```

The response gives the snapshot day, the resulting QA score and status, which metrics were updated, which were carried forward,
and whether the item was a duplicate.

### 4.2a Raw CI data: tests, coverage, pipelines (v2)

Why: customers send the raw output their tools already produce, and QE Navigator calculates every metric itself, so each
number is traceable to the runs it came from (docs/V2_PLAN.md, phase 1).

- `POST /api/ingest/tests` (JUnit XML from pytest, Jest, Maven / Gradle, Playwright, Cypress; TRX; Cucumber JSON),
  `POST /api/ingest/coverage` (lcov, Cobertura, JaCoCo, Istanbul; optional diff for coverage of changed code) and
  `POST /api/ingest/pipelines` (pipeline runs with stages). Same API keys, rate limit and ingestion log as the KPI API;
  idempotent per team, commit, run and attempt. Reference: docs/INTEGRATION_GUIDE.md section 4A.
- The calculation engine ([`server/lib/calc/engine.ts`](../server/lib/calc/engine.ts)) computes per team and day: line and
  branch coverage, per-file coverage, coverage of changed code, pass rate, first-time pass rate, flaky tests (failed and passed
  on the same commit within 7 days) and the flakiness rate, test execution time (median), average build time (median pipeline
  duration), pipeline success rate and parallel test efficiency, each with the number of runs it rests on (high confidence from
  10 runs, medium 3–9, low 1–2). Values with a KPI column are written through the one write path with source `computed`, so
  dashboards, alerts, targets and the QA score use them; a late file recalculates the days it affects, and a nightly job
  (`calc-recompute`) the last 8 days.
- Evidence (`metric_evidence`): for every computed value its formula, the values used and the source runs, reports and tests.
- Storage: everything received is kept 13 months (a year of history): runs, reports, per-test and per-file rows, the gzipped
  files (at most 512 KB each) and the evidence. Calculated KPI values and snapshots are never deleted.
- Sample data: demo and filled teams get 14 days of sample raw CI data that follows their story (healthier teams: higher
  coverage, fewer flaky tests, greener and faster pipelines). Its evidence is shown; it is never written as KPI values.


### 4.2b Deployments, commits and incidents (v2)

Why: delivery speed and stability (the DORA metrics) are calculated from what actually happened, not typed in, so a change
failure rate opens to the very deploys that failed and why (docs/V2_PLAN.md, phase 2).

- `POST /api/ingest/deployments` (deploy events, or the GitHub / GitLab deployment webhook), `POST /api/ingest/commits` (the
  commits of a deploy or a push, from `git log` or a push webhook; authors kept only as a hash) and `POST /api/ingest/incidents`
  (incidents created and updated by id, or the PagerDuty / Opsgenie webhook). Same API keys, rate limit and ingestion log;
  batches of up to 500 events; reference: docs/INTEGRATION_GUIDE.md section 4B.
- The calculation ([`server/lib/calc/delivery.ts`](../server/lib/calc/delivery.ts)) works per team and day over the 28 days ending
  the day: **deployment frequency** (production deploys per week), **lead time for changes** (median first commit authored →
  deploy finished), **change failure rate** (deploys rolled back, followed within 72 h by a hotfix of the same service, or
  linked to an incident ÷ production deploys), **MTTR** (median opened → resolved), **MTBF** (mean time between incident starts
  per service), **availability** (1 − outage time ÷ period; critical and high incidents are outages unless marked otherwise),
  **incidents per deploy** and **infrastructure failures**. Each value is written to the existing KPI with source `computed`
  and keeps its deploys and incidents as evidence; a rollback or incident that arrives later changes the values from its own
  day on.
- Events that carry no team go to the team their service is mapped to (Connect your CI → Service → team mapping).

### 4.2c Issues and static analysis (v2)

Why: defect escape, sprint predictability and code quality are calculated from the issues and findings themselves, so a high
escape rate opens to the very bugs customers found, and a low code quality score to the rules and files behind it
(docs/V2_PLAN.md, phase 3).

- `POST /api/ingest/issues` takes Jira (a search export with changelog, or the automation / webhook payload), Linear (an export or
  the webhook) or a simple JSON list; `POST /api/ingest/static-analysis` takes SARIF 2.1.0 from SonarQube, CodeQL, ESLint and
  other tools. Same API keys, rate limit and ingestion log; reference: docs/INTEGRATION_GUIDE.md section 4C.
- The calculation ([`server/lib/calc/work.ts`](../server/lib/calc/work.ts), [`quality.ts`](../server/lib/calc/quality.ts)):
  **defect escape rate** (bugs found in production ÷ bugs with a known environment, 28 days), **defect density** (production bugs ÷
  thousand lines of code from the coverage reports), from the latest closed sprint **velocity** (points completed before it
  closed), **commitment rate** (completed ÷ committed at the start), **carryover** (not completed ÷ committed), **blocked time**
  (hours in a blocked status or flagged) and **sizing accuracy** (time logged ÷ original estimate), and the **code quality score**
  = round(100 × e^(−weighted findings per 1,000 lines ÷ 20)) with weights critical 10, high 5, medium 2, low 0.5, plus findings by
  severity and rule and the findings new or fixed since the previous report.
- Values are written to the existing KPI columns with source `computed`, so dashboards, targets, alerts, forecasts and the QA
  score use them; each value keeps its evidence. Bugs without an environment, and bugs closed as won't do or cannot reproduce, are
  left out (and shown as left out); a team without coverage reports gets no density, and a report without a code size no score.
- Sample data: every demo and filled team has a year of sample issues and weekly SonarQube reports made from its own KPI history,
  so the calculated values agree with what its pages show. Evidence only: never written as KPI values.

### 4.2d QE Navigator Exporter (your CI and tools, read from inside your network)

Why: many companies will not give a SaaS product their CI, Jira or PagerDuty tokens, cannot open their Jenkins or Jira Server to
the internet, and do not want to add a step to every pipeline. The Exporter turns "connect your CI" into something a security
team can approve: it runs inside the customer's network with the customer's own read-only credentials, reads the raw data, and
only ever makes outbound HTTPS calls to QE Navigator. **QE Navigator calculates everything; the Exporter calculates nothing.**

- What it is: a small program ([`exporter/`](../exporter/README.md), command `qe-exporter`; `qe-collector` and `qe-agent` still
  work as aliases of its earlier releases): one Node 20 file without runtime dependencies, or a distroless container, scheduled
  every 15 minutes. `setup` opens a local page (127.0.0.1 only, one-time token) where the customer enters the API key (the page
  loads the company, departments and teams), connects each tool (token, service account, username + app password, or OAuth with
  their own OAuth app), tests each connection and maps each repository / project / pipeline / service to a department and team;
  credentials go to a 0600 file in a 0700 folder and are never sent to QE Navigator. `check` validates the setup, `preview` shows
  the exact JSON that would be sent (nothing is sent), `sync` sends, `diagnose` writes a redacted support file.
- What it reads: GitHub Actions, GitLab CI, Bitbucket Cloud and Data Center, Jenkins, Azure DevOps, SonarQube, Jira, Linear,
  PagerDuty, Opsgenie, TestRail, Xray Cloud, Zephyr Scale, Google Calendar and Microsoft 365 (and a KPI file of finished values, for
  companies not in live operation).
- What it sends: JSON envelopes `{ companyId, departmentId, teamId, source, kind, items }` to `POST /api/ingest/exporter/batch`:
  test and coverage report files as files (without failure messages and output), SARIF without messages, pipeline runs,
  deployments with their commits (sha and times), incidents and issues through the field allow-list, KPI values. QE Navigator
  checks the three ids against the API key (a wrong id is refused and nothing is written; "not yours" and "does not exist" get the
  same answer), then parses, stores and calculates with the same code as for every other ingestion path.
- Where it shows: Admin console → Connect your CI → **QE Navigator Exporter**: the setup steps, a config file with the company,
  department and team ids for people who prefer files, Docker, Kubernetes and Node steps, and **Exporter status** (last seen, the
  version with an outdated warning, each source's last success and failed runs, from the heartbeat each run sends: no data). Its
  data is used everywhere exactly like any other raw data (dashboards, "How this was calculated", the evidence panels, KPI history,
  alerts, targets, forecasts, recommendations, TV mode). Its requests appear in the ingestion log as channel **Exporter**, and the
  platform operator sees every batch (accepted or rejected) in Operator → **Exporter deliveries** (kept 13 months; the
  sanitised preview is cleared after 30 days).
- Security posture for the customer's review: [`exporter/SECURITY.md`](../exporter/SECURITY.md) (data flow and exact fields, how
  the ids are validated, where credentials live, permissions per vendor, network, verification of the bundle and the image).
- Try it with made-up data: [`deploy/exporter-test/`](../deploy/exporter-test/README.md).

### 4.2f Load-test results, test management, pull requests and calendars

Why: Performance, automation coverage and ROI, and the developer metrics were the last numbers someone had to type. They now come from
records too (reference: docs/INTEGRATION_GUIDE.md section 4F; [`server/routes/ingestMore.ts`](../server/routes/ingestMore.ts)).

- **Performance**: the result files of load tests a pipeline keeps (a k6 summary export, JMeter's `statistics.json`, Gatling's
  `stats.json`), read by the Exporter from the CI artifacts and parsed by QE Navigator. The Performance page shows per day and endpoint
  the latest run's p50, p95, p99, throughput and error rate.
- **Automation coverage and automation ROI**: from the test cases and executions of TestRail, Xray Cloud or Zephyr Scale.
  Coverage = automated cases ÷ cases. ROI = (time saved − time invested) ÷ time invested over 30 days: time saved from the automated
  executions of cases with a manual estimate, time invested from the time logged on the issues the customer marks as test-automation
  work. Both are calculated by the engine (group `automation`) with "How this was calculated".
- **Developer metrics**: PR merge time and code review time from pull requests (GitHub, GitLab, Bitbucket Cloud, Azure DevOps); meeting
  time, focus time and context switches from calendar free/busy (Google Calendar, Microsoft 365: start and end of busy intervals only,
  never a title or an attendee); workload balance and DDPS from those ([`server/lib/developerFromRaw.ts`](../server/lib/developerFromRaw.ts)).
- **People and privacy.** A person arrives as a pseudonym, `sha256(lower(e-mail) + ":" + company id)`, computed by the Exporter and only
  when the customer turns on `privacy.developerMetrics`. QE Navigator can compute the same value for its own users, and keeps a
  pseudonym only for an active user who enabled developer insights (section 6); a pull request of anyone else is stored without an
  author, a calendar day of anyone else is not stored. The k-anonymity rule for team figures is unchanged.

### 4.2e Upload files ("Level 0": no token, no network access, no CI step)

Why: some companies can give QE Navigator nothing at all: no API key in their CI, no token to their tracker, no outbound
connection from an agent. They can still export files. Upload files is the zero-access way in, and the trust feature is the
**preview**: before anything is stored the person sees exactly which fields of which records will be kept.

- Where: Administration → **Upload files** (and a card in the Admin console next to Connect your CI). Super admins for every team,
  managers for their departments' teams, team leads for the teams they lead (the people who may write a team's data).
- What: everything the ingestion API accepts (JUnit, TRX, Cucumber, lcov, Cobertura, JaCoCo, Istanbul, SARIF, pipeline /
  deployment / commit / incident / issue JSON including Jira search results with changelog, Linear exports, PagerDuty and Opsgenie
  exports) plus the CSV exports people can get without API access: Jira (all or current fields, any language), Linear, PagerDuty
  incidents, Opsgenie alerts or incidents, and two QE Navigator templates (deployments, sprints). Zip archives are unpacked with safe
  limits. Types are detected by content; the person can override the type and confirm the CSV column mapping.
- How: the files are turned into requests of the ingestion API and run through the same handlers (parsers, field allow-list,
  idempotency, dry run for the preview, ingestion log, calculation engine): uploaded data is indistinguishable from API data and
  recalculates the same metrics. Rows with no team, unreadable rows and dates the API would refuse are left out and listed.
- Honest limits: a Jira CSV has no status-change history (blocked time is not calculated; only the last status-category change is
  known) and no sprint dates (velocity, commitment and carryover need the sprints template or the sprints sent once by API);
  escape rate, density and sizing accuracy are calculated when the export carries the environment and the estimates.
- Data minimisation: one **field allow-list** for every path (API, uploads, the Exporter): only the fields the calculations need, people
  as a salted hash, never descriptions, comments, attachments or free text. Titles are kept for the evidence lists unless a super
  admin turns off **Store issue and incident titles** (default on, for backward compatibility; off deletes the stored titles too).
  Details: [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) section 4E.

### 4.3 Manual metrics

**Administration → Manual metrics** (super admin, manager, team lead; team scope enforced by the server). Sections: current
metrics, team KPIs by category (with calculators such as the code-quality rating calculator), developer productivity metrics per
member, technical-debt ROI impact per item, and CI/CD pipeline stages. Team KPIs go through the same path as the API with source
`manual`, can be backdated with a "recorded at" time, and appear in the ingestion log. Stages calculated from the pipeline runs a
team's CI sent are shown read-only.

**Live data only.** Manual metrics is for demos, trials and companies not yet connected. For a company in live operation platform
support turns on **Live data only** (operator panel → the company → Edit company; `companies.settings.liveDataOnly`,
[`server/lib/liveData.ts`](../server/lib/liveData.ts)). Every metric then comes from raw data and is calculated by QE Navigator:

- Manual metrics is not in the navigation, and typed team KPIs, developer metrics and pipeline stage edits are refused by the API
  (`403`, `code: "live_data_only"`).
- A finished value is refused for every KPI, whoever sends it (`POST /api/ingest/kpis`, the Exporter's KPI file): QE Navigator
  calculates all 23 from raw data (automation coverage and ROI from the test management records).
- The monthly quality values of Business impact are the ones derived from the KPI values; they are shown read-only. The business
  figures (revenue, users, churn …) are still entered: no tool of ours measures them.
- Every module stays: Performance reads the load-test results a team's pipelines keep, Developer productivity the pull requests and
  calendars of the people who enabled developer insights (section 4.2f).

What people still set in live operation is configuration and assumptions, not metrics: targets, update frequency, financial and SLA
settings, alert rules, and the anonymous pulse survey answers.

### 4.4 Ingestion log

Every request (accepted, partial or rejected; API and Manual metrics) is recorded in `ingestion_log` with its items, errors and
response (requests of the QE Navigator Exporter are marked **Exporter**): **Administration → Ingestion log** (super admins; managers see requests that touched their departments' teams), with a
per-source "last received" overview. This is where you check whether CI integrations are still sending. Code:
[`server/lib/ingestionLog.ts`](../server/lib/ingestionLog.ts).

### 4.5 Expected update frequency and staleness

**Administration → Update frequency** sets, per company, how often each metric is expected to receive a value (defaults in section
3.2). It schedules nothing; it only decides when a value becomes stale.

### 4.6 Configuration inheritance

Settings in the `configs` table (Performance SLA, financial settings and others) resolve team, then department, then company
([`server/lib/configResolver.ts`](../server/lib/configResolver.ts)). Keys that look like credentials are never returned to the browser.
The Parameters page and the API (`POST /api/admin/configs`) apply the same rules
([`src/lib/configRules.ts`](../src/lib/configRules.ts)): the SLA and financial values are numbers of 0 or more within a range
(P95 response time up to 600,000 ms, error rate up to 100 %, money values up to a sensible maximum), or empty to inherit; a refused
value stores nothing of that save. Expected update frequency takes a whole number from 1 to 100 with a unit.

### 4.7 Sample (synthetic) data and the banner

- `npm run seed:demo` creates a fictional company, **Northwind Payments (Sample data)**: 4 departments, 10 teams, 57 users in all
  roles, about 120 days of daily KPI history, developer productivity, pipeline runs, test cases and executions, flaky tests,
  performance, technical debt, 12 months of business-impact data, pulse answers, saved views, target history and ingestion log
  entries, plus sample alerts, notifications, preferences, alert rules and tracked actions. `--fill-existing` fills real companies' teams where a module would otherwise be empty, `seed:demo:clear` removes every demo
  row, `seed:demo:check` reports coverage. See the README for all options.
- Sample KPI values carry source `synthetic`. **"Includes sample data"** appears (dismissible for the session) whenever a value on the
  screen comes from that source, never based on the company name; in formula mode such values carry a "Sample" marker.
  A demo company can hide all of these notices (banner, markers, TV label, PDF and CSV notes) with the company setting
  `hideSampleDataNotice: true` in `companies.settings`; `/api/auth/me` reports it as `hide_sample_notice`.
- The background generators (KPI sync, pipeline seeder, daily analytics drift) only run with `ENABLE_SYNTHETIC_DATA=true`, and skip the
  demo company. A super admin can also load sample data in **Admin console → Sample data** when that flag is on.

---

## 5. Screens and features

### Appearance (themes and score display)

The **Appearance** button (palette icon) in the top bar opens a small menu, operable with the keyboard (arrows, Home / End, Enter / Space,
Escape):

- **Theme:** **Light** (default), **Dark**, **Graphite** (deep graphite with translucent dark-glass surfaces and a soft light sheen),
  **Porcelain** (warm pearl with frosted white glass) and **Match system** (Light or Dark by the device setting). Every page follows it:
  sign-in, TV mode, dialogs, menus, charts, tables, toasts and the platform support panel. Glass uses backdrop blur on floating layers
  (menus, dialogs, drawers, toasts) where the browser supports it and solid surfaces otherwise (and with "reduce transparency"). Text
  meets WCAG AA in every theme; status colours and the battery liquid colours are the same in every theme (only the battery shell turns
  smoky glass with silver rims and nib).
- **Score display:** **Battery** (the 3D battery) or **Gauge** (a 240° radial gauge in the same colour scale, number in the centre, a marker
  at the end of the coloured arc (the score; the target is in the text beside it), a short sweep on load, none with reduced motion). It applies everywhere a score is drawn: Overview hero, executive
  metrics, team cards, the Team detail QA card, the executive summary and TV mode. Both read the same to a screen reader ("QA score: 81 of 100").
- **Battery style:** **Cell** (default; `src/components/CellBattery.tsx`, adapted from Lynn Fisher's single-div battery,
  a.singlediv.com: an elliptically rounded body with side edges, a nib, a glass overlay with highlight bands and a dark band before the
  nib, and a charge in five shades of its band colour with a bright leading edge fading into the dark empty part) or **Liquid** (the
  original glass tube with a liquid, `HeroBattery.tsx`, kept unchanged). Both use the one colour scale (the five stops of each band
  follow the reference's shade relationship: tests/api/battery-scale.test.ts BAT-006), the same footprint, orientation (vertical on the
  overview and the summary, horizontal on Team detail) and text alternative. The Cell charge maps 0–100 onto 11–90 % of the inside of
  the body (`src/lib/cellBattery.ts`) and grows to the value on load (instant with reduced motion); the empty part is the dark battery
  shell in every theme, with a thin outline on the light themes (`--cell-outline`). TV mode scales either style from its own box.
- **Depth:** **3D** (default: the glossy battery with glass highlights, rims, nib gradient and shadow (Cell: glass, highlight bands,
  edges and the shaded leading edge); the gauge with a gradient arc,
  highlight, bevelled track and drop shadow) or **2D** (the same shapes, sizes and colours, flat: the battery's charge in the band's flat
  colour on the plain shell, a plain nib, no glass, rims, edges or shadow; the gauge's value arc in the band's flat colour, no gradient,
  highlight, bevel or shadow filter). The liquid wave, where shown, is a flat crest in the same colour in 2D; motion still stops with
  reduced motion. It applies everywhere the score display does, TV mode included. `data-score-depth` on `<html>` and on each visual.
  In 2D the Overview's Company status top light keeps only its rim (no haze or glow).
- **Signed-out screens** (sign-in, registration, invitation and password pages) always use the classic Light look (blue brand panel,
  white form), whatever theme is chosen; the chosen theme returns once the person is signed in.
- The choices are kept in the browser (localStorage `irongate_theme_mode`, `irongate_score_display`, `irongate_battery_style`, `irongate_score_depth`) and applied before the first
  paint. TV mode keeps its own theme (any of the four, T cycles through them); a kiosk link with `theme=dark` or `theme=light` shows
  Graphite or Porcelain while the app shows a glass theme.
- Implementation: `src/lib/appearance.ts`, `src/contexts/ThemeContext.tsx`, `src/styles/themes.css` (tokens per `<html data-theme>`),
  `src/components/ScoreVisual.tsx` / `ScoreGauge.tsx`.

### Overview (dashboard)

Why: the one-page answer to "how is quality across the company, and which teams need help?"
([`src/components/NewDashboard.tsx`](../src/components/NewDashboard.tsx)).

- **Company status**: the **Global QA score** battery (team-size-weighted, with risk badge, trend vs 7–14 days ago, "based on n of m
  teams", and the distribution: unweighted mean, median, weakest 25 %, minimum), the rule-based summary sentence, "data as of" and the
  oldest team snapshot date.
  The card is lit from an unseen source above it ("top light", `src/styles/top-light.css`): a thin rim along the top edge and down the
  left and right edges, brightest at the top corners and fading out going down (no bottom rim), plus a soft haze from the top, in the
  hero battery's band colour (`topLightRgb()` in `src/lib/batteryScale.ts`). Decorative only (behind the text, not clickable, no
  animation); softer in the light themes, rim only in flat 2D, and no light without a score. Only this card has it (not TV mode).
- **Executive gauges** (battery indicators): Engineering health, Delivery (DORA), Wellbeing (survey), Tech debt health, Pipeline
  health, each with its basis ("Excludes … (no data)", "n teams with all 4 DORA inputs", "n of m teams · k responses", "n open of m
  items", "n of m runs passed, 30 days").
- **Company averages** of coverage, automation, flakiness and escape rate against the company targets in force today.
- **Teams vs KPI targets**: the on track / at risk / off track counts; clicking opens a breakdown per team (QA score, as-of date, the
  targets not met with their gap, the ones met, and "based on n of 4 inputs") ([`KpiStatusModal.tsx`](../src/components/KpiStatusModal.tsx)).
- **Team performance**: the latest snapshot of every team as cards or a list. Filters All / High performing / Needs attention, search,
  department, sort (QA score, name, department, coverage, automation, flakiness, escape rate, deploys per week), **Grid / List** and
  **cards per row 1, 2 or 3** (remembered in the browser; phones always 1 column, tablets at most 2). Card colour is the QA status;
  grey means no data.
- **Views** (saved views), **CSV export** of the team list, the **onboarding checklist** (super admins of a new organisation) and the
  **Executive briefing** button.

### Notifications (bell and page)

Why: problems should reach the people who can act, without them watching the dashboard. The **bell** in the top bar shows the unread
count and latest items (mark read, acknowledge); the **Notifications** page has three tabs: alerts of your scope, your inbox and your
preferences (section 7).

### Team detail

Why: everything about one team in one place, with each number explained
([`src/components/TeamDetailView.tsx`](../src/components/TeamDetailView.tsx)).

- Header tiles: QA score (with confidence), technical debt score, task sizing accuracy and key KPIs.
- KPI sections Quality & testing, Speed & efficiency, Agile & process, Reliability & stability: each KPI with value, target valid at
  its date, status, "source · as of date", stale marker and history chart.
- Wellbeing (survey) result with its response rate and a link to the pulse survey; for the lead, managers and admins the **Send the
  survey** panel (send, remind, sent N of M, automatic sending); Team members with their latest workload metrics (only for people who may see
  the team's people, and with metrics only for those who opted in to developer insights); AI insights (the earlier rule-based or AI
  strengths / areas to improve, for leads, managers and admins); Developer recommendations.
- **Forecast** (v2 phase 4): every KPI tile and the QA score card have a "Forecast:" line (for example "Misses target ≥ 80% around
  18 Dec", "Reaches target ≤ 10 min around 3 Jan", "On track: stays ≥ 80% (about 86% by 15 Jan)", "Stays off target ≥ 80%: about 49%
  by 15 Jan", or "not enough data (the reason)"), and the trend charts continue with the projection as a dashed line, an 80 % band,
  the target and a mark on the crossing day. Method: Theil–Sen trend through the weekly medians of the last 26 weeks, the band from
  how far the weeks lie from the line, 8 weeks ahead; the crossing uses the target valid on each future day (so a target already
  set to rise is taken into account). No forecast with fewer than 6 weeks of values, a history under 5 weeks, a latest value older
  than 21 days or a series too noisy to project: the line says which.
- **Recommendations** (above the Action plan; everyone who sees the team's trends reads them, its leads, the department's managers
  and admins act on them): what to do next, ranked by expected effect, at most 6. Each has a title with the numbers it is based on,
  a confidence (High when the evidence comes from CI data and the forecast is confident), the **expected effect** on one metric as a
  range with what it is based on (the evidence, e.g. "raising these 5 files to 80% adds about 11 points", or the team's own best
  level of the last 26 weeks; half-way at the low end), a concrete **next step**, and **Evidence** (the numbers, and when the team
  sends raw data the flaky tests with their failed runs, the files with the most uncovered lines, the stage that grew, the longest
  incidents, the services with failed deploys). Rules: flaky tests, coverage gap, build-time regression, defect escape rising while
  coverage falls, sizing drift with carryover, low wellbeing with high blocked time, MTTR rising, a failing stage, high-severity
  technical debt, the slowest tests, change failures, availability. A rule fires only when its metric is off target or forecast to
  miss it, and not when the forecast says it reaches the target anyway. The top 3 are open, the rest under **More
  recommendations**, accepted and dismissed ones under **Added to the Action plan or dismissed**. **Add to Action plan** creates the
  tracked action in one click (title, next step and expected effect in its description, linked to the metric, baseline = the value
  now); **Dismiss** asks for a reason (shown with who and when; **Reopen** brings it back); **Recalculate** recalculates now
  (otherwise about once a day and whenever the page finds them out of date). A decided recommendation keeps the evidence it had.
- **Action plan**: the team's tracked actions with owner, due date, status, linked KPI, baseline and computed outcome; **Create action**
  from a recommendation (section 7). An action from a recommendation says so and shows whether its metric moved: "Since it was added:
  Test coverage 57.6% (6 Nov) → 63% (20 Nov) Improved" (the team's snapshot on the day it was created and its latest snapshot). Grouped by status in accordions with counts (Open, In progress, Done, Dropped; Done and Dropped
  collapsed by default), 5 / 10 / 20 per page in each group; the whole card can be collapsed. What is expanded is remembered per person
  in the browser. Left of each action: who last set its status and when (section 7, "Who changed the status").
- **Evidence from CI** (when the team's CI sends raw reports, section 4.2a): the metrics calculated from CI data (each opens
  **How this was calculated**: the formula, the values used, the number of runs and confidence, and the source runs and reports
  with their ids and links), **flaky tests** with the failed and passed runs that prove them, the **lowest-coverage files** of the
  latest report, the **slowest tests** (median, last 7 days) and the **failing pipeline stages** (last 30 days, with the latest
  failing runs). A KPI card whose metric was calculated from CI data has a **How this was calculated** link too. Without CI data
  the section says so (and points super admins to Connect your CI).
- **Deliveries & incidents** in the same Evidence section (section 4.2b): the DORA tiles (deployment frequency, lead time, change
  failure rate, MTTR, availability, MTBF, incidents per deploy, infrastructure failures; each opens How this was calculated with
  the deploys or incidents it counted), the **recent production deploys** (commit count, lead time, result), the **failed
  changes** with what made them failed (rolled back, the hotfix that followed and how much later, the linked incident) and the
  **incidents** with severity, outage, duration (or open for) and the linked deploy. The KPI cards of these metrics offer How this
  was calculated too. Without deployments or incidents the part says so.
- **Work & code quality** in the same Evidence section (section 4.2c): tiles for defect escape rate, defect density, velocity,
  commitment, carryover, blocked time and sizing accuracy (each opens How this was calculated with the sprint and the issues it
  counted, and their part: completed, not completed, added after the start, found in production, blocked hours, estimate and
  logged time), the **last closed sprints** (committed, completed, commitment, carryover, blocked, sizing), the **escaped defects**
  of the last 28 days with where they were found, the latest sprint's **blocked and carried-over** issues and its issues
  furthest from their **estimate**; then the **code quality** tiles (score, findings, new, fixed), the score history, the latest
  report per repository and tool with findings by severity, **findings by rule** and the **new** and **fixed** findings. The KPI
  cards of these metrics offer How this was calculated too. Without issues or reports the part is not shown.
- **Open TV mode** and, for super admins, the **Show formulas & data sources** switch (formula mode) that opens the metric explanation
  for any value.
- Team detail opens for the teams of the analytics scope only (as the overview list, TV mode and Compare); another team answers 403.
- QA score card: the 3D battery (horizontal, gently moving liquid, still with reduced motion), the score with its status and
  target, the change against 30 days earlier, a 30 / 90 day trend with the target line, the rank among the teams the viewer
  may see (two or more), the input that costs the score most, the people per role, the Scrum Master (team lead) and
  Product Owner (job title).

### Team TV mode

Why: a wall or meeting-room screen that keeps the teams' quality visible, readable across the room, with no one touching it once
started (`/tv?team=<id>`, [`TeamTvView.tsx`](../src/components/TeamTvView.tsx), `GET /api/tv/teams/:id`).

- Team name, department, lead, member count; QA score (battery or gauge) with status and change since the previous snapshot; "data as
  of" and a clock, always on screen.
- QA score layout: the battery is scaled to the height of the hero row, with the large score, status and details beside it. The gauge is
  wider than tall, so beside the text it would be either tiny or squeeze the text out of the panel; it sits between the title (with the
  status pill) and the details instead, sized from its own layout to the largest that fits, needle included (`fitGaugeWidth` in
  `src/lib/gaugeGeometry.ts`), centred, and drawn at that size (no CSS scaling), so it stays sharp on 4K. Its centre shows the score.
- Four panels: **Key KPIs** (test coverage, automation coverage, test flakiness, defect escape rate, change failure rate, deployments
  with value, target, status, change and a 90-day sparkline), **Trends** (90 days with the target line of each day), **Alerts & actions**
  (the team's open alerts by severity, or the KPIs off target when none is open; the tracked actions without owner names, or the
  recommended actions for team leads and above) and **Wellbeing** (the anonymous pulse's latest closed period: score 0–100 with its
  band, the five answers, the trend; "Not shown" below 3 responses; never comments).
- Rotation: every N seconds to the next chosen panel, then to the next chosen team of the scope (Team 2 of 5); the next team is loaded
  ahead (no loading screen), a thin bar at the top shows the time left. **Set up the screen** (S): interval (10 s to 5 min), panels, teams
  (this team, every team in scope, or a list), theme, rotation; **Copy screen link** gives the kiosk address with all of it.
- Team aggregates only: no member list, no individual data. Refreshes every 60 s, on the live "metrics updated" event and when the tab
  becomes visible; a lost connection keeps the last data, says "Connection lost", retries every 15 s and recovers on its own.
- Keys: F full screen, T theme (Light, Dark, Graphite, Porcelain), R auto-rotate, S set up, arrows or 1–4 to switch panels, Esc exit.
  The cursor and the controls hide after 4 s; the screen is kept awake where the browser allows it. Kiosk URL options
  `?team=<id>&theme=light|dark|graphite|porcelain&rotate=1&interval=<s>&panels=kpis,trends,focus,pulse&teams=all|<ids>`. Scales from
  1366×768 to 3840×2160 (4K: everything twice the size of 1080p).

### Executive summary

Why: a manager or executive reads the state of quality on a phone in one minute, before a meeting or between two
(`/summary`, [`ExecutiveSummary.tsx`](../src/components/ExecutiveSummary.tsx), `GET /api/summary`: one call).

- The scope's QA score (Battery / Gauge), status, target and change since last week; teams on track / at risk / off track.
- The 3 biggest risks (teams with the QA score or a tracked KPI off target, lowest QA score first, each item with value, target and
  weekly change, and "At this rate …" from the team's forecast of that metric) and the 3 most improved teams (biggest QA score rise).
- **At this rate**: KPIs (QA score, coverage, automation, flakiness, defect escape) that are on target now but forecast to miss it
  within 8 weeks, soonest first ("At this rate test coverage misses its target ≥ 80% around 18 Dec"); shown only when there are any.
- Money at risk (super admins and managers): the Business impact revenue roll-up as a range per month and per year, the cost of delay of
  open debt, how it is estimated and a link to the assumptions and team figures (Business impact → All teams).
- Open alerts (as the Alerts page) and since last week: QA change, teams up / down, status changes, alerts opened / resolved, tracked
  actions done / new / overdue.
- Phone first: one column at 390 px, no sideways scrolling, tap targets of at least 44 px; two and three columns on a desktop.
- Works offline-ish: the last summary stays on screen with the time it was loaded and reloads when the network is back.
- Share link: `/summary`; whoever opens it signs in and sees the summary of their own scope. Navigation: super admins and managers;
  every role with a team in scope may open the link (their teams only).

### Compare teams

Why: side-by-side evidence for coaching and resourcing decisions (`/compare`, [`server/lib/compare.ts`](../server/lib/compare.ts)).

- Two to four teams of your analytics scope; window 7 to 90 days (default 30).
- Offered only to people with two or more teams to compare: super admins, managers (department scope) and anyone assigned to 2+ teams
  ([`canCompareTeams`](../src/lib/viewAccess.ts)). Someone on a single team (typically a software engineer, viewer or team lead of one team)
  does not see it in the navigation or in "What you can do here", and `/compare` opens the overview with "You don't have access to Compare teams."
- Per metric (QA score, technical debt score and every KPI with a target): latest value, target valid at its date, status, change over the
  window with a sparkline, stale values greyed (not judged, not compared), sample-data markers; QA score with "based on n of 4 inputs".
- Best value marked per row. A row is **highlighted** when the teams are in different status bands, or the gap between the best and worst
  current value is at least 10 % of the target; "Only rows that differ" filters to those.
- Selection lives in the URL (`?teams=…&days=…&diff=1`); server-built CSV (`GET /api/compare/teams.csv`).

### Saved views

Why: leaders return to the same slices every week. A saved view stores choices, never data: dashboard filter, search, department, sort,
layout and cards per row; an analytics module's department and team; compared teams, window and "only differences". Per user; a super
admin can share views with the whole company (read-only for others) and stop sharing any shared view. Teams outside the viewer's scope are
left out when a view is applied ([`server/lib/savedViews.ts`](../server/lib/savedViews.ts)).

### CSV export

On the dashboard team list, Compare teams, Users, Teams, Departments, Activity, Ingestion log and the analytics modules. Values exactly as
shown plus a "(raw)" column with the unrounded number; filters and sort as on screen; UTF-8 with BOM; cells that could be read as
spreadsheet formulas are neutralised. Exports contain only what the screen received (same scope and privacy rules), never developer e-mail
addresses ([`src/lib/csv.ts`](../src/lib/csv.ts)).

### Onboarding checklist

Why: a new organisation should reach its first useful dashboard quickly. Shown to super admins while any step is open: create departments,
add teams, invite people (someone besides the administrators, or an open / accepted invitation), set KPI targets (a target set by a person;
built-in defaults do not count), send the first data (an accepted ingestion request or a non-sample stored value). Progress is computed from
the real state on each load; the card can be hidden and shown again ([`server/lib/onboarding.ts`](../server/lib/onboarding.ts)).

### Analytics modules

All roles can open them, each for the teams in their analytics scope, chosen in the **Analytics scope bar** (department and team; with
**Open TV mode** and saved views).

| Module | What it shows | Why it exists |
|---|---|---|
| Flaky tests | Flaky tests with pattern, recent runs, root cause and fix (section 3.12) | Flakiness wastes time and hides real failures |
| Test execution | Suite run history, execution flow | See whether test runs are getting slower or less stable |
| Technical debt | Debt items with severity, status, effort, cost of delay, ROI, payback; effort-vs-cost chart (section 3.5) | Make the business case for paying debt down |
| Performance | Response times per endpoint, SLA breaches (section 3.12) | Catch performance regressions before customers do |
| CI/CD pipeline | Stage flow, average duration and success rate per stage, bottleneck score, stage executions over 14 days (section 3.7) | Find the stage that slows delivery |
| Developer productivity | Team tiles (k-anonymous), DDPS by developer, recorded DDPS snapshots, developer list and recommendations (section 3.10) | Spot overload and slow review loops; fix the environment, not the person |
| Wellbeing pulse | Answer the survey; results of closed periods with response rate and trend; for the lead, managers and admins **Send survey to the team**, **Send reminder to those who haven't answered**, the send log and, for managers, how often it goes out and whether automatically (sections 3.11 and 6) | Ask the team directly how it is doing, and make sure everyone is asked |
| Business impact | **Money** first: where the money is going now, what you gain when issues are fixed, where to put the money first; **What-if**; **Details** (revenue per metric, monthly trends, correlation matrix, rule-based or AI summary); **How this works** on every tab; **All teams** roll-up for super admins and managers (section 3.13) | Say in money what quality problems cost and what fixing them is worth, with honest statistics |
| Team rankings | Department teams ranked by a chosen KPI (section 3.14) | Friendly comparison inside a department |
| Reports | A PDF report for the selected team: QA score with confidence and 14 KPIs (coverage, automation, escape rate, defect density, change failure rate, flakiness, code quality, deployments, lead time, MTTR, build time, first-time pass rate, commitment rate, availability) | A shareable snapshot for reviews and steering meetings |

### Developer productivity and individual data

Software engineers and viewers see only their own row. Team leads, managers and super admins see the rows of developers in their scope who
opted in to developer insights (off by default; an unset value counts as off). Team tiles come from the k-anonymous team summary. Only your own row is exported when you may not see others.

### Administration

| Page | Who | What |
|---|---|---|
| Admin console | super admin, manager | Organisation structure, team members, create users / teams; **API keys**, **Connect your CI** (copy-paste steps for GitHub Actions, GitLab CI, Jenkins and Azure DevOps with the endpoint and team id filled in, a **Send test call** check that validates a pasted key, the team and a sample report, deployment or incident without storing anything, the **last data received** per team and kind, each team's main branch, and **Deployments and incidents**: steps per CI tool that send the deploy and its commits, PagerDuty / Opsgenie / JSON steps for incidents, and the **service → team mapping**) and **Sample data** (super admin) |
| Manual metrics | super admin, manager, team lead | Section 4.3 |
| Update frequency | super admin, manager | Expected interval per metric (staleness) |
| Parameters | super admin, manager | **KPI targets** (with history), **Alert rules**, **Notification channels** (Slack, test digest, evaluate now; super admin), **Performance SLA** (p95 response time, error-rate threshold), **Financial and ROI settings**; each field says which page reads it |
| Ingestion log | super admin, manager (their departments) | Section 4.4 |
| Activity | super admin, manager (their departments) | Change history with filters and undo (section 2) |
| Users, Teams, Departments | see section 2 | Assignments (chips), invitations, team lead / manager changes, team moves |

### Executive AI briefing

**Executive briefing** on the dashboard (super admin, manager, team lead): a side panel with a short executive summary (biggest risk,
biggest win) and three recommendations, written by a language model (Groq) from the same numbers as the company summary and the company
snapshots of the last 30 days. It is told that "no data" means not measured. Requires `GROQ_API_KEY`; without it the panel says so. Opening
it also stores today's company snapshot in `company_kpi_snapshots`. Team recommendations and the business-impact summary use the same AI
service when enabled; their rule-based fallbacks always work.

---

## 6. Privacy and wellbeing

### The k-anonymity rule

Defined once in [`server/lib/privacy.ts`](../server/lib/privacy.ts):

> An aggregate of individual data is shown only when at least **3** people contribute. Otherwise the API returns no value (null) with
> `privacy: { suppressed: true, contributors: null, reason: "Not shown: fewer than 3 contributors" }` and does not reveal how many people
> there were. Zero contributors is plain "no data".

**Who contributes** to developer aggregates: active software engineers and team leads assigned to the team, who opted in to developer insights
(`users.developer_insights_enabled`, off by default) and have all five inputs recorded. Someone who has not opted in is left out of every
aggregate, including the ones they can see themselves.

**Where it applies:**

- Team summary of `GET /api/analytics/developer-metrics` (team averages, DDPS, workload balance, burnout counts; the Developer productivity
  tiles).
- `GET /api/analytics/ddps-history`: team statistics and every daily point (a day with fewer developers is not shown).
- `GET /api/metrics/team/:teamId/all`: developer averages, workload balance, team burnout risk.
- The status counts of `GET /api/teams/:id/developer-ai-suggestions`.
- The company summary: workload balance and burnout of the averages use only teams that reach 3 themselves, so a suppressed team can never be
  worked out by subtracting visible teams from the total.
- Pulse survey results and comments (at least 3 responses per period).

Individual rows follow the role rules of section 2 (own row for software engineers and viewers; leads, managers and admins see people who opted in).

### Survey anonymity design

- Answers are stored in `pulse_responses` **without user id or time**, only team and period.
- **Your answers are anonymous. Your manager can see whether you have responded, not what you answered.** The survey screen and the
  survey e-mail say this.
- Who answered which period is stored separately in `pulse_participation` (team, person, period; no time). It is used to refuse a second
  answer (409), to remind members who have not answered, and, after the escalation delay, to tell the team lead or managers who has not
  answered yet. It cannot be matched to an answer: each new answer rewrites the period's whole answer set in random order with fresh ids
  in one transaction, so ids, row order and transaction ids reveal nothing; `pulse_responses` has no user id and no time. No audit entry
  and no user activity row is written for an answer.
- Results: only **closed** periods (never the running one, so results never move after one person answers), only aggregates, only with at
  least 3 responses. Comments follow the same rule, are sorted alphabetically, and are shown to leads, managers and admins only. Members see
  their team's averages.
- Answering through an e-mailed personal link stores the answer exactly the same way (no user id, participation recorded separately).
- Tables have row level security switched on with no policies (migrations
  [`20261121200000_privacy_pulse_survey.sql`](../supabase/migrations/20261121200000_privacy_pulse_survey.sql) and
  [`20261122200000_pulse_cadence_sending.sql`](../supabase/migrations/20261122200000_pulse_cadence_sending.sql)), so they are reachable
  only through the API.

### How often the survey goes out (managers decide)

The cadence is **team-wide** and set by the **department's managers and super admins** (team leads see it but cannot change it), on the
Wellbeing pulse page. Four options ([`server/lib/pulseRules.ts`](../server/lib/pulseRules.ts) `periodFor`):

| Cadence | Periods |
|---|---|
| Every week | 7 days, counted from the day the cadence starts |
| Every two weeks (default) | 14 days, counted from the day the cadence starts (teams never set: from Monday 2026-01-05) |
| Every month | Calendar months (28–31 days; February 29 in leap years) |
| Every three months | Calendar quarters: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec (90–92 days) |

A change takes effect **when the running period ends**, so a period is never cut short; asking for the cadence in force again cancels a
waiting change. When monthly or quarterly starts in the middle of a month / quarter, the first period runs to its end, or, if that would be
fewer than 7 days, to the end of the following one. Every change is in Activity.

### Sending the survey

- **Send survey to the team** (Wellbeing pulse page and Team detail → Wellbeing (survey); the team lead, the department's managers and
  super admins): every active member assigned to the team who has not been sent it yet gets an e-mail with a **personal link** for the
  running period. Only the sha256 of the link's token is stored. The link is bound to that person, team and period, works **once**
  (answering through it or in the app uses it up) and **expires when the period ends**. It authenticates only that one answer: it gives no
  session and no other access, and it stops working if the person leaves the team.
- The panel shows "Sent to N of M members on <date>", the members **not sent it yet** (sending says nothing about answering), the answers
  so far **as a count only, from 3 on**, and a log of sends.
- **Send reminder to those who haven't answered** e-mails the members without an answer (worked out on the server from the participation
  list). Only a count comes back, and not even that when it would reveal that 1 or 2 people answered. One reminder per 24 hours.
- **Personal links are never shown to anyone in the app** (a manager holding one could answer as someone else). Without SMTP configured
  the survey is not e-mailed: the panel says so and points members to answering in the app.
- **Automatic sending**: switched on (from the next period) when a manager first sets the cadence; managers and admins can turn it off
  or on per team. An hourly job sends the survey once per team and period, during the first quarter of the period (at least 2 days);
  the database makes a second run send nothing.
- The answer page (`/pulse/answer?token=…`) works signed in or not, shows the team, company, period and questions (no personal data),
  and ends with a thank-you. A used, expired or wrong link says so.
- Activity records cadence changes, sends (manual and automatic), reminders, reminder settings, escalations and automatic-sending
  changes, never answers.

### Members who have not answered: warning, reminders, escalation

Set per team on the Wellbeing pulse page by the **team lead, the department's managers and super admins** (`canSetPulseReminders`),
recorded in Activity. Days count from the day the period's survey went out (no survey sent: nothing happens).

| Setting | Default | What happens |
|---|---|---|
| Warn after | 2 days | A member who has not answered sees a banner across the app: "Your team's wellbeing pulse is waiting — it takes 1 minute. Your answers are anonymous." Only they see it; "Answer now" opens the survey, "Not today" hides it until tomorrow. One line per team |
| E-mail reminders | on, every 3 days | A new personal link to members who have not answered. At most one a day per person, never after the period ends. Logged as an automatic reminder (counts only) |
| Escalate after | 5 days | Once per team and period: the chosen people get a notification (in-app; e-mail when their immediate e-mails are on) with the **names of members who have not answered** and the response rate. Never anything about answers |
| Tell | team lead and department managers | Or only one of them. When nobody holds the chosen role, the company's super admins are told instead, and the page says so |

The escalation must land before the period ends and the warning before the escalation, so short periods shorten the delays (a weekly
period keeps the defaults; an escalation of 10 days becomes 6). The page shows the values for this period. After the escalation the
people it went to see the list on the team's pulse page. The list is a **once-a-day snapshot** (taken at the escalation, then by the
hourly pulse job on its first run of each UTC day; looking at it changes nothing), so a member who answers drops off it the next day and
the list never shows when someone answered.

This changes the earlier rule that nobody sees **who** answered: managers now see who has **not** responded. What anyone answered stays
anonymous, and the result threshold (at least 3 responses) is unchanged. Code: [`server/lib/pulseSend.ts`](../server/lib/pulseSend.ts)
(`runPulseReminders`, hourly with the automatic send), [`server/lib/pulseRules.ts`](../server/lib/pulseRules.ts) (`effectiveReminderSettings`).

### Residual risks (by design, documented)

- With k = 3, a person who answered a 3-response period knows their own answers and therefore the sum of the other two.
- Database superusers could read dead row versions before vacuum; the API never exposes rows.
- The send tables know who was e-mailed and reminded (a reminder goes to people who had not answered yet). After the escalation, the
  people told see who has not answered yet, as a once-a-day snapshot, so they can tell at most on which day someone answered (never what).
  The live response count (shown only from 3 responses) says that someone answered, not who.
  Before the escalation the API returns only counts under the same threshold.
- A personal link works for whoever holds it (as with any e-mailed link): it is single-use, period-bound and says not to forward it.
- Developer metrics individual rows are visible to leads, managers and admins only for people who opted in; the choice is per person
  (users page toggle, off by default).

---

## 7. Alerts, notifications, weekly digest and tracked actions

Code: [`server/lib/alerts.ts`](../server/lib/alerts.ts), [`alertPolicy.ts`](../server/lib/alertPolicy.ts),
[`notifications.ts`](../server/lib/notifications.ts), [`digest.ts`](../server/lib/digest.ts), [`actions.ts`](../server/lib/actions.ts),
[`server/jobs/alertsCron.ts`](../server/jobs/alertsCron.ts), `netlify/functions/`. Migration:
[`20261121000000_alerts_digest_actions.sql`](../supabase/migrations/20261121000000_alerts_digest_actions.sql) (new tables `alert_rules`, `alerts`,
`notifications`, `notification_preferences`, `company_notification_settings`, `notification_deliveries`, `team_actions`; nothing existing is
changed).

**Why:** a dashboard only helps when someone looks at it. Alerts and the digest bring problems to the right people, and tracked actions close
the loop by checking, from stored data, whether an action actually moved the metric.

### Alert rules

Set in **Administration → Parameters → Alert rules** (`GET/PUT /api/alerts/rules`). Team settings override department settings, which override
company settings, which override the defaults. Company rules: super admins; department and team rules: super admins and that department's QA
managers (managers can read them).

| Rule | Fires when | Severity | Defaults |
|---|---|---|---|
| KPI off target (`threshold_breach`) | a current, non-stale KPI value is at watch or off target against the target valid at its date (as on Team detail) | warning (watch) or critical (off target) | on, alert from warning |
| Metric stale (`metric_stale`) | one or more KPIs are older than their expected update interval; one alert per team listing them | info | on |
| QA score drop (`score_drop`) | the QA score (stale inputs left out) fell by at least N points within D days | warning; critical at twice the drop | on, N = 10 points, D = 7 days |
| Ingestion failures (`ingestion_failure`) | at least C rejected or partial ingestion requests in the last H hours, per team named in them (company-level when none) | warning | on, C = 1, H = 24 |

**Evaluation:** after every KPI write (Manual metrics, ingestion API, generators) and every hour (local `server/jobs/alertsCron.ts`, default
`15 * * * *`; Netlify Scheduled Function `netlify/functions/alerts-evaluate.ts`); super admins also have **Evaluate alerts now**. Exactly one open
alert per condition: refreshed while the condition holds, resolved when it is gone. Team leads, the department's managers and super admins can
**acknowledge** an alert (recorded in Activity).

### Notifications

- **Bell** in the top bar (unread count, latest, mark read, acknowledge) and a **Notifications** page (`/notifications`: alerts of your scope,
  inbox, preferences).
- People assigned to a team, and its department's managers, are told about its alerts at the severity they chose; company-wide roles about
  critical team alerts only.
- **Preferences** per person: in-app on/off, an e-mail for each alert, the weekly digest (super admins, managers, team leads), minimum
  severity. Defaults: in-app on, no immediate e-mail, digest on for leads and above, from warning.
- E-mail goes through the one mailer (Resend or SMTP when configured, otherwise written to the server log). Every e-mail and Slack message goes through
  an outbox (`notification_deliveries`) with a dedupe key and up to 3 attempts.

### Slack

Super admins, **Parameters → Notification channels**: one incoming webhook per company (must be a `https://hooks.slack.com/…` URL), posting alerts
from a chosen severity and optionally a weekly summary. Stored AES-256-GCM encrypted with a key derived from `SETTINGS_ENCRYPTION_KEY` (else
`JWT_SECRET`; if that key changes the webhook must be entered again). Only a masked hint is ever returned; the URL never appears in logs, the
change history or the delivery log. **Send test message** checks it.

### Weekly digest

Mondays 07:00 UTC (`netlify/functions/weekly-digest.ts`, `0 7 * * 1`; locally `DIGEST_CRON`). Per recipient, for the teams in their scope: QA
score now vs 7 days earlier (with "based on n of m inputs"), alerts opened and still open, stale metrics, actions overdue / due in the next 7 days
/ completed with their outcome. At most one per person per ISO week. **Send test digest** (Notifications → Preferences; Parameters for super
admins) sends yours immediately.

### Tracked actions

**Team detail → Action plan**, TV focus panel and the digest (`/api/actions`):

- Created by team leads, the department's managers and super admins, by hand or with **Create action** on a recommendation.
- Owner (someone who has the team in scope), due date, status (open, in progress, done, dropped), optionally a linked KPI. The owner may change
  the status.
- **Baseline:** the latest stored value of the linked KPI when the action is created.
- **Outcome (computed, never typed in):** the stored value at completion, and the latest value recorded up to 14 and 30 days after completion,
  compared with the baseline. **Improved** or **worse** when it moved by more than 2 % of the baseline (at least 0.01) in the KPI's direction,
  otherwise **unchanged**; "no new data" when nothing was recorded in that window.
- TV mode shows the actions without owner names.
- On Team detail the list is grouped by status (Open, In progress, Done, Dropped, each with its count) and paged per group; an action
  whose status changes moves to its new group.
- **Who changed the status:** every status change, and the creation, is recorded with the signed-in person and the time (UTC), in the
  same transaction as the change: by hand, by the owner, or by accepting a recommendation (which creates the action). A change made by
  the system is recorded without a person and shown as "automatically". On Team detail, left of each action (above the title on a
  phone): "Changed to Dropped by Aisha Rahman on 20th Nov 2026, 10:11 PM" (status word in its colour, the person's name, ordinal day,
  short month, year and 12-hour time in the viewer's time zone), "Created by … on …" when the status never changed; nothing for older
  actions whose history is unknown. **History** lists every change (from → to, who, when), newest first. Only people who can see the
  team's actions see it, with names only (no e-mail addresses). TV mode does not show it (a shared screen shows no names).
- **Existing actions (migration):** the history is filled only where it is known, from the change history (Activity); otherwise only
  the time is set (completion time of done / dropped actions, else the last update) and no person is shown. Sample data (demo and
  Meridian) gets a realistic history: people allowed to change actions, on weekdays in working hours.

### Database keep-alive

`netlify/functions/db-keepalive.ts` runs `SELECT 1` at 06:00 and 18:00 UTC (`0 6,18 * * *`), logging only ok / failed, so a hosted database on a
plan that pauses idle projects stays available. It also deletes `server_errors` older than 30 days,
`user_activity` and `job_runs` older than 90 days, sign-in events and sessions older than 180 days, and Exporter
deliveries older than 13 months (their sanitised preview is cleared after 30 days), and trims the raw store after 13 months
(`cleanupRawData`: nothing younger than 396 days is deleted; KPI values and snapshots are never deleted). Every scheduled job records its runs in `job_runs`
(shown in the platform support panel).

### Nightly demo refresh

Sample history stops on the day it was seeded, so without a refresh a hosted demo looks a day older every day. `netlify/functions/demo-refresh.ts`
runs at 02:17 UTC and starts `demo-refresh-background.ts`, which adds the missing recent days of sample data, exactly as
`npm run seed:demo -- --refresh-dates`: only the demo company and teams that already hold sample rows, never a change or deletion, never real
data, nothing on a second run the same day. A scheduled function may only run for 30 seconds, so the work runs in a background function (up to
15 minutes); the call carries an HMAC of `DEMO_REFRESH_SECRET` (falling back to `JWT_SECRET`) and anything else is ignored. It logs counts only.
`DEMO_REFRESH_ENABLED=false` turns it off. The platform support panel's **Refresh sample data now** starts the same
background function on demand (recorded in `job_runs` as a manual `demo-refresh`).

### Configuration

`SETTINGS_ENCRYPTION_KEY` (recommended in production: a long random string), `ALERTS_CRON=false` (turn the local schedule off, for example on a
second instance), `ALERTS_EVALUATE_CRON` and `DIGEST_CRON` (local schedules, UTC), `NOTIFY_SLACK_ALLOW_LOCAL=true` (tests only; ignored in
production). The Slack webhook itself is entered in the app, not in the environment. On Netlify the three scheduled functions need no further
setup.

---

## 8. Configuration and operations

### Environment variables

Only names and purposes are listed here. Never commit real values; `.env` is git-ignored and `.env.example` is the template. Variables prefixed
`VITE_` are bundled into browser JavaScript and must never hold secrets.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string (SSL disabled automatically for localhost). Alternatively `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| `DB_POOL_MAX` | no | Connections per server / function instance (default 10, or 3 on Netlify) |
| `JWT_SECRET` | yes | Signs session tokens. Also the fallback key for encrypting the Slack webhook when `SETTINGS_ENCRYPTION_KEY` is not set |
| `PORT` | no | API port (default 3000) |
| `FRONTEND_URL` | no | Allowed browser origin(s) for CORS |
| `ENABLE_SYNTHETIC_DATA` | no | `true` enables the sample-data generators and the in-app "Load sample data". Off by default |
| `DEMO_MODE` | no | `true` shows demo account chips on the login page. Default on locally, off in production / on Netlify |
| `GROQ_API_KEY` | no | Enables AI text: executive briefing, team and developer recommendation text, business-impact summary. Without it the rule-based versions are used |
| `APP_URL` | for invitations, SSO, e-mail and Slack links | Public URL of the app (invitation links, SSO redirect and return, links in alert e-mails, digest and Slack). On Netlify defaults to `URL` |
| `API_PUBLIC_URL` | no | Only when the API has its own origin (local development) |
| `INVITE_TTL_HOURS` | no | Invitation lifetime, default 168 (1 to 720) |
| `RESEND_API_KEY`, `MAIL_FROM` | no | Outgoing e-mail through Resend (preferred). `MAIL_FROM` is the sender, e.g. `IronGate QE Navigator <no-reply@qe.example.com>`, on a domain verified in Resend; without it Resend's test sender is used, which only reaches the Resend account's own address |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | no | Outgoing e-mail through SMTP, used when `RESEND_API_KEY` is not set (invitations, password resets, alert e-mails, weekly digest, wellbeing pulse survey). Without Resend or SMTP nothing is sent: messages are logged, invitation links are shown to copy, and the pulse survey is answered in the app (its personal links are never shown) |
| `PULSE_CRON`, `PULSE_SEND_CRON` | no | `false` turns the local automatic pulse-survey e-mail off; its schedule in UTC (default `40 * * * *`, hourly). On Netlify the scheduled function `pulse-auto-send` does the same |
| `MAIL_CAPTURE_FILE` | tests only | The log mailer also writes each message as a JSON line to this file (end-to-end tests follow survey links); ignored in production |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Google sign-in (redirect URI `<APP_URL>/api/auth/sso/google/callback`) |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` | no | Microsoft sign-in (redirect URI `<APP_URL>/api/auth/sso/microsoft/callback`; a single tenant is recommended) |
| `GOOGLE_OIDC_DISCOVERY_URL`, `MS_OIDC_DISCOVERY_URL` | no | Override the OpenID discovery documents (testing) |
| `API_RATE_LIMIT_MAX` | no | General API rate limit per minute and client address (default 300); raise it for local end-to-end runs. Every per-address limit counts by the real client address (on Netlify its own client address header), so a forged `X-Forwarded-For` does not reset it |
| `VITE_DISABLE_WEBSOCKET` | no | Front-end switch to turn the live-update socket off |
| `SETTINGS_ENCRYPTION_KEY` | recommended in production | Key for encrypting the Slack webhook (a long random string); without it a key is derived from `JWT_SECRET` |
| `ALERTS_CRON` | no | `false` turns the local alert / digest schedule off (for example on a second instance) |
| `ALERTS_EVALUATE_CRON`, `DIGEST_CRON` | no | Local schedules in UTC (defaults `15 * * * *` hourly and `0 7 * * 1` Monday 07:00) |
| `NOTIFY_SLACK_ALLOW_LOCAL` | tests only | Accepts a local `http://127.0.0.1:<port>/` webhook; ignored in production |
| `PLATFORM_OPERATOR_ALLOWED_IPS` | no | Optional comma-separated client IPs allowed to use the platform support panel |
| `LOG_CLEANUP_CRON` | no | Long-running server: retention of `server_errors` (30 days), `user_activity` and `job_runs` (90 days), sign-in events and sessions (180 days), Exporter deliveries (13 months, preview 30 days) and the raw store (13 months); default `7 3 * * *`, `off` turns it off. On Netlify `db-keepalive` does it |

The Slack webhook is entered in **Parameters → Notification channels**, not in the environment.

### Deployment

- A single Node service (Railway: `npm run server:prod` serves the built app from `dist/`), or
- Netlify: static site plus `netlify/functions/api.ts`, which mounts the same routers. On Netlify there are no long-running cron jobs and no
  WebSocket (dashboards refresh on load and on their own timers). Netlify Scheduled Functions replace the local schedule:
  `alerts-evaluate` (hourly, `15 * * * *`), `weekly-digest` (Monday 07:00 UTC), `pulse-auto-send` (hourly, `40 * * * *`), `db-keepalive`
  (06:00 and 18:00 UTC), `calc-recompute` (03:41 UTC) and `demo-refresh` (02:17 UTC, which starts the background function
  `demo-refresh-background`); `demo-data-background` runs the operator's Demo Data jobs. Every function and variable:
  [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).
- On the long-running server, `server/jobs/alertsCron.ts` evaluates alerts hourly (and once 20 s after start), computes due action
  outcomes, sends pending notifications and runs the weekly digest.
- Schema: apply `supabase/migrations/` in timestamp order. Migrations are additive and idempotent.

### Getting started and seed commands

```bash
npm install
cp .env.example .env              # set DATABASE_URL and JWT_SECRET
npm run server                    # API on http://localhost:3000
npm run dev                       # app on http://localhost:5173

npm run seed:demo                 # demo company (local databases only unless --allow-remote)
npm run seed:demo -- --fill-existing
npm run seed:demo:check           # coverage per company, team and module; exit code 1 below 100 %
npm run seed:demo:clear           # remove all demo rows
npm run seed:demo -- --sql out/demo-seed.sql   # SQL files instead of a connection (preferred for hosted databases)
```

Demo sign-ins use the password `demo123` (sample data only).

### Tests and CI

```bash
npx tsc --noEmit -p tsconfig.app.json      # frontend types
npx tsc --noEmit -p tsconfig.server.json   # API types
npm run test:api                           # API tests (API running on :3000)
npm run test:db                            # database tests
npm run test:ui:local                      # Playwright UI suite with its own local test database and servers
```

API suites cover the role matrix, analytics scope, ingestion, targets, audit, invitations, SSO, mailer, privacy and pulse, TV mode, the executive summary, compare /
views / onboarding, security and "golden" outputs (`tests/api/golden.test.ts` fails on any unexpected output change). Database suites check
the schema, the QA score trigger against `computeQaScore` for every stale combination, `metric_values` derivation and the pulse schema.

**CI** (`.github/workflows/ci.yml`, GitHub Actions) runs on every push, pull request and on demand: `quality` (typechecks, ESLint report,
build), `api-and-db` (Postgres 16 prepared like production by `scripts/ci/prepare-db.sh`, demo seed, API and database suites) and `e2e` (the
`@smoke` Playwright subset, HTML report as an artifact). The **UI tests** workflow runs the whole Playwright suite (every user flow per role,
negative cases, accessibility, phone layouts) in four shards on pull requests, `main`, nightly and on demand. Details:
[docs/testing/README.md](testing/README.md); flows and their tests: [docs/testing/E2E_FLOWS.md](testing/E2E_FLOWS.md).

---

## 9. Known limitations and what is next

### Data sources

- **Connectors run on the customer's side.** QE Navigator does not pull from Jenkins, Jira, SonarQube, GitHub, GitLab, Azure DevOps or
  PagerDuty over the internet; the QE Navigator Exporter (section 4.2d) reads them inside the customer's network. TestRail and Datadog
  have no connector; their KPIs are pushed to the ingestion API or entered by hand. The metric catalog lists, per KPI, the exact field or
  API to read in each system.
- **Every module has a raw source.** Pipeline health, the CI/CD pipeline stages and their history, Test execution, Flaky tests, the
  technical-debt items, Performance (load-test result files), automation coverage and ROI (test management records) and the developer
  metrics (pull requests and calendars) are calculated from the raw data teams send (section 4.2a to 4.2f). What stays typed: the business
  figures of Business impact, the financial settings and the targets.
- **Developer metrics have no history from manual entry.** `developer_metrics` holds one current row per developer and team; DDPS history
  (`developer_productivity_snapshots`) is written only by the seed.
- **Company snapshots are stored only when someone opens the executive briefing**, so the briefing's 30-day history depends on usage.
- **Hosted demo data ages** unless it is refreshed: sample history stops at the day it was seeded. `npm run seed:demo -- --refresh-dates`
  adds the missing recent days for sample-data teams only (README, "Keeping hosted demo data current"); on Netlify it runs every night
  (`demo-refresh`, 02:17 UTC); elsewhere the owner runs it against the hosted database.

### Open items from the release plan and README

Resolved in R2 Phase 4 (see [docs/reports/r2-final-review.md](reports/r2-final-review.md)): `/api/metrics/dashboard`,
`/metrics/analytics/*` and Team rankings leave stale values out (rankings colour with each team's target history); analytics without a team id
use the caller's default team in scope; all migrations run on PostgreSQL 16 and 17; Compare teams labels the worst value "Weakest"
(direction-aware).

Still open:

- No CSV on some sub-tables (team-detail members, admin-console members, department team list, report preview); saved views cannot be renamed in
  the UI.
- Formula mode is offered to super admins only (a product decision: it is a demo and audit aid; `canUseFormulaMode`).
- Several older admin screens (Admin console, Users page) still decide some buttons from the display role; the API enforces the shared rules.
- No ingestion API for the monthly business series (revenue, users, churn …): they are entered on the Business impact page; its quality side is
  derived from the KPI values. Business-impact `deployment_frequency` is per month while the KPI is per week.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| Analytics scope | The teams a person may open on the overview, team detail, analytics, compare, TV and member lists: all (super admin), their departments' teams (manager), their assigned teams (others) |
| Assignment | A role on a scope (company, department or team) in `role_assignments`; a person can hold several |
| Automation coverage | Share of test cases that run automatically |
| Carried forward | A snapshot value that was recorded on an earlier day and is still the latest value |
| Change failure rate (CFR) | Share of deployments that cause a failure needing rollback, hotfix or incident |
| Composite | A score built from other values (QA score, engineering health, delivery, company averages) |
| Confidence | Inputs used ÷ inputs expected: high ≥ 90 %, medium ≥ 50 %, else low |
| DDPS | Daily Developer Productivity Score, 0–100, from focus, meetings, context switches, PR and review times |
| Defect escape rate | Share of bugs found in production rather than by the team |
| DORA | The four delivery metrics from the DevOps Research and Assessment programme: deployment frequency, lead time, change failure rate, MTTR |
| Engineering health | Company composite: delivery 35 %, pipeline 25 %, tech debt health 20 %, wellbeing (survey) 20 % |
| Field sources | Per-value provenance in a snapshot: source, recorded at, recorded by, carried forward |
| Formula mode | "Show formulas & data sources": explanation of any metric (formula, thresholds, storage, source, production systems) |
| Idempotency key | A client-chosen key that makes a retried request or item write nothing twice |
| Ingestion log | Record of every write request (API and manual) with its outcome |
| k-anonymity (k = 3) | Aggregates of individual data are shown only when at least 3 people contribute |
| KPI snapshot | One row per team and day holding the latest value of each KPI as of that day (`kpi_snapshots`) |
| KPI targets (headline four) | Coverage ≥ 80 %, automation ≥ 70 %, flakiness ≤ 2 %, escape rate ≤ 5 % by default |
| Metric value | One stored measurement with its time and source (`metric_values`), the raw data behind snapshots |
| MTBF / MTTR | Mean time between failures / mean time to recovery |
| Needs attention (dashboard filter) | QA score below the team's QA target (85 unless set otherwise) |
| On track / at risk / off track | Share of current headline KPI targets met: ≥ 75 %, 50–75 %, < 50 % (needs at least 2) |
| Pulse survey | Five-question anonymous wellbeing survey per team, weekly or every two weeks |
| QA score | Team quality composite of coverage (30 %), 100 − escape rate (25 %), 100 − CFR (25 %), code quality (20 %); good ≥ 85, warning ≥ 70 |
| recordedAt | The time a value is for (not when it was received); allows backfill up to 365 days |
| Sample data | Generated, fictional values marked source `synthetic`; flagged on screen |
| Stale | Older than the metric's expected update interval; shown greyed and left out of composites |
| Target history | Targets with validity periods per company, department or team; values are judged against the target valid on their date |
| Technical debt score / tech debt health | Team: severity-weighted open debt, 0–100, lower is better. Company: 100 minus open weight per team, higher is better |
| Watch | The band between target and warning level (amber) |
| Wellbeing (survey) | (mean answer − 1) ÷ 4 × 100 over a closed survey period with at least 3 responses |
| Workload balance (derived) | 0–100 workload signal from developer metrics, stored as `happiness_score`; not wellbeing |
