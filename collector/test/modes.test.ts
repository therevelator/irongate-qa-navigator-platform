/**
 * Privacy modes end to end against stand-ins (GitHub Actions, Jira Cloud, PagerDuty, and a QE Navigator that
 * records every request): exactly what each mode sends, idempotent re-runs, recalculation from the local copy
 * (after an engine update), the local copy's retention, the local evidence page and the diagnostics bundle.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import { configureLog } from '../src/log';
import { runSync, runRecalc, runPreview, EXIT } from '../src/run';
import { LocalStore } from '../src/store';
import { startServer } from '../src/serve';
import { diagnostics } from '../src/diagnose';
import { numericInputs } from '../src/modes';
import { fixture, MockServer, config, shift, SHIFT_TO_NOW, tmpDir, type Recorded } from './helpers';
import { storage, mockGitHub, SHA, type StorageMock } from './ci-fixtures';
import { METRICS, ENGINE_VERSION } from '../src/calc';
import type { Config } from '../src/config';

configureLog({ sink: () => {} });
const KEY = 'igk_test_0123456789abcdefghijklmnopqrstuvwxyzABCDEF';
const ENV = { QE_API_KEY: KEY, GITHUB_TOKEN: 'ghp_secret_token_value_1234', JIRA_TOKEN: 'jira-secret-token-1', JIRA_EMAIL: 'svc@example.com', PAGERDUTY_TOKEN: 'pd-secret-token-1' };

let gh: MockServer;
let vendors: MockServer;
let qe: MockServer;
let store: StorageMock;
let dir: string;

function mockQe(s: MockServer) {
  for (const p of ['/api/ingest/collector/metrics', '/api/ingest/tests', '/api/ingest/coverage', '/api/ingest/pipelines', '/api/ingest/deployments', '/api/ingest/static-analysis', '/api/ingest/issues', '/api/ingest/incidents']) {
    s.on('POST', p, (r: Recorded) => {
      assert.equal(r.headers.authorization, `Bearer ${KEY}`);
      assert.match(String(r.headers['user-agent']), /^qe-collector\/\d+\.\d+\.\d+ /);
      if (r.query.get('dryRun') === 'true') return { status: 200, body: { status: 'dry-run' } };
      if (p.endsWith('issues')) return { status: 201, body: { status: 'accepted', issues: (r.json.issues ?? []).map((x: any) => ({ key: x.key, status: 'written' })) } };
      if (p.endsWith('incidents')) return { status: 201, body: { status: 'accepted', events: (r.json.incidents ?? []).map((x: any) => ({ id: x.id, status: 'written' })) } };
      return { status: 201, body: { status: 'accepted' } };
    });
  }
  s.on('POST', '/api/ingest/collector/heartbeat', () => ({ status: 200, body: { status: 'ok' } }));
}

function mockJiraPd(s: MockServer) {
  s.on('GET', '/rest/api/3/myself', () => ({ body: fixture('jira-myself.json') }))
    .on('GET', '/rest/api/3/field', () => ({ body: fixture('jira-fields.json') }))
    .on('GET', '/rest/api/3/status', () => ({ body: fixture('jira-status.json') }))
    .on('GET', '/rest/api/3/search/jql', (r) => ({ body: shift(r.query.get('nextPageToken') === 'CAEaAggD' ? fixture('jira-cloud-search-page2.json') : fixture('jira-cloud-search-page1.json'), SHIFT_TO_NOW) }))
    .on('GET', '/rest/api/3/issue/PAY-101/changelog', () => ({ body: shift(fixture('jira-cloud-changelog-PAY-101.json'), SHIFT_TO_NOW) }))
    .on('GET', '/log_entries', (r) => {
      const out = shift(fixture('pagerduty-log-entries.json'), SHIFT_TO_NOW);
      out.log_entries = out.log_entries.filter((e: any) => Date.parse(e.created_at) >= Date.parse(r.query.get('since')!) && Date.parse(e.created_at) < Date.parse(r.query.get('until')!));
      return { body: out };
    });
}

function cfgFor(mode: 'full' | 'evidence' | 'metrics', extra: Record<string, unknown> = {}): Config {
  const c = config({
    qeNavigator: { url: qe.url }, privacy: { mode, ...(mode === 'metrics' ? { localEvidenceUrl: 'http://qe-collector.internal:8787/' } : {}) }, state: { path: join(dir, 'state.json') },
    http: { maxRetries: 1, maxRetryWaitSeconds: 1 }, backfillDays: 30,
    sources: [
      { type: 'github', name: 'github', apiUrl: gh.url, repos: { 'acme/payments': 'team-pay' } },
      { type: 'jira', name: 'jira', baseUrl: vendors.url, deployment: 'cloud', jql: 'project in (PAY, WEB)', teams: { PAY: 'team-pay', WEB: 'team-web' } },
      { type: 'pagerduty', name: 'pagerduty', apiUrl: vendors.url, services: { 'payments-api': 'team-pay', checkout: 'team-web' } },
    ],
    ...extra,
  });
  c.qeNavigator.requestsPerMinute = 600_000;
  return c;
}

const posts = (path: string) => qe.requests.filter((r) => r.method === 'POST' && r.path === path && r.query.get('dryRun') !== 'true');
/** String values (not keys) anywhere in a value. */
const values = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => values(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => values(x, out));
  return out;
};
const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
};
const SENSITIVE = ['pays with a saved card', 'checkout', 'src/checkout/pay.ts', 'src/db/query.ts', 'js/sql-injection', 'npm ci', 'test (1, 2)', 'PAY-101', 'PAY-102', 'WEB-9', 'payments-api', SHA.c1, SHA.d1, 'alice', 'SECRET', '@example.com', 'Refund to card', 'Disk full'];

