/**
 * The latest data of a team when nothing new arrived for over a day (FI-22), against the live API.
 *
 * Production's data stopped at yesterday 00:05 (no import, sample data not refreshed overnight):
 * every daily input (test coverage, code quality) was then older than its expected update
 * interval, so the QA score left them out and the overview, team detail, TV mode, compare and the
 * team rankings showed "No data" although the snapshots were there.
 *
 *   LD-001  latestReference: now while the company's newest value (its data clock) is at most a
 *           day old; the end of that value's day once it is older (pure function)
 *   LD-002  data two days old: GET /api/teams, /api/teams/:id, /api/tv/teams/:id,
 *           /api/compare/teams, /api/metrics/analytics/teams and /api/analytics/company-summary
 *           show the latest snapshot's QA score (not "no data"), with lastUpdated and dataOutdated
 *   LD-003  current data: unchanged (dataOutdated false; a daily input recorded three days ago is
 *           still stale and left out of the QA score; a team that stopped sending two days ago while
 *           another team of the company is current keeps its stale values and has no QA score)
 */
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, NEW_PW, backendUp, cookieFrom, get, localDb, post } from './helpers/http';
import { latestReference, OUTDATED_AFTER_MS } from '../../server/lib/kpiEvaluation';
import { defaultIntervals } from '../../server/lib/staleness';

let up = true;
let db: Client;
const stamp = Date.now();
let cookie = '';
let teamA = '';
let teamB = '';
let companyId = '';

const DAY = 86_400_000;
const dayIso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

async function putSnapshot(teamId: string, day: string, values: Record<string, number>, fieldSources: object = {}) {
  const cols = Object.keys(values);
  await db.query(
    `INSERT INTO kpi_snapshots (team_id, snapshot_date, ${cols.join(', ')}, field_sources)
     VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}, $${cols.length + 3}::jsonb)
     ON CONFLICT (team_id, snapshot_date) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, field_sources = EXCLUDED.field_sources`,
    [teamId, day, ...cols.map((c) => values[c]), JSON.stringify(fieldSources)],
  );
}

const VALUES = { test_coverage: 82, defect_escape_rate: 4, change_failure_rate: 6, code_quality_score: 80, automation_coverage: 72, test_flakiness_rate: 1.5 };

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  const reg = await request(API_URL).post('/api/auth/register').send({
    email: `ld-admin-${stamp}@ld${stamp}.test`, password: NEW_PW, firstName: 'Lena', lastName: 'Latest',
    companyName: `LD Company ${stamp}`, departmentName: 'Eng', teamName: `LD Team A ${stamp}`,
  });
  if (reg.status !== 201 && reg.status !== 200) throw new Error(`register: ${reg.status} ${JSON.stringify(reg.body)}`);
  cookie = cookieFrom(reg);
  companyId = reg.body.user.company_id;
  teamA = reg.body.user.primary_team_id;
  const created = await post('/api/admin/teams', cookie, { name: `LD Team B ${stamp}`, departmentId: reg.body.user.department_id });
  if (created.status !== 201) throw new Error(`create team: ${created.status} ${JSON.stringify(created.body)}`);
  teamB = created.body.id ?? created.body.team?.id;
  // The data ends two days ago (00:00 UTC of that day, no provenance): over a day old at any time of day.
  for (const t of [teamA, teamB]) {
    await putSnapshot(t, dayIso(-3), { ...VALUES, test_coverage: 80 });
    await putSnapshot(t, dayIso(-2), VALUES);
  }
}, 60_000);

afterAll(async () => {
  if (!up) return;
  await db.query('DELETE FROM kpi_snapshots WHERE team_id = ANY($1::text[])', [[teamA, teamB]]);
  await db?.end();
});

