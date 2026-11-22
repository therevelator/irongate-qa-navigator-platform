import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { runSync, runPreview, runCheck, EXIT } from '../src/run';
import { makeBatches, LIMITS, keyOf } from '../src/sender';
import { configureLog } from '../src/log';
import { fixture, MockServer, config, shift, SHIFT_TO_NOW, tmpDir, allStrings, type Recorded } from './helpers';
import type { Config } from '../src/config';

configureLog({ sink: () => {} });
const here = dirname(fileURLToPath(import.meta.url));
const API_KEY = 'igk_test_0123456789abcdefghijklmnopqrstuvwxyzABCDEF';
const ENV = { QE_API_KEY: API_KEY, JIRA_TOKEN: 'jira-secret-token-1', JIRA_EMAIL: 'svc@example.com', PAGERDUTY_TOKEN: 'pd-secret-token-1' };

const COMPANY = 'comp-1';
const DEPTS: Record<string, string> = { 'team-pay': 'dep-eng', 'team-web': 'dep-web' };

/**
 * A QE Navigator stand-in for POST /api/ingest/exporter/batch: checks the request the way the API does (key, gzip,
 * User-Agent, the three ids against the key's company, departments and teams, the Idempotency-Key) and stores the
 * items by key / id.
 */
function mockQe(s: MockServer, opts: { refuse?: (item: any) => string | null; status?: number } = {}) {
  const store = new Map<string, string>();
  s.on('POST', '/api/ingest/exporter/batch', (r: Recorded) => {
    if (opts.status) return { status: opts.status, body: { error: 'Invalid or revoked API key' } };
    assert.equal(r.headers.authorization, `Bearer ${API_KEY}`);
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.match(String(r.headers['user-agent']), /^qe-exporter\/0\.3\.0 /);
    assert.ok(r.headers['x-exporter-host']);
    const e = r.json;
    assert.deepEqual(Object.keys(e).sort(), ['companyId', 'departmentId', 'items', 'kind', 'source', 'teamId']);
    if (e.companyId !== COMPANY) return { status: 403, body: { error: 'companyId does not match this API key' } };
    if (DEPTS[e.teamId] !== e.departmentId) return { status: 403, body: { error: 'teamId is not an active team of this department' } };
    if (r.query.get('dryRun') === 'true') return { status: 200, body: { status: 'dry-run', teamId: e.teamId } };
    assert.equal(r.headers['idempotency-key'], keyOf(r.body));
    for (const x of e.items) {
      assert.equal(x.team, undefined, 'the team is the envelope\'s');
      const why = opts.refuse?.(x);
      if (why) return { status: 400, body: { error: `items: ${why}`, status: 'rejected' } };
    }
    let written = 0;
    for (const x of e.items) {
      const id = `${e.teamId}|${x.key ?? x.id}`;
      if (store.get(id) !== JSON.stringify(x)) written++;
      store.set(id, JSON.stringify(x));
    }
    return { status: written ? 201 : 200, body: { status: written ? 'accepted' : 'duplicate', ...e, items: undefined, written: written ? 1 : 0, duplicate: written ? 0 : 1, rejected: 0 } };
  });
  s.on('POST', '/api/ingest/exporter/heartbeat', () => ({ body: { status: 'ok' } }));
  s.on('GET', '/api/ingest/exporter/context', () => ({ body: { company: { id: COMPANY, name: 'Acme' }, departments: [{ id: 'dep-eng', name: 'Engineering', teams: [{ id: 'team-pay', name: 'Payments' }] }, { id: 'dep-web', name: 'Web', teams: [{ id: 'team-web', name: 'Web' }] }] } }));
  return store;
}

function mockJira(s: MockServer) {
  s.on('GET', '/rest/api/3/myself', () => ({ body: fixture('jira-myself.json') }))
    .on('GET', '/rest/api/3/field', () => ({ body: fixture('jira-fields.json') }))
    .on('GET', '/rest/api/3/status', () => ({ body: fixture('jira-status.json') }))
    .on('GET', '/rest/api/3/search/jql', (r) => ({ body: r.query.get('nextPageToken') === 'CAEaAggD' ? fixture('jira-cloud-search-page2.json') : fixture('jira-cloud-search-page1.json') }))
    .on('GET', '/rest/api/3/issue/PAY-101/changelog', () => ({ body: fixture('jira-cloud-changelog-PAY-101.json') }));
}

