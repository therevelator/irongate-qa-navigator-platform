/**
 * Sample (demo) raw data for v2 phases 1 and 2: test runs with per-test results, coverage reports with
 * per-file coverage, pipeline runs with stages, deployments with their commits and incidents, for every
 * COMPLETE day of the team's sample history (the KPI history and SAMPLE_WARMUP_DAYS before it, so the
 * 7- and 28-day windows are full from its first day), consistent with each team's story (its health: a
 * healthier team has higher coverage, fewer flaky tests, faster and greener pipelines, more and safer
 * deploys). The calculation engine turns them into the team's values (metric_evidence), and the sample
 * KPI snapshots are those values (server/seeds/demoSeed.ts), so a tile and its evidence are one number.
 *
 * Plain SQL (generate_series, deterministic pseudo-random values from md5), so the statements are
 * small and fast on the database. Rows are sample rows: ids start with "demo-raw-", is_sample = true,
 * so they are removed with the other sample data. Idempotent: rows that exist are skipped, and a day is
 * only ever added whole (the nightly refresh adds the days after the last one present, up to yesterday),
 * so the values of a day never change once calculated. A team that has real raw data (is_sample = false)
 * gets none.
 */
import type pg from 'pg';
import { createHash } from 'crypto';
import { recomputeTeamRange, type MetricGroup } from '../lib/calc/engine';
import { DELIVERY_METRICS } from '../lib/calc/delivery';

const DELIVERY_KEYS = Object.keys(DELIVERY_METRICS);

/** Default number of days of computeSampleEvidence (a number of days ending today). */
export const RAW_SAMPLE_DAYS = 14;
/** Raw sample days before the first KPI snapshot day: the 28-day delivery and defect windows are full from the first day shown. */
export const SAMPLE_WARMUP_DAYS = 28;
/** Health values of a standalone sample (scripts/reseed/raw-sample-sql.ts; index 0 = today): 35 days. */
export const SAMPLE_HEALTH_DAYS = 36;
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

interface Vocabulary { suites: string[]; areas: string[]; verbs: string[]; objects: string[]; services: string[] }

/** Test and file names that fit the team (payments, lending, mobile, …). */
export function vocabularyFor(name: string): Vocabulary {
  const n = name.toLowerCase();
  const verbs = ['creates', 'rejects', 'updates', 'cancels', 'retries', 'validates', 'lists', 'exports', 'locks', 'refunds', 'schedules', 'notifies'];
  if (/pay|ledger|settle|card|billing/.test(n)) {
    return { suites: ['payments', 'ledger', 'settlement', 'fx-rates', 'card-auth'], areas: ['payments', 'ledger', 'settlement', 'fx', 'cards', 'webhooks'], verbs, services: ['payments-api', 'ledger-service', 'settlement-worker'],
      objects: ['a card payment', 'a SEPA transfer', 'a refund', 'a ledger entry', 'a settlement batch', 'an FX quote', 'a chargeback', 'a payout', 'a payment intent', 'an authorisation hold', 'a merchant fee', 'a daily statement', 'a duplicate payment', 'a currency conversion'] };
  }
  if (/lend|loan|credit|mortgage/.test(n)) {
    return { suites: ['loan-application', 'credit-check', 'underwriting', 'offers', 'repayments'], areas: ['application', 'credit', 'underwriting', 'offers', 'repayments', 'documents'], verbs, services: ['loan-application-api', 'credit-check-service', 'offers-service'],
      objects: ['a loan application', 'a credit score request', 'an affordability check', 'a loan offer', 'a repayment plan', 'an early repayment', 'a document upload', 'a co-applicant', 'an income proof', 'a rate quote', 'a decision letter', 'a direct debit', 'a missed payment', 'a top-up loan'] };
  }
  if (/mobile|app|ios|android/.test(n)) {
    return { suites: ['login', 'biometrics', 'push-notifications', 'statements', 'cards-screen'], areas: ['login', 'biometrics', 'notifications', 'statements', 'cards', 'navigation'], verbs, services: ['mobile-bff', 'ios-app', 'android-app'],
      objects: ['a biometric login', 'a PIN reset', 'a push notification', 'a statement download', 'a card freeze', 'a dark-mode screen', 'an offline banner', 'a deep link', 'a session timeout', 'a contact payment', 'an app update prompt', 'a spending chart', 'a QR payment', 'a device binding'] };
  }
  return { suites: ['api', 'auth', 'accounts', 'search', 'notifications'], areas: ['api', 'auth', 'accounts', 'search', 'notifications', 'reports'], verbs, services: ['web-api', 'auth-service', 'notifications-worker'],
    objects: ['a user session', 'an account', 'a search query', 'a notification', 'a report export', 'a password reset', 'an audit entry', 'a webhook', 'a file upload', 'a permission change', 'a settings update', 'an invitation', 'a scheduled job', 'a rate limit'] };
}

