-- IronGate QA Navigator: metric storage and ingestion quality
--
--  1. metric_values: one row per received KPI value, with the time the value is FOR
--     (recorded_at, backfill allowed) and the time it arrived (received_at). kpi_snapshots stays
--     (every reader keeps working) and becomes a per-day view derived from it:
--       snapshot(team, day).<metric> = the latest non-superseded value with recorded_at before the
--       end of that day (UTC), ordered by recorded_at, then received_at.
--     public.refresh_kpi_snapshots() re-derives the affected day and the later days after a write;
--     the qa_score trigger keeps computing qa_score / status from the stored inputs.
--     A value that arrives again for the same team, metric and recorded_at is a correction: the
--     earlier row gets superseded_by = the new row.
--     Backfill (public.backfill_metric_values): every recorded kpi_snapshots cell becomes a value.
--     recorded_at comes from field_sources.<column>.recorded_at (as the ingestion API stored it),
--     else the snapshot day 00:00 UTC; it is never later than the end of the snapshot day. Cells
--     carried forward from an earlier snapshot (field_sources carried_forward) are the same value,
--     so they add a row only when their original is not there. Existing snapshot rows are NOT
--     rewritten by this migration.
--  2. target_history: KPI targets (good / warning) with validity periods per company, department
--     or team; a past value is judged with the target valid at its date. Backfill: the targets in
--     force today (src/config/metricsConfig.ts METRICS_CONFIG, see public.default_kpi_targets())
--     at company scope, valid from the company's earliest snapshot.
--  3. ingestion_log: every ingestion / manual write (accepted, partial or rejected), with the
--     idempotency key and the response returned, so a retried request returns the original result
--     without writing twice.
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed.
-- Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

