import 'dotenv/config';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb } from './helpers/http';
import { EVIDENCE_FOR_KPI, METRICS, groupOf, loadCiRange } from '../../server/lib/calc/engine';
import { computeCiDay } from '../../packages/engine/src/calc/ci';
import { computeDeliveryDays } from '../../server/lib/calc/delivery';
import { computeWorkDays } from '../../server/lib/calc/work';
import { computeQualityDays } from '../../server/lib/calc/quality';
import { KPI_CAMEL } from '../../server/lib/kpiEvaluation';
import { CALCULATED_KPI_COLUMNS, kpiColumnValue } from '../../server/seeds/demoData';

/**
 * SAMPLE-CONSIST: every number of a sample team's page agrees with itself. For every sample team (a team whose KPI
 * snapshots are sample rows and that has sample raw data: Meridian's mft-… teams in a showcase database, Northwind and
 * the filled teams in the test database) and every day of the last 30:
 *   CONSIST-01  the KPI tile value (GET /api/teams/:id, the team page's latest snapshot) and the KPI history (GET
 *               /api/teams/:id/kpi-history, the trend) equal the value QE Navigator calculated from the raw data for
 *               that day (GET /api/ci/teams/:id/metrics/:column?date=…, "How this was calculated"), as the KPI column
 *               stores it (whole numbers in integer columns), for every column the engine calculates;
 *   CONSIST-02  the evidence panels (GET /api/ci/teams/:id/evidence, /delivery, /work: "Calculated from …") and TV mode
 *               (GET /api/tv/teams/:id) show the tile's values;
 *   CONSIST-03  today's values are calculated from a full sample (at least MIN_SAMPLE runs, deploys, incidents, issues),
 *               no tile of a sample company (no real KPI anywhere in it: Meridian, Northwind) is stale, and every calculated
 *               column is labelled as calculated ("computed"), not as sample data;
 *   CONSIST-04  calculating the last 30 days again from the raw data gives the stored values (a day's sample data never
 *               changes once added, also after the nightly refresh);
 *   CONSIST-05  Business impact: each complete month's quality figures are the means of the month's KPI snapshots.
 * Runs against the live backend (API_URL) and its local database (DATABASE_URL); signs in with a token signed with
 * JWT_SECRET. SAMPLE_CHECK_COMPANIES=<id,…> limits it to some companies. Skips when no backend or sample team is there.
 */
const DAYS = 30;
/** Fewest records a value of today may be based on (single-report values: one report). */
const MIN_SAMPLE: Record<string, number> = {
  code_quality: 1, mttr: 3, mtbf: 3, availability: 3, infrastructure_failures: 3,
  // A sprint's issues: a small team closes a handful a sprint.
  velocity: 3, commitment: 3, carryover: 3, blocked_time: 3, sizing_accuracy: 3,
};
const minSample = (key: string) => MIN_SAMPLE[key] ?? 5;
/** Shown on the team page from the team (taskSizingAccuracy), not in the KPI history or TV mode. */
const NO_TREND = new Set(['sizing_accuracy']);
const tileOf = (t: any, col: string) => num(col === 'sizing_accuracy' ? t.taskSizingAccuracy : t.kpiData?.[KPI_CAMEL[col]]);

interface Problem { team: string; day: string; column: string; tile: unknown; evidence: unknown; note: string }

let up = false;
let db: Client;
const secret = process.env.JWT_SECRET;
const teams: Array<{ id: string; company: string; cookie: string; sampleCompany: boolean }> = [];
const problems: Problem[] = [];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const same = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 1e-9;

