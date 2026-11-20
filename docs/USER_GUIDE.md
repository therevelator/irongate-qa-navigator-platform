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
  your device) and the score display (3D Battery or Gauge). Both are remembered in this browser.
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
  per page. Done and Dropped start collapsed. An action's owner can change its status.
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
  only, no individual data.

## 6. Analytics and Compare teams

**Analytics** opens one team at a time (pick the team at the top). Modules: Flaky tests, Test execution,
Technical debt, Performance, CI/CD pipeline, Developer productivity, Wellbeing pulse, Business impact,
Team rankings and Reports (PDF). Each module shows "No data recorded" when the team has no data for it.

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
- **Manual metrics:** enter team KPIs and developer metrics by hand.
- **Activity:** the change history with undo. **Ingestion log:** every data import. **User activity**
  (super admins): sign-ins, requests and screens of the company's users for 90 days.

## 10. Reading the numbers

- **Colours.** Every score uses one colour scale: below 30 red, 30–45 deep amber, 45–60 amber, 60–75
  yellow, 75–90 light green, 90–100 green. The status text ("On target", "Watch", "Off target") is judged
  against the target and shown with it.
- **"—" or "No data recorded"** means nothing was measured. Nothing is invented.
- **Stale** values are greyed with "Stale since …" and are not judged.
- **"Based on n of m"** tells you how many inputs a composite used.
- **Sample data** is marked by a banner. It is generated for demos and can be removed.
