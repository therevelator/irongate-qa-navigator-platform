-- QE Navigator v2, phase 1: raw ingestion of test reports, coverage reports and pipeline runs,
-- and the evidence behind every computed metric (docs/V2_PLAN.md, "Data model").
--
--   raw_uploads           every file or event received (metadata; the gzip payload is kept for
--                         RAW_PAYLOAD_DAYS, default 35 days, when it is at most RAW_PAYLOAD_MAX_BYTES)
--   test_runs             one row per test report (counts and durations); kept 13 months
--   test_results          one row per test case per report; kept 35 days (flaky detection needs 7)
--   flaky_test_evidence   per test and commit: the runs where it failed and the runs where it passed
--   coverage_reports      one row per coverage report (line / branch totals, changed code); 13 months
--   coverage_files        per file of a report; kept 35 days, the latest report per team always kept
--   pipeline_runs_raw     one row per pipeline run attempt (the existing pipeline_runs table is a
--                         per-stage status table of the v1 pipeline view, so it is left as it is)
--   pipeline_stage_runs   the stages of a pipeline run with their durations and results
--   metric_evidence       per team, day and metric: the computed value, its formula, the values
--                         used, the number of runs it is based on and the source records
--   teams.main_branch     the branch coverage and pass rate are calculated on (null: main or master)
--   is_sample             sample (demo) raw rows: evidence only, never written to the KPI storage
--
-- Idempotent and additive. RLS on, no policies (the API connects as the table owner).

CREATE TABLE IF NOT EXISTS public.raw_uploads (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  kind text NOT NULL,
  format text,
  commit_sha varchar(80) NOT NULL DEFAULT '',
  branch varchar(255),
  run_id varchar(200) NOT NULL DEFAULT '',
  attempt integer NOT NULL DEFAULT 1,
  size_bytes integer NOT NULL DEFAULT 0,
  stored_bytes integer,
  sha256 varchar(64),
  payload bytea,
  status text NOT NULL DEFAULT 'parsed',
  error text,
  summary jsonb,
  parse_ms integer,
  ingestion_id varchar(36),
  api_key_id varchar(36),
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raw_uploads_pkey PRIMARY KEY (id),
  CONSTRAINT raw_uploads_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT raw_uploads_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT raw_uploads_kind_check CHECK (kind IN ('tests', 'coverage', 'pipelines')),
  CONSTRAINT raw_uploads_status_check CHECK (status IN ('parsed', 'failed'))
);
-- Idempotency: one parsed upload per team, kind, commit, run id and attempt.
CREATE UNIQUE INDEX IF NOT EXISTS raw_uploads_idem_uq
  ON public.raw_uploads (team_id, kind, commit_sha, run_id, attempt) WHERE status = 'parsed';
