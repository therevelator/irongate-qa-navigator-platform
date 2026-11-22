-- IronGate QA Navigator: the QE Navigator Collector (values calculated in a customer's network).
--
--  1. metric_evidence gets the origin of a value: 'server' (calculated here from the raw store, as before) or
--     'collector' (calculated by the customer's QE Navigator Collector with the shared engine and sent to
--     POST /api/ingest/collector/metrics), with the engine and Collector versions, the privacy mode (evidence:
--     the allowed evidence lists are in sources; metrics: values and counts only) and, in metrics mode, the
--     customer's local evidence page.
--  2. collector_evidence: per team, the latest evidence panel a Collector sent in evidence mode (flaky tests,
--     lowest-coverage files, slowest and failing stages), shown where the raw data would be.
--  3. collector_heartbeats: per company and API key, the last heartbeat of a Collector (versions, privacy mode,
--     the sources with their last success and error counts; no data), for Connect your CI → Collector status.
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed; existing rows keep origin
-- 'server'. RLS on for the new tables, no policies (the API connects as the table owner and is the only reader).
-- Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

ALTER TABLE public.metric_evidence ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'server';
ALTER TABLE public.metric_evidence ADD COLUMN IF NOT EXISTS engine_version varchar(20);
ALTER TABLE public.metric_evidence ADD COLUMN IF NOT EXISTS collector_version varchar(40);
ALTER TABLE public.metric_evidence ADD COLUMN IF NOT EXISTS privacy_mode varchar(10);
ALTER TABLE public.metric_evidence ADD COLUMN IF NOT EXISTS local_evidence_url varchar(500);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metric_evidence_origin_check') THEN
    ALTER TABLE public.metric_evidence ADD CONSTRAINT metric_evidence_origin_check CHECK (origin IN ('server', 'collector'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metric_evidence_privacy_mode_check') THEN
    ALTER TABLE public.metric_evidence ADD CONSTRAINT metric_evidence_privacy_mode_check CHECK (privacy_mode IS NULL OR privacy_mode IN ('evidence', 'metrics'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.collector_evidence (
  team_id varchar(36) NOT NULL,
  company_id varchar(36) NOT NULL,
  as_of date NOT NULL,
  engine_version varchar(20) NOT NULL,
  collector_version varchar(40) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  api_key_id varchar(36),
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collector_evidence_pkey PRIMARY KEY (team_id),
  CONSTRAINT collector_evidence_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS collector_evidence_company_idx ON public.collector_evidence (company_id);
ALTER TABLE public.collector_evidence ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.collector_heartbeats (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  api_key_id varchar(36) NOT NULL,
  collector_version varchar(40) NOT NULL,
  engine_version varchar(20) NOT NULL,
  privacy_mode varchar(10) NOT NULL,
  local_evidence_url varchar(500),
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  beats integer NOT NULL DEFAULT 1,
  CONSTRAINT collector_heartbeats_pkey PRIMARY KEY (id),
  CONSTRAINT collector_heartbeats_mode_check CHECK (privacy_mode IN ('full', 'evidence', 'metrics'))
);
CREATE UNIQUE INDEX IF NOT EXISTS collector_heartbeats_uq ON public.collector_heartbeats (company_id, api_key_id);
ALTER TABLE public.collector_heartbeats ENABLE ROW LEVEL SECURITY;

COMMIT;
