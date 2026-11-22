import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { runSync, runPreview, runCheck, EXIT } from '../src/run';
import { makeBatches, LIMITS, idempotencyKey, bodyOf } from '../src/sender';
import { configureLog } from '../src/log';
import { fixture, MockServer, config, shift, SHIFT_TO_NOW, tmpDir, allStrings, type Recorded } from './helpers';
import type { Config } from '../src/config';

configureLog({ sink: () => {} });
const here = dirname(fileURLToPath(import.meta.url));
const API_KEY = 'igk_test_0123456789abcdefghijklmnopqrstuvwxyzABCDEF';
const ENV = { QE_API_KEY: API_KEY, JIRA_TOKEN: 'jira-secret-token-1', JIRA_EMAIL: 'svc@example.com', PAGERDUTY_TOKEN: 'pd-secret-token-1' };

/** A QE Navigator stand-in: checks the request the way the API does and stores records by key / id. */
function mockQe(s: MockServer, opts: { refuse?: (rec: any) => string | null; status?: number } = {}) {
  const store = new Map<string, string>();
  for (const kind of ['issues', 'incidents'] as const) {
    s.on('POST', `/api/ingest/${kind}`, (r: Recorded) => {
      if (opts.status) return { status: opts.status, body: { error: 'Invalid or revoked API key' } };
      assert.equal(r.headers.authorization, `Bearer ${API_KEY}`);
      assert.equal(r.headers['content-encoding'], 'gzip');
      assert.match(String(r.headers['user-agent']), /^qe-collector\/0\.2\.0 /);
      const list: any[] = r.json[kind];
      if (r.query.get('dryRun') === 'true') return { status: 200, body: { status: 'dry-run', kind, teams: [...new Set(list.map((x) => x.team))], [kind]: list.length } };
      assert.equal(r.headers['idempotency-key'], idempotencyKey(kind, r.body));
      for (const x of list) {
        const why = opts.refuse?.(x);
        if (why) return { status: 400, body: { error: why, status: 'rejected' } };
      }
      const out = list.map((x) => {
        const id = x.key ?? x.id;
        const was = store.get(id);
        store.set(id, JSON.stringify(x));
        return { [kind === 'issues' ? 'key' : 'id']: id, team: x.team, status: was === JSON.stringify(x) ? 'duplicate' : was ? 'updated' : 'written' };
      });
      const any = out.some((o) => o.status !== 'duplicate');
      return { status: any ? 201 : 200, body: { status: any ? 'accepted' : 'duplicate', kind, format: 'json', [kind === 'issues' ? 'issues' : 'events']: out } };
    });
  }
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
const posts = (dry?: boolean) => qe.requests.filter((r) => r.method === 'POST' && (dry === undefined || (r.query.get('dryRun') === 'true') === dry));

beforeEach(async () => {
  vendors = await new MockServer().start();
  qe = await new MockServer().start();
  mockJira(vendors);
  mockPd(vendors);
  dir = tmpDir();
  cfg = config({
    qeNavigator: { url: qe.url, requestsPerMinute: 60 },
    privacy: { mode: 'full' },
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

describe('sync', () => {
  test('sends minimised records in batches, records the cursor; a re-run sends nothing', async () => {
    const store = mockQe(qe);
    assert.equal(await runSync(cfg, { env: ENV }), EXIT.OK);
    const sent = posts(false);
    assert.equal(sent.length, 2, 'one batch of issues, one of incidents');
    assert.deepEqual(sent.map((r) => r.path), ['/api/ingest/issues', '/api/ingest/incidents']);
    assert.equal(sent[0].query.get('format'), 'json');
    assert.deepEqual(sent[0].json.issues.map((i: any) => i.key), ['PAY-101', 'PAY-102', 'PAY-103', 'WEB-9']);
    assert.deepEqual(sent[1].json.incidents.map((i: any) => i.id), ['Q1INC0001', 'Q1INC0002']);
    assert.equal(store.size, 6);
    const s = allStrings(sent.map((r) => r.json)).join('\n');
    for (const bad of ['SECRET', '@', 'Alice', 'Dave', 'description', 'comment']) assert.ok(!s.includes(bad), bad);
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

  test('a changed record is sent again; --since reads from the date', async () => {
    mockQe(qe);
    await runSync(cfg, { env: ENV, source: 'jira' });
    const changed = fixture('jira-cloud-search-page2.json');
    changed.issues[0].fields.status = { name: 'Open', statusCategory: { key: 'new' } };
    changed.issues[0].fields.updated = '2026-11-21T12:00:00.000+0000';
    vendors.on('GET', '/rest/api/3/search/jql', (r) => ({ body: r.query.get('nextPageToken') === 'CAEaAggD' ? changed : fixture('jira-cloud-search-page1.json') }));
    assert.equal(await runSync(cfg, { env: ENV, source: 'jira', since: new Date('2026-01-01T00:00:00Z') }), EXIT.OK);
    const last = posts(false).at(-1)!;
    assert.deepEqual(last.json.issues.map((i: any) => i.key), ['WEB-9']);
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

  test('a 413 splits the batch', async () => {
    let first = true;
    mockQe(qe);
    qe.on('POST', '/api/ingest/issues', (r) => {
      if (first) { first = false; return { status: 413, body: { error: 'Body too large' } }; }
      return { status: 201, body: { status: 'accepted', issues: r.json.issues.map((i: any) => ({ key: i.key, status: 'written' })) } };
    });
    assert.equal(await runSync(cfg, { env: ENV, source: 'jira' }), EXIT.OK);
    assert.deepEqual(posts(false).map((r) => r.json.issues.length), [4, 2, 2]);
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
    assert.deepEqual(posts(false).map((r) => r.path), ['/api/ingest/incidents']);
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
  test('preview prints exactly the bodies that sync sends, with the API dry run; nothing is stored', async () => {
    mockQe(qe);
    let out = '';
    assert.equal(await runPreview(cfg, { env: ENV, out: (t) => { out += t; } }), EXIT.OK);
    const report = JSON.parse(out);
    assert.equal(posts(false).length, 0, 'nothing sent');
    assert.equal(posts(true).length, 2, 'dry runs');
    assert.equal(existsSync(cfg.statePath), false, 'no state written');
    assert.deepEqual(report.sources.map((s: any) => [s.name, s.toSend, s.perTeam]), [['jira', 4, { 'team-pay': 3, 'team-web': 1 }], ['pagerduty', 2, { 'team-pay': 1, 'team-web': 1 }]]);
    assert.equal(report.requests[0].headers.Authorization, 'Bearer [redacted]');
    assert.ok(!out.includes(API_KEY) && !out.includes('jira-secret-token-1'));
    assert.equal(report.requests[0].dryRun.status, 200);
    await runSync(cfg, { env: ENV });
    const sent = posts(false);
    assert.deepEqual(sent[0].json, report.requests[0].body);
    assert.deepEqual(sent[1].json, report.requests[1].body);
    assert.equal(sent[0].headers['idempotency-key'], report.requests[0].headers['Idempotency-Key']);
  });

  test('preview --offline never contacts QE Navigator (air-gapped review)', async () => {
    let out = '';
    assert.equal(await runPreview(cfg, { env: { ...ENV, QE_API_KEY: '' }, offline: true, out: (t) => { out += t; } }), EXIT.OK);
    assert.equal(qe.requests.length, 0);
    assert.equal(JSON.parse(out).requests.length, 2);
  });

  test('check: reaches each source and QE Navigator (dry run with the team ids), prints no secret', async () => {
    mockQe(qe);
    vendors.on('POST', '/rest/api/3/search/approximate-count', () => ({ body: { count: 5 } }));
    let out = '';
    assert.equal(await runCheck(cfg, { env: ENV, out: (t) => { out += t + '\n'; } }), EXIT.OK);
    assert.match(out, /QE_API_KEY: set/);
    assert.match(out, /storyPoints: customfield_10016/);
    assert.match(out, /service payments-api: readable → team-pay/);
    assert.match(out, /key valid, 2 team id\(s\) accepted/);
    assert.match(out, /All checks passed/);
    for (const v of Object.values(ENV)) assert.ok(!out.includes(v), 'no secret printed');
    const dry = posts(true);
    assert.equal(dry.length, 1);
    assert.deepEqual(dry[0].json.issues.map((i: any) => i.team).sort(), ['team-pay', 'team-web']);
    assert.equal(posts(false).length, 0);
  });
});

describe('batching', () => {
  test('within the record and size limits; idempotency key from the body', () => {
    const items = Array.from({ length: 2101 }, (_, i) => ({ id: `K-${i}`, fp: '', record: { key: `K-${i}`, team: 't', createdAt: '2026-11-01T00:00:00.000Z' } }));
    assert.deepEqual(makeBatches('issues', items).map((b) => b.items.length), [1000, 1000, 101]);
    assert.deepEqual(makeBatches('incidents', items.slice(0, 1200)).map((b) => b.items.length), [500, 500, 200]);
    const big = Array.from({ length: 30 }, (_, i) => ({ id: `B-${i}`, fp: '', record: { key: `B-${i}`, title: 'x'.repeat(400_000) } }));
    for (const b of makeBatches('incidents', big)) assert.ok(Buffer.byteLength(b.json) <= LIMITS.incidents.bytes);
    const b = makeBatches('issues', items.slice(0, 2))[0];
    assert.equal(b.json, bodyOf('issues', items.slice(0, 2)));
    assert.match(b.idempotencyKey, /^qe-collector:issues:[0-9a-f]{48}$/);
    assert.equal(b.idempotencyKey, makeBatches('issues', items.slice(0, 2))[0].idempotencyKey);
  });
});

describe('the bundle', () => {
  const bundle = join(here, '..', 'dist', 'qe-collector.mjs');
  test('dist/qe-collector.mjs runs preview --offline as a plain node process and exits 0', { skip: !existsSync(bundle) && 'run npm run build first' }, async () => {
    const cfgFile = join(dir, 'agent.yaml');
    writeFileSync(cfgFile, `qeNavigator:\n  url: ${qe.url}\nprivacy:\n  mode: full\nstate:\n  path: ${join(dir, 'state.json')}\nsources:\n  - type: jira\n    baseUrl: ${vendors.url}\n    deployment: cloud\n    jql: project = PAY\n    teams: { PAY: team-pay, WEB: team-web }\n`);
    const r = await new Promise<{ code: number | null; stdout: string; stderr: string }>((res) => {
      execFile(process.execPath, [bundle, 'preview', '--offline', '-c', cfgFile, '--log-format', 'json'], { env: { PATH: process.env.PATH, JIRA_TOKEN: 'jira-secret-token-1', JIRA_EMAIL: 'svc@example.com' } }, (err, stdout, stderr) => res({ code: err ? (err as any).code : 0, stdout, stderr }));
    });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).requests[0].body.issues.length, 4);
    assert.ok(!r.stderr.includes('jira-secret-token-1'));
    for (const line of r.stderr.trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line), 'structured logs');
  });
});
