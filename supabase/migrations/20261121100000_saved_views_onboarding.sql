-- IronGate QA Navigator: saved views and the onboarding checklist
--
--  1. saved_views: a named view of the dashboard, an analytics module or the team comparison
--     (filters, scope, sort, grid density, compared teams), owned by one user. A super_admin may
--     share a view with the whole company (shared = true); shared views are read-only for
--     everyone but their owner and company administrators. `state` is validated by the API
--     (server/lib/savedViews.ts): a small JSON object, never data, only choices.
--  2. onboarding_state: per company, whether the super_admin dismissed the onboarding checklist
--     (dashboard). Progress itself is never stored: it is computed from the real state
--     (departments, teams, people, targets, first data) by server/lib/onboarding.ts.
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed.
-- Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

CREATE TABLE IF NOT EXISTS public.saved_views (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  owner_id varchar(36) NOT NULL,
  -- 'dashboard' | 'analytics' | 'compare'
  kind text NOT NULL,
  -- Analytics module (view id, e.g. 'flaky-test-intelligence'); NULL for dashboard and compare.
  module text,
  name text NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  shared boolean NOT NULL DEFAULT false,
  shared_by varchar(36),
  shared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_views_pkey PRIMARY KEY (id),
  CONSTRAINT saved_views_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT saved_views_owner_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT saved_views_shared_by_fk FOREIGN KEY (shared_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT saved_views_kind_check CHECK (kind IN ('dashboard', 'analytics', 'compare')),
  CONSTRAINT saved_views_module_check CHECK ((kind = 'analytics') = (module IS NOT NULL)),
  CONSTRAINT saved_views_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT saved_views_state_check CHECK (jsonb_typeof(state) = 'object')
);

CREATE INDEX IF NOT EXISTS saved_views_owner_idx ON public.saved_views (owner_id, kind);
CREATE INDEX IF NOT EXISTS saved_views_company_shared_idx ON public.saved_views (company_id, kind) WHERE shared;
-- One name per owner, kind and module (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_owner_name_uq
  ON public.saved_views (owner_id, kind, COALESCE(module, ''), lower(btrim(name)));

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.onboarding_state (
  company_id varchar(36) NOT NULL,
  dismissed_at timestamptz,
  dismissed_by varchar(36),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_state_pkey PRIMARY KEY (company_id),
  CONSTRAINT onboarding_state_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT onboarding_state_dismissed_by_fk FOREIGN KEY (dismissed_by) REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER TABLE public.onboarding_state ENABLE ROW LEVEL SECURITY;

COMMIT;
