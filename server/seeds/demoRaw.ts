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
import { recomputeTeamDays, type MetricGroup } from '../lib/calc/engine';
import { DELIVERY_METRICS } from '../lib/calc/delivery';

const DELIVERY_KEYS = Object.keys(DELIVERY_METRICS);

export const RAW_SAMPLE_DAYS = 14;
/** Sample deployments, commits and incidents (phase 2) cover more days: the 28-day DORA window is full. */
export const DELIVERY_SAMPLE_DAYS = 35;
/** Health values a team's sample raw data needs (index 0 = today). */
export const SAMPLE_HEALTH_DAYS = Math.max(RAW_SAMPLE_DAYS, DELIVERY_SAMPLE_DAYS);
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

    ...deliverySampleSqlForTeam(team),
  ];
}

/**
 * Sample deployments, commits and incidents (v2 phase 2) of one team for the last DELIVERY_SAMPLE_DAYS
 * days, following its story: a healthier team deploys more often (production deploys on weekdays),
 * with smaller batches and shorter lead times, fewer failed changes (rolled back, followed by a hotfix
 * or linked to an incident), fewer and shorter incidents. Plain SQL like the phase-1 sample; ids start
 * with "demo-raw-", is_sample = true; rows that exist are skipped (an open sample incident is closed
 * by a later run once its resolve time has passed). A team with real deployments or incidents gets none.
 */
