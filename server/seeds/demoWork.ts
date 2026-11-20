/**
 * Sample (demo) issues and static-analysis reports for v2 phase 3, for the last year, DERIVED FROM THE
 * TEAM'S OWN KPI HISTORY so that the values QE Navigator calculates from them match what the team's
 * pages already show (no number that contradicts them):
 *
 *   sprints        the team's sprints of sprint_velocity (names and dates as the app shows them); per
 *                  closed sprint, stories and tasks whose story points add up to its committed points,
 *                  the delivered points completed before the sprint closed and the rest carried over into
 *                  the next sprint (and completed there); time logged against the original estimate in the
 *                  ratio of sizing_accuracy, and blocked periods adding up to blocked_time_hours (both from
 *                  the KPI snapshot of the sprint's last day)
 *   bugs           per two weeks (the sprint periods), bugs found in production and before release so that
 *                  over 28 days the escape rate is defect_escape_rate and production bugs ÷ KLOC is
 *                  defect_density (KLOC from the team's latest coverage report), with cumulative rounding;
 *                  a few bugs without an environment and a few closed as Cannot Reproduce (not counted)
 *   SARIF reports  a weekly SonarQube report (Friday) whose findings by severity give the code_quality_score
 *                  of that day with the scoring formula (server/lib/calc/quality.ts), findings that persist
 *                  between reports (new and fixed ones every week)
 *
 * Plain SQL (PL/pgSQL blocks), so the same statements fill the demo seed, the nightly sample refresh and
 * a live company (scripts/reseed/raw-sample-sql.ts --work-only). Rows are sample rows: ids start with
 * "demo-raw-", is_sample = true; evidence only, never written to the KPI storage. Idempotent: what exists
 * is skipped, so the nightly refresh adds the new sprint, bugs and report only. A team with real issues
 * (or real reports) gets none. The blocks do nothing on a database without the phase-3 tables.
 */
import { createHash } from 'crypto';
import { RAW_SAMPLE_PREFIX, vocabularyFor } from './demoRaw';
import { SCORE_SCALE, SEVERITY_WEIGHTS } from '../lib/calc/quality';

export interface WorkSampleTeam { id: string; companyId: string; name: string }

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const arr = (xs: string[]) => `ARRAY[${xs.map(lit).join(', ')}]::text[]`;
const short = (id: string) => createHash('md5').update(id).digest('hex').slice(0, 8);
/** Uniform [0, 1) from an md5 of a text expression (PL/pgSQL). */
const R = (seed: string) => `((('x' || substr(md5(${seed}), 1, 8))::bit(32)::int::bigint & 2147483647)::float8 / 2147483647.0)`;

/** PAY, LEND, MOB, … from the team name. */
export function projectKey(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !['THE', 'A', 'AN', 'OF', 'AND'].includes(w));
  if (!words.length) return 'TEAM';
  if (words.length === 1) return words[0].slice(0, 4);
  const first = words[0];
  return first.length <= 4 ? first : first.slice(0, 3);
}
export const repoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';

const RULES: Record<'critical' | 'high' | 'medium' | 'low', Array<[string, string, string]>> = {
  critical: [
    ['typescript:S2068', 'Credentials should not be hard-coded', 'Remove this hard-coded password.'],
    ['typescript:S5852', 'Regular expressions should not be vulnerable to denial of service', 'Make sure the regex used here cannot lead to denial of service.'],
  ],
  high: [
    ['typescript:S3776', 'Cognitive complexity of functions should not be too high', 'Refactor this function to reduce its cognitive complexity from 24 to the 15 allowed.'],
    ['typescript:S4123', '"await" should only be used with promises', 'Refactor this redundant "await" on a non-promise.'],
    ['typescript:S5332', 'Using clear-text protocols is security-sensitive', 'Using http protocol is insecure. Use https instead.'],
  ],
  medium: [
    ['typescript:S1854', 'Unused assignments should be removed', 'Remove this useless assignment to variable "result".'],
    ['typescript:S3358', 'Ternary operators should not be nested', 'Extract this nested ternary operation into an independent statement.'],
    ['typescript:S6551', 'Objects and classes converted or coerced to strings should define a "toString()" method', '"error" will use Object\'s default stringification format.'],
    ['typescript:S1871', 'Two branches in a conditional structure should not have exactly the same implementation', 'This branch\'s code block is the same as the block for the branch on line 41.'],
  ],
  low: [
    ['typescript:S1481', 'Unused local variables should be removed', 'Remove the declaration of the unused "tmp" variable.'],
    ['typescript:S1128', 'Unnecessary imports should be removed', 'Remove this unused import of "format".'],
    ['typescript:S6606', 'Nullish coalescing should be preferred', 'Prefer using nullish coalescing operator (`??`) instead of a logical or (`||`).'],
    ['typescript:S4325', 'Redundant casts and non-null assertions should be avoided', 'This assertion is unnecessary since it does not change the type of the expression.'],
  ],
};
const CHURN = { critical: 0.08, high: 0.25, medium: 0.6, low: 1.2 };

