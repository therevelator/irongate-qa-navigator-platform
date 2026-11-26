# QE Navigator user guide

For people who use QE Navigator in their company: engineers, team leads, managers, executives and
administrators. It explains the screens and what you can do on them. What each role may see and do is
in [ROLE_ACCESS.md](ROLE_ACCESS.md); the formulas are in [metrics_and_calculations.md](metrics_and_calculations.md).
The full reference for every screen is [PRODUCT_GUIDE.md, section 5](PRODUCT_GUIDE.md#5-screens-and-features).

## Contents

1. [Getting in](#1-getting-in)
2. [The top bar and navigation](#2-the-top-bar-and-navigation)
3. [Overview](#3-overview)
4. [Team detail](#4-team-detail)
5. [Executive summary and TV mode](#5-executive-summary-and-tv-mode)
5a. [Next move: Time lost, Findings, Outcomes, Data readiness](#5a-next-move-time-lost-findings-outcomes-data-readiness)
6. [Analytics and Compare teams](#6-analytics-and-compare-teams)
7. [Wellbeing pulse](#7-wellbeing-pulse)
8. [Alerts and notifications](#8-alerts-and-notifications)
9. [Administration](#9-administration)
10. [Reading the numbers](#10-reading-the-numbers)

## 1. Getting in

- **Invitation.** Most people join by invitation. An administrator invites you by e-mail to one role on
  a team, department or the company. Open the link in the e-mail, choose a password (or use single
  sign-on if your company offers it) and you are in. Invitations expire after 7 days by default; ask for a
  new one if yours has expired.
- **Register a new organisation.** Registering creates a new organisation and makes you its super admin.
  To join an existing organisation, ask for an invitation instead.
- **Sign in** with your e-mail and password, or with Google or Microsoft when your company has set it up.
  Tick "Keep me signed in" to stay signed in after closing the browser. How long a sign-in lasts is set by
  your company (default 7 days).
- **Forgot password.** Use "Forgot password" on the sign-in page. You get a one-time link by e-mail.
- **Too many wrong passwords.** After 5 wrong passwords in a row your account is locked for 15 minutes.
  The sign-in page still only says "Invalid credentials", even with the right password, until the lock
  ends. To get in sooner, use "Forgot password" or ask your administrator to set a new password.
- **Password rules.** 10 to 128 characters, at least three of lower case, upper case, number and symbol,
  and not containing the part of your e-mail address before the @. The same rules apply when an
  administrator sets a password for you.
- **Suspended organisation.** If your organisation's access is suspended, the sign-in page says so. Contact
  your administrator.

Sign-in screens always use the classic light look. Your chosen theme applies once you are signed in.

## 2. The top bar and navigation

The top bar shows the IronGate logo, "QE Navigator", the title of the page you are on, your company's
badge, and your name with your job title (or your role when no job title is set).

- **Help** (question mark): "What you can do here" lists what your role lets you see and do, generated
  from the same rules the server enforces.
- **Appearance** (palette icon): the theme (Light, Dark, Graphite, Porcelain, or Match system to follow
  your device), the score display (Battery or Gauge), the battery style (**Cell**, the default, or
  **Liquid**, the original glass tube) and the depth (**3D** with gloss and shadows, or flat **2D** with
  the same shapes and colours). All are remembered in this browser.
- **Notifications** (bell): unread alerts and messages.
- **Account menu**: "Sign out my other devices" and "Sign out".

The navigation shows only the pages your role can open. If you type the address of a page you may not
open, the Overview opens with "You don't have access to …".

| Entry | Who sees it |
|---|---|
| Overview, TV mode, Notifications | everyone |
| Executive summary | super admins and managers (the address opens for every role, for the teams in their scope) |
| Analytics, Compare teams | everyone with at least one team in scope |
| Users, Teams | super admins, managers, team leads |
| Departments, User activity | super admins |
| Activity, Ingestion log, Admin console, Update frequency, Parameters | super admins, managers |
| Manual metrics | super admins, managers, team leads |

## 3. Overview

The company (or your part of it) on one page:

- **Global QA score** of the teams you can see, with its trend, distribution and "based on n of m teams".
- **Executive gauges:** engineering health, delivery (DORA), wellbeing (survey), tech debt health and
  pipeline health, each with what it is based on.
- **Company averages** of coverage, automation, flakiness and escape rate against the targets.
- **Teams vs KPI targets:** on track, at risk, off track; click a count to see the teams.
- **Team performance:** a card or list row per team, with filters (All, High performing, Needs attention),
  search, department, sort, grid or list, and cards per row.
- **Views** (save and reuse filters), **CSV export**, the **onboarding checklist** for new organisations,
  and the **Executive briefing** for super admins, managers and team leads.

## 4. Team detail

Open a team from the Overview. You see only teams in your scope.

The page shows **one section at a time**. The buttons under the header switch between Recommendations &
actions, Team & wellbeing, KPIs, Evidence and Insights; **Everything** shows all of them. Your choice is
remembered in the browser. **Download PDF** in the top bar (on every page of the app) prints the page with
every section and every collapsed part opened, in the light theme, whatever is on screen.

- **QA score card:** the battery or gauge, the score with status and target, the change against 30 days
  earlier, a 30 / 90 day trend, the team's rank among the teams you can see, and the input that costs
  the score most.
- **KPI sections:** Quality & testing, Speed & efficiency, Agile & process, Reliability & stability. Each
  KPI shows its value, its target, status, "source · as of date", a stale marker when it is out of date,
  and a history chart. Every KPI has a target.
- **Forecast:** each KPI and the QA score have a forecast line ("Misses target … around 18 Dec", "On
  track", "not enough data" with the reason), and the trend charts show the projection with an 80 % band
  for 8 weeks.
- **Recommendations:** up to 6 next steps ranked by expected effect, each with its evidence, a next step,
  the expected effect and a confidence. Team leads (for their teams), managers and super admins can
  **Add to Action plan**, **Dismiss** (with a reason), **Reopen** and **Recalculate**.
- **Action plan:** the team's tracked actions with owner, due date, status, linked KPI, baseline and the
  measured outcome. Grouped in accordions by status (Open, In progress, Done, Dropped), with 5, 10 or 20
  per page. Done and Dropped start collapsed. An action's owner can change its status. On the left of each
  action a small line says who last set its status and when, in your own time zone: "Changed to Dropped by
  Aisha Rahman on 20th Nov 2026, 10:11 PM", "Created by … on …" when the status never changed, or
  "… automatically on …" when the system changed it (nothing for actions from before this was recorded).
  **History** under it lists every change (from → to, who, when), newest first. On a phone the line sits
  above the title.
- **Evidence:** when the team's CI sends raw data, "Evidence from CI" (flaky tests, lowest-coverage files,
  slowest tests, failing stages), "Deliveries & incidents" and "Work & code quality". **How this was
  calculated** on a value shows the formula, the inputs and the source records.
- **Wellbeing** result (team average, only with 3 or more answers) and, for leads and above, the panel to
  send the survey.
- **Team members:** the members and, for people who opted in to developer insights, their workload
  metrics (super admins, managers and team leads only; engineers and viewers see their own row).
- **Open TV mode** for this team.

## 5. Executive summary and TV mode

- **Executive summary** (`/summary`): built for a phone. The QA score of your scope, teams on track, at
  risk and off track, the 3 biggest risks and 3 most improved teams, "At this rate" (KPIs forecast to miss
  their target within 8 weeks), open alerts and what changed since last week. Super admins and managers
  also see money at risk. It covers only the teams you can see.
- **TV mode** (`/tv?team=<id>`): a full-screen view for a wall screen. Team KPIs, trends, alerts and actions,
  and the wellbeing pulse (never below 3 answers, never comments). It rotates through panels and the
  teams of your scope. Press S to set it up (interval, panels, teams, theme), then **Copy screen link**.
  Keys: F full screen, T theme, R rotate, S set up, arrows or 1–4 panels, Esc exit. It shows team figures
  only, no individual data. The QA score follows your score display: the battery stands beside the big
  score; the gauge, which is wider than tall, sits in the middle of the panel with the score in its centre.

## 5a. Next move: Time lost, Findings, Outcomes, Data readiness

Four pages under **Next move** in the menu, for the teams of your scope. Each has an "About this page" box. The full
description is in [NEXT_MOVE.md](NEXT_MOVE.md).

- **Time lost**: the hours your teams lost in the last 7 days to slow pipeline stages, failed runs that passed on a
  rerun, blocked work, failed changes and waiting for review; how that moved in 12 weeks; each team's state and its
  one thing this week. Click a team to open its findings.
- **Findings**: the problems behind the hours, the costliest first. Open one to see the records behind it and the
  next step. Team leads, managers and administrators can **Assign owner** (it becomes an action in the team's Action
  plan); anyone can **Copy** it as the text of a ticket. Pick a team at the top right to see its one thing this week.
- **Outcomes**: every finding from *Suggested* to *Verified* or *Did not hold*. The last two are decided by the KPI
  14 and 30 days after the action was done, not by a person. Pick a month and press **Print report** for the monthly
  outcomes report.
- **Data readiness**: which sources each team sends, and for each gap what it blocks and how to close it.

The hours are measured from records. They are not a money figure: multiply by your own hourly cost if you want one.

## 6. Analytics and Compare teams

**Analytics** opens one team at a time (pick the team at the top). Modules: Flaky tests, Test execution,
Technical debt, Performance, CI/CD pipeline, Developer productivity, Wellbeing pulse, Business impact,
Team rankings and Reports (PDF). Each module shows "No data recorded" when the team has no data for it.

**Business impact** shows, in money, what quality problems cost a team and what fixing them is worth.
**Money** lists where the money is going now (quality below target, open technical debt, downtime, support
tickets, churn; they overlap, so there is no total), what you gain when each issue is fixed and where to start.
**What-if** projects the revenue change for a change in one metric. **Details** has the revenue per metric,
monthly trends, the correlation matrix and a plain-language summary (written by rules; **Generate AI summary**
uses an AI model when one is configured). **All teams** (super admins and managers) adds up the teams of your
scope; **Data entry** (super admins, managers, team leads) is where the monthly values are entered. Open **How
this works** at the top for what goes in, how each figure is calculated, which rates are your company's
assumptions (Parameters → Financial and ROI settings) and what the labels mean: *Strong* or *Some evidence* (the
team's own months), *Company-wide evidence* (the team's own months are inconclusive, so the link across the
company's teams is used), *Cost estimate* (arithmetic on your rates). Every figure opens **How this was
calculated**. The figures are associations, not causes, and not forecasts.

**Compare teams** puts 2 to 4 teams of your scope side by side over 7 to 90 days, with CSV export.

## 7. Wellbeing pulse

A short anonymous survey of five questions, sent to the **members of a team** only. Viewers who are not
team members never receive it. Results are team averages and are shown only with at least 3 answers.
Comments are shown only with the aggregate, and only to team leads, managers and super admins. Answering
is not recorded in any activity log. Team leads, managers and super admins send the survey and reminders;
managers and super admins set how often it goes out automatically.

## 8. Alerts and notifications

Alerts open when a KPI crosses its alert rule. The bell shows unread items. The **Notifications** page has
your scope's alerts, your inbox and your preferences (for example an e-mail for each alert, and the
weekly digest). Team leads (for
their teams), managers and super admins can acknowledge alerts. Super admins and managers set alert rules
under Parameters.

## 9. Administration

For super admins, managers and team leads, within their scope. Details: [ADMIN_PANEL_GUIDE.md](ADMIN_PANEL_GUIDE.md).

- **Users:** invite people (choose the role and where it applies), edit people and their role
  assignments, activate or deactivate, reset passwords.
- **Teams and Departments:** create, edit, move teams, assign managers and team leads.
- **Admin console:** organisation structure; for super admins also API keys, Connect your CI and Sample
  data.
- **Parameters:** KPI targets (company, department, team, with history), alert rules, financial and
  pipeline settings, and how long sign-ins last.
- **Update frequency:** how often each metric is expected to update (drives the stale marker).
- **Upload files** (super admins, managers for their departments' teams, team leads for the teams they
  lead; also a card in the Admin console next to Connect your CI): for a company that cannot connect its
  tools. Export files (test reports, coverage, SARIF, Jira or Linear issues as CSV or JSON, PagerDuty or
  Opsgenie incidents, the deployments and sprints CSV templates, or a zip of them), drop them on the page,
  choose the team (or "map by service / project key") and choose **Preview**. Nothing is stored yet: per
  file you see the detected type (change it in *File type* if it is wrong), the number of records, the
  dates, the team, the exact fields that will be stored and the columns that will not, three records
  exactly as they will be stored, warnings (rows that cannot be read, with their row numbers; rows without
  a team; records already stored) and what the export cannot carry (a Jira CSV has no status history, so
  blocked time is not calculated, and no sprint dates: add the sprints CSV). For a CSV, check the **column
  mapping** and the date order, change what is wrong and choose *Preview again*. Then **Upload**: per file
  the records stored, updated and already stored, the rows left out and why, the metrics recalculated, and
  a link to its ingestion log entry. *What is stored* lists the field allow-list; a super admin can turn off
  **Store issue and incident titles** (the titles already stored are deleted; lists show the key only).
- **Manual metrics:** enter team KPIs and developer metrics by hand (not offered when your company is in live operation:
  its metrics are then calculated from the raw data your tools hold). The company-wide pipeline
  configuration and the company default pipeline stages are changed by super admins only; managers edit
  the pipeline stages of their own departments' teams.
- **Activity:** the change history with undo. **Ingestion log:** every data import (uploads show who
  uploaded which file; filter *File uploads*). **User activity**
  (super admins): sign-ins, requests and screens of the company's users for 90 days.

## 10. Reading the numbers

- **Colours.** Every score uses one colour scale: below 30 red, 30–45 deep amber, 45–60 amber, 60–75
  yellow, 75–90 light green, 90–100 green. The status text ("On target", "Watch", "Off target") is judged
  against the target and shown with it.
- **"—" or "No data recorded"** means nothing was measured. Nothing is invented.
- **Stale** values are greyed with "Stale since …" and are not judged.
- **"Based on n of m"** tells you how many inputs a composite used.
- **Sample data** is marked by a banner. It is generated for demos and can be removed.

---

## Signing in, passwords, sessions and roles

How to get into QE Navigator, keep your account safe, and understand what your role lets you do. The
complete per-role matrix is in [ROLE_ACCESS.md](ROLE_ACCESS.md).

### Joining

- **By invitation (most people).** An administrator invites you by e-mail to a role on a team, a department
  or the company. Open the link, enter your first and last name and choose a password, or use Google or
  Microsoft sign-in if your company offers it and the account has the invited e-mail address. The link
  expires after 7 days by default. If it has expired, ask for a new one.
- **Registering.** "Create an account" on the sign-in page registers a **new organisation** with its first
  department and team, and makes you its super admin. Do not register to join your colleagues: ask for an
  invitation instead. A company e-mail domain can belong to one organisation only; with a public address
  (for example gmail.com) there is no such limit.

### Signing in

- E-mail and password, or **Continue with Google / Microsoft** when shown. Single sign-on works only for an
  existing account or an open invitation with the same verified e-mail address.
- **Keep me signed in** keeps you signed in after closing the browser, for as long as your company allows
  (default 7 days). Without it you are signed out when the browser closes.
- After too many failed attempts from one network, sign-in is paused for a while. Wait and try again, or
  reset your password.
- If your organisation's access is suspended, the sign-in page says so. Contact your administrator.

### Passwords

- 10 to 128 characters, at least three of: lower case, upper case, number, symbol. It must not contain the
  part of your e-mail address before the @.
- **Forgot password?** on the sign-in page sends a link to your e-mail. It works once and expires after 60
  minutes. The page always gives the same answer, whether or not the address has an account.
- Resetting your password signs you out on every device.
- An administrator can also set a password for you or send you a reset link.

### Your sessions

- **Account menu → Sign out my other devices** ends every session except the one you are using.
- **Sign out** ends this session.
- If an administrator signs you out everywhere, deactivates you or your organisation is suspended, your next
  action takes you back to the sign-in page with a message.

### What your role lets you do

Press the **question mark** in the top bar ("What you can do here") to see the rules for your own account.
In short:

| Role | Sees | Can change |
|---|---|---|
| Super admin | every team of the company | everything in the company: people, teams, departments, targets, settings, API keys |
| Manager | the teams of the departments they manage | those teams and their people below manager, their targets and alert rules |
| Team lead | the teams they lead or belong to | those teams' data (manual metrics, actions, alerts, pulse), their software engineers and viewers |
| Software engineer | the teams they belong to | their own tracked actions' status; answers the wellbeing pulse |
| Viewer | the teams they are assigned to | nothing (read-only) |

You can hold more than one role (for example viewer of two teams, or Scrum Master of three teams in two
departments); you get the combined access. Nobody can change their own role.

Your company can also define its own roles (Scrum Master, Product Owner, …) on top of these levels, with
permissions added or removed. Organisation → **Roles** shows what each one gives, if you may invite people.

### Privacy

- Your individual developer metrics are kept and shown to others only while your **developer insights** are
  on, and then only to roles your company gave the individual-metrics permission on your team. The switch is
  at the top of **Developer productivity**: off by default, yours to turn on or off; every change is in the
  change history. You always see your own row.
- Wellbeing pulse answers are anonymous. Results are shown only as team averages with at least 3 answers.
  Answering is not recorded in any activity log.
- Your company's super admins can see a log of sign-ins and requests in the company (User activity), for 90
  days, without the content of what you sent.
