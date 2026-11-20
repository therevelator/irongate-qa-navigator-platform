-- Meridian Financial Technologies: Scrum wording on top of the generated sample history
-- (scripts/reseed/README.md). Run after `npm run seed:demo -- --fill-existing --company mft-meridian`.
-- Two-week sprints from Monday 2026-11-09 = Sprint 47 (build.sh: SAMPLE_SPRINT_RELEASES=2026-11-09);
-- sprint n starts on 2026-11-09 + (n - 47) * 14 days.

-- Tracked actions read like retrospective actions of the sprint they were agreed in.
UPDATE public.team_actions
   SET title = left('Sprint ' || (47 + floor((created_at::date - DATE '2026-11-09') / 14.0))::int || ' retro: ' || title, 200)
 WHERE company_id = 'mft-meridian' AND title NOT LIKE 'Sprint % retro:%';

-- Saved views named for the Scrum events they are used in.
UPDATE public.saved_views SET name = CASE name
    WHEN 'Needs attention' THEN 'Sprint review: teams needing attention'
    WHEN 'Lowest coverage first' THEN 'Quality review: lowest coverage first'
    WHEN 'Weakest QA scores' THEN 'Engineering review: weakest QA scores'
    WHEN 'Flaky tests: Lending Journey' THEN 'Lending Journey retro: flaky tests'
    ELSE name END
 WHERE company_id = 'mft-meridian';

-- Pulse comments in the voice of each team's retrospective (anonymous, as always).
WITH c(team_id, n, txt) AS (VALUES
  ('mft-team-payments-core-116', 0, 'Good sprint: the refactor of the ledger posting landed without drama.'),
  ('mft-team-payments-core-116', 1, 'Pairing on the settlement batch worked well, keep doing it.'),
  ('mft-team-payments-core-116', 2, 'Review lead time is short again, thanks to the smaller PRs.'),
  ('mft-team-payments-core-116', 3, 'Release went out on the last day of the sprint with no rollback.'),
  ('mft-team-lending-journey-64', 0, 'Too many escaped defects from the credit decision step, we keep firefighting.'),
  ('mft-team-lending-journey-64', 1, 'The flaky onboarding tests block merges every day.'),
  ('mft-team-lending-journey-64', 2, 'Scope changed twice mid-sprint; hard to plan.'),
  ('mft-team-lending-journey-64', 3, 'On-call this sprint was exhausting.'),
  ('mft-team-mobile-experience-140', 0, 'Things are better since we split the release train from the app store review.'),
  ('mft-team-mobile-experience-140', 1, 'The new device farm runs cut our test time a lot.'),
  ('mft-team-mobile-experience-140', 2, 'Still some carry-over, but much less than last quarter.'),
  ('mft-team-mobile-experience-140', 3, 'Retro actions are actually getting done now.'))
UPDATE public.pulse_responses r SET comment = c.txt
  FROM c
 WHERE r.company_id = 'mft-meridian' AND r.comment IS NOT NULL AND c.team_id = r.team_id
   AND c.n = ('x' || substr(md5(r.id), 1, 8))::bit(32)::int & 3;

-- Company KPI targets were set by the CTO when the company started (onboarding: "Set KPI targets").
UPDATE public.target_history SET changed_by = 'mft-u-eleanor-vance' WHERE company_id = 'mft-meridian' AND changed_by IS NULL;
INSERT INTO public.audit_log (id, company_id, actor_id, action, entity_type, entity_id, summary, before, after, department_ids, subject_ids, created_at)
SELECT 'mft-audit-targets-initial', 'mft-meridian', 'mft-u-eleanor-vance', 'targets.update', 'config', 'mft-meridian',
       'Set the company KPI targets (' || count(*) || ' metrics)', NULL, jsonb_object_agg(metric_key, jsonb_build_object('good', good, 'warning', warning)),
       '{}'::varchar[], ARRAY['mft-meridian']::varchar[], min(valid_from)
  FROM public.target_history WHERE company_id = 'mft-meridian' AND scope_type = 'company'