function mockPd(s: MockServer) {
  s.on('GET', '/log_entries', (r) => {
    const since = Date.parse(r.query.get('since')!);
    const until = Date.parse(r.query.get('until')!);
    const out = shift(fixture('pagerduty-log-entries.json'), SHIFT_TO_NOW);
    out.log_entries = out.log_entries.filter((e: any) => Date.parse(e.created_at) >= since && Date.parse(e.created_at) < until);
    return { body: out };
  }).on('GET', '/services', () => ({ body: fixture('pagerduty-services.json') }));
}

let vendors: MockServer;
let qe: MockServer;
let dir: string;
let cfg: Config;
const stateFile = () => JSON.parse(readFileSync(cfg.statePath, 'utf8'));

beforeEach(async () => {
  vendors = await new MockServer().start();
  qe = await new MockServer().start();
  mockJira(vendors);
  mockPd(vendors);
  dir = tmpDir();
  cfg = config({
    qeNavigator: { url: qe.url, requestsPerMinute: 60, companyId: COMPANY },
    teams: DEPTS,
    heartbeat: false,
    state: { path: join(dir, 'state.json') },
    http: { maxRetries: 1, maxRetryWaitSeconds: 1 },
    sources: [
      { type: 'jira', name: 'jira', baseUrl: vendors.url, deployment: 'cloud', jql: 'project in (PAY, WEB)', teams: { PAY: 'team-pay', WEB: 'team-web' } },
      { type: 'pagerduty', name: 'pagerduty', apiUrl: vendors.url, services: { 'payments-api': 'team-pay', checkout: 'team-web' } },
    ],
  });
  // No client-side spacing of the QE requests in tests (the config allows at most 60 per minute).
  cfg.qeNavigator.requestsPerMinute = 600_000;
});
afterEach(async () => { await vendors.stop(); await qe.stop(); });

const posts = (dry?: boolean) => qe.requests.filter((r) => r.method === 'POST' && r.path === '/api/ingest/exporter/batch' && (dry === undefined || (r.query.get('dryRun') === 'true') === dry));

