-- IronGate QA Navigator: organisation & roles
--
--  1. role_assignments: explicit, multiple role assignments per user
--       super_admin  -> scope 'company'    (scope_id = the company id)
--       qa_manager   -> scope 'department' (scope_id = a department id)
--       team_lead / qa_engineer / viewer -> scope 'team' (scope_id = a team id)
--     A user may hold several (QA manager of two departments, lead of two teams, member of
--     several teams). At most one active assignment per user and scope, and at most one active
--     team_lead per team (the single source of truth for "who leads this team").
--     users.role / department_id / primary_team_id stay as primary/display columns, kept in sync
--     by the server (server/lib/assignments.ts); teams.lead_id, departments.manager_id and
--     team_members are kept in sync too, for compatibility. Nothing old is dropped.
--  2. audit_log: change history of organisation / role / team / department / user / config
--     changes, with undo bookkeeping.
--  3. invitations: email invitations (only the sha256 hash of the token is stored).
--  4. user_identities: SSO (Google / Microsoft OIDC) identities linked to users.
--
-- Backfill: public.backfill_role_assignments(company) derives assignments from the legacy
-- columns for every user that has no assignment row yet (so re-running never resurrects a
-- revoked assignment):
--   super_admin            -> company
--   qa_manager             -> department_id
--   teams.lead_id          -> team_lead of that team
--   role team_lead         -> team_lead of primary_team_id (when that team has no other lead)
--   primary_team_id and team_members rows -> membership of that team (role qa_engineer, or
--                             viewer for viewers), unless the user already has that team
-- then syncs users.role (highest role) and teams.lead_id with the result. The seed calls the
-- same function, so the rule exists once.
--
-- Idempotent: safe to run more than once. Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. role_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_assignments (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  user_id varchar(36) NOT NULL,
  role text NOT NULL,
  scope_type text NOT NULL,
  scope_id varchar(36) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by varchar(36),
  revoked_at timestamptz,
  revoked_by varchar(36),
  CONSTRAINT role_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT role_assignments_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT role_assignments_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT role_assignments_created_by_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT role_assignments_revoked_by_fk FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT role_assignments_role_check CHECK (role IN ('super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer')),
  CONSTRAINT role_assignments_scope_check CHECK (
    (role = 'super_admin' AND scope_type = 'company')
    OR (role = 'qa_manager' AND scope_type = 'department')
    OR (role IN ('team_lead', 'qa_engineer', 'viewer') AND scope_type = 'team')
  )
);

