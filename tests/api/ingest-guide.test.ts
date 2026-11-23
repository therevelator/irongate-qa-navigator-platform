import fs from 'fs';
import path from 'path';
import { gunzipSync, gzipSync } from 'zlib';
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * Ingestion as docs/INTEGRATION_GUIDE.md describes it (the points where the code did something else), against a live
 * backend and the local database, with the golden fixture company:
 *
 *   GUIDE-001  privacy: raw_uploads.payload keeps a minimised copy of every kind, never the body as received: no commit
 *              author names, e-mail addresses or messages (commits, deployments with commits, GitHub and GitLab push
 *              webhooks), no test failure messages or properties (host and user names), no SARIF messages, no
 *              home-directory user names in paths, no extra pipeline fields; commit authors as the salted hash
 *   GUIDE-002  API key scope: a plain ingest key (the default) gets 403 on GET /ingest/exporter/context; an Exporter key
 *              reads it; the scope is chosen when the key is created, listed, and an unknown scope is refused
 *   GUIDE-003  /api/api/ingest/… (IRONGATE_URL ends in /api, the examples add /api/ingest) answers on the Node server
 *              and on the Netlify function; /health and /api/health answer JSON on both; netlify.toml sends /health
 *              to the function before the app's fallback
 *   GUIDE-004  idempotency keys with "/" (Jenkins JOB_NAME of multibranch jobs): header and per item, /kpis and raw
 *   GUIDE-005  {"commits": []}: 200, a no-op (nothing stored)
 *   GUIDE-006  Azure DevOps: pipelines result SucceededWithIssues (a success); several gzipped TRX files in one body
 *   GUIDE-007  Jenkins NOT_BUILT on /ingest/pipelines: accepted, not counted (stored as cancelled)
 *   GUIDE-008  /kpis validation lists every problem of an item (not only the first)
 *   GUIDE-009  coverage startedAt defaults to the report's own timestamp (Cobertura, JaCoCo), else the time received
 *   GUIDE-010  an incident status update (status triggered + at) for a new id creates it, opened at "at"
 *   GUIDE-011  contextSwitchesPerDay is rounded (3.6 → 4)
 *   GUIDE-012  RAW_PAYLOAD_DAYS: payloads cleared after N days (at most 396), the row kept 396 days
 *   GUIDE-013  the Exporter's refusal of a list kind names the item: items[n]
 *   GUIDE-014  the raw cleanup runs twice a day on Node, as on Netlify
 *
 * Skips when no backend runs.
 */
const F = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ingest', name));
const TEAM = 'golden-team-empty';
const DEPT = 'golden-dept-b';

let up = true;
let db: Client;
let cookie = '';
let apiKey = '';
let apiKeyId = '';
let exporterKey = '';
const started = new Date();

const iso = (daysAgo: number, time = '10:00:00') => `${new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)}T${time}Z`;
const send = (method: 'post' | 'get', url: string, key = apiKey) => request(API_URL)[method](url).set('Authorization', `Bearer ${key}`);
const json = (url: string, body: unknown, headers: Record<string, string> = {}, key = apiKey) => {
  let r = send('post', url, key).set('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(JSON.stringify(body));
};
const rawBody = (url: string, body: Buffer | string, headers: Record<string, string> = {}) => {
  let r = send('post', url).set('Content-Type', headers['Content-Type'] ?? 'application/octet-stream');
  for (const [k, v] of Object.entries(headers)) if (k !== 'Content-Type') r = r.set(k, v);
  return r.send(body);
};
async function exporterBatch(body: unknown) {
  const r = await fetch(`${API_URL}/api/ingest/exporter/batch`, {
    method: 'POST', headers: { Authorization: `Bearer ${exporterKey}`, 'Content-Type': 'application/json', 'User-Agent': 'qe-exporter/0.3.0 (test)' }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as any };
}
/** The decoded payloads this test's key stored since the start, per kind. */
async function payloads(since = started): Promise<Array<{ kind: string; text: string }>> {
  const rows = (await db.query(`SELECT kind, payload FROM raw_uploads WHERE api_key_id = $1 AND received_at >= $2 AND payload IS NOT NULL ORDER BY received_at`, [apiKeyId, since])).rows;
  return rows.map((r: any) => ({ kind: r.kind, text: gunzipSync(r.payload).toString('utf8') }));
}

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running at', API_URL, '- integration guide tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  const k = await post('/api/admin/api-keys', cookie, { name: 'Integration guide test key' });
  apiKey = k.body.plaintextKey;
  apiKeyId = k.body.key.id;
  exporterKey = (await post('/api/admin/api-keys', cookie, { name: 'Integration guide Exporter key', scope: 'exporter' })).body.plaintextKey;
});

