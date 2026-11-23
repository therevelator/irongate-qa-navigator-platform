# Next move: Time lost, Findings, Outcomes, Data readiness

A KPI dashboard shows the score. These four pages show **what is costing time, why, what to do next, who does it, and
whether it worked**. They sit in the navigation under "Next move", for every role with a team in scope. The KPI
dashboard (Overview) stays as it is.

This document has three parts: [the business case](#part-1-the-business-case), [the pages](#part-2-the-pages) and
[how it is built](#part-3-how-it-is-built).

---

## Part 1: the business case

### 1.1 The need

A company with several engineering teams already has the data (pipeline runs, test reports, deployments, incidents,
issues, pull requests) and often a dashboard that turns it into KPIs. The dashboard rarely changes what anyone does:

| What a dashboard shows | What the reader still does not know |
|---|---|
| Build time is 19 minutes (target 10) | Why, since when, which stage, between which commits |
| Change failure rate is 11 % | Which deploys, which service, what each failure cost |
| Twenty tiles, eight of them amber | Which one to work on first |
| An action was taken last month | Whether it worked, or quietly came back |
| An empty tile | What to connect, and what it would unlock |

The team lead gets a number without a cause and has to do the investigation the tool did not do. The head of
engineering gets many numbers and no priority, and needs someone to make slides to answer "is it getting better?".
The buyer cannot show at renewal what the tool returned.

The missing part is not another metric. It is the path from a metric to a decision.

### 1.2 What it solves

```
Finding  →  Evidence  →  Next step  →  Owner  →  Verdict
(what)      (records)    (one thing)   (team)    (the KPI decides)
```

| Step | What QE Navigator does | What the customer does |
|---|---|---|
| Finding | Runs rules over the records and states the problem with its numbers | Nothing |
| Evidence | Lists the stages, runs, deploys or issues behind it, and since when | Checks it, if they wish |
| Next step | Suggests one concrete step and, where it can, the effect to expect | Decides whether to take it |
| Owner | Records who took it and by when; gives the text of a ticket | Assigns it and **does the fix in their own tools** |
| Verdict | Compares the KPI 14 and 30 days after the action was done with its value before | Nothing |

QE Navigator suggests. It never changes a pipeline, a repository or a ticket.

**One unit for everything: hours lost per week.** KPIs cannot be compared with each other (is 6 points of coverage
worse than 7 minutes of build time?). Hours can. Five causes are measured, each with a rule anyone can redo by hand
([3.1](#31-hours-lost-per-week-the-calculation)). The hours are waiting and rework time measured from records. They
are not an estimate of effort and not a money figure: a customer who wants money multiplies by their own hourly cost.

| Problem | Answer | Page |
|---|---|---|
| A number without a cause | Findings with their records and a start date | Findings |
| No priority | Ranking by hours; one thing per team per week | Time lost, Findings |
| Nobody owns it | Owner and due date; findings without an owner are counted on the first page | Findings, Outcomes |
| Nobody knows if a fix worked | The verdict comes from the KPI; a fix that did not hold is shown as such | Outcomes |
| "What did we get for this?" | Fixes confirmed by the numbers, per month, printable | Outcomes |
| Empty or stale tiles | Gaps with what they block, the fix and the effort | Data readiness |

### 1.3 Why a customer buys it

| Advantage | What it means in practice |
|---|---|
| Value on the first day | After the first sync the customer sees findings in their own data, not an empty dashboard to configure |
| It shows what it returned | Outcomes lists the fixes whose KPI improved and held, with before and after |
| Nothing is typed in | The Exporter reads the tools; hours, findings and verdicts are calculated |
| Checkable | Every figure names its rule and its records; an engineer can redo the sum |
| The team stays in charge | Suggestions and ticket text; the fix is the team's, in its tools |
| Honest about gaps | A metric without a source is "missing" with its fix, never a guess |
| One language | Hours per week is understood by an engineer and by a finance director alike |

| Who | What they get |
|---|---|
| CTO, head of engineering | Where to push this week; proof of improvement per month; no slide-making |
| Team lead | One thing for the sprint, with evidence good enough to defend in planning |
| Engineer | The cause already located: stage, pipeline, deploy, issue, commit range |
| QA / QE lead | Flaky reruns and failed changes tied to their cost, not shown as bare percentages |
| DevOps / platform | An exact list of what to connect or keep as an artifact |
| Finance, procurement | A measured return in hours, to multiply by their own rate |

### 1.4 What we do not claim

- The hours are what the records show. A cause the team's tools do not record (a meeting, a slow laptop) is not in them.
- A finding is a rule over records, not a diagnosis. "Between commits A and B" says where to look, not what is wrong.
- "Verified" means the KPI improved after the action and held at the checkpoint. It does not prove the action caused it.
- No customer result is quoted anywhere in the product or its documents. Figures on the demo company are sample data.

---

## Part 2: the pages

Every page has an "About this page" box with the same three answers given here: what it does, what it is good for,
where the numbers come from. All four pages cover the caller's analytics scope ([ROLE_ACCESS.md](ROLE_ACCESS.md)): a
super admin the company, a manager their departments, everyone else their teams.

### 2.1 Time lost (`/time-lost`)

- **What it does.** The company in one unit. Top: the hours lost in the last 7 days, the change against 12 weeks ago,
  the 12-week trend, the split by cause, and a table of each cause 12 weeks ago, now and the change. Middle: one row
  per team, worst first, with its state, its hours, its one thing this week (with the owner, if it has one) and its
  data readiness. Bottom: the fixes the numbers confirmed, and links to Overview, Executive summary, Data readiness
  and Outcomes.
- **What it is good for.** Reading in two minutes where to push this week.
- **Team state.** The mean of the last four weeks against the mean of the first four of the window: *slipping* or
  *improving* when it moved by at least one hour and 15 %, otherwise *steady*; *cannot say yet* when fewer than half
  of the required sources are connected or no record was seen.
- **One thing this week.** The team's finding with the most hours; an owned one comes first.

### 2.2 Findings (`/findings`)

- **What it does.** The findings of the scope, the costliest first: cause, team, title, the sentence with the numbers,
  the next step, hours a week, and whether it has an owner. Opening a finding shows the evidence, the records behind
  it, the 12-week trend of the cause, the confidence with its reason, the rule the hours were counted by, the owner
  form and the finding as ticket text to copy.
- **One team.** With a team selected, the page starts with its one thing this week as five steps: Finding, Evidence,
  Next step, Owner, Verdict.
- **Two kinds of finding.**
  1. A *cause of lost hours* with at least half an hour in the latest week, written from the records behind it.
  2. The team's *recommendations* (from its KPI history; they existed before these pages). A recommendation about a
     measured cause carries that cause's hours and replaces the first kind for it; the others are listed without hours.
- **Assign owner.** Team leads, their department's managers and administrators can assign. For a recommendation the
  button accepts it (the same as "Add to Action plan" on the team page); for a cause it creates a tracked action
  linked to the cause's KPI. Either way the action is in the team's Action plan and the finding shows its owner.

### 2.3 Outcomes (`/outcomes`)

- **What it does.** Five columns: *Suggested* (findings without an owner), *Owned* (open or in progress), *Waiting for
  verdict* (done, no checkpoint yet), *Verified*, *Did not hold*. Above them, the hours lost now and 12 weeks ago by
  cause. A period selector cuts the done actions to one month; "Print report" prints the page without the controls:
  that is the monthly outcomes report.
- **The verdict.** Read from the action's stored checkpoints (14 and 30 days after it was done, each compared with
  the KPI's value when the action was created): *verified* when the latest decided checkpoint improved, *did not hold*
  when it is unchanged or worse. An action with no KPI linked stays in "Waiting": there is nothing to judge it by.
- **What it is good for.** Answering "what did we get for this?" and seeing honestly which fixes did not hold.

### 2.4 Data readiness (`/data-readiness`)

- **What it does.** A team × source table (CI runs, test reports, coverage, deployments, incidents, issues; and the
  optional pull requests, load tests, test management), then the gaps: for each, what it blocks, the fix, the effort,
  and what the Exporter saw (for example "12 of 12 pipeline runs kept no test report"). The Exporter's last delivery
  is at the bottom.
- **The rule.** A source is connected when the team sent a record of that kind in the last 30 days (incidents: 180,
  test management: 90); *stale* when the last record is older; *missing* when there never was one. Readiness is the
  share of the six required sources that are connected.
- **What it is good for.** Turning an empty tile into a to-do list for whoever looks after the pipelines.

---

## Part 3: how it is built

### 3.1 Hours lost per week: the calculation

`packages/engine/src/calc/lostHours.ts` (pure: records in, hours out). Twelve rolling 7-day windows ending at the end
of the current day (UTC), so the latest week is always complete.

| Cause | Rule | Records |
|---|---|---|
| `slow_stage` | For each stage and week: (median duration of the week − the stage's lowest weekly median in the window) × runs of the week. Counted when the difference is at least 30 s and 10 % of the best. Successful stage runs only | `pipeline_stage_runs`, `pipeline_runs_raw` |
| `flaky_rerun` | The duration of every pipeline run that failed and was followed by a successful run of the same pipeline on the same commit | `pipeline_runs_raw` |
| `blocked` | Working hours issues spent in a blocked status or flagged | `issues`, `issue_transitions` |
| `failed_change` | For each failed production change (rolled back, hotfixed within `CHANGE_FAILURE_WINDOW_HOURS`, or linked to an incident; the same definition as the change failure rate): hours from the deploy to the rollback, the hotfix or the incident's resolution, at most 24 per change | `deployments_raw`, `incidents_raw` |
| `review_wait` | Working hours pull requests waited for a first review beyond the team's lowest weekly median in the window | `pull_requests_raw` |

- A weekly median needs 5 records; a stage or team with fewer than two such weeks contributes nothing.
- Working hours: 8 for every 24 h on a weekday (Monday to Friday, UTC). Weekends do not count.
- The stage name is `<pipeline> › <stage>` so that "build" of two pipelines is two stages.
- **Since when, between which commits.** For a stage that is slow in the latest week: the first day of the unbroken
  run of slow weeks, the first run in it at least halfway between the best and the current median, and the run before
  it. The change is between the commits of those two runs.

Known limits, stated on purpose:

| Limit | Effect |
|---|---|
| Stages that run in parallel are each counted | The hours of slow parallel stages can exceed the time a person waited |
| "Best week" is the team's own, within 12 weeks | A stage that was always slow costs nothing here; the build-time KPI and its target cover that |
| Failed changes are clock hours from deploy to fix | A failure fixed overnight counts its night hours (capped at 24) |
| Working hours are UTC, Monday to Friday | A team in another time zone or working week is off by the difference |
| A failed run with no later success on the commit is not counted | Real failures are not "lost" hours here; they are the pipeline doing its job |

### 3.2 Storage and refresh

Migration `supabase/migrations/20261210000000_navigator.sql` (additive):

| Table | Holds |
|---|---|
| `lost_hours_weekly` | Hours per team, week and cause (60 rows per team). A cache of the calculation: rewritten on every refresh |
| `lost_hours_state` | What the latest week is made of (stages, pipelines, issues, deploys), the record counts per cause, when it was calculated |
| `exporter_discovery` | The Exporter's latest discovery report per team and source |

`server/lib/lostHours.ts`: `refreshLostHours` reads a team's 12 weeks, calculates and stores; `lostHoursFor` returns
the stored rows and first recalculates the teams that are due (never calculated, older than
`LOST_HOURS_MAX_AGE_HOURS`, default 6, or calculated on an earlier day) within a 6-second budget;
`refreshRecentLostHours` runs after the nightly recalculation (`recomputeRecent`). A team's refresh takes well under a
second on the demo data (about 3 700 pipeline runs a year per team).

Before the migration is applied the pages say so and show nothing; no other page is affected.

### 3.3 Findings, verdicts, readiness

`server/lib/navigator.ts` (pure functions):

| Function | What it decides |
|---|---|
| `causeFinding` | The text, evidence, records, next step and confidence of a cause's finding (confidence from the number of records in the window: high from 30, medium from 10) |
| `recommendationFinding`, `teamFindings` | A stored recommendation as a finding; `RULE_CAUSE` maps the recommendation rules that describe a measured cause (`flaky_tests`, `build_time_regression`, `slow_tests`, `change_failure`, `mttr_rising`, `wellbeing_blocked`) to it |
| `teamState` | Improving, steady, slipping, unknown |
| `verdictOf` | Owned, waiting, verified, not held, from the tracked action's status and checkpoints (`server/lib/actions.ts` computes the checkpoints; nothing new is stored) |
| `SOURCES`, `readinessPercent`, `discoveryHints` | The sources, what each blocks, its fix and effort; the percentage; the Exporter's observations as sentences |

A finding built from a cause has no row of its own. It is "owned" when the team tracks an open action on the cause's
KPI (`CAUSE_METRIC`) or with the finding's title.

### 3.4 API

`server/routes/navigator.ts`, mounted at `/api/navigator` (also in `netlify/functions/api.ts`). Signed-in users;
read-only; the teams are those of `analyticsTeamsInScope`.

| Route | Returns |
|---|---|
| `GET /api/navigator/status` | `weeks` (12, by cause), `hoursNow`, `hoursBefore`, `causes` (now and before), `teams` (state, hours, trend, focus, readiness), `unowned`, `verified` |
| `GET /api/navigator/findings[?team=]` | `findings` (the costliest first), `hoursExplained`, `hoursTotal`, `teams` |
| `GET /api/navigator/outcomes[?month=YYYY-MM]` | `suggested`, `owned`, `waiting`, `verified`, `notHeld`, `weeks`, `causes`, `verdictRule` |
| `GET /api/navigator/readiness` | `sources`, `teams` (cells, last record per source, readiness, gaps with `blocks`, `fix`, `effort`, `seen`), `exporter`, `rule` |

Assigning an owner uses the existing routes: `POST /api/improve/recommendations/:id/accept` and `POST /api/actions`.

### 3.5 The Exporter's discovery report

From Exporter 0.5.0, each run of a CI source adds one small report per team (`exporter/src/run.ts`, `discoveryOf`):

```json
{
  "from": "2026-11-20T00:00:00.000Z", "to": "2026-11-23T00:00:00.000Z",
  "counts": { "pipelineRuns": 14, "testReports": 0, "coverageReports": 9, "deployments": 2 },
  "runsWithoutTests": 14, "runsWithoutCoverage": 5,
  "unmapped": ["pipeline nightly-load is not mapped"]
}
```

- Envelope kind `discovery`, one item; also `POST /api/ingest/discovery?team=&source=` with an API key.
- It holds counts, the window and the names of jobs or pipelines that are not mapped to a team. No record of the tool.
- A team gets a report only when the window held pipeline runs for it. The same findings are not sent twice.
- The server keeps the latest report per team and source (`exporter_discovery`); unknown fields are refused.
- An Exporter older than 0.5.0 sends no report: Data readiness then shows the gaps without the "Exporter:" lines.

Two things the pages need were already collected and needed no Exporter change: the service of a deployment
(`deployments_raw.service`) and the commit of every pipeline run (the commit range is worked out on the server).

### 3.6 Interface

`src/components/navigator/`: `TimeLost.tsx`, `Findings.tsx`, `Outcomes.tsx`, `DataReadiness.tsx`, shared pieces in
`parts.tsx`. Views `time-lost`, `findings`, `outcomes`, `data-readiness` in `src/App.tsx`, `src/lib/viewAccess.ts`
(the same rule as the executive summary) and `src/components/Layout.tsx` (group "Next move").

### 3.7 Tests

| Test | Covers |
|---|---|
| `tests/api/lost-hours.test.ts` (LH-01…06, NV-01…02) | The calculation of each cause, the windows and working hours; state, verdict, readiness, findings. No server needed |
| `tests/api/navigator.test.ts` (NAV-01…07) | The four routes on seeded pipeline records, assigning an owner, the discovery report (direct and through the Exporter's batch endpoint), scope |
| `exporter/test/discovery.test.ts` | The report's content: counts, runs without reports, unmapped names, nothing else |
| `tests/e2e/navigator/next-move.spec.ts` (NM-01…06) | The four pages against the API's figures, the viewer's scope, no sideways scrolling on a phone |

### 3.8 Deploying

1. Apply `supabase/migrations/20261210000000_navigator.sql`.
2. Deploy the server and the app. The first opening of Time lost calculates the teams in scope; the nightly job keeps them fresh.
3. Update the Exporter to 0.5.0 for the discovery lines on Data readiness (optional: everything else works with 0.4.0).

### 3.9 Not built yet

| Item | Why it waits |
|---|---|
| Thresholds calibrated on customer data (30 s and 10 % for a slow stage, 5 records for a median, half an hour for a finding) | They are reasoned defaults, checked on the demo company only. A pilot should confirm or change them |
| Hours attributed to one fix ("this action returned 7 hours") | Outcomes shows the KPI before and after and the hours per cause; attributing a share of the hours to one action would be a guess |
| Automatic reopening of an action that did not hold | It is shown under "Did not hold"; reopening stays a person's decision |
| Creating the ticket in Jira or Azure Boards | The Exporter is read-only by design; the page gives the text to paste |
| Coverage of the files where defects escaped | Needs per-file coverage linked to the files of escaped defects; the totals from SonarQube are not enough |
