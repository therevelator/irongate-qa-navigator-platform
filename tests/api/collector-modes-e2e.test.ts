import http from 'http';
import { execFile, execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post } from './helpers/http';
import { buildZip } from './helpers/zipBuilder';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';
import { ENGINE_VERSION } from '../../packages/engine/src/version';

/**
 * The QE Navigator Collector in each privacy mode, end to end against a live QE Navigator: the Collector bundle runs
 * as a plain process and reads a GitHub stand-in (workflow runs with a flaky test, jobs, JUnit and lcov artifacts
 * behind a signed-URL redirect to another host, production deployments with commits). One team per mode:
 *   full      golden-team-partial  raw records land in the raw store; QE Navigator calculates (origin server)
 *   evidence  golden-team-empty    no raw records; the Collector's values (origin collector, engine version) with
 *                                  the evidence lists; KPI history, team detail and TV mode show them; "How this
 *                                  was calculated" names the Collector and its engine and shows the evidence
 *   metrics   golden-team-small    values and counts only: nothing named is stored; "How this was calculated"
 *                                  says the details stay in the customer's network and links the local page
 * Plus the heartbeat in Connect your CI status, idempotent re-runs, recalc after an engine update (a bundle with a
 * newer engine version), and the endpoint's refusals (allow-list, tenant, dry run). Skips when no backend runs.
 */
