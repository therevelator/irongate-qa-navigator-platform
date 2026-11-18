/**
 * The QA score is computed in Postgres (public.compute_qa_score / qa_status_from_score,
 * applied by the kpi_snapshots_qa_score trigger). These tests prove the SQL gives exactly
 * the same result as computeQaScore() in server/lib/metricFormulas.ts.
 *
 * Runs against DATABASE_URL from .env (local only — refuses any other host).
 * Requires supabase/migrations/20261117000000_kpi_integrity_and_ingestion.sql to be applied.
 * Writes nothing: trigger checks run inside a transaction that is rolled back.
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import { computeQaScore, qaScoreComposite, qaStatusFromScore, QA_SCORE_INPUTS } from '../../server/lib/metricFormulas';

dotenv.config();

function localConfig() {
  const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`Refusing to run against non-local database host ${url.hostname}`);
  }
  return {
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
}

type Case = [string | null, string | null, string | null, string | null];

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCases(): Case[] {
  const cases: Case[] = [];
  // Grid: nulls, 0, threshold boundaries, 100, out-of-range values (clamping).
  const cov = [null, '0', '0.01', '50', '69.49', '69.5', '70', '84.49', '84.5', '85', '99.99', '100', '-5', '150'];
  const esc = [null, '0', '0.01', '12.34', '15', '30', '50', '99.99', '100', '-10', '120'];
  const cfr = [null, '0', '0.5', '15', '15.5', '30.01', '100', '130'];
  const cq = [null, '0', '69', '70', '84', '85', '100', '-1', '101'];
  for (const a of cov) for (const b of esc) for (const c of cfr) for (const d of cq) cases.push([a, b, c, d]);

  // Random 2-decimal inputs (as stored in numeric(5,2) / integer columns), with some nulls.
  const rnd = mulberry32(20261117);
  const r2 = (max: number) => (Math.round(rnd() * max * 100) / 100).toFixed(2);
  for (let i = 0; i < 20000; i++) {
    const maybe = (v: string) => (rnd() < 0.15 ? null : v);
    cases.push([maybe(r2(100)), maybe(r2(100)), maybe(r2(100)), maybe(String(Math.floor(rnd() * 101)))]);
  }

  // Inputs that land on or next to .5 of the final score (rounding direction).
  for (let s = 0; s <= 100; s += 0.5) {
    const v = s.toFixed(2);
    cases.push([v, null, null, v.split('.')[0]]);
    cases.push([v, (100 - s).toFixed(2), null, null]);
    cases.push([v, (100 - s).toFixed(2), (100 - s).toFixed(2), null]);
  }
  return cases;
}

describe('QA score: SQL function matches computeQaScore()', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client(localConfig());
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('QA-SQL-001: compute_qa_score / qa_status_from_score equal the TypeScript formula on every case', async () => {
    const cases = buildCases();
    const { rows } = await client.query(
      `SELECT t.i, public.compute_qa_score(t.cov, t.esc, t.cfr, t.cq) AS score,
              public.qa_status_from_score(public.compute_qa_score(t.cov, t.esc, t.cfr, t.cq)) AS status
         FROM unnest($1::int[], $2::numeric[], $3::numeric[], $4::numeric[], $5::numeric[]) AS t(i, cov, esc, cfr, cq)
        ORDER BY t.i`,
      [
        cases.map((_, i) => i),
        cases.map((c) => c[0]),
        cases.map((c) => c[1]),
        cases.map((c) => c[2]),
        cases.map((c) => c[3]),
      ]
    );
    expect(rows).toHaveLength(cases.length);

    const mismatches: string[] = [];
    rows.forEach((r: any) => {
      const [cov, esc, cfr, cq] = cases[r.i];
      const ts = computeQaScore({ test_coverage: cov, defect_escape_rate: esc, change_failure_rate: cfr, code_quality_score: cq });
      if (ts.score !== r.score || ts.status !== r.status) {
        mismatches.push(`${JSON.stringify(cases[r.i])}: ts=${ts.score}/${ts.status} sql=${r.score}/${r.status}`);
      }
    });
    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  it('QA-SQL-002: specific rules (nulls, minimum inputs, clamping, rounding, thresholds)', async () => {
    const one = async (cov: any, esc: any, cfr: any, cq: any) =>
      (await client.query('SELECT public.compute_qa_score($1, $2, $3, $4) AS s', [cov, esc, cfr, cq])).rows[0].s;
    expect(await one(null, 0, 0, 100)).toBeNull();            // coverage required
    expect(await one(90, null, null, null)).toBeNull();        // at least 2 inputs
    expect(await one(0, 100, 100, 0)).toBe(0);                 // all zero terms is a real 0, not "missing"
    expect(await one(100, 0, 0, 100)).toBe(100);
    expect(await one(150, -10, null, null)).toBe(100);         // terms clamped to 0..100
    expect(await one(80, 10, null, null)).toBe(85);            // (80×0.30 + 90×0.25) ÷ 0.55 = 84.545… → 85
    for (const s of [null, 0, 69, 70, 84, 85, 100]) {
      const { rows } = await client.query('SELECT public.qa_status_from_score($1) AS st', [s]);
      expect(rows[0].st).toBe(qaStatusFromScore(s));
    }
  });

  it('QA-SQL-003: the trigger overrides any qa_score/status written by the app', async () => {
    const { rows: teams } = await client.query('SELECT id FROM teams LIMIT 1');
    if (teams.length === 0) return; // empty database: nothing to attach a snapshot to
    await client.query('BEGIN');
    try {
      const { rows } = await client.query(
        `INSERT INTO kpi_snapshots (team_id, snapshot_date, test_coverage, defect_escape_rate, change_failure_rate, code_quality_score, qa_score, status)
         VALUES ($1, DATE '1900-01-01', 80, 10, NULL, NULL, 1, 'critical')
         RETURNING qa_score, status`,
        [teams[0].id]
      );
      expect(rows[0]).toEqual({ qa_score: 85, status: 'good' });
      const { rows: upd } = await client.query(
        `UPDATE kpi_snapshots SET code_quality_score = 0, qa_score = 99, status = 'good'
          WHERE team_id = $1 AND snapshot_date = DATE '1900-01-01' RETURNING qa_score, status`,
        [teams[0].id]
      );
      const expected = computeQaScore({ test_coverage: 80, defect_escape_rate: 10, code_quality_score: 0 });
      expect(upd[0]).toEqual({ qa_score: expected.score, status: expected.status });
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('QA-SQL-005: stale inputs left out (qaScoreComposite) equal the SQL function with those inputs missing, on every case and stale combination', async () => {
    // The grid part of buildCases() (every boundary) plus 2,000 random cases, each with all 16
    // combinations of stale inputs: excluding a stale input must be exactly "not recorded" in both.
    const base = buildCases();
    const cases = [...base.slice(0, 14 * 11 * 8 * 9), ...base.slice(14 * 11 * 8 * 9, 14 * 11 * 8 * 9 + 2000)];
    const rows: Array<{ c: Case; mask: number }> = [];
    for (const c of cases) for (let mask = 0; mask < 16; mask++) rows.push({ c, mask });
    const nulled = (r: { c: Case; mask: number }, i: number) => ((r.mask >> i) & 1 ? null : r.c[i]);
    const { rows: sql } = await client.query(
      `SELECT t.i, public.compute_qa_score(t.cov, t.esc, t.cfr, t.cq) AS score
         FROM unnest($1::int[], $2::numeric[], $3::numeric[], $4::numeric[], $5::numeric[]) AS t(i, cov, esc, cfr, cq)
        ORDER BY t.i`,
      [rows.map((_, i) => i), rows.map((r) => nulled(r, 0)), rows.map((r) => nulled(r, 1)), rows.map((r) => nulled(r, 2)), rows.map((r) => nulled(r, 3))]
    );
    expect(sql).toHaveLength(rows.length);
    const mismatches: string[] = [];
    sql.forEach((r: any) => {
      const { c, mask } = rows[r.i];
      const stale = QA_SCORE_INPUTS.filter((_, i) => (mask >> i) & 1);
      const comp = qaScoreComposite({ test_coverage: c[0], defect_escape_rate: c[1], change_failure_rate: c[2], code_quality_score: c[3] }, stale);
      if (comp.value !== r.score || comp.status !== qaStatusFromScore(r.score)) {
        mismatches.push(`${JSON.stringify(c)} stale=${stale.join(',')}: ts=${comp.value} sql=${r.score}`);
      }
      // inputsUsed counts recorded, non-stale inputs.
      const used = c.filter((v, i) => v !== null && !((mask >> i) & 1)).length;
      if (comp.inputsUsed !== used || comp.inputsTotal !== 4) mismatches.push(`${JSON.stringify(c)} mask=${mask}: inputsUsed ${comp.inputsUsed} != ${used}`);
    });
    expect(mismatches.slice(0, 10)).toEqual([]);
    // With nothing stale it is computeQaScore() itself.
    for (const c of cases.slice(0, 500)) {
      const row = { test_coverage: c[0], defect_escape_rate: c[1], change_failure_rate: c[2], code_quality_score: c[3] };
      expect(qaScoreComposite(row).value).toBe(computeQaScore(row).score);
    }
  });

  it('QA-SQL-004: every stored snapshot matches computeQaScore() of its own inputs', async () => {
    const { rows } = await client.query(
      'SELECT id, test_coverage, defect_escape_rate, change_failure_rate, code_quality_score, qa_score, status FROM kpi_snapshots'
    );
    const drift = rows.filter((r: any) => {
      const ts = computeQaScore(r);
      return ts.score !== r.qa_score || ts.status !== r.status;
    });
    expect(drift.map((r: any) => r.id)).toEqual([]);
  });
});
