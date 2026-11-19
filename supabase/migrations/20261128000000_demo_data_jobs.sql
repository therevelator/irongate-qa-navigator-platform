-- IronGate QA Navigator: progress of the platform operator panel's "Demo Data" and "Populate metrics"
--
--   demo_data_jobs: one row per run (a company, the kind, its parameters: the new teams' ids, never a
--   password), its status (queued, running, done, failed), the current step and progress (statements
--   done of total), the outcome (counts only) or a short error. The panel polls it; on Netlify the
--   work runs in the background function demo-data-background (up to 15 minutes), elsewhere in the
--   API process. At most one queued or running job per company. Rows go with their company.
--
-- Idempotent and additive: safe to run more than once (also with BEGIN / COMMIT stripped).
BEGIN;

CREATE TABLE IF NOT EXISTS public.demo_data_jobs (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  step text,
  done integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_data_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT demo_data_jobs_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT demo_data_jobs_kind_chk CHECK (kind IN ('generate', 'populate')),
  CONSTRAINT demo_data_jobs_status_chk CHECK (status IN ('queued', 'running', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS demo_data_jobs_company_idx ON public.demo_data_jobs (company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS demo_data_jobs_active_uq ON public.demo_data_jobs (company_id) WHERE status IN ('queued', 'running');

ALTER TABLE public.demo_data_jobs ENABLE ROW LEVEL SECURITY;

COMMIT;