describe('sync', () => {
  test('sends the minimised records as envelopes with the three ids, records the cursor; a re-run sends nothing', async () => {
    const store = mockQe(qe);
    assert.equal(await runSync(cfg, { env: ENV }), EXIT.OK);
    const sent = posts(false);
    assert.deepEqual(sent.map((r) => [r.json.kind, r.json.teamId, r.json.departmentId, r.json.companyId, r.json.source]), [
      ['issues', 'team-pay', 'dep-eng', COMPANY, 'jira'], ['issues', 'team-web', 'dep-web', COMPANY, 'jira'],
      ['incidents', 'team-pay', 'dep-eng', COMPANY, 'pagerduty'], ['incidents', 'team-web', 'dep-web', COMPANY, 'pagerduty'],
    ], 'one envelope per team and kind, every one with companyId, departmentId and teamId from the mapping');
    assert.deepEqual(sent.slice(0, 2).flatMap((r) => r.json.items.map((i: any) => i.key)), ['PAY-101', 'PAY-102', 'PAY-103', 'WEB-9']);
    assert.deepEqual(sent.slice(2).flatMap((r) => r.json.items.map((i: any) => i.id)), ['Q1INC0001', 'Q1INC0002']);
    assert.equal(store.size, 6);
    const text = allStrings(sent.map((r) => r.json)).join('\n');
    for (const bad of ['SECRET', '@', 'Alice', 'Dave', 'description', 'comment']) assert.ok(!text.includes(bad), bad);
    const st = stateFile();
    assert.equal(st.sources.jira.cursor, '2026-11-21T10:01:00.000Z', 'the newest Jira change time');
    assert.equal(Object.keys(st.sources.jira.sent).length, 4);
    assert.equal(Object.keys(st.sources.pagerduty.sent).length, 2);
    assert.ok(!readFileSync(cfg.statePath, 'utf8').includes('jira-secret'), 'no secret in the state');

    // Second run: the sources are read again (overlap), nothing new is sent.
    const before = qe.requests.length;
    assert.equal(await runSync(cfg, { env: ENV }), EXIT.OK);
    assert.equal(qe.requests.length, before, 'idempotent re-run: no request to QE Navigator');
    const jql = vendors.requests.filter((r) => r.path === '/rest/api/3/search/jql').at(-1)!.query.get('jql')!;
    assert.match(jql, /updated >= "2026\/11\/21 09:51"/, 'cursor minus the 10-minute overlap, Europe/Dublin');
  });

  test('nothing is sent while the company or a team\'s department is missing: exit 2', async () => {
    mockQe(qe);
    const noCompany = { ...cfg, qeNavigator: { ...cfg.qeNavigator, companyId: null } };
    assert.equal(await runSync(noCompany, { env: ENV }), EXIT.CONFIG);
    const noDept = { ...cfg, teams: { 'team-pay': 'dep-eng' } };
    assert.equal(await runSync(noDept, { env: ENV }), EXIT.CONFIG);
    assert.equal(posts().length, 0);
    assert.equal(vendors.requests.length, 0, 'not even a source is read');
  });

  test('QE Navigator refuses the ids (403): exit 4, delivery stops, nothing recorded as sent', async () => {
    mockQe(qe);
    const wrong = { ...cfg, teams: { 'team-pay': 'dep-web', 'team-web': 'dep-web' } };
    assert.equal(await runSync(wrong, { env: ENV, source: 'jira' }), EXIT.QE);
    assert.deepEqual(stateFile().sources.jira.sent, {});
    assert.equal(stateFile().sources.jira.cursor, null);
  });

  test('a changed record is sent again; --since reads from the date', async () => {
    mockQe(qe);
    await runSync(cfg, { env: ENV, source: 'jira' });
    const changed = fixture('jira-cloud-search-page2.json');
    changed.issues[0].fields.status = { name: 'Open', statusCategory: { key: 'new' } };
    changed.issues[0].fields.updated = '2026-11-21T12:00:00.000+0000';
    vendors.on('GET', '/rest/api/3/search/jql', (r) => ({ body: r.query.get('nextPageToken') === 'CAEaAggD' ? changed : fixture('jira-cloud-search-page1.json') }));
    assert.equal(await runSync(cfg, { env: ENV, source: 'jira', since: new Date('2026-01-01T00:00:00Z') }), EXIT.OK);
    const last = posts(false).at(-1)!;
    assert.deepEqual([last.json.teamId, last.json.items.map((i: any) => i.key)], ['team-web', ['WEB-9']]);
    assert.match(vendors.requests.filter((r) => r.path === '/rest/api/3/search/jql').at(-1)!.query.get('jql')!, /updated >= "2026\/01\/01 00:00"/);
    assert.equal(stateFile().sources.jira.cursor, '2026-11-21T12:00:00.000Z');
  });

  test('a record QE Navigator refuses is isolated; the others are delivered; exit 6; not retried until it changes', async () => {
    mockQe(qe, { refuse: (x) => (x.key === 'PAY-102' ? 'PAY-102: a time is in the future' : null) });
    assert.equal(await runSync(cfg, { env: ENV, source: 'jira' }), EXIT.PARTIAL);
    const st = stateFile().sources.jira;
    assert.deepEqual(Object.keys(st.sent).sort(), ['PAY-101', 'PAY-103', 'WEB-9']);
    assert.deepEqual(Object.keys(st.rejected), ['PAY-102']);
    assert.ok(st.cursor, 'the cursor moves on');
    const n = posts(false).length;
    assert.equal(await runSync(cfg, { env: ENV, source: 'jira' }), EXIT.OK);
    assert.equal(posts(false).length, n);
  });

  test('a 413 splits the envelope', async () => {
    let first = true;
    mockQe(qe);
    qe.on('POST', '/api/ingest/exporter/batch', () => {
      if (first) { first = false; return { status: 413, body: { error: 'Body too large' } }; }
      return { status: 201, body: { status: 'accepted', written: 1 } };
    });
    assert.equal(await runSync(cfg, { env: ENV, source: 'jira' }), EXIT.OK);
    assert.deepEqual(posts(false).map((r) => [r.json.teamId, r.json.items.length]), [['team-pay', 3], ['team-pay', 2], ['team-pay', 1], ['team-web', 1]]);
  });

  test('QE Navigator refuses the key: exit 4, nothing recorded as sent, the cursor stays', async () => {
    mockQe(qe, { status: 401 });
    assert.equal(await runSync(cfg, { env: ENV }), EXIT.QE);
    const st = stateFile();
    assert.equal(st.sources.jira?.cursor ?? null, null);
    assert.deepEqual(st.sources.jira?.sent ?? {}, {});
    assert.equal(posts(false).length, 1, 'stops at the first refusal');
  });

  test('a source that fails: exit 3, the other source is still delivered', async () => {
    mockQe(qe);
    vendors.on('GET', '/rest/api/3/search/jql', () => ({ status: 500, body: { errorMessages: ['boom'] } }));
    assert.equal(await runSync(cfg, { env: ENV }), EXIT.SOURCE);
    assert.deepEqual(posts(false).map((r) => r.json.kind), ['incidents', 'incidents']);
    assert.equal(stateFile().sources.jira?.cursor ?? null, null);
  });

  test('another run holds the lock: exit 5', async () => {
    mockQe(qe);
    writeFileSync(cfg.statePath + '.lock', JSON.stringify({ pid: process.ppid, at: new Date().toISOString() }));
    assert.equal(await runSync(cfg, { env: ENV }), EXIT.LOCKED);
    assert.equal(qe.requests.length, 0);
  });

  test('missing secrets: exit 2 before anything is read', async () => {
    assert.equal(await runSync(cfg, { env: { ...ENV, QE_API_KEY: '' } }), EXIT.CONFIG);
    assert.equal(vendors.requests.length, 0);
  });
});