beforeEach(async () => {
  store = await storage();
  gh = await new MockServer().start();
  mockGitHub(gh, store);
  vendors = await new MockServer().start();
  mockJiraPd(vendors);
  qe = await new MockServer().start();
  mockQe(qe);
  dir = tmpDir();
});
afterEach(async () => { await gh.stop(); await vendors.stop(); await qe.stop(); await store.server.stop(); });

describe('metrics mode', () => {
  test('sends values and counts only: no name, key, path, title, commit or person; a heartbeat without data; nothing raw', async () => {
    const cfg = cfgFor('metrics');
    assert.equal(await runSync(cfg, { env: ENV }), EXIT.OK);
    for (const p of ['/api/ingest/tests', '/api/ingest/coverage', '/api/ingest/pipelines', '/api/ingest/deployments', '/api/ingest/static-analysis', '/api/ingest/issues', '/api/ingest/incidents']) assert.equal(posts(p).length, 0, `${p}: nothing raw`);
    const bodies = posts('/api/ingest/collector/metrics').map((r) => r.json);
    assert.ok(bodies.length >= 1);
    const raw = posts('/api/ingest/collector/metrics').map((r) => r.body).join('\n');
    for (const s of SENSITIVE) assert.ok(!raw.includes(s), `metrics mode must not send "${s}"`);
    const teams = new Set(['team-pay', 'team-web']);
    for (const v of values(bodies)) {
      assert.ok(/^qe-collector\/\d+\.\d+\.\d+$/.test(v) || v === ENGINE_VERSION || v === 'metrics' || v === 'http://qe-collector.internal:8787/' || teams.has(v)
        || /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !!METRICS[v], `unexpected text "${v}"`);
    }
    const allowedKeys = new Set(['collector', 'engineVersion', 'mode', 'localEvidenceUrl', 'teams', 'teamId', 'days', 'day', 'metrics', 'key', 'value', 'sampleSize', 'recordedAt', 'inputs']);
    for (const b of bodies) for (const t of b.teams) {
      assert.equal(t.evidence, undefined);
      for (const d of t.days) for (const m of d.metrics) {
        assert.equal(m.evidence, undefined);
        for (const k of Object.keys(m)) assert.ok(allowedKeys.has(k), k);
        for (const v of Object.values(m.inputs)) assert.equal(typeof v, 'number');
      }
    }
    // The values themselves: flaky checkout test on c1 (failed in attempt 1, passed in attempt 2), first-time pass rate 1 of 2 runs, deployments.
    const all = bodies.flatMap((b) => b.teams.filter((t: any) => t.teamId === 'team-pay').flatMap((t: any) => t.days.map((d: any) => ({ day: d.day, m: Object.fromEntries(d.metrics.map((x: any) => [x.key, x])) }))));
    const runDay = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const d = all.find((x) => x.day === runDay)!.m;
    assert.equal(d.flaky_tests.value, 1);
    assert.equal(d.flaky_tests.inputs.distinctTests, 3);
    assert.equal(d.first_time_pass_rate.value, 50);
    assert.equal(d.pipeline_success_rate.value, 66.67);
    assert.equal(d.line_coverage.value, 66.67);
    assert.ok(d.code_quality && d.findings.value === 2, 'code quality from the SARIF artifact');
    const today = all.find((x) => x.day === new Date().toISOString().slice(0, 10))!.m;
    assert.equal(today.change_failure_rate.inputs.failedChanges, 2, 'the deployment rolled back, and the one followed by a hotfix');
    assert.equal(today.deployment_frequency.inputs.productionDeploys, 3, 'the rollback deploy and the failed one are not counted');
    const hb = posts('/api/ingest/collector/heartbeat');
    assert.equal(hb.length, 1);
    assert.deepEqual(Object.keys(hb[0].json).sort(), ['collector', 'engineVersion', 'localEvidenceUrl', 'mode', 'node', 'platform', 'sources', 'store', 'teams', 'version']);
    assert.deepEqual(hb[0].json.sources.map((s: any) => [s.name, s.errors, !!s.lastSuccessAt]), [['github', 0, true], ['jira', 0, true], ['pagerduty', 0, true]]);
    for (const s of SENSITIVE) assert.ok(!hb[0].body.includes(s));
    // The local copy holds the raw records (files 0600, folders 0700), for the local page and recalculation.
    const data = join(dir, 'qe-collector-data');
    assert.ok(readdirSync(join(data, 'testRun')).length >= 1);
    assert.equal(statSync(join(data, 'testRun', readdirSync(join(data, 'testRun'))[0])).mode & 0o777, 0o600);
    assert.equal(statSync(join(data, 'testRun')).mode & 0o777, 0o700);
    assert.ok(readFileSync(join(data, 'testRun', readdirSync(join(data, 'testRun'))[0]), 'utf8').includes('pays with a saved card'));
  });

  test('a re-run sends no value again (only the heartbeat); recalc sends only what an engine update changed', async () => {
    const cfg = cfgFor('metrics');
    await runSync(cfg, { env: ENV });
    const first = posts('/api/ingest/collector/metrics').length;
    assert.equal(await runSync(cfg, { env: ENV }), EXIT.OK);
    assert.equal(posts('/api/ingest/collector/metrics').length, first, 'nothing changed: nothing sent');
    assert.equal(posts('/api/ingest/collector/heartbeat').length, 2);
    // recalc with nothing changed: nothing sent.
    assert.equal(await runRecalc(cfg, { env: ENV, since: new Date(Date.now() - 30 * 86_400_000) }), EXIT.OK);
    assert.equal(posts('/api/ingest/collector/metrics').length, first);
    // The values were delivered by an older engine (the fingerprints name the engine version): recalc resends every day.
    const st = JSON.parse(readFileSync(cfg.statePath, 'utf8'));
    const days = Object.keys(st.metrics).length;
    for (const k of Object.keys(st.metrics)) st.metrics[k] = 'from-engine-0.9.0';
    writeFileSync(cfg.statePath, JSON.stringify(st));
    assert.equal(await runRecalc(cfg, { env: ENV, since: new Date(Date.now() - 30 * 86_400_000) }), EXIT.OK);
    const resent = posts('/api/ingest/collector/metrics').slice(first).flatMap((r) => r.json.teams.flatMap((t: any) => t.days));
    assert.equal(resent.length, days);
    assert.ok(posts('/api/ingest/collector/metrics').slice(first).every((r) => r.json.engineVersion === ENGINE_VERSION));
    // recalc without --since, or in full mode, is refused.
    assert.equal(await runRecalc(cfg, { env: ENV }), EXIT.CONFIG);
    assert.equal(await runRecalc(cfgFor('full'), { env: ENV, since: new Date() }), EXIT.CONFIG);
  });

  test('a value refused by QE Navigator (400) is reported (exit 6) and not marked delivered; an unreachable QE Navigator is exit 4 and nothing is marked', async () => {
    qe.on('POST', '/api/ingest/collector/metrics', () => ({ status: 400, body: { error: 'Invalid Collector values: teams[0].teamId must be a team id' } }));
    const cfg = cfgFor('metrics');
    assert.equal(await runSync(cfg, { env: ENV }), EXIT.PARTIAL);
    assert.equal(Object.keys(JSON.parse(readFileSync(cfg.statePath, 'utf8')).metrics ?? {}).length, 0);
    const down = cfgFor('metrics', { state: { path: join(dir, 'down.json') } });
    down.qeNavigator.url = 'http://127.0.0.1:1';
    assert.equal(await runSync(down, { env: ENV }), EXIT.QE);
    assert.equal(Object.keys(JSON.parse(readFileSync(down.statePath, 'utf8')).metrics ?? {}).length, 0);
  });
});

