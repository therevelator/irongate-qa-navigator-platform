/** Feature guides: the "Quality" menu group. */
const EVERYONE = 'Every role, for the teams they are assigned to';
const GOOGLE_FLAKY = ['Google Testing Blog, "Flaky Tests at Google and How We Mitigate Them" (2016)', 'https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html'];
const ATLASSIAN_FLAKY = ['Atlassian Engineering, "Taming test flakiness"', 'https://www.atlassian.com/blog/how-we-build/taming-test-flakiness-how-we-built-a-scalable-tool-to-detect-and-manage-flaky-tests'];
const CISQ = ['CISQ, The Cost of Poor Software Quality in the US: A 2022 Report', 'https://www.it-cisq.org/the-cost-of-poor-quality-software-in-the-us-a-2022-report/'];

export const features = [
  {
    slug: 'flaky-tests', file: '12-flaky-tests', group: 'Quality', name: 'Flaky tests', address: '/analytics/flaky-tests', access: EVERYONE,
    oneLine: 'The tests that fail and pass on the same code, ranked by how much they hurt, with the runs that prove it.',
    does: [
      'Lists up to 50 flaky tests of the team, the worst first, with a flakiness score and the failure pattern.',
      'Detects them from your own test reports: a test is flaky when it **failed and passed on the same commit**.',
      'Shows the recent runs of each test (pass, fail, duration), so the pattern is visible: random, after a certain test, at a certain time, on a certain runner.',
      'Shows the root cause and suggested fix when one is known, and says plainly "unverified" when it is only a pattern-based hint.',
      'Feeds the team\'s flakiness KPI, the "failed runs that passed on a rerun" hours in Time lost, and the flaky-test recommendation on the team page.',
    ],
    goodFor: [
      'Deciding which five tests to fix or quarantine this sprint.',
      'Telling a real failure from noise when a pipeline goes red.',
      'Restoring trust in the test suite, so that red means stop.',
    ],
    why: [
      'A flaky test costs twice. It costs the time of every rerun and every investigation that ends in "it passed the second time". And it teaches the team to ignore red builds, which is how a real defect gets through. Google reported that about 1.5% of all its test runs were flaky and that almost 16% of its tests showed some flakiness; Atlassian attributed roughly 15% of failures in one of its largest repositories to flaky tests.',
      'Flakiness is hard to fight by feel, because each individual failure looks like bad luck. It becomes easy once the tests are listed with their evidence and ranked: a small number of tests usually causes most of the pain.',
    ],
    sources: [GOOGLE_FLAKY, ATLASSIAN_FLAKY],
    roles: [
      ['SDET / Test Automation Engineer', 'Works the list from the top; uses the run history to reproduce and fix.'],
      ['QA Lead / Test Manager', 'Tracks the count and the rate against the target; plans stabilisation work.'],
      ['Software Engineer', 'Checks whether the test that just failed their pipeline is a known flaky one.'],
      ['Release Manager', 'Reads a red pipeline correctly at go/no-go: known flaky or new failure?'],
      ['DevOps / Platform Engineer', 'Looks for infrastructure patterns: one runner, one time of day.'],
    ],
    data: ['From the JUnit-style test reports your pipelines already produce, read by the Exporter (GitHub Actions, GitLab CI, Jenkins, Azure DevOps, Bitbucket), sent through the API or uploaded as files. Failure messages and output are not stored. Freshness follows the team\'s collection frequency for "Pipelines, tests and coverage".'],
    read: ['The score combines how often and how recently the test flipped. Fix by score, not by annoyance.', 'A test with no flips in the recent runs is recovering: confirm before removing it from your list.'],
    limits: ['It does not rerun or quarantine tests in your CI: it tells you which ones deserve it.'],
    related: ['Test execution', 'Time lost', 'Findings', 'CI/CD pipeline'],
  },
  {
    slug: 'test-execution', file: '13-test-execution', group: 'Quality', name: 'Test execution', address: '/analytics/timeline', access: EVERYONE,
    oneLine: 'The history of your test runs: what ran, how long it took, what passed, and whether the suite is getting slower or less stable.',
    does: [
      'Shows every test run received as a timeline: suite, passed, failed, skipped, duration, branch and commit.',
      'Filters by suite, result and period; shows the flow of an execution from start to end.',
      'Makes trends visible: duration creeping up, pass rate drifting down, a suite that stopped running.',
      'Feeds the team KPIs "first-time pass rate" and "build time", and the slowest-tests evidence on the team page.',
    ],
    goodFor: [
      'Noticing that the regression suite takes twice as long as in spring.',
      'Evidence for a release decision: what was run on this build, and with what result.',
      'Spotting a suite that silently stopped reporting.',
    ],
    why: [
      'Test suites degrade slowly. Nobody decides to make the suite ten minutes slower; it happens one test at a time, and each week looks like the week before. The cost shows up as longer feedback, larger batches and later releases. A timeline makes the slow change visible while it is still cheap to reverse.',
      'It is also the record of what was actually tested. When someone asks after an incident whether the change was tested, the answer is a run with a date, a commit and a result.',
    ],
    roles: [
      ['QA Lead / Test Manager', 'Monitors pass rate and duration against exit criteria; reports test progress.'],
      ['SDET', 'Finds the runs where duration jumped and the tests responsible.'],
      ['Release Manager', 'Confirms the suites that must pass have run on the release candidate.'],
      ['Auditor / Compliance', 'Reads the run history as evidence that testing happened before release.'],
    ],
    data: ['One row per test report received from your CI. Stored: counts, durations, names of suites and tests, branch and commit. Not stored: failure messages, logs or output.'],
    read: ['Look at the trend line of duration first, then at the outliers.', 'A gap in the timeline is a pipeline that did not run or did not report.'],
    related: ['Flaky tests', 'CI/CD pipeline', 'Reports'],
  },
  {
    slug: 'technical-debt', file: '14-technical-debt', group: 'Quality', name: 'Technical debt', address: '/analytics/technical-debt', access: EVERYONE,
    oneLine: 'Debt as a list with a price: what each item costs per month to leave alone, what it costs to fix, and when the fix pays back.',
    does: [
      'Lists the team\'s debt items with severity, status, effort, **monthly cost of delay**, **ROI** and **payback** in months.',
      'Calculates a **technical debt score** (0–100, lower is better) from the open items by severity.',
      'Plots effort against cost, so the cheap fixes with a high cost of delay stand out.',
      'Uses your own rates (developer hour, support ticket, downtime minute, SLA penalty, revenue per user) from Parameters; a built-in default is always labelled as a default.',
      'Feeds **Tech debt health** on the Overview and the technical-debt recommendation on the team page; the code-quality findings from static analysis (new, fixed, by rule) are in the team page\'s Evidence.',
    ],
    goodFor: [
      'A debt conversation with product in the language of return: "40 hours, pays back in two months".',
      'Choosing which debt to pay first, and which to consciously leave.',
      'Showing that debt is going down, or that it is not.',
    ],
    why: [
      'Technical debt loses every prioritisation meeting in which it is described as "we should clean this up". It wins when it is described as a cost: this module produces twelve support tickets a month and forty minutes of downtime. CISQ estimated the accumulated technical debt of US software at about 1.5 trillion dollars in 2022; the number is abstract, the mechanism is not: unpaid debt charges interest in incidents, tickets and slower change.',
      'The page makes the interest explicit per item, with your own cost assumptions, so paying debt is weighed like any other investment.',
    ],
    sources: [CISQ],
    roles: [
      ['Team Lead / Tech Lead', 'Keeps the list honest; brings the top-ROI items to planning.'],
      ['Product Owner', 'Sees the monthly cost of delay next to the effort and makes room in the backlog.'],
      ['Engineering Manager', 'Balances feature and debt capacity with numbers.'],
      ['CTO', 'Follows tech debt health across the company as one of the five executive indicators.'],
      ['CFO / Finance partner', 'Checks the cost assumptions behind the figures.'],
    ],
    data: ['Code-quality findings come from static analysis (SonarQube, SARIF reports) through the Exporter. Debt items and their impact inputs (tickets, downtime, affected users) are recorded per item. Cost rates come from Parameters → Financial and ROI settings.'],
    read: ['ROI = (yearly savings − investment) ÷ investment. Payback = investment ÷ monthly cost of delay.', 'A figure built on default rates is marked: set your own before presenting it.'],
    limits: ['The cost of delay is as good as the inputs you record for the item.'],
    related: ['Business impact', 'Parameters', 'Team page'],
  },
  {
    slug: 'performance', file: '15-performance', group: 'Quality', name: 'Performance', address: '/analytics/performance', access: EVERYONE,
    oneLine: 'Response times and error rates per endpoint from your load tests, checked against your SLA on every run.',
    does: [
      'Shows per day and endpoint the **p50, p95 and p99** response time, throughput and error rate of the latest load-test run.',
      'Marks an endpoint **in breach** when its p95 is above your SLA (default 500 ms) or its error rate above your threshold (default 1%).',
      'Shows the trend per endpoint, so a regression is visible on the day it appears.',
      'Reads the result files your pipelines already keep: k6, JMeter and Gatling.',
    ],
    goodFor: [
      'Catching a performance regression in the pipeline instead of in production.',
      'A go/no-go input: no endpoint in breach on the release candidate.',
      'Knowing which endpoints are closest to the limit before a traffic peak.',
    ],
    why: [
      'Performance problems are among the most expensive to find late, because they appear under real load, in front of customers, and often need design changes to fix. Most teams already run load tests; far fewer look at the results of every run, because the results sit in a CI artifact nobody opens.',
      'This page opens them for you, every run, and compares them with the SLA you set once.',
    ],
    roles: [
      ['SRE / Performance Engineer', 'Watches p95 and error rate per endpoint; investigates the first breach.'],
      ['Release Manager', 'Checks for breaches on the candidate build.'],
      ['Team Lead', 'Sees whether the last change slowed an endpoint.'],
      ['Product Owner', 'Knows which user journeys are at risk before a campaign.'],
    ],
    data: ['Load-test result files (a k6 summary export, JMeter `statistics.json`, Gatling `stats.json`) read by the Exporter from CI artifacts, or uploaded. The SLA thresholds are under Parameters → Performance SLA.'],
    read: ['p95 is the number to manage: 95% of requests were faster than this.', 'One breach on one day is a signal to look; a rising trend is a signal to act.'],
    limits: ['It reports your load tests; it is not production monitoring.'],
    related: ['Parameters', 'CI/CD pipeline', 'Reports'],
  },
];
