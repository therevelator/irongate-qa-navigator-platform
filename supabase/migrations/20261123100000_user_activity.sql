-- IronGate QA Navigator: user activity log
--
-- user_activity: one row per authenticated API request (reads included), sign-in, failed
-- sign-in (only when the email belongs to a user, so the row has a company), API-key ingestion
-- request and screen view sent by the web app. Visible to the company's super admins (and the
-- platform operator). Per row: who (user or API key, with the name / email at the time), the
-- route PATTERN (never the raw URL or query string), the main entity ids from the path, status,
-- duration, client IP, user agent (truncated) and the request id. Never request or response
-- bodies, headers, cookies, tokens or passwords. Rows older than 90 days are deleted by the
-- daily cleanup (db-keepalive).
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed.
-- Target: Postgres 16/17 (Supabase), run as postgres.
-- Row level security is enabled with no policies, so only the API (table owner) can read it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_activity (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  company_id varchar(36) NOT NULL,
  user_id varchar(36),
  api_key_id varchar(36),
  actor_display varchar(255),
  -- sign_in, sign_in_failed, view, screen, change, export, ingest
  category text NOT NULL,
  method varchar(10),
  route text,
  -- Screen views: the screen key (e.g. team-pulse).
  screen text,
  team_id varchar(36),
  entity_type text,
  entity_id varchar(64),
  status integer,
  duration_ms integer,
  ip varchar(64),
  user_agent varchar(200),
  request_id varchar(64),
  CONSTRAINT user_activity_pkey PRIMARY KEY (id),
  CONSTRAINT user_activity_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT user_activity_category_check CHECK (category IN ('sign_in', 'sign_in_failed', 'view', 'screen', 'change', 'export', 'ingest'))
);

CREATE INDEX IF NOT EXISTS user_activity_company_created_idx ON public.user_activity (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_activity_company_user_idx ON public.user_activity (company_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_activity_request_idx ON public.user_activity (request_id);

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

COMMIT;