describe('preview and check', () => {
  test('preview prints exactly the envelopes that sync sends, with the three ids; it sends nothing and stores nothing', async () => {
    mockQe(qe);
    let out = '';
    assert.equal(await runPreview(cfg, { env: ENV, out: (t) => { out += t; } }), EXIT.OK);
    const report = JSON.parse(out);
    assert.equal(qe.requests.length, 0, 'no request to QE Navigator at all');
    assert.equal(existsSync(cfg.statePath), false, 'no state written');
    assert.deepEqual(report.sources.map((x: any) => [x.name, x.toSend]), [
      ['jira', [{ team: 'team-pay', kind: 'issues', items: 3 }, { team: 'team-web', kind: 'issues', items: 1 }]],
      ['pagerduty', [{ team: 'team-pay', kind: 'incidents', items: 1 }, { team: 'team-web', kind: 'incidents', items: 1 }]],
    ]);
    assert.equal(report.requests[0].url, `${qe.url}/api/ingest/exporter/batch`);
    assert.equal(report.requests[0].headers.Authorization, 'Bearer [redacted]');
    for (const r of report.requests) assert.deepEqual([r.body.companyId, r.body.departmentId], [COMPANY, DEPTS[r.body.teamId]]);
    assert.ok(!out.includes(API_KEY) && !out.includes('jira-secret-token-1') && !out.includes('pd-secret-token-1'));
    await runSync(cfg, { env: ENV });
    const sent = posts(false);
    assert.deepEqual(sent.map((r) => r.json), report.requests.map((r: any) => r.body));
    assert.deepEqual(sent.map((r) => r.headers['idempotency-key']), report.requests.map((r: any) => r.headers['Idempotency-Key']));
  });

  test('preview without a key and without any network to QE Navigator still works (air-gapped review)', async () => {
    let out = '';
    assert.equal(await runPreview(cfg, { env: { ...ENV, QE_API_KEY: '' }, out: (t) => { out += t; } }), EXIT.OK);
    assert.equal(qe.requests.length, 0);
    assert.equal(JSON.parse(out).requests.length, 4);
  });

  test('check: reaches each source and QE Navigator (context, then a dry run per team with the three ids), prints no secret', async () => {
    mockQe(qe);
    vendors.on('POST', '/rest/api/3/search/approximate-count', () => ({ body: { count: 5 } }));
    let out = '';
    assert.equal(await runCheck(cfg, { env: ENV, out: (t) => { out += t + '\n'; } }), EXIT.OK);
    assert.match(out, /QE_API_KEY: set/);
    assert.match(out, /storyPoints: customfield_10016/);
    assert.match(out, /service payments-api: readable → team-pay/);
    assert.match(out, /key valid for Acme \(company id comp-1\)/);
    assert.match(out, /ok: team-pay \(Payments\) in Engineering/);
    assert.match(out, /All checks passed/);
    for (const v of Object.values(ENV)) assert.ok(!out.includes(v), 'no secret printed');
    const dry = posts(true);
    assert.deepEqual(dry.map((r) => [r.json.teamId, r.json.departmentId]).sort(), [['team-pay', 'dep-eng'], ['team-web', 'dep-web']]);
    assert.equal(posts(false).length, 0);
  });

  test('check names the department to add for a mapped team, and a wrong one', async () => {
    mockQe(qe);
    vendors.on('POST', '/rest/api/3/search/approximate-count', () => ({ body: { count: 5 } }));
    let out = '';
    const c2 = { ...cfg, teams: { 'team-pay': 'dep-web' } };
    assert.equal(await runCheck(c2, { env: ENV, out: (t) => { out += t + '\n'; } }), EXIT.CONFIG);
    assert.match(out, /team team-pay is in department dep-eng \(Engineering\), not dep-web/);
    assert.match(out, /add to "teams": team-web: dep-web/);
    assert.equal(posts().length, 0);
  });
});