ON CONFLICT DO NOTHING;

-- Data arrives from CI: an API key used by GitHub Actions and Jenkins, and its ingestion log
-- (every working day per team since GitHub Actions replaced Jenkins; a few partial pushes with an unknown metric).
INSERT INTO public.api_keys (id, company_id, name, key_prefix, key_hash, created_by, created_at, last_used_at, revoked_at) VALUES
  ('mft-key-github-actions', 'mft-meridian', 'GitHub Actions (CI)', 'igk_mft7Qh2', encode(sha256(convert_to('mft-key-github-actions-' || gen_random_uuid()::text, 'UTF8')), 'hex'), 'mft-u-marcus-reid', now() - interval '360 days', now() - interval '3 hours', NULL),
  ('mft-key-jenkins-old', 'mft-meridian', 'Jenkins (retired)', 'igk_mftJk9x', encode(sha256(convert_to('mft-key-jenkins-old-' || gen_random_uuid()::text, 'UTF8')), 'hex'), 'mft-u-marcus-reid', now() - interval '390 days', now() - interval '200 days', now() - interval '190 days')
ON CONFLICT DO NOTHING;
INSERT INTO public.ingestion_log (id, company_id, api_key_id, actor_id, channel, source, received_at, status, items, errors, http_status, response, team_ids, department_ids, item_count, value_count)
SELECT 'mft-ilog-' || substr(t.id, 10, 12) || '-' || to_char(d, 'YYYYMMDD'), 'mft-meridian', 'mft-key-github-actions', NULL, 'api', 'github-actions',
       d + interval '3 hours' + (row_number() OVER (PARTITION BY d ORDER BY t.id)) * interval '7 minutes',
       CASE WHEN extract(day FROM d)::int % 17 = 0 THEN 'partial' ELSE 'accepted' END,
       jsonb_build_array(jsonb_build_object('index', 0, 'source', 'github-actions', 'status', 'written', 'teamId', t.id,
         'metrics', jsonb_build_array('test_coverage', 'test_flakiness_rate', 'avg_build_time_minutes', 'test_execution_time_minutes'),
         'recordedAt', to_char(d + interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'), 'snapshotDate', to_char(d, 'YYYY-MM-DD')))
         || CASE WHEN extract(day FROM d)::int % 17 = 0 THEN jsonb_build_array(jsonb_build_object('index', 1, 'source', 'github-actions', 'status', 'error', 'teamId', t.id, 'errors', jsonb_build_array('Unknown metric "mutation_score"'))) ELSE '[]'::jsonb END,
       CASE WHEN extract(day FROM d)::int % 17 = 0 THEN '[{"index": 1, "error": "Unknown metric \"mutation_score\""}]'::jsonb ELSE '[]'::jsonb END,
       CASE WHEN extract(day FROM d)::int % 17 = 0 THEN 207 ELSE 200 END, NULL,
       ARRAY[t.id]::varchar[], ARRAY['mft-dept-digital-banking']::varchar[],
       CASE WHEN extract(day FROM d)::int % 17 = 0 THEN 2 ELSE 1 END, 4
  FROM generate_series(current_date - 340, current_date, interval '1 day') AS d
  CROSS JOIN public.teams t
 WHERE t.company_id = 'mft-meridian' AND extract(isodow FROM d) < 6
ON CONFLICT DO NOTHING;

-- The onboarding checklist is complete (every step done).
INSERT INTO public.onboarding_state (company_id, completed_at, updated_at) VALUES ('mft-meridian', now() - interval '355 days', now() - interval '355 days')
ON CONFLICT (company_id) DO UPDATE SET completed_at = COALESCE(onboarding_state.completed_at, EXCLUDED.completed_at);

-- Target history: the coverage target was raised from 75 % to 80 % in May (by the VP of Engineering).
UPDATE public.target_history SET good = 75, warning = 65, valid_to = TIMESTAMPTZ '2026-05-04 09:00:00+00'
 WHERE company_id = 'mft-meridian' AND scope_type = 'company' AND metric_key = 'test_coverage' AND valid_to IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.target_history WHERE id = 'mft-target-coverage-80');
INSERT INTO public.target_history (id, company_id, scope_type, scope_id, metric_key, good, warning, valid_from, valid_to, changed_by, created_at)
VALUES ('mft-target-coverage-80', 'mft-meridian', 'company', 'mft-meridian', 'test_coverage', 80, 70, TIMESTAMPTZ '2026-05-04 09:00:00+00', NULL, 'mft-u-marcus-reid', TIMESTAMPTZ '2026-05-04 09:00:00+00')
ON CONFLICT DO NOTHING;
INSERT INTO public.audit_log (id, company_id, actor_id, action, entity_type, entity_id, summary, before, after, department_ids, subject_ids, created_at)
VALUES ('mft-audit-targets-coverage', 'mft-meridian', 'mft-u-marcus-reid', 'targets.update', 'config', 'mft-meridian',
        'Changed 1 KPI target (company Meridian Financial Technologies): test_coverage',
        '{"test_coverage": {"good": 75, "warning": 65}}', '{"test_coverage": {"good": 80, "warning": 70}}',
        '{}'::varchar[], ARRAY['mft-meridian']::varchar[], TIMESTAMPTZ '2026-05-04 09:00:00+00')
ON CONFLICT DO NOTHING;

-- Alert history over the year: every stretch of three days or more on which a team's stored KPI
-- value was off target (coverage < 70 %, defect escape > 10 %, flakiness > 5 %, change failure
-- rate > 15 %) gave one alert, resolved the day the value was back (the open ones are current).
WITH v AS (
  SELECT k.team_id, k.snapshot_date, m.metric, m.label, m.unit, m.lower, m.good, m.warn,
         CASE m.metric WHEN 'test_coverage' THEN k.test_coverage WHEN 'defect_escape_rate' THEN k.defect_escape_rate
                       WHEN 'test_flakiness_rate' THEN k.test_flakiness_rate ELSE k.change_failure_rate END AS value
    FROM public.kpi_snapshots k JOIN public.teams t ON t.id = k.team_id AND t.company_id = 'mft-meridian'
   CROSS JOIN (VALUES ('test_coverage', 'Test coverage', '%', FALSE, 80, 70), ('defect_escape_rate', 'Defect escape rate', '%', TRUE, 5, 10),
                      ('test_flakiness_rate', 'Test flakiness', '%', TRUE, 2, 5), ('change_failure_rate', 'Change failure rate', '%', TRUE, 5, 15))
               AS m(metric, label, unit, lower, good, warn)
), b AS (
  SELECT *, CASE WHEN lower THEN value > warn ELSE value < warn END AS breach FROM v WHERE value IS NOT NULL
), g AS (
  SELECT *, snapshot_date - (row_number() OVER (PARTITION BY team_id, metric ORDER BY snapshot_date))::int AS grp FROM b WHERE breach
), islands AS (
  SELECT team_id, metric, label, unit, lower, good, warn, min(snapshot_date) AS first_day, max(snapshot_date) AS last_day,
         count(*) AS days, (array_agg(value ORDER BY snapshot_date))[1] AS first_value
    FROM g GROUP BY team_id, metric, label, unit, lower, good, warn, grp
)
INSERT INTO public.alerts (id, company_id, team_id, rule, metric_key, severity, message, details, dedupe_key, created_at, last_seen_at, acknowledged_at, acknowledged_by, resolved_at)
SELECT 'mft-alert-' || substr(md5(team_id || metric || first_day), 1, 22), 'mft-meridian', team_id, 'threshold_breach', metric, 'critical',
       label || ' is off target: ' || round(first_value, 2) || unit || ' (target ' || CASE WHEN lower THEN '≤ ' ELSE '≥ ' END || good || unit
         || ', watch ' || CASE WHEN lower THEN '≤ ' ELSE '≥ ' END || warn || unit || ')',
       jsonb_build_object('good', good, 'value', round(first_value, 2), 'warning', warn, 'recordedAt', to_char(first_day, 'YYYY-MM-DD"T"00:00:00.000"Z"'), 'targetScope', 'company', 'lowerIsBetter', lower),
       'threshold_breach|' || team_id || '|' || metric,
       first_day + interval '9 hours 10 minutes', last_day + interval '6 hours 15 minutes',
       first_day + interval '1 day 10 hours', (SELECT id FROM public.users u WHERE u.primary_team_id = islands.team_id AND u.role = 'team_lead' LIMIT 1),
       last_day + interval '1 day 6 hours 15 minutes'
  FROM islands
 WHERE days >= 3 AND last_day < current_date - 2
ON CONFLICT DO NOTHING;

-- Retrospective actions of every sprint of the year (the last sprints' actions come from the
-- sample history above): one per team per sprint, agreed at the sprint retro, due at the end of
-- the next sprint and done, about the team's weakest KPI at that time.
WITH s AS (
  SELECT n, (DATE '2026-11-09' + (n - 47) * 14 + 11) AS retro_day FROM generate_series(21, 43) AS n
), pick AS (
  SELECT t.id AS team_id, s.n, s.retro_day, k.test_coverage, k.defect_escape_rate, k.test_flakiness_rate, k.change_failure_rate,
         (SELECT id FROM public.users u WHERE u.primary_team_id = t.id AND u.is_active AND u.role IN ('qa_engineer', 'team_lead')
           ORDER BY md5(u.id || s.n) LIMIT 1) AS owner_id
    FROM s CROSS JOIN public.teams t
    JOIN public.kpi_snapshots k ON k.team_id = t.id AND k.snapshot_date = s.retro_day
   WHERE t.company_id = 'mft-meridian'
), w AS (
  SELECT *, CASE
      WHEN test_flakiness_rate > 4 THEN 'test_flakiness_rate'
      WHEN defect_escape_rate > 9 THEN 'defect_escape_rate'
      WHEN test_coverage < 78 THEN 'test_coverage'
      WHEN change_failure_rate > 10 THEN 'change_failure_rate'
      ELSE (ARRAY['test_coverage', 'test_flakiness_rate', 'change_failure_rate'])[1 + (n % 3)] END AS metric
    FROM pick
)
INSERT INTO public.team_actions (id, company_id, team_id, title, description, origin, alert_id, owner_id, due_date, status, metric_key,
                                 baseline_value, baseline_at, created_by, created_at, updated_at, completed_at)
SELECT 'mft-act-' || substr(md5(team_id || n), 1, 24), 'mft-meridian', team_id,
       'Sprint ' || n || ' retro: ' || CASE metric
         WHEN 'test_flakiness_rate' THEN (ARRAY['Quarantine the flakiest tests and fix the top three', 'Replace sleeps in UI tests with explicit waits', 'Stabilise the shared test environment data'])[1 + n % 3]
         WHEN 'defect_escape_rate' THEN (ARRAY['Post-mortem the escaped defects and add regression tests', 'Add contract tests for the partner APIs', 'Pair on acceptance criteria before development'])[1 + n % 3]
         WHEN 'test_coverage' THEN (ARRAY['Cover the least-tested critical module', 'Add tests with every bug fix (definition of done)', 'Raise coverage on new code to 85 %'])[1 + n % 3]
         ELSE (ARRAY['Smaller releases behind feature flags', 'Add a canary step before full rollout', 'Run the release checklist at the sprint review'])[1 + n % 3] END,
       'Agreed at the Sprint ' || n || ' retrospective.', 'manual', NULL, owner_id, retro_day + 14,
       'done', metric,
       CASE metric WHEN 'test_flakiness_rate' THEN test_flakiness_rate WHEN 'defect_escape_rate' THEN defect_escape_rate
                   WHEN 'test_coverage' THEN test_coverage ELSE change_failure_rate END,
       retro_day::timestamptz, NULL, retro_day + interval '15 hours', retro_day + interval '12 days 16 hours', retro_day + interval '12 days 16 hours'
  FROM w
ON CONFLICT DO NOTHING;

-- Demo company: hide the "Includes sample data" notices (companies.settings.hideSampleDataNotice).
UPDATE public.companies
   SET settings = COALESCE(settings, '{}'::jsonb) || '{"hideSampleDataNotice": true}'::jsonb
 WHERE id = 'mft-meridian';

-- Status history of the retrospective actions above: who created each one and moved it to in progress and
-- done, at plausible working times (generated by server/seeds/actionHistory.ts MERIDIAN_ACTION_HISTORY_SQL;
-- tests/api/action-history-sample.test.ts keeps this copy identical). The sample (demo-) actions got theirs
-- from the seed above.
WITH x AS (
  SELECT a.id, a.company_id, a.team_id, a.status, a.owner_id, a.created_by, a.created_at, a.completed_at, t.department_id,
         ('x' || substr(md5(a.id), 1, 7))::bit(28)::int AS h
    FROM team_actions a JOIN teams t ON t.id = a.team_id
   WHERE (a.company_id = 'mft-meridian' AND a.id LIKE 'mft-act-%') AND a.created_at < now() - interval '1 hour'
     AND NOT EXISTS (SELECT 1 FROM team_action_events e WHERE e.action_id = a.id)
), p AS (
  SELECT x.*,
         (SELECT ra.user_id FROM role_assignments ra JOIN users u ON u.id = ra.user_id AND u.is_active
     WHERE ra.company_id = x.company_id AND ra.revoked_at IS NULL AND ra.role = 'team_lead' AND ra.scope_type = 'team' AND ra.scope_id = x.team_id
     ORDER BY md5(ra.user_id || x.id || 'lead') LIMIT 1) AS lead_id,
         (SELECT ra.user_id FROM role_assignments ra JOIN users u ON u.id = ra.user_id AND u.is_active
     WHERE ra.company_id = x.company_id AND ra.revoked_at IS NULL AND ra.role = 'qa_manager' AND ra.scope_type = 'department' AND ra.scope_id = x.department_id
     ORDER BY md5(ra.user_id || x.id || 'mgr') LIMIT 1) AS manager_id,
         (SELECT ra.user_id FROM role_assignments ra JOIN users u ON u.id = ra.user_id AND u.is_active
     WHERE ra.company_id = x.company_id AND ra.revoked_at IS NULL AND ra.role = 'super_admin' AND ra.scope_type = 'company' AND ra.scope_id = x.company_id
     ORDER BY md5(ra.user_id || x.id || 'admin') LIMIT 1) AS admin_id,
         (SELECT u.id FROM users u WHERE u.id = x.owner_id AND u.is_active) AS owner_ok,
         (SELECT u.id FROM users u WHERE u.id = x.created_by AND u.is_active) AS creator_ok
    FROM x
), r AS (
  SELECT p.*,
         COALESCE(p.creator_ok, p.lead_id, p.manager_id, p.admin_id) AS creator,
         COALESCE(p.owner_ok, p.lead_id, p.manager_id, p.admin_id) AS starter,
         CASE WHEN p.h % 3 = 0 THEN COALESCE(p.lead_id, p.owner_ok, p.manager_id, p.admin_id)
              ELSE COALESCE(p.owner_ok, p.lead_id, p.manager_id, p.admin_id) END AS finisher,
         CASE WHEN p.h % 2 = 0 THEN COALESCE(p.manager_id, p.lead_id, p.admin_id)
              ELSE COALESCE(p.lead_id, p.manager_id, p.admin_id) END AS dropper,
         CASE WHEN p.status = 'done' AND p.completed_at IS NOT NULL THEN p.completed_at
              WHEN p.status IN ('done', 'dropped') THEN (((((p.created_at AT TIME ZONE 'UTC')::date + (3 + p.h % 9)::int) + CASE extract(isodow FROM ((p.created_at AT TIME ZONE 'UTC')::date + (3 + p.h % 9)::int)) WHEN 6 THEN 2 WHEN 7 THEN 1 ELSE 0 END)
            + make_interval(hours => 9 + (p.h / 7) % 8, mins => ((p.h / 7) / 8) % 60)) AT TIME ZONE 'UTC')
         END AS end_raw,
         (((((p.created_at AT TIME ZONE 'UTC')::date + (1 + p.h % 3)::int) + CASE extract(isodow FROM ((p.created_at AT TIME ZONE 'UTC')::date + (1 + p.h % 3)::int)) WHEN 6 THEN 2 WHEN 7 THEN 1 ELSE 0 END)
            + make_interval(hours => 9 + (p.h / 5) % 8, mins => ((p.h / 5) / 8) % 60)) AT TIME ZONE 'UTC') AS start_raw
    FROM p
), t AS (
  SELECT r.*,
         CASE WHEN r.end_raw IS NULL OR r.status = 'done' AND r.completed_at IS NOT NULL THEN r.end_raw
              WHEN r.end_raw > r.created_at AND r.end_raw < now() THEN r.end_raw
              ELSE r.created_at + (now() - r.created_at) * 0.6 END AS end_at
    FROM r
), t2 AS (
  SELECT t.*,
         CASE WHEN t.start_raw > t.created_at AND t.start_raw < LEAST(COALESCE(t.end_at, now()), now()) THEN t.start_raw
              ELSE t.created_at + (LEAST(COALESCE(t.end_at, now()), now()) - t.created_at) * 0.4 END AS start_at
    FROM t
), ev AS (
  SELECT t2.id AS action_id, t2.company_id, t2.team_id, 1 AS step, NULL::text AS from_status, 'open'::text AS to_status, t2.creator AS changed_by, t2.created_at AS changed_at
    FROM t2
  UNION ALL
  SELECT t2.id, t2.company_id, t2.team_id, 2, 'open', 'in_progress', t2.starter, t2.start_at
    FROM t2 WHERE t2.status IN ('in_progress', 'done') OR (t2.status = 'dropped' AND t2.h % 2 = 1)
  UNION ALL
  SELECT t2.id, t2.company_id, t2.team_id, 3, CASE WHEN t2.status = 'done' OR t2.h % 2 = 1 THEN 'in_progress' ELSE 'open' END, t2.status,
         CASE WHEN t2.status = 'done' THEN t2.finisher ELSE t2.dropper END, t2.end_at
    FROM t2 WHERE t2.status IN ('done', 'dropped')
), ok AS (
  -- Only actions whose every change has a person (and in order: created, then later changes).
  SELECT ev.* FROM ev
   WHERE NOT EXISTS (SELECT 1 FROM ev e2 WHERE e2.action_id = ev.action_id AND e2.changed_by IS NULL)
     AND NOT EXISTS (SELECT 1 FROM ev e2 JOIN ev e3 ON e3.action_id = e2.action_id AND e3.step > e2.step AND e3.changed_at <= e2.changed_at WHERE e2.action_id = ev.action_id)
), ins AS (
  INSERT INTO team_action_events (id, company_id, team_id, action_id, from_status, to_status, changed_by, source, changed_at)
  SELECT 'mft-ahe-' || substr(md5(ok.action_id || ':' || ok.step), 1, 24), ok.company_id, ok.team_id, ok.action_id, ok.from_status, ok.to_status, ok.changed_by, 'user', ok.changed_at
    FROM ok
  ON CONFLICT (id) DO NOTHING
  RETURNING action_id, to_status, changed_by, changed_at
)
UPDATE team_actions a
   SET status_changed_by = l.changed_by, status_changed_at = l.changed_at
  FROM (SELECT DISTINCT ON (action_id) * FROM ins ORDER BY action_id, changed_at DESC) l
 WHERE a.id = l.action_id AND a.status = l.to_status;
