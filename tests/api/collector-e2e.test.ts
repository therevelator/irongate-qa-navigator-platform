import http from 'http';
import { execFile, execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * The QE Navigator Collector (collector/) end to end against a live QE Navigator: the Collector bundle runs as a plain
 * process, reads mock Jira Cloud, Linear, PagerDuty and Opsgenie servers (the vendor fixtures of
 * collector/test/fixtures, moved to recent dates), and sends to the real ingestion API with a company key.
 * Proves: check and preview (dry run, nothing stored), records land in issues / issue_sprints /
 * incidents_raw for the mapped teams, the metrics are computed (velocity, MTTR, infrastructure failures),
 * nothing personal or free text is stored, the ingestion log names the Collector, a re-run sends nothing, and a
 * re-send after a lost state file is a duplicate for QE Navigator. Skips when no backend runs.
 */
const TEAM = 'golden-team-empty';
const SMALL = 'golden-team-small';
const ROOT = join(__dirname, '..', '..');
const AGENT = join(ROOT, 'collector');
const BUNDLE = join(AGENT, 'dist', 'qe-collector.mjs');
const FIX = join(AGENT, 'test', 'fixtures');
const DAY = 86_400_000;

const fixture = (name: string) => JSON.parse(readFileSync(join(FIX, name), 'utf8'));
/** Fixture dates are around 2026-11-20; move them so that 2026-11-22T00:00Z is now minus 6 hours. */
const SHIFT = Date.now() - 6 * 3600_000 - Date.parse('2026-11-22T00:00:00Z');
const ISO = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})$/;
function shift<T>(v: T): T {
  if (typeof v === 'string') {
    const m = ISO.exec(v);
    if (!m) return v;
    const d = new Date(Date.parse(m[1] + (m[2] === 'Z' ? 'Z' : m[2].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2'))) + SHIFT).toISOString();
    return (m[2] === 'Z' ? d : d.replace('Z', '+0000')) as unknown as T;
  }
  if (Array.isArray(v)) return v.map(shift) as unknown as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)])) as T;
  return v;
}
const day = (iso: string) => new Date(Date.parse(iso) + SHIFT).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

/** One mock server for all four tools (path prefixes /jira, /linear, /pd, /og). */
function vendors(): Promise<{ url: string; close: () => Promise<void>; hits: string[] }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://x');
      hits.push(`${req.method} ${u.pathname}`);
      const send = (body: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      const p = u.pathname;
      if (p === '/jira/rest/api/3/myself') return send(fixture('jira-myself.json'));
      if (p === '/jira/rest/api/3/field') return send(fixture('jira-fields.json'));
      if (p === '/jira/rest/api/3/status') return send(fixture('jira-status.json'));
      if (p === '/jira/rest/api/3/search/approximate-count') return send({ count: 5 });
      if (p === '/jira/rest/api/3/search/jql') return send(shift(fixture(u.searchParams.get('nextPageToken') ? 'jira-cloud-search-page2.json' : 'jira-cloud-search-page1.json')));
      if (p === '/jira/rest/api/3/issue/PAY-101/changelog') return send(shift(fixture('jira-cloud-changelog-PAY-101.json')));
      if (p === '/linear/graphql') {
        const q = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (q.query.includes('organization')) return send(fixture('linear-teams.json'));
        if (q.query.startsWith('query History')) return send(shift(fixture('linear-history-ENG-1.json')));
        return send(shift(fixture(q.variables.after === 'cursor-1' ? 'linear-issues-page2.json' : 'linear-issues-page1.json')));
      }
      if (p === '/pd/log_entries') {
        const since = Date.parse(u.searchParams.get('since')!);
        const until = Date.parse(u.searchParams.get('until')!);
        const out = shift(fixture('pagerduty-log-entries.json'));
        out.log_entries = out.log_entries.filter((e: any) => Date.parse(e.created_at) >= since && Date.parse(e.created_at) < until);
        return send(out);
      }
      if (p === '/pd/services') return send(fixture('pagerduty-services.json'));
      if (p === '/og/v2/teams') return send(fixture('opsgenie-teams.json'));
      if (p === '/og/v2/alerts') return send(u.searchParams.get('limit') === '1' ? { data: [] } : shift(fixture('opsgenie-alerts.json')));
      send({ error: `no mock for ${p}` }, 404);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as any).port;
    resolve({ url: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) });
  }));
}

let up = true;
let db: Client;
let apiKey = '';
let apiKeyId = '';
let adminCookie = '';
let mock: Awaited<ReturnType<typeof vendors>>;
let dir = '';
let cfgPath = '';

