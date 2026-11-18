-- IronGate QA Navigator: onboarding checklist completion
--
-- onboarding_state.completed_at: when every step of the onboarding checklist was first done. From
-- then on the checklist is not shown again, even if a step later reads as open (for example the
-- only invitation expired). Set by server/lib/onboarding.ts; never cleared by the app.
--
-- Idempotent and additive. Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

ALTER TABLE public.onboarding_state ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMIT;