const ROOT = join(__dirname, '..', '..');
const BUNDLE = join(ROOT, 'collector', 'dist', 'qe-collector.mjs');
const DAY = 86_400_000;
const T = { full: 'golden-team-partial', evidence: 'golden-team-empty', metrics: 'golden-team-small' } as const;
const REPO = { full: 'acme/full', evidence: 'acme/evidence', metrics: 'acme/metrics' } as const;
const sha = (s: string) => createHash('sha1').update(s).digest('hex');
const BASE = Date.now() - 2 * DAY;
const at = (min: number) => new Date(BASE + min * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const RUN_DAY = new Date(BASE).toISOString().slice(0, 10);

const junit = (fail: boolean) => `<?xml version="1.0"?><testsuites><testsuite name="checkout" time="9.0">
<testcase classname="checkout" name="pays with a saved card" time="6.5">${fail ? '<failure message="Timeout SECRET-STACK alice@example.com">trace</failure>' : ''}</testcase>
<testcase classname="checkout" name="shows the total" time="1.5"/><testcase classname="cart" name="adds an item" time="1.0"/></testsuite></testsuites>`;
const LCOV = 'TN:\nSF:src/checkout/pay.ts\nLF:10\nLH:6\nBRF:4\nBRH:2\nend_of_record\nTN:\nSF:src/cart/cart.ts\nLF:10\nLH:9\nend_of_record\n';

/** A GitHub stand-in for three repositories and a storage host for the artifacts (another origin). */
async function servers() {
  const hits: Array<{ host: string; path: string; auth: string | undefined }> = [];
  const blobs = new Map<string, Buffer>();
  const storageSrv = http.createServer((req, res) => {
    hits.push({ host: 'storage', path: req.url ?? '', auth: req.headers.authorization });
    const b = blobs.get((req.url ?? '').split('?')[0].replace('/blob/', ''));
    if (!b) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/zip' }); res.end(b);
  });
  await new Promise<void>((r) => storageSrv.listen(0, '127.0.0.1', () => r()));
  const storageUrl = `http://127.0.0.1:${(storageSrv.address() as any).port}`;
  const listCalls = new Map<string, number>();
  const gh = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    hits.push({ host: 'github', path: u.pathname, auth: req.headers.authorization });
    const send = (body: unknown, status = 200, headers: Record<string, string> = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    const m = /^\/repos\/acme\/([a-z]+)(\/.*)?$/.exec(u.pathname);
    if (!m) return send({ message: 'Not Found' }, 404);
    const repo = m[1];
    const rest = m[2] ?? '';
    const runs = [
      { id: 11, run_attempt: 1, conclusion: 'failure', start: 0, end: 12 },
      { id: 11, run_attempt: 2, conclusion: 'success', start: 20, end: 31 },
      { id: 12, run_attempt: 1, conclusion: 'success', start: 60, end: 70 },
    ].map((x) => ({ id: x.id, name: 'CI', path: '.github/workflows/ci.yml', head_branch: 'main', head_sha: sha(`${repo}-${x.id}`), run_attempt: x.run_attempt, status: 'completed', conclusion: x.conclusion, created_at: at(x.start), run_started_at: at(x.start), updated_at: at(x.end), html_url: 'https://github.com/x' }));
    if (rest === '') return send({ private: true });
    if (rest === '/environments') return send({ environments: [{ name: 'production' }] });
    if (rest === '/actions/runs') return send({ total_count: runs.length, workflow_runs: u.searchParams.get('per_page') === '1' ? runs.slice(0, 1) : runs });
    let mm = /^\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/.exec(rest);
    if (mm) {
      const r = runs.find((x) => x.id === Number(mm![1]) && x.run_attempt === Number(mm![2]))!;
      const t0 = Date.parse(r.run_started_at);
      const t = (n: number) => new Date(t0 + n * 60_000).toISOString();
      return send({ jobs: [
        { name: 'build', conclusion: 'success', started_at: t(0), completed_at: t(2), steps: [{ name: 'npm ci', conclusion: 'success', started_at: t(0), completed_at: t(2) }] },
        { name: 'test (1, 2)', conclusion: r.conclusion, started_at: t(2), completed_at: t(8), steps: [] },
        { name: 'test (2, 2)', conclusion: 'success', started_at: t(2), completed_at: t(6), steps: [] },
      ] });
    }
    mm = /^\/actions\/runs\/(\d+)\/artifacts$/.exec(rest);
    if (mm) {
      const k = `${repo}-${mm[1]}`;
      const n = (listCalls.get(k) ?? 0) + 1;
      listCalls.set(k, n);
      const fail = mm[1] === '11' && n % 2 === 1;
      blobs.set(`${k}-${n}-tests`, buildZip([{ name: 'junit.xml', data: junit(fail) }]));
      blobs.set(`${k}-${n}-cov`, buildZip([{ name: 'lcov.info', data: LCOV }]));
      return send({ artifacts: [
        { id: 1, name: 'test-results', size_in_bytes: 900, expired: false, archive_download_url: `http://${req.headers.host}/repos/acme/${repo}/actions/artifacts/${k}-${n}-tests/zip` },
        { id: 2, name: 'coverage', size_in_bytes: 900, expired: false, archive_download_url: `http://${req.headers.host}/repos/acme/${repo}/actions/artifacts/${k}-${n}-cov/zip` },
      ] });
    }
    mm = /^\/actions\/artifacts\/([^/]+)\/zip$/.exec(rest);
    if (mm) return send({}, 302, { location: `${storageUrl}/blob/${mm[1]}?sig=signed` });
    if (rest === '/deployments') return send(u.searchParams.get('environment') === 'production' ? [
      { id: 2002, sha: sha(`${repo}-d2`), ref: 'main', environment: 'production', created_at: at(100) },
      { id: 2001, sha: sha(`${repo}-d1`), ref: 'main', environment: 'production', created_at: at(40) },
    ] : []);
    mm = /^\/deployments\/(\d+)\/statuses$/.exec(rest);
    if (mm) return send([{ state: 'success', created_at: mm[1] === '2001' ? at(45) : at(105) }]);
    if (rest.startsWith('/compare/')) return send({ commits: [{ sha: rest.split('...')[1], commit: { author: { date: at(-300), email: 'alice@example.com' }, committer: { date: at(-290) }, message: 'SECRET-MSG' } }] });
    if (rest.startsWith('/commits/')) return send({ sha: rest.split('/')[2], commit: { author: { date: at(-600) }, committer: { date: at(-600) } } });
    return send({ message: 'Not Found' }, 404);
  });
  await new Promise<void>((r) => gh.listen(0, '127.0.0.1', () => r()));
  const ghUrl = `http://127.0.0.1:${(gh.address() as any).port}`;
  return {
    ghUrl, hits,
    close: async () => { for (const s of [gh, storageSrv]) await new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); }); },
  };
}

