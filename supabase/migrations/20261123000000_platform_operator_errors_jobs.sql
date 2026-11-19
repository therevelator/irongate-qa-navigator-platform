-- IronGate QA Navigator: platform operator panel, server error log and scheduled job runs
--
--  1. platform_operator_sessions: one row per step-up (password re-entered) of a platform
--     operator. The operator token carries its id (jti); "Leave" ends the row, and every
--     /api/operator request checks it is still open and not expired (30 minutes).
--  2. platform_access_log: every access of a platform operator (step-up, failed step-up, views,
--     repair actions), across all companies. The company's own audit_log gets a readable entry
--     too (platform_support.view / platform_support.action), so its super admins see it.
--  3. server_errors: one row per 5xx answer of the API and per failed scheduled job, for remote
--     debugging by request id. Never request bodies, headers, cookies, tokens or query strings.
--     Rows older than 30 days are deleted by the daily cleanup (db-keepalive).
--  4. job_runs: one row per scheduled job run (started, finished, ok / failed, short summary).
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed.
-- Target: Postgres 16/17 (Supabase), run as postgres.
-- Row level security is enabled with no policies, so only the API (table owner) can read these.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. platform_operator_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_operator_sessions (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  user_id varchar(36) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  ip varchar(64),
  CONSTRAINT platform_operator_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT platform_operator_sessions_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS platform_operator_sessions_user_idx ON public.platform_operator_sessions (user_id, created_at DESC);

ALTER TABLE public.platform_operator_sessions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. platform_access_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_access_log (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- No foreign keys: the log outlives deleted users and companies.
  operator_user_id varchar(36),
  operator_email varchar(255),
  -- step_up.ok, step_up.failed, step_up.refused, session.end, view, action
  action text NOT NULL,
  company_id varchar(36),
  section text,
  reason text,
  detail jsonb,
  ip varchar(64),
  request_id varchar(64),
  CONSTRAINT platform_access_log_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS platform_access_log_created_idx ON public.platform_access_log (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_access_log_company_idx ON public.platform_access_log (company_id, created_at DESC);

ALTER TABLE public.platform_access_log ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. server_errors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.server_errors (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_id varchar(64),
  method varchar(10),
  -- Route pattern (/api/teams/:id) or the path without its query string.
  route text,
  status integer,
  error_name text,
  error_message text,
  -- Truncated to about 4 KB.
  stack text,
  company_id varchar(36),
  user_id varchar(36),
  -- 'api' or the scheduled job's name.
  function_name text NOT NULL DEFAULT 'api',
  CONSTRAINT server_errors_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS server_errors_created_idx ON public.server_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS server_errors_company_idx ON public.server_errors (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS server_errors_request_idx ON public.server_errors (request_id);

ALTER TABLE public.server_errors ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. job_runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_runs (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  job text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  summary text,
  CONSTRAINT job_runs_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS job_runs_job_idx ON public.job_runs (job, started_at DESC);

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

COMMIT;
