/** Feature guides: the "Administration" menu group. */
const ADMINS = 'Super admins and managers';
const WRITERS = 'Roles with the "Actions, alerts and team data" permission, for their teams';

export const features = [
  {
    slug: 'admin-console', file: '28-admin-console', group: 'Administration', name: 'Admin console', address: '/admin-panel', access: ADMINS,
    oneLine: 'Where data gets connected: API keys, the QE Navigator Exporter, step-by-step CI instructions, and the status of every delivery.',
    does: [
      '**QE Navigator Exporter**: the setup steps for the small program that runs inside your network, reads your tools with your own read-only credentials and sends the records out over HTTPS. Docker, Kubernetes and plain Node instructions, and a configuration file with your company, department and team ids filled in.',
      '**Exporter status**: last seen, version (with a warning when outdated), each source\'s last success and failures.',
      '**API keys**: create, name and revoke the keys that deliveries use.',
      '**Connect your CI**: copy-paste steps for GitHub Actions, GitLab CI, Jenkins and Azure DevOps, a **Send test call** that validates a key and a sample without storing anything, and the last data received per team and kind.',
      '**Deployments and incidents**: steps per tool, and the mapping of services to teams.',
      'Organisation shortcuts (create users and teams) and, for trials, sample data.',
    ],
    goodFor: [
      'Getting the first real data in on day one.',
      'A security review: one page that states what is read, from where, and what leaves the network.',
      'Knowing at a glance whether data is still flowing.',
    ],
    why: [
      'The hardest part of any engineering-intelligence product is not the charts, it is getting the data, and the hardest part of that is trust: most companies will not hand a cloud product the tokens of their CI, tracker and incident tool, and many cannot open those systems to the internet at all. The Exporter turns the question around. It runs on your side, keeps your credentials on your side, makes only outbound calls, and sends raw records through a field allow-list: no source code, no failure output, no descriptions or comments.',
      'QE Navigator calculates everything from those records; the Exporter calculates nothing. That means one definition of every metric for every team, and a preview command that shows the exact JSON before anything is sent.',
    ],
    roles: [
      ['DevOps / Platform Engineer', 'Installs the Exporter, connects the tools, maps repositories and projects to teams, watches the status.'],
      ['Super admin', 'Creates API keys; follows which teams send data.'],
      ['Security / Compliance', 'Reviews the data flow and the permissions per tool (`exporter/SECURITY.md`).'],
      ['Engineering Manager', 'Checks that the department\'s teams are connected.'],
    ],
    data: [
      'The Exporter reads GitHub Actions, GitLab CI, Bitbucket, Jenkins, Azure DevOps, SonarQube, Jira, Linear, PagerDuty, Opsgenie, TestRail, Xray, Zephyr Scale, Google Calendar and Microsoft 365. Each run reads only the sources that are due according to the **collection frequency** of each team.',
    ],
    read: ['"Last seen" older than the shortest interval you set means the Exporter is not running.', 'An outdated version still works; update to get new sources and the schedule.'],
    limits: ['QE Navigator never connects to your tools itself: only the Exporter, an API call or an uploaded file brings data in.'],
    related: ['Update frequency', 'Data readiness', 'Ingestion log', 'Upload files'],
  },
  {
    slug: 'manual-metrics', file: '29-manual-metrics', group: 'Administration', name: 'Manual metrics', address: '/manual-metrics', access: WRITERS,
    oneLine: 'Type values in by hand for a trial, a demo or a team that is not connected yet.',
    does: [
      'Enters team KPIs by category, with calculators for composite ones such as the code-quality rating.',
      'Enters developer metrics per member, the business impact of debt items and pipeline stages.',
      'Backdates a value with a "recorded at" time; every entry goes through the same path as API data and appears in the ingestion log with source "manual".',
      'Shows values that come from raw data as read-only.',
    ],
    goodFor: ['Evaluating the product before any integration exists.', 'A team whose tool has no connector yet.', 'Recording a number that only exists in someone\'s spreadsheet.'],
    why: [
      'Waiting for integrations is the commonest reason an evaluation stalls. Manual metrics lets a company see its own numbers in the product within an hour. It is a bridge, not a destination: typed values are only as current as the last person who typed them, which is why a company in live operation can switch to **Live data only**, after which every metric comes from records and this page disappears.',
    ],
    roles: [
      ['Team Lead / QA Lead', 'Enters the team\'s figures during a trial.'],
      ['Engineering Manager', 'Fills gaps for teams without a connector.'],
      ['Super admin', 'Decides when the company moves to live data only.'],
    ],
    data: ['Whatever is typed, stored with the person, the time and the source "manual".'],
    limits: ['Hidden and refused in live-data-only mode.', 'Manual values cannot be opened down to records: there are none.'],
    related: ['Upload files', 'Admin console', 'Ingestion log'],
  },
  {
    slug: 'upload-files', file: '30-upload-files', group: 'Administration', name: 'Upload files', address: '/upload-files', access: WRITERS,
    oneLine: 'The zero-access way in: drop the files your tools already export and see exactly what will be stored before anything is.',
    does: [
      'Accepts test reports (JUnit, TRX, Cucumber), coverage (lcov, Cobertura, JaCoCo, Istanbul), static analysis (SARIF), and JSON or CSV exports of pipelines, deployments, incidents, issues and sprints, including Jira, Linear, PagerDuty and Opsgenie exports. Zip archives are unpacked.',
      'Detects the type from the content; lets you correct it and confirm the CSV column mapping.',
      '**Preview before storing**: which fields of which records will be kept, and which rows are left out and why.',
      'Runs the files through the same parsers, allow-list and calculations as the API, so uploaded data is indistinguishable from connected data.',
    ],
    goodFor: [
      'Companies that can give a cloud product no token and no network path at all.',
      'Loading history when a team joins.',
      'A proof of concept with real data in an afternoon.',
    ],
    why: [
      'Some organisations, especially regulated ones, cannot install an agent or issue a token during an evaluation, and some never will for certain systems. They can still export a file. Upload files makes that enough to get real metrics, and the preview answers the security question in the most direct way possible: here is exactly what we would keep.',
    ],
    roles: [
      ['QA Lead / Test Manager', 'Uploads test and coverage reports from a release.'],
      ['Team Lead', 'Uploads a tracker export to get sprint and defect metrics.'],
      ['DevOps / Platform Engineer', 'Backfills history before the Exporter takes over.'],
      ['Security / Compliance', 'Uses the preview to verify data minimisation.'],
    ],
    data: ['Only the fields the calculations need; people as a salted hash; never descriptions, comments or attachments. Issue and incident titles can be switched off company-wide.'],
    read: ['Read the "left out" list in the preview: it tells you what the export lacked.'],
    limits: ['A CSV has less than the API: for example, a Jira CSV has no status history, so blocked time cannot be calculated from it.', 'Uploads are as fresh as the last upload.'],
    related: ['Admin console', 'Ingestion log', 'Data readiness'],
  },
  {
    slug: 'update-frequency', file: '31-update-frequency', group: 'Administration', name: 'Update frequency', address: '/metric-intervals', access: ADMINS,
    oneLine: 'How often data is collected for each team, pre-filled with our recommendation for the way the team releases, and yours to change at any time.',
    does: [
      '**How often data is collected**: per team, choose the release rhythm (daily or continuous, weekly, every two weeks, monthly or less). The form fills in the recommended interval for each of six kinds of data.',
      'The six kinds: pipelines, tests and coverage · deployments and incidents · issues and sprints · static analysis · test management · pull requests and calendars.',
      'Every interval can be changed, from 15 minutes to 30 days, **during setup and at any time later**. "Back to recommended" restores our values; the page says when a team differs from them.',
      'The **Exporter reads this schedule** at the start of each run and skips a source that is not due.',
      '**Expected update frequency**: per metric, how old a value may be before it is marked stale. A team that chose to collect less often is not called stale because of that choice.',
    ],
    goodFor: [
      'A team that releases once a month not hammering its Jenkins every 15 minutes.',
      'Respecting API rate limits of your tools.',
      'Stale warnings that mean something.',
    ],
    why: [
      'Reading everything every 15 minutes is a sensible default and the wrong setting for most teams. Data is worth collecting about as often as it can change what someone does. A team deploying several times a day wants its pipelines read continuously; a team with a monthly release gains nothing from that and pays for it in API calls. The one exception is incidents: an outage matters the same day whatever the release rhythm, so we never recommend reading them less often than hourly.',
      'Choosing a rhythm instead of six numbers keeps the decision simple, and seeing the recommendation makes it safe: you start from values that make sense and change only what you have a reason to change.',
    ],
    roles: [
      ['Super admin / Head of QA', 'Sets the rhythm for each team during the initial setup (step 5 of the checklist).'],
      ['DevOps / Platform Engineer', 'Tunes intervals to the rate limits and load of each tool.'],
      ['Engineering Manager', 'Adjusts when a team changes how it releases.'],
      ['Team Lead (with the team-data permission)', 'Changes the team\'s own intervals.'],
    ],
    data: [
      'Recommended intervals. **Daily or continuous**: pipelines 15 min, deployments and incidents 15 min, issues 1 h, static analysis 1 day, test management 1 day, pull requests 4 h. **Weekly**: 1 h, 1 h, 4 h, 1 day, 1 day, 1 day. **Every two weeks**: 4 h, 1 h, 12 h, 1 day, 1 day, 1 day. **Monthly**: 1 day, 1 h, 1 day, 7 days, 7 days, 1 day. A team never set up reads everything every 15 minutes.',
    ],
    read: ['The summary line of a team shows only what differs from the default.', 'A change takes effect on the Exporter\'s next run; nothing needs restarting.'],
    limits: ['The schedule is honoured by Exporter 0.6.0 and later; an older Exporter keeps reading every run.', 'A manual run with `--force` or `--source` ignores the schedule on purpose.'],
    related: ['Admin console', 'Data readiness', 'Notifications & alerts'],
  },
  {
    slug: 'parameters', file: '32-parameters', group: 'Administration', name: 'Parameters', address: '/parameters-config', access: ADMINS,
    oneLine: 'The rules your numbers are judged by: targets, alert rules, notification channels, performance SLA and the financial assumptions.',
    does: [
      '**KPI targets** with history: a target is valid from a date, so old values are judged by the target of their time.',
      '**Alert rules**: KPI off target, QA score drop, metric stale, ingestion failures, with thresholds.',
      '**Notification channels**: Slack webhook, test message, "evaluate alerts now".',
      '**Performance SLA**: the p95 response time and error-rate thresholds for the Performance page.',
      '**Financial and ROI settings**: developer hourly rate, support ticket cost, downtime cost per minute, SLA penalty, revenue per user.',
      'Inheritance: a team setting overrides its department, which overrides the company, which overrides the built-in default. Each field says which page reads it.',
    ],
    goodFor: ['Making "green" mean what your company means by good.', 'Different ambitions for different teams without losing a company standard.', 'Money figures that finance recognises.'],
    why: [
      'A status colour is a comparison with a target, and a target that is not yours makes every colour meaningless. The same holds for money: a cost of downtime taken from a default convinces nobody. Setting these once, at the right level, is what turns the product from a generic dashboard into your company\'s instrument. Keeping target history is what keeps the past honest when ambitions rise.',
    ],
    roles: [
      ['Head of QA / QE Director', 'Owns the KPI targets and alert rules.'],
      ['CFO / Finance partner', 'Supplies and signs off the financial rates.'],
      ['Engineering Manager', 'Sets department-level overrides.'],
      ['SRE / Performance Engineer', 'Sets the performance SLA.'],
      ['Super admin', 'Configures Slack.'],
    ],
    data: ['Configuration stored in QE Navigator; every change is in the change history. The Slack webhook is stored encrypted and never shown again.'],
    read: ['"(default)" next to a rate means nobody has set it: set it before quoting money.'],
    related: ['Notifications & alerts', 'Business impact', 'Performance', 'Technical debt'],
  },
  {
    slug: 'ingestion-log', file: '33-ingestion-log', group: 'Administration', name: 'Ingestion log', address: '/ingestion-log',
    access: 'Roles with the "Activity and Ingestion logs" permission: super admins (company), managers (their departments)',
    oneLine: 'Every delivery of data, accepted, partial or rejected, with what it contained and why anything was refused.',
    does: [
      'Lists each request from the Exporter, the API, an upload or Manual metrics: when, from which source, for which team, how many items, the result.',
      'Shows the errors of rejected and partial deliveries in plain words.',
      'Gives a "last received" overview per source and team.',
      'Exports as CSV.',
    ],
    goodFor: ['Finding out in a minute why a number did not update.', 'Confirming that a new connector works.', 'Evidence of what data entered the system, and when.'],
    why: [
      'When a number looks wrong or old, the first question is always whether the data arrived. Without a log that question goes to support and takes a day. With it, the person who owns the pipeline answers it themselves: the delivery came at 09:14, twelve items were accepted, one was refused because the team id was wrong.',
    ],
    roles: [
      ['DevOps / Platform Engineer', 'Checks deliveries after changing a connector or a pipeline.'],
      ['Super admin', 'Follows which sources send, and how reliably.'],
      ['Engineering Manager', 'Sees the deliveries of the department\'s teams.'],
      ['Security / Compliance', 'Audits what was received.'],
    ],
    data: ['Written by QE Navigator for every delivery, whatever the path.'],
    read: ['Partial = some items stored, some refused: open it to see which.', 'Repeated rejections raise the "ingestion failures" alert.'],
    related: ['Admin console', 'Data readiness', 'Notifications & alerts'],
  },
];
