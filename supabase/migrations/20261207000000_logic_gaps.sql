-- IronGate QA Navigator: close the gaps between the ingested data and the indicators (docs/DATA_FLOW.md, section 7).
--
--   1. test_runs.repo, coverage_reports.repo: the repository of a test report or coverage report (a dimension for the
--      evidence and its filters); coverage_reports.lines_of_code: the lines of code sent with a coverage report
--      ("loc"), the denominator of defect density and of the code quality score when it is sent.
--   2. analysis_findings.effort_minutes: the remediation effort of a static-analysis finding (SonarQube "effort" /
--      "debt"), summed into the technical debt items derived from the reports.
--   3. value_sources on the three monthly Business impact tables: where each monthly value came from
--      ({ "<column>": "manual" | "ingested" | "synthetic" }). A typed-in value is never overwritten by an ingested
--      one; an ingested value is replaced by the next derivation; a typed-in value replaces an ingested one and is
--      recorded as manual.
--   4. public.refresh_business_quality_month(team, month): the monthly quality side of Business impact derived from
--      the team's KPI values (metric_values, every source but synthetic), called after every KPI write
--      (server/lib/metricValues.ts), and backfilled here for the real companies.
--
-- Idempotent and additive. Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

ALTER TABLE public.test_runs ADD COLUMN IF NOT EXISTS repo varchar(255);
ALTER TABLE public.coverage_reports ADD COLUMN IF NOT EXISTS repo varchar(255);
ALTER TABLE public.coverage_reports ADD COLUMN IF NOT EXISTS lines_of_code integer;
ALTER TABLE public.analysis_findings ADD COLUMN IF NOT EXISTS effort_minutes integer;
CREATE INDEX IF NOT EXISTS test_runs_team_repo_idx ON public.test_runs (team_id, repo) WHERE repo IS NOT NULL;
CREATE INDEX IF NOT EXISTS coverage_reports_team_repo_idx ON public.coverage_reports (team_id, repo) WHERE repo IS NOT NULL;

ALTER TABLE public.business_impact_quality_metrics ADD COLUMN IF NOT EXISTS value_sources jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.business_impact_business_kpis ADD COLUMN IF NOT EXISTS value_sources jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.business_impact_context ADD COLUMN IF NOT EXISTS value_sources jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The rows stored before this migration: every value is the row's own source (typed in, or sample data).
UPDATE public.business_impact_quality_metrics q SET value_sources = (
  SELECT COALESCE(jsonb_object_agg(k, CASE WHEN lower(COALESCE(q.data_source, 'manual')) = 'synthetic' THEN 'synthetic' ELSE 'manual' END), '{}'::jsonb)
    FROM jsonb_each(to_jsonb(q) - 'id' - 'team_id' - 'month_year' - 'manually_edited' - 'data_source' - 'created_at' - 'updated_at' - 'value_sources') e(k, v)
   WHERE v IS NOT NULL AND v <> 'null'::jsonb)
 WHERE q.value_sources = '{}'::jsonb;
UPDATE public.business_impact_business_kpis q SET value_sources = (
  SELECT COALESCE(jsonb_object_agg(k, CASE WHEN lower(COALESCE(q.data_source, 'manual')) = 'synthetic' THEN 'synthetic' ELSE 'manual' END), '{}'::jsonb)
    FROM jsonb_each(to_jsonb(q) - 'id' - 'team_id' - 'month_year' - 'manually_edited' - 'data_source' - 'created_at' - 'updated_at' - 'value_sources') e(k, v)
   WHERE v IS NOT NULL AND v <> 'null'::jsonb)
 WHERE q.value_sources = '{}'::jsonb;
