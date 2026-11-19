-- IronGate QA Navigator: reset a forgotten password by e-mail
--
-- One row per reset link sent ("Forgot password?" on the sign-in screen, or "Send reset link" by an
-- administrator in Users). The link carries a random token; only its sha256 is stored here, never
-- the token itself. A link expires after 60 minutes and works once (used_at). A newer link for the
-- same person, or a successful reset, closes the person's other open links (revoked_at).
-- The old users.password_reset_token / password_reset_expires columns stay unused.
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed.
-- Row level security is enabled with no policies, so only the API (table owner) can read it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.password_resets (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  user_id varchar(36) NOT NULL,
  company_id varchar(36) NOT NULL,
  -- sha256 (hex) of the token in the link.
  token_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- Set when the link was used to choose a new password.
  used_at timestamptz,
  -- Set when a newer link or a completed reset closed this one.
  revoked_at timestamptz,
  -- Client address of the request (self-service), for the history only.
  ip varchar(64),
  -- The administrator who sent the link; NULL = the person asked for it.
  requested_by varchar(36),
  CONSTRAINT password_resets_pkey PRIMARY KEY (id),
  CONSTRAINT password_resets_token_hash_key UNIQUE (token_hash),
  CONSTRAINT password_resets_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT password_resets_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT password_resets_requested_by_fk FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT password_resets_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS password_resets_user_idx ON public.password_resets (user_id, created_at DESC);

ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

COMMIT;
