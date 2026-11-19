/**
 * Metric catalog: one entry per metric and per container shown on Team detail.
 *
 * Used by the "Show formulas & data sources" demo switch (MetricInfoModal). Formulas and
 * thresholds are imported from the code that computes / colours them, so this text cannot
 * drift from the calculation:
 *   - composite formulas: server/lib/metricFormulas.ts (QA score, tech debt, DDPS, burnout)
 *   - workload balance:   src/data/advancedFeatures.ts (WORKLOAD_BALANCE_FORMULA)
 *   - developer rules:    server/lib/developerHealth.ts (DEVELOPER_RULES_TEXT)
 *   - thresholds:         src/config/metricsConfig.ts (METRICS_CONFIG, QA_SCORE_THRESHOLDS)
 * The KPI keys are typed against KPI_COLUMNS (server/lib/kpiIngest.ts), so adding a KPI
 * column without a catalog entry is a type error.
 *
 * "productionSources" describe where each value would realistically come from in a
 * production setup. QE Navigator has no built-in connectors: those systems (or a small job
 * that reads them) push values through POST /api/ingest/kpis.
 */
import type { KpiColumn } from '../../server/lib/kpiIngest';
import {
  BURNOUT_DEFINITION,
  DDPS_FORMULA,
  QA_SCORE_FORMULA,
  QA_SCORE_THRESHOLDS,
  QA_SCORE_WEIGHTS,
  TECH_DEBT_ROI_FORMULA,
  TECH_DEBT_SCORE_FORMULA,
  TECH_DEBT_SEVERITY_WEIGHTS,
} from '../../server/lib/metricFormulas';
import { DEVELOPER_RULES_TEXT } from '../../server/lib/developerHealth';
import {
  REVENUE_SENSITIVITY_FORMULA, REVENUE_AT_STAKE_FORMULA, REVENUE_AT_RISK_DEBT_FORMULA, INCIDENT_COST_FORMULA, CHURN_REVENUE_FORMULA,
  SUPPORT_COST_FORMULA, DOWNTIME_GAP_FORMULA, WHAT_IF_FORMULA, REVENUE_ROLLUP_FORMULA, REVENUE_CAVEATS, REVENUE_MIN_PAIRED_MONTHS,
} from '../../server/lib/revenueImpact';
import { DDPS_BANDS, WORKLOAD_BALANCE_FORMULA } from './advancedFeatures';
import { K_ANONYMITY_RULE } from '../../server/lib/privacy';
import { PULSE_QUESTIONS, WELLBEING_BANDS, WELLBEING_FORMULA } from '../../server/lib/pulseRules';
import { METRICS_CONFIG, KPI_TARGETS, metricTargetText } from '../config/metricsConfig';
import type { MetricsConfig } from '../config/metricsConfig';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricKind =
  /** A value measured by an external system and stored as sent. */
  | 'measured'
  /** Calculated by QE Navigator from other stored values. */
  | 'computed'
  /** A model built from other inputs, not a measurement of the thing its name suggests. */
  | 'derived'
  /** A section of the page that shows several metrics or generated text. */
  | 'container';

export type MetricDirection = 'higher' | 'lower' | 'closer-to-1' | 'none';

export interface CatalogThreshold {
  /** Human text, e.g. "On target ≥ 80% · watch ≥ 70% · below that off target". */
  text: string;
  /** Single pass/fail target, e.g. "≥ 80%". */
  target?: string;
  /** Where the numbers live in code. */
  source: string;
}

export interface ProductionSource {
  system: string;
  /** The specific field, measure or API the value is read from. */
  detail: string;
}

export interface HowToSend {
  kind: 'ingest' | 'developer-metrics' | 'computed' | 'no-api';
  /** KPI_COLUMNS key for POST /api/ingest/kpis. */
  metricKey?: KpiColumn;
  /** One-line JSON body for POST /api/ingest/kpis. */
  example?: string;
  /** Where to enter it by hand in the app (if possible). */
  manual?: string;
  /** Free text for computed / non-ingestible entries. */
  note?: string;
}

export interface MetricCatalogEntry {
  key: MetricCatalogKey;
  kind: MetricKind;
  title: string;
  whyItMatters: string;
  howCalculated: string;
  /** Extra lines under the formula (inputs, rounding, caveats). */
  calculationNotes?: string[];
  unit: string | null;
  direction: MetricDirection;
  thresholds: CatalogThreshold | null;
  /** table.column (several for containers / computed values). */
  storedIn: string[];
  /** kpi_snapshots column whose field_sources entry describes the current value. */
  sourceColumn?: KpiColumn;
  /** For computed values: the stored inputs whose provenance is shown. */
  inputColumns?: KpiColumn[];
  whereToFindIt: string[];
  productionSources: ProductionSource[];
  howToSendIt: HowToSend;
  /** Other catalog entries worth opening from this one. */
  related?: MetricCatalogKey[];
}

export type ExtraCatalogKey =
  | 'qa_score'
  | 'technical_debt_score'
  | 'workload_balance'
  | 'wellbeing_survey'
  | 'burnout_risk'
  | 'ddps'
  | 'team_members'
  | 'team_recommendations'
  | 'developer_recommendations'
  | 'revenue_sensitivity'
  | 'revenue_at_stake'
  | 'revenue_at_risk'
  | 'revenue_rollup';

export type MetricCatalogKey = KpiColumn | ExtraCatalogKey;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const unitSuffix = (unit?: string) => (unit ? (unit.startsWith('%') || unit.startsWith('/') ? unit : ` ${unit}`) : '');

/** Thresholds straight from METRICS_CONFIG, in the words Team detail uses for the badges. */
const fromConfig = (key: keyof MetricsConfig, extra?: string): CatalogThreshold => {
  const c = METRICS_CONFIG[key];
  const u = unitSuffix(c.unit);
  const op = c.lowerIsBetter ? '≤' : '≥';
  const beyond = c.lowerIsBetter ? 'above' : 'below';
  return {
    text: `On target ${op} ${c.good}${u} · watch ${op} ${c.warning}${u} · ${beyond} that off target${extra ? ` · ${extra}` : ''}`,
    target: metricTargetText(key),
    source: `METRICS_CONFIG.${key} (src/config/metricsConfig.ts); a team or department override in Parameters replaces it`,
  };
};

const dir = (key: keyof MetricsConfig): MetricDirection => (METRICS_CONFIG[key].lowerIsBetter ? 'lower' : 'higher');

const ingest = (metricKey: KpiColumn, source: string, value: number, manual: string): HowToSend => ({
  kind: 'ingest',
  metricKey,
  example: JSON.stringify({ teamId: '<team id>', source, metrics: { [metricKey]: value } }),
  manual,
});

const pct = (w: number) => `${Math.round(w * 100)}%`;

/** Task sizing accuracy colour bands on Team detail: |ratio − 1| within these limits. */
export const SIZING_ACCURACY_TOLERANCE = { good: 0.15, warning: 0.3 } as const;

// Page / section names as they appear in the navigation.
const TD = 'Team detail';
const TD_HEADER = `${TD} → header tiles`;
const TD_QUALITY = `${TD} → Quality & testing`;
const TD_SPEED = `${TD} → Speed & efficiency`;
const TD_AGILE = `${TD} → Agile & process`;
const TD_RELIABILITY = `${TD} → Reliability & stability`;
const TD_MEMBERS = `${TD} → Team members`;
const OVERVIEW = 'Overview → team cards and the "needs attention" filter';
const OVERVIEW_CARDS = 'Overview → team cards';
const RANKINGS = 'Analytics → Team rankings';
const REPORTS = 'Analytics → Reports (PDF)';
const MANUAL_CURRENT = 'Manual metrics → Current metrics (super admin, team lead, manager)';
const UPDATE_FREQUENCY = 'Administration → Update frequency (expected interval; marks the value stale)';
const DEV_PRODUCTIVITY = 'Analytics → Developer productivity';
const PULSE_PAGE = 'Analytics → Wellbeing pulse';

const MANUAL = (section: string, card: string) =>
  `Manual metrics → ${section} → ${card} (POST /api/metrics/manual, recorded with source "manual")`;

const QA_WEIGHT_NOTE = (col: keyof typeof QA_SCORE_WEIGHTS) =>
  `Input to the QA score (weight ${pct(QA_SCORE_WEIGHTS[col])}).`;

