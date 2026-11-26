/**
 * Collection frequency (server/routes/collection.ts, server/lib/collectionSchedule.ts): how often the Exporter
 * reads each kind of data, per team. Needs the API and the database.
 *
 *   COL-01  signed-in users only; a team without a schedule shows the default (15 minutes) and is not "configured";
 *           the recommendation per release cadence is returned for the form
 *   COL-02  a super admin saves a cadence and intervals; they are returned, audited, and can be changed later
 *   COL-03  unknown groups and intervals outside 15 minutes … 30 days are refused; a team member cannot change it
 *   COL-04  the Exporter receives the schedule with its context
 *   COL-05  a value is not stale just because the team collects it less often (intervalsForTeam)
 *   COL-06  the onboarding step "Choose how often data is collected" is done once a team has a schedule
 */
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post, put } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';
import { intervalsForTeam, loadIntervals } from '../../server/lib/staleness';
import { RECOMMENDED, intervalText } from '../../server/lib/collectionSchedule';

const TEAM = 'golden-team-small';
let up = true;
let db: Client;
let admin = '';

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running - collection schedule tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
}, 120_000);
afterAll(async () => { if (db) { await removeGolden(db); await db.end(); } });

describe('collection frequency', () => {
  it('COL-01 defaults and recommendations', async () => {
    if (!up) return;
    expect((await get('/api/collection-schedule')).status).toBe(401);
    const res = await get('/api/collection-schedule', admin);
    expect(res.status).toBe(200);
    expect(res.body.defaultMinutes).toBe(15);
    expect(res.body.groups.map((g: any) => g.key)).toEqual(['ci', 'delivery', 'work', 'quality', 'automation', 'people']);
    expect(res.body.cadences.map((c: any) => c.key)).toEqual(['continuous', 'weekly', 'biweekly', 'monthly']);
    expect(res.body.recommended).toEqual(RECOMMENDED);
    // Incidents and deployments are never recommended less often than hourly, whatever the release rhythm.
    for (const c of Object.values(RECOMMENDED)) expect(c.delivery).toBeLessThanOrEqual(60);
    const t = res.body.teams.find((x: any) => x.id === TEAM);
    expect(t).toMatchObject({ configured: false, cadence: null, canEdit: true, intervals: { ci: 15, delivery: 15, work: 15, quality: 15, automation: 15, people: 15 } });
    expect(intervalText(15)).toBe('every 15 minutes');
    expect(intervalText(1440)).toBe('once a day');
  });

  it('COL-02 save, read back, change later', async () => {
    if (!up) return;
    const saved = await put(`/api/collection-schedule/teams/${TEAM}`, admin, { cadence: 'monthly', intervals: RECOMMENDED.monthly });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ id: TEAM, cadence: 'monthly', configured: true, intervals: RECOMMENDED.monthly });
    const t = (await get('/api/collection-schedule', admin)).body.teams.find((x: any) => x.id === TEAM);
    expect(t).toMatchObject({ configured: true, cadence: 'monthly', intervals: { ci: 1440, delivery: 60, work: 1440 } });
    // Later: one interval changed, the others kept.
    expect((await put(`/api/collection-schedule/teams/${TEAM}`, admin, { intervals: { ci: 240 } })).body.intervals).toMatchObject({ ci: 240, work: 1440 });
    const audit = await db.query(`SELECT summary FROM audit_log WHERE company_id = $1 AND action = 'collection.schedule' ORDER BY created_at DESC LIMIT 1`, [GOLDEN_COMPANY]);
    expect(audit.rows[0].summary).toContain('ci every 4 hours');
  });

  it('COL-03 refusals', async () => {
    if (!up) return;
    for (const intervals of [{ pipelines: 60 }, { ci: 5 }, { ci: 50_000 }, { ci: 60.5 }, { ci: '60' }]) {
      expect((await put(`/api/collection-schedule/teams/${TEAM}`, admin, { intervals })).status).toBe(400);
    }
    expect((await put(`/api/collection-schedule/teams/${TEAM}`, admin, { cadence: 'yearly', intervals: {} })).status).toBe(400);
    expect((await put('/api/collection-schedule/teams/no-such-team', admin, { intervals: { ci: 60 } })).status).toBe(403);
    const member = (await login('big-2@golden.example')).cookie;
    expect((await put('/api/collection-schedule/teams/golden-team-big', member, { intervals: { ci: 60 } })).status).toBe(403);
    expect((await get('/api/collection-schedule', member)).body.teams).toEqual([expect.objectContaining({ id: 'golden-team-big', canEdit: false })]);
  });

  it('COL-04 the Exporter gets the schedule with its context', async () => {
    if (!up) return;
    const key = (await post('/api/admin/api-keys', admin, { name: 'Schedule test key', scope: 'exporter' })).body.plaintextKey;
    const ctx = await request(API_URL).get('/api/ingest/exporter/context').set('Authorization', `Bearer ${key}`);
    expect(ctx.status).toBe(200);
    expect(ctx.body.schedule).toEqual({ defaultMinutes: 15, teams: { [TEAM]: { ...RECOMMENDED.monthly, ci: 240 } } });
  });

  it('COL-05 a slower collection is not stale data', async () => {
    if (!up) return;
    const intervals = await loadIntervals(GOLDEN_COMPANY);
    const base = intervals.avg_build_time_minutes;
    // ci every 4 hours → expected no sooner than 8 hours (twice the interval); a team without a schedule is unchanged.
    expect(intervalsForTeam(intervals, TEAM).avg_build_time_minutes).toBe(Math.max(base, 240 * 60_000 * 2));
    expect(intervalsForTeam(intervals, 'golden-team-big')).toBe(intervals);
    expect(Object.keys(intervals)).not.toContain('teamSchedules');
  });

  it('COL-06 the onboarding step is done', async () => {
    if (!up) return;
    const step = (await get('/api/onboarding', admin)).body.steps.find((s: any) => s.key === 'collection');
    expect(step).toMatchObject({ done: true, count: 1, view: 'metric-intervals' });
  });
});
