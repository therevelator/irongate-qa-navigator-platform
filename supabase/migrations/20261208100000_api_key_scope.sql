-- IronGate QA Navigator: the scope of an API key (api_keys.scope).
--
--   ingest    the key writes data (POST /api/ingest/*) and reads nothing.
--   exporter  the same, and the QE Navigator Exporter may also read GET /api/ingest/exporter/context (the company's
--             name, departments and active teams, which the Exporter needs for check and setup). A plain ingest key
--             gets 403 there.
--
-- New keys are created with the scope chosen in Admin console → API keys (default ingest). Every key that exists when
-- this migration runs gets exporter: until now every key could read the context, so an Exporter already set up with
-- an existing key keeps working. A super admin can revoke such a key and create an ingest key in its place.
--
-- Idempotent: safe to run more than once (a second run changes nothing, existing values are kept). Additive: nothing
-- is dropped. Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'scope') THEN
    -- The rows that exist now are filled with 'exporter' (the column default at the time it is added) ...
    ALTER TABLE public.api_keys ADD COLUMN scope varchar(20) NOT NULL DEFAULT 'exporter';
  END IF;
END $$;

-- ... and keys created from now on are plain ingest keys unless the creator chooses exporter.
ALTER TABLE public.api_keys ALTER COLUMN scope SET DEFAULT 'ingest';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_scope_check') THEN
    ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_scope_check CHECK (scope IN ('ingest', 'exporter'));
  END IF;
END $$;

COMMIT;