// ---------------------------------------------------------------------------
// KPI columns (kpi_snapshots), one entry per KPI_COLUMNS key
// ---------------------------------------------------------------------------

const KPI_ENTRIES: { [K in KpiColumn]: Omit<MetricCatalogEntry, 'key' | 'storedIn' | 'sourceColumn'> } = {
  // ----- Quality & testing -----
  test_coverage: {
    kind: 'measured',
    title: 'Test coverage',
    whyItMatters:
      'Shows how much of the code is exercised by automated tests. Code that no test runs can break without anyone noticing until a customer does. ' +
      'Coverage does not prove tests are good, but a low or falling number is a reliable early warning that changes are shipping unchecked.',
    howCalculated: 'Test coverage % = lines executed by automated tests ÷ total executable lines × 100',
    calculationNotes: [
      'Stored as sent (0–100). QE Navigator does not recompute it.',
      QA_WEIGHT_NOTE('test_coverage') + ' The QA score is not calculated when coverage is missing.',
      `Overview "needs attention" when below ${KPI_TARGETS.coverage}% (KPI_TARGETS.coverage).`,
    ],
    unit: '%',
    direction: dir('testCoverage'),
    thresholds: fromConfig('testCoverage'),
    whereToFindIt: [TD_HEADER, TD_QUALITY, OVERVIEW, RANKINGS, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'SonarQube / SonarCloud', detail: '`coverage` measure: GET /api/measures/component?component=<project key>&metricKeys=coverage' },
      { system: 'JaCoCo (Java)', detail: 'jacoco.xml LINE counter: covered ÷ (covered + missed), published by the Jenkins Coverage plugin or a GitHub Actions artifact' },
      { system: 'Istanbul / nyc (JavaScript)', detail: 'coverage-summary.json → total.lines.pct, produced in the Jenkins or GitHub Actions test job' },
    ],
    howToSendIt: ingest('test_coverage', 'sonarqube', 78.4, MANUAL('Quality & testing', 'Test coverage')),
    related: ['qa_score', 'automation_coverage'],
  },
  test_flakiness_rate: {
    kind: 'measured',
    title: 'Test flakiness rate',
    whyItMatters:
      'A flaky test passes and fails on the same code. Every false failure costs an engineer time to investigate and a pipeline re-run, ' +
      'and after enough of them people stop trusting red builds, which is how real failures slip through.',
    howCalculated: 'Flakiness % = flaky test runs ÷ total test runs × 100',
    calculationNotes: [
      'A run counts as flaky when the same test both failed and passed on the same commit (typically across retries).',
      'Stored as sent (0–100).',
      `Overview "needs attention" when above ${KPI_TARGETS.flakiness}% (KPI_TARGETS.flakiness).`,
    ],
    unit: '%',
    direction: dir('testFlakinessRate'),
    thresholds: fromConfig('testFlakinessRate'),
    whereToFindIt: [TD_QUALITY, OVERVIEW, RANKINGS, REPORTS, 'Analytics → Flaky tests (related per-test data, not this team value)', MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'CI test reports (JUnit XML)', detail: 'Per-test <testcase> results across reruns on the same commit SHA: failed then passed = flaky' },
      { system: 'Jenkins', detail: 'GET /job/<name>/<build>/testReport/api/json (case status per build), grouped by the commit in the build\'s SCM data' },
      { system: 'GitHub Actions', detail: 'Re-run attempts of a workflow run (run_attempt) with their uploaded JUnit artifacts' },
    ],
    howToSendIt: ingest('test_flakiness_rate', 'jenkins', 3.2, MANUAL('Quality & testing', 'Test flakiness rate')),
    related: ['first_time_pass_rate', 'infrastructure_failures'],
  },
  defect_density: {
    kind: 'measured',
    title: 'Defect density',
    whyItMatters:
      'Normalises the bug count by the size of the codebase, so teams with large and small systems can be compared fairly. ' +
      'A rising density points to areas that need review, refactoring or better tests before they generate support load.',
    howCalculated: 'Defect density = confirmed bugs in the period ÷ (lines of code ÷ 1,000)',
    calculationNotes: ['Defects per thousand lines of code (KLOC). Stored as sent.'],
    unit: METRICS_CONFIG.defectDensity.unit ?? 'defects/KLOC',
    direction: dir('defectDensity'),
    thresholds: fromConfig('defectDensity'),
    whereToFindIt: [TD_HEADER, TD_QUALITY, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Jira', detail: 'Bug count: JQL `issuetype = Bug AND project = <key> AND created >= -30d` via GET /rest/api/3/search/jql (total)' },
      { system: 'SonarQube', detail: 'Code size: `ncloc` measure (non-comment lines) via GET /api/measures/component?metricKeys=ncloc, divided by 1,000' },
    ],
    howToSendIt: ingest('defect_density', 'jira', 0.42, MANUAL('Quality & testing', 'Defect density')),
    related: ['defect_escape_rate'],
  },
  defect_escape_rate: {
    kind: 'measured',
    title: 'Defect escape rate',
    whyItMatters:
      'The share of bugs that customers find instead of the team. It is the most direct measure of how well testing protects users: ' +
      'escaped defects cost far more to fix and damage trust, so this is one of the main inputs to the QA score.',
    howCalculated: 'Defect escape rate % = bugs found in production ÷ all bugs found × 100',
    calculationNotes: [
      'Stored as sent (0–100).',
      QA_WEIGHT_NOTE('defect_escape_rate') + ' The QA score uses (100 − escape rate).',
      `Overview "needs attention" when above ${KPI_TARGETS.escapeRate}% (KPI_TARGETS.escapeRate).`,
    ],
    unit: '%',
    direction: dir('defectEscapeRate'),
    thresholds: fromConfig('defectEscapeRate'),
    whereToFindIt: [TD_QUALITY, OVERVIEW, RANKINGS, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Jira', detail: 'Issues with issuetype = Bug, split by where they were found: the Environment field, a "found in" custom field or a label such as `production` (GET /rest/api/3/search/jql)' },
      { system: 'Incident / support tools (optional)', detail: 'Customer-reported bugs linked to Jira from Zendesk or ServiceNow, so they count as production bugs' },
    ],
    howToSendIt: ingest('defect_escape_rate', 'jira', 6.5, MANUAL('Quality & testing', 'Defect escape rate')),
    related: ['qa_score', 'defect_density'],
  },
  code_quality_score: {
    kind: 'measured',
    title: 'Code quality score',
    whyItMatters:
      'Summarises static-analysis findings on maintainability, reliability and security into one 0–100 number. ' +
      'Poor scores mean code that is slower and riskier to change, so it feeds the QA score and is a leading indicator of future defects.',
    howCalculated: 'Code quality = Maintainability rating × 0.40 + Reliability rating × 0.35 + Security rating × 0.25 (ratings A=100, B=80, C=60, D=40, E=20)',
    calculationNotes: [
      'That is the Manual metrics calculator; an integration may send its own 0–100 score. Stored as a whole number.',
      QA_WEIGHT_NOTE('code_quality_score'),
    ],
    unit: '/100',
    direction: dir('codeQualityScore'),
    thresholds: fromConfig('codeQualityScore'),
    whereToFindIt: [TD_QUALITY, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'SonarQube / SonarCloud', detail: '`sqale_rating`, `reliability_rating` and `security_rating` measures (1 = A … 5 = E) via GET /api/measures/component' },
      { system: 'SonarQube quality gate (optional)', detail: 'GET /api/qualitygates/project_status for a pass/fail check alongside the score' },
    ],
    howToSendIt: ingest('code_quality_score', 'sonarqube', 82, MANUAL('Quality & testing', 'Code quality score')),
    related: ['qa_score'],
  },

  // ----- Speed & efficiency -----
  avg_build_time_minutes: {
    kind: 'measured',
    title: 'Average build time',
    whyItMatters:
      'How long engineers wait for CI feedback on every change. Slow builds batch up work, encourage skipping checks and directly cap how often the team can ship. ' +
      'Cutting build time is usually one of the cheapest productivity wins.',
    howCalculated: 'Average build time = sum of build durations ÷ number of builds (minutes)',
    calculationNotes: ['Stored as a whole number of minutes.'],
    unit: 'min',
    direction: dir('avgBuildTimeMinutes'),
    thresholds: fromConfig('avgBuildTimeMinutes'),
    whereToFindIt: [TD_HEADER, TD_SPEED, REPORTS, 'Analytics → CI/CD pipeline (related per-stage durations)', MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Jenkins', detail: 'GET /job/<name>/api/json?tree=builds[duration,result,timestamp] (duration in ms) for completed builds' },
      { system: 'GitHub Actions', detail: 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/timing → run_duration_ms, or run_started_at → updated_at per run' },
      { system: 'GitLab CI', detail: 'GET /projects/:id/pipelines/:pipeline_id → duration (seconds)' },
    ],
    howToSendIt: ingest('avg_build_time_minutes', 'jenkins', 12, MANUAL('Speed & efficiency', 'Avg build time')),
    related: ['test_execution_time_minutes', 'parallel_test_efficiency'],
  },
  test_execution_time_minutes: {
    kind: 'measured',
    title: 'Test execution time',
    whyItMatters:
      'The time the automated test suite takes to run. A long suite slows every merge and deployment and tempts teams to run tests less often, ' +
      'which delays finding regressions.',
    howCalculated: 'Test execution time = duration of the full automated test suite (minutes)',
    calculationNotes: ['Stored as a whole number of minutes.'],
    unit: 'min',
    direction: dir('testExecutionTimeMinutes'),
    thresholds: fromConfig('testExecutionTimeMinutes'),
    whereToFindIt: [TD_SPEED, 'Analytics → Test execution (related per-suite run times)', MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'CI test reports (JUnit XML)', detail: '<testsuite time="…"> totals for the suite run' },
      { system: 'Jenkins', detail: 'GET /job/<name>/<build>/testReport/api/json → duration (seconds)' },
      { system: 'GitHub Actions', detail: 'Test job timing: GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs → started_at / completed_at of the test job or step' },
    ],
    howToSendIt: ingest('test_execution_time_minutes', 'github-actions', 18, MANUAL('Speed & efficiency', 'Test execution time')),
    related: ['parallel_test_efficiency', 'avg_build_time_minutes'],
  },
  deployment_frequency_per_week: {
    kind: 'measured',
    title: 'Deployment frequency',
    whyItMatters:
      'One of the four DORA delivery metrics. Teams that deploy often ship smaller changes, which are easier to review, test and roll back, ' +
      'so frequent deployment usually means both faster delivery and lower risk per release.',
    howCalculated: 'Deployment frequency = successful production deployments ÷ number of weeks in the period',
    calculationNotes: ['Stored as sent (deployments per week).'],
    unit: '/week',
    direction: dir('deploymentFrequencyPerWeek'),
    thresholds: fromConfig('deploymentFrequencyPerWeek'),
    whereToFindIt: [TD_SPEED, OVERVIEW_CARDS, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'GitHub deployments', detail: 'GET /repos/{owner}/{repo}/deployments?environment=production with deployment statuses (state = success)' },
      { system: 'Argo CD', detail: 'Application sync history: GET /api/v1/applications/{name} → status.history (one entry per successful sync)' },
      { system: 'Jenkins', detail: 'Successful builds of the production deploy job: GET /job/<deploy-job>/api/json?tree=builds[result,timestamp]' },
    ],
    howToSendIt: ingest('deployment_frequency_per_week', 'argocd', 6, MANUAL('Speed & efficiency', 'Deployment frequency')),
    related: ['lead_time_days', 'change_failure_rate', 'mttr_hours'],
  },
  lead_time_days: {
    kind: 'measured',
    title: 'Lead time for changes',
    whyItMatters:
      'A DORA metric: how long a committed change takes to reach customers. Short lead times let the business respond quickly to feedback, incidents and competitors; ' +
      'long ones usually reveal waiting steps such as manual approvals, queues or large batches.',
    howCalculated: 'Lead time = average(production deploy time − commit time) over the changes deployed in the period (days)',
    calculationNotes: ['Stored as sent (days, up to 99.99).'],
    unit: 'days',
    direction: dir('leadTimeDays'),
    thresholds: fromConfig('leadTimeDays'),
    whereToFindIt: [TD_SPEED, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'GitHub / GitLab', detail: 'Commit timestamps of the changes in each release: GET /repos/{owner}/{repo}/compare/{previous}...{deployed sha} (commit.author.date)' },
      { system: 'Deployment pipeline', detail: 'Production deploy time of that SHA from GitHub deployments, Argo CD sync history or the Jenkins deploy job' },
    ],
    howToSendIt: ingest('lead_time_days', 'github', 2.5, MANUAL('Speed & efficiency', 'Lead time for changes')),
    related: ['deployment_frequency_per_week'],
  },
  mttr_hours: {
    kind: 'measured',
    title: 'Mean time to recovery (MTTR)',
    whyItMatters:
      'A DORA metric: how quickly service is restored after a production failure. Failures will happen, so recovery speed often matters more to customers than failure count; ' +
      'it reflects alerting, runbooks and the ability to roll back.',
    howCalculated: 'MTTR = total time from incident start to recovery ÷ number of incidents (hours)',
    calculationNotes: ['Stored as sent (hours).'],
    unit: 'h',
    direction: dir('mttrHours'),
    thresholds: fromConfig('mttrHours'),
    whereToFindIt: [TD_HEADER, TD_SPEED, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'PagerDuty', detail: 'GET /incidents?service_ids[]=…&since=…: created_at → resolved time (from GET /incidents/{id}/log_entries, type resolve_log_entry)' },
      { system: 'Opsgenie', detail: 'GET /v2/alerts or incidents: createdAt → closed time from the alert/incident timeline' },
      { system: 'Deployment pipeline', detail: 'Rollback or hotfix deploy time from Jenkins / Argo CD / GitHub deployments when the recovery was a redeploy' },
    ],
    howToSendIt: ingest('mttr_hours', 'pagerduty', 1.5, MANUAL('Speed & efficiency', 'Mean time to recovery')),
    related: ['mtbf_hours', 'change_failure_rate'],
  },
  parallel_test_efficiency: {
    kind: 'measured',
    title: 'Parallel test efficiency',
    whyItMatters:
      'Shows how much of the theoretical speed-up from running tests on several workers is actually achieved. Low efficiency means paying for CI capacity ' +
      'that is waiting on slow shards, setup or shared resources instead of shortening feedback time.',
    howCalculated: 'Parallel efficiency % = (sequential time ÷ parallel wall-clock time) ÷ number of workers × 100',
    calculationNotes: ['Stored as sent (0–100).'],
    unit: '%',
    direction: dir('parallelTestEfficiency'),
    thresholds: fromConfig('parallelTestEfficiency'),
    whereToFindIt: [TD_SPEED, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'GitHub Actions', detail: 'Matrix / sharded test jobs: sum of job durations (sequential time) vs. first start → last finish (wall clock) from GET …/actions/runs/{run_id}/jobs' },
      { system: 'Jenkins', detail: 'Parallel stage timings from the Pipeline REST API: GET /job/<name>/<build>/wfapi/describe (stages[].durationMillis)' },
    ],
    howToSendIt: ingest('parallel_test_efficiency', 'github-actions', 72, MANUAL('Speed & efficiency', 'Parallel test efficiency')),
    related: ['test_execution_time_minutes'],
  },

  // ----- Agile & process -----
  sprint_velocity: {
    kind: 'measured',
    title: 'Sprint velocity',
    whyItMatters:
      'Story points the team completes per sprint. It is a planning tool, not a performance score: a stable velocity lets the team forecast delivery dates, ' +
      'while sudden changes signal disruption. Compare it only with the same team\'s history.',
    howCalculated: 'Velocity = sum of story points of issues Done at sprint close',
    calculationNotes: ['Stored as a whole number. No target: Team detail shows it without a status colour.'],
    unit: 'points',
    direction: 'none',
    thresholds: null,
    whereToFindIt: [TD_AGILE, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Jira Software (Agile REST API)', detail: 'GET /rest/agile/1.0/board/{boardId}/sprint?state=closed, then GET /rest/agile/1.0/sprint/{sprintId}/issue: sum the story points field (a custom field, e.g. customfield_10016) of issues in a Done status category' },
      { system: 'Jira Software velocity chart', detail: 'The board\'s Velocity report shows the same completed value per sprint' },
    ],
    howToSendIt: ingest('sprint_velocity', 'jira', 42, MANUAL('Agile & process', 'Sprint velocity')),
    related: ['sprint_commitment_rate', 'sprint_carryover'],
  },
  sprint_commitment_rate: {
    kind: 'measured',
    title: 'Sprint commitment rate',
    whyItMatters:
      'How much of what the team committed to at sprint planning was delivered. Stakeholders plan around those commitments, ' +
      'so a consistently low rate means unreliable dates, usually from over-commitment, unplanned work or blockers.',
    howCalculated: 'Commitment rate % = completed story points ÷ story points committed at sprint start × 100',
    calculationNotes: ['Can exceed 100% when more work than planned is finished. Stored as sent.'],
    unit: '%',
    direction: dir('sprintCommitmentRate'),
    thresholds: fromConfig('sprintCommitmentRate'),
    whereToFindIt: [TD_AGILE, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Jira Software sprint report', detail: 'Committed (scope at sprint start) vs. completed points per sprint' },
      { system: 'Jira Agile REST API', detail: 'Sprint issues from GET /rest/agile/1.0/sprint/{sprintId}/issue; scope at start needs each issue\'s changelog (Sprint field changes) from GET /rest/api/3/issue/{key}/changelog' },
    ],
    howToSendIt: ingest('sprint_commitment_rate', 'jira', 88, MANUAL('Agile & process', 'Sprint commitment rate')),
    related: ['sprint_velocity', 'sprint_carryover'],
  },
  sprint_carryover: {
    kind: 'measured',
    title: 'Sprint carryover',
    whyItMatters:
      'Committed work that was not finished and rolled into the next sprint. High carryover hides delays, inflates future sprints and is a common sign of oversized stories or work blocked on other teams.',
    howCalculated: 'Carryover % = story points not completed at sprint close ÷ committed story points × 100',
    calculationNotes: ['Stored as sent (0–100).'],
    unit: '%',
    direction: dir('sprintCarryover'),
    thresholds: fromConfig('sprintCarryover'),
    whereToFindIt: [TD_AGILE, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Jira Software (Agile REST API)', detail: 'Issues of the closed sprint not in a Done status category: GET /rest/agile/1.0/sprint/{sprintId}/issue, story points custom field' },
      { system: 'Jira sprint report', detail: '"Issues not completed" section of the sprint report' },
    ],
    howToSendIt: ingest('sprint_carryover', 'jira', 12, MANUAL('Agile & process', 'Sprint carryover')),
    related: ['sprint_commitment_rate'],
  },
  first_time_pass_rate: {
    kind: 'measured',
    title: 'First-time pass rate',
    whyItMatters:
      'The share of stories that pass QA without being sent back. Every rejection is rework for both developer and tester; ' +
      'a high rate means clear acceptance criteria and solid local testing, which shortens cycle time.',
    howCalculated: 'First-time pass rate % = stories with 0 QA rejections ÷ stories tested × 100',
    calculationNotes: ['Stored as sent (0–100).'],
    unit: '%',
    direction: dir('firstTimePassRate'),
    thresholds: fromConfig('firstTimePassRate'),
    whereToFindIt: [TD_AGILE, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Jira', detail: 'Issue changelog (GET /rest/api/3/issue/{key}/changelog): count status transitions from "In QA"/"In Test" back to "In Progress"; 0 = passed first time' },
      { system: 'Test management (optional)', detail: 'Xray or Zephyr Scale execution results per story: first execution status = PASS' },
    ],
    howToSendIt: ingest('first_time_pass_rate', 'jira', 84, MANUAL('Agile & process', 'First-time pass rate')),
    related: ['test_flakiness_rate'],
  },
  blocked_time_hours: {
    kind: 'measured',
    title: 'Blocked time',
    whyItMatters:
      'Hours that tickets spent waiting on something outside the team\'s control. It is pure waste in the delivery flow and usually points at dependencies, ' +
      'environments or approvals that management can fix.',
    howCalculated: 'Blocked time = Σ (unblocked time − blocked time) over the sprint\'s tickets (hours)',
    calculationNotes: ['Stored as a whole number of hours.'],
    unit: 'h',
    direction: dir('blockedTimeHours'),
    thresholds: fromConfig('blockedTimeHours'),
    whereToFindIt: [TD_AGILE, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Jira', detail: 'Issue changelog: time in a "Blocked" status, or between setting and clearing the Flagged field (Impediment), from GET /rest/api/3/issue/{key}/changelog' },
    ],
    howToSendIt: ingest('blocked_time_hours', 'jira', 6, MANUAL('Agile & process', 'Blocked time')),
    related: ['sprint_carryover'],
  },
  automation_coverage: {
    kind: 'measured',
    title: 'Test automation coverage',
    whyItMatters:
      'The share of test cases that run automatically instead of by hand. Automated tests run on every change at almost no cost, ' +
      'so higher automation means faster releases and less manual regression effort before each one.',
    howCalculated: 'Automation coverage % = automated test cases ÷ total test cases × 100',
    calculationNotes: [
      'Stored as sent (0–100).',
      `Overview "needs attention" when below ${KPI_TARGETS.automation}% (KPI_TARGETS.automation).`,
    ],
    unit: '%',
    direction: dir('automationCoverage'),
    thresholds: fromConfig('automationCoverage'),
    whereToFindIt: [TD_HEADER, TD_AGILE, OVERVIEW, RANKINGS, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'TestRail', detail: 'GET /index.php?/api/v2/get_cases/{project_id}: share of cases whose type or automation custom field marks them automated' },
      { system: 'Xray (Jira)', detail: 'Test issues by test type: Manual vs. Cucumber/Generic (automated)' },
      { system: 'Zephyr Scale', detail: 'Test cases by the "Automation" status / custom field via the Zephyr Scale REST API' },
    ],
    howToSendIt: ingest('automation_coverage', 'testrail', 68, MANUAL('Agile & process', 'Test automation coverage')),
    related: ['automation_roi', 'test_coverage'],
  },
  automation_roi: {
    kind: 'measured',
    title: 'Automation ROI',
    whyItMatters:
      'Compares the manual testing time automation saves with the time spent building and maintaining it. It tells leadership whether automation investment is paying back, ' +
      'and which suites cost more to maintain than they save.',
    howCalculated: 'Automation ROI % = (time saved − time invested) ÷ time invested × 100',
    calculationNotes: [
      'Calculated outside the app (or in the Manual metrics calculator) and stored as sent; can be negative. No target: shown without a status colour.',
    ],
    unit: '%',
    direction: 'higher',
    thresholds: null,
    whereToFindIt: [TD_AGILE, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Test management (TestRail / Xray)', detail: 'Time saved: automated executions × the case\'s manual estimate (TestRail `estimate` field)' },
      { system: 'Jira worklogs / Tempo', detail: 'Time invested: hours logged on automation work items (GET /rest/api/3/issue/{key}/worklog or Tempo worklogs API)' },
    ],
    howToSendIt: ingest('automation_roi', 'testrail', 145, MANUAL('Agile & process', 'Automation ROI')),
    related: ['automation_coverage'],
  },
  sizing_accuracy: {
    kind: 'measured',
    title: 'Task sizing accuracy',
    whyItMatters:
      'Compares actual effort with the estimate. Reliable estimates are what make sprint plans and release dates believable; ' +
      'a ratio far from 1.0 in either direction means plans are being built on numbers that do not hold.',
    howCalculated: 'Sizing accuracy = actual effort ÷ estimated effort (1.0 = perfect; < 1 overestimated, > 1 underestimated)',
    calculationNotes: ['Stored as a ratio (0–99.99).'],
    unit: '× estimate',
    direction: 'closer-to-1',
    thresholds: {
      text: `On target within ±${SIZING_ACCURACY_TOLERANCE.good} of 1.0 · watch within ±${SIZING_ACCURACY_TOLERANCE.warning} · otherwise off target`,
      target: `1.0 ± ${SIZING_ACCURACY_TOLERANCE.good}`,
      source: 'SIZING_ACCURACY_TOLERANCE (src/data/metricCatalog.ts), used by the Team detail tile',
    },
    whereToFindIt: [TD_HEADER, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Jira (time tracking)', detail: '`timespent` ÷ `timeoriginalestimate` (seconds) of resolved issues, via GET /rest/api/3/search/jql?fields=timespent,timeoriginalestimate' },
      { system: 'Tempo Timesheets (optional)', detail: 'Logged hours per issue from the Tempo worklogs API instead of Jira\'s timespent' },
    ],
    howToSendIt: ingest('sizing_accuracy', 'jira', 1.08, MANUAL('Agile & process', 'Task sizing accuracy')),
    related: ['sprint_commitment_rate'],
  },

  // ----- Reliability & stability -----
  change_failure_rate: {
    kind: 'measured',
    title: 'Change failure rate',
    whyItMatters:
      'A DORA metric: the share of production deployments that cause a failure needing a rollback, hotfix or incident. ' +
      'It measures whether speed is coming at the cost of stability, and it is one of the main inputs to the QA score.',
    howCalculated: 'Change failure rate % = deployments that caused a failure ÷ total deployments × 100',
    calculationNotes: [
      'Stored as sent (0–100).',
      QA_WEIGHT_NOTE('change_failure_rate') + ' The QA score uses (100 − change failure rate).',
    ],
    unit: '%',
    direction: dir('changeFailureRate'),
    thresholds: fromConfig('changeFailureRate'),
    whereToFindIt: [TD_RELIABILITY, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Deployment pipeline', detail: 'Total production deployments from GitHub deployments, Argo CD sync history or the Jenkins deploy job' },
      { system: 'PagerDuty / Opsgenie', detail: 'Incidents linked to a deployment (change events: PagerDuty Change Events API), or rollbacks / failed deployment statuses in the pipeline' },
      { system: 'Jira (optional)', detail: 'Hotfix issues linked to the release that introduced the failure' },
    ],
    howToSendIt: ingest('change_failure_rate', 'argocd', 8, MANUAL('Reliability & stability', 'Change failure rate')),
    related: ['qa_score', 'deployment_frequency_per_week', 'mttr_hours'],
  },
  mtbf_hours: {
    kind: 'measured',
    title: 'Mean time between failures (MTBF)',
    whyItMatters:
      'The average uptime between production failures. A higher MTBF means a more stable service and fewer interruptions for customers and on-call engineers; ' +
      'a falling MTBF is often the first sign that reliability work is being deferred.',
    howCalculated: 'MTBF = total operational hours ÷ number of failures (equals the operational hours when there were no failures)',
    calculationNotes: ['Stored as a whole number of hours.'],
    unit: 'h',
    direction: dir('mtbfHours'),
    thresholds: fromConfig('mtbfHours'),
    whereToFindIt: [TD_HEADER, TD_RELIABILITY, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'PagerDuty / Opsgenie', detail: 'Failure count and start times: GET /incidents (urgency high, per service) over the period' },
      { system: 'Monitoring (Datadog / Prometheus)', detail: 'Monitor or alert state changes to "down", e.g. Datadog monitor events or Prometheus alert history' },
    ],
    howToSendIt: ingest('mtbf_hours', 'pagerduty', 540, MANUAL('Reliability & stability', 'Mean time between failures')),
    related: ['mttr_hours', 'system_availability'],
  },
  system_availability: {
    kind: 'measured',
    title: 'System availability',
    whyItMatters:
      'The share of time the service was usable. It is what customers and SLAs care about: 99.9% still allows about 43 minutes of downtime a month, ' +
      'and each extra "nine" requires much more engineering investment.',
    howCalculated: 'Availability % = (total time − downtime) ÷ total time × 100',
    calculationNotes: ['Stored with 3 decimals (up to 100.000).'],
    unit: '%',
    direction: dir('systemAvailability'),
    thresholds: fromConfig('systemAvailability'),
    whereToFindIt: [TD_RELIABILITY, REPORTS, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Datadog SLOs', detail: 'GET /api/v1/slo/{slo_id}/history?from_ts=…&to_ts=… → overall.sli_value' },
      { system: 'Prometheus', detail: 'avg_over_time(probe_success{job="blackbox"}[30d]) × 100, or an SLO recording rule' },
      { system: 'Statuspage / uptime monitors', detail: 'Component uptime from Atlassian Statuspage, Pingdom or UptimeRobot' },
    ],
    howToSendIt: ingest('system_availability', 'datadog', 99.95, MANUAL('Reliability & stability', 'System availability')),
    related: ['mtbf_hours'],
  },
  infrastructure_failures: {
    kind: 'measured',
    title: 'Infrastructure failures',
    whyItMatters:
      'Test or pipeline failures caused by the infrastructure (agents, network, containers, test environments) rather than by the code. ' +
      'They waste engineering time and erode trust in CI, and they are fixed by platform work, not by developers changing code.',
    howCalculated: 'Infrastructure failures = count of test/pipeline failures classified as infrastructure-caused in the period',
    calculationNotes: [`Stored as a whole number. Thresholds are per ${METRICS_CONFIG.infrastructureFailures.unit?.replace('/', '') ?? 'month'}.`],
    unit: METRICS_CONFIG.infrastructureFailures.unit ?? null,
    direction: dir('infrastructureFailures'),
    thresholds: fromConfig('infrastructureFailures'),
    whereToFindIt: [TD_RELIABILITY, MANUAL_CURRENT, UPDATE_FREQUENCY],
    productionSources: [
      { system: 'Jenkins', detail: 'Failure causes from the Build Failure Analyzer plugin (categories such as agent lost, timeout, docker pull) per build' },
      { system: 'GitHub Actions', detail: 'Jobs that failed in runner setup or with runner errors (job conclusion + failed step name) from GET …/actions/runs/{run_id}/jobs' },
      { system: 'CI test reports (JUnit XML)', detail: 'Failures whose error message matches infrastructure patterns (connection refused, timeout, out of memory)' },
    ],
    howToSendIt: ingest('infrastructure_failures', 'jenkins', 2, MANUAL('Reliability & stability', 'Infrastructure failures')),
    related: ['test_flakiness_rate'],
  },
};

