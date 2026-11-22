-- IronGate QA Navigator: the operator log of QE Navigator Exporter deliveries.
--
-- exporter_deliveries: one row per request to POST /api/ingest/exporter/batch, accepted or rejected, for the platform
-- operator panel (Operator → Exporter deliveries). A rejected request with a bad key has no company and keeps the
-- key's prefix only (never the key). preview is a sanitised sample (the first 20 items after the field allow-list,
-- file contents reduced to name, size and hash, at most 64 KB). Rows are kept 30 days (cleanupOperationalLogs).
-- Companies never read this table: they see their own batches in their ingestion log.
--
-- Idempotent and additive. RLS on, no policies (the API connects as the table owner and is the only reader).
-- Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

CREATE TABLE IF NOT EXISTS public.exporter_deliveries (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  company_id varchar(36),
  department_id varchar(36),
  team_id varchar(36),
  claimed_company_id varchar(36),
  claimed_department_id varchar(36),
  claimed_team_id varchar(36),
  api_key_id varchar(36),
  api_key_name varchar(255),
  api_key_prefix varchar(16),
  exporter_version varchar(40),
  host_label varchar(100),
  source varchar(50),
  kind varchar(30),
  item_count integer NOT NULL DEFAULT 0,
  records_from timestamptz,
  records_to timestamptz,
  bytes_received integer,
  bytes_raw integer,
  idempotency_key varchar(200),
  dry_run boolean NOT NULL DEFAULT false,
  result varchar(10) NOT NULL,
  reason_code varchar(40),
  reason varchar(500),
  http_status integer NOT NULL,
  records_stored integer NOT NULL DEFAULT 0,
  preview jsonb,
  CONSTRAINT exporter_deliveries_pkey PRIMARY KEY (id),
  CONSTRAINT exporter_deliveries_result_check CHECK (result IN ('accepted', 'duplicate', 'partial', 'rejected'))
);
CREATE INDEX IF NOT EXISTS exporter_deliveries_received_idx ON public.exporter_deliveries (received_at DESC);
CREATE INDEX IF NOT EXISTS exporter_deliveries_company_idx ON public.exporter_deliveries (company_id, received_at DESC);
ALTER TABLE public.exporter_deliveries ENABLE ROW LEVEL SECURITY;

COMMIT;