describe('evidence mode', () => {
  test('sends the values with the allowed evidence lists only: flaky test names, lowest-coverage files, stages, failed deploys, escaped keys', async () => {
    const cfg = cfgFor('evidence');
    assert.equal(await runSync(cfg, { env: ENV }), EXIT.OK);
    const bodies = posts('/api/ingest/collector/metrics').map((r) => r.json);
    const raw = posts('/api/ingest/collector/metrics').map((r) => r.body).join('\n');
    for (const s of ['SECRET', '@example.com', 'alice', 'Refund to card', 'Disk full', 'Timeout waiting']) assert.ok(!raw.includes(s), `never sent: "${s}"`);
    const evidenceKeys = new Set(['flakyTests', 'lowestFiles', 'failedDeployments', 'escaped', 'name', 'suite', 'commit', 'failedRuns', 'passedRuns', 'path', 'linesFound', 'linesHit', 'deploymentId', 'reasons', 'type', 'ref', 'at']);
    const teamEvidenceKeys = new Set(['asOf', 'flakyTests', 'lowestFiles', 'slowestStages', 'failingStages', 'name', 'suite', 'commits', 'failedRuns', 'passedRuns', 'lastSeen', 'path', 'linesFound', 'linesHit', 'branchesFound', 'branchesHit', 'coverage', 'runs', 'medianSeconds', 'maxSeconds', 'failed', 'failureRate']);
    let flaky = false;
    let files = false;
    let failed = false;
    let panel = false;
    for (const b of bodies) for (const t of b.teams) {
      if (t.evidence) { panel = true; for (const k of keysOf(t.evidence)) assert.ok(teamEvidenceKeys.has(k), `team evidence field ${k}`); }
      for (const d of t.days) for (const m of d.metrics) {
        if (!m.evidence) continue;
        assert.ok(['flaky_tests', 'test_flakiness_rate', 'line_coverage', 'change_failure_rate', 'escape_rate', 'defect_density'].includes(m.key), `evidence on ${m.key}`);
        for (const k of keysOf(m.evidence)) assert.ok(evidenceKeys.has(k), `evidence field ${k}`);
        if (m.evidence.flakyTests?.some((f: any) => f.name === 'pays with a saved card' && f.failedRuns === 1 && f.passedRuns === 1)) flaky = true;
        if (m.evidence.lowestFiles?.[0]?.path === 'src/checkout/pay.ts') files = true;
        if (m.evidence.failedDeployments?.some((x: any) => x.deploymentId === '9003' && x.reasons[0].type === 'rollback')) failed = true;
      }
    }
    assert.ok(flaky && files && failed && panel, JSON.stringify({ flaky, files, failed, panel }));
    const pay = bodies.flatMap((b) => b.teams.filter((t: any) => t.teamId === 'team-pay' && t.evidence)).pop();
    assert.deepEqual(pay.evidence.slowestStages.map((s: any) => s.name).slice(0, 1), ['test (1, 2)']);
    assert.deepEqual(pay.evidence.failingStages.map((s: any) => [s.name, s.failed]), [['test (1, 2)', 1]]);
    // A re-run sends nothing new.
    const n = posts('/api/ingest/collector/metrics').length;
    await runSync(cfg, { env: ENV });
    assert.equal(posts('/api/ingest/collector/metrics').length, n);
  });

  test('preview shows exactly the bodies sync sends and stores nothing (no state, no local copy)', async () => {
    const cfg = cfgFor('evidence');
    let out = '';
    assert.equal(await runPreview(cfg, { env: ENV, out: (t) => { out += t; } }), EXIT.OK);
    assert.equal(existsSync(cfg.statePath), false);
    assert.equal(existsSync(cfg.store.dir), false);
    assert.equal(posts('/api/ingest/collector/metrics').length, 0);
    const report = JSON.parse(out);
    assert.equal(report.mode, 'evidence');
    assert.ok(!out.includes(KEY) && !out.includes('ghp_secret'));
    await runSync(cfg, { env: ENV });
    assert.deepEqual(posts('/api/ingest/collector/metrics').map((r) => r.json), report.requests.map((q: any) => q.body));
  });
});