/** One generated day: its date and the team's health on it. */
export interface RawDay { day: string; h: number }
export interface RawDayOptions {
  /** The data's "today" (YYYY-MM-DD, default the UTC date now): sample days are the complete days before it. */
  today?: string;
  /** First day to add (default: as many days before today as the health series covers). */
  from?: string;
}
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The days a team's sample gets: the COMPLETE days before today (a sample day is never added half-way:
 * every day has its full number of runs, deploys and so on), from `from` on; health from the series
 * (index = days before today).
 */
export function rawDaysOf(team: RawSampleTeam, opts: RawDayOptions = {}): RawDay[] {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const out: RawDay[] = [];
  for (let d = team.health.length - 1; d >= 1; d--) {
    const day = addDays(today, -d);
    if (opts.from && day < opts.from) continue;
    out.push({ day, h: Math.max(0.04, Math.min(0.98, team.health[d] ?? team.health[team.health.length - 1] ?? 0.6)) });
  }
  return out;
}
const daysCte = (days: RawDay[]) => `p(day, h) AS (VALUES ${days.map((x) => `(DATE '${x.day}', ${x.h.toFixed(3)}::float8)`).join(', ')})`;

/**
 * The SQL statements that add the sample raw CI data of one team (run in order), and its deployments and
 * incidents: test runs on main (7 commits a weekday, 5 a day at weekends, and reruns; always an odd number
 * of runs a day, so the median run duration is one of the runs), per-test results, a coverage report per
 * commit (per-file rows for the day's last one, the report the coverage value uses), a pipeline run per test
 * run with its stages, and flaky-test evidence. Whole-minute durations, so the KPI columns (whole minutes)
 * hold exactly the calculated value.
 */