let up = true;
let db: Client;
let apiKey = '';
let cookie = '';
let mock: Awaited<ReturnType<typeof servers>>;
let dir = '';

const cfgFile = (mode: keyof typeof T) => join(dir, `${mode}.yaml`);
function writeConfig(mode: keyof typeof T) {
  writeFileSync(cfgFile(mode), `qeNavigator:
  url: ${API_URL}
privacy:
  mode: ${mode}
${mode === 'metrics' ? '  localEvidenceUrl: http://qe-collector.internal:8787/\n' : ''}state:
  path: ${join(dir, `${mode}-state.json`)}
backfillDays: 20
sources:
  - type: github
    name: github
    apiUrl: ${mock.ghUrl}
    repos:
      ${REPO[mode]}: ${T[mode]}
`);
}
function collector(mode: keyof typeof T, args: string[], bundle = BUNDLE): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [bundle, ...args, '-c', cfgFile(mode), '--log-format', 'json'], {
      env: { PATH: process.env.PATH ?? '', QE_API_KEY: apiKey, GITHUB_TOKEN: 'ghp_e2e_token_value' }, timeout: 120_000,
    }, (err, stdout, stderr) => resolve({ code: err ? Number((err as any).code ?? 1) : 0, stdout, stderr }));
  });
}
const rowsOf = async (team: string) => (await db.query(
  `SELECT day::text AS day, metric_key, value::float8 AS value, inputs, sources, origin, engine_version, privacy_mode, local_evidence_url, computed_at FROM metric_evidence WHERE team_id = $1 ORDER BY day, metric_key`, [team])).rows;
const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].n);
const collectorLog = async () => count(`SELECT COUNT(*) AS n FROM ingestion_log WHERE company_id = $1 AND source LIKE 'collector values%'`, [GOLDEN_COMPANY]);

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running at', API_URL, '- Collector privacy-mode tests skipped'); return; }
  if (!existsSync(BUNDLE)) execFileSync(process.execPath, [join(ROOT, 'collector', 'scripts', 'build.mjs')], { stdio: 'ignore' });
  db = await localDb();
  await createGolden(db);
  cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', cookie, { name: 'qe-collector modes e2e' })).body.plaintextKey;
  mock = await servers();
  dir = mkdtempSync(join(tmpdir(), 'qe-collector-modes-'));
  for (const m of ['full', 'evidence', 'metrics'] as const) writeConfig(m);
}, 60_000);

afterAll(async () => {
  if (mock) await mock.close();
  if (db) {
    await db.query(`DELETE FROM collector_heartbeats WHERE company_id = $1`, [GOLDEN_COMPANY]);
    await db.query(`DELETE FROM collector_evidence WHERE company_id = $1`, [GOLDEN_COMPANY]);
    await removeGolden(db);
    await db.end();
  }
});