CREATE INDEX IF NOT EXISTS role_assignments_user_idx ON public.role_assignments (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS role_assignments_scope_idx ON public.role_assignments (scope_type, scope_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS role_assignments_company_idx ON public.role_assignments (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS role_assignments_active_scope_uq
  ON public.role_assignments (user_id, scope_type, scope_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS role_assignments_one_lead_uq
  ON public.role_assignments (scope_id) WHERE revoked_at IS NULL AND role = 'team_lead';

ALTER TABLE public.role_assignments ENABLE ROW LEVEL SECURITY;

-- Rank used for "highest role" (users.role display column).
CREATE OR REPLACE FUNCTION public.role_rank(p_role text) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT CASE p_role WHEN 'super_admin' THEN 5 WHEN 'qa_manager' THEN 4 WHEN 'team_lead' THEN 3
                     WHEN 'qa_engineer' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.backfill_role_assignments(p_company_id text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  n_before integer;
  n_after integer;
BEGIN
  SELECT COUNT(*) INTO n_before FROM public.role_assignments;

  -- Users the backfill may touch: no assignment row at all (active or revoked).
  CREATE TEMP TABLE IF NOT EXISTS _ra_users (id varchar(36) PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _ra_users;
  INSERT INTO _ra_users (id)
  SELECT u.id FROM public.users u
   WHERE (p_company_id IS NULL OR u.company_id = p_company_id)
     AND NOT EXISTS (SELECT 1 FROM public.role_assignments ra WHERE ra.user_id = u.id);

  -- super_admin -> company
  INSERT INTO public.role_assignments (company_id, user_id, role, scope_type, scope_id, created_at)
  SELECT u.company_id, u.id, 'super_admin', 'company', u.company_id, COALESCE(u.created_at, now())
    FROM public.users u JOIN _ra_users x ON x.id = u.id
   WHERE u.role = 'super_admin'
  ON CONFLICT DO NOTHING;

  -- qa_manager -> their department
  INSERT INTO public.role_assignments (company_id, user_id, role, scope_type, scope_id, created_at)
  SELECT u.company_id, u.id, 'qa_manager', 'department', d.id, COALESCE(u.created_at, now())
    FROM public.users u JOIN _ra_users x ON x.id = u.id
    JOIN public.departments d ON d.id = u.department_id AND d.company_id = u.company_id
   WHERE u.role = 'qa_manager'
  ON CONFLICT DO NOTHING;

  -- teams.lead_id -> team_lead (the lead shown today takes precedence)
  INSERT INTO public.role_assignments (company_id, user_id, role, scope_type, scope_id, created_at)
  SELECT t.company_id, u.id, 'team_lead', 'team', t.id, COALESCE(u.created_at, now())
    FROM public.teams t JOIN public.users u ON u.id = t.lead_id AND u.company_id = t.company_id
    JOIN _ra_users x ON x.id = u.id
   WHERE u.role IN ('team_lead', 'qa_engineer', 'viewer')
  ON CONFLICT DO NOTHING;

  -- role team_lead -> team_lead of their primary team (earliest first; one lead per team)
  INSERT INTO public.role_assignments (company_id, user_id, role, scope_type, scope_id, created_at)
  SELECT s.company_id, s.id, 'team_lead', 'team', s.team_id, s.created_at
    FROM (
      SELECT DISTINCT ON (t.id) t.company_id, u.id, t.id AS team_id, COALESCE(u.created_at, now()) AS created_at
        FROM public.users u JOIN _ra_users x ON x.id = u.id
        JOIN public.teams t ON t.id = u.primary_team_id AND t.company_id = u.company_id
       WHERE u.role = 'team_lead' AND (t.lead_id IS NULL OR t.lead_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.role_assignments ra
                          WHERE ra.scope_id = t.id AND ra.role = 'team_lead' AND ra.revoked_at IS NULL)
       ORDER BY t.id, u.is_active DESC, u.created_at ASC NULLS LAST
    ) s
  ON CONFLICT DO NOTHING;

  -- memberships: primary team and team_members rows
  INSERT INTO public.role_assignments (company_id, user_id, role, scope_type, scope_id, created_at)
  SELECT DISTINCT ON (u.id, t.id) u.company_id, u.id,
         CASE WHEN u.role = 'viewer' THEN 'viewer' ELSE 'qa_engineer' END, 'team', t.id, COALESCE(u.created_at, now())
    FROM public.users u JOIN _ra_users x ON x.id = u.id
    JOIN LATERAL (
      SELECT u.primary_team_id AS team_id WHERE u.primary_team_id IS NOT NULL
      UNION SELECT tm.team_id FROM public.team_members tm WHERE tm.user_id = u.id
    ) m ON TRUE
    JOIN public.teams t ON t.id = m.team_id AND t.company_id = u.company_id
   WHERE NOT EXISTS (SELECT 1 FROM public.role_assignments ra
                      WHERE ra.user_id = u.id AND ra.scope_type = 'team' AND ra.scope_id = t.id AND ra.revoked_at IS NULL)
  ON CONFLICT DO NOTHING;

  -- Display columns of the backfilled users: role = highest active assignment.
  UPDATE public.users u SET role = r.role
    FROM (
      SELECT DISTINCT ON (ra.user_id) ra.user_id, ra.role
        FROM public.role_assignments ra JOIN _ra_users x ON x.id = ra.user_id
       WHERE ra.revoked_at IS NULL
       ORDER BY ra.user_id, public.role_rank(ra.role) DESC
    ) r
   WHERE u.id = r.user_id AND u.role IS DISTINCT FROM r.role;

  -- teams.lead_id follows the active team_lead assignment.
  UPDATE public.teams t SET lead_id = ra.user_id
    FROM public.role_assignments ra
   WHERE ra.scope_type = 'team' AND ra.scope_id = t.id AND ra.role = 'team_lead' AND ra.revoked_at IS NULL
     AND (p_company_id IS NULL OR t.company_id = p_company_id)
     AND t.lead_id IS DISTINCT FROM ra.user_id;

  SELECT COUNT(*) INTO n_after FROM public.role_assignments;
  RETURN n_after - n_before;
END;
$$;

SELECT public.backfill_role_assignments(NULL);

-- ---------------------------------------------------------------------------
-- 2. audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  actor_id varchar(36),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id varchar(64),
  summary text,
  before jsonb,
  after jsonb,
  -- Departments the change concerns (before and after); QA managers see their departments' entries.
  department_ids varchar(36)[] NOT NULL DEFAULT '{}',
  -- Every entity id the change touched (users, teams, departments): a newer, not undone entry
  -- that shares one of them blocks the undo of an older entry.
  subject_ids varchar(64)[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  undone_by varchar(36),
  -- Set on the entry written by an undo: the entry it undid.
  undo_of varchar(36),
  CONSTRAINT audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT audit_log_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT audit_log_actor_fk FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT audit_log_undone_by_fk FOREIGN KEY (undone_by) REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS audit_log_company_created_idx ON public.audit_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (company_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_departments_idx ON public.audit_log USING gin (department_ids);
CREATE INDEX IF NOT EXISTS audit_log_subjects_idx ON public.audit_log USING gin (subject_ids);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. invitations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invitations (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  email varchar(255) NOT NULL,
  role text NOT NULL,
  scope_type text NOT NULL,
  scope_id varchar(36) NOT NULL,
  token_hash char(64) NOT NULL,
  invited_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  send_count integer NOT NULL DEFAULT 1,
  accepted_at timestamptz,
  accepted_user_id varchar(36),
  revoked_at timestamptz,
  revoked_by varchar(36),
  CONSTRAINT invitations_pkey PRIMARY KEY (id),
  CONSTRAINT invitations_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT invitations_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT invitations_invited_by_fk FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT invitations_accepted_user_fk FOREIGN KEY (accepted_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT invitations_revoked_by_fk FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT invitations_role_check CHECK (
    (role = 'super_admin' AND scope_type = 'company')
    OR (role = 'qa_manager' AND scope_type = 'department')
    OR (role IN ('team_lead', 'qa_engineer', 'viewer') AND scope_type = 'team')
  )
);

CREATE INDEX IF NOT EXISTS invitations_company_idx ON public.invitations (company_id, created_at DESC);
-- One open invitation per email address and company.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_open_email_uq
  ON public.invitations (company_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. user_identities (SSO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_identities (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  user_id varchar(36) NOT NULL,
  provider text NOT NULL,
  subject text NOT NULL,
  email varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CONSTRAINT user_identities_pkey PRIMARY KEY (id),
  CONSTRAINT user_identities_provider_subject_unique UNIQUE (provider, subject),
  CONSTRAINT user_identities_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT user_identities_provider_check CHECK (provider IN ('google', 'microsoft'))
);

CREATE INDEX IF NOT EXISTS user_identities_user_idx ON public.user_identities (user_id);

ALTER TABLE public.user_identities ENABLE ROW LEVEL SECURITY;

COMMIT;