export function rawSampleSqlForTeam(team: RawSampleTeam, opts: RawDayOptions = {}): string[] {
  const days = rawDaysOf(team, opts);
  if (!days.length) return [];
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const T = lit(team.id);
  const CO = lit(team.companyId);
  const K = short(team.id);
  const v = vocabularyFor(team.name);
  const P = daysCte(days);
  const AT = (dateExpr: string, minutes: string) => `((${dateExpr})::timestamp + make_interval(mins => ${minutes})) AT TIME ZONE 'UTC'`;
  const noReal = (table: string) => `NOT EXISTS (SELECT 1 FROM ${table} WHERE team_id = ${T} AND NOT is_sample)`;
  const N = `(48 + floor(${R(`${T} || 'n'`)} * 33))::int`; // tests in the suite: 48..80
  const TR = `${RAW_SAMPLE_PREFIX}tr-${K}-`;
  const COV = `${RAW_SAMPLE_PREFIX}cov-${K}-`;

  return [
    // 1. Test runs: 7 commits a weekday on main (5 at weekends), from 06:30 to about 21:00 UTC; a rerun
    //    (attempt 2) now and then, more for a weaker team; an even number of reruns a day.
    `WITH ${P}, base AS (
       SELECT p.day, p.h, c.c, CASE WHEN extract(isodow FROM p.day) < 6 THEN 7 ELSE 5 END AS nc FROM p, generate_series(0, 6) AS c(c)),
          cand AS (
       SELECT b.*, a.a FROM base b, generate_series(1, 2) AS a(a)
        WHERE b.c < b.nc AND (a.a = 1 OR ${R(`${T} || b.day::text || b.c::text || 'rerun'`)} < 0.15 + 0.6 * (1 - b.h))),
          numbered AS (
       SELECT cand.*, COUNT(*) FILTER (WHERE a = 2) OVER (PARTITION BY day) AS nre, row_number() OVER (PARTITION BY day, a ORDER BY c DESC) AS rn FROM cand),
          runs AS (
       SELECT day, h, c, a, ${AT('day', `(390 + c * (960 / nc) + (a - 1) * 25 + floor(${R(`${T} || day::text || c::text`)} * 50))::int`)} AS ts
         FROM numbered WHERE a = 1 OR NOT (nre % 2 = 1 AND rn = 1))
     INSERT INTO test_runs (id, company_id, team_id, format, commit_sha, branch, run_id, attempt, started_at, day, total, passed, failed, errored, skipped, duration_ms, tests_duration_ms, is_sample, created_at)
     SELECT '${TR}' || to_char(day, 'YYYYMMDD') || '-' || c || '-' || a, ${CO}, ${T}, 'junit',
            substr(md5(${T} || day::text || c::text), 1, 12), 'main', 'ci-' || to_char(day, 'YYYYMMDD') || '-' || (c + 1), a, ts, (ts AT TIME ZONE 'UTC')::date,
            0, 0, 0, 0, 0, 0, 0, TRUE, ts
       FROM runs WHERE ts <= now() - interval '15 minutes' AND ${noReal('test_runs')}
     ON CONFLICT (id) DO NOTHING`,

    // 2. Per-test results: flaky tests fail on a first attempt now and then; a weaker team has more of
    //    them, some genuinely failing tests and a slower suite; one skipped test; a few slow tests.
    `WITH ${P}, s AS (SELECT ${arr(v.suites)} AS suites, ${arr(v.verbs)} AS verbs, ${arr(v.objects)} AS objects, ${N} AS n),
          tests AS (
            SELECT i, x.suite, x.name, md5(x.suite || '|' || x.name) AS test_key, s.n,
                   'TimeoutError: waited 5000 ms for "' || s.objects[1 + (3 * i) % 14] || '" to be ready' AS timeout_msg,
                   'AssertionError: expected status 200 but was 500 (' || x.name || ')' AS assert_msg,
                   40 + 18000 * power(${R(`${T} || i::text || 'dur'`)}, 5) AS base_dur
              FROM s, generate_series(1, s.n) AS i
              CROSS JOIN LATERAL (SELECT 'src/' || s.suites[1 + i % 5] || '/' || s.suites[1 + i % 5] || '.test.ts' AS suite,
                                         s.verbs[1 + (7 * i) % 12] || ' ' || s.objects[1 + (3 * i) % 14] AS name) x),
          runs AS (
            SELECT tr.id, tr.attempt, tr.day, tr.commit_sha, p.h,
                   greatest(1, round(s.n * (0.01 + 0.12 * (1 - p.h))))::int AS nf,
                   round(s.n * 0.06 * (1 - p.h))::int AS ng
              FROM test_runs tr JOIN p ON p.day = tr.day, s
             WHERE tr.team_id = ${T} AND tr.id LIKE '${TR}%'
               AND NOT EXISTS (SELECT 1 FROM test_results r WHERE r.test_run_id = tr.id))
     INSERT INTO test_results (id, test_run_id, team_id, test_key, suite, name, status, duration_ms, retries, failure_hash, failure_message)
     SELECT '${RAW_SAMPLE_PREFIX}r-' || substr(md5(x.id || x.i::text), 1, 25), x.id, ${T}, x.test_key, x.suite, x.name, x.status, x.dur, 0,
            CASE WHEN x.status = 'failed' THEN substr(md5(x.msg), 1, 16) END, CASE WHEN x.status = 'failed' THEN x.msg END
       FROM (
         SELECT runs.id, t.i, t.suite, t.name, t.test_key,
                CASE WHEN t.i = t.n THEN 'skipped'
                     WHEN t.i <= runs.nf AND runs.attempt = 1 AND ${R(`runs.id || t.i::text`)} < 0.02 + 0.07 * (1 - runs.h) THEN 'failed'
                     WHEN t.i > runs.nf AND t.i <= runs.nf + runs.ng AND ${R(`runs.commit_sha || t.i::text || 'g'`)} < 0.12 * (1 - runs.h) THEN 'failed'
                     ELSE 'passed' END AS status,
                CASE WHEN t.i <= runs.nf THEN t.timeout_msg ELSE t.assert_msg END AS msg,
                round(t.base_dur * (0.8 + 0.4 * ${R(`runs.id || t.i::text || 'j'`)}) * (0.8 + 2.2 * (1 - runs.h)))::int AS dur
           FROM runs, tests t
       ) x
     ON CONFLICT (id) DO NOTHING`,

    // 3. Run totals from the results; the run's duration in whole minutes.
    `UPDATE test_runs tr SET total = x.total, passed = x.passed, failed = x.failed, skipped = x.skipped, tests_duration_ms = x.dur,
            duration_ms = greatest(60000, round(x.dur * 1.08 / 60000.0) * 60000)
       FROM (SELECT test_run_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'passed')::int AS passed,
                    COUNT(*) FILTER (WHERE status = 'failed')::int AS failed, COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped, SUM(duration_ms)::bigint AS dur
               FROM test_results WHERE team_id = ${T} AND test_run_id LIKE '${TR}%' GROUP BY test_run_id) x
      WHERE tr.id = x.test_run_id AND tr.total = 0`,

    // 4. A coverage report per commit on main (after its first test run).
    `WITH ${P}
     INSERT INTO coverage_reports (id, company_id, team_id, format, commit_sha, branch, run_id, attempt, created_at, day, is_sample)
     SELECT replace(tr.id, '-tr-', '-cov-'), ${CO}, ${T}, 'lcov', tr.commit_sha, 'main', tr.run_id, 1, tr.started_at + interval '3 minutes', tr.day, TRUE
       FROM test_runs tr JOIN p ON p.day = tr.day
      WHERE tr.team_id = ${T} AND tr.id LIKE '${TR}%' AND tr.attempt = 1 AND tr.started_at + interval '3 minutes' <= now() AND ${noReal('coverage_reports')}
     ON CONFLICT (id) DO NOTHING`,

    // 5. Per-file coverage of the day's last report: most files near the team's level, a few weak ones.
    `WITH ${P}, s AS (SELECT ${arr(v.areas)} AS areas, ARRAY['service', 'controller', 'repository', 'validator', 'mapper', 'client', 'handler', 'utils'] AS kinds)
     INSERT INTO coverage_files (id, report_id, team_id, path, lines_found, lines_hit, branches_found, branches_hit)
     SELECT '${RAW_SAMPLE_PREFIX}cf-' || substr(md5(x.rid || x.j::text), 1, 24), x.rid, ${T}, x.path, x.lf, round(x.lf * x.q)::int, x.bf, round(x.bf * x.q * 0.92)::int
       FROM (
         SELECT r.id AS rid, j, 'src/' || s.areas[1 + j % 6] || '/' || s.kinds[1 + (5 * j) % 8] || '.ts' AS path,
                (40 + floor(360 * ${R(`${T} || j::text || 'size'`)}))::int AS lf, (6 + floor(50 * ${R(`${T} || j::text || 'br'`)}))::int AS bf,
                least(1.0, greatest(0.04, (0.52 + 0.38 * p.h) + (${R(`${T} || j::text || 'q'`)} - 0.5) * 0.3
                     - CASE WHEN j <= 3 THEN 0.25 + 0.3 * (1 - p.h) ELSE 0 END + (${R(`r.id || j::text`)} - 0.5) * 0.02)) AS q
           FROM coverage_reports r JOIN p ON p.day = r.day, s, generate_series(1, 24) AS j
          WHERE r.team_id = ${T} AND r.id LIKE '${COV}%' AND NOT EXISTS (SELECT 1 FROM coverage_files f WHERE f.report_id = r.id)
            AND r.created_at = (SELECT MAX(r2.created_at) FROM coverage_reports r2 WHERE r2.team_id = ${T} AND r2.day = r.day AND r2.id LIKE '${COV}%')
       ) x
     ON CONFLICT (id) DO NOTHING`,

    // 6. Report totals from the files.
    `UPDATE coverage_reports r SET lines_found = x.lf, lines_hit = x.lh, branches_found = x.bf, branches_hit = x.bh, file_count = x.n
       FROM (SELECT report_id, SUM(lines_found)::int AS lf, SUM(lines_hit)::int AS lh, SUM(branches_found)::int AS bf, SUM(branches_hit)::int AS bh, COUNT(*)::int AS n
               FROM coverage_files WHERE team_id = ${T} AND report_id LIKE '${COV}%' GROUP BY report_id) x
      WHERE r.id = x.report_id AND r.file_count = 0`,

    // 7. The day's earlier reports: the same code size, coverage within a few tenths of a percent.
    `WITH ${P}
     UPDATE coverage_reports r SET lines_found = l.lines_found, file_count = l.file_count, branches_found = l.branches_found,
            lines_hit = least(l.lines_found, round(l.lines_hit * (1 + (${R(`r.id || 'cv'`)} - 0.55) * 0.012)))::int,
            branches_hit = least(l.branches_found, round(l.branches_hit * (1 + (${R(`r.id || 'cb'`)} - 0.55) * 0.012)))::int
       FROM coverage_reports l
      WHERE r.team_id = ${T} AND r.id LIKE '${COV}%' AND r.file_count = 0 AND r.day IN (SELECT day FROM p) AND l.team_id = ${T} AND l.id LIKE '${COV}%' AND l.day = r.day AND l.id <> r.id
        AND EXISTS (SELECT 1 FROM coverage_files f WHERE f.report_id = l.id)`,

    // 8. A pipeline run per test run (whole minutes): failed when its tests failed or the integration stage broke.
    `WITH ${P}
     INSERT INTO pipeline_runs_raw (id, company_id, team_id, external_id, attempt, name, commit_sha, branch, started_at, finished_at, duration_s, result, url, day, is_sample, created_at)
     SELECT '${RAW_SAMPLE_PREFIX}pr-' || substr(tr.id, ${RAW_SAMPLE_PREFIX.length + 4}), ${CO}, ${T}, tr.run_id, tr.attempt, 'CI', tr.commit_sha, tr.branch,
            tr.started_at - interval '4 minutes', tr.started_at - interval '4 minutes' + make_interval(secs => x.dur), x.dur,
            CASE WHEN tr.failed > 0 OR x.integ THEN 'failed' ELSE 'success' END, NULL, tr.day, TRUE, tr.started_at
       FROM test_runs tr JOIN p ON p.day = tr.day
       CROSS JOIN LATERAL (SELECT (60 * round((6 + 22 * (1 - p.h)) * (0.85 + 0.3 * ${R(`tr.id || 'pd'`)})))::int AS dur,
                                  ${R(`tr.id || 'integ'`)} < 0.01 + 0.08 * (1 - p.h) AS integ) x
      WHERE tr.team_id = ${T} AND tr.id LIKE '${TR}%' AND tr.total > 0
        AND tr.started_at - interval '4 minutes' + make_interval(secs => x.dur) <= now() AND ${noReal('pipeline_runs_raw')}
     ON CONFLICT DO NOTHING`,

    // 9. Stages: build, three parallel unit-test shards, integration tests, deploy (when green).
    `WITH ${P}
     INSERT INTO pipeline_stage_runs (id, pipeline_run_id, team_id, name, kind, parallel_group, started_at, finished_at, duration_s, result)
     SELECT '${RAW_SAMPLE_PREFIX}st-' || substr(md5(pr.id || st.name), 1, 24), pr.id, ${T}, st.name, st.kind, st.grp,
            pr.started_at + make_interval(secs => st.off), pr.started_at + make_interval(secs => st.off + st.dur), st.dur, st.result
       FROM pipeline_runs_raw pr JOIN p ON p.day = pr.day
       JOIN test_runs tr ON tr.id = '${RAW_SAMPLE_PREFIX}tr-' || substr(pr.id, ${RAW_SAMPLE_PREFIX.length + 4})
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

    // 10. Flaky-test evidence (the same rule as server/lib/calc/engine.ts refreshFlakyEvidence) of the added
    //     commits of the last 40 days (the evidence view shows 30 days; older per-test results are not kept).
    `WITH ${P} ${flakyEvidenceSql(T, `SELECT DISTINCT tr2.commit_sha FROM test_runs tr2 JOIN p ON p.day = tr2.day WHERE tr2.team_id = ${T} AND tr2.is_sample AND tr2.day >= DATE '${addDays(today, -SAMPLE_DETAIL_DAYS)}'`)}`,

    ...deliverySampleSqlForTeam(team, opts),
  ];
}

/** Per-test results of sample runs are kept this many days (the evidence views look back at most 30). */
export const SAMPLE_DETAIL_DAYS = 40;

/** After the evidence of the sample days is recorded: per-test results of sample runs older than SAMPLE_DETAIL_DAYS. */
export function pruneSampleDetailSql(teamId: string, today: string): string {
  return `DELETE FROM test_results r USING test_runs tr WHERE tr.id = r.test_run_id AND tr.team_id = ${lit(teamId)} AND tr.is_sample
            AND tr.id LIKE '${RAW_SAMPLE_PREFIX}%' AND tr.day < DATE '${addDays(today, -SAMPLE_DETAIL_DAYS)}'`;
}

/**
 * Sample deployments, commits and incidents (v2 phase 2) of one team for the sample days, following its
 * story: a healthier team deploys more often (production deploys on weekdays), with smaller batches and
 * shorter lead times, fewer failed changes (rolled back, followed by a hotfix or linked to an incident),
 * fewer and shorter incidents (every team has a few minor ones a month). Plain SQL like the phase-1
 * sample; ids start with "demo-raw-", is_sample = true; rows that exist are skipped. An incident is added
 * resolved (sample incidents end by 02:00 UTC the next day) and an event that lies in the future when the
 * day is added is left out, so a day's data never changes once added. A team with real deployments or
 * incidents gets none.
 */
export function deliverySampleSqlForTeam(team: RawSampleTeam, opts: RawDayOptions = {}): string[] {
  const days = rawDaysOf(team, opts);
  if (!days.length) return [];
  const T = lit(team.id);
  const CO = lit(team.companyId);
  const K = short(team.id);
  const v = vocabularyFor(team.name);
  const P = daysCte(days);
  const AT = (dateExpr: string, minutes: string) => `((${dateExpr})::timestamp + make_interval(mins => ${minutes})) AT TIME ZONE 'UTC'`;
  const noReal = (table: string) => `NOT EXISTS (SELECT 1 FROM ${table} WHERE team_id = ${T} AND NOT is_sample)`;
  const PFX = `${RAW_SAMPLE_PREFIX}dep-${K}-`;
  // Per deploy: failed change when f < 0.03 + 0.45 (1 − h)^1.5; its kind by g: rolled back (< 0.35), a hotfix follows (< 0.7), else a linked incident.
  // A deploy that does not complete (result failure, not counted) when c < 0.03 + 0.08 (1 − h).
  const FAILP = `(0.03 + 0.45 * power(1 - p.h, 1.5))`;
  const NOTDONE = `(0.03 + 0.08 * (1 - p.h))`;
  const dayOfId = (col: string) => `to_date(substr(${col}, ${PFX.length + 1}, 8), 'YYYYMMDD')`;
  const SEV = (r: string) => `CASE WHEN ${r} < 0.05 THEN 'critical' WHEN ${r} < 0.2 THEN 'high' WHEN ${r} < 0.6 THEN 'medium' ELSE 'low' END`;
  const LABEL = (sev: string) => `CASE ${sev} WHEN 'critical' THEN 'P1' WHEN 'high' THEN 'P2' WHEN 'medium' THEN 'P3' ELSE 'P4' END`;
  const TITLES = arr(['Elevated error rate on %s', 'Latency above SLO on %s', 'Timeouts calling %s', 'Failed background jobs in %s', 'Partial outage of %s', 'Memory pressure on %s pods']);
  return [
    // 1. Production deploys on weekdays (more and smaller for a healthier team), and the hotfix deploys that follow some of them.
    `WITH ${P}, s AS (SELECT ${arr(v.services)} AS sv),
          cand AS (
            SELECT p.day, p.h, k, '${PFX}' || to_char(p.day, 'YYYYMMDD') || '-' || k AS id,
                   ${AT('p.day', `(8 * 60 + 30 + k * 105 + floor(${R(`${T} || p.day::text || k::text || 't'`)} * 75))::int`)} AS ts,
                   s.sv[1 + ((k + (p.day - DATE '2000-01-01')) % 3)] AS service
              FROM p, s, generate_series(0, 4) AS k
             WHERE extract(isodow FROM p.day) < 6 AND ${R(`${T} || p.day::text || 'skip'`)} >= 0.5 * (1 - p.h) AND k < 1 + floor(4.2 * p.h * p.h * ${R(`${T} || p.day::text || 'n'`)})),
          x AS (SELECT cand.*, ${R(`id || 'f'`)} AS f, ${R(`id || 'g'`)} AS g, ${R(`id || 'c'`)} AS c FROM cand),
          rows AS (
            SELECT id, 'rel-' || to_char(day, 'YYYYMMDD') || '.' || (k + 1) AS ext, service, substr(md5(id || 'sha'), 1, 12) AS sha,
                   ts - make_interval(mins => (4 + floor(${R(`id || 'dur'`)} * 9))::int) AS started, ts AS finished, FALSE AS hotfix,
                   CASE WHEN c < ${NOTDONE} THEN 'failure' WHEN f < ${FAILP} AND g < 0.35 THEN 'rolled_back' ELSE 'success' END AS result
              FROM x p
            UNION ALL
            SELECT id || '-hf', 'rel-' || to_char(day, 'YYYYMMDD') || '.' || (k + 1) || '-hotfix', service, substr(md5(id || 'hf'), 1, 12),
                   ts + make_interval(mins => (90 + floor(${R(`id || 'hf'`)} * 960))::int) - interval '6 minutes', ts + make_interval(mins => (90 + floor(${R(`id || 'hf'`)} * 960))::int), TRUE, 'success'
              FROM x p WHERE p.c >= ${NOTDONE} AND p.f < ${FAILP} AND p.g >= 0.35 AND p.g < 0.7)
     INSERT INTO deployments_raw (id, company_id, team_id, external_id, environment, is_production, service, commit_sha, commit_shas, started_at, finished_at, day, result, is_hotfix, url, event_hash, is_sample, created_at)
     SELECT id, ${CO}, ${T}, ext, 'production', TRUE, service, sha, ARRAY[sha]::varchar[], started, finished, (finished AT TIME ZONE 'UTC')::date, result, hotfix, NULL, NULL, TRUE, finished
       FROM rows WHERE finished <= now() - interval '5 minutes' AND ${noReal('deployments_raw')}
     ON CONFLICT DO NOTHING`,

    // 2. The commits of each sample deploy: a weaker team ships bigger batches that waited longer (lead time); authors as hashes only.
    `WITH ${P}
     INSERT INTO deployment_commits (id, company_id, team_id, deployment_external_id, sha, authored_at, committed_at, author_hash, branch, is_sample, created_at)
     SELECT '${RAW_SAMPLE_PREFIX}dc-' || substr(md5(d.id || i::text), 1, 24), ${CO}, ${T}, d.external_id,
            CASE WHEN i = 1 THEN d.commit_sha ELSE substr(md5(d.id || i::text || 's'), 1, 12) END,
            d.finished_at - make_interval(mins => round(20 + z.lead * 60 * i / z.n)::int),
            d.finished_at - make_interval(mins => round(15 + z.lead * 60 * i / z.n * 0.8)::int),
            substr(md5(${T} || 'author' || floor(${R(`d.id || i::text || 'a'`)} * 6)::text), 1, 32), CASE WHEN d.is_hotfix THEN 'hotfix/' || d.external_id ELSE 'main' END, TRUE, d.finished_at
       FROM deployments_raw d
       JOIN p ON p.day = ${dayOfId('d.id')}
       CROSS JOIN LATERAL (SELECT CASE WHEN d.is_hotfix THEN 1 ELSE 1 + floor((1.5 + 5 * (1 - p.h)) * ${R(`d.id || 'nc'`)})::int END AS n,
                                  CASE WHEN d.is_hotfix THEN 1 + 2 * ${R(`d.id || 'hl'`)} ELSE (2 + 100 * power(1 - p.h, 1.5)) * (0.4 + 1.2 * ${R(`d.id || 'lt'`)}) END AS lead) z
       CROSS JOIN LATERAL generate_series(1, z.n) AS i
      WHERE d.team_id = ${T} AND d.id LIKE '${PFX}%' AND d.is_sample
        AND NOT EXISTS (SELECT 1 FROM deployment_commits c WHERE c.team_id = d.team_id AND c.deployment_external_id = d.external_id)
     ON CONFLICT DO NOTHING`,

    // 3. Incidents: one linked to each deploy whose failure is an incident, and unlinked ones (a few a month for
    //    every team, more for a weaker one); severity P1–P4, outages are P1 / P2; resolved by 02:00 UTC the next day.
    `WITH ${P}, s AS (SELECT ${arr(v.services)} AS sv, ${TITLES} AS titles),
          linked AS (
            SELECT d.id AS src, 'INC-' || to_char(d.day, 'YYMMDD') || '-D' || substr(d.id, ${PFX.length + 10}) AS ext, d.service, d.external_id AS dep, p.h,
                   d.finished_at + make_interval(mins => (20 + floor(${R(`d.id || 'io'`)} * 280))::int) AS opened
              FROM deployments_raw d JOIN p ON p.day = d.day
             WHERE d.team_id = ${T} AND d.id LIKE '${PFX}%' AND d.id NOT LIKE '%-hf' AND d.is_sample AND d.result = 'success'
               AND ${R(`d.id || 'f'`)} < ${FAILP} AND ${R(`d.id || 'g'`)} >= 0.7 AND ${R(`d.id || 'c'`)} >= ${NOTDONE}),
          loose AS (
            SELECT '${RAW_SAMPLE_PREFIX}inc-${K}-' || to_char(p.day, 'YYYYMMDD') || '-' || j AS src, 'INC-' || to_char(p.day, 'YYMMDD') || '-' || (j + 1) AS ext,
                   s.sv[1 + floor(${R(`${T} || p.day::text || j::text || 'sv'`)} * 3)::int] AS service, NULL::text AS dep, p.h,
                   ${AT('p.day', `(60 + floor(${R(`${T} || p.day::text || j::text || 'ot'`)} * 1320))::int`)} AS opened
              FROM p, s, generate_series(0, 1) AS j
             -- A minor one every week for every team (an incident process in use), more at random for a weaker team.
             WHERE ${R(`${T} || p.day::text || j::text || 'inc'`)} < (0.08 + 0.3 * (1 - p.h)) * CASE WHEN j = 0 THEN 1 ELSE 0.35 END
                OR (j = 0 AND ((p.day - DATE '2000-01-01') + ${parseInt(K.slice(0, 4), 16) % 7}) % 7 = 0)),
          a AS (SELECT * FROM linked UNION ALL SELECT * FROM loose),
          b AS (SELECT a.*, ${SEV(R(`a.src || 'sev'`))} AS sev,
                       a.opened + make_interval(mins => (4 + floor(${R(`a.src || 'ack'`)} * 26))::int) AS ack,
                       least(a.opened + make_interval(mins => round(60 * (0.3 + 6 * power(1 - a.h, 1.5)) * (0.3 + 1.4 * ${R(`a.src || 'dur'`)}))::int),
                             date_trunc('day', a.opened) + interval '26 hours') AS res,
                       CASE WHEN ${R(`a.src || 'cat'`)} < 0.35 THEN 'infrastructure' ELSE 'application' END AS cat
                  FROM a)
     INSERT INTO incidents_raw (id, company_id, team_id, external_id, title, severity, severity_label, service, status, opened_at, acknowledged_at, resolved_at, day,
                                outage, category, deployment_external_id, source, url, is_sample, created_at)
     SELECT CASE WHEN dep IS NULL THEN src ELSE '${RAW_SAMPLE_PREFIX}inc-${K}-' || substr(md5(src), 1, 14) END, ${CO}, ${T}, ext,
            replace((SELECT titles[1 + floor(${R(`b.src || 'title'`)} * 6)::int] FROM s), '%s', b.service), sev, ${LABEL('sev')}, service,
            'resolved', opened, least(ack, res), res, (opened AT TIME ZONE 'UTC')::date,
            NULL, cat, dep, 'pagerduty', NULL, TRUE, opened
       FROM b WHERE res <= now() - interval '5 minutes' AND ${noReal('incidents_raw')}
     ON CONFLICT DO NOTHING`,

    // 4. The status stream of the sample incidents.
    `INSERT INTO incident_updates (id, incident_id, team_id, status, at, severity)
     SELECT '${RAW_SAMPLE_PREFIX}iu-' || substr(md5(i.id || u.s), 1, 24), i.id, ${T}, u.s, u.t, i.severity
       FROM incidents_raw i CROSS JOIN LATERAL (VALUES ('open', i.opened_at), ('acknowledged', i.acknowledged_at), ('resolved', i.resolved_at)) AS u(s, t)
      WHERE i.team_id = ${T} AND i.is_sample AND u.t IS NOT NULL
     ON CONFLICT DO NOTHING`,
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

export function rawSampleSql(teams: RawSampleTeam[], opts: RawDayOptions = {}): string[] {
  return teams.flatMap((t) => rawSampleSqlForTeam(t, opts));
}

/** Clear statements (with the other sample data). */
export const RAW_SAMPLE_CLEAR: Array<{ table: string; sql: string }> = [
  { table: 'incidents_raw', sql: `DELETE FROM incidents_raw WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
  { table: 'deployment_commits', sql: `DELETE FROM deployment_commits WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
  { table: 'deployments_raw', sql: `DELETE FROM deployments_raw WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
  { table: 'flaky_test_evidence', sql: `DELETE FROM flaky_test_evidence f WHERE EXISTS (SELECT 1 FROM test_runs tr WHERE tr.team_id = f.team_id AND tr.is_sample AND tr.id LIKE '${RAW_SAMPLE_PREFIX}%' AND tr.id = ANY(f.failed_run_ids))` },
  { table: 'metric_evidence', sql: `DELETE FROM metric_evidence e WHERE EXISTS (SELECT 1 FROM test_runs tr WHERE tr.team_id = e.team_id AND tr.is_sample) AND NOT EXISTS (SELECT 1 FROM test_runs tr WHERE tr.team_id = e.team_id AND NOT tr.is_sample) AND NOT EXISTS (SELECT 1 FROM coverage_reports c WHERE c.team_id = e.team_id AND NOT c.is_sample) AND NOT EXISTS (SELECT 1 FROM pipeline_runs_raw p WHERE p.team_id = e.team_id AND NOT p.is_sample) AND e.metric_key <> ALL (${arr(DELIVERY_KEYS)})` },
  { table: 'metric_evidence', sql: `DELETE FROM metric_evidence e WHERE e.metric_key = ANY (${arr(DELIVERY_KEYS)}) AND (EXISTS (SELECT 1 FROM deployments_raw d WHERE d.team_id = e.team_id AND d.is_sample) OR EXISTS (SELECT 1 FROM incidents_raw i WHERE i.team_id = e.team_id AND i.is_sample)) AND NOT EXISTS (SELECT 1 FROM deployments_raw d WHERE d.team_id = e.team_id AND NOT d.is_sample) AND NOT EXISTS (SELECT 1 FROM incidents_raw i WHERE i.team_id = e.team_id AND NOT i.is_sample)` },
  { table: 'pipeline_runs_raw', sql: `DELETE FROM pipeline_runs_raw WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
  { table: 'coverage_reports', sql: `DELETE FROM coverage_reports WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
  { table: 'test_runs', sql: `DELETE FROM test_runs WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
];

/**
 * After the sample SQL ran: the evidence of the sample days (metric_evidence), calculated by the engine in
 * one pass per team (server/lib/calc/engine.ts recomputeTeamRange: a few queries for any number of days).
 * `days`: a list of days, or a number of days ending today. Returns the values recorded.
 */
export async function computeSampleEvidence(client: pg.PoolClient, teamIds: string[], days: number | string[] = RAW_SAMPLE_DAYS): Promise<number> {
  const list: string[] = Array.isArray(days) ? days : [];
  if (!Array.isArray(days)) for (let i = days - 1; i >= 0; i--) list.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  if (!list.length) return 0;
  let n = 0;
  for (const id of teamIds) {
    const groups = await sampleGroups(client, id);
    if (!groups.length) continue;
    const res = await recomputeTeamRange(client, id, list, { groups });
    n += res.reduce((k, d) => k + d.metrics.length, 0);
  }
  return n;
}

/** The metric groups whose raw data is sample data only (a team with real data in a group keeps its own values). */
export async function sampleGroups(client: pg.PoolClient, teamId: string): Promise<MetricGroup[]> {
  const g = (await client.query(
    `SELECT EXISTS (SELECT 1 FROM test_runs WHERE team_id = $1 AND is_sample) AND NOT EXISTS (SELECT 1 FROM test_runs WHERE team_id = $1 AND NOT is_sample) AS ci,
            (EXISTS (SELECT 1 FROM deployments_raw WHERE team_id = $1 AND is_sample) OR EXISTS (SELECT 1 FROM incidents_raw WHERE team_id = $1 AND is_sample))
              AND NOT EXISTS (SELECT 1 FROM deployments_raw WHERE team_id = $1 AND NOT is_sample) AND NOT EXISTS (SELECT 1 FROM incidents_raw WHERE team_id = $1 AND NOT is_sample) AS delivery,
            to_regclass('public.issues') IS NOT NULL AND to_regclass('public.analysis_reports') IS NOT NULL AS p3`,
    [teamId])).rows[0];
  // Phase 3 (issues, static analysis): only on a database with its tables.
  const w = g?.p3
    ? (await client.query(
      `SELECT EXISTS (SELECT 1 FROM issues WHERE team_id = $1 AND is_sample) AND NOT EXISTS (SELECT 1 FROM issues WHERE team_id = $1 AND NOT is_sample) AS work,
              EXISTS (SELECT 1 FROM analysis_reports WHERE team_id = $1 AND is_sample) AND NOT EXISTS (SELECT 1 FROM analysis_reports WHERE team_id = $1 AND NOT is_sample) AS quality`, [teamId])).rows[0]
    : null;
  return [...(g?.ci ? ['ci' as const] : []), ...(g?.delivery ? ['delivery' as const] : []), ...(w?.work ? ['work' as const] : []), ...(w?.quality ? ['quality' as const] : [])];
}
