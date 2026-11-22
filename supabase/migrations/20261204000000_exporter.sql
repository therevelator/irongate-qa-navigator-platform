-- IronGate QA Navigator: the QE Navigator Exporter (reads a customer's tools inside their network and sends the raw
-- data to POST /api/ingest/exporter/batch; QE Navigator calculates every value).
--
--  1. exporter_heartbeats: per company and API key, the last heartbeat of an Exporter (its version, the sources
--     with their last success and error counts; no data), for Connect your CI → Exporter status.
--  2. ingestion_log.channel gets the value 'exporter': every batch an Exporter sends is logged as channel Exporter.
--
-- The Exporter calculates nothing, so no other table or column is needed (values are written by the server's own
-- calculation, as for every other ingestion path).
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped. RLS on for the new table, no policies (the
-- API connects as the table owner and is the only reader). Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

CREATE TABLE IF NOT EXISTS public.exporter_heartbeats (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  api_key_id varchar(36) NOT NULL,
  exporter_version varchar(40) NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  beats integer NOT NULL DEFAULT 1,
  CONSTRAINT exporter_heartbeats_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS exporter_heartbeats_uq ON public.exporter_heartbeats (company_id, api_key_id);
ALTER TABLE public.exporter_heartbeats ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_log_channel_check'
              AND pg_get_constraintdef(oid) NOT LIKE '%exporter%') THEN
    ALTER TABLE public.ingestion_log DROP CONSTRAINT ingestion_log_channel_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_log_channel_check') THEN
    ALTER TABLE public.ingestion_log
      ADD CONSTRAINT ingestion_log_channel_check CHECK (channel IN ('api', 'manual', 'upload', 'exporter'));
  END IF;
END $$;

COMMIT;
