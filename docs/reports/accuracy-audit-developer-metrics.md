## Developer productivity and people metrics: accuracy audit (read-only, nothing edited)

I reproduced the reported card through the live API. `GET /api/teams/team-1764026220944-y6sngw6ms/developer-ai-suggestions` returns David Lee as `at-risk`, "1 area(s) need attention", strengths [Fast PR turnaround, Quick code reviews, Minimal context switching, High satisfaction], concerns [Low focus time], suggestion "Keep up the good work!". Emma Wilson and Ionut Apostu get the same output. George Apostu gets `status:'healthy'` with summary "1 area(s) need attention".

### Critical findings

**C1. Root cause of the contradictory card: the rule-based fallback uses three separate rules that disagree.** Location: `server/routes/teams.ts:840-910`. There are four defects:
- **(a) Happiness scale is wrong (0–10 rule, 0–100 data).** The rule is `if (dev.happinessScore >= 7) strengths.push('High satisfaction') else if (<5) concerns.push('Low happiness score')`. Stored happiness is 0–100: values are 72/64/56/48/41.4/86. So every developer gets "High satisfaction", including George at 41.4, and "Low happiness" can never fire. The Groq prompt at line 812 makes the same mistake ("Happiness Score: >7 great, 5-7 okay, <5 concerning"), so the LLM is told 41/100 is "great". `src/config/metricsConfig.ts:318` correctly uses good 70 / warning 50 on a /100 scale.
- **(b) The recommendation only covers 4 of the 6 concerns.** The `if/else if` chain (892-900) handles meetings, context switching, PR time and happiness only. "Low focus time" and "Code reviews are slow" fall through to the default `'Keep up the good work!'`.
- **(c) The status badge ignores some concerns.** "Code reviews are slow" (857) never changes `status`, so George is `healthy` while the summary says 1 area needs attention.
- **(d) The severity order is inverted.** Low focus sets `at-risk` (amber), while PR >24h or low happiness sets `needs-attention` (red). Elsewhere "at risk" is read as the worse state.

**Fix: derive status, summary and suggestion from one `concerns` list.**
- **Severity:** give each concern a weight. The 2s are low focus (<3h), meetings >4h, context switching >6, and happiness <50 (on 0–100). The 1s are PR merge >24h and review >4h.
- **Status:** if there are no concerns, `healthy`. If the summed weight is 3 or more, or any concern is low happiness, the worst state. Otherwise the middle state. Give the two non-healthy states names that clearly rank, e.g. "watch" and "at risk".
- **Summary:** `${concerns.length} area(s) need attention: ${concerns.join(', ')}`.
- **Suggestion:** use a lookup table covering every concern, and pick the highest-severity one:
  - low focus: "Protect 2-3h no-meeting focus blocks daily"
  - slow reviews: "Set a review SLA / rotate reviewers"
  - meetings: as now
  - context switching: as now
  - PR time: as now
  - low happiness: as now

  Only return "Keep up the good work!" when `concerns.length === 0`.
- **Contradictions:** don't list a strength and a concern built from the same fixture row without a data-quality check (see C6). Fix the happiness thresholds to >=70 / <50.
- **Groq path (783-831):** the LLM output is passed through unvalidated. Status is free text, and `dev.status.replace` in TeamDetailView.tsx:1546 will crash if it is missing. Metrics are joined by `m.name === dev.name`. Validate status against the enum, and recompute status from the same rules server-side.

**C2. The happiness score is derived, not measured, but the UI calls it "self-reported satisfaction".** Location: `src/components/ManualMetricsInput.tsx:137-151`. `calculateHappinessScore` is 40% focus/(focus+meetings), 30% context switches, 15% meetings, 7.5% PR time and 7.5% review time.
- I checked the stored values: David (all fields 1) gives 20+27+11.25+7.19+6.56 = 72, and George's inputs give 41.45. Both match the DB.
- `TeamDetailView.tsx:174-176` tooltip says "Self-reported measure of job satisfaction".
- The rule engine then reports "High satisfaction" as a separate strength, which double-counts the same inputs.
- `server/routes/metrics.ts:743` documents a third, different formula: `100 - meeting_burden×5 ...`. That formula would give David 100, not 72.

Fix: rename to "Workload balance score (derived)", show the real formula, and drop it from strengths/concerns, or collect a real survey. Also, `happiness_score numeric(3,1)` overflows at 100 (I confirmed `99.96::numeric(3,1)` raises an error), so a perfect score fails to save. Use numeric(4,1).