function collector(args: string[], state = join(dir, 'state.json')): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BUNDLE, ...args, '-c', cfgPath, '--state', state, '--log-format', 'json'], {
      env: {
        PATH: process.env.PATH ?? '', QE_API_KEY: apiKey, JIRA_TOKEN: 'e2e-jira-token', JIRA_EMAIL: 'svc@example.com',
        LINEAR_API_KEY: 'lin_api_e2e', PAGERDUTY_TOKEN: 'e2e-pd-token', OPSGENIE_API_KEY: 'e2e-og-key',
      },
      timeout: 120_000,
    }, (err, stdout, stderr) => resolve({ code: err ? Number((err as any).code ?? 1) : 0, stdout, stderr }));
  });
}
const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].n);
const evidence = async (team: string, metric: string, d: string) =>
  (await db.query(`SELECT value::float8 AS value, sample_size FROM metric_evidence WHERE team_id = $1 AND day = $2::date AND metric_key = $3`, [team, d, metric])).rows[0] ?? null;
const logRows = () => count(`SELECT COUNT(*) AS n FROM ingestion_log WHERE api_key_id = $1`, [apiKeyId]);

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running at', API_URL, '- Collector end-to-end tests skipped'); return; }
  if (!existsSync(BUNDLE)) execFileSync(process.execPath, [join(AGENT, 'scripts', 'build.mjs')], { stdio: 'ignore' });
  db = await localDb();
  await createGolden(db);
  adminCookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  const created = await post('/api/admin/api-keys', adminCookie, { name: 'qe-collector e2e' });
  apiKey = created.body.plaintextKey;
  apiKeyId = created.body.key.id;
  mock = await vendors();
  dir = mkdtempSync(join(tmpdir(), 'qe-collector-e2e-'));
  cfgPath = join(dir, 'qe-collector.yaml');
  writeFileSync(cfgPath, `qeNavigator:
  url: ${API_URL}
privacy:
  mode: full
heartbeat: false
backfillDays: 60
sources:
  - type: jira
    baseUrl: ${mock.url}/jira
    deployment: cloud
    jql: project in (PAY, WEB)
    teams: { PAY: ${TEAM}, WEB: ${TEAM} }
  - type: linear
    apiUrl: ${mock.url}/linear/graphql
    teams: { ENG: ${SMALL} }
  - type: pagerduty
    apiUrl: ${mock.url}/pd
    services: { payments-api: ${TEAM}, checkout: ${TEAM} }
  - type: opsgenie
    apiUrl: ${mock.url}/og
    teams: { Payments: ${SMALL} }
`);
});

afterAll(async () => {
  if (mock) await mock.close();
  if (db) {
    await removeGolden(db);
    await db.end();
  }
});