describe('full mode', () => {
  test('minimised raw records to the existing endpoints: JUnit without messages, lcov per file, runs with stages, deployments with commits, SARIF without messages', async () => {
    const cfg = cfgFor('full');
    assert.equal(await runSync(cfg, { env: ENV }), EXIT.OK);
    assert.equal(posts('/api/ingest/collector/metrics').length, 0);
    const tests = posts('/api/ingest/tests');
    assert.equal(tests.length, 3);
    assert.deepEqual(tests.map((t) => [t.query.get('run'), t.query.get('attempt'), t.query.get('commit'), t.query.get('format')]), [['101', '1', SHA.c1, 'junit'], ['101', '2', SHA.c1, 'junit'], ['102', '1', SHA.c2, 'junit']]);
    assert.match(tests[0].body, /<testcase classname="checkout" name="pays with a saved card" time="6.500"><failure\/><\/testcase>/);
    for (const t of tests) for (const s of ['SECRET', 'alice', 'Timeout waiting', '/home/runner']) assert.ok(!t.body.includes(s));
    const cov = posts('/api/ingest/coverage');
    assert.match(cov[0].body, /SF:src\/checkout\/pay.ts\nLF:4\nLH:2\nBRF:2\nBRH:1/);
    const pipes = posts('/api/ingest/pipelines');
    assert.deepEqual(pipes[0].json.map((p: any) => [p.id, p.attempt, p.result, p.stages.length]), [['101', 1, 'failed', 3], ['101', 2, 'success', 4], ['102', 1, 'success', 4], ['103', 1, 'cancelled', 4]]);
    const deps = posts('/api/ingest/deployments')[0].json;
    assert.deepEqual(deps.map((d: any) => [d.id, d.result, d.rollbackOf, d.commits.length]), [['9001', 'success', null, 1], ['9002', 'success', null, 2], ['9003', 'success', null, 2], ['9004', 'success', '9003', 2], ['9005', 'failure', null, 0]]);
    const sa = posts('/api/ingest/static-analysis');
    assert.equal(sa.length, 3);
    assert.ok(!sa[0].body.includes('SECRET-QUERY') && sa[0].body.includes('js/sql-injection'));
    assert.equal(posts('/api/ingest/issues').length, 1);
    assert.equal(posts('/api/ingest/incidents').length, 1);
    // A re-run sends nothing.
    const before = qe.requests.filter((r) => r.method === 'POST' && !r.path.endsWith('heartbeat')).length;
    await runSync(cfg, { env: ENV });
    assert.equal(qe.requests.filter((r) => r.method === 'POST' && !r.path.endsWith('heartbeat')).length, before);
  });
});

