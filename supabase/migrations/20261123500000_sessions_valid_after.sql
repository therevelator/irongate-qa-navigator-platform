-- IronGate QA Navigator: sign out everywhere, and a sign-in lifetime set by the company
--
-- users.sessions_valid_after: a session (signed cookie) issued before this time is refused on the
-- next request. Set by a password reset (e-mail link, administrator, own change), "Sign out my
-- other devices", the administrator's "Sign out everywhere" and the platform support repair
-- action. NULL = no session has been ended this way. Stored truncated to the second.
--
-- The sign-in lifetime ("Sign-in lasts", Parameters, super admins) is a company row of the existing
-- configs table (config_key 'session_lifetime_hours'); it needs no schema change.
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed.

BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz;

COMMIT;
