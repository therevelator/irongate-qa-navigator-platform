-- IronGate QA Navigator: company suspension, sign-in events and the sessions table
--
--   1. companies.status ('active' | 'suspended') with suspended_reason, suspended_at, suspended_by
--      (the platform operator), suspended_until and billing_note. A suspended company's users cannot
--      sign in or use the API (403 company_suspended), its API keys are refused and the scheduled
--      jobs (alerts, pulse sends, digest, sample data refresh) skip it. Existing rows become 'active'.
--   2. auth_events: every sign-in (password, SSO, invitation, password reset) and every failed
--      sign-in, with the client IP, the country / region / city from Netlify's geo header (nothing
--      when absent), and the user agent parsed into browser / OS / device. A failed sign-in of an
--      unknown e-mail stores only a keyed hash of the e-mail. Kept 180 days (daily cleanup).
--   3. user_sessions: one row per issued company session (id = the token's jti): issued, expires
--      (company sign-in lifetime), persistent or browser session, last seen (updated at most every
--      5 minutes), IP / country at issue and last seen, revoked (when, by whom, why). Kept 180 days.
--   4. Operator activity is no longer logged anywhere: platform_access_log is no longer written (the
--      table stays, unused; its reason column is made nullable), and operator views and actions are
--      no longer written to the company's audit_log: the earlier "Platform support …" entries
--      (platform_support.view / .action) are removed.
--
-- Idempotent: safe to run more than once. Additive except step 4's removal of the platform
-- support entries from audit_log. No backfill needed: existing companies get status 'active',
-- existing sessions have no jti and keep working (they get no user_sessions row).
-- Row level security is enabled with no policies, so only the API (table owner) can read these.
-- Can be applied by running this SQL as it is (every statement is safe on its own).

-- 1. Company status
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS status varchar(16) DEFAULT 'active' NOT NULL;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS suspended_reason text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS suspended_by varchar(36);
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS suspended_until timestamptz;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS billing_note text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_status_check') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_status_check CHECK (status IN ('active', 'suspended'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_suspended_by_fk') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_suspended_by_fk FOREIGN KEY (suspended_by) REFERENCES public.platform_operators(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Sign-in events
CREATE TABLE IF NOT EXISTS public.auth_events (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  -- No foreign keys to users: a failed sign-in may concern no user; rows go with the company.
  company_id varchar(36),
  user_id varchar(36),
  email_hash varchar(64),
  outcome varchar(16) NOT NULL,
  method varchar(32) NOT NULL,
  failure_reason varchar(40),
  session_id varchar(36),
  ip varchar(64),
  country varchar(80),
  country_code varchar(8),
  region varchar(120),
  city varchar(120),
  user_agent varchar(300),
  browser varchar(60),
  os varchar(60),
  device varchar(20),
  request_id varchar(64),
  CONSTRAINT auth_events_pkey PRIMARY KEY (id),
  CONSTRAINT auth_events_outcome_check CHECK (outcome IN ('success', 'failure'))
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_events_company_fk') THEN
    ALTER TABLE public.auth_events
      ADD CONSTRAINT auth_events_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS auth_events_company_idx ON public.auth_events (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_user_idx ON public.auth_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_created_idx ON public.auth_events (created_at DESC);
ALTER TABLE public.auth_events ENABLE ROW LEVEL SECURITY;

-- 3. Company sessions
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id varchar(36) NOT NULL,
  user_id varchar(36) NOT NULL,
  company_id varchar(36) NOT NULL,
  method varchar(32),
  issued_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL,
  persistent boolean DEFAULT false NOT NULL,
  last_seen_at timestamptz,
  ip varchar(64),
  country varchar(80),
  city varchar(120),
  last_ip varchar(64),
  last_country varchar(80),
  user_agent varchar(300),
  browser varchar(60),
  os varchar(60),
  device varchar(20),
  revoked_at timestamptz,
  revoked_by varchar(255),
  revoke_reason varchar(300),
  CONSTRAINT user_sessions_pkey PRIMARY KEY (id)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_sessions_user_fk') THEN
    ALTER TABLE public.user_sessions
      ADD CONSTRAINT user_sessions_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_sessions_company_fk') THEN
    ALTER TABLE public.user_sessions
      ADD CONSTRAINT user_sessions_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON public.user_sessions (user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS user_sessions_company_idx ON public.user_sessions (company_id, issued_at DESC);
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- 4. Operator activity is not logged (no platform_access_log writes, no company audit entries)
ALTER TABLE public.platform_access_log ALTER COLUMN reason DROP NOT NULL;
DELETE FROM public.audit_log WHERE action IN ('platform_support.view', 'platform_support.action');
