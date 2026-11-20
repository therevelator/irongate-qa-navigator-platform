/**
 * Sample (demo) raw CI data for v2 phase 1: test runs with per-test results, coverage reports with
 * per-file coverage, and pipeline runs with stages, for the last RAW_SAMPLE_DAYS days, consistent
 * with each team's story (its health: a healthier team has higher coverage, fewer flaky tests,
 * faster and greener pipelines). The evidence views (team page → Evidence from CI) show them.
 *
 * Plain SQL (generate_series, deterministic pseudo-random values from md5), so the statements are
 * small, fast on the database and can be run on their own in a SQL console (the live Meridian
 * script). Rows are sample rows: ids start with "demo-raw-", is_sample = true, so they are removed
 * with the other sample data and never written to the KPI storage (the calculation engine only
 * records their evidence). Idempotent: rows that exist are skipped, so a daily run adds the new
 * day only. A team that has real raw data (is_sample = false) gets none.
 */
import type pg from 'pg';
import { createHash } from 'crypto';
import { recomputeTeamDays } from '../lib/calc/engine';

export const RAW_SAMPLE_DAYS = 14;
export const RAW_SAMPLE_PREFIX = 'demo-raw-';

export interface RawSampleTeam {
  id: string;
  companyId: string;
  name: string;
  /** Health 0..1 per day offset (index 0 = today), from the team's story. */
  health: number[];
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const arr = (xs: string[]) => `ARRAY[${xs.map(lit).join(', ')}]`;
/** Uniform [0, 1) from an md5 of the seed expression. */
const R = (seed: string) => `((('x' || substr(md5(${seed}), 1, 8))::bit(32)::int::bigint & 2147483647)::float8 / 2147483647.0)`;
const short = (id: string) => createHash('md5').update(id).digest('hex').slice(0, 8);

interface Vocabulary { suites: string[]; areas: string[]; verbs: string[]; objects: string[] }

/** Test and file names that fit the team (payments, lending, mobile, …). */
export function vocabularyFor(name: string): Vocabulary {
  const n = name.toLowerCase();
  const verbs = ['creates', 'rejects', 'updates', 'cancels', 'retries', 'validates', 'lists', 'exports', 'locks', 'refunds', 'schedules', 'notifies'];
  if (/pay|ledger|settle|card|billing/.test(n)) {
    return { suites: ['payments', 'ledger', 'settlement', 'fx-rates', 'card-auth'], areas: ['payments', 'ledger', 'settlement', 'fx', 'cards', 'webhooks'], verbs,
      objects: ['a card payment', 'a SEPA transfer', 'a refund', 'a ledger entry', 'a settlement batch', 'an FX quote', 'a chargeback', 'a payout', 'a payment intent', 'an authorisation hold', 'a merchant fee', 'a daily statement', 'a duplicate payment', 'a currency conversion'] };
  }
  if (/lend|loan|credit|mortgage/.test(n)) {
    return { suites: ['loan-application', 'credit-check', 'underwriting', 'offers', 'repayments'], areas: ['application', 'credit', 'underwriting', 'offers', 'repayments', 'documents'], verbs,
      objects: ['a loan application', 'a credit score request', 'an affordability check', 'a loan offer', 'a repayment plan', 'an early repayment', 'a document upload', 'a co-applicant', 'an income proof', 'a rate quote', 'a decision letter', 'a direct debit', 'a missed payment', 'a top-up loan'] };
  }
  if (/mobile|app|ios|android/.test(n)) {
    return { suites: ['login', 'biometrics', 'push-notifications', 'statements', 'cards-screen'], areas: ['login', 'biometrics', 'notifications', 'statements', 'cards', 'navigation'], verbs,
      objects: ['a biometric login', 'a PIN reset', 'a push notification', 'a statement download', 'a card freeze', 'a dark-mode screen', 'an offline banner', 'a deep link', 'a session timeout', 'a contact payment', 'an app update prompt', 'a spending chart', 'a QR payment', 'a device binding'] };
  }
  return { suites: ['api', 'auth', 'accounts', 'search', 'notifications'], areas: ['api', 'auth', 'accounts', 'search', 'notifications', 'reports'], verbs,
    objects: ['a user session', 'an account', 'a search query', 'a notification', 'a report export', 'a password reset', 'an audit entry', 'a webhook', 'a file upload', 'a permission change', 'a settings update', 'an invitation', 'a scheduled job', 'a rate limit'] };
}

/** The SQL statements that add the sample raw data of one team (run in order). */
export function rawSampleSqlForTeam(team: RawSampleTeam, days = RAW_SAMPLE_DAYS): string[] {
  const T = lit(team.id);
  const CO = lit(team.companyId);
  const K = short(team.id);
  const v = vocabularyFor(team.name);
  const healths = Array.from({ length: days }, (_, d) => Math.max(0.04, Math.min(0.98, team.health[d] ?? team.health[team.health.length - 1] ?? 0.6)));
  const P = `p(d, h) AS (VALUES ${healths.map((h, d) => `(${d}, ${h.toFixed(3)}::float8)`).join(', ')})`;
  const TODAY = `(now() AT TIME ZONE 'UTC')::date`;
  const AT = (dateExpr: string, minutes: string) => `((${dateExpr})::timestamp + make_interval(mins => ${minutes})) AT TIME ZONE 'UTC'`;
  const noReal = (table: string) => `NOT EXISTS (SELECT 1 FROM ${table} WHERE team_id = ${T} AND NOT is_sample)`;
  const N = `(48 + floor(${R(`${T} || 'n'`)} * 33))::int`; // tests in the suite: 48..80

  return [
    // 1. Test runs: three commits a day on main; a rerun (attempt 2) of a commit now and then.
    `WITH ${P}, runs AS (
       SELECT p.d, p.h, c.c, a.a, (${TODAY} - p.d) AS day,
              ${AT(`${TODAY} - p.d`, `(7 * 60 + c.c * 240 + (a.a - 1) * 25 + floor(${R(`${T} || (${TODAY} - p.d)::text || c.c::text`)} * 50))::int`)} AS ts
         FROM p, generate_series(0, 2) AS c(c), generate_series(1, 2) AS a(a)
        WHERE a.a = 1 OR ${R(`${T} || (${TODAY} - p.d)::text || c.c::text || 'rerun'`)} < 0.15 + 0.6 * (1 - p.h))
     INSERT INTO test_runs (id, company_id, team_id, format, commit_sha, branch, run_id, attempt, started_at, day, total, passed, failed, errored, skipped, duration_ms, tests_duration_ms, is_sample, created_at)
     SELECT '${RAW_SAMPLE_PREFIX}tr-${K}-' || to_char(day, 'YYYYMMDD') || '-' || c || '-' || a, ${CO}, ${T}, 'junit',
            substr(md5(${T} || day::text || c::text), 1, 12), 'main', 'ci-' || to_char(day, 'YYYYMMDD') || '-' || (c + 1), a, ts, (ts AT TIME ZONE 'UTC')::date,
            0, 0, 0, 0, 0, 0, 0, TRUE, ts
       FROM runs WHERE ts <= now() - interval '15 minutes' AND ${noReal('test_runs')}
     ON CONFLICT (id) DO NOTHING`,

    // 2. Per-test results: flaky tests fail on a first attempt now and then; a weaker team has more of
    //    them and some genuinely failing tests; one skipped test; a few slow tests.
    `WITH ${P}, s AS (SELECT ${arr(v.suites)} AS suites, ${arr(v.verbs)} AS verbs, ${arr(v.objects)} AS objects, ${N} AS n),
          runs AS (
            SELECT tr.id, tr.attempt, tr.day, tr.commit_sha, p.h,
                   greatest(1, round(s.n * (0.01 + 0.09 * (1 - p.h))))::int AS nf,
                   round(s.n * 0.06 * (1 - p.h))::int AS ng
              FROM test_runs tr JOIN p ON p.d = (${TODAY} - tr.day), s
             WHERE tr.team_id = ${T} AND tr.id LIKE '${RAW_SAMPLE_PREFIX}tr-${K}-%'
               AND NOT EXISTS (SELECT 1 FROM test_results r WHERE r.test_run_id = tr.id))
     INSERT INTO test_results (id, test_run_id, team_id, test_key, suite, name, status, duration_ms, retries, failure_hash, failure_message)
     SELECT '${RAW_SAMPLE_PREFIX}r-' || substr(md5(x.id || x.i::text), 1, 25), x.id, ${T}, md5(x.suite || '|' || x.name), x.suite, x.name, x.status, x.dur, 0,
            CASE WHEN x.status = 'failed' THEN substr(md5(x.msg), 1, 16) END, CASE WHEN x.status = 'failed' THEN x.msg END
       FROM (
         SELECT runs.id, i, 'src/' || s.suites[1 + i % 5] || '/' || s.suites[1 + i % 5] || '.test.ts' AS suite,
                s.verbs[1 + (7 * i) % 12] || ' ' || s.objects[1 + (3 * i) % 14] AS name,
                CASE WHEN i = s.n THEN 'skipped'
                     WHEN i <= runs.nf AND runs.attempt = 1 AND ${R(`runs.id || i::text`)} < 0.06 + 0.14 * (1 - runs.h) THEN 'failed'
                     WHEN i > runs.nf AND i <= runs.nf + runs.ng AND ${R(`runs.commit_sha || i::text || 'g'`)} < 0.3 * (1 - runs.h) THEN 'failed'
                     ELSE 'passed' END AS status,
                CASE WHEN i <= runs.nf THEN 'TimeoutError: waited 5000 ms for "' || s.objects[1 + (3 * i) % 14] || '" to be ready'
                     ELSE 'AssertionError: expected status 200 but was 500 (' || s.verbs[1 + (7 * i) % 12] || ' ' || s.objects[1 + (3 * i) % 14] || ')' END AS msg,
                round((40 + 18000 * power(${R(`${T} || i::text || 'dur'`)}, 5)) * (0.8 + 0.4 * ${R(`runs.id || i::text || 'j'`)}))::int AS dur
           FROM runs, s, generate_series(1, s.n) AS i
       ) x
     ON CONFLICT (id) DO NOTHING`,

    // 3. Run totals from the results.
    `UPDATE test_runs tr SET total = x.total, passed = x.passed, failed = x.failed, skipped = x.skipped, tests_duration_ms = x.dur, duration_ms = round(x.dur * 1.08)
       FROM (SELECT test_run_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'passed')::int AS passed,
                    COUNT(*) FILTER (WHERE status = 'failed')::int AS failed, COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped, SUM(duration_ms)::bigint AS dur
               FROM test_results WHERE team_id = ${T} AND test_run_id LIKE '${RAW_SAMPLE_PREFIX}tr-${K}-%' GROUP BY test_run_id) x
      WHERE tr.id = x.test_run_id AND tr.total = 0`,

    // 4. A coverage report per day (the day's last commit on main), coverage following the story.
    `WITH ${P}, d AS (SELECT p.d, p.h, (${TODAY} - p.d) AS day, ${AT(`${TODAY} - p.d`, `(16 * 60 + 40)`)} AS ts FROM p)
     INSERT INTO coverage_reports (id, company_id, team_id, format, commit_sha, branch, run_id, attempt, created_at, day, is_sample)
     SELECT '${RAW_SAMPLE_PREFIX}cov-${K}-' || to_char(day, 'YYYYMMDD'), ${CO}, ${T}, 'lcov', substr(md5(${T} || day::text || '2'), 1, 12), 'main',
            'ci-' || to_char(day, 'YYYYMMDD') || '-3', 1, ts, day, TRUE
       FROM d WHERE ts <= now() - interval '15 minutes' AND ${noReal('coverage_reports')}
     ON CONFLICT (id) DO NOTHING`,

    // 5. Per-file coverage: most files near the team's level, a few weak ones.
    `WITH ${P}, s AS (SELECT ${arr(v.areas)} AS areas, ARRAY['service', 'controller', 'repository', 'validator', 'mapper', 'client', 'handler', 'utils'] AS kinds)
     INSERT INTO coverage_files (id, report_id, team_id, path, lines_found, lines_hit, branches_found, branches_hit)
     SELECT '${RAW_SAMPLE_PREFIX}cf-' || substr(md5(x.rid || x.j::text), 1, 24), x.rid, ${T}, x.path, x.lf, round(x.lf * x.q)::int, x.bf, round(x.bf * x.q * 0.92)::int
       FROM (
         SELECT r.id AS rid, j, 'src/' || s.areas[1 + j % 6] || '/' || s.kinds[1 + (5 * j) % 8] || '.ts' AS path,
                (40 + floor(360 * ${R(`${T} || j::text || 'size'`)}))::int AS lf, (6 + floor(50 * ${R(`${T} || j::text || 'br'`)}))::int AS bf,
                least(1.0, greatest(0.04, (0.52 + 0.38 * p.h) + (${R(`${T} || j::text || 'q'`)} - 0.5) * 0.3
                     - CASE WHEN j <= 3 THEN 0.25 + 0.3 * (1 - p.h) ELSE 0 END + (${R(`r.id || j::text`)} - 0.5) * 0.02)) AS q
           FROM coverage_reports r JOIN p ON p.d = (${TODAY} - r.day), s, generate_series(1, 24) AS j
          WHERE r.team_id = ${T} AND r.id LIKE '${RAW_SAMPLE_PREFIX}cov-${K}-%' AND NOT EXISTS (SELECT 1 FROM coverage_files f WHERE f.report_id = r.id)
       ) x
     ON CONFLICT (id) DO NOTHING`,

    // 6. Report totals from the files.
    `UPDATE coverage_reports r SET lines_found = x.lf, lines_hit = x.lh, branches_found = x.bf, branches_hit = x.bh, file_count = x.n
       FROM (SELECT report_id, SUM(lines_found)::int AS lf, SUM(lines_hit)::int AS lh, SUM(branches_found)::int AS bf, SUM(branches_hit)::int AS bh, COUNT(*)::int AS n
               FROM coverage_files WHERE team_id = ${T} AND report_id LIKE '${RAW_SAMPLE_PREFIX}cov-${K}-%' GROUP BY report_id) x
      WHERE r.id = x.report_id AND r.file_count = 0`,

    // 7. A pipeline run per test run: failed when its tests failed or the integration stage broke.
    `WITH ${P}
     INSERT INTO pipeline_runs_raw (id, company_id, team_id, external_id, attempt, name, commit_sha, branch, started_at, finished_at, duration_s, result, url, day, is_sample, created_at)
     SELECT '${RAW_SAMPLE_PREFIX}pr-' || substr(tr.id, ${RAW_SAMPLE_PREFIX.length + 4}), ${CO}, ${T}, tr.run_id, tr.attempt, 'CI', tr.commit_sha, tr.branch,
            tr.started_at - interval '4 minutes', tr.started_at - interval '4 minutes' + make_interval(secs => x.dur), x.dur,
            CASE WHEN tr.failed > 0 OR x.integ THEN 'failed' ELSE 'success' END, NULL, tr.day, TRUE, tr.started_at
       FROM test_runs tr JOIN p ON p.d = (${TODAY} - tr.day)
       CROSS JOIN LATERAL (SELECT round(60 * (6 + 22 * (1 - p.h)) * (0.85 + 0.3 * ${R(`tr.id || 'pd'`)}))::int AS dur,
                                  ${R(`tr.id || 'integ'`)} < 0.03 + 0.2 * (1 - p.h) AS integ) x
      WHERE tr.team_id = ${T} AND tr.id LIKE '${RAW_SAMPLE_PREFIX}tr-${K}-%' AND tr.total > 0
        AND tr.started_at - interval '4 minutes' + make_interval(secs => x.dur) <= now() AND ${noReal('pipeline_runs_raw')}
     ON CONFLICT DO NOTHING`,

    // 8. Stages: build, three parallel unit-test shards, integration tests, deploy (when green).
    `INSERT INTO pipeline_stage_runs (id, pipeline_run_id, team_id, name, kind, parallel_group, started_at, finished_at, duration_s, result)
     SELECT '${RAW_SAMPLE_PREFIX}st-' || substr(md5(pr.id || st.name), 1, 24), pr.id, ${T}, st.name, st.kind, st.grp,
            pr.started_at + make_interval(secs => st.off), pr.started_at + make_interval(secs => st.off + st.dur), st.dur, st.result
       FROM pipeline_runs_raw pr
       JOIN test_runs tr ON tr.team_id = pr.team_id AND tr.run_id = pr.external_id AND tr.attempt = pr.attempt AND tr.id LIKE '${RAW_SAMPLE_PREFIX}tr-%'
       CROSS JOIN LATERAL (
         SELECT b, u, round(u * (0.7 + 0.3 * ${R(`pr.id || 's2'`)}))::int AS u2, round(u * (0.6 + 0.35 * ${R(`pr.id || 's3'`)}))::int AS u3, i, dpl,
                (tr.failed > 0) AS tests_failed, (pr.result = 'failed' AND tr.failed = 0) AS integ_failed, 1 + floor(${R(`pr.id || 'shard'`)} * 3)::int AS bad
           FROM (SELECT round(pr.duration_s * 0.2)::int AS b, round(pr.duration_s * 0.35)::int AS u, round(pr.duration_s * 0.3)::int AS i, round(pr.duration_s * 0.12)::int AS dpl) q
       ) z
       CROSS JOIN LATERAL (VALUES
         ('build', 'build', NULL::text, 0, z.b, 'success'),
         ('unit tests (shard 1/3)', 'test', 'unit', z.b, z.u, CASE WHEN z.tests_failed AND z.bad = 1 THEN 'failed' ELSE 'success' END),
         ('unit tests (shard 2/3)', 'test', 'unit', z.b, z.u2, CASE WHEN z.tests_failed AND z.bad = 2 THEN 'failed' ELSE 'success' END),
         ('unit tests (shard 3/3)', 'test', 'unit', z.b, z.u3, CASE WHEN z.tests_failed AND z.bad = 3 THEN 'failed' ELSE 'success' END),
         ('integration-tests', 'test', NULL::text, z.b + z.u, z.i, CASE WHEN z.integ_failed THEN 'failed' WHEN z.tests_failed THEN 'skipped' ELSE 'success' END),
         ('deploy to staging', 'deploy', NULL::text, z.b + z.u + z.i, z.dpl, CASE WHEN pr.result = 'success' THEN 'success' ELSE 'skipped' END)
       ) AS st(name, kind, grp, off, dur, result)
      WHERE pr.team_id = ${T} AND pr.id LIKE '${RAW_SAMPLE_PREFIX}pr-${K}-%' AND NOT EXISTS (SELECT 1 FROM pipeline_stage_runs s WHERE s.pipeline_run_id = pr.id)
     ON CONFLICT (id) DO NOTHING`,

    // 9. Flaky-test evidence (the same rule as server/lib/calc/engine.ts refreshFlakyEvidence).
    flakyEvidenceSql(T, `SELECT DISTINCT commit_sha FROM test_runs WHERE team_id = ${T} AND is_sample`),
  ];
}

/** INSERT … ON CONFLICT of flaky_test_evidence for the commits returned by `commitsSql`. */
export function flakyEvidenceSql(teamLiteral: string, commitsSql: string): string {
  return `INSERT INTO flaky_test_evidence (company_id, team_id, test_key, suite, name, commit_sha, failed_run_ids, passed_run_ids, failure_message, first_seen, last_seen)
     SELECT MAX(tr.company_id), tr.team_id, r.test_key, MAX(r.suite), MAX(r.name), tr.commit_sha,
            COALESCE(array_agg(DISTINCT tr.id) FILTER (WHERE r.status IN ('failed', 'error') OR r.retries > 0), '{}'),
            COALESCE(array_agg(DISTINCT tr.id) FILTER (WHERE r.status = 'passed'), '{}'),
            MAX(r.failure_message), MIN(tr.started_at), MAX(tr.started_at)
       FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id
      WHERE tr.team_id = ${teamLiteral} AND tr.commit_sha IN (${commitsSql})
      GROUP BY tr.team_id, r.test_key, tr.commit_sha
     HAVING (bool_or(r.status = 'passed') AND bool_or(r.status IN ('failed', 'error'))) OR bool_or(r.status = 'passed' AND r.retries > 0)
     ON CONFLICT (team_id, test_key, commit_sha) DO UPDATE SET failed_run_ids = EXCLUDED.failed_run_ids, passed_run_ids = EXCLUDED.passed_run_ids,
       failure_message = COALESCE(EXCLUDED.failure_message, flaky_test_evidence.failure_message), first_seen = EXCLUDED.first_seen, last_seen = EXCLUDED.last_seen
     WHERE flaky_test_evidence.failed_run_ids IS DISTINCT FROM EXCLUDED.failed_run_ids OR flaky_test_evidence.passed_run_ids IS DISTINCT FROM EXCLUDED.passed_run_ids`;
}

export function rawSampleSql(teams: RawSampleTeam[], days = RAW_SAMPLE_DAYS): string[] {
  return teams.flatMap((t) => rawSampleSqlForTeam(t, days));
}

/** Clear statements (with the other sample data). */
export const RAW_SAMPLE_CLEAR: Array<{ table: string; sql: string }> = [
  { table: 'flaky_test_evidence', sql: `DELETE FROM flaky_test_evidence f WHERE EXISTS (SELECT 1 FROM test_runs tr WHERE tr.team_id = f.team_id AND tr.is_sample AND tr.id LIKE '${RAW_SAMPLE_PREFIX}%' AND tr.id = ANY(f.failed_run_ids))` },
  { table: 'metric_evidence', sql: `DELETE FROM metric_evidence e WHERE EXISTS (SELECT 1 FROM test_runs tr WHERE tr.team_id = e.team_id AND tr.is_sample) AND NOT EXISTS (SELECT 1 FROM test_runs tr WHERE tr.team_id = e.team_id AND NOT tr.is_sample) AND NOT EXISTS (SELECT 1 FROM coverage_reports c WHERE c.team_id = e.team_id AND NOT c.is_sample) AND NOT EXISTS (SELECT 1 FROM pipeline_runs_raw p WHERE p.team_id = e.team_id AND NOT p.is_sample)` },
  { table: 'pipeline_runs_raw', sql: `DELETE FROM pipeline_runs_raw WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
  { table: 'coverage_reports', sql: `DELETE FROM coverage_reports WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
  { table: 'test_runs', sql: `DELETE FROM test_runs WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
];

/** After the sample SQL ran: the evidence of the sample days (metric_evidence; never KPI values). */
export async function computeSampleEvidence(client: pg.PoolClient, teamIds: string[], days = RAW_SAMPLE_DAYS): Promise<number> {
  const list: string[] = [];
  for (let i = days - 1; i >= 0; i--) list.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  let n = 0;
  for (const id of teamIds) {
    const has = await client.query(`SELECT 1 FROM test_runs WHERE team_id = $1 AND is_sample LIMIT 1`, [id]);
    if (!has.rows.length) continue;
    const res = await recomputeTeamDays(client, id, list, { writeKpis: false });
    n += res.reduce((k, d) => k + d.metrics.length, 0);
  }
  return n;
}