-- ---------------------------------------------------------------------------
-- 3. ingestion_log (first: metric_values references it)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingestion_log (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  api_key_id varchar(36),
  actor_id varchar(36),
  channel text NOT NULL,
  source text,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text,
  request_hash text,
  http_status integer,
  response jsonb,
  team_ids varchar(36)[] NOT NULL DEFAULT '{}'::varchar[],
  -- Departments of those teams when written (QA managers see their departments' entries).
  department_ids varchar(36)[] NOT NULL DEFAULT '{}'::varchar[],
  item_count integer NOT NULL DEFAULT 0,
  value_count integer NOT NULL DEFAULT 0,
  CONSTRAINT ingestion_log_pkey PRIMARY KEY (id),
  CONSTRAINT ingestion_log_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT ingestion_log_api_key_fk FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL,
  CONSTRAINT ingestion_log_actor_fk FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT ingestion_log_status_check CHECK (status IN ('accepted', 'partial', 'rejected')),
  CONSTRAINT ingestion_log_channel_check CHECK (channel IN ('api', 'manual'))
);

CREATE INDEX IF NOT EXISTS ingestion_log_company_received_idx ON public.ingestion_log (company_id, received_at DESC);
CREATE INDEX IF NOT EXISTS ingestion_log_team_ids_idx ON public.ingestion_log USING gin (team_ids);
-- One stored result per caller and Idempotency-Key. Rejected requests are not bound to the key,
-- so a corrected retry with the same key is processed.
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_log_idempotency_uq
  ON public.ingestion_log (company_id, (COALESCE(api_key_id, actor_id, '')), idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status <> 'rejected';

ALTER TABLE public.ingestion_log ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 1. metric_values
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metric_values (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  metric_key text NOT NULL,
  value numeric NOT NULL,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  source_ref text,
  idempotency_key text,
  -- A user id (manual entry) or 'api_key:<id>' (ingestion API); text because it holds both.
  actor_id text,
  superseded_by varchar(36),
  ingestion_id varchar(36),
  CONSTRAINT metric_values_pkey PRIMARY KEY (id),
  CONSTRAINT metric_values_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT metric_values_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT metric_values_superseded_fk FOREIGN KEY (superseded_by) REFERENCES public.metric_values(id) ON DELETE SET NULL,
  CONSTRAINT metric_values_ingestion_fk FOREIGN KEY (ingestion_id) REFERENCES public.ingestion_log(id) ON DELETE SET NULL,
  CONSTRAINT metric_values_metric_check CHECK (metric_key IN (
    'test_coverage', 'test_flakiness_rate', 'defect_density', 'defect_escape_rate', 'code_quality_score',
    'avg_build_time_minutes', 'test_execution_time_minutes', 'deployment_frequency_per_week', 'lead_time_days',
    'mttr_hours', 'parallel_test_efficiency', 'sprint_velocity', 'sprint_commitment_rate', 'sprint_carryover',
    'first_time_pass_rate', 'blocked_time_hours', 'automation_coverage', 'automation_roi', 'change_failure_rate',
    'mtbf_hours', 'system_availability', 'infrastructure_failures', 'sizing_accuracy'
  ))
);

-- Derivation reads "latest value of a metric for a team before a time".
CREATE INDEX IF NOT EXISTS metric_values_team_metric_time_idx
  ON public.metric_values (team_id, metric_key, recorded_at DESC, received_at DESC)
  WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS metric_values_company_received_idx ON public.metric_values (company_id, received_at DESC);
CREATE INDEX IF NOT EXISTS metric_values_ingestion_idx ON public.metric_values (ingestion_id) WHERE ingestion_id IS NOT NULL;
-- Foreign-key lookups on delete (a team, a superseding value) without a scan.
CREATE INDEX IF NOT EXISTS metric_values_team_idx ON public.metric_values (team_id);
CREATE INDEX IF NOT EXISTS metric_values_superseded_idx ON public.metric_values (superseded_by) WHERE superseded_by IS NOT NULL;
-- Per-item idempotency: the same key never writes a metric twice for a team.
CREATE UNIQUE INDEX IF NOT EXISTS metric_values_idempotency_uq
  ON public.metric_values (team_id, metric_key, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.metric_values ENABLE ROW LEVEL SECURITY;

-- Parse a timestamp written by the app; NULL (not an error) for anything unparsable.
CREATE OR REPLACE FUNCTION public.try_timestamptz(p text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF p IS NULL OR p !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  RETURN p::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- kpi_snapshots cells -> metric_values (see header). Returns the number of rows inserted.
CREATE OR REPLACE FUNCTION public.backfill_metric_values(p_team_id text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  n1 integer;
  n2 integer;
BEGIN
  WITH cells AS (
    SELECT ks.id AS snapshot_id, ks.team_id, t.company_id, ks.snapshot_date, ks.created_at, v.metric_key, v.value,
           ks.field_sources -> v.metric_key AS fs
      FROM public.kpi_snapshots ks
      JOIN public.teams t ON t.id = ks.team_id
      CROSS JOIN LATERAL (VALUES
        ('test_coverage', ks.test_coverage::numeric), ('test_flakiness_rate', ks.test_flakiness_rate::numeric),
        ('defect_density', ks.defect_density::numeric), ('defect_escape_rate', ks.defect_escape_rate::numeric),
        ('code_quality_score', ks.code_quality_score::numeric), ('avg_build_time_minutes', ks.avg_build_time_minutes::numeric),
        ('test_execution_time_minutes', ks.test_execution_time_minutes::numeric),
        ('deployment_frequency_per_week', ks.deployment_frequency_per_week::numeric), ('lead_time_days', ks.lead_time_days::numeric),
        ('mttr_hours', ks.mttr_hours::numeric), ('parallel_test_efficiency', ks.parallel_test_efficiency::numeric),
        ('sprint_velocity', ks.sprint_velocity::numeric), ('sprint_commitment_rate', ks.sprint_commitment_rate::numeric),
        ('sprint_carryover', ks.sprint_carryover::numeric), ('first_time_pass_rate', ks.first_time_pass_rate::numeric),
        ('blocked_time_hours', ks.blocked_time_hours::numeric), ('automation_coverage', ks.automation_coverage::numeric),
        ('automation_roi', ks.automation_roi::numeric), ('change_failure_rate', ks.change_failure_rate::numeric),
        ('mtbf_hours', ks.mtbf_hours::numeric), ('system_availability', ks.system_availability::numeric),
        ('infrastructure_failures', ks.infrastructure_failures::numeric), ('sizing_accuracy', ks.sizing_accuracy::numeric)
      ) AS v(metric_key, value)
     WHERE v.value IS NOT NULL
       AND (p_team_id IS NULL OR ks.team_id = p_team_id)
  ),
  prepared AS (
    SELECT c.*,
           -- recorded_at: the stored provenance, else the snapshot day; never after the end of that day.
           LEAST(
             COALESCE(public.try_timestamptz(c.fs ->> 'recorded_at'), c.snapshot_date::timestamp AT TIME ZONE 'UTC'),
             (c.snapshot_date + 1)::timestamp AT TIME ZONE 'UTC' - interval '1 millisecond'
           ) AS recorded_at,
           COALESCE(NULLIF(c.fs ->> 'source', ''), 'legacy') AS source,
           NULLIF(c.fs ->> 'recorded_by', '') AS actor_id,
           COALESCE((c.fs ->> 'carried_forward') = 'true', FALSE) AS carried
      FROM cells c
  )
  INSERT INTO public.metric_values (id, company_id, team_id, metric_key, value, recorded_at, received_at, source, idempotency_key, actor_id)
  SELECT 'mv-' || md5(p.snapshot_id || ':' || p.metric_key), p.company_id, p.team_id, p.metric_key, p.value, p.recorded_at,
         COALESCE(p.created_at, p.recorded_at), p.source, 'backfill:' || p.snapshot_id, p.actor_id
    FROM prepared p
   WHERE NOT p.carried
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n1 = ROW_COUNT;

  -- Carried-forward cells: the same value as an earlier one; add it only when that one is missing
  -- (for example when the earlier snapshot row no longer exists).
  WITH cells AS (
    SELECT ks.id AS snapshot_id, ks.team_id, t.company_id, ks.snapshot_date, ks.created_at, v.metric_key, v.value,
           ks.field_sources -> v.metric_key AS fs
      FROM public.kpi_snapshots ks
      JOIN public.teams t ON t.id = ks.team_id
      CROSS JOIN LATERAL (VALUES
        ('test_coverage', ks.test_coverage::numeric), ('test_flakiness_rate', ks.test_flakiness_rate::numeric),
        ('defect_density', ks.defect_density::numeric), ('defect_escape_rate', ks.defect_escape_rate::numeric),
        ('code_quality_score', ks.code_quality_score::numeric), ('avg_build_time_minutes', ks.avg_build_time_minutes::numeric),
        ('test_execution_time_minutes', ks.test_execution_time_minutes::numeric),
        ('deployment_frequency_per_week', ks.deployment_frequency_per_week::numeric), ('lead_time_days', ks.lead_time_days::numeric),
        ('mttr_hours', ks.mttr_hours::numeric), ('parallel_test_efficiency', ks.parallel_test_efficiency::numeric),
        ('sprint_velocity', ks.sprint_velocity::numeric), ('sprint_commitment_rate', ks.sprint_commitment_rate::numeric),
        ('sprint_carryover', ks.sprint_carryover::numeric), ('first_time_pass_rate', ks.first_time_pass_rate::numeric),
        ('blocked_time_hours', ks.blocked_time_hours::numeric), ('automation_coverage', ks.automation_coverage::numeric),
        ('automation_roi', ks.automation_roi::numeric), ('change_failure_rate', ks.change_failure_rate::numeric),
        ('mtbf_hours', ks.mtbf_hours::numeric), ('system_availability', ks.system_availability::numeric),
        ('infrastructure_failures', ks.infrastructure_failures::numeric), ('sizing_accuracy', ks.sizing_accuracy::numeric)
      ) AS v(metric_key, value)
     WHERE v.value IS NOT NULL
       AND (ks.field_sources -> v.metric_key ->> 'carried_forward') = 'true'
       AND (p_team_id IS NULL OR ks.team_id = p_team_id)
  ),
  timed AS (
    SELECT c.*,
           LEAST(
             COALESCE(public.try_timestamptz(c.fs ->> 'recorded_at'), c.snapshot_date::timestamp AT TIME ZONE 'UTC'),
             (c.snapshot_date + 1)::timestamp AT TIME ZONE 'UTC' - interval '1 millisecond'
           ) AS recorded_at,
           COALESCE(NULLIF(c.fs ->> 'source', ''), 'legacy') AS source,
           NULLIF(c.fs ->> 'recorded_by', '') AS actor_id
      FROM cells c
  ),
  prepared AS (
    SELECT DISTINCT ON (t.team_id, t.metric_key, t.recorded_at) t.*
      FROM timed t
     ORDER BY t.team_id, t.metric_key, t.recorded_at, t.snapshot_date
  )
  INSERT INTO public.metric_values (id, company_id, team_id, metric_key, value, recorded_at, received_at, source, idempotency_key, actor_id)
  SELECT 'mv-' || md5(p.snapshot_id || ':' || p.metric_key), p.company_id, p.team_id, p.metric_key, p.value, p.recorded_at,
         COALESCE(p.created_at, p.recorded_at), p.source, 'backfill:' || p.snapshot_id, p.actor_id
    FROM prepared p
   WHERE NOT EXISTS (
     SELECT 1 FROM public.metric_values mv
      WHERE mv.team_id = p.team_id AND mv.metric_key = p.metric_key AND mv.recorded_at = p.recorded_at
   )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n2 = ROW_COUNT;
  RETURN n1 + n2;
END;
$$;

-- Re-derive kpi_snapshots of one team from metric_values (see header), for the given metrics on
-- p_from and every later snapshot day. The p_from row is created when missing (every metric then
-- derived as of that day, which equals the old carry-forward). A cell with no value as of its day
-- keeps what it holds (never wiped). field_sources.<metric> follows the chosen value:
-- {source, recorded_at, recorded_by, carried_forward (only when true)}.
-- Returns the number of snapshot rows touched.
CREATE OR REPLACE FUNCTION public.refresh_kpi_snapshots(p_team_id text, p_from date, p_metrics text[]) RETURNS integer
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  all_metrics CONSTANT text[] := ARRAY[
    'test_coverage', 'test_flakiness_rate', 'defect_density', 'defect_escape_rate', 'code_quality_score',
    'avg_build_time_minutes', 'test_execution_time_minutes', 'deployment_frequency_per_week', 'lead_time_days',
    'mttr_hours', 'parallel_test_efficiency', 'sprint_velocity', 'sprint_commitment_rate', 'sprint_carryover',
    'first_time_pass_rate', 'blocked_time_hours', 'automation_coverage', 'automation_roi', 'change_failure_rate',
    'mtbf_hours', 'system_availability', 'infrastructure_failures', 'sizing_accuracy'];
  m text;
  created boolean := FALSE;
  touched integer;
BEGIN
  IF p_metrics IS NULL OR NOT (p_metrics <@ all_metrics) THEN
    RAISE EXCEPTION 'refresh_kpi_snapshots: unknown metric in %', p_metrics;
  END IF;

  INSERT INTO public.kpi_snapshots (team_id, snapshot_date, field_sources)
  VALUES (p_team_id, p_from, '{}'::jsonb)
  ON CONFLICT (team_id, snapshot_date) DO NOTHING;
  GET DIAGNOSTICS touched = ROW_COUNT;
  created := touched > 0;

  FOREACH m IN ARRAY all_metrics LOOP
    -- A new row gets every metric; existing rows only the metrics that were written.
    IF NOT (m = ANY (p_metrics)) AND NOT created THEN CONTINUE; END IF;
    EXECUTE format($sql$
      UPDATE public.kpi_snapshots ks
         SET %1$I = COALESCE(d.value, ks.%1$I),
             field_sources = CASE WHEN d.value IS NULL THEN ks.field_sources ELSE
               jsonb_set(COALESCE(ks.field_sources, '{}'::jsonb), ARRAY[%2$L],
                 jsonb_strip_nulls(jsonb_build_object(
                   'source', d.source,
                   'recorded_at', to_char(d.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                   'recorded_by', d.actor_id,
                   'carried_forward', CASE WHEN (d.recorded_at AT TIME ZONE 'UTC')::date < ks.snapshot_date THEN TRUE END
                 )))
             END
        FROM (
          SELECT s.id, mv.value, mv.source, mv.recorded_at, mv.actor_id
            FROM public.kpi_snapshots s
            LEFT JOIN LATERAL (
              SELECT v.value, v.source, v.recorded_at, v.actor_id
                FROM public.metric_values v
               WHERE v.team_id = s.team_id AND v.metric_key = %2$L AND v.superseded_by IS NULL
                 AND v.recorded_at < (s.snapshot_date + 1)::timestamp AT TIME ZONE 'UTC'
               ORDER BY v.recorded_at DESC, v.received_at DESC, v.id DESC
               LIMIT 1
            ) mv ON TRUE
           WHERE s.team_id = $1
             AND (CASE WHEN %3$L::boolean THEN s.snapshot_date >= $2 ELSE s.snapshot_date = $2 END)
        ) d
       WHERE ks.id = d.id AND d.value IS NOT NULL
    $sql$, m, m, (m = ANY (p_metrics))) USING p_team_id, p_from;
  END LOOP;

  -- Same meaning as before: a snapshot that holds a value entered by hand is marked.
  UPDATE public.kpi_snapshots ks
     SET manually_edited = TRUE
   WHERE ks.team_id = p_team_id AND ks.snapshot_date >= p_from AND NOT COALESCE(ks.manually_edited, FALSE)
     AND EXISTS (SELECT 1 FROM jsonb_each(ks.field_sources) e WHERE e.value ->> 'source' = 'manual');

  SELECT count(*) INTO touched FROM public.kpi_snapshots WHERE team_id = p_team_id AND snapshot_date >= p_from;
  RETURN touched;
END;
$$;

SELECT public.backfill_metric_values(NULL);

-- ---------------------------------------------------------------------------
-- 2. target_history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.target_history (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  scope_type text NOT NULL,
  scope_id varchar(36) NOT NULL,
  metric_key text NOT NULL,
  good numeric NOT NULL,
  warning numeric NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  changed_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT target_history_pkey PRIMARY KEY (id),
  CONSTRAINT target_history_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT target_history_changed_by_fk FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT target_history_scope_check CHECK (scope_type IN ('company', 'department', 'team')),
  CONSTRAINT target_history_period_check CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX IF NOT EXISTS target_history_lookup_idx
  ON public.target_history (company_id, metric_key, scope_type, scope_id, valid_from);
-- At most one open (current) target per scope and metric.
CREATE UNIQUE INDEX IF NOT EXISTS target_history_open_uq
  ON public.target_history (scope_type, scope_id, metric_key) WHERE valid_to IS NULL;

ALTER TABLE public.target_history ENABLE ROW LEVEL SECURITY;

-- The default targets (good / warning) of the KPI columns: METRICS_CONFIG in
-- src/config/metricsConfig.ts at the time of this migration (tests/database checks they match).
CREATE OR REPLACE FUNCTION public.default_kpi_targets()
RETURNS TABLE (metric_key text, good numeric, warning numeric)
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  VALUES
    ('test_coverage', 80::numeric, 70::numeric),
    ('defect_density', 0.5, 1),
    ('defect_escape_rate', 5, 10),
    ('automation_coverage', 70, 50),
    ('code_quality_score', 80, 60),
    ('test_flakiness_rate', 2, 5),
    ('avg_build_time_minutes', 10, 20),
    ('test_execution_time_minutes', 15, 30),
    ('deployment_frequency_per_week', 5, 2),
    ('lead_time_days', 3, 7),
    ('mttr_hours', 2, 8),
    ('parallel_test_efficiency', 80, 60),
    ('sprint_commitment_rate', 90, 75),
    ('sprint_carryover', 10, 20),
    ('first_time_pass_rate', 85, 70),
    ('blocked_time_hours', 4, 12),
    ('change_failure_rate', 5, 15),
    ('mtbf_hours', 720, 168),
    ('system_availability', 99.9, 99),
    ('infrastructure_failures', 1, 3)
$$;

-- Company-scope rows for the default targets where a company has none yet for that metric,
-- valid from the company's earliest snapshot (else its creation). Returns rows inserted.
CREATE OR REPLACE FUNCTION public.backfill_target_history(p_company_id text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.target_history (company_id, scope_type, scope_id, metric_key, good, warning, valid_from)
  SELECT c.id, 'company', c.id, d.metric_key, d.good, d.warning,
         COALESCE(
           (SELECT min(ks.snapshot_date)::timestamp AT TIME ZONE 'UTC'
              FROM public.kpi_snapshots ks JOIN public.teams t ON t.id = ks.team_id
             WHERE t.company_id = c.id),
           c.created_at,
           now()
         )
    FROM public.companies c
    CROSS JOIN public.default_kpi_targets() d
   WHERE (p_company_id IS NULL OR c.id = p_company_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.target_history th
        WHERE th.company_id = c.id AND th.scope_type = 'company' AND th.scope_id = c.id AND th.metric_key = d.metric_key
     );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

SELECT public.backfill_target_history(NULL);

COMMIT;