afterAll(async () => {
  if (db) { await removeGolden(db); await db.end(); }
  const { pool } = await import('../../src/lib/db');
  await pool.end().catch(() => undefined);
});

const SECRETS = ['dev.one@acme.example', 'Dev One', 'pusher@acme.example', 'Pusher Person', 'SECRET-COMMIT-MESSAGE', 'build-host-jdoe', 'jdoe', 'SECRET-FAILURE-TEXT', 'SECRET-SARIF-MESSAGE', 'Jane Trigger'];

describe('Privacy of the raw copy', () => {
  it('GUIDE-001 every kind keeps a minimised copy: no names, e-mail addresses, messages or user names', async () => {
    if (!up) return;
    const since = new Date();
    // Commits (git log JSON), with the author's e-mail and the message.
    const commits = await json(`/api/ingest/commits?team=${TEAM}`, {
      deployment: 'g1-dep', commits: [{ sha: 'aaaa0001', authoredAt: iso(2), author: 'dev.one@acme.example', authorName: 'Dev One', message: 'SECRET-COMMIT-MESSAGE' }],
    });
    expect(commits.status).toBe(201);
    // A deployment that lists its commits.
    const dep = await json(`/api/ingest/deployments?team=${TEAM}`, {
      id: 'g1-dep', environment: 'production', finishedAt: iso(1), result: 'success', triggeredBy: 'Jane Trigger',
      commits: [{ sha: 'aaaa0002', authoredAt: iso(2), author: { name: 'Dev One', email: 'dev.one@acme.example' }, message: 'SECRET-COMMIT-MESSAGE' }],
    });
    expect(dep.status).toBe(201);
    // GitHub and GitLab push webhooks.
    const gh = await json(`/api/ingest/commits?team=${TEAM}`, {
      ref: 'refs/heads/main', before: '0000', after: 'aaaa0003', pusher: { name: 'Pusher Person', email: 'pusher@acme.example' }, sender: { login: 'jdoe' }, repository: { name: 'payments-api' },
      head_commit: { id: 'aaaa0003', message: 'SECRET-COMMIT-MESSAGE' },
      commits: [{ id: 'aaaa0003', timestamp: iso(1), message: 'SECRET-COMMIT-MESSAGE', author: { name: 'Dev One', email: 'dev.one@acme.example', username: 'jdoe' }, committer: { name: 'Dev One', email: 'dev.one@acme.example' } }],
    });
    expect(gh.status).toBe(201);
    expect(gh.body.format).toBe('github');
    const gl = await json(`/api/ingest/commits?team=${TEAM}`, {
      object_kind: 'push', ref: 'refs/heads/main', user_name: 'Pusher Person', user_email: 'pusher@acme.example', user_username: 'jdoe', project: { name: 'payments-api' },
      commits: [{ id: 'aaaa0004', timestamp: iso(1), message: 'SECRET-COMMIT-MESSAGE', author: { name: 'Dev One', email: 'dev.one@acme.example' } }],
    });
    expect(gl.status).toBe(201);
    expect(gl.body.format).toBe('gitlab');
    // JUnit with properties (host and user names) and a failure message.
    const xml = `<?xml version="1.0"?><testsuites><testsuite name="s" hostname="build-host-jdoe" timestamp="${iso(1).slice(0, 19)}"><properties><property name="user.name" value="jdoe"/><property name="host" value="build-host-jdoe"/></properties>`
      + `<testcase classname="a" name="t1" time="0.1"/><testcase classname="a" name="t2" time="0.2"><failure message="SECRET-FAILURE-TEXT at /home/jdoe/x">SECRET-FAILURE-TEXT</failure><system-out>jdoe on build-host-jdoe</system-out></testcase></testsuite></testsuites>`;
    expect((await rawBody(`/api/ingest/tests?team=${TEAM}&commit=g1&run=g1-tests`, xml)).status).toBe(201);
    // Coverage with absolute paths under a home directory.
    expect((await rawBody(`/api/ingest/coverage?team=${TEAM}&commit=g1&run=g1-cov&startedAt=${iso(1)}`, 'TN:\nSF:/home/jdoe/work/src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\n')).status).toBe(201);
    // SARIF with result messages and a file URI under a home directory.
    const sarif = {
      version: '2.1.0', runs: [{
        tool: { driver: { name: 'CodeQL', rules: [{ id: 'js/x', name: 'X' }] } },
        results: [{ ruleId: 'js/x', level: 'warning', message: { text: 'SECRET-SARIF-MESSAGE by jdoe' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///home/jdoe/repo/src/a.ts' }, region: { startLine: 3 } } }] }],
      }],
    };
    expect((await json(`/api/ingest/static-analysis?team=${TEAM}&commit=g1&startedAt=${iso(1)}`, sarif)).status).toBe(201);
    // A pipeline run with fields the parser does not read.
    expect((await json(`/api/ingest/pipelines?team=${TEAM}`, { id: 'g1-run', startedAt: iso(1), finishedAt: iso(1, '10:05:00'), result: 'success', triggeredBy: 'Jane Trigger', actor: { login: 'jdoe' } })).status).toBe(201);

    const kept = await payloads(since);
    const kinds = new Set(kept.map((p) => p.kind));
    for (const k of ['commits', 'deployments', 'tests', 'coverage', 'static-analysis', 'pipelines']) expect(kinds).toContain(k);
    for (const p of kept) {
      expect(p.text.startsWith('{"minimised":true')).toBe(true);
      for (const s of SECRETS) expect({ kind: p.kind, has: p.text.includes(s) ? s : null }).toEqual({ kind: p.kind, has: null });
    }
    // Authors stay, as the salted hash only (the same as deployment_commits.author_hash).
    const stored = (await db.query(`SELECT author_hash FROM deployment_commits WHERE team_id = $1 AND sha = 'aaaa0001'`, [TEAM])).rows[0].author_hash;
    expect(stored).toMatch(/^[0-9a-f]{32}$/);
    expect(kept.find((p) => p.kind === 'commits')!.text).toContain(`"authorHash":"${stored}"`);
    expect(kept.find((p) => p.kind === 'coverage')!.text).toContain('"path":"~/work/src/a.ts"');
  });
});

describe('API key scope', () => {
  it('GUIDE-002 an ingest key cannot read the context (403); an Exporter key can; the scope is set at creation', async () => {
    if (!up) return;
    const plain = await send('get', '/api/ingest/exporter/context');
    expect(plain.status).toBe(403);
    expect(plain.body.code).toBe('exporter_scope_required');
    expect(JSON.stringify(plain.body)).not.toMatch(/golden-dept|Golden Fixture/);
    const exp = await send('get', '/api/ingest/exporter/context', exporterKey);
    expect(exp.status).toBe(200);
    expect(exp.body.company.id).toBe(GOLDEN_COMPANY);
    // The ingest key still writes.
    expect((await json(`/api/ingest/kpis`, { teamId: TEAM, source: 'guide', metrics: { test_coverage: 70 } })).status).toBe(200);
    expect((await post('/api/admin/api-keys', cookie, { name: 'bad scope', scope: 'admin' })).status).toBe(400);
    const list = (await get('/api/admin/api-keys', cookie)).body.keys;
    expect(list.find((k: any) => k.name === 'Integration guide test key').scope).toBe('ingest');
    expect(list.find((k: any) => k.name === 'Integration guide Exporter key').scope).toBe('exporter');
  });
});

describe('URLs', () => {
  it('GUIDE-003 /api/api/ingest/… and /health answer on Node and on the Netlify function', async () => {
    if (!up) return;
    const xml = `<?xml version="1.0"?><testsuites><testsuite name="s"><testcase classname="a" name="t1" time="0.1"/></testsuite></testsuites>`;
    const doubled = await rawBody(`/api/api/ingest/tests?team=${TEAM}&commit=g3&run=g3&startedAt=${iso(1)}`, xml);
    expect(doubled.status).toBe(201);
    for (const p of ['/health', '/api/health']) {
      const h = await request(API_URL).get(p);
      expect(h.status).toBe(200);
      expect(h.body.status).toBe('ok');
    }
    process.env.NETLIFY = process.env.NETLIFY || 'true';
    const { handler } = await import('../../netlify/functions/api');
    const event = (method: string, p: string, headers: Record<string, string>, body: string | null) => ({
      httpMethod: method, path: p, rawUrl: `https://example.test${p}`, rawQuery: '', queryStringParameters: {}, multiValueQueryStringParameters: {},
      headers: { 'x-nf-client-connection-ip': '203.0.113.11', ...headers }, multiValueHeaders: {}, body, isBase64Encoded: false,
    });
    for (const p of ['/health', '/api/health']) {
      const h: any = await handler(event('GET', p, {}, null), {});
      expect(h.statusCode).toBe(200);
      expect(JSON.parse(h.body).status).toBe('ok');
    }
    const n: any = await handler(event('POST', `/api/api/ingest/kpis`, { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, JSON.stringify({ teamId: TEAM, source: 'guide', metrics: { test_coverage: 71 } })), {});
    expect(n.statusCode).toBe(200);
    // netlify.toml: /health goes to the function, before the app's fallback "/*".
    const toml = fs.readFileSync(path.join(__dirname, '..', '..', 'netlify.toml'), 'utf8');
    const health = toml.search(/from = "\/health"\s*\n\s*to = "\/\.netlify\/functions\/api\/health"/);
    expect(health).toBeGreaterThan(-1);
    expect(health).toBeLessThan(toml.indexOf('from = "/*"'));
  });
});

describe('Idempotency keys, empty commit lists, CI result names', () => {
  it('GUIDE-004 keys with "/" (Jenkins multibranch JOB_NAME) are accepted', async () => {
    if (!up) return;
    const h = await json('/api/ingest/kpis', { teamId: TEAM, source: 'jenkins', metrics: { test_coverage: 72 } }, { 'Idempotency-Key': 'jenkins:payments/main:42' });
    expect(h.status).toBe(200);
    const again = await json('/api/ingest/kpis', { teamId: TEAM, source: 'jenkins', metrics: { test_coverage: 72 } }, { 'Idempotency-Key': 'jenkins:payments/main:42' });
    expect(again.headers['idempotent-replayed']).toBe('true');
    const item = await json('/api/ingest/kpis', { teamId: TEAM, source: 'jenkins', metrics: { test_coverage: 73 }, idempotencyKey: 'jenkins:payments/main-43' });
    expect(item.status).toBe(200);
    const rawKey = await json(`/api/ingest/pipelines?team=${TEAM}`, { id: 'g4-run', startedAt: iso(1), result: 'success' }, { 'Idempotency-Key': 'jenkins:folder/payments/main:44' });
    expect(rawKey.status).toBe(201);
    expect((await json('/api/ingest/kpis', { teamId: TEAM, source: 'jenkins', metrics: { test_coverage: 72 } }, { 'Idempotency-Key': '/starts-with-slash' })).status).toBe(400);
  });

  it('GUIDE-005 an empty commit list is a 200 no-op', async () => {
    if (!up) return;
    const before = Number((await db.query(`SELECT COUNT(*) AS n FROM deployment_commits WHERE team_id = $1`, [TEAM])).rows[0].n);
    const r = await json(`/api/ingest/commits?team=${TEAM}`, { deployment: 'g5-dep', commits: [] });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ignored');
    expect(Number((await db.query(`SELECT COUNT(*) AS n FROM deployment_commits WHERE team_id = $1`, [TEAM])).rows[0].n)).toBe(before);
    expect((await json(`/api/ingest/commits?team=${TEAM}`, { commits: [] })).status).toBe(200);
  });

  it('GUIDE-006 Azure DevOps: SucceededWithIssues is a success; several gzipped TRX files in one body', async () => {
    if (!up) return;
    const r = await json(`/api/ingest/pipelines?team=${TEAM}`, { id: 'g6-run', startedAt: iso(1), finishedAt: iso(1, '10:03:00'), result: 'SucceededWithIssues' });
    expect(r.status).toBe(201);
    expect((await db.query(`SELECT result FROM pipeline_runs_raw WHERE team_id = $1 AND external_id = 'g6-run'`, [TEAM])).rows[0].result).toBe('success');
    // gzip -c TestResults/*.trx: two gzip members, decompressed as two documents one after the other.
    const trx = F('trx-dotnet.trx');
    const one = await rawBody(`/api/ingest/tests?team=${TEAM}&commit=g6&run=g6-one&startedAt=${iso(1)}&dryRun=true`, trx);
    const both = await rawBody(`/api/ingest/tests?team=${TEAM}&commit=g6&run=g6-trx&startedAt=${iso(1)}`, Buffer.concat([gzipSync(trx), gzipSync(trx)]), { 'Content-Encoding': 'gzip' });
    expect(both.status).toBe(201);
    expect(both.body.format).toBe('trx');
    expect(both.body.counts.total).toBe(2 * one.body.counts.total);
  });

  it('GUIDE-007 Jenkins NOT_BUILT is accepted and not counted', async () => {
    if (!up) return;
    const r = await json(`/api/ingest/pipelines?team=${TEAM}`, { id: 'g7-run', startedAt: iso(1, '11:00:00'), result: 'NOT_BUILT', stages: [{ name: 'deploy', result: 'NOT_BUILT' }] });
    expect(r.status).toBe(201);
    expect((await db.query(`SELECT result FROM pipeline_runs_raw WHERE team_id = $1 AND external_id = 'g7-run'`, [TEAM])).rows[0].result).toBe('cancelled');
    const ev = (await db.query(`SELECT inputs FROM metric_evidence WHERE team_id = $1 AND metric_key = 'pipeline_success_rate' ORDER BY day DESC LIMIT 1`, [TEAM])).rows[0];
    if (ev) expect(ev.inputs.cancelled).toBeGreaterThanOrEqual(1);
  });
});

describe('Validation and defaults', () => {
  it('GUIDE-008 every problem of an item is listed', async () => {
    if (!up) return;
    const r = await json('/api/ingest/kpis', { teamId: TEAM, source: 'Bad Source!', recordedAt: 'nope', metrics: { test_coverage: 120 }, extra: 1 });
    expect(r.status).toBe(400);
    const errs: string[] = r.body.details[0].errors;
    expect(errs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^source must be/), expect.stringMatching(/^Unexpected field\(s\): extra/), 'recordedAt must be an ISO 8601 timestamp', expect.stringMatching(/^test_coverage must be between 0 and 100/),
    ]));
  });

  it('GUIDE-009 coverage is recorded at the report\'s own timestamp when it has one', async () => {
    if (!up) return;
    const t = Date.parse(iso(3, '08:30:00'));
    const cob = `<?xml version="1.0"?><coverage line-rate="0.5" timestamp="${t}"><packages><package name="p"><classes><class name="A" filename="src/a.py"><lines><line number="1" hits="1"/><line number="2" hits="0"/></lines></class></classes></package></packages></coverage>`;
    const c = await rawBody(`/api/ingest/coverage?team=${TEAM}&commit=g9&run=g9-cob`, cob);
    expect(c.status).toBe(201);
    const jac = `<?xml version="1.0"?><report name="r"><sessioninfo id="s" start="${t - 60_000}" dump="${t}"/><package name="p"><sourcefile name="A.java"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>`;
    const j = await rawBody(`/api/ingest/coverage?team=${TEAM}&commit=g9&run=g9-jac`, jac);
    expect(j.status).toBe(201);
    const lcov = await rawBody(`/api/ingest/coverage?team=${TEAM}&commit=g9&run=g9-lcov`, 'SF:src/a.ts\nDA:1,1\nend_of_record\n');
    expect(lcov.status).toBe(201);
    const at = async (id: string) => new Date((await db.query(`SELECT created_at FROM coverage_reports WHERE id = $1`, [id])).rows[0].created_at).getTime();
    expect(await at(c.body.coverageReportId)).toBe(t);
    expect(await at(j.body.coverageReportId)).toBe(t - 60_000);
    expect(Math.abs((await at(lcov.body.coverageReportId)) - Date.now())).toBeLessThan(5 * 60_000);
  });

  it('GUIDE-010 a status update (triggered + at) for a new incident creates it', async () => {
    if (!up) return;
    const at = iso(1, '07:15:00');
    const r = await json(`/api/ingest/incidents?team=${TEAM}`, { id: 'G10-INC', status: 'triggered', at, severity: 'SEV2' });
    expect(r.status).toBe(201);
    expect(r.body.events[0]).toMatchObject({ id: 'G10-INC', status: 'written' });
    const row = (await db.query(`SELECT status, opened_at FROM incidents_raw WHERE team_id = $1 AND external_id = 'G10-INC'`, [TEAM])).rows[0];
    expect(row.status).toBe('open');
    expect(new Date(row.opened_at).toISOString()).toBe(new Date(at).toISOString());
    // Without a time it is still refused (the first event needs a time).
    expect((await json(`/api/ingest/incidents?team=${TEAM}`, { id: 'G10-INC-2', status: 'triggered' })).status).toBe(400);
  });

  it('GUIDE-011 contextSwitchesPerDay is rounded', async () => {
    if (!up) return;
    const dev = (await db.query(`SELECT id FROM users WHERE company_id = $1 AND primary_team_id = 'golden-team-big' AND id <> 'golden-admin' ORDER BY id LIMIT 1`, [GOLDEN_COMPANY])).rows[0].id;
    const r = await post('/api/metrics/developer', cookie, { teamId: 'golden-team-big', developerId: dev, contextSwitchesPerDay: 3.6 });
    expect(r.status).toBe(200);
    expect((await db.query(`SELECT context_switches_per_day AS n FROM developer_metrics WHERE team_id = 'golden-team-big' AND developer_id = $1`, [dev])).rows[0].n).toBe(4);
    expect((await post('/api/metrics/developer', cookie, { teamId: 'golden-team-big', developerId: dev, contextSwitchesPerDay: 1000.6 })).status).toBe(400);
  });

  it('GUIDE-012 RAW_PAYLOAD_DAYS clears payloads after N days (at most 396); the row stays', async () => {
    if (!up) return;
    const { rawPayloadDays, cleanupRawData } = await import('../../server/lib/calc/engine');
    expect(rawPayloadDays(undefined)).toBe(396);
    expect(rawPayloadDays('30')).toBe(30);
    expect(rawPayloadDays('1000')).toBe(396);
    expect(rawPayloadDays('0')).toBe(396);
    expect(rawPayloadDays('x')).toBe(396);
    const ins = async (days: number, run: string) => (await db.query(
      `INSERT INTO raw_uploads (company_id, team_id, kind, format, commit_sha, run_id, attempt, size_bytes, payload, status, received_at)
       VALUES ($1, $2, 'tests', 'junit', 'g12', $3, 1, 2, $4, 'parsed', now() - make_interval(days => $5)) RETURNING id`,
      [GOLDEN_COMPANY, TEAM, run, gzipSync('{}'), days])).rows[0].id;
    const old = await ins(40, 'g12-old');
    const young = await ins(10, 'g12-young');
    const prev = process.env.RAW_PAYLOAD_DAYS;
    process.env.RAW_PAYLOAD_DAYS = '30';
    try { await cleanupRawData(); } finally { if (prev === undefined) delete process.env.RAW_PAYLOAD_DAYS; else process.env.RAW_PAYLOAD_DAYS = prev; }
    const rows = new Map((await db.query(`SELECT id, payload IS NOT NULL AS has FROM raw_uploads WHERE id = ANY($1::varchar[])`, [[old, young]])).rows.map((r: any) => [r.id, r.has]));
    expect(rows.get(old)).toBe(false);
    expect(rows.get(young)).toBe(true);
  });
});

describe('Exporter and cleanup', () => {
  it('GUIDE-013 a refused item of a list kind is named items[n]', async () => {
    if (!up) return;
    const base = { companyId: GOLDEN_COMPANY, departmentId: DEPT, teamId: TEAM, source: 'github' };
    const runs = [0, 1, 2].map((i) => ({ id: `g13-${i}`, startedAt: iso(1), result: i === 1 ? 'exploded' : 'success' }));
    const p = await exporterBatch({ ...base, kind: 'pipeline-runs', items: runs });
    expect(p.status).toBe(400);
    expect(p.body.error).toMatch(/^items\[1\]: /);
    expect(p.body.item).toBe(1);
    const deps = [{ id: 'g13-d0', environment: 'production', finishedAt: iso(1), result: 'success', commit: 'abcd0001' }, { id: 'g13-d1', finishedAt: iso(1), result: 'success', commit: 'abcd0002' }];
    const d = await exporterBatch({ ...base, kind: 'deployments', items: deps });
    expect(d.body.error).toMatch(/^items\[1\]: .*environment is required/);
    const k = await exporterBatch({ ...base, kind: 'kpis', items: [{ metrics: { test_coverage: 50 } }, { metrics: { test_coverage: 50 } }, { metrics: { test_coverage: 200 } }] });
    expect(k.status).toBe(400);
    expect(k.body.error).toMatch(/^items\[2\]: test_coverage must be between 0 and 100/);
    expect(k.body.item).toBe(2);
  });

  it('GUIDE-014 the raw cleanup runs twice a day on Node, at the same hours as on Netlify', async () => {
    for (const v of ['LOG_CLEANUP_CRON', 'CALC_RECOMPUTE_CRON', 'SANDBOX_RESET_CRON']) process.env[v] = 'off';
    const { LOG_CLEANUP_DEFAULT_CRON } = await import('../../server/jobs/cleanupCron');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'netlify', 'functions', 'db-keepalive.ts'), 'utf8');
    const netlify = /schedule: '([^']+)'/.exec(src)![1];
    const hours = (cron: string) => cron.split(' ')[1].split(',').map(Number);
    expect(hours(LOG_CLEANUP_DEFAULT_CRON)).toHaveLength(2);
    expect(hours(LOG_CLEANUP_DEFAULT_CRON)).toEqual(hours(netlify));
  });
});
