/**
 * Exporter coverage report: every parameter QE Navigator accepts from machine ingestion, whether the QE Navigator
 * Exporter sent it (from the output of `qe-exporter preview --all`) and whether QE Navigator stored it for a team
 * (from the app's own API, as a signed-in company admin), and which dashboard modules that team now has data in.
 *
 *   npx tsx scripts/exporter-coverage.ts --url https://app.irongate.ie --email admin@example.com --team <team id> \
 *       --preview preview.json            (password: QE_ADMIN_PASSWORD, or --password)
 *
 * Read-only: it signs in, reads, prints a table (and --json for the raw result). Nothing is written.
 */
import { readFileSync } from 'fs';

export interface Parameter { name: string; kind: string; expected: boolean; sent: boolean; stored: boolean; note?: string }
export interface Module { module: string; populated: boolean; source: string }

/** The 23 KPI columns of POST /api/ingest/kpis and the envelope kind that feeds each (QE Navigator calculates them from it). */
export const KPI_FEEDS: Record<string, string> = {
  test_coverage: 'coverage', test_flakiness_rate: 'test-report', defect_density: 'issues', defect_escape_rate: 'issues', code_quality_score: 'sarif',
  avg_build_time_minutes: 'pipeline-runs', test_execution_time_minutes: 'test-report', deployment_frequency_per_week: 'deployments', lead_time_days: 'deployments',
  mttr_hours: 'incidents', parallel_test_efficiency: 'pipeline-runs', sprint_velocity: 'issues', sprint_commitment_rate: 'issues', sprint_carryover: 'issues',
  first_time_pass_rate: 'test-report', blocked_time_hours: 'issues', automation_coverage: 'kpis', automation_roi: 'kpis', change_failure_rate: 'deployments',
  mtbf_hours: 'incidents', system_availability: 'incidents', infrastructure_failures: 'incidents', sizing_accuracy: 'issues',
};

/** The raw fields each envelope kind accepts (what the server's parsers read), by where they are in an item. */
const FIELDS: Record<string, Array<[string, (it: any) => boolean]>> = {
  'test-report': [['files (JUnit / TRX / Cucumber text)', (i) => Array.isArray(i.files) && i.files.length > 0], ['commit', (i) => !!i.commit], ['branch', (i) => !!i.branch], ['run', (i) => !!i.run], ['attempt', (i) => i.attempt !== undefined], ['startedAt', (i) => !!i.startedAt]],
  coverage: [['files (lcov / Cobertura / JaCoCo / Istanbul text)', (i) => Array.isArray(i.files) && i.files.length > 0], ['changedLines or diff (coverage of changed code)', (i) => !!(i.changedLines || i.diff)], ['commit', (i) => !!i.commit], ['branch', (i) => !!i.branch], ['run', (i) => !!i.run]],
  sarif: [['files (SARIF 2.1.0)', (i) => Array.isArray(i.files) && i.files.length === 1], ['repo', (i) => !!i.repo], ['loc (lines of code)', (i) => !!i.loc], ['commit', (i) => !!i.commit]],
  'pipeline-runs': [['id', (i) => !!i.id], ['attempt', (i) => i.attempt !== undefined], ['name', (i) => !!i.name], ['commit', (i) => !!i.commit], ['branch', (i) => !!i.branch], ['startedAt / finishedAt', (i) => !!i.startedAt && !!i.finishedAt],
    ['durationSeconds', (i) => i.durationSeconds !== undefined], ['result', (i) => !!i.result], ['stages[] (name, times, result)', (i) => Array.isArray(i.stages) && i.stages.length > 0], ['stages[].parallelGroup', (i) => (i.stages ?? []).some((s: any) => s.parallelGroup)]],
  deployments: [['id', (i) => !!i.id], ['environment / production', (i) => !!i.environment], ['service', (i) => !!i.service], ['commit', (i) => !!i.commit], ['previousCommit', (i) => !!i.previousCommit], ['startedAt / finishedAt', (i) => !!i.finishedAt],
    ['result (incl. failure)', (i) => !!i.result], ['hotfix', (i) => i.hotfix === true], ['rollbackOf', (i) => !!i.rollbackOf], ['commits[] (sha, authoredAt, committedAt)', (i) => Array.isArray(i.commits) && i.commits.length > 0]],
  incidents: [['id', (i) => !!i.id], ['service', (i) => !!i.service], ['severity', (i) => !!i.severity], ['status', (i) => !!i.status], ['openedAt', (i) => !!i.openedAt], ['acknowledgedAt', (i) => !!i.acknowledgedAt], ['resolvedAt', (i) => !!i.resolvedAt],
    ['deploymentId (linked deployment)', (i) => !!i.deploymentId], ['category (infrastructure)', (i) => !!i.category]],
  issues: [['key', (i) => !!i.key], ['type (bug / story / …)', (i) => !!i.type], ['status / statusCategory', (i) => !!i.statusCategory], ['resolution', (i) => !!i.resolution], ['environment (found in production / before)', (i) => !!i.environment],
    ['storyPoints', (i) => typeof i.storyPoints === 'number'], ['estimateHours', (i) => typeof i.estimateHours === 'number'], ['timeLoggedHours', (i) => typeof i.timeLoggedHours === 'number'], ['createdAt / resolvedAt', (i) => !!i.createdAt && !!i.resolvedAt],
    ['sprints[] (id, state, dates)', (i) => Array.isArray(i.sprints) && i.sprints.length > 0], ['transitions[] (status changes, blocked)', (i) => (i.transitions ?? []).some((t: any) => t.toCategory === 'blocked')]],
  kpis: [['metrics.automation_coverage', (i) => i.metrics?.automation_coverage !== undefined], ['metrics.automation_roi', (i) => i.metrics?.automation_roi !== undefined], ['recordedAt', (i) => !!i.recordedAt]],
};

