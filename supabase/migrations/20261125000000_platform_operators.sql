-- IronGate QA Navigator: independent platform operators
--
--   1. platform_operators: the IronGate platform support accounts (the product owner). They are NOT
--      users of any company: their own sign-in at /operator (e-mail + bcrypt password, lockout after
--      repeated failures), their own token audience. An e-mail address can never be both an
--      operator and a company user (triggers on both tables). No operator row = the platform
--      support panel is off. Create one with `npm run operator:create` or an INSERT with a bcrypt
--      hash ($2a$/$2b$, cost 12).
--   2. platform_operator_sessions.operator_id: sessions now belong to an operator (user_id kept,
--      nullable, for the rows of the earlier step-up design).
--
-- Idempotent: safe to run more than once. Additive: a new table, a new nullable column, triggers.
-- Can be applied by running this SQL as it is (every statement is safe on its own).

-- 1. platform_operators
CREATE TABLE IF NOT EXISTS public.platform_operators (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  email varchar(255) NOT NULL,
  name varchar(200) NOT NULL,
  password_hash varchar(255) NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  last_login timestamptz,
  failed_login_attempts integer DEFAULT 0 NOT NULL,
  locked_until timestamptz,
  CONSTRAINT platform_operators_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_operators_email_unique ON public.platform_operators (LOWER(email));
ALTER TABLE public.platform_operators ENABLE ROW LEVEL SECURITY;

-- An e-mail address is either a platform operator or a company user, never both.
CREATE OR REPLACE FUNCTION public.platform_operator_email_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'platform_operators' THEN
    IF EXISTS (SELECT 1 FROM public.users u WHERE LOWER(u.email) = LOWER(NEW.email)) THEN
      RAISE EXCEPTION 'This e-mail address belongs to a company user and cannot be a platform operator' USING ERRCODE = '23505';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.platform_operators o WHERE LOWER(o.email) = LOWER(NEW.email)) THEN
      RAISE EXCEPTION 'This e-mail address cannot be used' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS platform_operators_email_guard ON public.platform_operators;
CREATE TRIGGER platform_operators_email_guard BEFORE INSERT OR UPDATE OF email ON public.platform_operators
  FOR EACH ROW EXECUTE FUNCTION public.platform_operator_email_guard();
DROP TRIGGER IF EXISTS users_platform_operator_email_guard ON public.users;
CREATE TRIGGER users_platform_operator_email_guard BEFORE INSERT OR UPDATE OF email ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.platform_operator_email_guard();

-- 2. Operator sessions belong to an operator
ALTER TABLE public.platform_operator_sessions ADD COLUMN IF NOT EXISTS operator_id varchar(36);
ALTER TABLE public.platform_operator_sessions ALTER COLUMN user_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_operator_sessions_operator_fk') THEN
    ALTER TABLE public.platform_operator_sessions
      ADD CONSTRAINT platform_operator_sessions_operator_fk FOREIGN KEY (operator_id) REFERENCES public.platform_operators(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS platform_operator_sessions_operator_idx ON public.platform_operator_sessions (operator_id, created_at DESC);
