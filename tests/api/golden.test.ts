import fs from 'fs';
import path from 'path';
import type { Client } from 'pg';
import { backendUp, get, localDb, login } from './helpers/http';
import { createGolden, removeGolden, normaliseDates, GOLDEN_ADMIN_EMAIL, GOLDEN_TEAMS } from './helpers/goldenFixture';

/**
 * Golden outputs of every number the app derives from team KPIs, for a fixed dataset
 * (tests/api/helpers/goldenFixture.ts): the company summary, GET /api/teams (kpiData, qaScore),
 * team detail, KPI history and the TV payload.
 *
 * tests/api/golden/baseline.json was recorded with the code BEFORE metric storage changed
 * (GOLDEN_RECORD=1). Runs against a live backend at API_URL; skips cleanly when none is running.
 */

const GOLDEN_DIR = path.join(__dirname, 'golden');
const BASELINE = path.join(GOLDEN_DIR, 'baseline.json');

export async function collectGoldenOutputs(cookie: string, today: string) {
  const ids = GOLDEN_TEAMS.filter((t) => t !== 'golden-team-inactive');
  const summary = (await get('/api/analytics/company-summary', cookie)).body;
  const teamsRes = (await get('/api/teams', cookie)).body;
  const teams: Record<string, unknown> = {};
  // updated_at of a team row is the wall-clock time the fixture was written: not an output.
  for (const t of teamsRes.teams ?? []) { delete t.updated_at; teams[t.id] = t; }
  const detail: Record<string, unknown> = {};
  const history: Record<string, unknown> = {};
  const tv: Record<string, unknown> = {};
  for (const id of ids) {
    const d = (await get(`/api/teams/${id}`, cookie)).body.team;
    if (d) delete d.updated_at;
    detail[id] = d;
    history[id] = (await get(`/api/teams/${id}/kpi-history?days=30`, cookie)).body;
    const tvBody = (await get(`/api/tv/teams/${id}`, cookie)).body;
    delete tvBody.generatedAt;
    tv[id] = tvBody;
  }
  return normaliseDates({ summary, teams, detail, history, tv }, today) as any;
}

describe('Golden outputs for a fixed dataset', () => {
  let db: Client;
  let up = true;
  let cookie = '';
  let today = '';

  beforeAll(async () => {
    up = await backendUp();
    if (!up) return;
    db = await localDb();
    await createGolden(db);
    today = (await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
    cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  });

  afterAll(async () => {
    if (db) {
      await removeGolden(db);
      await db.end();
    }
  });

  it('GOLD-001: records or matches the baseline outputs', async () => {
    if (!up) return;
    expect(cookie).not.toBe('');
    const outputs = await collectGoldenOutputs(cookie, today);
    if (process.env.GOLDEN_RECORD === '1') {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      fs.writeFileSync(BASELINE, JSON.stringify(outputs, null, 2) + '\n');
      return;
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    expect(outputs).toEqual(baseline);
  });
});