/** The statements that add the sample issues and reports of one team (run in order). */
export function workSampleSqlForTeam(team: WorkSampleTeam): string[] {
  const T = lit(team.id);
  const CO = lit(team.companyId);
  const K = short(team.id);
  const PFX = `${RAW_SAMPLE_PREFIX}w-${K}-`;
  const PK = lit(projectKey(team.name));
  const v = vocabularyFor(team.name);
  const verbs = ['Add', 'Fix', 'Refactor', 'Support', 'Validate', 'Show', 'Speed up', 'Log', 'Retry', 'Migrate', 'Simplify', 'Cache'];
  const bugTitles = ['Error when saving', 'Wrong total shown for', 'Timeout loading', 'Duplicate entry created for', 'Crash after updating', 'Missing translation in', 'Rounding error in', 'Stale data shown for'];
  const sev = (k: 'critical' | 'high' | 'medium' | 'low', v: string) => `rid_${v} := ${arr(RULES[k].map((r) => r[0]))}; rnm_${v} := ${arr(RULES[k].map((r) => r[1]))}; rms_${v} := ${arr(RULES[k].map((r) => r[2]))};`;

  const issues = `DO $work$
DECLARE
  t text := ${T}; co text := ${CO}; pfx text := ${lit(PFX)}; pk text := ${PK};
  objects text[] := ${arr(v.objects)}; areas text[] := ${arr(v.areas)}; verbs text[] := ${arr(verbs)}; bug_titles text[] := ${arr(bugTitles)};
  pre_envs text[] := ARRAY['Staging', 'QA', 'Development', 'UAT']::text[];
  sizes int[] := ARRAY[1, 2, 3, 5, 8];
  kloc float8; sp record; snap_b float8; snap_s float8; snap_e float8; snap_d float8; prev_sid text; sid text; s_start timestamptz; s_end timestamptz;
  carried int; rem int; pts int; idx int; seq int; nblock int; bh float8; iid text; ikey text; base int;
  created timestamptz; t1 timestamptz; res timestamptz; est float8; tb timestamptz; tsum float8; lsum float8;
  anchor date; ps date; pe date; acc_e float8 := 0; acc_n float8 := 0; x_e float8; x_n float8; k int; r float8;
  env text; bid text; bopen timestamptz; bres timestamptz; first_period date;
BEGIN
  IF to_regclass('public.issues') IS NULL OR to_regclass('public.sprint_velocity') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM issues WHERE team_id = t AND NOT is_sample) THEN RETURN; END IF;
  SELECT lines_found / 1000.0 INTO kloc FROM coverage_reports WHERE team_id = t AND lines_found > 0 ORDER BY created_at DESC LIMIT 1;
  kloc := COALESCE(kloc, 5.0);

  -- 1. Sprints: stories and tasks per closed sprint of sprint_velocity.
  prev_sid := NULL;
  FOR sp IN SELECT sprint_name, start_date, end_date, committed_points, delivered_points FROM sprint_velocity
             WHERE team_id = t AND end_date >= (now() AT TIME ZONE 'UTC')::date - 372 ORDER BY end_date LOOP
    sid := pk || '-' || regexp_replace(sp.sprint_name, '[^A-Za-z0-9]+', '-', 'g');
    s_start := (sp.start_date::timestamp + interval '9 hours') AT TIME ZONE 'UTC';
    s_end := (sp.end_date::timestamp + interval '15 hours') AT TIME ZONE 'UTC';
    IF s_end > now() THEN EXIT; END IF;
    IF EXISTS (SELECT 1 FROM issue_sprints WHERE team_id = t AND external_id = sid) THEN prev_sid := sid; CONTINUE; END IF;
    snap_b := NULL; snap_s := NULL;
    SELECT blocked_time_hours::float8, sizing_accuracy::float8 INTO snap_b, snap_s FROM kpi_snapshots
     WHERE team_id = t AND snapshot_date <= sp.end_date ORDER BY snapshot_date DESC LIMIT 1;
    INSERT INTO issue_sprints (id, company_id, team_id, external_id, name, state, started_at, ends_at, completed_at, is_sample)
    VALUES (pfx || 'sp-' || substr(md5(sid), 1, 12), co, t, sid, sp.sprint_name, 'closed', s_start, s_end, s_end, TRUE) ON CONFLICT DO NOTHING;
    -- Issue numbers: stories and tasks from the sprint's start day (room for 199 a sprint), bugs from 500000.
    base := (sp.start_date - DATE '2025-01-01') * 200;
    -- Carried over from the previous sprint: in this sprint from its start, completed in it.
    carried := 0;
    IF prev_sid IS NOT NULL THEN
      FOR iid, pts IN SELECT id, COALESCE(story_points, 0)::int FROM issues WHERE team_id = t AND is_sample AND sprint_ids @> ARRAY[prev_sid]::varchar[] AND status_category <> 'done' AND issue_type <> 'bug' LOOP
        res := s_start + make_interval(hours => (8 + floor(${R(`iid || 'cres'`)} * 150))::int);
        UPDATE issues SET sprint_ids = sprint_ids || ARRAY[sid]::varchar[], status = 'Done', status_category = 'done', resolution = 'Done', resolved_at = res, source_updated_at = res, updated_at = now()
         WHERE id = iid;
        INSERT INTO issue_transitions (id, issue_id, team_id, field, from_value, to_value, to_category, at)
        VALUES (substr(md5(iid || '-done'), 1, 32), iid, t, 'status', 'In Progress', 'Done', 'done', res) ON CONFLICT DO NOTHING;
        carried := carried + pts;
      END LOOP;
    END IF;
    -- Blocked time of the sprint, spread over a few of its completed issues.
    nblock := CASE WHEN COALESCE(snap_b, 0) > 0 THEN greatest(1, ceil(snap_b / 9.0)::int) ELSE 0 END;
    bh := CASE WHEN nblock > 0 THEN snap_b / nblock ELSE 0 END;
    seq := 0;
    FOR k IN 0..1 LOOP
      rem := CASE WHEN k = 0 THEN greatest(0, sp.delivered_points - carried) ELSE greatest(0, sp.committed_points - sp.delivered_points) END;
      WHILE rem > 0 LOOP
        seq := seq + 1;
        iid := pfx || substr(md5(sid || '-' || seq), 1, 14);
        idx := 1 + floor(${R(`iid || 'pts'`)} * 5)::int;
        WHILE sizes[idx] > rem LOOP idx := idx - 1; END LOOP;
        EXIT WHEN seq > 199;
        pts := sizes[idx];
        rem := rem - pts;
        ikey := pk || '-' || (base + seq);
        created := s_start - make_interval(hours => (24 + floor(${R(`iid || 'cr'`)} * 480))::int);
        t1 := s_start + make_interval(mins => (90 + floor(${R(`iid || 't1'`)} * 3 * 1440))::int);
        est := round((pts * 4 * (0.75 + 0.5 * ${R(`iid || 'est'`)}))::numeric * 2) / 2.0;
        IF k = 0 THEN
          res := least(s_end - interval '2 hours', t1 + make_interval(hours => (10 + floor(${R(`iid || 'res'`)} * 140))::int));
          IF seq <= nblock THEN
            tb := t1 + interval '1 hour';
            res := greatest(res, tb + make_interval(secs => round(bh * 3600)::int) + interval '2 hours');
          END IF;
        END IF;
        INSERT INTO issues (id, company_id, team_id, external_id, source, title, issue_type, type_label, status, status_category, resolution, priority,
                            story_points, estimate_hours, time_logged_hours, sprint_ids, labels, components, opened_at, resolved_at, source_updated_at, day, is_sample, created_at)
        VALUES (iid, co, t, ikey, 'jira',
                verbs[1 + floor(${R(`iid || 'v'`)} * 12)::int] || ' ' || objects[1 + floor(${R(`iid || 'o'`)} * 14)::int],
                CASE WHEN ${R(`iid || 'ty'`)} < 0.72 THEN 'story' ELSE 'task' END, CASE WHEN ${R(`iid || 'ty'`)} < 0.72 THEN 'Story' ELSE 'Task' END,
                CASE WHEN k = 0 THEN 'Done' ELSE 'In Progress' END, CASE WHEN k = 0 THEN 'done' ELSE 'in_progress' END, CASE WHEN k = 0 THEN 'Done' END, 'Medium',
                pts, est, CASE WHEN k = 1 THEN round((est * 0.45)::numeric, 2) END, ARRAY[sid]::varchar[], ARRAY[]::varchar[],
                ARRAY[areas[1 + floor(${R(`iid || 'ar'`)} * 6)::int]]::varchar[], created, CASE WHEN k = 0 THEN res END, COALESCE(CASE WHEN k = 0 THEN res END, t1), (created AT TIME ZONE 'UTC')::date, TRUE, created)
        ON CONFLICT DO NOTHING;
        INSERT INTO issue_transitions (id, issue_id, team_id, field, from_value, to_value, to_category, at)
        VALUES (substr(md5(iid || '-start'), 1, 32), iid, t, 'status', 'To Do', 'In Progress', 'in_progress', t1) ON CONFLICT DO NOTHING;
        IF k = 0 AND seq <= nblock THEN
          INSERT INTO issue_transitions (id, issue_id, team_id, field, from_value, to_value, to_category, at) VALUES
            (substr(md5(iid || '-blk'), 1, 32), iid, t, 'status', 'In Progress', 'Blocked', 'blocked', tb),
            (substr(md5(iid || '-unb'), 1, 32), iid, t, 'status', 'Blocked', 'In Progress', 'in_progress', tb + make_interval(secs => round(bh * 3600)::int)) ON CONFLICT DO NOTHING;
        END IF;
        IF k = 0 THEN
          INSERT INTO issue_transitions (id, issue_id, team_id, field, from_value, to_value, to_category, at) VALUES
            (substr(md5(iid || '-rev'), 1, 32), iid, t, 'status', 'In Progress', 'In Review', 'in_progress', greatest(res - make_interval(mins => (60 + floor(${R(`iid || 'rv'`)} * 600))::int), CASE WHEN seq <= nblock THEN tb + make_interval(secs => round(bh * 3600)::int) + interval '30 minutes' ELSE t1 + interval '1 hour' END)),
            (substr(md5(iid || '-done'), 1, 32), iid, t, 'status', 'In Review', 'Done', 'done', res) ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END LOOP;
    -- Time logged on the sprint's completed issues: total ÷ total estimate = the sprint's sizing accuracy.
    IF snap_s IS NOT NULL AND snap_s > 0 THEN
      UPDATE issues SET time_logged_hours = round((estimate_hours * snap_s * (0.8 + 0.4 * ${R(`id || 'lg'`)}))::numeric, 2)
       WHERE team_id = t AND is_sample AND sprint_ids @> ARRAY[sid]::varchar[] AND status_category = 'done' AND resolved_at <= s_end + interval '1 hour' AND estimate_hours > 0;
      SELECT sum(estimate_hours)::float8, sum(time_logged_hours)::float8 INTO tsum, lsum FROM issues
       WHERE team_id = t AND is_sample AND sprint_ids @> ARRAY[sid]::varchar[] AND status_category = 'done' AND resolved_at <= s_end + interval '1 hour' AND estimate_hours > 0;
      IF lsum > 0 THEN
        UPDATE issues SET time_logged_hours = round((time_logged_hours * (snap_s * tsum / lsum))::numeric, 2)
         WHERE team_id = t AND is_sample AND sprint_ids @> ARRAY[sid]::varchar[] AND status_category = 'done' AND resolved_at <= s_end + interval '1 hour' AND estimate_hours > 0;
      END IF;
    END IF;
    prev_sid := sid;
  END LOOP;

  -- 2. Bugs per two-week period (the sprint periods, continued after the last sprint), from a fixed start so
  --    every run gives the same bugs. Production and pre-release bugs each arrive at a steady rate (the period's
  --    target ÷ 14 days): the n-th bug opens when the running total crosses n, so every 28 days hold the target.
  SELECT max(end_date) + 1 INTO anchor FROM sprint_velocity WHERE team_id = t;
  IF anchor IS NULL THEN RETURN; END IF;
  first_period := anchor - 14 * ((anchor - DATE '2025-01-01') / 14);
  ps := first_period;
  WHILE ps <= (now() AT TIME ZONE 'UTC')::date LOOP
    pe := ps + 14;
    snap_e := NULL; snap_d := NULL;
    SELECT defect_escape_rate::float8, defect_density::float8 INTO snap_e, snap_d FROM kpi_snapshots
     WHERE team_id = t AND snapshot_date <= least(pe - 1, (now() AT TIME ZONE 'UTC')::date) ORDER BY snapshot_date DESC LIMIT 1;
    IF snap_e IS NOT NULL AND snap_d IS NOT NULL AND snap_e > 0 THEN
      x_e := snap_d * kloc / 2.0;
      x_n := greatest(0, x_e / (snap_e / 100.0) - x_e);
      base := 500000 + (ps - DATE '2025-01-01') * 300;
      -- k: 1..100 production bugs, 101..200 pre-release bugs, 201..202 extras.
      FOR k IN 1..230 LOOP
        IF k <= 100 THEN
          CONTINUE WHEN k > floor(acc_e + x_e)::int - floor(acc_e)::int;
          r := (floor(acc_e)::int + k - acc_e) / x_e;
          env := 'Production';
        ELSIF k <= 200 THEN
          CONTINUE WHEN k - 100 > floor(acc_n + x_n)::int - floor(acc_n)::int;
          r := (floor(acc_n)::int + (k - 100) - acc_n) / x_n;
          env := pre_envs[1 + floor(${R(`t || ps::text || k::text || 'en'`)} * 4)::int];
        ELSE
          -- Extras (not counted): now and then one without an environment, or closed as Cannot Reproduce.
          CONTINUE WHEN k > 202 OR ${R(`t || ps::text || k::text || 'x'`)} >= 0.35;
          r := ${R(`t || ps::text || k::text || 'xt'`)};
          env := CASE WHEN ${R(`t || ps::text || k::text || 'xe'`)} < 0.55 THEN NULL ELSE 'Production' END;
        END IF;
        CONTINUE WHEN ps < (now() AT TIME ZONE 'UTC')::date - 372;
        bid := pfx || 'b-' || to_char(ps, 'YYYYMMDD') || '-' || k;
        bopen := (ps::timestamp AT TIME ZONE 'UTC') + make_interval(mins => floor(least(0.9999, greatest(0, r)) * 14 * 1440)::int);
        CONTINUE WHEN bopen > now() - interval '30 minutes';
        -- The extras are closed within two days (never counted while still open).
        CONTINUE WHEN k > 200 AND bopen > now() - interval '3 days';
        bres := bopen + make_interval(hours => CASE WHEN k > 200 THEN 4 + floor(${R(`bid || 'rs'`)} * 40) ELSE 6 + floor(${R(`bid || 'rs'`)} * 140) END::int);
        INSERT INTO issues (id, company_id, team_id, external_id, source, title, issue_type, type_label, status, status_category, resolution, priority, environment, found_in,
                            sprint_ids, labels, components, opened_at, resolved_at, source_updated_at, day, is_sample, created_at)
        VALUES (bid, co, t, pk || '-' || (base + k), 'jira',
                bug_titles[1 + floor(${R(`bid || 'ti'`)} * 8)::int] || ' ' || objects[1 + floor(${R(`bid || 'ob'`)} * 14)::int],
                'bug', 'Bug', CASE WHEN bres <= now() THEN 'Done' ELSE 'In Progress' END, CASE WHEN bres <= now() THEN 'done' ELSE 'in_progress' END,
                CASE WHEN bres > now() THEN NULL WHEN k > 200 AND env IS NOT NULL THEN 'Cannot Reproduce' ELSE 'Done' END,
                CASE WHEN env = 'Production' AND ${R(`bid || 'pr'`)} < 0.4 THEN 'High' ELSE 'Medium' END, env,
                CASE WHEN env IS NULL THEN NULL WHEN env = 'Production' THEN 'production' ELSE 'pre_release' END,
                ARRAY[]::varchar[], CASE WHEN env = 'Production' THEN ARRAY['customer-reported']::varchar[] ELSE ARRAY[]::varchar[] END,
                ARRAY[areas[1 + floor(${R(`bid || 'ar'`)} * 6)::int]]::varchar[], bopen, CASE WHEN bres <= now() THEN bres END, least(bres, now()), (bopen AT TIME ZONE 'UTC')::date, TRUE, bopen)
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, status_category = EXCLUDED.status_category, resolution = EXCLUDED.resolution, resolved_at = EXCLUDED.resolved_at,
                                       source_updated_at = EXCLUDED.source_updated_at, updated_at = now()
          WHERE issues.is_sample AND issues.resolved_at IS DISTINCT FROM EXCLUDED.resolved_at;
      END LOOP;
      acc_e := acc_e + x_e;
      acc_n := acc_n + x_n;
    END IF;
    ps := pe;
  END LOOP;
END $work$`;

  const W = SEVERITY_WEIGHTS;
  const sarif = `DO $sarif$
DECLARE
  t text := ${T}; co text := ${CO}; pfx text := ${lit(PFX)}; repo text := ${lit(`${repoSlug(team.name)}`)};
  areas text[] := ${arr(v.areas)}; kinds text[] := ARRAY['service', 'controller', 'repository', 'validator', 'mapper', 'client', 'handler', 'utils']::text[];
  sev text[] := ARRAY['critical', 'high', 'medium', 'low']::text[];
  churn float8[] := ARRAY[${CHURN.critical}, ${CHURN.high}, ${CHURN.medium}, ${CHURN.low}]::float8[];
  rid_c text[]; rnm_c text[]; rms_c text[]; rid_h text[]; rnm_h text[]; rms_h text[]; rid_m text[]; rnm_m text[]; rms_m text[]; rid_l text[]; rnm_l text[]; rms_l text[];
  ids text[]; names text[]; msgs text[];
  kloc float8; d date; at timestamptz; q float8; w float8; rem float8; cnt int[]; si int; a int; i int; wk int; rep text; prev text; fp text;
BEGIN
  IF to_regclass('public.analysis_reports') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM analysis_reports WHERE team_id = t AND NOT is_sample) THEN RETURN; END IF;
  SELECT lines_found / 1000.0 INTO kloc FROM coverage_reports WHERE team_id = t AND lines_found > 0 ORDER BY created_at DESC LIMIT 1;
  kloc := COALESCE(kloc, 5.0);
  ${sev('critical', 'c')}
  ${sev('high', 'h')}
  ${sev('medium', 'm')}
  ${sev('low', 'l')}
  -- Every Friday of the last year (17:00 UTC), oldest first.
  d := (now() AT TIME ZONE 'UTC')::date - 364;
  d := d + ((5 - extract(isodow FROM d)::int + 7) % 7);
  prev := NULL;
  WHILE d <= (now() AT TIME ZONE 'UTC')::date LOOP
    at := (d::timestamp + interval '17 hours') AT TIME ZONE 'UTC';
    EXIT WHEN at > now();
    rep := pfx || 'sa-' || to_char(d, 'YYYYMMDD');
    IF EXISTS (SELECT 1 FROM analysis_reports WHERE id = rep) THEN prev := rep; d := d + 7; CONTINUE; END IF;
    SELECT code_quality_score::float8 INTO q FROM kpi_snapshots WHERE team_id = t AND snapshot_date <= d ORDER BY snapshot_date DESC LIMIT 1;
    IF q IS NULL OR q <= 0 THEN d := d + 7; CONTINUE; END IF;
    -- Weighted findings that give this score: 100 × e^(−w ÷ KLOC ÷ ${SCORE_SCALE}) = q.
    w := -${SCORE_SCALE} * ln(least(q, 100) / 100.0) * kloc;
    cnt := ARRAY[0, 0, 0, 0];
    cnt[1] := floor(w / 45)::int; rem := w - ${W.critical} * cnt[1];
    cnt[2] := floor(rem / 12)::int; rem := rem - ${W.high} * cnt[2];
    cnt[3] := floor(rem / 3)::int; rem := rem - ${W.medium} * cnt[3];
    cnt[4] := round(rem / ${W.low})::int;
    wk := (d - DATE '2025-01-03') / 7;
    INSERT INTO analysis_reports (id, company_id, team_id, tool, tool_version, repo, branch, commit_sha, run_id, attempt, analyzed_at, day, lines_of_code,
                                  findings, critical, high, medium, low, info, suppressed, rules, is_sample, created_at)
    VALUES (rep, co, t, 'SonarQube', '10.6', repo, 'main', substr(md5(t || d::text || 'sa'), 1, 12), 'sonar-' || to_char(d, 'YYYYMMDD'), 1, at, d, round(kloc * 1000)::int,
            cnt[1] + cnt[2] + cnt[3] + cnt[4], cnt[1], cnt[2], cnt[3], cnt[4], 0, floor(${R(`t || d::text || 'sup'`)} * 4)::int, 0, TRUE, at)
    ON CONFLICT DO NOTHING;
    FOR si IN 1..4 LOOP
      ids := CASE si WHEN 1 THEN rid_c WHEN 2 THEN rid_h WHEN 3 THEN rid_m ELSE rid_l END;
      names := CASE si WHEN 1 THEN rnm_c WHEN 2 THEN rnm_h WHEN 3 THEN rnm_m ELSE rnm_l END;
      msgs := CASE si WHEN 1 THEN rms_c WHEN 2 THEN rms_h WHEN 3 THEN rms_m ELSE rms_l END;
      a := floor(churn[si] * wk)::int;
      FOR i IN a..(a + cnt[si] - 1) LOOP
        fp := substr(md5(t || sev[si] || i::text), 1, 40);
        INSERT INTO analysis_findings (id, report_id, team_id, fingerprint, rule_id, rule_name, severity, level, category, message, path, line)
        VALUES (substr(md5(rep || fp), 1, 32), rep, t, fp, ids[1 + i % array_length(ids, 1)], names[1 + i % array_length(ids, 1)], sev[si],
                CASE si WHEN 1 THEN 'error' WHEN 2 THEN 'error' WHEN 3 THEN 'warning' ELSE 'note' END,
                CASE WHEN ids[1 + i % array_length(ids, 1)] IN ('typescript:S2068', 'typescript:S5852', 'typescript:S5332') THEN 'security' WHEN si <= 2 THEN 'reliability' ELSE 'maintainability' END,
                msgs[1 + i % array_length(ids, 1)], 'src/' || areas[1 + (i * 7 + si) % 6] || '/' || kinds[1 + (i * 5 + si) % 8] || '.ts', 8 + floor(${R(`fp || 'ln'`)} * 380)::int)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;
    UPDATE analysis_reports SET rules = (SELECT COUNT(DISTINCT rule_id) FROM analysis_findings WHERE report_id = rep) WHERE id = rep;
    IF prev IS NOT NULL THEN
      UPDATE analysis_findings f SET is_new = NOT EXISTS (SELECT 1 FROM analysis_findings p WHERE p.report_id = prev AND p.fingerprint = f.fingerprint) WHERE f.report_id = rep;
      UPDATE analysis_reports SET previous_report_id = prev,
             new_findings = (SELECT COUNT(*) FROM analysis_findings WHERE report_id = rep AND is_new)::int,
             fixed_findings = (SELECT COUNT(*) FROM analysis_findings p WHERE p.report_id = prev AND NOT EXISTS (SELECT 1 FROM analysis_findings f WHERE f.report_id = rep AND f.fingerprint = p.fingerprint))::int
       WHERE id = rep;
    END IF;
    prev := rep;
    d := d + 7;
  END LOOP;
END $sarif$`;
  return [issues, sarif];
}

