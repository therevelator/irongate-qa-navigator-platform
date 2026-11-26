/**
 * The practical part of each feature guide, by feature slug: a concrete example with numbers and the first five
 * minutes on the page. build.mjs merges these into the features. The numbers in the examples are illustrations.
 */
export const featureExtras = {
  overview: {
    example: 'Monday, 09:00. The global score is 78, down 3 since last week, "based on 12 of 14 teams". The counts read 8 on track, 4 at risk, 2 off track. Filtering to "Needs attention" leaves six cards; sorting by defect escape rate puts Payments first at 11% against a 5% target. One click opens Payments on its recommendations. Elapsed: under two minutes.',
    steps: [['Read the three counts', 'On track, at risk, off track. Click the count to see which targets each team misses.'], ['Filter to "Needs attention"', 'Sort by the KPI you care about this week.'], ['Open the first card', 'The team page opens on what to do next.'], ['Save the view', 'So that next Monday is one click.']],
  },
  'team-page': {
    example: 'The Checkout team opens on three recommendations. The first: "Stabilise 6 flaky tests: they failed 41 runs in 14 days and cost about 9 hours", confidence high, expected effect "flakiness from 4.8% to between 1.5% and 2.5%". Evidence lists the six tests with their runs. "Add to Action plan" creates the action with the baseline 4.8%. Three weeks later the action reads "4.8% to 1.9%, Improved".',
    steps: [['Stay on Recommendations', 'Read the first one down to its evidence.'], ['Add it to the Action plan', 'Give it an owner and a date.'], ['Switch to KPIs', 'Open one card and "How this was calculated".'], ['Download PDF', 'Everything, every section opened, for whoever is not signed in.']],
  },
  'executive-summary': {
    example: 'On a phone before the leadership meeting: score 81, up 2. Risks: Ledger (escape rate 9%, "at this rate misses its target around 14 Dec"), Mobile (flakiness 6.2%), Search (score 58). Most improved: Checkout, up 9. Money at risk 21,000 to 36,000 a month. Since last week: 3 alerts opened, 5 resolved, 4 actions done, 2 overdue. One minute, three things to raise.',
    steps: [['Open /summary on your phone', 'Add it to the home screen.'], ['Read the three risks', 'Each has a value, a target and a date.'], ['Tap Money at risk', 'Once, to see the assumptions.'], ['Forward the link', 'Each person sees their own scope.']],
  },
  analytics: {
    example: 'A new engineering manager wants to know why releases slip. The hub shows ten tiles; "CI/CD pipeline: find the stage that slows delivery" is the one. They choose their department and the Payments team in the scope bar once, open the pipeline, then Flaky tests and Time lost: all three stay on Payments.',
    steps: [['Pick department and team', 'In the scope bar, once.'], ['Read the tiles', 'Each says the question it answers.'], ['Open two modules', 'They stay on the chosen team.']],
  },
  'compare-teams': {
    example: 'Payments and Ledger share a stack. Compared over 30 days: build time 9 against 21 minutes (highlighted), flakiness 1.4% against 5.9% (highlighted), coverage 82% against 79% (same band, not highlighted). "Only rows that differ" leaves four rows. The managers pair the two teams for a week on pipeline caching and test isolation.',
    steps: [['Choose two to four teams', 'Similar work compares best.'], ['Set the window', '30 days is a good start.'], ['Turn on "Only rows that differ"', 'These are the conversations worth having.'], ['Copy the link', 'The selection is in the address.']],
  },
  'tv-mode': {
    example: 'A screen in the Checkout team area rotates every 30 seconds: Key KPIs, Trends, Alerts & actions, Wellbeing. On Tuesday the flakiness tile turns amber at 3.1% and a new alert appears on the third panel. It is the first item at the stand-up; by Thursday the action is in progress and shown on the same screen.',
    steps: [['Open TV mode for your team', 'From the team page or the menu.'], ['Press S', 'Choose panels, interval, teams and the Porcelain or Light theme.'], ['Copy screen link', 'Put it on the display\'s browser.'], ['Press F', 'Full screen; the controls hide after four seconds.']],
  },
  'notifications-alerts': {
    example: 'Wednesday 14:10: coverage for Search falls to 68% against 80%. An alert opens (critical), the lead gets it in the bell and in Slack, the manager\'s preference is "critical only" so they get it too. The lead acknowledges and creates an action. On Friday coverage is back at 81% and the alert resolves itself. Monday\'s digest lists it under "opened and resolved".',
    steps: [['Open the bell', 'Read the latest; acknowledge what you have seen.'], ['Set your preferences', 'Minimum severity, e-mail, weekly digest.'], ['Check the rules', 'Parameters › Alert rules (admins and managers).'], ['Send yourself a test digest', 'To see Monday\'s e-mail today.']],
  },
  'time-lost': {
    example: 'Last 7 days, 14 teams: 212 hours. By cause: slow pipeline stages 74, failed runs that passed on a rerun 61, blocked work 43, waiting for review 22, failed changes 12. Twelve weeks ago the total was 168. Mavericks is "slipping": its one thing this week is the integration stage, 18 hours. Opening it shows the runs and the minutes.',
    steps: [['Read the total and the trend', 'Is it going up or down over 12 weeks?'], ['Read the causes', 'The biggest one is where to look.'], ['Find your team', 'Its one thing this week is the next action.'], ['Open the records', 'Then go to Findings for the next step.']],
  },
  findings: {
    example: 'Top of the list for Payments: "checkout.spec › applies a voucher: failed and passed on the same commit 14 times in 14 days, about 6.5 hours a week". Next step: isolate the shared cart fixture. The lead sets an owner and a date; the ticket text is pasted into Jira. The finding moves to "in progress" and, a month later, to "verified".',
    steps: [['Start at the top', 'The list is sorted by hours per week.'], ['Open the evidence', 'The runs or issues that prove it.'], ['Set owner and date', 'This creates the tracked action.'], ['Copy the ticket text', 'Into your own tracker.']],
  },
  outcomes: {
    example: 'November report for one department: 14 actions completed. Nine verified (for example "build time 19 to 10 min" and "blocked time 14 to 6 h"), three unchanged, one with no new data, one "did not hold" (flakiness returned to 4% after two weeks). Hours returned by the verified actions: 71 a week.',
    steps: [['Filter to last month', 'Completed actions with their verdict.'], ['Open a "did not hold"', 'It is the most useful row on the page.'], ['Print the page', 'It is the monthly outcomes report.']],
  },
  'data-readiness': {
    example: 'Ledger shows pipelines and tests connected, issues connected, deployments connected, incidents missing: "time to restore and availability cannot be calculated; map the Ledger services in the Exporter, about 10 minutes". Static analysis is stale: last report 9 days ago against a 1-day interval. Two fixes, both named.',
    steps: [['Find the red cells', 'Missing blocks more than stale.'], ['Read what each gap blocks', 'Pick the one that unlocks most.'], ['Follow the fix', 'Usually a mapping or a token in the Exporter.'], ['Come back after the next run', 'The cell turns green by itself.']],
  },
  'flaky-tests': {
    example: 'Search has 27 flaky tests. The first, "ranks exact matches first", flipped on the same commit 16 times in 14 days; its runs show it fails only on the second runner. The top five tests explain 70% of the flaky failures. Fixing those five takes the team\'s flakiness from 5.2% to 1.8%.',
    steps: [['Sort is by score', 'Work from the top.'], ['Open the run history', 'Look for a pattern: order, time, runner.'], ['Fix or quarantine the top five', 'Then look again in a week.']],
  },
  'test-execution': {
    example: 'The regression suite took 22 minutes in September and takes 41 now. The timeline shows the jump on 12 October, when 180 tests were added to one suite. Pass rate drifted from 97% to 93% over the same weeks. Both facts go into the next planning session with a date attached.',
    steps: [['Choose the suite and 90 days', 'Look at the duration line first.'], ['Find the step change', 'It has a date and a commit.'], ['Check for gaps', 'A missing day is a suite that did not report.']],
  },
  'technical-debt': {
    example: 'The notification service item: effort 60 hours at 85 an hour is 5,100. Monthly cost of delay: 14 tickets at 30, 35 minutes of downtime at 150, one SLA breach every second month at 1,000, about 6,170. Payback under one month, ROI above 1,300%. It moves to the top of the list.',
    steps: [['Sort by ROI or payback', 'The cheap, costly-to-leave items rise.'], ['Check the rates', 'A "(default)" label means finance has not set them.'], ['Take the top three to planning', 'With the product owner.']],
  },
  performance: {
    example: 'The SLA is p95 under 500 ms and errors under 1%. Last night\'s k6 run: checkout p95 540 ms (breach), search 310 ms, login 180 ms. Checkout was 420 ms a week ago; the trend turned on the day a new pricing call was added. Found in the pipeline, not by customers.',
    steps: [['Look for breaches', 'They are marked per endpoint.'], ['Open the trend', 'Find the day it changed.'], ['Check the SLA', 'Parameters › Performance SLA.']],
  },
  'cicd-pipeline': {
    example: 'Six stages. Build 3 min at 99%, unit tests 4 min at 98%, integration 11 min at 81%, security scan 6 min at 99%, package 2 min, deploy 3 min. Integration has the highest bottleneck score, 74: slowest and least reliable. Fixing it is worth more than tuning everything else together.',
    steps: [['Find the highest bottleneck score', 'Red above 70, amber above 40.'], ['Look at 14 days of executions', 'Is it new?'], ['Read the delivery metrics', 'Lead time and deployment frequency below.']],
  },
  'developer-productivity': {
    example: 'Team tiles for Checkout: PR merge time 31 hours (target 4), review turnaround 26 hours (target 2), focus time 2.4 hours a day (target 5), meetings 3.6 hours a day. The recommendation: "Reviews wait more than a day: agree a review window and a rota." Nothing here names a person.',
    steps: [['Read the team tiles', 'Which input is furthest from target?'], ['Read the recommendation', 'It is about the environment.'], ['Decide about your own switch', 'At the top of the page; off by default.']],
  },
  'wellbeing-pulse': {
    example: 'Period closed: 9 of 11 answered (82%). Score 58, watch. By statement: workload 2.9, focus time 2.4, support 4.3, energy 3.0, outlook 3.4. Focus time is the problem, not the team. They agree on meeting-free mornings; two periods later focus time is 3.5 and the score 67.',
    steps: [['Answer it yourself', 'Five statements, one minute.'], ['Read the lowest statement', 'It names the problem.'], ['Check the response rate', 'Below half, ask why.'], ['Discuss it with the team', 'Within a week of the result.']],
  },
  'business-impact': {
    example: 'Payments, this month: quality below target 6,000 to 14,000; open technical debt 6,170; downtime 5,250 (35 minutes at 150); support tickets 2,400. "Where to put the money first" ranks the notification service fix first by return on cost. What-if: raising coverage by 5 points is associated with 2,000 to 7,500 a month, "some evidence".',
    steps: [['Open "How this works"', 'Once, to know what the page claims.'], ['Read Money', 'Where it goes, what a fix returns.'], ['Check the evidence labels', 'Ignore "not significant".'], ['Try one What-if', 'On the metric you might invest in.']],
  },
  'team-rankings': {
    example: 'Digital Banking has six teams. Ranked by build time: Payments 9 min, Cards 12, Mobile 14, Ledger 21, Search 24, Onboarding 31. Onboarding\'s lead asks Payments how they cache dependencies; a month later Onboarding is at 17.',
    steps: [['Choose the KPI', 'One you want to improve.'], ['Find the top team', 'Ask them how.'], ['Watch your own trend', 'It matters more than the rank.']],
  },
  reports: {
    example: 'For the monthly steering meeting the QA lead generates the Payments report: QA score 84 with high confidence, 14 KPIs with target and status, dated 30 November. It takes ten seconds and replaces a slide deck built from screenshots.',
    steps: [['Choose the team', 'In the scope bar.'], ['Generate', 'A dated PDF.'], ['Or use Download PDF', 'On any page, for that page as you see it.']],
  },
  users: {
    example: 'A Scrum Master joins to serve Payments and Cards in Digital Banking and Ledger in Finance Systems. One invitation: role Scrum Master on Payments, then "Add a team or department" twice. The summary lists the three. They accept, choose a password and see exactly those three teams.',
    steps: [['Invite', 'E-mail, role, where it applies.'], ['Add more places', 'One row per further team or department.'], ['Read the summary', 'It is what the person will get.'], ['Check the chips later', 'Add or remove an assignment at any time.']],
  },
  teams: {
    example: 'After a reorganisation Search splits into Search and Discovery. The manager creates Discovery, names its lead and moves four people. The platform engineer maps the two repositories to the right teams in the Exporter. From the next run the numbers are separate.',
    steps: [['Create the team', 'Name, department, lead.'], ['Add its people', 'From Users.'], ['Map its sources', 'In the Exporter.']],
  },
  departments: {
    example: 'Finance Systems moves from Operations to Digital Banking. "Move team" shows what changes: the manager who will see it, the targets it will inherit. After confirming, history is kept and the change is in Activity with an undo.',
    steps: [['Create departments', 'One per real unit.'], ['Assign managers', 'One or more per department.'], ['Move teams when reality changes', 'Read the preview first.']],
  },
  roles: {
    example: 'A super admin opens "Scrum Master" from the recommended roles: software-engineer level plus team data, sending the survey and survey comments. They untick survey comments, save, and later add the money view for one company-wide coach by creating a second role. Both changes are in Activity.',
    steps: [['Read the five levels', 'What each comes with.'], ['Use a recommended role', 'It opens pre-filled.'], ['Adjust the six permissions', 'Or go back to recommended.'], ['Edit later', 'Everyone holding the role follows.']],
  },
  activity: {
    example: 'An auditor asks who gave a contractor access to Payments. Filter by the contractor: "Added Viewer of Payments, by A. Rahman, 3 November 10:42". The contractor left last week; the assignment was removed on the 21st, also recorded.',
    steps: [['Filter by person or date', 'Find the change.'], ['Open it', 'Before and after.'], ['Undo if it was a mistake', 'Refused, with the reason, if something newer depends on it.']],
  },
  'user-activity': {
    example: 'Four weeks after rollout: 143 of 212 people signed in, the team page was opened 1,900 times, Time lost 310, Business impact 12. Two teams never opened their page. That is where the next training session goes.',
    steps: [['Filter to the last 30 days', 'Views by page.'], ['Find who has not signed in', 'Adoption first.'], ['Filter failed sign-ins', 'For anything unusual.']],
  },
  'admin-console': {
    example: 'Exporter status: last seen 4 minutes ago, version 0.6.0. GitHub Actions last success 4 minutes ago; Jira last success 3 hours ago (its interval is 4 hours); PagerDuty failed twice, "401". The token expired; a new one in the setup page fixes it on the next run.',
    steps: [['Create an API key', 'Name it after where it runs.'], ['Follow the Exporter steps', 'Docker, Kubernetes or Node.'], ['Run preview, then sync', 'Nothing is sent by preview.'], ['Watch the status', 'Last seen and per-source results.']],
  },
  'manual-metrics': {
    example: 'During a two-week trial a lead types the team\'s coverage (71.5%), flakiness (3%) and deployments per week (4), backdated to the last three Mondays. The team page fills with scores and trends within the hour. When the Exporter is connected, the typed values give way to calculated ones.',
    steps: [['Choose the team', 'You see the teams you may write.'], ['Enter the KPIs you know', 'Backdate if needed.'], ['Check the team page', 'The values are there, marked "manual".']],
  },
  'upload-files': {
    example: 'A QA lead drops a zip with 40 JUnit files, an lcov report and a Jira CSV. The preview: 1,842 test results, coverage for 311 files, 96 issues; 4 rows left out (no team). After confirming, the team has pass rate, flaky tests, coverage by file and escape rate.',
    steps: [['Drop the files', 'Types are detected.'], ['Read the preview', 'Fields kept and rows left out.'], ['Confirm', 'Metrics appear as for connected data.']],
  },
  'update-frequency': {
    example: 'Payments releases daily: the form proposes pipelines every 15 minutes, deployments and incidents 15 minutes, issues hourly, pull requests every 4 hours. Ledger releases monthly: pipelines daily, incidents hourly, static analysis weekly. The platform engineer changes Ledger\'s issues from daily to 12 hours because its stand-up uses them.',
    steps: [['Open a team', 'Under "How often data is collected".'], ['Choose its release rhythm', 'The six intervals fill in.'], ['Change what you have a reason to', 'Or keep the recommendation.'], ['Save', 'It applies on the Exporter\'s next run.']],
  },
  parameters: {
    example: 'The company target for coverage is 80% with a watch level of 70%. The Platform team, which owns generated code, gets an override of 65%. The financial rates are set by finance: developer hour 85, downtime minute 150. Every page that shows a colour or a price now uses these.',
    steps: [['Set company targets', 'Start from the built-in values.'], ['Add overrides sparingly', 'With a reason.'], ['Set the financial rates', 'From finance.'], ['Turn on alerts', 'Rules and the Slack channel.']],
  },
  'ingestion-log': {
    example: 'Coverage for Search has not moved since Tuesday. The log shows Tuesday\'s delivery: partial, 11 items accepted, 1 refused, "coverage report: team id does not belong to this key". The repository was mapped to the wrong team. Fixed in the Exporter; Wednesday\'s delivery is accepted.',
    steps: [['Filter by team', 'And by result.'], ['Open a refused delivery', 'The reason is in plain words.'], ['Fix it at the source', 'Usually a mapping or a key.']],
  },
};