describe('batching', () => {
  test('within the item and size limits; the Idempotency-Key from the body; every envelope with the three ids', () => {
    const base = { companyId: COMPANY, departmentId: 'dep-eng', teamId: 'team-pay', source: 'jira' };
    const parts = Array.from({ length: 2101 }, (_, i) => ({ id: `K-${i}`, fp: '', item: { key: `K-${i}`, createdAt: '2026-11-01T00:00:00.000Z' } }));
    assert.deepEqual(makeBatches({ ...base, kind: 'issues' }, parts).map((b) => b.parts.length), [1000, 1000, 101]);
    assert.deepEqual(makeBatches({ ...base, kind: 'incidents' }, parts.slice(0, 1200)).map((b) => b.parts.length), [500, 500, 200]);
    const big = Array.from({ length: 30 }, (_, i) => ({ id: `B-${i}`, fp: '', item: { id: `B-${i}`, x: 'x'.repeat(400_000) } }));
    for (const b of makeBatches({ ...base, kind: 'incidents' }, big)) assert.ok(Buffer.byteLength(b.json) <= LIMITS.incidents.bytes + 1000);
    const b = makeBatches({ ...base, kind: 'issues' }, parts.slice(0, 2))[0];
    assert.deepEqual(JSON.parse(b.json), { ...base, kind: 'issues', items: parts.slice(0, 2).map((p) => p.item) });
    assert.match(b.idempotencyKey, /^qe-exporter:[0-9a-f]{48}$/);
    assert.equal(b.idempotencyKey, keyOf(b.json));
  });
});

describe('the bundle', () => {
  const bundle = join(here, '..', 'dist', 'qe-exporter.mjs');
  test('dist/qe-exporter.mjs runs preview as a plain node process and exits 0', { skip: !existsSync(bundle) && 'run npm run build first' }, async () => {
    const cfgFile = join(dir, 'agent.yaml');
    writeFileSync(cfgFile, `qeNavigator:\n  url: ${qe.url}\n  companyId: ${COMPANY}\nteams:\n  team-pay: dep-eng\n  team-web: dep-web\nprivacy:\n  mode: full\nstate:\n  path: ${join(dir, 'state.json')}\nsources:\n  - type: jira\n    baseUrl: ${vendors.url}\n    deployment: cloud\n    jql: project = PAY\n    teams: { PAY: team-pay, WEB: team-web }\n`);
    const r = await new Promise<{ code: number | null; stdout: string; stderr: string }>((res) => {
      execFile(process.execPath, [bundle, 'preview', '-c', cfgFile, '--log-format', 'json'], { env: { PATH: process.env.PATH, JIRA_TOKEN: 'jira-secret-token-1', JIRA_EMAIL: 'svc@example.com' } }, (err, stdout, stderr) => res({ code: err ? (err as any).code : 0, stdout, stderr }));
    });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).requests[0].body.items.length, 3);
    assert.match(r.stderr, /privacy.mode no longer appl/, 'a setting of an earlier release is ignored with a warning');
    assert.ok(!r.stderr.includes('jira-secret-token-1'));
    for (const line of r.stderr.trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line), 'structured logs');
  });
});
