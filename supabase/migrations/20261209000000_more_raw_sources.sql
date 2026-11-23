-- More raw sources, so that no module needs a typed-in value (additive, idempotent).
--
--   1. Performance: the result files of load tests (k6, JMeter, Gatling) a pipeline keeps, read by the
--      QE Navigator Exporter from the CI artifacts and parsed here (performance_runs, performance_results).
--      The Performance page reads them (the latest run of each day and endpoint).
--   2. Test management (TestRail, Xray, Zephyr Scale): test cases with "automated or not" and their manual
--      estimate, and test executions (tm_cases, tm_executions). automation_coverage and automation_roi are
--      calculated from them (calculation group 'automation'); the work items of test automation are the issues
--      labelled "test-automation" (the Exporter sets the label from the labels the customer names): their time
--      logged is the time invested.
--   3. Developer metrics: pull requests (opened, first review, merged) and calendar free/busy intervals per
--      person and day (pull_requests_raw, calendar_days, calendar_busy). People are pseudonyms:
--      sha256(lower(e-mail) || ':' || company id), computed by the Exporter. QE Navigator keeps a pseudonym
--      only when it is that of a user of the company who enabled developer insights; the developer metrics
--      are calculated from these records (server/lib/developerFromRaw.ts).

CREATE TABLE IF NOT EXISTS public.performance_runs (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  tool text NOT NULL,
  run_key varchar(200) NOT NULL,
  commit_sha varchar(80) NOT NULL DEFAULT '',
  branch varchar(255),
  repo varchar(255),
  started_at timestamptz NOT NULL,
  day date NOT NULL,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_runs_pkey PRIMARY KEY (id),
  CONSTRAINT performance_runs_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT performance_runs_tool_check CHECK (tool IN ('k6', 'jmeter', 'gatling'))
);
CREATE UNIQUE INDEX IF NOT EXISTS performance_runs_uq ON public.performance_runs (team_id, run_key);
CREATE INDEX IF NOT EXISTS performance_runs_team_day_idx ON public.performance_runs (team_id, day);
ALTER TABLE public.performance_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.performance_results (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  run_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  endpoint varchar(500) NOT NULL,
  requests integer,
  errors integer,
  p50_ms numeric(12,2),
  p95_ms numeric(12,2),
  p99_ms numeric(12,2),
  throughput_per_minute numeric(14,2),
  error_rate numeric(6,3),
  CONSTRAINT performance_results_pkey PRIMARY KEY (id),
  CONSTRAINT performance_results_run_fk FOREIGN KEY (run_id) REFERENCES public.performance_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS performance_results_run_idx ON public.performance_results (run_id);
ALTER TABLE public.performance_results ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tm_cases (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  source text NOT NULL,
  case_key varchar(200) NOT NULL,
  automated boolean NOT NULL DEFAULT false,
  manual_estimate_s integer,
  archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tm_cases_pkey PRIMARY KEY (id),
  CONSTRAINT tm_cases_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS tm_cases_uq ON public.tm_cases (team_id, source, case_key);
ALTER TABLE public.tm_cases ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tm_executions (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  source text NOT NULL,
  execution_key varchar(200) NOT NULL,
  case_key varchar(200) NOT NULL,
  automated boolean NOT NULL DEFAULT false,
  status text,
  executed_at timestamptz NOT NULL,
  day date NOT NULL,
  duration_s integer,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tm_executions_pkey PRIMARY KEY (id),
  CONSTRAINT tm_executions_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS tm_executions_uq ON public.tm_executions (team_id, source, execution_key);
CREATE INDEX IF NOT EXISTS tm_executions_team_day_idx ON public.tm_executions (team_id, day);
ALTER TABLE public.tm_executions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pull_requests_raw (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  source text NOT NULL,
  repo varchar(255) NOT NULL DEFAULT '',
  pr_key varchar(200) NOT NULL,
  author_hash varchar(64),
  state text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL,
  first_review_at timestamptz,
  merged_at timestamptz,
  closed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pull_requests_raw_pkey PRIMARY KEY (id),
  CONSTRAINT pull_requests_raw_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT pull_requests_raw_state_check CHECK (state IN ('open', 'merged', 'closed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS pull_requests_raw_uq ON public.pull_requests_raw (team_id, source, repo, pr_key);
CREATE INDEX IF NOT EXISTS pull_requests_raw_author_idx ON public.pull_requests_raw (team_id, author_hash, merged_at);
ALTER TABLE public.pull_requests_raw ENABLE ROW LEVEL SECURITY;

-- One row per person and day whose calendar was read (a day with no busy interval is a day without meetings, not a gap).
CREATE TABLE IF NOT EXISTS public.calendar_days (
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  person_hash varchar(64) NOT NULL,
  day date NOT NULL,
  work_start_min integer NOT NULL DEFAULT 540,
  work_end_min integer NOT NULL DEFAULT 1020,
  utc_offset_min integer NOT NULL DEFAULT 0,
  out_of_office boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_days_pkey PRIMARY KEY (team_id, person_hash, day),
  CONSTRAINT calendar_days_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE
);
ALTER TABLE public.calendar_days ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.calendar_busy (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  team_id varchar(36) NOT NULL,
  person_hash varchar(64) NOT NULL,
  day date NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  CONSTRAINT calendar_busy_pkey PRIMARY KEY (id),
  CONSTRAINT calendar_busy_day_fk FOREIGN KEY (team_id, person_hash, day) REFERENCES public.calendar_days(team_id, person_hash, day) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS calendar_busy_day_idx ON public.calendar_busy (team_id, person_hash, day);
ALTER TABLE public.calendar_busy ENABLE ROW LEVEL SECURITY;

-- Where a developer's current metrics came from: 'manual' (typed in Manual metrics) or 'computed' (from the records above).
ALTER TABLE public.developer_metrics ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.developer_metrics ADD COLUMN IF NOT EXISTS computed_at timestamptz;

-- The calculation queue takes the new group.
DO $$
BEGIN
  IF to_regclass('public.calc_queue') IS NOT NULL THEN
    ALTER TABLE public.calc_queue DROP CONSTRAINT IF EXISTS calc_queue_kinds_check;
    ALTER TABLE public.calc_queue ADD CONSTRAINT calc_queue_kinds_check
      CHECK (cardinality(kinds) > 0 AND kinds <@ ARRAY['ci', 'delivery', 'work', 'quality', 'automation']::text[]);
  END IF;
END $$;