export function deliverySampleSqlForTeam(team: RawSampleTeam, days = DELIVERY_SAMPLE_DAYS): string[] {
  const T = lit(team.id);
  const CO = lit(team.companyId);
  const K = short(team.id);
  const v = vocabularyFor(team.name);
  const healths = Array.from({ length: days }, (_, d) => Math.max(0.04, Math.min(0.98, team.health[d] ?? team.health[team.health.length - 1] ?? 0.6)));
  const P = `p(d, h) AS (VALUES ${healths.map((h, d) => `(${d}, ${h.toFixed(3)}::float8)`).join(', ')})`;
  const TODAY = `(now() AT TIME ZONE 'UTC')::date`;
  const AT = (dateExpr: string, minutes: string) => `((${dateExpr})::timestamp + make_interval(mins => ${minutes})) AT TIME ZONE 'UTC'`;
  const noReal = (table: string) => `NOT EXISTS (SELECT 1 FROM ${table} WHERE team_id = ${T} AND NOT is_sample)`;
  const PFX = `${RAW_SAMPLE_PREFIX}dep-${K}-`;
  // Per deploy: failed change when f < 0.03 + 0.45 (1 − h)^1.5; its kind by g: rolled back (< 0.35), a hotfix follows (< 0.7), else a linked incident.
  // A deploy that does not complete (result failure, not counted) when c < 0.03 + 0.08 (1 − h).
  const FAILP = `(0.03 + 0.45 * power(1 - p.h, 1.5))`;
  const NOTDONE = `(0.03 + 0.08 * (1 - p.h))`;
  const dayOfId = (col: string) => `to_date(substr(${col}, ${PFX.length + 1}, 8), 'YYYYMMDD')`;
  const SEV = (r: string) => `CASE WHEN ${r} < 0.12 THEN 'critical' WHEN ${r} < 0.45 THEN 'high' WHEN ${r} < 0.85 THEN 'medium' ELSE 'low' END`;
  const LABEL = (sev: string) => `CASE ${sev} WHEN 'critical' THEN 'P1' WHEN 'high' THEN 'P2' WHEN 'medium' THEN 'P3' ELSE 'P4' END`;
  const TITLES = arr(['Elevated error rate on %s', 'Latency above SLO on %s', 'Timeouts calling %s', 'Failed background jobs in %s', 'Partial outage of %s', 'Memory pressure on %s pods']);
  return [
    // 1. Production deploys on weekdays (more and smaller for a healthier team), and the hotfix deploys that follow some of them.
    `WITH ${P}, s AS (SELECT ${arr(v.services)} AS sv),
          cand AS (
            SELECT p.d, p.h, dd.day, k, '${PFX}' || to_char(dd.day, 'YYYYMMDD') || '-' || k AS id,
                   ${AT('dd.day', `(8 * 60 + 30 + k * 105 + floor(${R(`${T} || dd.day::text || k::text || 't'`)} * 75))::int`)} AS ts,
                   s.sv[1 + ((k + (dd.day - DATE '2000-01-01')) % 3)] AS service
              FROM p CROSS JOIN LATERAL (SELECT ${TODAY} - p.d AS day) dd, s, generate_series(0, 4) AS k
             WHERE extract(isodow FROM dd.day) < 6 AND ${R(`${T} || dd.day::text || 'skip'`)} >= 0.5 * (1 - p.h) AND k < 1 + floor(4.2 * p.h * p.h * ${R(`${T} || dd.day::text || 'n'`)})),
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
       JOIN p ON p.d = least(${days - 1}, ${TODAY} - ${dayOfId('d.id')})
       CROSS JOIN LATERAL (SELECT CASE WHEN d.is_hotfix THEN 1 ELSE 1 + floor((1.5 + 5 * (1 - p.h)) * ${R(`d.id || 'nc'`)})::int END AS n,
                                  CASE WHEN d.is_hotfix THEN 1 + 2 * ${R(`d.id || 'hl'`)} ELSE (2 + 100 * power(1 - p.h, 1.5)) * (0.4 + 1.2 * ${R(`d.id || 'lt'`)}) END AS lead) z
       CROSS JOIN LATERAL generate_series(1, z.n) AS i
      WHERE d.team_id = ${T} AND d.id LIKE '${PFX}%' AND d.is_sample
        AND NOT EXISTS (SELECT 1 FROM deployment_commits c WHERE c.team_id = d.team_id AND c.deployment_external_id = d.external_id)
     ON CONFLICT DO NOTHING`,

    // 3. Incidents: one linked to each deploy whose failure is an incident, and unlinked ones (more for a weaker team); severity P1–P4, outages are P1 / P2.
    `WITH ${P}, s AS (SELECT ${arr(v.services)} AS sv, ${TITLES} AS titles),
          linked AS (
            SELECT d.id AS src, 'INC-' || to_char(d.day, 'MMDD') || '-D' || substr(d.id, ${PFX.length + 10}) AS ext, d.service, d.external_id AS dep, p.h,
                   d.finished_at + make_interval(mins => (20 + floor(${R(`d.id || 'io'`)} * 280))::int) AS opened
              FROM deployments_raw d JOIN p ON p.d = least(${days - 1}, ${TODAY} - d.day)
             WHERE d.team_id = ${T} AND d.id LIKE '${PFX}%' AND d.id NOT LIKE '%-hf' AND d.is_sample AND d.result = 'success'
               AND ${R(`d.id || 'f'`)} < ${FAILP} AND ${R(`d.id || 'g'`)} >= 0.7 AND ${R(`d.id || 'c'`)} >= ${NOTDONE}),
          loose AS (
            SELECT '${RAW_SAMPLE_PREFIX}inc-${K}-' || to_char(dd.day, 'YYYYMMDD') || '-' || j AS src, 'INC-' || to_char(dd.day, 'MMDD') || '-' || (j + 1) AS ext,
                   s.sv[1 + floor(${R(`${T} || dd.day::text || j::text || 'sv'`)} * 3)::int] AS service, NULL::text AS dep, p.h,
                   ${AT('dd.day', `(60 + floor(${R(`${T} || dd.day::text || j::text || 'ot'`)} * 1320))::int`)} AS opened
              FROM p CROSS JOIN LATERAL (SELECT ${TODAY} - p.d AS day) dd, s, generate_series(0, 1) AS j
             -- (every team has at least one incident in the period: a quiet team still shows that it reports incidents)
             WHERE ${R(`${T} || dd.day::text || j::text || 'inc'`)} < (0.04 + 0.3 * (1 - p.h)) * CASE WHEN j = 0 THEN 1 ELSE 0.35 END OR (p.d = ${Math.min(30, days - 1)} AND j = 0)),
          a AS (SELECT * FROM linked UNION ALL SELECT * FROM loose),
          b AS (SELECT a.*, ${SEV(R(`a.src || 'sev'`))} AS sev,
                       a.opened + make_interval(mins => (4 + floor(${R(`a.src || 'ack'`)} * 26))::int) AS ack,
                       a.opened + make_interval(mins => round(60 * (0.3 + 9 * power(1 - a.h, 1.3)) * (0.3 + 1.4 * ${R(`a.src || 'dur'`)}))::int) AS res,
                       CASE WHEN ${R(`a.src || 'cat'`)} < 0.35 THEN 'infrastructure' ELSE 'application' END AS cat
                  FROM a)
     INSERT INTO incidents_raw (id, company_id, team_id, external_id, title, severity, severity_label, service, status, opened_at, acknowledged_at, resolved_at, day,
                                outage, category, deployment_external_id, source, url, is_sample, created_at)
     SELECT CASE WHEN dep IS NULL THEN src ELSE '${RAW_SAMPLE_PREFIX}inc-${K}-' || substr(md5(src), 1, 14) END, ${CO}, ${T}, ext,
            replace((SELECT titles[1 + floor(${R(`b.src || 'title'`)} * 6)::int] FROM s), '%s', b.service), sev, ${LABEL('sev')}, service,
            CASE WHEN res <= now() THEN 'resolved' WHEN ack <= now() THEN 'acknowledged' ELSE 'open' END,
            opened, CASE WHEN ack <= now() THEN ack END, CASE WHEN res <= now() THEN res END, (opened AT TIME ZONE 'UTC')::date,
            NULL, cat, dep, 'pagerduty', NULL, TRUE, opened
       FROM b WHERE opened <= now() - interval '5 minutes' AND ${noReal('incidents_raw')}
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, acknowledged_at = EXCLUDED.acknowledged_at, resolved_at = EXCLUDED.resolved_at
       WHERE incidents_raw.is_sample AND (incidents_raw.resolved_at IS DISTINCT FROM EXCLUDED.resolved_at OR incidents_raw.acknowledged_at IS DISTINCT FROM EXCLUDED.acknowledged_at)`,

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

export function rawSampleSql(teams: RawSampleTeam[], days = RAW_SAMPLE_DAYS): string[] {
  return teams.flatMap((t) => rawSampleSqlForTeam(t, days));
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

/** After the sample SQL ran: the evidence of the sample days (metric_evidence; never KPI values). */
export async function computeSampleEvidence(client: pg.PoolClient, teamIds: string[], days = RAW_SAMPLE_DAYS): Promise<number> {
  const list: string[] = [];
  for (let i = days - 1; i >= 0; i--) list.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  let n = 0;
  for (const id of teamIds) {
    // Only the groups whose raw data is sample data (a team with real CI data keeps its own values).
    const g = (await client.query(
      `SELECT EXISTS (SELECT 1 FROM test_runs WHERE team_id = $1 AND is_sample) AND NOT EXISTS (SELECT 1 FROM test_runs WHERE team_id = $1 AND NOT is_sample) AS ci,
              (EXISTS (SELECT 1 FROM deployments_raw WHERE team_id = $1 AND is_sample) OR EXISTS (SELECT 1 FROM incidents_raw WHERE team_id = $1 AND is_sample))
                AND NOT EXISTS (SELECT 1 FROM deployments_raw WHERE team_id = $1 AND NOT is_sample) AND NOT EXISTS (SELECT 1 FROM incidents_raw WHERE team_id = $1 AND NOT is_sample) AS delivery`,
      [id])).rows[0];
    // Phase 3 (issues, static analysis): only on a database with its tables.
    const w = (await client.query(`SELECT to_regclass('public.issues') IS NOT NULL AS ok`)).rows[0]?.ok
      ? (await client.query(
        `SELECT EXISTS (SELECT 1 FROM issues WHERE team_id = $1 AND is_sample) AND NOT EXISTS (SELECT 1 FROM issues WHERE team_id = $1 AND NOT is_sample) AS work,
                EXISTS (SELECT 1 FROM analysis_reports WHERE team_id = $1 AND is_sample) AND NOT EXISTS (SELECT 1 FROM analysis_reports WHERE team_id = $1 AND NOT is_sample) AS quality`, [id])).rows[0]
      : null;
    const groups: MetricGroup[] = [...(g?.ci ? ['ci' as const] : []), ...(g?.delivery ? ['delivery' as const] : []), ...(w?.work ? ['work' as const] : []), ...(w?.quality ? ['quality' as const] : [])];
    if (!groups.length) continue;
    const res = await recomputeTeamDays(client, id, list, { writeKpis: false, groups });
    n += res.reduce((k, d) => k + d.metrics.length, 0);
  }
  return n;
}