**C3. TeamDetailView fills in random metrics as if they were real.** Location: `src/components/TeamDetailView.tsx:461-473`. When a member has no row, the code uses `happiness_score: Math.floor(Math.random()*30)+70`, `focus_time_hours: Math.random()*4+2`, and so on. These are rendered as that person's PR/Review/Focus/Meetings/Happiness/Burnout card with no label. The metrics come from `/developer-ai-suggestions`, so random data also appears whenever:
- the viewer is a qa_engineer (always 403; the section is shown to them at line 897, so they see random numbers labelled as their own);
- the user opted out (`developer_insights_enabled=false`);
- team AI is disabled;
- `aiLimiter` (10/min) returns 429. Each team view makes 3 AI calls.

Fix: delete the fallback and show "No metrics recorded". Load metrics from a non-AI, non-rate-limited endpoint.

**C4. The DDPS executive summary is generated from zero rows.** Location: `server/routes/analytics.ts:2810-2846`. The live API with `range=30d` and `6m` returns `totalSnapshots:0`, `headline:"Only ~0% of the day converted into deep, value-producing work."`, `lossDrivers:"insufficient focus time"`, and a recommendation. The cause: with no snapshots, `avgMetrics.focusTime=0 < 4` and `avgDDPS=0`. Fix: return `executiveSummary:null` / "No data" when `snapshots.length===0`.

**C5. The productivity history and leaderboards are fabricated.**
- **Snapshots are synthetic.** `server/seeds/seedProductivitySnapshots.ts` generates all 4480 `developer_productivity_snapshots` rows (35 devs, 2025-06-18 to 2025-12-12) with `Math.random`. Nothing else in server/ or src/ writes this table. The data is also stale, which is why C4 shows zero rows. Label it as demo data or remove it.
- **The "12-Month Trends" chart is random.** `src/components/DeveloperProductivity.tsx:417-423` uses `happiness: 7 + Math.random()*2` (and a 0–10 scale), random focus and random PR time, with no mock label. The values are regenerated on every render.
- **The "Team rankings" page is entirely fabricated.** `src/components/TeamGamification.tsx:12` uses `generateGamificationData()` (`src/data/advancedFeatures.ts:283-305`). Team names are hardcoded (Checkout Service, User Auth, Inventory Core, Payment Gateway, Mobile App), points are `Math.floor(Math.random()*5000)+1000`, badges are random, every team has the same "Quality Champion" achievement dated now, and the category counts are hardcoded 3/2/4 (lines 158-170). It is called in the render body, so clicking "View Achievements" reshuffles the leaderboard. It sits in the main nav (`Layout.tsx:59`). Remove it or hide it behind a "demo" flag.

**C6. Test fixtures look the same as real data.** 8 of 11 `developer_metrics` rows are fixtures:
- David Lee, Emma Wilson, Henry Brown, Ionut Apostu (×2) and two "Test User" rows each have every field equal to 1, 2, 3 or 4.
- Team Lead has 0.5/0.5/5/1/1.

Only George, Ionuț (superadmin) and Loredana look real. Nothing flags the fixtures. They produce the "1h PR + 1h focus + 1h meetings" contradictions. Delete them, or add an `is_sample` column and filter or badge those rows.

**C7. The team rule-based action plan is the same for every team, and zero values are flagged as problems.** Location: `server/routes/teams.ts:631-684`.
- `if (defectEscapeRate > 0)`, `changeFailureRate > 0`, `mttrHours > 0` and similar push an "area of improvement" for any non-zero value.
- The live result for LegacyCode Warriors lists "Defect-escape rate (0.0%)" and "MTTR (0.3 hrs)".
- `actionPlan` is a hardcoded array of 4 items for every team, including "Urgent: Post-mortem board for defect escapes" at 0.0% and "Parallel test & build pipeline tuning" whatever the build time is.

Fix: use benchmark thresholds (e.g. escape >5%, CFR >15%, MTTR >24h, flakiness >2%), and build the action plan from the flagged areas only.

### High findings

**H1. The two DDPS formulas don't match, and the server one rewards slow PRs.**
- **Seed formula.** `seedProductivitySnapshots.ts:35-37` uses `numerator = 1.0*ft_n + 0.8*prt_n`. A longer PR merge time raises the score: corr(pr_merge_time, ddps) = +0.358 in the DB. Its range is not 0–1; up to about 1.14 is possible (e.g. ft=7, pr=6, rt=0.1, mt=0.5, cs=1).
- **Frontend formula.** `DeveloperProductivity.tsx:44-130` uses a points formula, which the on-screen text at lines 595-640 describes correctly.
- **Both are called "DDPS".** The server summary uses the seed formula with labels such as "% of the day converted into deep work", which it does not measure.