describe('QE Navigator Collector against the real ingestion API', () => {
  it('COL-001 check: every source and QE Navigator reachable, the team ids accepted, exit 0, no secret printed', async () => {
    if (!up) return;
    const r = await collector(['check']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/key valid, 2 team id\(s\) accepted/);
    expect(r.stdout).toMatch(/All checks passed/);
    for (const s of [apiKey, 'e2e-jira-token', 'lin_api_e2e', 'e2e-pd-token', 'e2e-og-key']) expect(r.stdout).not.toContain(s);
  });

  it('COL-002 preview: the exact bodies, validated by the API dry run; nothing stored', async () => {
    if (!up) return;
    const r = await collector(['preview']);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.requests.map((q: any) => [q.url.replace(API_URL, ''), q.records, q.dryRun.status])).toEqual([
      ['/api/ingest/issues?format=json', 4, 200], ['/api/ingest/issues?format=json', 3, 200],
      ['/api/ingest/incidents?format=json', 2, 200], ['/api/ingest/incidents?format=json', 2, 200],
    ]);
    expect(report.requests[0].dryRun.answer.status).toBe('dry-run');
    expect(await count(`SELECT COUNT(*) AS n FROM issues WHERE team_id IN ($1, $2)`, [TEAM, SMALL])).toBe(0);
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
  });

  it('COL-003 sync: issues, sprints and incidents land for the mapped teams; metrics are computed; nothing personal is stored', async () => {
    if (!up) return;
    const r = await collector(['sync']);
    expect(r.code).toBe(0);
    const keys = (await db.query(`SELECT team_id, external_id FROM issues WHERE team_id IN ($1, $2) ORDER BY external_id`, [TEAM, SMALL])).rows.map((x: any) => `${x.team_id}:${x.external_id}`);
    expect(keys).toEqual([`${SMALL}:ENG-1`, `${SMALL}:ENG-2`, `${SMALL}:ENG-3`, `${TEAM}:PAY-101`, `${TEAM}:PAY-102`, `${TEAM}:PAY-103`, `${TEAM}:WEB-9`]);
    const pay101 = (await db.query(`SELECT issue_type, status_category, story_points::float8 AS sp, title FROM issues WHERE team_id = $1 AND external_id = 'PAY-101'`, [TEAM])).rows[0];
    expect(pay101).toMatchObject({ issue_type: 'story', status_category: 'done', sp: 5, title: null });
    expect(await count(`SELECT COUNT(*) AS n FROM issue_transitions t JOIN issues i ON i.id = t.issue_id WHERE i.team_id = $1 AND i.external_id = 'PAY-101'`, [TEAM])).toBe(7);
    expect(await count(`SELECT COUNT(*) AS n FROM issue_sprints WHERE team_id = $1 AND external_id = '47' AND state = 'closed'`, [TEAM])).toBe(1);
    const inc = (await db.query(`SELECT team_id, external_id, severity, status, title FROM incidents_raw WHERE team_id IN ($1, $2) ORDER BY external_id`, [TEAM, SMALL])).rows;
    expect(inc.map((x: any) => [x.team_id, x.external_id, x.severity, x.status, x.title])).toEqual([
      [SMALL, '6f2c-0001', 'high', 'resolved', null], [SMALL, '6f2c-0002', 'medium', 'acknowledged', null],
      [TEAM, 'Q1INC0001', 'critical', 'resolved', null], [TEAM, 'Q1INC0002', 'low', 'acknowledged', null],
    ]);
    // Metrics: velocity of the closed sprint 47 (PAY-101, 5 points) and Linear cycle 7 (ENG-1, 3 points);
    // MTTR 53 minutes (PagerDuty) and 15 minutes (Opsgenie); one infrastructure incident.
    expect((await evidence(TEAM, 'velocity', day('2026-11-21T00:00:00Z')))?.value).toBe(5);
    expect((await evidence(SMALL, 'velocity', day('2026-11-21T00:00:00Z')))?.value).toBe(3);
    expect((await evidence(TEAM, 'mttr', today()))?.value).toBeCloseTo(0.88, 2);
    expect((await evidence(SMALL, 'mttr', today()))?.value).toBeCloseTo(0.25, 2);
    expect((await evidence(SMALL, 'infrastructure_failures', today()))?.value).toBe(1);
    // Nothing personal or free text anywhere QE Navigator stored the data (rows and the kept raw copy).
    const stored = JSON.stringify([
      (await db.query(`SELECT * FROM issues WHERE team_id IN ($1, $2)`, [TEAM, SMALL])).rows,
      (await db.query(`SELECT * FROM incidents_raw WHERE team_id IN ($1, $2)`, [TEAM, SMALL])).rows,
      (await db.query(`SELECT payload FROM raw_uploads WHERE team_id IN ($1, $2) AND kind IN ('issues', 'incidents')`, [TEAM, SMALL])).rows
        .map((x: any) => (x.payload ? (x.payload[0] === 0x1f && x.payload[1] === 0x8b ? gunzipSync(x.payload) : Buffer.from(x.payload)).toString('utf8') : '')),
    ]);
    expect(stored).toContain('PAY-101');
    for (const bad of ['SECRET', 'alice@', 'Alice', 'Bob Jones', 'frank@', 'Dave Doe', 'erin@', 'carol@', 'Refund to card', 'Disk full']) expect(stored).not.toContain(bad);
    // The ingestion log names the Collector.
    const log = (await db.query(`SELECT source, status, response ->> 'client' AS client FROM ingestion_log WHERE api_key_id = $1 AND source NOT LIKE '%test call%' ORDER BY received_at`, [apiKeyId])).rows;
    expect(log.map((x: any) => [x.source, x.status, x.client])).toEqual([
      ['issues (json)', 'accepted', 'qe-collector/0.2.0'], ['issues (json)', 'accepted', 'qe-collector/0.2.0'],
      ['incidents (json)', 'accepted', 'qe-collector/0.2.0'], ['incidents (json)', 'accepted', 'qe-collector/0.2.0'],
    ]);
    const entries = (await get('/api/ingestion-log?limit=20', adminCookie)).body.entries;
    expect(entries.filter((e: any) => e.client === 'qe-collector/0.2.0').length).toBeGreaterThanOrEqual(4);
  });

  it('COL-004 idempotent: a re-run and a backfill send nothing; after a lost state file QE Navigator answers from its log and writes nothing', async () => {
    if (!up) return;
    const before = await logRows();
    const issues = await count(`SELECT COUNT(*) AS n FROM issues WHERE team_id IN ($1, $2)`, [TEAM, SMALL]);
    expect((await collector(['sync'])).code).toBe(0);
    expect((await collector(['sync', '--since', new Date(Date.now() - 50 * DAY).toISOString().slice(0, 10)])).code).toBe(0);
    expect(await logRows()).toBe(before);
    // Lost state: the same batches go again with the same Idempotency-Keys; QE Navigator answers from its log
    // (Idempotent-Replayed) and writes nothing.
    const fresh = await collector(['sync'], join(dir, 'lost-state.json'));
    expect(fresh.code).toBe(0);
    expect(fresh.stderr).toMatch(/delivered 4 \(0 new or changed, 4 already known\)/);
    expect(await logRows()).toBe(before);
    expect(await count(`SELECT COUNT(*) AS n FROM issues WHERE team_id IN ($1, $2)`, [TEAM, SMALL])).toBe(issues);
    expect(GOLDEN_COMPANY).toBe('golden-co');
  });
});
