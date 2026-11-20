# Administration guide

How to run a company in QE Navigator (people, teams, settings, data) and how IronGate platform support
uses the operator panel. Who may do each thing is in [ROLE_ACCESS.md](ROLE_ACCESS.md); this guide does not
repeat the full matrix.

## Contents

1. [Roles and scope](#1-roles-and-scope)
2. [People: Users page and invitations](#2-people-users-page-and-invitations)
3. [Teams and departments](#3-teams-and-departments)
4. [Admin console](#4-admin-console)
5. [Parameters, targets and update frequency](#5-parameters-targets-and-update-frequency)
6. [Manual metrics](#6-manual-metrics)
7. [Logs: Activity, Ingestion log, User activity](#7-logs-activity-ingestion-log-user-activity)
8. [Platform operator panel (/operator)](#8-platform-operator-panel-operator)

## 1. Roles and scope

| Role (screen name) | Key | Assigned on |
|---|---|---|
| Super admin | `super_admin` | the company |
| Manager | `qa_manager` | a department |
| Team lead | `team_lead` | a team |
| Software engineer | `qa_engineer` | a team |
| Viewer | `viewer` | a team |

A person can hold several role assignments; their access is the union. A team is in a person's scope when
one of their assignments covers it: the whole company for a super admin, the department's teams for a
manager, the team for the team roles. Data never crosses companies. Nobody may change their own role, give
themselves an assignment, or manage someone of their own rank or above.

The rules are in [`server/lib/userPolicy.ts`](../server/lib/userPolicy.ts) and are used by both the API and
the UI. The **Help** button in the top bar shows them for the signed-in person.

## 2. People: Users page and invitations

**Users** (super admins: everyone; managers: people of their departments; team leads: people of the teams
they lead).

- **Invite.** Enter the e-mail, choose the **role** and where it applies (company, department or team).
  The roles offered are those you may give: managers can invite team leads, software engineers and viewers
  to teams of their departments; team leads can invite software engineers and viewers to teams they lead.
  The invitation is e-mailed (Resend, or SMTP; see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)). When e-mail
  is not configured, the page shows the link to send yourself. Invitations expire after `INVITE_TTL_HOURS`
  (default 168 hours) and can be resent or revoked.
- **Edit** a person's name, e-mail, primary team and role assignments.
- **Activate / deactivate**, **reset password** (set one, or send a reset link; either also ends a sign-in
  lockout: 5 wrong passwords in a row lock an account for 15 minutes), **sign out everywhere**,
  and the **developer insights** switch (whether their individual developer metrics may be shown).
- **Passwords you set** (Add with password, Reset password) follow the same rules as everyone else's:
  10 to 128 characters, three of lower case, upper case, number and symbol, and not the part of the
  e-mail before the @. A password that breaks a rule is refused with the reason.
- **Job titles** (super admins). The job title is shown in the top bar next to the person's name.
- **Delete** deactivates the person.

E-mail domain: a company address ties the organisation to its domain, so a second organisation with the
same domain cannot be registered. Public domains (gmail.com, outlook.com and others, listed in
`src/lib/emailDomains.ts`) never block anything. Nobody is added to an organisation because of a shared
domain.

## 3. Teams and departments

- **Teams** (super admins: all; managers: create, edit and delete in their departments; team leads: read
  the directory). Archive and restore a team, set its team lead.
- **Departments** (super admins): create, edit, delete, move teams between departments, assign managers.

## 4. Admin console

- **Organisation structure** (super admins and managers): departments with their teams and people.
- **API keys** (super admins): create a key for the ingestion API. The key (`igk_…`) is shown once; after
  that only its prefix. Revoke a key at any time. Keys work for every `/api/ingest/*` endpoint.
- **Connect your CI** (super admins): copy-paste steps for GitHub Actions, GitLab CI, Jenkins and Azure
  DevOps that send test reports, coverage reports and pipeline runs to the raw endpoints; steps for
  deployments and incidents (PagerDuty, Opsgenie or any tool); a test call (a dry run: key, team and
  endpoint checked, nothing stored); the last data received per team; each team's main branch; and the
  service → team mapping for events without a team. It also has the issue and static-analysis steps.
- **Sample data** (super admins): loads a separate sample company. Only available when the API runs with
  `ENABLE_SYNTHETIC_DATA=true`. Nothing in your company changes.

## 5. Parameters, targets and update frequency

**Parameters** (super admins: company, department and team values; managers: their departments and teams,
company values read-only):

- **KPI targets:** a target and a watch level per metric at company, department or team scope. Each change
  closes the old value and opens a new one, so every value is judged against the target valid at its date.
- **Alert rules:** when a KPI opens an alert, and its severity. "Evaluate alerts now" and the Slack channel
  are for super admins.
- **Financial and ROI settings:** developer hourly rate, support ticket cost, revenue per user, downtime cost
  per minute, SLA penalty. Built-in defaults are labelled "(default)".
- **Pipeline settings** and **Performance SLA** thresholds.
- **Session settings** (super admins): how long a sign-in lasts (default 7 days).
- "Apply to every department and team" copies a company value down (super admins).

**Update frequency** (super admins and managers): how often each metric is expected to arrive. A value
older than its interval is marked stale and not judged.

## 6. Manual metrics

Super admins (any team), managers (their departments) and team leads (teams they lead) can enter team KPI
values, developer metrics and technical-debt ROI inputs by hand. A manual value goes through the same write
path as the ingestion API, with the source `manual`.

**CI/CD pipeline stages** (super admins and managers). The **Pipeline Metrics Configuration** (time and cost
savings %, cost per minute) is one company-wide value: only a super admin can save it; managers see it
read-only. A team's own stages can be edited by a super admin or by a manager of the team's department.
When a team has no stages of its own, the page shows the **company default stages**; only a super admin can
change those (managers see them read-only, the API answers 403). Prefer sending raw data from CI where possible
([INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md)).

## 7. Logs: Activity, Ingestion log, User activity

- **Activity** (super admins: company; managers: their departments): the change history of people, teams,
  targets and settings, with **Undo** where possible.
- **Ingestion log** (super admins: company; managers: their departments): every data import with its source,
  key, items, result and errors.
- **User activity** (super admins): every sign-in, failed sign-in, API request, screen opened, CSV export and
  API-key ingestion request of the company's users, for 90 days. It stores the route pattern, status,
  duration, client IP and browser; never bodies, query strings, headers, cookies, tokens or passwords.
  Answering the wellbeing pulse is not recorded. Filters and CSV export (the export is recorded too).
  Tell your staff about it, for example in your privacy notice.

## 8. Platform operator panel (/operator)

For IronGate platform support only. Operators are separate accounts (table `platform_operators`), never
users of a company.

**Accounts.** Create one with `npm run operator:create -- --email … --name "…"`. The password comes from
`--password`, else `OPERATOR_PASSWORD`, else a prompt; at least 12 characters; stored as a bcrypt hash. The
script writes only to a local database unless `--allow-remote` is given. The panel is off while no active
operator exists.

**Sign-in.** At `/operator`, with its own 8-hour session (httpOnly cookie `irongate_operator`). An operator
account is never locked out, however many wrong passwords; only a rate limit per IP applies
(`OPERATOR_SIGN_IN_MAX` failed attempts per 15 minutes, default 10).
`PLATFORM_OPERATOR_ALLOWED_IPS` optionally restricts the client IPs.

**What it shows.**

- **Overview:** every company with status (active or suspended), users, teams, sessions valid now,
  sign-ins and failed sign-ins of the last 7 days, countries seen, last data, open alerts and errors;
  scheduled job runs; database size and table counts.
- **Sign-ins:** sign-in events of every company, with IP, country, city, browser, OS and device; filters and
  CSV.
- **Error search:** server errors by request id.
- **Per company**, tabs: Organisation, Users (last sign-in with IP, country and device, sessions now, failed
  sign-ins), Sessions, Sign-ins, Last views (latest view of each team and department), Settings & targets,
  Data, Modules, Alerts & actions, Wellbeing pulse, Activity (the company's change history), Access log (the
  company's own user activity log) and Errors. A person's page shows their profile, assignments, teams,
  every sign-in, every session (valid, expired, ended or revoked, with **Revoke**) and recent activity.

**What it changes.** Everything in any company: create a company (first department, team and first person
with a password or an invitation), rename it, its e-mail domain, sign-in length, hide the sample-data
notices, **suspend / reactivate**, delete (type its name); departments, teams, people, role assignments,
passwords and reset links, sign out everywhere, **Clear lockout** (a person locked out after 5 wrong
passwords in a row can sign in again at once: both the failed-attempt count and the lock end), invitations, KPI targets, configuration, update intervals,
alert rules, API keys, saved views and single sessions. Changes the company app also offers run through the
company app's own handler and rules. Destructive actions are confirmed in the page. A password the operator
sets (first person of a new company, a new person, a reset) follows the company password rules; Create
company checks it before anything is created.

**Suspending a company** blocks its people from signing in (after the right password they see that access
is suspended), ends every open session on its next request, refuses its API keys and invitations, and makes
the scheduled jobs skip it. Reactivating lets people sign in again.

**Demo data** (operator only). **Demo Data** creates departments, teams and people with one year of sample
data and one shared password, shown once. **Populate metrics** writes a year of sample data for the
company's teams that have none. One job per company at a time. All rows are sample rows, removable with
"Remove sample data".

**Not logged.** Nothing an operator does is logged: there is no operator activity log and no platform access
log. Operator actions do not appear in the company's Activity or user activity log. Secrets are never shown
(password, key and token hashes, reset links, the Slack webhook, integration credentials).

Code: [`server/routes/operator.ts`](../server/routes/operator.ts), [`server/lib/operator.ts`](../server/lib/operator.ts),
[`src/components/operator/`](../src/components/operator/).
