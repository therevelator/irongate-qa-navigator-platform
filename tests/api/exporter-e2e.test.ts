import { execFile, spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';
import { coverageReport } from '../../scripts/exporter-coverage';

/**
 * The QE Navigator Exporter end to end: the bundle (exporter/dist/qe-exporter.mjs) runs as a plain process against
 * the fake vendors (deploy/exporter-test/fake-vendors: made-up GitHub, GitLab, Bitbucket, Jira, PagerDuty, SonarQube
 * data and a KPI file) and the live local API, with a company API key.
 *
 *   EXE-001  check passes (context, a dry run per team); preview prints the envelopes with the three ids and sends nothing
 *   EXE-002  sync: every kind lands in exactly the mapped teams (another team is untouched), logged as channel Exporter,
 *            one operator-log row per batch with its counts; a re-run sends nothing new
 *   EXE-003  QE Navigator calculates: the dashboard values (KPI snapshot), "How this was calculated" and the CI evidence
 *            panel show server-calculated values from the data the Exporter sent
 *   EXE-004  the coverage report (scripts/exporter-coverage.mjs): every accepted parameter sent and stored for the team
 * Skips when no backend runs or the bundle is not built.
 */
const ROOT = join(__dirname, '..', '..');
const BUNDLE = join(ROOT, 'exporter', 'dist', 'qe-exporter.mjs');
const FAKE = join(ROOT, 'deploy', 'exporter-test', 'fake-vendors', 'server.mjs');
const A = 'golden-team-empty';   // golden-dept-b: payments + mobile
const B = 'golden-team-small';   // golden-dept-a: data + reporting
const UNTOUCHED = 'golden-team-big';
const PORT = 18000 + Math.floor(Math.random() * 1000);
const FV = `http://localhost:${PORT}`;

let up = true;
let db: Client;
let apiKey = '';
let cookie = '';
let dir = '';
let cfgFile = '';
let fake: ChildProcess | null = null;

function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    execFile(process.execPath, [BUNDLE, ...args, '-c', cfgFile, '--log-format', 'json'], { env: { PATH: process.env.PATH ?? '', QE_API_KEY: apiKey, ...env }, maxBuffer: 256 * 1024 * 1024, timeout: 280_000 },
      (err, stdout, stderr) => {
        // EXE_DEBUG=1 keeps every command's output in the temporary folder.
        if (process.env.EXE_DEBUG) writeFileSync(join(dir, `${args[0]}-${Date.now()}.log`), `${stdout}\n----- stderr -----\n${stderr}`);
        res({ code: err ? Number((err as any).code ?? 1) : 0, stdout, stderr });
      });
  });
}
const count = async (table: string, team: string) => Number((await db.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE team_id = $1`, [team])).rows[0].n);
const TABLES = ['pipeline_runs_raw', 'test_runs', 'coverage_reports', 'deployments_raw', 'deployment_commits', 'incidents_raw', 'issues', 'issue_sprints', 'analysis_reports'];
const counts = async (team: string) => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await count(t, team)])));

beforeAll(async () => {
  up = (await backendUp()) && existsSync(BUNDLE);
  if (!up) { console.warn('Backend not running or the Exporter bundle not built - Exporter end-to-end tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', cookie, { name: 'Exporter e2e key', scope: 'exporter' })).body.plaintextKey;
  dir = mkdtempSync(join(tmpdir(), 'qe-exporter-e2e-'));
  fake = spawn(process.execPath, [FAKE], { env: { ...process.env, PORT: String(PORT), HISTORY_DAYS: '20', KPI_FILE: join(dir, 'kpis.json') }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${FV}/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  cfgFile = join(dir, 'qe-exporter.json');
  writeFileSync(cfgFile, JSON.stringify({
    qeNavigator: { url: API_URL, companyId: GOLDEN_COMPANY, requestsPerMinute: 60 },
    teams: { [A]: 'golden-dept-b', [B]: 'golden-dept-a' },
    state: { path: join(dir, 'state.json') },
    hostLabel: 'e2e-host',
    backfillDays: 25,
    http: { maxRetries: 1, maxRetryWaitSeconds: 2 },
    sources: [
      { type: 'github', name: 'github', apiUrl: `${FV}/github`, repos: { 'acme/payments-api': A, 'acme/mobile-app': A }, environments: ['production'] },
      { type: 'gitlab', name: 'gitlab', apiUrl: `${FV}/gitlab/api/v4`, projects: { 'analytics/data-pipeline': B }, environments: ['production'] },
      { type: 'bitbucket', name: 'bitbucket', apiUrl: `${FV}/bitbucket/2.0`, username: 'fake-user', repos: { 'analytics/reporting': B } },
      { type: 'jira', name: 'jira', baseUrl: `${FV}/jira`, deployment: 'cloud', email: 'fake-account', allowHttp: true, jql: 'project in (PAY, MOB, DATA, REP)', fields: { environment: 'customfield_10060' }, teams: { PAY: A, MOB: A, DATA: B, REP: B } },
      { type: 'pagerduty', name: 'pagerduty', apiUrl: `${FV}/pagerduty`, services: { 'payments-api': A, 'mobile-backend': A, 'data-pipeline': B, 'reporting-service': B }, categories: { 'mobile-backend': 'infrastructure', 'data-pipeline': 'infrastructure' } },
      { type: 'sonarqube', name: 'sonarqube', baseUrl: `${FV}/sonar`, allowHttp: true, projects: { 'payments-api': A, 'data-pipeline': B } },
      { type: 'kpis', name: 'kpis', path: join(dir, 'kpis.json'), teams: { payments: A, data: B } },
    ],
  }, null, 2));
}, 60_000);

afterAll(async () => {
  fake?.kill();
  if (db) { await removeGolden(db); await db.end(); }
});

const SECRETS = { GITHUB_TOKEN: 'fake-github-token-e2e', GITLAB_TOKEN: 'fake-gitlab-token-e2e', BITBUCKET_APP_PASSWORD: 'fake-bb-password-e2e', JIRA_TOKEN: 'fake-jira-token-e2e', PAGERDUTY_TOKEN: 'fake-pd-token-e2e', SONAR_TOKEN: 'fake-sonar-token-e2e' };

describe('QE Navigator Exporter end to end', () => {
  it('EXE-001 check passes; preview prints the envelopes with the three ids and sends nothing', async () => {
    if (!up) return;
    const c = await run(['check'], SECRETS);
    expect(c.stdout).toMatch(/key valid for Golden Fixture Co \(company id golden-co\)/);
    expect(c.stdout).toMatch(/All checks passed/);
    expect(c.code).toBe(0);
    const before = { a: await counts(A), b: await counts(B), log: Number((await db.query(`SELECT COUNT(*)::int AS n FROM ingestion_log WHERE company_id = $1`, [GOLDEN_COMPANY])).rows[0].n) };
    const p = await run(['preview'], SECRETS);
    expect(p.code).toBe(0);
    const report = JSON.parse(p.stdout);
    const kinds = new Set(report.requests.map((r: any) => r.body.kind));
    for (const k of ['pipeline-runs', 'test-report', 'coverage', 'sarif', 'deployments', 'incidents', 'issues', 'kpis']) expect(kinds.has(k)).toBe(true);
    for (const r of report.requests) {
      expect(r.body.companyId).toBe(GOLDEN_COMPANY);
      expect([A, B]).toContain(r.body.teamId);
      expect(r.body.departmentId).toBe(r.body.teamId === A ? 'golden-dept-b' : 'golden-dept-a');
      expect(r.headers.Authorization).toBe('Bearer [redacted]');
    }
    for (const v of [apiKey, ...Object.values(SECRETS)]) { expect(p.stdout).not.toContain(v); expect(p.stderr).not.toContain(v); }
    expect(await counts(A)).toEqual(before.a);
    expect(await counts(B)).toEqual(before.b);
    expect(Number((await db.query(`SELECT COUNT(*)::int AS n FROM ingestion_log WHERE company_id = $1`, [GOLDEN_COMPANY])).rows[0].n)).toBe(before.log);
  }, 300_000);

  it('EXE-002 sync: every kind lands in exactly the mapped teams; logged as Exporter; one operator-log row per batch; a re-run sends nothing new', async () => {
    if (!up) return;
    const untouched = await counts(UNTOUCHED);
    const deliveriesBefore = Number((await db.query(`SELECT COUNT(*)::int AS n FROM exporter_deliveries WHERE company_id = $1`, [GOLDEN_COMPANY])).rows[0].n);
    const s = await run(['sync'], SECRETS);
    expect(s.stderr).not.toMatch(/"level":"error"/);
    expect(s.code).toBe(0);
    const a = await counts(A);
    const b = await counts(B);
    for (const t of ['pipeline_runs_raw', 'test_runs', 'coverage_reports', 'deployments_raw', 'deployment_commits', 'incidents_raw', 'issues', 'issue_sprints', 'analysis_reports']) {
      expect([t, a[t] > 0]).toEqual([t, true]);
      expect([t, b[t] > 0]).toEqual([t, true]);
    }
    expect(await counts(UNTOUCHED)).toEqual(untouched);
    // Nothing of the fake data anywhere else.
    const elsewhere = await db.query(`SELECT COUNT(*)::int AS n FROM pipeline_runs_raw p JOIN raw_uploads u ON u.id = p.upload_id WHERE u.api_key_id = (SELECT id FROM api_keys WHERE name = 'Exporter e2e key' AND company_id = $1) AND p.team_id NOT IN ($2, $3)`, [GOLDEN_COMPANY, A, B]).catch(() => ({ rows: [{ n: 0 }] }));
    expect(elsewhere.rows[0].n).toBe(0);
    const log = await db.query(`SELECT DISTINCT channel FROM ingestion_log WHERE company_id = $1 AND received_at > now() - interval '10 minutes' AND api_key_id IS NOT NULL`, [GOLDEN_COMPANY]);
    expect(log.rows.map((r: any) => r.channel)).toEqual(['exporter']);
    const rows = (await db.query(`SELECT * FROM exporter_deliveries WHERE company_id = $1 ORDER BY received_at`, [GOLDEN_COMPANY])).rows.slice(deliveriesBefore);
    expect(rows.length).toBeGreaterThan(8);
    for (const r of rows) {
      expect(r).toMatchObject({ company_id: GOLDEN_COMPANY, result: 'accepted', exporter_version: '0.3.0', host_label: 'e2e-host', api_key_name: 'Exporter e2e key' });
      expect([A, B]).toContain(r.team_id);
      expect(r.item_count).toBeGreaterThan(0);
      expect(r.records_stored).toBeGreaterThan(0);
      expect(JSON.stringify(r.preview)).not.toMatch(/made-up code|Made-up text|someone@example/);
    }
    // A heartbeat for Connect your CI.
    const status = await get('/api/ci/status', cookie);
    expect(status.body.exporters[0]).toMatchObject({ apiKeyName: 'Exporter e2e key', version: '0.3.0' });
    expect(status.body.exporters[0].sources.map((x: any) => x.name).sort()).toEqual(['bitbucket', 'github', 'gitlab', 'jira', 'pagerduty', 'sonarqube']);
    // A second run right away: nothing new to send (at most a run that the fake vendors just finished).
    const n = rows.length;
    const again = await run(['sync'], SECRETS);
    expect(again.code).toBe(0);
    const after = Number((await db.query(`SELECT COUNT(*)::int AS n FROM exporter_deliveries WHERE company_id = $1`, [GOLDEN_COMPANY])).rows[0].n) - deliveriesBefore;
    expect(after - n).toBeLessThanOrEqual(4);
  }, 300_000);

  it('EXE-003 QE Navigator calculates: dashboard values, "How this was calculated" and the evidence panel', async () => {
    if (!up) return;
    const snap = (await get(`/api/metrics/teams/${A}`, cookie)).body.snapshot;
    for (const col of ['test_coverage', 'first_time_pass_rate', 'test_flakiness_rate', 'avg_build_time_minutes', 'deployment_frequency_per_week', 'lead_time_days', 'change_failure_rate', 'mttr_hours', 'sprint_velocity', 'code_quality_score', 'automation_coverage']) {
      expect([col, snap[col] !== null && snap[col] !== undefined]).toEqual([col, true]);
    }
    const calc = await get(`/api/ci/teams/${A}/metrics/line_coverage`, cookie);
    expect(calc.status).toBe(200);
    expect(calc.body.formula).toBeTruthy();
    expect(calc.body.sources.coverageReports.length).toBeGreaterThan(0);
    expect(calc.body.collector).toBeUndefined();
    const ev = await get(`/api/ci/teams/${A}/evidence`, cookie);
    expect(ev.status).toBe(200);
    expect(ev.body.coverage?.lowestFiles?.length).toBeGreaterThan(0);
    expect(ev.body.failingStages.length + ev.body.flakyTests.length).toBeGreaterThan(0);
    const delivery = await get(`/api/ci/teams/${A}/delivery`, cookie);
    expect(delivery.body.deployments.length).toBeGreaterThan(0);
    const work = await get(`/api/ci/teams/${B}/work`, cookie);
    expect(work.body.sprints.length).toBeGreaterThan(0);
    expect(work.body.quality.reports.length).toBeGreaterThan(0);
  }, 120_000);

  it('EXE-004 the coverage report lists every accepted parameter as sent and stored for the team', async () => {
    if (!up) return;
    // Everything of the backfill window, delivered or not: what the Exporter sends for the team.
    const p = await run(['preview', '--all', '--since', new Date(Date.now() - 25 * 86_400_000).toISOString().slice(0, 10)], SECRETS);
    const r = await coverageReport({ url: API_URL, cookie, teamId: A, preview: JSON.parse(p.stdout) });
    const missing = r.parameters.filter((x: any) => x.expected && (!x.sent || !x.stored));
    expect(missing.map((x: any) => x.name)).toEqual([]);
    expect(r.modules.find((m: any) => m.module === 'Team pulse')).toMatchObject({ populated: false, source: 'people (not machine ingestion)' });
  }, 300_000);
});

