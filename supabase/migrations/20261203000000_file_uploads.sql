-- IronGate QA Navigator: file uploads ("Level 0": Admin console → Upload files) and the field allow-list.
--
--  1. companies.store_issue_titles: the company setting "Store issue and incident titles" (default true,
--     the behaviour before this migration). When false, issue and incident titles are dropped on every
--     write path (ingestion API, uploads, the agent) and the stored ones are cleared by the server when
--     the setting is switched off (server/routes/uploads.ts PUT /api/uploads/privacy).
--  2. ingestion_log.channel accepts 'upload': a file upload made by a signed-in person (actor_id), next
--     to 'api' (an API key) and 'manual' (Manual metrics).
--
-- No new table, no file is stored: the parsed rows go to the existing raw tables and raw_uploads keeps
-- the minimised copy it already keeps for the API (same retention).
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed (the channel check is
-- replaced by a wider one). RLS stays on for every table, no policies (the API is the only reader).
-- Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS store_issue_titles boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_log_channel_check'
              AND pg_get_constraintdef(oid) NOT LIKE '%upload%') THEN
    ALTER TABLE public.ingestion_log DROP CONSTRAINT ingestion_log_channel_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_log_channel_check') THEN
    ALTER TABLE public.ingestion_log
      ADD CONSTRAINT ingestion_log_channel_check CHECK (channel IN ('api', 'manual', 'upload'));
  END IF;
END $$;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_log ENABLE ROW LEVEL SECURITY;

COMMIT;
