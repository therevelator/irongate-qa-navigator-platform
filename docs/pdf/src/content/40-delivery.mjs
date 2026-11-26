/** Feature guides: the "Delivery" menu group. */
const EVERYONE = 'Every role, for the teams they are assigned to';
const DORA = ['DORA, Accelerate State of DevOps research', 'https://dora.dev/research/'];
const SPACE = ['Forsgren et al., "The SPACE of Developer Productivity", ACM Queue, 2021', 'https://queue.acm.org/detail.cfm?id=3454124'];
const DEVEX = ['Noda, Storey, Forsgren, Greiler, "DevEx: What Actually Drives Productivity", ACM Queue, 2023', 'https://queue.acm.org/detail.cfm?id=3595878'];
const DORA_GUIDE = ['DORA, guide to the software delivery metrics (pitfalls)', 'https://dora.dev/guides/dora-metrics/'];

export const features = [
  {
    slug: 'cicd-pipeline', file: '16-cicd-pipeline', group: 'Delivery', name: 'CI/CD pipeline', address: '/analytics/pipeline', access: EVERYONE,
    oneLine: 'Your pipeline as a flow of stages, with the duration and success rate of each one and the stage that holds delivery back.',
    does: [
      'Draws the stages in order with the **average duration** and **success rate** of each.',
      'Gives every stage a **bottleneck score** (0–100) from how much slower it is than the others and how often it fails; amber above 40, red above 70.',
      'Shows stage executions over the last 14 days, so a regression has a date.',
      'Feeds Pipeline health (successful runs ÷ completed runs, 30 days), the build-time KPI, the failing-stage evidence on the team page and the "slow stages" hours in Time lost.',
      'Shows the delivery metrics computed from the same data: deployment frequency, lead time, change failure rate, time to restore.',
    ],
    goodFor: [
      'Finding the one stage worth optimising instead of tuning everything.',
      'Seeing that a stage started failing more often after a tooling change.',
      'A baseline before a platform investment, and proof after it.',
    ],
    why: [
      'The pipeline is the path every change takes to production, so a slow or unreliable stage taxes every engineer on every change. DORA\'s research has shown for a decade that teams which deploy often with short lead times also have lower failure rates and recover faster: speed and stability go together, and the pipeline is where both are won or lost.',
      'Pipelines grow by addition, and it is rarely obvious which stage is the problem: the slowest one may be fine, while a medium-length stage that fails one time in five costs more. The bottleneck score combines both.',
    ],
    sources: [DORA],
    roles: [
      ['DevOps / Platform Engineer', 'Uses the bottleneck score to pick optimisation work; checks the result two weeks later.'],
      ['Team Lead', 'Sees which stage breaks the team\'s builds most.'],
      ['Engineering Manager', 'Follows deployment frequency and lead time per team.'],
      ['Release Manager', 'Checks pipeline stability before a release window.'],
      ['SRE', 'Follows change failure rate and time to restore.'],
    ],
    data: ['Pipeline runs with their stages from GitHub Actions, GitLab CI, Jenkins, Azure DevOps or Bitbucket, read by the Exporter. Deployments with their commits and incidents from PagerDuty or Opsgenie complete the delivery metrics.'],
    read: ['Fix the highest bottleneck score, not the longest bar.', 'Lead time is commit to production; it includes waiting, not only pipeline minutes.'],
    limits: ['It does not change your pipeline definitions.'],
    related: ['Time lost', 'Flaky tests', 'Test execution'],
  },
  {
    slug: 'developer-productivity', file: '17-developer-productivity', group: 'Delivery', name: 'Developer productivity', address: '/analytics/productivity',
    access: 'Every role sees their own row and the team summary; other people\'s rows need the "Individual developer metrics" permission and each person\'s own opt-in',
    oneLine: 'How the working environment treats your developers: review waits, focus time, meetings and interruptions, as a team picture first.',
    does: [
      'Shows **team tiles**: PR merge time, code review turnaround, focus time, meeting time and context switches, each against a target.',
      'Calculates **workload balance** and a burnout-risk signal for the team from those inputs.',
      'Shows individual rows **only for people whose developer insights are on**, and only to roles that hold that permission. The switch is at the top of this page: off by default, each person turns their own on or off. Everyone always sees their own row.',
      'Records every change of that switch in the change history, including when someone who administers the account sets it.',
      'Gives rule-based **recommendations** aimed at the environment: shorten review queues, protect focus blocks, cut meeting load.',
      'Keeps team figures k-anonymous: a summary of too few people is not shown.',
    ],
    goodFor: [
      'Seeing that reviews wait a day on this team and two hours on that one.',
      'A team agreeing on working habits (review within four hours, meeting-free mornings) and seeing whether they hold.',
      'An individual privately checking their own week.',
    ],
    why: [
      'Research on developer experience points at three things that drive how productive developers are: fast feedback loops, low cognitive load and uninterrupted flow. All three are properties of the environment a person works in, and all three can be seen in data teams already have: how long a pull request waits, how fragmented the calendar is.',
      'The same research is firm about misuse. The authors of the SPACE framework state that productivity cannot be reduced to a single metric and that activity metrics should never be used alone to reward or penalise developers. That is why this page is built team-first, why individual data is off until the person turns it on, and why the recommendations are about the environment and not about the person.',
    ],
    sources: [DEVEX, SPACE],
    roles: [
      ['Software Engineer', 'Looks at their own row; decides whether to opt in.'],
      ['Team Lead', 'Uses the team tiles to propose working agreements; uses opted-in rows for coaching conversations only.'],
      ['Engineering Manager', 'Compares review waits and meeting load across teams; fixes the system.'],
      ['Scrum Master', 'Brings focus time and context switches to the retrospective as impediments.'],
      ['HR / People partner', 'Does not use this page: wellbeing is the anonymous pulse.'],
    ],
    data: ['Pull-request times from GitHub, GitLab, Bitbucket or Azure DevOps; meeting and focus time from calendar free/busy (start and end of busy blocks only, never a title or attendee). People arrive as a pseudonym computed inside your network, and only when your company enables developer metrics in the Exporter.'],
    read: ['Read the team tiles first. An individual row without the team context misleads.', 'Long review waits and many context switches usually have one cause: too much work in progress.'],
    limits: [
      'Not for performance review, ranking or pay decisions.',
      'In the EU, individual data at work has legal conditions beyond a person\'s opt-in (GDPR; works-council rights in some countries). Agree the use with your data protection officer and employee representatives before enabling it.',
    ],
    related: ['Wellbeing pulse', 'Time lost', 'Roles'],
  },
  {
    slug: 'wellbeing-pulse', file: '18-wellbeing-pulse', group: 'Delivery', name: 'Wellbeing pulse', address: '/analytics/pulse',
    access: 'Every team member answers and sees the team result; sending the survey needs the "Send the wellbeing survey" permission; comments need "Wellbeing survey comments"',
    oneLine: 'Five anonymous questions, asked regularly, that tell you how the team is doing before the delivery numbers do.',
    does: [
      'Asks five statements on a 1–5 scale: manageable workload, time for focused work, support from the team, energy at the end of the day, outlook for the coming weeks. One optional comment.',
      'Turns the answers of a closed period into a **0–100 score** with bands (on target from 70, watch from 50) and a trend over up to twelve periods.',
      'Shows a result **only with three or more answers**; below that it says "Not shown".',
      'Runs every week, two weeks, month or quarter per team; can be sent automatically.',
      'Lets the lead **send the survey** and see the response rate. Members who have not answered get a banner and e-mail reminders; after a delay you set (5 days by default) the lead or manager is told **who has not answered yet**, never what anyone answered.',
      'Feeds the Wellbeing indicator of the Overview and 20% of Engineering health.',
    ],
    goodFor: [
      'An early warning: wellbeing usually drops weeks before quality and delivery do.',
      'Checking the human cost of a crunch, a reorganisation or a tooling change.',
      'Giving quiet team members a safe way to be heard.',
    ],
    why: [
      'Delivery metrics describe the work; they say nothing about the people doing it until the damage shows as defects, missed dates and resignations. DORA\'s research has repeatedly linked burnout with organisational conditions such as unstable priorities, and found better performance in teams with a healthy culture. The only way to know how people are is to ask them, regularly, in a way they trust.',
      'Trust is the whole design. Answers are stored without a person or a time, so they cannot be matched to anyone; the survey itself tells people that their manager can see whether they responded, not what they answered. Results are hidden below three responses, comments are visible only to roles given that permission, and there is no import: nobody can answer for someone else. The score is never built from activity data.',
    ],
    sources: [DORA],
    roles: [
      ['Every team member', 'Answers in under a minute; sees the team result.'],
      ['Team Lead / Scrum Master', 'Sends the survey, reminds, reads the result with the team in the retrospective.'],
      ['Engineering Manager', 'Follows the trend per team; acts on the organisational causes.'],
      ['HR / People partner', 'Reads team and department trends as an engagement signal; never individual answers.'],
      ['CTO', 'Sees company wellbeing as one of the five executive indicators.'],
    ],
    data: ['Only the answers given by the people themselves in QE Navigator. Response rate = answers ÷ members the survey was e-mailed to.'],
    read: ['Look at the trend and at the lowest of the five statements: that one names the problem.', 'A low response rate is a result too: ask why people do not answer.'],
    limits: ['No individual answers, ever.', 'Whether someone has answered is known (it is how reminders work); what they answered is not.', 'A three-answer minimum protects anonymity; very small teams may prefer a higher bar and a longer period.'],
    related: ['Team page', 'TV mode', 'Developer productivity'],
  },
  {
    slug: 'business-impact', file: '19-business-impact', group: 'Delivery', name: 'Business impact', address: '/analytics/business-impact',
    access: 'Every role for their team; the cross-team roll-up and money on the Executive summary need the "Money at risk" permission',
    oneLine: 'What quality problems cost in money, what fixing them is worth, and where to spend first, with honest statistics and visible assumptions.',
    does: [
      '**Money**: where money is going now (quality below target, open technical debt, incidents and downtime, support tickets, customers leaving), what you gain when each issue is fixed, and where to put the money first by gain or by return on cost.',
      '**What-if**: move a metric and see the projected monthly change as a range.',
      '**Details**: revenue associated with each quality metric, monthly trends, a correlation matrix and a written summary.',
      '**All teams**: the roll-up across the teams in your scope.',
      '**How this works** on every tab, and **How this was calculated** on every figure: formula, inputs, sample size.',
      'Labels evidence: strong, some, company-wide, or not significant. A figure that is not significant is not used.',
    ],
    goodFor: [
      'Putting quality on the same page as revenue in a budget conversation.',
      'Ranking improvements by money, not by loudness.',
      'A finance partner checking the assumptions instead of distrusting the conclusion.',
    ],
    why: [
      'Quality work competes for budget with features, and features come with a revenue story. Quality usually comes with a technical one. The result is predictable. This page gives quality a money story built from your own data: the cost of downtime at your rate, of tickets at your cost, of debt items at their measured cost of delay, and the revenue historically associated with each quality metric.',
      'It is careful on purpose. Amounts are ranges, the statistics are corrected for testing many pairs, the causes overlap so no grand total is shown, and the page states what it does not claim: correlation is not causation, and reaching a target does not guarantee the money.',
    ],
    roles: [
      ['CTO / VP Engineering', 'Uses Money and All teams for the budget case.'],
      ['CFO / Finance partner', 'Sets and reviews the rates under Parameters; reads the ranges.'],
      ['Product Owner', 'Uses What-if to weigh a quality investment against a feature.'],
      ['Head of QA', 'Shows which quality gap costs most.'],
      ['Engineering Manager', 'Picks the department\'s first fix by return on cost.'],
    ],
    data: ['Quality values come from the KPI history. Business figures (revenue, active users, churn, tickets, NPS) are entered monthly, because no engineering tool measures them. Rates come from Parameters → Financial and ROI settings. At least six months of paired values are needed before a relationship is shown.'],
    read: ['Always read the range, not the midpoint.', '"Company-wide evidence" means the team\'s own data was not enough and the pattern across teams was used.'],
    limits: ['Not a forecast and not proof of cause.', 'Without your business figures it shows only the costs it can compute from rates.'],
    related: ['Technical debt', 'Executive summary', 'Parameters'],
  },
  {
    slug: 'team-rankings', file: '20-team-rankings', group: 'Delivery', name: 'Team rankings', address: '/analytics/gamification', access: EVERYONE,
    oneLine: 'The teams of a department in order on the KPI you choose, as a starting point for learning from each other.',
    does: [
      'Ranks the active teams of the selected team\'s department by the latest QA score or by any KPI column.',
      'Gives equal values the same rank; lists teams without a value last, without a rank.',
      'Shows only real numbers: no points, badges or invented achievements.',
    ],
    goodFor: [
      'Finding who to ask: the team at the top of "build time" knows something.',
      'A friendly, visible reference inside a department.',
      'Seeing your own team\'s position move after an improvement.',
    ],
    why: [
      'People are curious about where they stand, and that curiosity can be put to work: the fastest way to improve a practice is to copy the team next door that already does it well. A simple ordered list answers "who is good at this?" without a meeting.',
      'Rankings need care. DORA lists turning metrics into targets as a pitfall, because teams then optimise the number instead of the outcome. So use this page to find practices to share, compare teams doing similar work, and keep each team\'s own trend as the measure that counts.',
    ],
    sources: [DORA_GUIDE],
    roles: [
      ['Team Lead', 'Looks up which team to learn from on a given KPI.'],
      ['Engineering Manager', 'Uses it to pair teams for knowledge sharing.'],
      ['Scrum Master / Agile Coach', 'Brings an example from a neighbouring team to the retrospective.'],
    ],
    data: ['The same latest KPI values as the Overview, limited to one department.'],
    read: ['A rank is a pointer to a conversation, not a verdict.'],
    limits: ['Teams only, never people.', 'Do not tie rewards to the rank.'],
    related: ['Compare teams', 'Overview'],
  },
  {
    slug: 'reports', file: '21-reports', group: 'Delivery', name: 'Reports', address: '/analytics/reports', access: EVERYONE,
    oneLine: 'A dated PDF of a team\'s quality for the people who will not sign in: reviews, steering meetings, customers, auditors.',
    does: [
      'Generates a PDF for the selected team: the QA score with its confidence and 14 KPIs (coverage, automation, escape rate, defect density, change failure rate, flakiness, code quality, deployments, lead time, time to restore, build time, first-time pass rate, commitment rate, availability).',
      'Shows each KPI with its target and status on the day of the report.',
      'Complements **Download PDF** in the top bar, which prints any page as you see it with every section opened.',
    ],
    goodFor: [
      'A monthly quality report without assembling it by hand.',
      'An attachment for a release decision or a customer review.',
      'A dated record of the state of quality for an audit trail.',
    ],
    why: [
      'Not everyone who needs the numbers will have, or should have, an account. Steering committees, customers and auditors want a document. Without a generator, someone builds that document by hand every month from screenshots, and it is out of date and slightly different each time.',
    ],
    roles: [
      ['QA Lead / Test Manager', 'Produces the test and quality report for the release or the month.'],
      ['Delivery / Programme Manager', 'Attaches it to the steering pack.'],
      ['Head of QA', 'Sends a consistent report per team to leadership.'],
      ['Auditor / Compliance', 'Receives dated evidence of quality controls.'],
    ],
    data: ['The same stored values as the team page at the moment of generation.'],
    read: ['The report states its date and the confidence of the score: quote both.'],
    related: ['Team page', 'Outcomes', 'Executive summary'],
  },
];
