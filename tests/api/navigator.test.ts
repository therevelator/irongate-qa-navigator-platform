/**
 * The "next move" API (server/routes/navigator.ts): hours lost per week, findings, outcomes, data readiness, and the
 * Exporter's discovery report (kind "discovery"). Needs the API and the database.
 *
 *   NAV-01  the pages need a signed-in user
 *   NAV-02  status: a team's pipeline records become hours lost (a slow stage, a failed run that passed on a rerun),
 *           the company figure is the sum of the teams in scope
 *   NAV-03  findings: the slow stage with the commits the change is between; one team with ?team=
 *   NAV-04  giving a finding an owner (a tracked action on the cause's KPI) shows on the finding and in Outcomes
 *   NAV-05  readiness: connected and missing sources, what a gap blocks and its fix; the discovery report explains it
 *   NAV-06  discovery: one report per team and source, the latest replaces the one before; unknown fields are refused;
 *           the same through the Exporter's batch endpoint
 *   NAV-07  scope: a team member sees their own team only
 */
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

const TEAM = 'golden-team-empty';
const DAY = 86_400_000;
let up = true;
let db: Client;
let admin = '';
let apiKey = '';

const end = Math.floor(Date.now() / DAY) * DAY + DAY;
const weekStart = (w: number) => end - (12 - w) * 7 * DAY;
const iso = (t: number) => new Date(t).toISOString();

async function seedPipelines() {
  let n = 0;
  const run = async (at: number, commit: string, result: string, durationS: number, stageS: number | null) => {
    const id = `nav-run-${n++}`;
    await db.query(
      `INSERT INTO pipeline_runs_raw (id, company_id, team_id, external_id, attempt, name, commit_sha, branch, started_at, finished_at, duration_s, result, day)
       VALUES ($1, $2, $3, $1, 1, 'CI', $4, 'main', $5::timestamptz, $6::timestamptz, $7, $8, ($5::timestamptz AT TIME ZONE 'UTC')::date)`, [id, GOLDEN_COMPANY, TEAM, commit, iso(at), iso(at + durationS * 1000), durationS, result]);
    if (stageS !== null) {
      await db.query(`INSERT INTO pipeline_stage_runs (id, pipeline_run_id, team_id, name, kind, started_at, finished_at, duration_s, result) VALUES ($1, $2, $3, 'integration', 'test', $4::timestamptz, $5::timestamptz, $6, 'success')`,
        [`${id}-s`, id, TEAM, iso(at), iso(at + stageS * 1000), stageS]);
    }
  };
  // Twelve weeks of six runs; the "integration" stage takes 4 minutes, and 11 minutes in the last two weeks.
  for (let w = 0; w < 12; w++) for (let i = 0; i < 6; i++) await run(weekStart(w) + i * 3_600_000 + 60_000, `c${w}x${i}`, 'success', 900, w >= 10 ? 660 : 240);
  // In the latest week one run failed and its rerun on the same commit passed (20 minutes spent on the failed run).
  await run(weekStart(11) + DAY, 'flaky1', 'failed', 1200, null);
  await run(weekStart(11) + DAY + 3_600_000, 'flaky1', 'success', 900, null);
}

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running - navigator tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  await seedPipelines();
  admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', admin, { name: 'Navigator test key' })).body.plaintextKey;
}, 120_000);

afterAll(async () => { if (db) { await removeGolden(db); await db.end(); } });