Fix: use one shared formula, and invert the PR term.

**H2. The frontend DDPS cannot exceed 75, but the screen claims a 0–100 range.** The maximum is 50+0+0+10+5+10 = 75, so the "80-100 Exceptional" tier (`DeveloperProductivity.tsx:647`, and `getDDPSStatus` at 138) can never be reached. "Range: 0-100" (line 598) is false. Fix: rescale (`rawScore/75*100`) or reweight the components to sum to 100.

**H3. PR merge latency is counted as hours worked.** `totalWorkHours = focus + meetings + review*0.3 + pr_merge*0.2` (lines 58-60). PR merge time is elapsed wall-clock time, not effort, so a 24h PR adds 4.8 "work hours" and triggers the overtime warning and balance penalty. Fix: remove the PR term.

**H4. `/analytics/developer-metrics` scopes and averages incorrectly, and has no access control.** Location: `server/routes/analytics.ts:448-491`.
- The team filter uses `u.primary_team_id` instead of `dm.team_id`, so metrics recorded for team A show under the developer's primary team.
- It uses `AVG` across teams.
- It ignores the `developer_insights_enabled` opt-out.
- It has no role check, so any engineer can fetch every colleague's happiness score. UsersView's ranking (`UsersView.tsx:780-836`) and DeveloperProductivity use it.
- `/ddps-history` has the same `primary_team_id` filter problem (line 2768).

### Medium findings

- **M1. Burnout risk has five different formulas.**
  - TeamDetailView:1039 and UsersView:702: happiness>80 and focus>4 is Low, happiness>70 is Moderate. Every fixture is "High" or "Moderate" while the card says healthy.
  - DeveloperProductivity:1194: based on DDPS.
  - DeveloperProductivity:376: an index shown as a "%".
  - ManualMetricsInput:156.
  - metrics.ts:697.
  - analytics.ts:2413.

  Use one shared function.
- **M2. "Happiness" is shown as a percentage and charted against fields that don't exist.** UsersView:834 shows happiness with "%". DeveloperProductivity:697 charts `dataKey="happiness"`, which `teamOverviewData` doesn't contain, so the bars are empty.
- **M3. Rule gaps in teams.ts.**
  - Meetings has no strength branch.
  - Review time of 2–4h and PR time of 4–24h produce nothing.
  - Henry (3h focus, 3h meetings) is reported as "Performing well across all metrics".
  - There is no plausibility check (e.g. focus + meetings ≤ ~10h, or all fields identical).
- **M4. Company wellness defaults to invented values when data is missing.** `analytics.ts:2408` uses `avg_happiness || 75` and focus/meetings defaults when there is no data. The `team_members` join counts a developer once per team. `pipelineHealthScore = 96` is a constant, next to the comment "All values from real database data".
- **M5. Dead seed.** `server/jobs/analyticsSync.ts:391` inserts into non-existent columns (`user_id`, `recorded_date`) with random 5–10 happiness. It is broken, but it shows the 0–10 versus 0–100 confusion.

### What is correct
- Access gating on the developer-ai-suggestions and ai-suggestions endpoints (role check, team lead limited to own team, tenant scope), and the opt-out filter in developer-ai-suggestions.
- The frontend DDPS code matches the on-screen component table exactly. Only the range and tier claims are wrong.
- DeveloperProductivity excludes members with no metrics (`has_metrics`) instead of using zeros.
- ManualMetricsInput reproduces the stored happiness values exactly.
- The Groq/rule-based `source` is shown in the UI.
- The team ai-suggestions strongpoint thresholds (coverage ≥80, lead time ≤3.5d, and so on) are reasonable.
- DDPS trend and min/max arithmetic is correct when there is data.

### Key files
- /home/user/irongate-qa-navigator-platform/server/routes/teams.ts
- /home/user/irongate-qa-navigator-platform/server/routes/analytics.ts
- /home/user/irongate-qa-navigator-platform/server/seeds/seedProductivitySnapshots.ts
- /home/user/irongate-qa-navigator-platform/src/components/DeveloperProductivity.tsx
- /home/user/irongate-qa-navigator-platform/src/components/TeamDetailView.tsx
- /home/user/irongate-qa-navigator-platform/src/components/UsersView.tsx
- /home/user/irongate-qa-navigator-platform/src/components/TeamGamification.tsx
- /home/user/irongate-qa-navigator-platform/src/data/advancedFeatures.ts
- /home/user/irongate-qa-navigator-platform/src/components/ManualMetricsInput.tsx
- /home/user/irongate-qa-navigator-platform/server/routes/metrics.ts