async function api(url: string, cookie: string, path: string): Promise<any> {
  const r = await fetch(`${url}/api${path}`, { headers: { Cookie: cookie } });
  return r.ok ? r.json() : null;
}

export async function signIn(url: string, email: string, password: string): Promise<string> {
  const r = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const set = r.headers.get('set-cookie') ?? '';
  const m = /irongate_token=([^;]+)/.exec(set);
  if (!r.ok || !m) throw new Error(`Sign-in failed (HTTP ${r.status})`);
  return `irongate_token=${m[1]}`;
}

/** The report: parameters (sent, stored) and modules (populated) for one team. */
export async function coverageReport(o: { url: string; cookie: string; teamId: string; preview: any }): Promise<{ teamId: string; parameters: Parameter[]; modules: Module[] }> {
  const items = (kind: string): any[] => (o.preview?.requests ?? []).filter((r: any) => r.body?.teamId === o.teamId && r.body?.kind === kind).flatMap((r: any) => r.body.items ?? []);
  const [snapRes, ev, delivery, work, recs] = await Promise.all([
    api(o.url, o.cookie, `/metrics/teams/${o.teamId}`), api(o.url, o.cookie, `/ci/teams/${o.teamId}/evidence`), api(o.url, o.cookie, `/ci/teams/${o.teamId}/delivery`),
    api(o.url, o.cookie, `/ci/teams/${o.teamId}/work`), api(o.url, o.cookie, `/improve/teams/${o.teamId}`),
  ]);
  const snap = snapRes?.snapshot ?? {};
  const received = (k: string) => !!(ev?.lastReceived?.[k]?.at ?? delivery?.lastReceived?.[k]?.at ?? work?.lastReceived?.[k]?.at);
  const storedKind: Record<string, boolean> = {
    'test-report': received('tests'), coverage: received('coverage'), sarif: received('static-analysis') || (work?.quality?.reports ?? []).length > 0, 'pipeline-runs': received('pipelines'),
    deployments: received('deployments') || (delivery?.deployments ?? []).length > 0, incidents: received('incidents') || (delivery?.incidents ?? []).length > 0,
    issues: received('issues') || (work?.sprints ?? []).length > 0, kpis: snap.automation_coverage !== null && snap.automation_coverage !== undefined,
  };
  const metricKeys = new Set([...(ev?.metrics ?? []), ...(delivery?.metrics ?? []), ...(work?.metrics ?? [])].map((m: any) => m.key));
  const fieldStored: Record<string, boolean> = {
    'changedLines or diff (coverage of changed code)': metricKeys.has('changed_code_coverage'), 'stages[].parallelGroup': metricKeys.has('parallel_test_efficiency'),
    hotfix: [...(delivery?.deployments ?? []), ...(delivery?.notCounted ?? []), ...(delivery?.failedChanges ?? [])].some((d: any) => d.hotfix),
    rollbackOf: [...(delivery?.notCounted ?? []), ...(delivery?.deployments ?? [])].some((d: any) => d.rollbackOf) || (delivery?.failedChanges ?? []).some((d: any) => (d.failedBecause ?? []).some((r: any) => r.type === 'rollback')),
    'commits[] (sha, authoredAt, committedAt)': (delivery?.deployments ?? []).some((d: any) => d.commitCount > 0 && d.leadTimeHours !== null), 'deploymentId (linked deployment)': metricKeys.has('incidents_per_deploy') || metricKeys.has('change_failure_rate'),
    'category (infrastructure)': snap.infrastructure_failures !== null && snap.infrastructure_failures !== undefined, 'environment (found in production / before)': metricKeys.has('escape_rate'),
    'transitions[] (status changes, blocked)': metricKeys.has('blocked_time'), 'estimateHours': metricKeys.has('sizing_accuracy'), 'timeLoggedHours': metricKeys.has('sizing_accuracy'),
    'storyPoints': metricKeys.has('velocity'), 'sprints[] (id, state, dates)': metricKeys.has('commitment'), 'loc (lines of code)': metricKeys.has('defect_density') || metricKeys.has('code_quality'),
    attempt: metricKeys.has('first_time_pass_rate') || metricKeys.has('pipeline_success_rate'),
  };
  const parameters: Parameter[] = [];
  for (const [kind, fields] of Object.entries(FIELDS)) {
    const list = items(kind);
    for (const [name, test] of fields) {
      const sent = list.some(test);
      parameters.push({ name: `${kind}: ${name}`, kind, expected: true, sent, stored: sent && storedKind[kind] && (fieldStored[name] ?? true) });
    }
  }
  for (const [col, kind] of Object.entries(KPI_FEEDS)) {
    const v = snap[col];
    parameters.push({ name: `KPI ${col}`, kind, expected: true, sent: items(kind).length > 0, stored: v !== null && v !== undefined, note: `calculated by QE Navigator from ${kind}` });
  }
  const modules: Module[] = [
    { module: 'Team dashboard (KPI cards)', populated: Object.keys(KPI_FEEDS).some((c) => snap[c] !== null && snap[c] !== undefined), source: 'machine ingestion (Exporter)' },
    { module: 'CI evidence panel (flaky tests, coverage, stages)', populated: !!(ev && (ev.flakyTests?.length || ev.coverage || ev.failingStages?.length)), source: 'machine ingestion (Exporter)' },
    { module: 'How this was calculated', populated: (ev?.metrics ?? []).length > 0, source: 'machine ingestion (Exporter)' },
    { module: 'Delivery (DORA, incidents)', populated: (delivery?.deployments ?? []).length > 0, source: 'machine ingestion (Exporter)' },
    { module: 'Work and code quality (sprints, defects, findings)', populated: (work?.sprints ?? []).length > 0 || (work?.quality?.reports ?? []).length > 0, source: 'machine ingestion (Exporter)' },
    { module: 'Recommendations', populated: Array.isArray(recs?.recommendations) ? recs.recommendations.length > 0 : !!recs, source: 'calculated by QE Navigator from the stored data' },
    { module: 'Forecasts', populated: false, source: 'calculated by QE Navigator from 8+ weeks of weekly values (runs on its schedule)' },
    { module: 'Business impact', populated: false, source: 'people (values entered in the app: Business impact configuration)' },
    { module: 'Financial settings', populated: false, source: 'people (Admin console → settings)' },
    { module: 'Technical debt items', populated: false, source: 'people (entered in the app)' },
    { module: 'Developer metrics', populated: false, source: 'people (per developer, opt-in; never machine-ingested)' },
    { module: 'Team pulse', populated: false, source: 'people (not machine ingestion)' },
  ];
  return { teamId: o.teamId, parameters, modules };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function cli(): Promise<void> {
  const url = (arg('url') ?? 'https://app.irongate.ie').replace(/\/+$/, '');
  const email = arg('email');
  const password = arg('password') ?? process.env.QE_ADMIN_PASSWORD;
  const teamId = arg('team');
  const previewFile = arg('preview');
  if (!email || !password || !teamId || !previewFile) {
    console.error('Usage: npx tsx scripts/exporter-coverage.ts --url URL --email ADMIN_EMAIL --team TEAM_ID --preview preview.json [--json]   (password: QE_ADMIN_PASSWORD)');
    process.exit(2);
  }
  const cookie = await signIn(url, email, password);
  const r = await coverageReport({ url, cookie, teamId, preview: JSON.parse(readFileSync(previewFile, 'utf8')) });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return; }
  const yn = (b: boolean) => (b ? 'yes' : 'NO ');
  console.log(`Team ${teamId}\n\nParameter                                                        sent  stored`);
  for (const p of r.parameters) console.log(`${p.name.padEnd(64).slice(0, 64)} ${yn(p.sent)}   ${yn(p.stored)}`);
  console.log('\nModule                                                 populated  data source');
  for (const m of r.modules) console.log(`${m.module.padEnd(54).slice(0, 54)} ${m.populated ? 'yes' : 'no '}        ${m.source}`);
}

if (process.argv[1] && /exporter-coverage/.test(process.argv[1])) cli().catch((e) => { console.error(e.message); process.exit(1); });