// ---------------------------------------------------------------------------
// Computed / derived metrics and page containers
// ---------------------------------------------------------------------------

const qaInputs = Object.keys(QA_SCORE_WEIGHTS) as Array<keyof typeof QA_SCORE_WEIGHTS & KpiColumn>;

const EXTRA_ENTRIES: { [K in ExtraCatalogKey]: Omit<MetricCatalogEntry, 'key'> } = {
  qa_score: {
    kind: 'computed',
    title: 'QA score',
    whyItMatters:
      'A single 0–100 health number for a team\'s quality, combining test coverage, escaped defects, failed changes and code quality. ' +
      'It lets leadership compare teams and spot decline at a glance; the inputs behind it show where to act.',
    howCalculated: QA_SCORE_FORMULA,
    calculationNotes: [
      'Computed by the database trigger kpi_snapshots_qa_score whenever an input is saved, with the same rules as computeQaScore() in server/lib/metricFormulas.ts.',
      'It cannot be sent: the ingestion API rejects qa_score and status.',
    ],
    unit: '/100',
    direction: 'higher',
    thresholds: {
      text: `Good ≥ ${QA_SCORE_THRESHOLDS.good} · warning ≥ ${QA_SCORE_THRESHOLDS.warning} · below that critical (Overview "needs attention" below ${QA_SCORE_THRESHOLDS.warning})`,
      target: `≥ ${QA_SCORE_THRESHOLDS.good}/100`,
      source: 'QA_SCORE_THRESHOLDS (server/lib/metricFormulas.ts), also METRICS_CONFIG.qaScore',
    },
    storedIn: ['kpi_snapshots.qa_score', 'kpi_snapshots.status'],
    inputColumns: qaInputs,
    whereToFindIt: [TD_HEADER, 'Overview → team cards, battery gauge and sorting', RANKINGS, REPORTS, 'Manual metrics → Current metrics (QA score panel)'],
    productionSources: [
      { system: 'Not sourced directly', detail: 'Calculated from its inputs: test coverage (SonarQube / JaCoCo), defect escape rate (Jira), change failure rate (deployment pipeline + incidents), code quality (SonarQube)' },
    ],
    howToSendIt: {
      kind: 'computed',
      note: `Send the inputs instead (${qaInputs.join(', ')}); the score is recalculated on every write.`,
    },
    related: ['test_coverage', 'defect_escape_rate', 'change_failure_rate', 'code_quality_score'],
  },
  technical_debt_score: {
    kind: 'computed',
    title: 'Technical debt score',
    whyItMatters:
      'Summarises the open technical-debt backlog, weighted by severity, on a 0–100 scale. Unpaid debt slows every future change and raises defect risk, ' +
      'so a rising score is a signal to reserve capacity for it before delivery speed drops.',
    howCalculated: TECH_DEBT_SCORE_FORMULA,
    calculationNotes: [
      `Severity weights (TECH_DEBT_SEVERITY_WEIGHTS): critical ${TECH_DEBT_SEVERITY_WEIGHTS.critical}, high ${TECH_DEBT_SEVERITY_WEIGHTS.high}, medium ${TECH_DEBT_SEVERITY_WEIGHTS.medium}, low ${TECH_DEBT_SEVERITY_WEIGHTS.low}.`,
      'Calculated on each request from the team\'s technical_debt rows (GET /api/teams); not stored as a snapshot, so it has no history line.',
      `Per-item ROI on the Technical debt page: ${TECH_DEBT_ROI_FORMULA}`,
    ],
    unit: '/100',
    direction: dir('technicalDebtScore'),
    thresholds: fromConfig('technicalDebtScore'),
    storedIn: ['technical_debt.severity', 'technical_debt.status', 'technical_debt.team_id'],
    whereToFindIt: [TD_HEADER, 'Analytics → Technical debt (item list and ROI)', REPORTS, 'Manual metrics → Technical Debt ROI Impact'],
    productionSources: [
      { system: 'SonarQube', detail: 'Open issues by severity: GET /api/issues/search?componentKeys=<key>&resolved=false&severities=BLOCKER,CRITICAL,MAJOR,MINOR (or impactSeverities in newer versions)' },
      { system: 'Jira', detail: 'Issues labelled `tech-debt` (or a Tech debt issue type), with priority mapped to severity and status to open / resolved' },
    ],
    howToSendIt: {
      kind: 'no-api',
      note: 'There is no ingestion endpoint for debt items yet; the ingestion API only takes kpi_snapshots columns. Items come from sample data, and their cost-of-delay inputs are edited in Manual metrics → Technical Debt ROI Impact.',
    },
    related: ['code_quality_score'],
  },
  workload_balance: {
    kind: 'derived',
    title: 'Workload balance (derived)',
    whyItMatters:
      'A 0–100 indicator of whether a developer\'s week leaves room for focused work: lots of focus time, few meetings and interruptions, and fast reviews score high. ' +
      'It is a workload signal derived from workload data, not wellbeing: how people feel comes only from the anonymous survey (Wellbeing (survey)). Treat it as a prompt for a conversation, not a verdict.',
    howCalculated: `Workload balance = ${WORKLOAD_BALANCE_FORMULA}`,
    calculationNotes: [
      'Derived, not measured: calculateWorkloadBalance() in src/data/advancedFeatures.ts, run when developer metrics are saved.',
      'Stored in the column named happiness_score for historical reasons; it is not a happiness survey and not part of engineering health.',
      'Not counted again in developer recommendations, because it uses the same inputs.',
      `Team and company averages: ${K_ANONYMITY_RULE}`,
    ],
    unit: '/100',
    direction: dir('happinessScore'),
    thresholds: fromConfig('happinessScore'),
    storedIn: ['developer_metrics.happiness_score'],
    whereToFindIt: [TD_MEMBERS, DEV_PRODUCTIVITY, 'Manual metrics → Developer Productivity Metrics'],
    productionSources: [
      { system: 'Not sourced directly', detail: 'Derived from focus time, meetings and context switches (calendar / activity data) and PR merge and review times (GitHub / GitLab)' },
    ],
    howToSendIt: {
      kind: 'developer-metrics',
      manual: 'Manual metrics → Developer Productivity Metrics (POST /api/metrics/developer). Calculated from the inputs on save.',
      note: 'The KPI ingestion API does not accept developer metrics.',
    },
    related: ['wellbeing_survey', 'burnout_risk', 'ddps', 'team_members'],
  },
  wellbeing_survey: {
    kind: 'computed',
    title: 'Wellbeing (survey)',
    whyItMatters:
      'How the team says it is doing, in its own words: workload, focus time, support, energy and outlook, answered anonymously every week or two. ' +
      'It is the wellbeing signal of QE Navigator and part of engineering health; workload balance (derived) is a separate workload signal.',
    howCalculated: WELLBEING_FORMULA,
    calculationNotes: [
      `Questions (1 = strongly disagree … 5 = strongly agree): ${PULSE_QUESTIONS.map((q, i) => `${i + 1}. ${q.text}`).join(' ')}`,
      'Answers are stored without a user id or a time, only with the team and period; a separate list (who answered which period) only prevents a second answer and cannot be matched to an answer.',
      'Results appear after a period ends (never for the running period), as averages, and only with at least 3 responses; comments only for leads, managers and admins.',
      'Company / department figure: the teams\' latest closed period, teams below 3 responses left out, weighted by responses. Engineering health leaves it out (not replaced) when no team has a result.',
    ],
    unit: '/100',
    direction: 'higher',
    thresholds: {
      text: `On target ≥ ${WELLBEING_BANDS.good} · watch ≥ ${WELLBEING_BANDS.warning} · below that low`,
      target: `≥ ${WELLBEING_BANDS.good}`,
      source: 'WELLBEING_BANDS (server/lib/pulseRules.ts)',
    },
    storedIn: ['pulse_responses (anonymous answers)', 'pulse_participation (who answered which period, duplicates only)', 'pulse_cadences (weekly / biweekly per team)'],
    whereToFindIt: [PULSE_PAGE, `${TD} → Wellbeing (survey)`, 'Overview → Company status (wellbeing and engineering health)'],
    productionSources: [
      { system: 'QE Navigator pulse survey', detail: 'Answered in the app by the team\'s members (POST /api/pulse/teams/:teamId/responses)' },
    ],
    howToSendIt: {
      kind: 'computed',
      manual: `${PULSE_PAGE}: members answer once per period; the lead, a manager or an admin sets weekly or every two weeks.`,
      note: 'There is no import: answers can only be given by the people themselves, so they stay anonymous.',
    },
    related: ['workload_balance', 'team_members'],
  },
  burnout_risk: {
    kind: 'derived',
    title: 'Burnout risk (derived)',
    whyItMatters:
      'Flags developers whose schedule shows warning signs of overload: too little focus time, too many meetings or constant task switching. ' +
      'Sustained overload leads to mistakes, attrition and lost knowledge. It is a rule on workload data, not a medical or personal assessment.',
    howCalculated: BURNOUT_DEFINITION,
    calculationNotes: [
      'Derived, not measured: computeBurnoutRisk() in server/lib/metricFormulas.ts, from the developer\'s latest recorded values.',
      'Calculated when the page is shown; not stored.',
      `Team counts (how many developers are high / moderate / low): ${K_ANONYMITY_RULE}`,
    ],
    unit: null,
    direction: 'lower',
    thresholds: {
      text: 'Low · moderate · high, from the rule above',
      source: 'computeBurnoutRisk (server/lib/metricFormulas.ts)',
    },
    storedIn: ['developer_metrics.focus_time_hours', 'developer_metrics.meeting_time_hours', 'developer_metrics.context_switches_per_day'],
    whereToFindIt: [TD_MEMBERS, DEV_PRODUCTIVITY, 'Manual metrics → Developer Productivity Metrics'],
    productionSources: [
      { system: 'Google Calendar / Microsoft 365 (Outlook)', detail: 'Meeting hours per day from calendar events (Google Calendar API events.list; Microsoft Graph /me/calendarView), focus time = free blocks of 2 h or more' },
      { system: 'Issue tracker / IDE activity', detail: 'Context switches: changes of the active Jira issue or branch per day (Jira changelog assignee/status events, or IDE telemetry such as WakaTime)' },
    ],
    howToSendIt: {
      kind: 'developer-metrics',
      manual: 'Manual metrics → Developer Productivity Metrics (POST /api/metrics/developer): enter focus, meetings and context switches.',
      note: 'The KPI ingestion API does not accept developer metrics.',
    },
    related: ['workload_balance', 'team_members'],
  },
  ddps: {
    kind: 'derived',
    title: 'Daily Developer Productivity Score (DDPS)',
    whyItMatters:
      'Combines focus time, meeting load, interruptions and review/merge speed into one 0–100 view of the conditions for productive work. ' +
      'It is meant to show where the environment gets in the way (too many meetings, slow reviews), not to rank individuals.',
    howCalculated: DDPS_FORMULA,
    calculationNotes: [
      'Derived, not measured: computeDdps() in server/lib/metricFormulas.ts, from each developer\'s latest recorded metrics.',
      'History uses developer_productivity_snapshots; the score is recalculated from each snapshot\'s inputs, not read from the stored ddps_score.',
      `Team average and daily team history: ${K_ANONYMITY_RULE} A day with fewer developers is not shown.`,
    ],
    unit: '/100',
    direction: 'higher',
    thresholds: {
      text: DDPS_BANDS.map((b) => (Number.isFinite(b.min) ? `${b.label} ≥ ${b.min}` : `${b.label} below that`)).join(' · '),
      source: 'DDPS_BANDS (src/data/advancedFeatures.ts)',
    },
    storedIn: [
      'developer_metrics.focus_time_hours',
      'developer_metrics.meeting_time_hours',
      'developer_metrics.context_switches_per_day',
      'developer_metrics.pr_merge_time_avg',
      'developer_metrics.code_review_time_avg',
      'developer_productivity_snapshots (history)',
    ],
    whereToFindIt: [DEV_PRODUCTIVITY, 'Manual metrics → Developer Productivity Metrics', `${TD} → Team members (its inputs)`],
    productionSources: [
      { system: 'GitHub / GitLab', detail: 'PR merge time: created_at → merged_at (GET /repos/{owner}/{repo}/pulls?state=closed); review turnaround: review requested → first review (GET …/pulls/{n}/reviews, submitted_at)' },
      { system: 'Google Calendar / Microsoft 365', detail: 'Meeting hours and focus blocks per day (Calendar API events.list, Microsoft Graph calendarView)' },
      { system: 'Issue tracker / IDE activity', detail: 'Context switches per day from Jira issue changes or IDE telemetry' },
    ],
    howToSendIt: {
      kind: 'developer-metrics',
      manual: 'Manual metrics → Developer Productivity Metrics (POST /api/metrics/developer).',
      note: 'The KPI ingestion API does not accept developer metrics.',
    },
    related: ['workload_balance', 'burnout_risk'],
  },
  team_members: {
    kind: 'container',
    title: 'Team members',
    whyItMatters:
      'Shows each member\'s latest workload metrics next to each other, so a lead can see who is overloaded, waiting on reviews or short of focus time. ' +
      'It is a support tool for one-to-ones and planning, and respects each person\'s choice to turn developer insights off.',
    howCalculated:
      'One row per member of the team (primary team or team_members). PR merge, review, focus, meetings and context switches are the latest recorded values. ' +
      `Workload balance (derived) = ${WORKLOAD_BALANCE_FORMULA}. Burnout risk: ${BURNOUT_DEFINITION}`,
    calculationNotes: [
      'Visibility (server/lib/userPolicy.ts): super admin any team, manager their department, team lead their team; other roles see only their own row.',
      'Members who turned developer insights off are listed without metrics.',
      `Team averages built from these rows: ${K_ANONYMITY_RULE}`,
    ],
    unit: null,
    direction: 'none',
    thresholds: {
      text: `Targets: focus ${metricTargetText('focusTimeHours')} · meetings ${metricTargetText('meetingTimeHours')} · context switches ${metricTargetText('contextSwitchesPerDay')} · PR merge ${metricTargetText('prMergeTimeHours')} · review ${metricTargetText('codeReviewTimeHours')}`,
      source: 'METRICS_CONFIG developer metrics (src/config/metricsConfig.ts)',
    },
    storedIn: [
      'users (name, email, developer_insights_enabled)',
      'developer_metrics.pr_merge_time_avg',
      'developer_metrics.code_review_time_avg',
      'developer_metrics.focus_time_hours',
      'developer_metrics.meeting_time_hours',
      'developer_metrics.context_switches_per_day',
      'developer_metrics.happiness_score',
    ],
    whereToFindIt: [TD_MEMBERS, DEV_PRODUCTIVITY, 'Manual metrics → Developer Productivity Metrics', 'Administration → Users'],
    productionSources: [
      { system: 'GitHub / GitLab', detail: 'PR merge time (created_at → merged_at) and review turnaround (review requested → first submitted review) per author' },
      { system: 'Google Calendar / Microsoft 365', detail: 'Meeting hours and uninterrupted focus blocks per day' },
      { system: 'Issue tracker / IDE activity', detail: 'Context switches per day' },
      { system: 'Identity provider (optional)', detail: 'Team membership from Okta / Entra ID groups' },
    ],
    howToSendIt: {
      kind: 'developer-metrics',
      manual: 'Manual metrics → Developer Productivity Metrics (POST /api/metrics/developer, one developer at a time).',
      note: 'The KPI ingestion API does not accept developer metrics.',
    },
    related: ['workload_balance', 'burnout_risk', 'ddps'],
  },
  team_recommendations: {
    kind: 'container',
    title: 'Team recommendations',
    whyItMatters:
      'Turns the team\'s KPIs into a short list of strengths, areas to improve and a prioritised action plan with an owner and a timebox. ' +
      'It gives leads a starting point for retrospectives and quarterly planning without reading every chart.',
    howCalculated:
      'Rule-based: each benchmarked KPI is compared with its METRICS_CONFIG thresholds. Within "good" = strength; between good and warning = area to improve (Moderate); ' +
      'beyond warning = area to improve (Urgent). The top 5 areas, urgent first, become the action plan. Metrics with no recorded value are listed as not measured. ' +
      'When an AI key (GROQ_API_KEY) is configured and AI is enabled for the team, a language model writes the recommendations from the same metrics; if it fails, the rules are used.',
    calculationNotes: [
      'Generated on each request by GET /api/teams/:id/ai-suggestions; not stored.',
      'AI output can be wrong: the card says when a model wrote it.',
    ],
    unit: null,
    direction: 'none',
    thresholds: { text: 'The per-metric thresholds of each KPI on this page', source: 'METRICS_CONFIG (src/config/metricsConfig.ts)' },
    storedIn: ['kpi_snapshots (latest row, read only)', 'technical_debt (debt score)', 'teams.ai_enabled'],
    whereToFindIt: [`${TD} → Team recommendations (super admin, manager, team lead)`, 'Administration → Admin console (AI toggle per team)'],
    productionSources: [
      { system: 'Not sourced directly', detail: 'Built from the stored KPIs above; their production sources apply' },
      { system: 'LLM provider (optional)', detail: 'Groq chat completions API, only when GROQ_API_KEY is set' },
    ],
    howToSendIt: {
      kind: 'computed',
      note: 'Nothing to send: recommendations update when the underlying KPIs are ingested or entered.',
    },
    related: ['qa_score', 'technical_debt_score'],
  },
  developer_recommendations: {
    kind: 'container',
    title: 'Developer recommendations',
    whyItMatters:
      'Gives each developer a status (healthy, needs attention, at risk) and one concrete suggestion based on their workload metrics. ' +
      'It helps leads spot overload or slow review loops early and act on the cause, such as meeting load, rather than the person.',
    howCalculated: DEVELOPER_RULES_TEXT,
    calculationNotes: [
      'assessDeveloper() in server/lib/developerHealth.ts always sets the status. When an AI key is configured and AI is enabled for the team, a model may write the summary and suggestion text.',
      'Generated on each request by GET /api/teams/:id/developer-ai-suggestions; not stored. Only developers who have not opted out are included.',
    ],
    unit: null,
    direction: 'none',
    thresholds: {
      text: `Focus < ${METRICS_CONFIG.focusTimeHours.warning} h/day, meetings > ${METRICS_CONFIG.meetingTimeHours.warning} h/day, context switches > ${METRICS_CONFIG.contextSwitchesPerDay.warning}/day, PR merge > ${METRICS_CONFIG.prMergeTimeHours.warning} h, review > ${METRICS_CONFIG.codeReviewTimeHours.warning} h are concerns`,
      source: 'DEVELOPER_THRESHOLDS (server/lib/developerHealth.ts), from METRICS_CONFIG warning bands',
    },
    storedIn: [
      'developer_metrics.pr_merge_time_avg',
      'developer_metrics.code_review_time_avg',
      'developer_metrics.focus_time_hours',
      'developer_metrics.meeting_time_hours',
      'developer_metrics.context_switches_per_day',
      'users.developer_insights_enabled',
    ],
    whereToFindIt: [`${TD} → Developer recommendations (super admin, manager, team lead)`, DEV_PRODUCTIVITY],
    productionSources: [
      { system: 'GitHub / GitLab', detail: 'PR merge and review times per developer (pulls and reviews APIs)' },
      { system: 'Google Calendar / Microsoft 365', detail: 'Meetings and focus time per day' },
      { system: 'LLM provider (optional)', detail: 'Groq chat completions API for the wording, only when GROQ_API_KEY is set' },
    ],
    howToSendIt: {
      kind: 'developer-metrics',
      manual: 'Manual metrics → Developer Productivity Metrics (POST /api/metrics/developer).',
      note: 'Recommendations update from the stored developer metrics; there is nothing to send for them directly.',
    },
    related: ['team_members', 'workload_balance', 'burnout_risk'],
  },

  revenue_sensitivity: {
    kind: 'derived',
    title: 'Revenue per metric (sensitivity)',
    whyItMatters:
      'Shows how much monthly revenue has moved with each quality metric in this team\'s own history, so quality work can be discussed in money. ' +
      'It is an association, not a cause, and it is only shown when the data support it.',
    howCalculated: REVENUE_SENSITIVITY_FORMULA,
    calculationNotes: [
      `Shown from ${REVENUE_MIN_PAIRED_MONTHS} paired months (the same minimum as the correlations); fewer months give an empty state saying how many are missing.`,
      `What-if: ${WHAT_IF_FORMULA}`,
      ...REVENUE_CAVEATS,
      'Code: server/lib/revenueImpact.ts (revenueSensitivity, whatIf) and server/lib/stats.ts (olsFit). API: GET /api/revenue-impact/teams/:teamId and …/what-if.',
    ],
    unit: '$/month per unit',
    direction: 'none',
    thresholds: null,
    storedIn: ['business_impact_quality_metrics.*', 'business_impact_business_kpis.monthly_revenue', 'business_impact_*.data_source'],
    whereToFindIt: ['Delivery → Business impact → Money (How is this calculated?), What-if and Details'],
    productionSources: [
      { system: 'Finance / BI (ERP, billing, Snowflake, Looker)', detail: 'Monthly recognised revenue attributable to the team\'s product area' },
      { system: 'QE Navigator KPI history', detail: 'Monthly averages of the quality KPIs (coverage, escape rate, MTTR, …)' },
    ],
    howToSendIt: { kind: 'no-api', manual: 'Delivery → Business impact → Data entry (monthly quality metrics and business KPIs).', note: 'There is no ingestion endpoint for the monthly business-impact series yet.' },
    related: ['revenue_at_stake', 'revenue_rollup'],
  },
  revenue_at_stake: {
    kind: 'derived',
    title: 'Revenue associated with quality gaps',
    whyItMatters:
      'Puts a monthly money figure on the gaps between the team\'s quality metrics and their targets, using only associations that are significant in its own data.',
    howCalculated: REVENUE_AT_STAKE_FORMULA,
    calculationNotes: [
      'Targets: the KPI target valid today (Administration → Parameters → KPI targets, with history); deployment frequency has no target in the same unit.',
      'Each gain in "What you gain when these are fixed" is one metric\'s slope × its gap; metrics that move together are counted once.',
      ...REVENUE_CAVEATS,
    ],
    unit: '$/month',
    direction: 'none',
    thresholds: null,
    storedIn: ['business_impact_quality_metrics.*', 'business_impact_business_kpis.monthly_revenue', 'target_history'],
    whereToFindIt: ['Delivery → Business impact → Money'],
    productionSources: [
      { system: 'Finance / BI', detail: 'Monthly revenue per product area' },
      { system: 'QE Navigator targets', detail: 'KPI targets with history (target_history)' },
    ],
    howToSendIt: { kind: 'computed', note: 'Computed from the monthly business-impact data and the targets; nothing to send directly.' },
    related: ['revenue_sensitivity', 'revenue_at_risk'],
  },
  revenue_at_risk: {
    kind: 'computed',
    title: 'Money lost or at risk now',
    whyItMatters: 'The monthly cost of what is going wrong today (open technical debt, downtime, support tickets, churn), from recorded data and your financial settings.',
    howCalculated: REVENUE_AT_RISK_DEBT_FORMULA,
    calculationNotes: [
      INCIDENT_COST_FORMULA,
      SUPPORT_COST_FORMULA,
      CHURN_REVENUE_FORMULA,
      DOWNTIME_GAP_FORMULA,
      `Fix cost and return: ${TECH_DEBT_ROI_FORMULA}`,
      'Rates come from Administration → Parameters → Financial and ROI settings (team, else department, else company); built-in defaults are labelled "default".',
      'The causes overlap, so they are not added up.',
    ],
    unit: '$/month',
    direction: 'lower',
    thresholds: null,
    storedIn: ['technical_debt.*', 'business_impact_context.downtime_minutes', 'business_impact_business_kpis.support_ticket_volume', 'business_impact_business_kpis.churn_rate', 'configs (financial settings)'],
    whereToFindIt: ['Delivery → Business impact → Money', 'Analytics → Technical debt (per-item ROI)'],
    productionSources: [
      { system: 'SonarQube / Jira', detail: 'Open technical-debt items with their impact inputs' },
      { system: 'Incident tooling (PagerDuty, Opsgenie, Statuspage)', detail: 'Downtime minutes per month' },
      { system: 'Zendesk / ServiceNow', detail: 'Support tickets per month' },
      { system: 'Product analytics (Amplitude, Mixpanel) and CRM / billing', detail: 'Active users and churn rate per month' },
    ],
    howToSendIt: { kind: 'no-api', manual: 'Business impact → Data entry; Manual metrics → Technical Debt ROI Impact; Parameters → Financial and ROI settings.' },
    related: ['revenue_at_stake', 'technical_debt_score'],
  },
  revenue_rollup: {
    kind: 'computed',
    title: 'Revenue impact: all teams',
    whyItMatters: 'Adds the team figures up for a department or the company, and says which teams had no figure and why.',
    howCalculated: REVENUE_ROLLUP_FORMULA,
    calculationNotes: ['Super admins see the company, managers the teams of their departments (the analytics scope). API: GET /api/revenue-impact/rollup.'],
    unit: '$/month',
    direction: 'none',
    thresholds: null,
    storedIn: ['(computed per team, see Revenue associated with quality gaps)'],
    whereToFindIt: ['Delivery → Business impact → All teams (super admin, manager)'],
    productionSources: [{ system: 'Not sourced directly', detail: 'Sum of the team figures' }],
    howToSendIt: { kind: 'computed', note: 'Computed from the team figures.' },
    related: ['revenue_at_stake', 'revenue_at_risk'],
  },
};

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export const METRIC_CATALOG: Record<MetricCatalogKey, MetricCatalogEntry> = {
  ...(Object.fromEntries(
    (Object.keys(KPI_ENTRIES) as KpiColumn[]).map((col) => [
      col,
      { ...KPI_ENTRIES[col], key: col, storedIn: [`kpi_snapshots.${col}`], sourceColumn: col },
    ]),
  ) as Record<KpiColumn, MetricCatalogEntry>),
  ...(Object.fromEntries(
    (Object.keys(EXTRA_ENTRIES) as ExtraCatalogKey[]).map((k) => [k, { ...EXTRA_ENTRIES[k], key: k }]),
  ) as Record<ExtraCatalogKey, MetricCatalogEntry>),
};

export const getMetricCatalogEntry = (key: string): MetricCatalogEntry | null =>
  (METRIC_CATALOG as Record<string, MetricCatalogEntry | undefined>)[key] ?? null;

export const KIND_LABEL: Record<MetricKind, string> = {
  measured: 'Measured',
  computed: 'Computed by QE Navigator',
  derived: 'Derived, not measured',
  container: 'Page section',
};

export const DIRECTION_LABEL: Record<MetricDirection, string> = {
  higher: 'Higher is better',
  lower: 'Lower is better',
  'closer-to-1': 'Closer to 1.0 is better',
  none: 'No good or bad direction',
};