/** Clear statements (with the other sample data). */
export const WORK_SAMPLE_CLEAR: Array<{ table: string; sql: string }> = [
  { table: 'metric_evidence', sql: `DELETE FROM metric_evidence e WHERE e.metric_key IN ('escape_rate', 'defect_density', 'velocity', 'commitment', 'carryover', 'blocked_time', 'sizing_accuracy') AND EXISTS (SELECT 1 FROM issues i WHERE i.team_id = e.team_id AND i.is_sample) AND NOT EXISTS (SELECT 1 FROM issues i WHERE i.team_id = e.team_id AND NOT i.is_sample)` },
  { table: 'metric_evidence', sql: `DELETE FROM metric_evidence e WHERE e.metric_key IN ('code_quality', 'findings', 'new_findings', 'fixed_findings') AND EXISTS (SELECT 1 FROM analysis_reports r WHERE r.team_id = e.team_id AND r.is_sample) AND NOT EXISTS (SELECT 1 FROM analysis_reports r WHERE r.team_id = e.team_id AND NOT r.is_sample)` },
  { table: 'analysis_reports', sql: `DELETE FROM analysis_reports WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
  { table: 'issues', sql: `DELETE FROM issues WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
  { table: 'issue_sprints', sql: `DELETE FROM issue_sprints WHERE id LIKE '${RAW_SAMPLE_PREFIX}%'` },
];