CREATE INDEX IF NOT EXISTS raw_uploads_company_received_idx ON public.raw_uploads (company_id, received_at DESC);
CREATE INDEX IF NOT EXISTS raw_uploads_team_kind_idx ON public.raw_uploads (team_id, kind, received_at DESC);
ALTER TABLE public.raw_uploads ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.test_runs (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  upload_id varchar(36),
  format text,
  commit_sha varchar(80) NOT NULL DEFAULT '',
  branch varchar(255),
  run_id varchar(200) NOT NULL DEFAULT '',
  attempt integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL,
  day date NOT NULL,
  total integer NOT NULL DEFAULT 0,
  passed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  errored integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  duration_ms bigint NOT NULL DEFAULT 0,
  tests_duration_ms bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT test_runs_pkey PRIMARY KEY (id),
  CONSTRAINT test_runs_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT test_runs_upload_fk FOREIGN KEY (upload_id) REFERENCES public.raw_uploads(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS test_runs_team_day_idx ON public.test_runs (team_id, day);
CREATE INDEX IF NOT EXISTS test_runs_team_commit_idx ON public.test_runs (team_id, commit_sha);
ALTER TABLE public.test_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.test_results (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  test_run_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  test_key varchar(32) NOT NULL,
  suite varchar(500),
  name varchar(1000) NOT NULL,
  status text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  retries integer NOT NULL DEFAULT 0,
  failure_hash varchar(16),
  failure_message varchar(500),
  CONSTRAINT test_results_pkey PRIMARY KEY (id),
  CONSTRAINT test_results_run_fk FOREIGN KEY (test_run_id) REFERENCES public.test_runs(id) ON DELETE CASCADE,
  CONSTRAINT test_results_status_check CHECK (status IN ('passed', 'failed', 'error', 'skipped'))
);
CREATE INDEX IF NOT EXISTS test_results_run_idx ON public.test_results (test_run_id);
CREATE INDEX IF NOT EXISTS test_results_team_key_idx ON public.test_results (team_id, test_key);
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.flaky_test_evidence (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  test_key varchar(32) NOT NULL,
  suite varchar(500),
  name varchar(1000) NOT NULL,
  commit_sha varchar(80) NOT NULL DEFAULT '',
  failed_run_ids varchar(36)[] NOT NULL DEFAULT '{}'::varchar[],
  passed_run_ids varchar(36)[] NOT NULL DEFAULT '{}'::varchar[],
  failure_message varchar(500),
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  CONSTRAINT flaky_test_evidence_pkey PRIMARY KEY (id),
  CONSTRAINT flaky_test_evidence_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS flaky_test_evidence_uq ON public.flaky_test_evidence (team_id, test_key, commit_sha);
CREATE INDEX IF NOT EXISTS flaky_test_evidence_team_seen_idx ON public.flaky_test_evidence (team_id, last_seen DESC);
ALTER TABLE public.flaky_test_evidence ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.coverage_reports (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  upload_id varchar(36),
  format text,
  commit_sha varchar(80) NOT NULL DEFAULT '',
  branch varchar(255),
  run_id varchar(200) NOT NULL DEFAULT '',
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  day date NOT NULL,
  lines_found integer NOT NULL DEFAULT 0,
  lines_hit integer NOT NULL DEFAULT 0,
  branches_found integer NOT NULL DEFAULT 0,
  branches_hit integer NOT NULL DEFAULT 0,
  file_count integer NOT NULL DEFAULT 0,
  changed_lines_found integer,
  changed_lines_hit integer,
  CONSTRAINT coverage_reports_pkey PRIMARY KEY (id),
  CONSTRAINT coverage_reports_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT coverage_reports_upload_fk FOREIGN KEY (upload_id) REFERENCES public.raw_uploads(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS coverage_reports_team_day_idx ON public.coverage_reports (team_id, day);
ALTER TABLE public.coverage_reports ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.coverage_files (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  report_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  path varchar(1000) NOT NULL,
  lines_found integer NOT NULL DEFAULT 0,
  lines_hit integer NOT NULL DEFAULT 0,
  branches_found integer NOT NULL DEFAULT 0,
  branches_hit integer NOT NULL DEFAULT 0,
  changed_found integer,
  changed_hit integer,
  CONSTRAINT coverage_files_pkey PRIMARY KEY (id),
  CONSTRAINT coverage_files_report_fk FOREIGN KEY (report_id) REFERENCES public.coverage_reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS coverage_files_report_idx ON public.coverage_files (report_id);
ALTER TABLE public.coverage_files ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pipeline_runs_raw (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  upload_id varchar(36),
  external_id varchar(200) NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  name varchar(255),
  commit_sha varchar(80) NOT NULL DEFAULT '',
  branch varchar(255),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  duration_s integer,
  result text NOT NULL,
  url varchar(1000),
  day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_runs_raw_pkey PRIMARY KEY (id),
  CONSTRAINT pipeline_runs_raw_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT pipeline_runs_raw_upload_fk FOREIGN KEY (upload_id) REFERENCES public.raw_uploads(id) ON DELETE SET NULL,
  CONSTRAINT pipeline_runs_raw_result_check CHECK (result IN ('success', 'failed', 'cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_runs_raw_uq ON public.pipeline_runs_raw (team_id, external_id, attempt);
CREATE INDEX IF NOT EXISTS pipeline_runs_raw_team_day_idx ON public.pipeline_runs_raw (team_id, day);
ALTER TABLE public.pipeline_runs_raw ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pipeline_stage_runs (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  pipeline_run_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  name varchar(255) NOT NULL,
  kind text,
  parallel_group varchar(100),
  started_at timestamptz,
  finished_at timestamptz,
  duration_s integer,
  result text NOT NULL,
  CONSTRAINT pipeline_stage_runs_pkey PRIMARY KEY (id),
  CONSTRAINT pipeline_stage_runs_run_fk FOREIGN KEY (pipeline_run_id) REFERENCES public.pipeline_runs_raw(id) ON DELETE CASCADE,
  CONSTRAINT pipeline_stage_runs_result_check CHECK (result IN ('success', 'failed', 'cancelled', 'skipped'))
);
CREATE INDEX IF NOT EXISTS pipeline_stage_runs_run_idx ON public.pipeline_stage_runs (pipeline_run_id);
CREATE INDEX IF NOT EXISTS pipeline_stage_runs_team_idx ON public.pipeline_stage_runs (team_id, name);
ALTER TABLE public.pipeline_stage_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.metric_evidence (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  day date NOT NULL,
  metric_key varchar(64) NOT NULL,
  value numeric(14,4),
  unit varchar(20),
  formula text NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_size integer NOT NULL DEFAULT 0,
  confidence text NOT NULL DEFAULT 'low',
  -- The KPI column it was written to (kpi_snapshots via metric_values, source 'computed'), if any.
  kpi_column varchar(64),
  recorded_at timestamptz,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metric_evidence_pkey PRIMARY KEY (id),
  CONSTRAINT metric_evidence_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT metric_evidence_confidence_check CHECK (confidence IN ('high', 'medium', 'low'))
);
CREATE UNIQUE INDEX IF NOT EXISTS metric_evidence_uq ON public.metric_evidence (team_id, day, metric_key);
CREATE INDEX IF NOT EXISTS metric_evidence_company_idx ON public.metric_evidence (company_id, day DESC);
ALTER TABLE public.metric_evidence ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS main_branch varchar(255);

-- Sample (demo) raw data: its evidence is shown, but it never writes KPI values (the sample KPI
-- values of demo teams stay as generated).
ALTER TABLE public.test_runs ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE public.coverage_reports ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE public.pipeline_runs_raw ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;