/** Run `fn` over the items, `n` at a time. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

beforeAll(async () => {
  up = !!secret && await backendUp();
  if (!up) return;
  db = await localDb();
  const only = (process.env.SAMPLE_CHECK_COMPANIES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const rows = (await db.query(
    `SELECT t.id, t.company_id,
            (SELECT u.id FROM users u WHERE u.company_id = t.company_id AND u.role = 'super_admin' AND u.is_active ORDER BY u.id LIMIT 1) AS admin,
            NOT EXISTS (SELECT 1 FROM kpi_snapshots k JOIN teams t2 ON t2.id = k.team_id WHERE t2.company_id = t.company_id AND k.id NOT LIKE 'demo-%') AS sample_company
       FROM teams t
      WHERE t.is_active AND EXISTS (SELECT 1 FROM kpi_snapshots k WHERE k.team_id = t.id AND k.id LIKE 'demo-%' AND k.snapshot_date = CURRENT_DATE)
        AND EXISTS (SELECT 1 FROM test_runs r WHERE r.team_id = t.id AND r.is_sample) AND ($1::text[] IS NULL OR t.company_id = ANY($1::text[]))
        -- (the demo sandbox only signs in through its own sessions; its data is built by the same code)
        AND t.company_id <> 'sandbox-demo'
      ORDER BY t.company_id, t.id`, [only.length ? only : null])).rows;
  for (const r of rows) {
    if (!r.admin) continue;
    teams.push({ id: r.id, company: r.company_id, sampleCompany: r.sample_company, cookie: `irongate_token=${jwt.sign({ userId: r.admin }, secret!, { expiresIn: 3600 })}` });
  }
}, 60000);

afterAll(async () => {
  // SAMPLE_CHECK_REPORT=<file>: every problem found, and a count per kind, as JSON.
  if (process.env.SAMPLE_CHECK_REPORT) {
    const byNote: Record<string, number> = {};
    for (const p of problems) byNote[p.note] = (byNote[p.note] ?? 0) + 1;
    fs.writeFileSync(process.env.SAMPLE_CHECK_REPORT, JSON.stringify({ teams: teams.map((t) => t.id), problems: problems.length, byNote, list: problems }, null, 1));
  }
  await db?.end();
});

describe(`Sample data consistency (${API_URL})`, () => {
  jest.setTimeout(900000);

  it('CONSIST-01..03: tiles, trends, evidence and TV agree for every sample team and day', async () => {
    if (!up || !teams.length) return;
    const today = iso(new Date());
    const firstDay = iso(new Date(Date.now() - (DAYS - 1) * 86_400_000));
    let compared = 0;
    for (const team of teams) {
      const t = (await get(`/api/teams/${team.id}`, team.cookie)).body.team;
      expect(t).toBeTruthy();
      const hist = (await get(`/api/teams/${team.id}/kpi-history?days=${DAYS}`, team.cookie)).body.history as Record<string, Array<{ date: string; value: number }>>;
      const add = (day: string, column: string, tile: unknown, evidence: unknown, note: string) => problems.push({ team: team.id, day, column, tile, evidence, note });

      // Today: the tile, its label, its freshness and the sample size behind it.
      for (const col of CALCULATED_KPI_COLUMNS) {
        const camel = KPI_CAMEL[col];
        const tile = tileOf(t, col);
        const ev = await get(`/api/ci/teams/${team.id}/metrics/${col}`, team.cookie);
        if (ev.status !== 200) { add(today, col, tile, ev.status, 'no calculation for the tile'); continue; }
        compared++;
        if (!same(tile, kpiColumnValue(col, ev.body.value))) add(today, col, tile, ev.body.value, 'tile ≠ calculated value');
        if (ev.body.sampleSize < minSample(EVIDENCE_FOR_KPI[col]!)) add(today, col, tile, ev.body.sampleSize, `calculated from fewer than ${minSample(EVIDENCE_FOR_KPI[col]!)}`);
        if (t.kpiFieldSources?.[col]?.source !== 'computed') add(today, col, tile, t.kpiFieldSources?.[col]?.source, 'tile not labelled as calculated');
      }
      // Freshness is judged against the company's update intervals: a sample company has the sample's (the nightly
      // refresh's cadence); a real company with some sample teams keeps its own settings, so it is not judged here.
      if (team.sampleCompany) {
        for (const [camel, s] of Object.entries((t.kpiStaleness ?? {}) as Record<string, { stale: boolean; staleSince: string | null }>)) {
          if (s?.stale) add(today, camel, t.kpiData?.[camel], s.staleSince, 'tile is stale');
        }
      }

      // Every day of the trend (the KPI history) against the calculation of that day.
      const jobs: Array<{ col: string; day: string; value: number | null }> = [];
      for (const col of CALCULATED_KPI_COLUMNS) {
        for (const p of hist?.[col] ?? []) {
          const day = String(p.date).slice(0, 10);
          if (day >= firstDay) jobs.push({ col, day, value: num(p.value) });
        }
        if (!NO_TREND.has(col) && !(hist?.[col] ?? []).some((p) => String(p.date).slice(0, 10) === today)) add(today, col, null, null, 'no trend point for today');
      }
      // Every point against the evidence row the endpoint serves (the latest day on or before it), read from the database;
      // the endpoint itself for the first and the middle day of the window (the rest would cost thousands of requests and
      // the API's rate limit is shared with the other suites).
      const evRows = (await db.query(
        `SELECT metric_key, day::text AS day, value::float8 AS value FROM metric_evidence WHERE team_id = $1 AND day <= CURRENT_DATE ORDER BY metric_key, day`,
        [team.id])).rows as Array<{ metric_key: string; day: string; value: number }>;
      const evOn = (key: string, day: string) => {
        let found: number | null = null;
        for (const r of evRows) if (r.metric_key === key && r.day <= day) found = r.value;
        return found;
      };
      const viaApi = new Set([firstDay, iso(new Date(Date.now() - Math.floor(DAYS / 2) * 86_400_000))]);
      await pool(jobs, 4, async ({ col, day, value }) => {
        compared++;
        const stored = evOn(EVIDENCE_FOR_KPI[col]!, day);
        if (stored === null) add(day, col, value, null, 'no calculation for the trend point');
        else if (!same(value, kpiColumnValue(col, stored))) add(day, col, value, stored, 'trend ≠ calculated value');
        if (!viaApi.has(day)) return;
        const ev = await get(`/api/ci/teams/${team.id}/metrics/${col}?date=${day}`, team.cookie);
        if (ev.status !== 200) add(day, col, value, ev.status, 'no calculation for the trend point (API)');
        else if (!same(value, kpiColumnValue(col, ev.body.value))) add(day, col, value, ev.body.value, 'trend ≠ calculated value (API)');
      });

      // The evidence panels ("Calculated from CI data", deliveries, work and code quality) and TV mode.
      const panels = [
        ...((await get(`/api/ci/teams/${team.id}/evidence`, team.cookie)).body.metrics ?? []),
        ...((await get(`/api/ci/teams/${team.id}/delivery`, team.cookie)).body.metrics ?? []),
        ...((await get(`/api/ci/teams/${team.id}/work`, team.cookie)).body.metrics ?? []),
      ] as Array<{ key: string; value: number; sampleSize: number }>;
      const byKey = new Map(panels.map((m) => [m.key, m]));
      const tv = (await get(`/api/tv/teams/${team.id}`, team.cookie)).body.latest;
      for (const col of CALCULATED_KPI_COLUMNS) {
        const camel = KPI_CAMEL[col];
        const tile = tileOf(t, col);
        const m = byKey.get(EVIDENCE_FOR_KPI[col]!);
        if (!m) add(today, col, tile, null, 'not in the evidence panel');
        else if (!same(tile, kpiColumnValue(col, m.value))) add(today, col, tile, m.value, 'evidence panel ≠ tile');
        if (!NO_TREND.has(col) && !same(num(tv?.kpiData?.[camel]), tile)) add(today, col, tile, tv?.kpiData?.[camel], 'TV ≠ tile');
      }
    }
    expect(compared).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it('CONSIST-04: the stored values are what the engine calculates from the raw data again', async () => {
    if (!up || !teams.length) return;
    const days: string[] = [];
    for (let i = DAYS; i >= 1; i--) days.push(iso(new Date(Date.now() - i * 86_400_000)));
    const found: Problem[] = [];
    const c = db as unknown as import('pg').PoolClient;
    for (const team of teams) {
      const stored = new Map((await db.query(
        `SELECT day::text || '|' || metric_key AS k, value::float8 AS v FROM metric_evidence WHERE team_id = $1 AND day BETWEEN $2::date AND $3::date`,
        [team.id, days[0], days[days.length - 1]])).rows.map((r) => [r.k, Number(r.v)]));
      const ci = await loadCiRange(c, team.id, days[0], days[days.length - 1]);
      const groups = [await computeDeliveryDays(c, team.id, days), await computeWorkDays(c, team.id, days), await computeQualityDays(c, team.id, days)];
      for (const day of days) {
        for (const m of [...computeCiDay(day, ci), ...groups.flatMap((g) => g.get(day) ?? [])]) {
          if (!METRICS[m.key]?.kpi && groupOf(m.key) === 'ci' && m.key !== 'pipeline_success_rate') continue;
          const v = stored.get(`${day}|${m.key}`);
          if (v === undefined || Math.abs(v - m.value) > 1e-9) found.push({ team: team.id, day, column: m.key, tile: v ?? null, evidence: m.value, note: 'stored ≠ recalculated' });
        }
      }
    }
    problems.push(...found);
    expect(found).toEqual([]);
  });

  it('CONSIST-05: Business impact months are the means of the KPI snapshots', async () => {
    if (!up || !teams.length) return;
    const rows = (await db.query(
      `SELECT q.team_id, q.month_year, q.test_coverage::float8 AS q_cov, q.change_failure_rate::float8 AS q_cfr, q.mttr_hours::float8 AS q_mttr,
              round(avg(k.test_coverage)::numeric, 2)::float8 AS k_cov, round(avg(k.change_failure_rate)::numeric, 2)::float8 AS k_cfr, round(avg(k.mttr_hours)::numeric, 2)::float8 AS k_mttr,
              COUNT(*)::int AS n
         FROM business_impact_quality_metrics q JOIN kpi_snapshots k ON k.team_id = q.team_id AND to_char(k.snapshot_date, 'YYYY-MM') = q.month_year
        WHERE q.team_id = ANY($1::text[]) AND q.id LIKE 'demo-%' AND q.month_year < to_char(CURRENT_DATE, 'YYYY-MM')
        GROUP BY q.team_id, q.month_year, q.test_coverage, q.change_failure_rate, q.mttr_hours
       HAVING COUNT(*) = extract(day FROM (to_date(q.month_year, 'YYYY-MM') + interval '1 month - 1 day'))`, [teams.map((t) => t.id)])).rows;
    const found: Problem[] = [];
    for (const r of rows) {
      for (const [a, b, col] of [[r.q_cov, r.k_cov, 'test_coverage'], [r.q_cfr, r.k_cfr, 'change_failure_rate'], [r.q_mttr, r.k_mttr, 'mttr_hours']] as const) {
        if (Math.abs(a - b) > 0.011) found.push({ team: r.team_id, day: r.month_year, column: col, tile: b, evidence: a, note: 'business impact month ≠ mean of the KPIs' });
      }
    }
    problems.push(...found);
    expect(rows.length).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});
