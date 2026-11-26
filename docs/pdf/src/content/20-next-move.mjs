/** Feature guides: the "Next move" menu group. */
const EVERYONE = 'Every role, for the teams they are assigned to';
const DX_2024 = ['Atlassian & DX, State of Developer Experience 2024', 'https://www.atlassian.com/blog/developer/developer-experience-report-2024'];

export const features = [
  {
    slug: 'time-lost', file: '08-time-lost', group: 'Next move', name: 'Time lost', address: '/time-lost', access: EVERYONE,
    oneLine: 'The engineering hours your teams lost last week, by cause, measured from records and not from opinions.',
    does: [
      'Shows the hours lost in the **last 7 days** and the trend over **12 weeks**, for your whole scope and per team.',
      'Splits them by cause: **slow pipeline stages**, **failed runs that passed on a rerun** (flaky tests), **blocked work**, **failed changes** (rollbacks and hotfixes) and **waiting for review**.',
      'Gives each team a state and **its one thing this week**: the single cause that costs most right now.',
      'Opens every figure down to the records: which stage, which runs, which issues were blocked and for how long.',
      'Says when a cause cannot be measured yet because its data is missing, and links to Data readiness.',
    ],
    goodFor: [
      'Turning "the pipeline feels slow" into "the integration stage cost us 31 hours last week".',
      'Choosing one improvement per team per week instead of ten.',
      'Making the case for platform or test-infrastructure work in a unit everyone understands: hours.',
      'Checking that an improvement actually gave the hours back.',
    ],
    why: [
      'Engineers lose a large part of the week to things that are not engineering: waiting for a pipeline, re-running a test that failed for no reason, waiting for a review, redoing a change that broke production. In the 2024 State of Developer Experience survey, 69% of developers said they lose eight hours or more a week to inefficiencies, and fewer than half believed their leaders were aware of it.',
      'Those hours are invisible in most reporting because no tool owns them: the CI server knows the durations, the tracker knows the blocked time, the code host knows the review wait. Time lost adds them up from the records, per cause, so the loss has a size and an owner. The figure is hours, deliberately not money: it is a measurement, and the conversion to money (with your own rates) lives in Business impact.',
    ],
    sources: [DX_2024],
    roles: [
      ['Scrum Master / Agile Coach', 'Brings "one thing this week" to the retrospective as the impediment to remove.'],
      ['DevOps / Platform Engineer', 'Looks at slow stages and reruns across teams to decide what to optimise in the shared pipeline first.'],
      ['Engineering Manager', 'Compares the causes across the department\'s teams; funds the fix that returns most hours.'],
      ['CTO / VP Engineering', 'Reads the 12-week trend: is the organisation getting its time back?'],
      ['Team Lead', 'Opens the records behind the team\'s biggest cause and creates an action from it.'],
    ],
    data: [
      'From raw records only: pipeline runs with stage durations, test reports, issue status history, deployments and incidents, pull-request times. The rules are documented in `docs/metrics_and_calculations.md`, section 11.',
      'Freshness follows each team\'s collection frequency. A team that reads pipelines once a day sees yesterday\'s reruns today.',
    ],
    read: [
      'Hours are a floor, not an estimate of everything: only what the records prove is counted.',
      'A cause shown as "not measured" is missing data, not zero loss.',
      'Compare a team with itself over the 12 weeks before comparing it with another team.',
    ],
    limits: ['Not a money figure and not a productivity score.', 'Never attributed to a person.'],
    related: ['Findings', 'Outcomes', 'CI/CD pipeline', 'Flaky tests', 'Data readiness'],
  },
  {
    slug: 'findings', file: '09-findings', group: 'Next move', name: 'Findings', address: '/findings', access: `${EVERYONE}; assigning an owner needs the "Actions, alerts and team data" permission`,
    oneLine: 'The concrete problems behind the lost hours, the costliest first, each with its evidence, a next step and a ticket ready to file.',
    does: [
      'Lists the findings of your scope ranked by hours per week: a named flaky test, a stage that doubled, a kind of work that stays blocked, a service whose deploys fail.',
      'Shows for each one the **records** that prove it, a concrete **next step**, and the expected gain.',
      'Includes the team\'s **recommendations** in the same list, so there is one backlog of improvements, not two.',
      'Has an **owner form** (who, by when) that creates a tracked action, and the **text of a ticket** to paste into your tracker.',
      'Keeps the state of each finding: suggested, accepted, in progress, done, dismissed with a reason.',
    ],
    goodFor: [
      'Going from a number to a named piece of work in one screen.',
      'A retrospective or quality review that ends with owners and dates.',
      'Giving an engineer everything needed to start: the evidence is attached, nobody has to reproduce the analysis.',
    ],
    why: [
      'Metrics rarely fail to show that there is a problem. What is missing is the step after: which problem exactly, what it costs, what to do, and who does it. Without that step a team looks at a red flakiness rate every sprint and nothing changes, because "reduce flakiness" is not a task anyone can pick up.',
      'A finding is a task someone can pick up. It is specific (this test, this stage), sized (hours per week), and comes with a next step and a ticket text. QE Navigator suggests; your team decides, and does the work in its own tools.',
    ],
    roles: [
      ['Team Lead / QA Lead', 'Triages the list weekly: accept, assign, or dismiss with a reason.'],
      ['Scrum Master', 'Uses the top finding as the retrospective\'s improvement item and records the owner.'],
      ['SDET / Engineer', 'Takes a finding, copies the ticket text, fixes the test or the stage.'],
      ['DevOps / Platform Engineer', 'Filters to pipeline findings across teams.'],
      ['Engineering Manager', 'Checks that the costliest findings have owners.'],
    ],
    data: ['Built from the same records as Time lost and from the team recommendations. Recalculated when new data arrives; a decided finding keeps the evidence it had when it was decided.'],
    read: ['Sorted by cost. Work from the top.', 'A dismissed finding stays visible with who dismissed it and why, and can be reopened.'],
    limits: ['It does not create tickets in your tracker by itself: it gives you the text.'],
    related: ['Time lost', 'Outcomes', 'Team page'],
  },
  {
    slug: 'outcomes', file: '10-outcomes', group: 'Next move', name: 'Outcomes', address: '/outcomes', access: EVERYONE,
    oneLine: 'Did it work? Every improvement from suggestion to verified result, judged by the metric and not by the person who did it.',
    does: [
      'Follows every finding and action through its states: suggested, accepted, in progress, done, **verified** or **did not hold**.',
      'Takes the verdict from the linked KPI **14 and 30 days after** the action was completed, compared with the baseline stored when it was created.',
      'Shows the hours or the metric gained per action, per team and in total.',
      'Prints as the **monthly outcomes report**.',
    ],
    goodFor: [
      'Showing leadership what the improvement work returned, with before and after.',
      'Learning which kinds of fixes hold and which bounce back.',
      'Keeping improvement work honest: "done" is not the end, "verified" is.',
    ],
    why: [
      'Improvement work is the first thing cut when a release is late, partly because its results are rarely shown. An action is closed, everyone moves on, and nobody checks whether the metric moved. Three months later the same problem is back and the team has lost faith in retrospectives.',
      'Outcomes closes that loop automatically. The baseline is stored when the action is created; the result is read from the data two and four weeks after it is done. Nobody types the outcome, so nobody can flatter it.',
    ],
    roles: [
      ['Head of QA / QE Director', 'Presents the monthly outcomes report: actions verified, hours returned.'],
      ['CTO / VP Engineering', 'Uses it to decide whether the improvement budget is paying.'],
      ['Scrum Master', 'Opens the retrospective with the outcome of the last one\'s action.'],
      ['Engineering Manager', 'Sees which teams finish what they start.'],
      ['CFO / Finance partner', 'Reads the verified results as the return on the improvement effort.'],
    ],
    data: ['Baselines and results are stored KPI values. "Improved" or "worse" means the metric moved by more than 2% of the baseline in its direction; otherwise "unchanged"; "no new data" when nothing was recorded in the window.'],
    read: ['"Did not hold" is useful information, not a failure of the person: the fix was not enough or something else changed.'],
    limits: ['It shows association in time, not proof of cause: another change in the same weeks can move the same metric.'],
    related: ['Findings', 'Team page', 'Reports'],
  },
  {
    slug: 'data-readiness', file: '11-data-readiness', group: 'Next move', name: 'Data readiness', address: '/data-readiness', access: EVERYONE,
    oneLine: 'Which data each team sends, which is stale or missing, what every gap blocks, and how much effort the fix is.',
    does: [
      'Shows per team and per source whether it is **connected**, **stale** or **missing**: pipelines and tests, deployments and incidents, issues and sprints, static analysis, test management, pull requests and calendars.',
      'Says **what each gap blocks** ("no incident data: time to restore and availability cannot be calculated") and the **fix with its effort**.',
      'Shows what the **Exporter saw** on its last run: sources found, items read, problems.',
      'Sums it up as a readiness level per team and for the scope.',
    ],
    goodFor: [
      'A rollout plan: which connector to add next for the most value.',
      'Explaining an empty tile without a support ticket.',
      'Knowing how far to trust a company average: built on how many teams with complete data?',
    ],
    why: [
      'Every analytics product is only as good as its inputs, and the commonest reason a dashboard is distrusted is a number that is silently based on half the data. QE Navigator never fills a gap with an estimate; it shows the gap. Data readiness is the list of those gaps, turned into a to-do list.',
      'It also makes onboarding incremental. You do not need every tool connected on day one: connect the CI, see what lights up, and let the page tell you what the next connection would unlock.',
    ],
    roles: [
      ['DevOps / Platform Engineer', 'Owns the page during rollout: connects sources in the Exporter until the teams are green.'],
      ['Super admin / Head of QA', 'Tracks rollout progress across departments.'],
      ['Team Lead', 'Sees why a metric is missing for the team and what to ask for.'],
      ['Security / Compliance', 'Sees exactly which systems are read, per team.'],
    ],
    data: ['From the ingestion records, the staleness rules (each team\'s collection frequency is respected, so data read once a day by choice is not called stale after an hour) and the heartbeat the Exporter sends on each run.'],
    read: ['Stale means older than twice the interval the team chose. Missing means never received.', 'Start with the gap that blocks the most metrics.'],
    related: ['Admin console', 'Update frequency', 'Ingestion log', 'Upload files'],
  },
];
