import request from 'supertest';
import { gzipSync } from 'zlib';
import type { Client } from 'pg';
import { API_URL, backendUp, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * The QE Navigator Exporter's JSON envelope, POST /api/ingest/exporter/batch, and GET /api/ingest/exporter/context,
 * against the live API and the local database.
 *
 *   EXB-001  correct ids: accepted; the data lands in exactly that team, logged as channel Exporter
 *   EXB-002  companyId of another company: 403, nothing written anywhere
 *   EXB-003  a department of another company: 403, nothing written
 *   EXB-004  a team in a different department of the same company: 403
 *   EXB-005  a team of another company: 403
 *   EXB-006  an inactive team: 403
 *   EXB-007  each id missing: 400
 *   EXB-008  dry run: validated, nothing written (no data, no ingestion log row)
 *   EXB-009  re-sent with the same Idempotency-Key: replayed, nothing written twice; without a key: duplicate
 *   EXB-010  oversized body: 413
 *   EXB-011  bad kind: 400
 *   EXB-012  "another company's id" and "no such id" get the identical answer (company, department, team)
 *   EXB-013  the context lists only the key's company, its departments and active teams
 *   EXB-014  every kind goes through the existing handlers: test reports (two files, one run), coverage with a
 *            diff, SARIF, deployments with commits, commits, incidents, issues, KPI values; an item naming another
 *            team is refused; no service or project-key mapping is used
 *   EXB-015  gzip body accepted; an item the handler refuses rejects the whole batch with nothing written
 */
const TEAM = 'golden-team-empty';
const DEPT = 'golden-dept-b';
const OTHER_DEPT_TEAM = 'golden-team-small'; // golden-dept-a
const INACTIVE = 'golden-team-inactive';
const DAY = 86_400_000;
const at = (daysAgo: number, hhmm = '10:00') => `${new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10)}T${hhmm}:00.000Z`;

let up = true;
let db: Client;
let apiKey = '';
let other: { company: string; dept: string; team: string };

/** POST the envelope with fetch (supertest would re-encode a Buffer body as JSON). */
async function send(body: unknown, opts: { key?: string; query?: string; gzip?: boolean; auth?: string } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.auth ?? apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'qe-exporter/0.3.0 (test)' };
  if (opts.key) headers['Idempotency-Key'] = opts.key;
  if (opts.gzip) headers['Content-Encoding'] = 'gzip';
  const r = await fetch(`${API_URL}/api/ingest/exporter/batch${opts.query ?? ''}`, { method: 'POST', headers, body: opts.gzip ? gzipSync(raw) : raw });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = { text }; }
  return { status: r.status, body: json, headers: Object.fromEntries(r.headers.entries()) };
}
const envelope = (kind: string, items: unknown[], ids: Partial<Record<'companyId' | 'departmentId' | 'teamId', string | undefined>> = {}) => ({
  companyId: GOLDEN_COMPANY, departmentId: DEPT, teamId: TEAM, source: 'github', kind, items, ...ids,
});
const run = (id: string, daysAgo: number, result = 'success') => ({
  id, attempt: 1, name: 'ci', commit: `c${id}`, branch: 'main', startedAt: at(daysAgo, '09:00'), finishedAt: at(daysAgo, '09:10'), result,
  stages: [{ name: 'build', startedAt: at(daysAgo, '09:00'), finishedAt: at(daysAgo, '09:04'), result: 'success' }, { name: 'unit tests', startedAt: at(daysAgo, '09:04'), finishedAt: at(daysAgo, '09:10'), result }],
});
const junit = (cases: string) => `<?xml version="1.0"?><testsuites><testsuite name="s" tests="2">${cases}</testsuite></testsuites>`;

