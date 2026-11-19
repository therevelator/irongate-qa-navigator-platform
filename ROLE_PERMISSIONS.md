# Role permissions

What the server enforces, written from [`server/lib/userPolicy.ts`](server/lib/userPolicy.ts) (release R2).
Every rule there is a pure function used by the API (through `server/middleware/access.ts` and the
routes) and by the UI (`src/App.tsx` routes, `src/components/Layout.tsx` navigation, page buttons), so
the app offers exactly what the API allows. Every rule is also limited to the caller's own company: a
team, user or entry of another company answers like an unknown id (403 or 404, never its data).

## Role assignments

Access comes from **role assignments** (`role_assignments`, loaded on every request by
`server/lib/assignments.ts`, so a change applies on the person's next request). A grant is a role on
a scope; a person may hold several:

| Role (key) | Name on screen | Assigned on | Analytics scope (`canViewTeamAnalytics`) |
|---|---|---|---|
| `super_admin` | Super admin | the company | every team of the company |
| `qa_manager` | Manager (Department manager where it needs saying) | a department (one or more) | the teams of those departments |
| `team_lead` | Team lead | a team (one or more; one lead per team) | those teams |
| `qa_engineer` | Software engineer | a team (one or more) | those teams |
| `viewer` | Viewer | a team (one or more) | those teams (read-only) |

So: **Software engineer (`qa_engineer`)** and **Manager (`qa_manager`)**. The keys stay as they are in
the database, the API, tokens and integrations; only the names shown change (one map:
`server/lib/roleLabels.ts`). Below, the tables use the keys as column headings.

`users.role` (highest role), `department_id` and `primary_team_id` are display columns kept in step by
the server; access never depends on them alone.

## Reading

| Capability (helper) | super_admin | qa_manager | team_lead | qa_engineer | viewer |
|---|---|---|---|---|---|
| Overview dashboard and team detail: the teams of the analytics scope (full matrix: [docs/ROLE_ACCESS.md](docs/ROLE_ACCESS.md)) | all teams | their departments' teams | their teams | their teams | their teams |
| Analytics modules, Compare teams (`canCompareTeams`), team KPI history | all teams | their departments' teams | their teams | their teams | their teams |
| TV mode (`canViewTeamTv`, wall screen, team figures only) | any team of the company | any team of the company | any team of the company | any team of the company | any team of the company |
| Per-team metric detail: history, velocity, metric bundles (`canReadTeamDetail` = analytics scope) | all teams | their departments' teams | their teams | their teams | their teams |
| Team member names and e-mails (`canViewTeamMembers`) | all teams | their departments' teams | their teams | their teams | their teams |
| Other developers' individual rows (`canViewDeveloperRow`) | people who opted in | people who opted in, their departments | people who opted in, their teams | own row only | own row only |
| Team AI recommendations (`canRequestTeamInsights`) | all teams | their departments' teams | teams they lead | no | no |
| Executive briefing (`canRequestExecutiveBriefing`) | yes | yes | yes | no | no |
| Wellbeing pulse results (aggregates only, `canViewPulseResults`) | all teams | their departments' teams | their teams | their teams | their teams |
| Pulse comments (`canViewPulseComments`) | yes | their departments | their teams | no | no |
| Names of members who have not answered the pulse (after the period's escalation) | when they were told (fallback recipients) | when they were told | when they were told | no | no |
| Alerts and tracked actions of a team (`canSeeTeamAlerts`, `canSeeActions`) | all teams (plus company-level alerts) | their departments' teams | their teams | their teams | their teams |
| Revenue impact of a team / roll-up (`canViewRevenueRollup`) | all / company and departments | their departments' teams / their departments | their teams / no | their teams / no | their teams / no |
| Activity (`canViewActivity`), Ingestion log (`canViewIngestionLog`) | whole company | entries of their departments | no | no | no |
| User activity: every request, sign-in and screen view of the company's users (`canViewUserActivity`) | whole company | no | no | no | no |
| Weekly digest (`canReceiveDigest`) | yes | yes | yes | no | no |
| Formula mode, "Show formulas & data sources" (`canUseFormulaMode`) | yes | no | no | no | no |

Developer insights are **opt-in** (`users.developer_insights_enabled`, default off): only people who
switched them on appear in other people's views and in team aggregates, and every aggregate of
individual developer data needs at least 3 such contributors (k-anonymity, `server/lib/privacy.ts`).

## Writing and administration

| Capability (helper) | super_admin | qa_manager | team_lead | qa_engineer | viewer |
|---|---|---|---|---|---|
| Team data: Manual metrics, developer metrics, AI toggle (`canWriteTeamData`) | any team | their departments' teams | teams they lead | no | no |
| Create / edit / delete teams (`canManageTeam`) | any | in their departments | no | no | no |
| Departments page, API keys, move teams, assign managers and leads (`isCompanyAdmin`) | yes | no | no | no | no |
| Admin console, Update frequency, Parameters, debt impact, pipeline settings (`canManageCompanyConfig`) | yes | yes | no | no | no |
| KPI targets (`canSetTargets`) | company, department, team | department and team, in their departments | no | no | no |
| Alert rules (`canEditAlertRules`) | company, department, team | department and team, in their departments | no | no | no |
| Slack channel, "Evaluate alerts now" (`canManageNotificationSettings`, `canRunEvaluation`) | yes | no | no | no | no |
| Acknowledge alerts; create / edit / delete tracked actions (`canManageActions`) | any team | their departments | teams they lead | own actions' status only | own actions' status only |
| Pulse cadence and automatic sending (`canSetPulseCadence`) | any team | their departments | no | no | no |
| Send the pulse survey and reminders (`canSendPulseSurvey`) | any team | their departments | teams they lead | no | no |
| Pulse warning, reminder e-mails and escalation settings (`canSetPulseReminders`) | any team | their departments | teams they lead | no | no |
| Answer the pulse survey (`canTakePulseSurvey`) | teams they are assigned to | teams they are assigned to | yes | yes | yes |
| Share saved views with the company; onboarding checklist; sample data (`canShareSavedView`, `canViewOnboarding`, `canManageSampleData`) | yes | no | no | no | no |

## Managing people

"Can manage" a user (`manageUserVia`): super_admin any user of the company; a manager users of a
department they manage whose highest role is below manager; a team lead users of a team they lead
whose highest role is below team lead. Nobody manages themselves.

| Action (helper) | Rule |
|---|---|
| Activate / deactivate, developer-insights toggle (`canManageUser`) | users you can manage |
| Edit another user's profile and assignments (`canEditUser`, `canEditAssignment`) | super_admin, and managers for users they manage |
| Delete (= deactivate, history kept) (`canDeleteUser`) | as editing assignments |
| Reset a password (`canResetPassword`) | yourself, or a user you can manage |
| Grant / revoke an assignment, send invitations (`canGrant`, `canInvite`) | super_admin any grant; a manager team lead / software engineer / viewer on teams of their departments; a team lead software engineer / viewer on teams they lead; never your own assignments |
| Edit yourself | name and e-mail only |

The last active super admin of a company cannot lose that role or be deactivated.

## Platform operator (outside the company roles)

The platform operator is the product owner's support access across **all** companies. It is not a
role assignment and no company role grants it.

- **Who**: a signed-in user whose e-mail is listed in `PLATFORM_OPERATOR_EMAILS` (comma-separated,
  case-insensitive). The list is checked again on every request. Unset or empty: the feature is off
  and every `/api/operator` route answers 404.
- **Step-up**: entering the panel asks for the password again (5 failed attempts per 15 minutes,
  every failure logged). An account without a usable password (single sign-on only) must set one
  first. Success gives a 30-minute operator token, signed with a key derived from `JWT_SECRET`
  with its own audience, so a session token can never act as it and it is never a session. The web
  app keeps it in memory only; **Leave** ends it on the server.
- **Network**: `PLATFORM_OPERATOR_ALLOWED_IPS` (optional) refuses other client addresses.
- **May**: read every company's data except protected data, and run a few logged repair actions
  (demo refresh, recompute KPI snapshots, re-run alert evaluation, resend an invitation,
  deactivate / reactivate a user, clear a sign-in lockout). Each needs a reason and a confirmation.
- **May not**: act as a user (no impersonation), run SQL, delete customer data, or see password
  hashes, API key hashes, the Slack webhook and secret settings, invitation and survey link tokens,
  single survey answers or comments, or developer metrics of people who have not opted in.
- **Transparency**: opening a company section writes "Platform support viewed …" with the reason to
  that company's Activity log (at most once per section per 30 minutes); every action writes
  "Platform support: …". All operator access is also kept in `platform_access_log`.

## Sign-in

- **Invitations**: single-use 256-bit tokens stored only as SHA-256 hashes, revocable, expiring after
  `INVITE_TTL_HOURS` (default 7 days); accepting grants exactly the invited assignment.
- **SSO** (Google, Microsoft OIDC; only when configured): matches an existing active user or an open
  invitation for the verified e-mail; never creates other accounts.
- **Registration** creates a new organisation whose first user is its super_admin.
- **Pulse survey links** (`/api/pulse/link*`): no session; a single-use hashed token bound to one person,
  team and period authenticates that one answer.

Configuration values whose key looks like a credential (password, token, secret, api key) and the Slack
webhook URL are never returned by the API.

The automated check of this table is `tests/api/r2-security-matrix.test.ts` (one request per role for
every endpoint added in R2) with `tests/api/role-matrix.test.ts` and `tests/api/analytics-scope.test.ts`.
The platform operator and the user activity log are covered by `tests/api/platform-operator.test.ts`,
`tests/api/user-activity.test.ts` and `tests/api/ops-log.test.ts`.