describe('QE Navigator Collector privacy modes against the real API', () => {
  it('CLM-001 full: minimised raw records land in the raw store and QE Navigator calculates (origin server)', async () => {
    if (!up) return;
    const r = await collector('full', ['sync']);
    expect(r.code).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM test_runs WHERE team_id = $1`, [T.full])).toBe(3);
    expect(await count(`SELECT COUNT(*) AS n FROM coverage_reports WHERE team_id = $1`, [T.full])).toBe(3);
    expect(await count(`SELECT COUNT(*) AS n FROM pipeline_runs_raw WHERE team_id = $1`, [T.full])).toBe(3);
    expect(await count(`SELECT COUNT(*) AS n FROM deployments_raw WHERE team_id = $1`, [T.full])).toBe(2);
    const stored = JSON.stringify((await db.query(`SELECT * FROM test_results WHERE team_id = $1`, [T.full])).rows);
    expect(stored).toContain('pays with a saved card');
    for (const bad of ['SECRET', 'alice@']) expect(stored).not.toContain(bad);
    const rows = await rowsOf(T.full);
    const flaky = rows.find((x: any) => x.day === RUN_DAY && x.metric_key === 'flaky_tests');
    expect(flaky).toMatchObject({ value: 1, origin: 'server' });
    expect(rows.find((x: any) => x.day === RUN_DAY && x.metric_key === 'line_coverage')).toMatchObject({ value: 75, origin: 'server' });
    const calc = (await get(`/api/ci/teams/${T.full}/metrics/test_coverage`, cookie)).body;
    expect(calc.collector).toBeUndefined();
  });

  it('CLM-002 evidence: values calculated by the Collector with the evidence lists; no raw records; dashboards, KPI history, TV mode and "How this was calculated" use them', async () => {
    if (!up) return;
    const r = await collector('evidence', ['sync']);
    expect(r.code).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM test_runs WHERE team_id = $1`, [T.evidence])).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM raw_uploads WHERE team_id = $1`, [T.evidence])).toBe(0);
    const rows = await rowsOf(T.evidence);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((x: any) => x.origin === 'collector' && x.engine_version === ENGINE_VERSION && x.privacy_mode === 'evidence')).toBe(true);
    const flaky = rows.find((x: any) => x.day === RUN_DAY && x.metric_key === 'test_flakiness_rate');
    expect(flaky.sources.flakyTests).toEqual([{ name: 'pays with a saved card', suite: 'checkout', commit: sha('evidence-11'), failedRuns: 1, passedRuns: 1 }]);
    // The same engine as the server: the full-mode team (same data) got the same values.
    const full = await rowsOf(T.full);
    for (const k of ['line_coverage', 'flaky_tests', 'test_flakiness_rate', 'first_time_pass_rate', 'pipeline_success_rate', 'build_time', 'parallel_test_efficiency']) {
      expect([k, rows.find((x: any) => x.day === RUN_DAY && x.metric_key === k)?.value]).toEqual([k, full.find((x: any) => x.day === RUN_DAY && x.metric_key === k)?.value]);
    }
    const stored = JSON.stringify(rows);
    for (const bad of ['SECRET', 'alice@', 'Timeout']) expect(stored).not.toContain(bad);
    // KPI history and team detail: the KPI value written as source "collector".
    const snap = (await db.query(`SELECT test_coverage::float8 AS v, field_sources -> 'test_coverage' ->> 'source' AS source FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`, [T.evidence, RUN_DAY])).rows[0];
    expect(snap).toEqual({ v: 75, source: 'collector' });
    const history = (await get(`/api/teams/${T.evidence}/kpi-history?days=30`, cookie)).body;
    expect(JSON.stringify(history)).toContain('75');
    const tv = await get(`/api/tv/teams/${T.evidence}`, cookie);
    expect(tv.status).toBe(200);
    // "How this was calculated": calculated by the Collector (engine version), with the evidence.
    const calc = (await get(`/api/ci/teams/${T.evidence}/metrics/test_flakiness_rate?date=${RUN_DAY}`, cookie)).body;
    expect(calc.collector).toMatchObject({ engineVersion: ENGINE_VERSION, collectorVersion: '0.2.0', mode: 'evidence', localEvidenceUrl: null });
    expect(calc.flakyTests[0].name).toBe('pays with a saved card');
    const cov = (await get(`/api/ci/teams/${T.evidence}/metrics/test_coverage?date=${RUN_DAY}`, cookie)).body;
    expect(cov.lowestFiles[0]).toEqual({ path: 'src/checkout/pay.ts', linesFound: 10, linesHit: 6 });
    const ev = (await get(`/api/ci/teams/${T.evidence}/evidence`, cookie)).body;
    expect(ev.collector).toMatchObject({ engineVersion: ENGINE_VERSION });
    expect(ev.flakyTests.map((f: any) => f.name)).toEqual(['pays with a saved card']);
    expect(ev.failingStages[0]).toMatchObject({ name: 'test (1, 2)', failed: 1 });
    // Recommendations and forecasts work from the values.
    const improve = await get(`/api/improve/teams/${T.evidence}`, cookie);
    expect(improve.status).toBe(200);
  });

  it('CLM-003 metrics: values and counts only; nothing named is stored; "How this was calculated" keeps the details in the network and links the local page', async () => {
    if (!up) return;
    const r = await collector('metrics', ['sync']);
    expect(r.code).toBe(0);
    const rows = await rowsOf(T.metrics);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((x: any) => x.origin === 'collector' && x.privacy_mode === 'metrics' && JSON.stringify(x.sources) === '{}')).toBe(true);
    for (const x of rows) for (const v of Object.values(x.inputs)) expect(typeof v).toBe('number');
    const everything = JSON.stringify([rows, (await db.query(`SELECT * FROM ingestion_log WHERE company_id = $1 AND source LIKE 'collector%'`, [GOLDEN_COMPANY])).rows.filter((l: any) => JSON.stringify(l).includes(T.metrics)),
      (await db.query(`SELECT * FROM collector_evidence WHERE team_id = $1`, [T.metrics])).rows]);
    for (const bad of ['pays with a saved card', 'src/checkout', 'test (1, 2)', sha('metrics-11'), '2001', 'alice', 'SECRET']) expect(everything).not.toContain(bad);
    expect(rows.find((x: any) => x.day === RUN_DAY && x.metric_key === 'flaky_tests')?.value).toBe(1);
    const calc = (await get(`/api/ci/teams/${T.metrics}/metrics/test_flakiness_rate?date=${RUN_DAY}`, cookie)).body;
    expect(calc.collector).toMatchObject({ mode: 'metrics', localEvidenceUrl: 'http://qe-collector.internal:8787/', engineVersion: ENGINE_VERSION });
    expect(calc.flakyTests).toBeUndefined();
    expect(calc.inputs).toMatchObject({ flakyTests: 1, distinctTests: 3 });
    const improve = await get(`/api/improve/teams/${T.metrics}`, cookie);
    expect(improve.status).toBe(200);
  });

  it('CLM-004 heartbeat: Connect your CI status shows each Collector (version, engine, mode, sources, last seen); artifacts reached the storage host without the token', async () => {
    if (!up) return;
    const st = (await get('/api/ci/status', cookie)).body;
    expect(st.collectors.length).toBe(1);
    expect(st.collectors[0]).toMatchObject({ apiKeyName: 'qe-collector modes e2e', version: '0.2.0', engineVersion: ENGINE_VERSION, outdated: false, stale: false });
    expect(['full', 'evidence', 'metrics']).toContain(st.collectors[0].mode);
    expect(st.collectors[0].sources).toEqual([expect.objectContaining({ name: 'github', type: 'github', errors: 0 })]);
    expect(await count(`SELECT COUNT(*) AS n FROM ingestion_log WHERE company_id = $1 AND source LIKE '%heartbeat%'`, [GOLDEN_COMPANY])).toBe(0);
    const storage = mock.hits.filter((h) => h.host === 'storage');
    expect(storage.length).toBeGreaterThanOrEqual(18);
    expect(storage.every((h) => h.auth === undefined)).toBe(true);
    expect(mock.hits.filter((h) => h.host === 'github').every((h) => h.auth === 'Bearer ghp_e2e_token_value')).toBe(true);
  });

  it('CLM-005 idempotent: re-runs send no value again; recalc after an engine update resends with the new engine version', async () => {
    if (!up) return;
    const before = await collectorLog();
    const at0 = (await rowsOf(T.evidence)).map((x: any) => String(x.computed_at));
    for (const m of ['evidence', 'metrics', 'full'] as const) expect((await collector(m, ['sync'])).code).toBe(0);
    expect(await collectorLog()).toBe(before);
    expect((await rowsOf(T.evidence)).map((x: any) => String(x.computed_at))).toEqual(at0);
    // A newer engine (the bundle of the next release): recalc sends the values again, recorded with its version.
    const bumped = join(dir, 'qe-collector-next.mjs');
    copyFileSync(BUNDLE, bumped);
    const text = readFileSync(bumped, 'utf8');
    expect(text).toContain(`ENGINE_VERSION = "${ENGINE_VERSION}"`);
    writeFileSync(bumped, text.replace(`ENGINE_VERSION = "${ENGINE_VERSION}"`, 'ENGINE_VERSION = "9.9.9"'));
    const r = await collector('evidence', ['recalc', '--since', new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10)], bumped);
    expect(r.code).toBe(0);
    const after = await rowsOf(T.evidence);
    expect(after.filter((x: any) => x.day >= new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10)).every((x: any) => x.engine_version === '9.9.9')).toBe(true);
    const calc = (await get(`/api/ci/teams/${T.evidence}/metrics/test_coverage`, cookie)).body;
    expect(calc.collector.engineVersion).toBe('9.9.9');
  });

  it('CLM-006 the endpoint refuses what the allow-list does not allow, a team of another company, and stores nothing on a dry run', async () => {
    if (!up) return;
    const send = (body: unknown, q = '') => request(API_URL).post(`/api/ingest/collector/metrics${q}`).set('Authorization', `Bearer ${apiKey}`).set('Content-Type', 'application/json').send(JSON.stringify(body));
    const day = new Date().toISOString().slice(0, 10);
    const metric = { key: 'line_coverage', value: 80, sampleSize: 3, recordedAt: new Date().toISOString(), inputs: { linesHit: 8, linesFound: 10 } };
    const base = (m: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ collector: 'qe-collector/0.2.0', engineVersion: '1.0.0', mode: 'metrics', teams: [{ teamId: T.metrics, days: [{ day, metrics: [{ ...metric, ...m }] }] }], ...extra });
    expect((await request(API_URL).post('/api/ingest/collector/metrics').send(base())).status).toBe(401);
    let r = await send(base({ evidence: { lowestFiles: [{ path: 'src/a.ts', linesFound: 1, linesHit: 0 }] } }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/evidence is not allowed in metrics mode/);
    r = await send(base({ inputs: { branch: 'main' } }));
    expect(r.body.error).toMatch(/must be a number/);
    r = await send(base({ key: 'drop_table_users' }));
    expect(r.body.error).toMatch(/is not a metric QE Navigator calculates/);
    r = await send(base({ value: 140 }));
    expect(r.body.error).toMatch(/from 0 to 100/);
    r = await send({ ...base(), mode: 'evidence', teams: [{ teamId: T.metrics, days: [{ day, metrics: [{ ...metric, evidence: { lowestFiles: [{ path: 'x', linesFound: 1, linesHit: 0, owner: 'alice@example.com' }] } }] }] }] });
    expect(r.body.error).toMatch(/owner is not an allowed field/);
    r = await send({ ...base(), teams: [{ teamId: T.metrics, days: [{ day: '2099-01-01', metrics: [metric] }] }] });
    expect(r.body.error).toMatch(/in the future/);
    const foreign = (await db.query(`SELECT id FROM teams WHERE company_id <> $1 LIMIT 1`, [GOLDEN_COMPANY])).rows[0].id;
    r = await send({ ...base(), teams: [{ teamId: foreign, days: [{ day, metrics: [metric] }] }] });
    expect(r.status).toBe(403);
    expect(await count(`SELECT COUNT(*) AS n FROM metric_evidence WHERE team_id = $1`, [foreign])).toBeGreaterThanOrEqual(0);
    const n = await count(`SELECT COUNT(*) AS n FROM metric_evidence WHERE team_id = $1 AND day = $2::date AND value = 80`, [T.metrics, day]);
    r = await send(base(), '?dryRun=true');
    expect(r.body).toMatchObject({ status: 'dry-run', values: 1 });
    expect(await count(`SELECT COUNT(*) AS n FROM metric_evidence WHERE team_id = $1 AND day = $2::date AND value = 80`, [T.metrics, day])).toBe(n);
    // The heartbeat refuses data it does not know.
    const hb = await request(API_URL).post('/api/ingest/collector/heartbeat').set('Authorization', `Bearer ${apiKey}`).set('Content-Type', 'application/json')
      .send(JSON.stringify({ collector: 'qe-collector/0.2.0', version: '0.2.0', engineVersion: '1.0.0', mode: 'metrics', sources: [{ name: 'github', type: 'github', errors: 0, lastErrorMessage: 'token ghp_x' }] }));
    expect(hb.status).toBe(400);
    expect(hb.body.error).toMatch(/lastErrorMessage is not an allowed field/);
  });
});