async function counts(team: string) {
  const one = async (sql: string) => Number((await db.query(sql, [team])).rows[0].n);
  return {
    pipelines: await one('SELECT COUNT(*)::int AS n FROM pipeline_runs_raw WHERE team_id = $1'),
    tests: await one('SELECT COUNT(*)::int AS n FROM test_runs WHERE team_id = $1'),
    uploads: await one('SELECT COUNT(*)::int AS n FROM raw_uploads WHERE team_id = $1'),
  };
}
const logRows = async (company: string) => Number((await db.query(`SELECT COUNT(*)::int AS n FROM ingestion_log WHERE company_id = $1 AND channel = 'exporter'`, [company])).rows[0].n);

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running - exporter batch tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  const cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', cookie, { name: 'Exporter batch test key' })).body.plaintextKey;
  const o = (await db.query(`SELECT t.id AS team, t.department_id AS dept, t.company_id AS company FROM teams t WHERE t.company_id <> $1 AND t.is_active ORDER BY t.id LIMIT 1`, [GOLDEN_COMPANY])).rows[0];
  other = { company: o.company, dept: o.dept, team: o.team };
});

afterAll(async () => {
  if (db) { await removeGolden(db); await db.end(); }
});

describe('POST /api/ingest/exporter/batch', () => {
  it('EXB-001 correct ids: accepted, stored in exactly the named team, logged as channel Exporter', async () => {
    if (!up) return;
    const before = await counts(TEAM);
    const others = await counts(OTHER_DEPT_TEAM);
    const r = await send(envelope('pipeline-runs', [run('exb-1', 3), run('exb-2', 2, 'failed')]));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'accepted', companyId: GOLDEN_COMPANY, departmentId: DEPT, teamId: TEAM, kind: 'pipeline-runs', written: 1, rejected: 0 });
    expect((await counts(TEAM)).pipelines).toBe(before.pipelines + 2);
    expect(await counts(OTHER_DEPT_TEAM)).toEqual(others);
    const log = await db.query(`SELECT channel, team_ids, response->>'client' AS client FROM ingestion_log WHERE company_id = $1 ORDER BY received_at DESC LIMIT 1`, [GOLDEN_COMPANY]);
    expect(log.rows[0]).toMatchObject({ channel: 'exporter', team_ids: [TEAM], client: 'qe-exporter/0.3.0' });
    // The server calculated the values (pipeline success rate) for that team.
    const ev = await db.query(`SELECT COUNT(*)::int AS n FROM metric_evidence WHERE team_id = $1 AND metric_key = 'pipeline_success_rate'`, [TEAM]);
    expect(ev.rows[0].n).toBeGreaterThan(0);
  });

  it('EXB-002 a companyId of another company: 403 and nothing written anywhere', async () => {
    if (!up) return;
    const before = await counts(TEAM);
    const otherBefore = await counts(other.team);
    const otherLog = Number((await db.query(`SELECT COUNT(*)::int AS n FROM ingestion_log WHERE company_id = $1`, [other.company])).rows[0].n);
    const r = await send(envelope('pipeline-runs', [run('exb-x', 2)], { companyId: other.company, departmentId: other.dept, teamId: other.team }));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('companyId does not match this API key');
    expect(await counts(TEAM)).toEqual(before);
    expect(await counts(other.team)).toEqual(otherBefore);
    expect(Number((await db.query(`SELECT COUNT(*)::int AS n FROM ingestion_log WHERE company_id = $1`, [other.company])).rows[0].n)).toBe(otherLog);
  });

  it('EXB-003 a department of another company: 403, nothing written', async () => {
    if (!up) return;
    const before = await counts(TEAM);
    const r = await send(envelope('pipeline-runs', [run('exb-y', 2)], { departmentId: other.dept }));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('departmentId is not a department of your company');
    expect(await counts(TEAM)).toEqual(before);
  });

  it('EXB-004 a team in a different department of the same company: 403', async () => {
    if (!up) return;
    const before = await counts(OTHER_DEPT_TEAM);
    const r = await send(envelope('pipeline-runs', [run('exb-z', 2)], { teamId: OTHER_DEPT_TEAM }));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('teamId is not an active team of this department');
    expect(await counts(OTHER_DEPT_TEAM)).toEqual(before);
  });

  it('EXB-005 a team of another company: 403', async () => {
    if (!up) return;
    const before = await counts(other.team);
    const r = await send(envelope('pipeline-runs', [run('exb-w', 2)], { teamId: other.team }));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('teamId is not an active team of this department');
    expect(await counts(other.team)).toEqual(before);
  });

  it('EXB-006 an inactive team: 403', async () => {
    if (!up) return;
    const r = await send(envelope('pipeline-runs', [run('exb-v', 2)], { departmentId: 'golden-dept-a', teamId: INACTIVE }));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('teamId is not an active team of this department');
    expect((await counts(INACTIVE)).pipelines).toBe(0);
  });

  it('EXB-007 each id missing: 400', async () => {
    if (!up) return;
    for (const f of ['companyId', 'departmentId', 'teamId'] as const) {
      const body: any = envelope('pipeline-runs', [run('exb-m', 2)]);
      delete body[f];
      const r = await send(body);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(new RegExp(`^${f} is required`));
    }
  });

  it('EXB-008 dry run: validated, nothing written (no data, no ingestion log row)', async () => {
    if (!up) return;
    const before = await counts(TEAM);
    const logs = await logRows(GOLDEN_COMPANY);
    const r = await send(envelope('pipeline-runs', [run('exb-dry', 1)]), { query: '?dryRun=true' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'dry-run', teamId: TEAM });
    expect(await counts(TEAM)).toEqual(before);
    expect(await logRows(GOLDEN_COMPANY)).toBe(logs);
    // A refused dry run writes nothing either.
    const bad = await send(envelope('pipeline-runs', [run('exb-dry2', 1)], { teamId: OTHER_DEPT_TEAM }), { query: '?dryRun=true' });
    expect(bad.status).toBe(403);
    expect(await logRows(GOLDEN_COMPANY)).toBe(logs);
  });

  it('EXB-009 a re-sent batch with the same Idempotency-Key is replayed; without a key it is a duplicate', async () => {
    if (!up) return;
    const body = envelope('pipeline-runs', [run('exb-idem', 1)]);
    const first = await send(body, { key: 'exb-test-key-1' });
    expect(first.status).toBe(201);
    const before = await counts(TEAM);
    const logs = await logRows(GOLDEN_COMPANY);
    const again = await send(body, { key: 'exb-test-key-1' });
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await counts(TEAM)).toEqual(before);
    expect(await logRows(GOLDEN_COMPANY)).toBe(logs);
    const plain = await send(body);
    expect(plain.status).toBe(200);
    expect(plain.body.status).toBe('duplicate');
    expect(await counts(TEAM)).toEqual(before);
  });

  it('EXB-010 an oversized body: 413', async () => {
    if (!up) return;
    const big = 'x'.repeat(21 * 1024 * 1024);
    const r = await send(envelope('test-report', [{ files: [{ name: 'a.xml', content: big }] }]));
    expect(r.status).toBe(413);
  });

  it('EXB-011 a bad kind: 400', async () => {
    if (!up) return;
    const r = await send(envelope('metrics', [{}]));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/^kind must be one of/);
  });

  it('EXB-012 another company\'s id and a non-existent id get the identical answer', async () => {
    if (!up) return;
    const strip = (b: any) => { const { ingestionId: _i, ...rest } = b; return rest; };
    const pairs: Array<[Record<string, string>, Record<string, string>]> = [
      [{ companyId: other.company }, { companyId: 'no-such-company' }],
      [{ departmentId: other.dept }, { departmentId: 'no-such-dept' }],
      [{ teamId: other.team }, { teamId: 'no-such-team' }],
    ];
    for (const [a, b] of pairs) {
      const ra = await send(envelope('pipeline-runs', [run('exb-s', 1)], a));
      const rb = await send(envelope('pipeline-runs', [run('exb-s', 1)], b));
      expect(ra.status).toBe(rb.status);
      expect(strip(ra.body)).toEqual(strip(rb.body));
    }
  });

  it('EXB-014 every kind goes through the existing handlers into the named team', async () => {
    if (!up) return;
    const tests = await send(envelope('test-report', [{
      commit: 'exbt1', branch: 'main', run: 'exb-run-1', attempt: 1, startedAt: at(2),
      files: [{ name: 'a.xml', content: junit('<testcase classname="A" name="one" time="0.1"/><testcase classname="A" name="two" time="0.2"><failure/></testcase>') },
        { name: 'b.xml', content: junit('<testcase classname="B" name="three" time="0.3"/>') }],
    }]));
    expect([tests.status, tests.body.error]).toEqual([201, undefined]);
    const tr = await db.query(`SELECT passed, failed FROM test_runs WHERE team_id = $1 AND run_id = 'exb-run-1'`, [TEAM]);
    expect(tr.rows[0]).toMatchObject({ passed: 2, failed: 1 });

    const lcov = 'TN:\nSF:src/a.ts\nDA:1,1\nDA:2,0\nDA:3,1\nLF:3\nLH:2\nend_of_record\n';
    const diff = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,0 +2,2 @@\n+x\n+y\n';
    const cov = await send(envelope('coverage', [{ commit: 'exbc1', branch: 'main', run: 'exb-cov-1', startedAt: at(2), files: [{ name: 'lcov.info', content: lcov }], diff }]));
    expect([cov.status, cov.body.error]).toEqual([201, undefined]);
    expect((await db.query(`SELECT lines_found, lines_hit, changed_lines_found FROM coverage_reports WHERE team_id = $1 AND run_id = 'exb-cov-1'`, [TEAM])).rows[0]).toMatchObject({ lines_found: 3, lines_hit: 2 });

    const sarif = JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'semgrep', rules: [{ id: 'r1' }] } }, results: [{ ruleId: 'r1', level: 'error', locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.ts' } } }] }] }] });
    const sa = await send(envelope('sarif', [{ commit: 'exbs1', branch: 'main', run: 'exb-sarif-1', startedAt: at(2), repo: 'acme/pay', loc: 1000, files: [{ name: 'r.sarif', content: sarif }] }]));
    expect([sa.status, sa.body.error]).toEqual([201, undefined]);
    expect((await db.query(`SELECT findings FROM analysis_reports WHERE team_id = $1 AND run_id = 'exb-sarif-1'`, [TEAM])).rows[0].findings).toBe(1);

    const dep = await send(envelope('deployments', [{
      id: 'exb-dep-1', environment: 'production', service: 'unmapped-service', commit: 'dddd0001', startedAt: at(2, '11:00'), finishedAt: at(2, '11:05'), result: 'success',
      commits: [{ sha: 'dddd0001', authoredAt: at(3), committedAt: at(3) }],
    }, { id: 'exb-dep-2', environment: 'production', service: 'unmapped-service', commit: 'dddd0002', startedAt: at(1, '11:00'), finishedAt: at(1, '11:05'), result: 'failure' }]));
    expect([dep.status, dep.body.error]).toEqual([201, undefined]);
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM deployments_raw WHERE team_id = $1 AND external_id LIKE 'exb-dep-%'`, [TEAM])).rows[0].n).toBe(2);

    const com = await send(envelope('commits', [{ deployment: 'exb-dep-1', commits: [{ sha: 'dddd0000', authoredAt: at(4), committedAt: at(4), author: 'dev@example.com' }] }]));
    expect([com.status, com.body.error]).toEqual([201, undefined]);
    const stored = await db.query(`SELECT author_hash FROM deployment_commits WHERE team_id = $1 AND sha = 'dddd0000'`, [TEAM]);
    expect(stored.rows[0].author_hash).not.toContain('@');

    const inc = await send(envelope('incidents', [{ id: 'exb-inc-1', service: 'unmapped-service', severity: 'critical', status: 'resolved', openedAt: at(1, '12:00'), resolvedAt: at(1, '13:00') }]));
    expect([inc.status, inc.body.error]).toEqual([201, undefined]);
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM incidents_raw WHERE team_id = $1 AND external_id = 'exb-inc-1'`, [TEAM])).rows[0].n).toBe(1);

    const iss = await send(envelope('issues', [{ key: 'EXB-1', project: 'UNMAPPED', type: 'bug', status: 'Done', statusCategory: 'done', createdAt: at(5), resolvedAt: at(2), environment: 'production', description: 'secret text' }]));
    expect([iss.status, iss.body.error]).toEqual([201, undefined]);
    const issue = await db.query(`SELECT * FROM issues WHERE team_id = $1 AND external_id = 'EXB-1'`, [TEAM]);
    expect(issue.rows.length).toBe(1);
    expect(JSON.stringify(issue.rows[0])).not.toContain('secret text');

    const kpi = await send(envelope('kpis', [{ recordedAt: at(1), metrics: { automation_coverage: 61.5, automation_roi: 120 } }]));
    expect([kpi.status, kpi.body.error]).toEqual([201, undefined]);
    const snap = await db.query(`SELECT automation_coverage::float8 AS ac FROM kpi_snapshots WHERE team_id = $1 ORDER BY snapshot_date DESC LIMIT 1`, [TEAM]);
    expect(snap.rows[0].ac).toBe(61.5);

    // An item naming another team (here: a team of the same company) is refused; nothing is written.
    const sneaky = await send(envelope('deployments', [{ id: 'exb-dep-x', team: 'golden-team-big', environment: 'production', commit: 'dddd00ff', finishedAt: at(1), result: 'success' }]));
    expect(sneaky.status).toBe(403);
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM deployments_raw WHERE external_id = 'exb-dep-x'`)).rows[0].n).toBe(0);
    const sneakyKpi = await send(envelope('kpis', [{ teamId: 'golden-team-big', metrics: { automation_coverage: 1 } }]));
    expect(sneakyKpi.status).toBe(400);
    const sneakyReport = await send(envelope('test-report', [{ team: 'golden-team-big', files: [{ name: 'a.xml', content: junit('<testcase classname="A" name="one"/>') }] }]));
    expect(sneakyReport.status).toBe(400);
  });

  it('EXB-015 gzip accepted; one refused item rejects the whole batch and writes nothing', async () => {
    if (!up) return;
    const before = await counts(TEAM);
    const ok = await send(envelope('test-report', [{ commit: 'g1', run: 'exb-gz', startedAt: at(1), files: [{ name: 'a.xml', content: junit('<testcase classname="A" name="g"/>') }] }]), { gzip: true });
    expect(ok.status).toBe(201);
    const mid = await counts(TEAM);
    expect(mid.tests).toBe(before.tests + 1);
    const bad = await send(envelope('test-report', [
      { commit: 'g2', run: 'exb-gz-2', startedAt: at(1), files: [{ name: 'a.xml', content: junit('<testcase classname="A" name="h"/>') }] },
      { commit: 'g3', run: 'exb-gz-3', startedAt: at(1), files: [{ name: 'b.txt', content: 'not a report' }] },
    ]));
    expect(bad.status).toBe(415);
    expect(bad.body.error).toMatch(/^items\[1\]/);
    expect(await counts(TEAM)).toEqual(mid);
  });
});

describe('GET /api/ingest/exporter/context', () => {
  it('EXB-013 lists the key\'s company, its departments and active teams only', async () => {
    if (!up) return;
    const r = await request(API_URL).get('/api/ingest/exporter/context').set('Authorization', `Bearer ${apiKey}`);
    expect(r.status).toBe(200);
    expect(r.body.company.id).toBe(GOLDEN_COMPANY);
    const deps = r.body.departments.map((d: any) => d.id).sort();
    expect(deps).toEqual(['golden-dept-a', 'golden-dept-b']);
    const teams = r.body.departments.flatMap((d: any) => d.teams.map((t: any) => t.id));
    expect(teams).toContain(TEAM);
    expect(teams).not.toContain(INACTIVE);
    expect(teams).not.toContain(other.team);
    const own = (await db.query(`SELECT id FROM teams WHERE company_id = $1 AND is_active`, [GOLDEN_COMPANY])).rows.map((x: any) => x.id).sort();
    expect([...teams].sort()).toEqual(own);
    const noKey = await request(API_URL).get('/api/ingest/exporter/context');
    expect(noKey.status).toBe(401);
  });
});
