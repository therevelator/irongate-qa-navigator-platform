-- Custom roles and invitations that carry several assignments (additive, idempotent).
--
--   custom_roles                 a company's own roles. Each starts from one of the five access levels (base_role:
--                                it keeps that level's scope, rank and people-management rules) and adds or removes
--                                permissions from the level's recommended set (server/lib/userPolicy.ts, CAPABILITIES).
--   role_assignments.custom_role_id   the custom role of an assignment; role stays the base level. NULL = the plain level.
--   invitations.custom_role_id        the same for an invitation's first assignment.
--   invitations.extra_grants          further assignments given when the invitation is accepted:
--                                     [{ "role", "scopeType", "scopeId", "customRoleId"? }, …]

CREATE TABLE IF NOT EXISTS public.custom_roles (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  name varchar(60) NOT NULL,
  description varchar(300),
  base_role text NOT NULL,
  added text[] NOT NULL DEFAULT '{}',
  removed text[] NOT NULL DEFAULT '{}',
  template_key varchar(40),
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT custom_roles_pkey PRIMARY KEY (id),
  CONSTRAINT custom_roles_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT custom_roles_base_check CHECK (base_role IN ('qa_manager', 'team_lead', 'qa_engineer', 'viewer'))
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_roles_name_uq ON public.custom_roles (company_id, lower(name)) WHERE archived_at IS NULL;
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.role_assignments ADD COLUMN IF NOT EXISTS custom_role_id varchar(36);
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS custom_role_id varchar(36);
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS extra_grants jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_assignments_custom_role_fk') THEN
    ALTER TABLE public.role_assignments ADD CONSTRAINT role_assignments_custom_role_fk FOREIGN KEY (custom_role_id) REFERENCES public.custom_roles(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitations_custom_role_fk') THEN
    ALTER TABLE public.invitations ADD CONSTRAINT invitations_custom_role_fk FOREIGN KEY (custom_role_id) REFERENCES public.custom_roles(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS role_assignments_custom_role_idx ON public.role_assignments (custom_role_id) WHERE custom_role_id IS NOT NULL;