describe('the local copy', () => {
  test('retention deletes old month files; per-test results and per-file coverage are dropped after detailDays; a damaged line is skipped', () => {
    const d = join(tmpDir(), 'data');
    const s = new LocalStore(d, 60, 10);
    const now = Date.now();
    const old = now - 90 * 86_400_000;
    const mid = now - 20 * 86_400_000;
    const run = (id: string, at: number) => ({ id, commit: 'c', runId: id, attempt: 1, branch: 'main', day: new Date(at).toISOString().slice(0, 10), startedAt: at, passed: 1, failed: 0, errored: 0, skipped: 0, durationMs: 10, cases: [{ testKey: 'k', suite: 's', name: 'n', status: 'passed' as const, durationMs: 1, retries: 0 }] });
    assert.equal(s.put('testRun', 't', 'old', run('old', old)), true);
    assert.equal(s.put('testRun', 't', 'mid', run('mid', mid)), true);
    assert.equal(s.put('testRun', 't', 'new', run('new', now)), true);
    assert.equal(s.put('testRun', 't', 'new', run('new', now)), false, 'unchanged: nothing written');
    const r = s.compact(now);
    assert.equal(r.deletedFiles, 1);
    assert.equal(r.detailDropped, 1);
    const again = new LocalStore(d, 60, 10);
    writeFileSync(join(d, 'testRun', `${new Date(now).toISOString().slice(0, 7)}.jsonl`), '{damaged\n', { flag: 'a' });
    const l = again.load();
    assert.equal(l.damaged, 1);
    assert.deepEqual(again.records('t').testRuns.map((x) => [x.id, x.cases!.length]).sort(), [['mid', 0], ['new', 1]]);
  });
});

