-- IronGate QA Navigator: KPI integrity + source-agnostic ingestion
--
--  1. QA score / status are computed by the database (BEFORE INSERT OR UPDATE trigger on
--     kpi_snapshots) with exactly the rules of computeQaScore / qaStatusFromScore in
--     server/lib/metricFormulas.ts, so stored values can never drift from their inputs.
--     All existing rows are recomputed (backfill).
--  2. Column widening: developer_metrics.happiness_score numeric(3,1) -> numeric(4,1) (stores 100.0);
--     kpi_snapshots.deployment_frequency_per_week integer -> numeric(6,2) (fractional weekly rates).
--     No views or functions depend on either column.
--  3. kpi_snapshots.field_sources: per-field provenance {column: {source, recorded_at, recorded_by}}.
--  4. api_keys: per-company keys for POST /api/ingest/kpis (only sha256 hashes are stored).
--
-- Idempotent: safe to run more than once. Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

-- ---------------------------------------------------------------------------
-- 2. Column widening (before the trigger exists; a type change does not fire triggers anyway)
-- ---------------------------------------------------------------------------
ALTER TABLE public.developer_metrics
  ALTER COLUMN happiness_score TYPE numeric(4,1);

ALTER TABLE public.kpi_snapshots
  ALTER COLUMN deployment_frequency_per_week TYPE numeric(6,2)
  USING deployment_frequency_per_week::numeric(6,2);

-- ---------------------------------------------------------------------------
-- 3. Per-field provenance
-- ---------------------------------------------------------------------------
ALTER TABLE public.kpi_snapshots
  ADD COLUMN IF NOT EXISTS field_sources jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 1. QA score in the database
-- ---------------------------------------------------------------------------
-- Mirrors computeQaScore() step by step, in IEEE-754 double precision like JavaScript:
--   terms (in this order): coverage, 100 - escape rate, 100 - change failure rate, code quality,
--   each clamped to 0..100; missing inputs (NULL, NaN, ±Infinity) are left out;
--   score = Σ(term × weight) ÷ Σ(weights of present terms), weights 0.30/0.25/0.25/0.20;
--   NULL when coverage is missing or fewer than 2 inputs are present;
--   rounded like Math.round (halves round up).
CREATE OR REPLACE FUNCTION public.compute_qa_score(
  p_test_coverage numeric,
  p_defect_escape_rate numeric,
  p_change_failure_rate numeric,
  p_code_quality_score numeric
) RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  -- Same doubles as the JS literals in QA_SCORE_WEIGHTS.
  w_cov CONSTANT double precision := 0.30;
  w_esc CONSTANT double precision := 0.25;
  w_cfr CONSTANT double precision := 0.25;
  w_cq  CONSTANT double precision := 0.20;
  cov double precision;
  esc double precision;
  cfr double precision;
  cq  double precision;
  weighted double precision := 0;
  weight_sum double precision := 0;
  present integer := 0;
  x double precision;
  f double precision;
BEGIN
  -- toNum(): numeric -> nearest double; non-finite counts as missing.
  cov := p_test_coverage::double precision;
  IF cov IS NOT NULL AND (cov = 'NaN'::double precision OR cov IN ('Infinity'::double precision, '-Infinity'::double precision)) THEN cov := NULL; END IF;
  esc := p_defect_escape_rate::double precision;
  IF esc IS NOT NULL AND (esc = 'NaN'::double precision OR esc IN ('Infinity'::double precision, '-Infinity'::double precision)) THEN esc := NULL; END IF;
  cfr := p_change_failure_rate::double precision;
  IF cfr IS NOT NULL AND (cfr = 'NaN'::double precision OR cfr IN ('Infinity'::double precision, '-Infinity'::double precision)) THEN cfr := NULL; END IF;
  cq := p_code_quality_score::double precision;
  IF cq IS NOT NULL AND (cq = 'NaN'::double precision OR cq IN ('Infinity'::double precision, '-Infinity'::double precision)) THEN cq := NULL; END IF;

  -- Accumulate in the same order as the JS reduce().
  IF cov IS NOT NULL THEN
    weight_sum := weight_sum + w_cov;
    weighted := weighted + LEAST(100::double precision, GREATEST(0::double precision, cov)) * w_cov;
    present := present + 1;
  END IF;
  IF esc IS NOT NULL THEN
    weight_sum := weight_sum + w_esc;
    weighted := weighted + LEAST(100::double precision, GREATEST(0::double precision, 100 - esc)) * w_esc;
    present := present + 1;
  END IF;
  IF cfr IS NOT NULL THEN
    weight_sum := weight_sum + w_cfr;
    weighted := weighted + LEAST(100::double precision, GREATEST(0::double precision, 100 - cfr)) * w_cfr;
    present := present + 1;
  END IF;
  IF cq IS NOT NULL THEN
    weight_sum := weight_sum + w_cq;
    weighted := weighted + LEAST(100::double precision, GREATEST(0::double precision, cq)) * w_cq;
    present := present + 1;
  END IF;

  IF cov IS NULL OR present < 2 OR weight_sum <= 0 THEN
    RETURN NULL;
  END IF;

  x := weighted / weight_sum;           -- always within 0..100
  f := floor(x);
  -- Math.round for x >= 0 (x - floor(x) is exact in binary floating point).
  IF x - f >= 0.5 THEN f := f + 1; END IF;
  RETURN f::integer;
END;
$$;

-- Mirrors qaStatusFromScore(): >=85 good, >=70 warning, otherwise critical; NULL stays NULL.
CREATE OR REPLACE FUNCTION public.qa_status_from_score(p_score integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_score IS NULL THEN NULL
    WHEN p_score >= 85 THEN 'good'
    WHEN p_score >= 70 THEN 'warning'
    ELSE 'critical'
  END;
$$;

CREATE OR REPLACE FUNCTION public.kpi_snapshots_set_qa_score()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- qa_score / status are never taken from the writer: always recomputed from the row's inputs.
  NEW.qa_score := public.compute_qa_score(
    NEW.test_coverage, NEW.defect_escape_rate, NEW.change_failure_rate, NEW.code_quality_score::numeric
  );
  NEW.status := public.qa_status_from_score(NEW.qa_score);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kpi_snapshots_qa_score ON public.kpi_snapshots;
CREATE TRIGGER kpi_snapshots_qa_score
  BEFORE INSERT OR UPDATE ON public.kpi_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.kpi_snapshots_set_qa_score();

-- Backfill: a no-op UPDATE fires the trigger and recomputes every stored score/status.
UPDATE public.kpi_snapshots SET qa_score = qa_score;

-- ---------------------------------------------------------------------------
-- 4. API keys for KPI ingestion
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_keys (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  name varchar(100) NOT NULL,
  key_prefix varchar(16) NOT NULL,
  key_hash char(64) NOT NULL,
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT api_keys_pkey PRIMARY KEY (id),
  CONSTRAINT api_keys_key_hash_unique UNIQUE (key_hash),
  CONSTRAINT api_keys_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT api_keys_created_by_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS api_keys_company_idx ON public.api_keys (company_id);

-- Same posture as the other tables: RLS on, no policies (only the API's postgres role reads it).
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

COMMIT;