UPDATE public.business_impact_context q SET value_sources = (
  SELECT COALESCE(jsonb_object_agg(k, CASE WHEN q.manually_edited IS FALSE THEN 'synthetic' ELSE 'manual' END), '{}'::jsonb)
    FROM jsonb_each(to_jsonb(q) - 'id' - 'team_id' - 'month_year' - 'manually_edited' - 'notes' - 'created_at' - 'updated_at' - 'value_sources'
                    - 'sprint_length_days' - 'is_holiday_season') e(k, v)
   WHERE v IS NOT NULL AND v <> 'null'::jsonb)
 WHERE q.value_sources = '{}'::jsonb;

-- The monthly quality values of a team, from its KPI values: for each day of the month the day's latest
-- non-superseded value (every source but synthetic), averaged over the days that have one. Deployment frequency
-- is stored per month (per-week value × 52 / 12, the unit of the Business impact table).
CREATE OR REPLACE FUNCTION public.refresh_business_quality_month(p_team_id text, p_month text) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_company text;
  v_from date;
  v_vals jsonb;
  v_row public.business_impact_quality_metrics%ROWTYPE;
  v_sources jsonb;
  v_col text;
  v_new numeric;
  v_set jsonb := '{}'::jsonb;
  v_cols text[] := ARRAY['test_coverage', 'defect_density', 'defect_escape_rate', 'mttr_hours', 'deployment_frequency',
                         'lead_time_days', 'code_quality_score', 'change_failure_rate'];
