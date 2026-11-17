# Role permissions

This is what the server enforces. The UI offers the same actions because both use the same
rules: `server/lib/userPolicy.ts` (users and teams), `server/middleware/access.ts`
(team data), and `resolveAnalyticsTeam` in `server/routes/analytics.ts`. Every rule is also
limited to the caller's own company. Role, department, team and active status are read from
the database on every request, so a change applies immediately.

Roles from highest to lowest: `super_admin`, `qa_manager`, `team_lead`, `qa_engineer`, `viewer`.

## Viewing

| Area | super_admin | qa_manager | team_lead | qa_engineer | viewer |
|---|---|---|---|---|---|
| Dashboard (company summary, all teams' latest KPIs) | yes | yes | yes | yes | yes |
| Team detail and team KPI history | any team | any team | any team | any team | any team |
| Developer-level metrics and recommendations on a team | any team | any team | own team | no | no |
| Analytics modules | any team or company-wide | any team or company-wide | own team only | no | no |
| Users page | whole company | own department + self | own team + self | no | no |
| Teams page | all teams | own department | own team | no | no |
| Departments page | yes | no | no | no | no |
| Admin console, Update frequency, Parameters | yes | yes | no | no | no |
| API keys (KPI ingestion) | yes | no | no | no | no |

People who turned developer insights off are left out of individual developer data for
everyone except themselves.

## Managing users

"Can manage" a user means:

- super_admin: any user in the company (not themselves);
- qa_manager: users in their department whose role is below qa_manager;
- team_lead: users on their primary team whose role is below team_lead.

| Action | Rule |
|---|---|
| Create a user | super_admin: qa_manager and below; qa_manager: team_lead and below, in their department; team_lead: qa_engineer or viewer, on their own team. A primary team is required except for viewer and qa_manager. |
| Edit another user (name, email, role, department, team) | super_admin and qa_manager, for users they can manage. A new role must be one they may create. Only a super_admin moves a user to another department. |
| Edit yourself | Name and email only. Nobody can change their own role, department or team. |
| Activate / deactivate, developer-insights toggle | Users you can manage. |
| Delete | super_admin and qa_manager, for users they can manage. Delete deactivates the account and keeps its history. |
| Reset a password | Yourself, or a user you can manage. |

`/api/users` only lets a person read and edit their own profile; all user administration
goes through `/api/admin/users`.

## Teams and team data

| Action | super_admin | qa_manager | team_lead |
|---|---|---|---|
| Create, rename, delete a team | any | own department | no |
| Turn AI suggestions on or off | any | own department | own team |
| Enter team KPIs and developer metrics (Manual metrics) | any | own department | own team |
| Technical-debt impact and pipeline settings | yes | yes | no |

qa_engineer and viewer cannot write team data.

## Settings

| Setting | Read | Write |
|---|---|---|
| Parameters (SLA, financial) | super_admin, qa_manager; team_lead for their own team (resolved values) | super_admin, qa_manager |
| Expected update frequency | everyone (used for staleness) | super_admin, qa_manager |

Configuration values whose key looks like a credential (password, token, secret, api key)
are never returned by the API.

## Registration

Registering creates a new organisation; the person registering becomes its super_admin. An
organisation name that already exists is refused. To join an existing organisation, an
admin creates the account.