describe('Latest data shown when nothing new arrived for over a day (FI-22)', () => {
  test('LD-001 latestReference', () => {
    const intervals = defaultIntervals();
    const now = Date.parse('2026-11-19T14:00:00Z');
    const old = latestReference({ snapshot_date: '2026-11-18', test_coverage: 80, field_sources: {} }, intervals, now);
    expect(old).toEqual({ reference: Date.parse('2026-11-19T00:00:00Z'), lastUpdated: '2026-11-18T00:00:00.000Z', outdated: true });
    // Provenance: the newest recorded_at counts, not the snapshot day.
    const fresh = latestReference({
      snapshot_date: '2026-11-18', test_coverage: 80, code_quality_score: 70,
      field_sources: { test_coverage: { recorded_at: '2026-11-17T08:00:00Z' }, code_quality_score: { recorded_at: '2026-11-19T10:00:00Z' } },
    }, intervals, now);
    expect(fresh).toEqual({ reference: now, lastUpdated: '2026-11-19T10:00:00.000Z', outdated: false });
    // The company's data clock decides: another team current → this old snapshot is judged at now.
    expect(latestReference({ snapshot_date: '2026-11-17', test_coverage: 80, field_sources: {} }, intervals, now, Date.parse('2026-11-19T09:00:00Z')))
      .toEqual({ reference: now, lastUpdated: '2026-11-17T00:00:00.000Z', outdated: false });
    expect(latestReference({ snapshot_date: '2026-11-17', test_coverage: 80, field_sources: {} }, intervals, now, Date.parse('2026-11-18T00:05:00Z')))
      .toEqual({ reference: Date.parse('2026-11-19T00:00:00Z'), lastUpdated: '2026-11-17T00:00:00.000Z', outdated: true });
    const edge = latestReference({ snapshot_date: '2026-11-18', test_coverage: 80, field_sources: {} }, intervals, Date.parse('2026-11-18T00:00:00Z') + OUTDATED_AFTER_MS);
    expect(edge.outdated).toBe(false);
  });

  test('LD-002 data two days old: every current view shows the latest snapshot, flagged as outdated', async () => {
    if (!up) return;
    const lastUpdated = `${dayIso(-2)}T00:00:00.000Z`;

    const list = await get('/api/teams', cookie);
    expect(list.status).toBe(200);
    const a = list.body.teams.find((t: any) => t.id === teamA);
    expect(a).toEqual(expect.objectContaining({ dataOutdated: true, lastUpdated }));
    expect(a.qaScore).toEqual(expect.any(Number));
    expect(a.status).not.toBe('no-data');
    expect(a.qaScoreConfidence).toEqual(expect.objectContaining({ inputsUsed: 4, staleInputs: [] }));
    // The KPI values are the stored ones, not judged stale.
    expect(a.metrics.find((m: any) => m.id === 'test-coverage')).toEqual(expect.objectContaining({ value: 82, status: expect.any(String) }));

    const detail = await get(`/api/teams/${teamA}`, cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.team).toEqual(expect.objectContaining({ qaScore: a.qaScore, dataOutdated: true, lastUpdated }));

    const tv = await get(`/api/tv/teams/${teamA}`, cookie);
    expect(tv.status).toBe(200);
    expect(tv.body.latest).toEqual(expect.objectContaining({ qaScore: a.qaScore, dataOutdated: true, lastUpdated }));

    const cmp = await get(`/api/compare/teams?ids=${teamA},${teamB}`, cookie);
    expect(cmp.status).toBe(200);
    for (const t of cmp.body.teams) {
      expect(t).toEqual(expect.objectContaining({ dataOutdated: true, lastUpdated }));
      expect(t.cells.qa_score.value).toEqual(expect.any(Number));
      expect(t.cells.test_coverage.stale).toBe(false);
    }

    const rankings = await get('/api/metrics/analytics/teams', cookie);
    expect(rankings.status).toBe(200);
    const ra = (rankings.body.teams ?? rankings.body).find((t: any) => t.id === teamA);
    expect(ra).toEqual(expect.objectContaining({ qa_score: a.qaScore, data_outdated: true, test_coverage: 82 }));

    const summary = await get('/api/analytics/company-summary', cookie);
    expect(summary.status).toBe(200);
    const s = summary.body.metrics ?? summary.body;
    expect(s.globalQaScore).toEqual(expect.any(Number));
    expect(s).toEqual(expect.objectContaining({ teamsWithKpiData: 2, asOf: dayIso(-2), dataOutdated: true, lastUpdated }));
    expect(s.aiSummary).not.toMatch(/No KPI data available/);
  });

  test('LD-003 current data: unchanged, a value older than its interval is still stale', async () => {
    if (!up) return;
    const recent = new Date(Date.now() - 3_600_000).toISOString();
    const old = new Date(Date.now() - 3 * DAY).toISOString();
    const fs: Record<string, object> = {};
    for (const c of Object.keys(VALUES)) fs[c] = { source: 'api', recorded_at: recent };
    fs.code_quality_score = { source: 'api', recorded_at: old }; // daily metric, three days old
    await putSnapshot(teamA, dayIso(0), VALUES, fs);
    try {
      const list = await get('/api/teams', cookie);
      const a = list.body.teams.find((t: any) => t.id === teamA);
      expect(a.dataOutdated).toBe(false);
      expect(a.lastUpdated).toBe(new Date(Date.parse(recent)).toISOString());
      expect(a.qaScoreConfidence).toEqual(expect.objectContaining({ inputsUsed: 3, staleInputs: ['code_quality_score'] }));
      const b = list.body.teams.find((t: any) => t.id === teamB);
      expect(b).toEqual(expect.objectContaining({ dataOutdated: false, qaScore: null, status: 'no-data' }));
      expect(b.qaScoreConfidence.staleInputs).toContain('test_coverage');
      const s = (await get('/api/analytics/company-summary', cookie)).body;
      expect((s.metrics ?? s).dataOutdated).toBe(false); // team A is current
    } finally {
      await db.query('DELETE FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2', [teamA, dayIso(0)]);
    }
  });
});