describe('next move API', () => {
  it('NAV-01 needs a signed-in user', async () => {
    if (!up) return;
    for (const p of ['status', 'findings', 'outcomes', 'readiness']) expect((await get(`/api/navigator/${p}`)).status).toBe(401);
  });

  it('NAV-02 status: hours lost from the pipeline records', async () => {
    if (!up) return;
    const res = await get('/api/navigator/status', admin);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.weeks).toHaveLength(12);
    const t = res.body.teams.find((x: any) => x.id === TEAM);
    // Slow stage: (660 − 240) s × 6 runs = 0.7 h. Flaky rerun: 1200 s = 0.33 h.
    expect(t.hoursNow).toBe(1.03);
    expect(t.hoursBefore).toBe(0);
    expect(t.trend.slice(-3)).toEqual([0, 0.7, 1.03]);
    expect(t.focus).toMatchObject({ id: `lost:${TEAM}:slow_stage`, hours: 0.7, status: 'suggested', owner: null });
    const sum = (k: string) => Math.round(res.body.teams.reduce((n: number, x: any) => n + (x[k] ?? 0), 0) * 10) / 10;
    expect(res.body.hoursNow).toBe(sum('hoursNow'));
    expect(res.body.causes.map((c: any) => c.key)).toEqual(['slow_stage', 'flaky_rerun', 'blocked', 'failed_change', 'review_wait']);
    expect(res.body.unowned.count).toBeGreaterThanOrEqual(1);
    const stored = await db.query(`SELECT cause, hours::float8 AS h FROM lost_hours_weekly WHERE team_id = $1 AND week_start = $2::date ORDER BY cause`, [TEAM, iso(weekStart(11)).slice(0, 10)]);
    expect(stored.rows.filter((r: any) => r.h > 0)).toEqual([{ cause: 'flaky_rerun', h: 0.33 }, { cause: 'slow_stage', h: 0.7 }]);
  }, 60_000);

  it('NAV-03 findings: the slow stage, since when, between which commits', async () => {
    if (!up) return;
    const res = await get(`/api/navigator/findings?team=${TEAM}`, admin);
    expect(res.status).toBe(200);
    expect(res.body.teams).toEqual([{ id: TEAM, name: expect.any(String) }]);
    const f = res.body.findings.find((x: any) => x.id === `lost:${TEAM}:slow_stage`);
    expect(f).toMatchObject({ cause: 'slow_stage', hours: 0.7, confidence: 'high', metricKey: 'avg_build_time_minutes', action: null, since: iso(weekStart(10)).slice(0, 10) });
    expect(f.title).toBe('Stage “CI › integration” is 7 min slower than its best week');
    expect(f.nextStep).toContain('c9x5 … c10x0');
    expect(f.trend.slice(-3)).toEqual([0, 0.7, 0.7]);
    // The flaky rerun is below half an hour a week: counted in the hours, not listed as a finding.
    expect(res.body.findings.some((x: any) => x.cause === 'flaky_rerun')).toBe(false);
    expect(res.body.hoursTotal).toBe(1);
  }, 60_000);

  it('NAV-04 an owner makes the finding a tracked action', async () => {
    if (!up) return;
    const f = (await get(`/api/navigator/findings?team=${TEAM}`, admin)).body.findings.find((x: any) => x.id === `lost:${TEAM}:slow_stage`);
    const made = await post('/api/actions', admin, { teamId: TEAM, title: f.title, description: f.summary, dueDate: iso(Date.now() + 14 * DAY).slice(0, 10), metricKey: f.metricKey });
    expect(made.status).toBe(201);
    const after = (await get(`/api/navigator/findings?team=${TEAM}`, admin)).body.findings.find((x: any) => x.id === f.id);
    expect(after.action).toMatchObject({ id: made.body.action.id, status: 'open' });
    const out = (await get('/api/navigator/outcomes', admin)).body;
    expect(out.owned.find((a: any) => a.id === made.body.action.id)).toMatchObject({ teamId: TEAM, verdict: 'owned', metric: { key: 'avg_build_time_minutes' } });
    expect(out.suggested.some((x: any) => x.id === f.id)).toBe(false);
    expect(typeof out.verdictRule).toBe('string');
    expect((await get('/api/navigator/outcomes?month=2020-01', admin)).body.verified).toEqual([]);
  }, 60_000);

  it('NAV-05 and NAV-06 readiness, and the discovery report that explains a gap', async () => {
    if (!up) return;
    const before = (await get('/api/navigator/readiness', admin)).body;
    const t = before.teams.find((x: any) => x.id === TEAM);
    expect(t.cells.pipelines).toBe('ok');
    expect(t.cells.tests).toBe('missing');
    expect(t.readiness).toBe(17); // one of the six required sources
    const gap = t.gaps.find((g: any) => g.source === 'tests');
    expect(gap).toMatchObject({ required: true, state: 'missing', seen: [] });
    expect(gap.blocks).toContain('Flaky tests');
    expect(before.sources.filter((s: any) => s.required)).toHaveLength(6);

    const send = (body: unknown) => request(API_URL).post(`/api/ingest/discovery?team=${TEAM}&source=jenkins`).set('Authorization', `Bearer ${apiKey}`).set('User-Agent', 'qe-exporter/0.5.0 (test)').send(body as object);
    const bad = await send([{ counts: { pipelineRuns: 3 }, jobs: ['a'] }]);
    expect(bad.status).toBe(400);
    expect((await send([{ counts: { pipelineRuns: 14 }, runsWithoutTests: 14, runsWithoutCoverage: 0, unmapped: ['job nightly-load is not mapped'] }])).status).toBe(201);
    // The latest report replaces the one before, through the Exporter's batch endpoint too.
    const batch = await request(API_URL).post('/api/ingest/exporter/batch').set('Authorization', `Bearer ${apiKey}`).set('User-Agent', 'qe-exporter/0.5.0 (test)')
      .send({ companyId: GOLDEN_COMPANY, departmentId: 'golden-dept-b', teamId: TEAM, source: 'jenkins', kind: 'discovery', items: [{ counts: { pipelineRuns: 20 }, runsWithoutTests: 20, runsWithoutCoverage: 5 }] });
    expect(batch.status).toBe(201);
    const rows = await db.query(`SELECT source, exporter_version, report FROM exporter_discovery WHERE team_id = $1`, [TEAM]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ source: 'jenkins', exporter_version: '0.5.0', report: { counts: { pipelineRuns: 20 }, runsWithoutTests: 20 } });
    const after = (await get('/api/navigator/readiness', admin)).body.teams.find((x: any) => x.id === TEAM);
    expect(after.gaps.find((g: any) => g.source === 'tests').seen).toEqual(['jenkins: 20 of 20 pipeline runs kept no test report.']);
    expect(after.gaps.find((g: any) => g.source === 'coverage').seen).toEqual(['jenkins: 5 of 20 pipeline runs kept no coverage file.']);
  }, 60_000);

  it('NAV-07 a team member sees their own team only', async () => {
    if (!up) return;
    const member = (await login('big-2@golden.example')).cookie;
    const res = await get('/api/navigator/status', member);
    expect(res.status).toBe(200);
    expect(res.body.teams.map((t: any) => t.id)).toEqual(['golden-team-big']);
    expect((await get(`/api/navigator/findings?team=${TEAM}`, member)).body.findings).toEqual([]);
    expect((await get('/api/navigator/readiness', member)).body.teams.map((t: any) => t.id)).toEqual(['golden-team-big']);
  }, 60_000);
});