describe('the local evidence page', () => {
  test('binds to the configured interface only, read-only, no scripts or external assets, escapes what it shows', async () => {
    const cfg = cfgFor('metrics');
    await runSync(cfg, { env: ENV });
    // A test name with markup in the local copy.
    const s = new LocalStore(cfg.store.dir, cfg.store.retentionDays, cfg.store.detailDays);
    s.load();
    const r = s.records('team-pay').testRuns[0];
    s.put('testRun', 'team-pay', r.id, { ...r, cases: r.cases!.map((c) => (c.name === 'pays with a saved card' ? { ...c, name: '<script>alert(1)</script>' } : c)) });
    const page = await startServer(cfg, {}, { port: 0 });
    try {
      assert.match(page.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      const get = (path: string, headers: Record<string, string> = {}, method = 'GET') => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((res, rej) => {
        const q = http.request(new URL(path, page.url), { method, headers }, (x) => { let b = ''; x.on('data', (c) => (b += c)); x.on('end', () => res({ status: x.statusCode!, headers: x.headers, body: b })); });
        q.on('error', rej);
        q.end();
      });
      const home = await get('/');
      assert.equal(home.status, 200);
      assert.match(home.body, /team-pay/);
      assert.match(String(home.headers['content-security-policy']), /default-src 'none'/);
      assert.equal(home.headers['x-frame-options'], 'DENY');
      assert.ok(!/<script|src="http|href="http/.test(home.body));
      const team = await get('/team/team-pay');
      assert.equal(team.status, 200);
      assert.match(team.body, /src\/checkout\/pay\.ts/);
      assert.match(team.body, /9003/);
      assert.ok(team.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;') || !team.body.includes('<script>alert'), 'escaped');
      assert.ok(!team.body.includes('<script>alert'));
      assert.equal((await get('/', {}, 'POST')).status, 405);
      assert.equal((await get('/team/other-team')).status, 404);
      assert.equal((await get('/team/..%2F..%2Fetc%2Fpasswd')).status, 404);
    } finally { await page.close(); }
  });

  test('a wildcard address needs basic auth; with auth set every request needs the right user and password', async () => {
    const cfg = cfgFor('metrics', { serve: { host: '0.0.0.0' } });
    await assert.rejects(startServer(cfg, {}), /listens on every interface/);
    await assert.rejects(startServer(cfg, { QE_SERVE_USER: 'qe' }), /set both/);
    const local = cfgFor('metrics', { serve: { host: '127.0.0.1' } });
    const page = await startServer(local, { QE_SERVE_USER: 'qe', QE_SERVE_PASSWORD: 'correct horse battery' }, { port: 0 });
    try {
      const get = (auth?: string) => new Promise<number>((res) => http.get(page.url, { headers: auth ? { Authorization: auth } : {} }, (x) => { x.resume(); res(x.statusCode!); }));
      assert.equal(await get(), 401);
      assert.equal(await get('Basic ' + Buffer.from('qe:wrong').toString('base64')), 401);
      assert.equal(await get('Basic ' + Buffer.from('qe:correct horse battery').toString('base64')), 200);
    } finally { await page.close(); }
  });
});

describe('diagnose', () => {
  test('the bundle has versions, sources, cursors, counts and which secrets are set: never a secret value, a record or a name', async () => {
    const cfg = cfgFor('evidence');
    await runSync(cfg, { env: ENV });
    const d = diagnostics(cfg, { ...ENV, HTTPS_PROXY: 'http://user:proxypass@proxy:3128' });
    const text = JSON.stringify(d);
    const set = Object.fromEntries((d.variables as any[]).map((x) => [x.variable, x.set]));
    assert.equal(set.GITHUB_TOKEN, true);
    assert.equal(set.QE_PEOPLE_SALT, false);
    assert.ok((d.localCopy as any).records.testRun >= 3);
    assert.equal((d.state as any).sources.github.errors, 0);
    for (const s of [...Object.values(ENV), 'proxypass', ...SENSITIVE.filter((x) => x !== 'checkout')]) assert.ok(!text.includes(s), `diagnostics must not contain "${s}"`);
    const broken = diagnostics(null, {}, 'sources[0].type must be one of …');
    assert.equal(broken.configError, 'sources[0].type must be one of …');
    mkdirSync(join(dir, 'x'), { recursive: true });
  });

  test('numeric inputs only leave in both modes', () => {
    assert.deepEqual(numericInputs({ linesHit: 3, format: 'lcov', sprint: 'Sprint 41 (alice@example.com)', example: { shards: 3 }, ratio: 0.123456789 }), { linesHit: 3, ratio: 0.1235 });
  });
});