BEGIN
  IF p_month !~ '^\d{4}-\d{2}$' THEN RETURN; END IF;
  SELECT company_id INTO v_company FROM public.teams WHERE id = p_team_id;
  -- Sample companies and the demo sandbox keep their generated monthly data (never mixed with values derived here).
  IF v_company IS NULL OR v_company LIKE 'demo-%' OR v_company = 'sandbox-demo' THEN RETURN; END IF;
  v_from := (p_month || '-01')::date;

  WITH daily AS (
    SELECT DISTINCT ON (mv.metric_key, (mv.recorded_at AT TIME ZONE 'UTC')::date)
           mv.metric_key, mv.value
      FROM public.metric_values mv
     WHERE mv.team_id = p_team_id AND mv.superseded_by IS NULL AND mv.value IS NOT NULL
       AND lower(mv.source) <> 'synthetic'
       AND mv.recorded_at >= v_from::timestamp AT TIME ZONE 'UTC'
       AND mv.recorded_at < (v_from + interval '1 month')::timestamp AT TIME ZONE 'UTC'
       AND mv.metric_key IN ('test_coverage', 'defect_density', 'defect_escape_rate', 'mttr_hours', 'deployment_frequency_per_week',
                             'lead_time_days', 'code_quality_score', 'change_failure_rate')
     ORDER BY mv.metric_key, (mv.recorded_at AT TIME ZONE 'UTC')::date, mv.recorded_at DESC, mv.received_at DESC),
  monthly AS (
    SELECT CASE WHEN metric_key = 'deployment_frequency_per_week' THEN 'deployment_frequency' ELSE metric_key END AS col,
           round(CASE WHEN metric_key = 'deployment_frequency_per_week' THEN avg(value) * 52 / 12 ELSE avg(value) END,
                 CASE WHEN metric_key = 'defect_density' THEN 4 ELSE 2 END) AS value
      FROM daily GROUP BY metric_key)
  SELECT COALESCE(jsonb_object_agg(col, value), '{}'::jsonb) INTO v_vals FROM monthly;

  SELECT * INTO v_row FROM public.business_impact_quality_metrics WHERE team_id = p_team_id AND month_year = p_month FOR UPDATE;
  IF FOUND AND lower(COALESCE(v_row.data_source, '')) = 'synthetic' THEN RETURN; END IF;
  IF NOT FOUND AND v_vals = '{}'::jsonb THEN RETURN; END IF;
  v_sources := CASE WHEN FOUND THEN v_row.value_sources ELSE '{}'::jsonb END;

  -- Precedence: a typed-in (manual) or sample value is never replaced; an ingested value follows the data.
  FOREACH v_col IN ARRAY v_cols LOOP
    IF COALESCE(v_sources->>v_col, 'ingested') <> 'ingested' THEN CONTINUE; END IF;
    v_new := (v_vals->>v_col)::numeric;
    v_set := v_set || jsonb_build_object(v_col, v_new);
    v_sources := CASE WHEN v_new IS NULL THEN v_sources - v_col ELSE v_sources || jsonb_build_object(v_col, 'ingested') END;
  END LOOP;

  INSERT INTO public.business_impact_quality_metrics AS q
         (id, team_id, month_year, test_coverage, defect_density, defect_escape_rate, mttr_hours, deployment_frequency,
          lead_time_days, code_quality_score, change_failure_rate, manually_edited, data_source, value_sources)
  VALUES (gen_random_uuid()::text, p_team_id, p_month,
          (v_set->>'test_coverage')::numeric, (v_set->>'defect_density')::numeric, (v_set->>'defect_escape_rate')::numeric,
          (v_set->>'mttr_hours')::numeric, (v_set->>'deployment_frequency')::numeric, (v_set->>'lead_time_days')::numeric,
          (v_set->>'code_quality_score')::numeric, (v_set->>'change_failure_rate')::numeric, FALSE, 'ingested', v_sources)
  ON CONFLICT (team_id, month_year) DO UPDATE SET
    test_coverage = CASE WHEN v_set ? 'test_coverage' THEN EXCLUDED.test_coverage ELSE q.test_coverage END,
    defect_density = CASE WHEN v_set ? 'defect_density' THEN EXCLUDED.defect_density ELSE q.defect_density END,
    defect_escape_rate = CASE WHEN v_set ? 'defect_escape_rate' THEN EXCLUDED.defect_escape_rate ELSE q.defect_escape_rate END,
    mttr_hours = CASE WHEN v_set ? 'mttr_hours' THEN EXCLUDED.mttr_hours ELSE q.mttr_hours END,
    deployment_frequency = CASE WHEN v_set ? 'deployment_frequency' THEN EXCLUDED.deployment_frequency ELSE q.deployment_frequency END,
    lead_time_days = CASE WHEN v_set ? 'lead_time_days' THEN EXCLUDED.lead_time_days ELSE q.lead_time_days END,
    code_quality_score = CASE WHEN v_set ? 'code_quality_score' THEN EXCLUDED.code_quality_score ELSE q.code_quality_score END,
    change_failure_rate = CASE WHEN v_set ? 'change_failure_rate' THEN EXCLUDED.change_failure_rate ELSE q.change_failure_rate END,
    value_sources = EXCLUDED.value_sources,
    data_source = CASE
      WHEN NOT EXISTS (SELECT 1 FROM jsonb_each_text(EXCLUDED.value_sources) s WHERE s.value <> 'ingested') THEN 'ingested'
      WHEN NOT EXISTS (SELECT 1 FROM jsonb_each_text(EXCLUDED.value_sources) s WHERE s.value = 'ingested') THEN q.data_source
      ELSE 'mixed' END,
    updated_at = now();
  -- A row that only held ingested values and has none any more is removed.
  DELETE FROM public.business_impact_quality_metrics
   WHERE team_id = p_team_id AND month_year = p_month AND value_sources = '{}'::jsonb AND data_source = 'ingested';
END;
$$;

-- Backfill: every month of every real team that has KPI values.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT mv.team_id, to_char(mv.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month
      FROM public.metric_values mv JOIN public.teams t ON t.id = mv.team_id
     WHERE t.company_id NOT LIKE 'demo-%' AND t.company_id <> 'sandbox-demo' AND lower(mv.source) <> 'synthetic' AND mv.superseded_by IS NULL
       AND mv.metric_key IN ('test_coverage', 'defect_density', 'defect_escape_rate', 'mttr_hours', 'deployment_frequency_per_week',
                             'lead_time_days', 'code_quality_score', 'change_failure_rate')
  LOOP
    PERFORM public.refresh_business_quality_month(r.team_id, r.month);
  END LOOP;
END $$;

COMMIT;
