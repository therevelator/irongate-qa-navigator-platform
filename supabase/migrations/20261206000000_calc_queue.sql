-- IronGate QA Navigator: the calculation queue (store fast in the request, calculate in the background).
--
-- calc_queue: the days whose metrics an ingestion request changed, per team and kinds of metrics (ci, delivery, work,
-- quality), recorded in the request's transaction instead of being recalculated while the request waits
-- (server/lib/calc/queue.ts). A pending entry of the same team and kinds that overlaps or touches a new range is
-- merged into it. The background drain (netlify/functions/calc-drain-background.ts) claims entries with
-- FOR UPDATE SKIP LOCKED, recalculates them with the engine and marks them done; a failure is retried with a growing
-- delay (not_before) up to 5 attempts, then the entry is failed with its error. Done entries are kept 7 days, failed
-- ones 30 days (db-keepalive).
--
-- calc_queue_kicks: per company, when a drain was last started and has not reported idle since ('-infinity' = idle),
-- so a burst of requests starts one background drain, not one per request.
--
-- Idempotent and additive. RLS on, no policies (the API connects as the table owner and is the only reader).
-- Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

CREATE TABLE IF NOT EXISTS public.calc_queue (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  from_day date NOT NULL,
  to_day date NOT NULL,
  kinds text[] NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  not_before timestamptz NOT NULL DEFAULT now(),
  -- The latest ingestion request and actor that queued these days (stored on the KPI values written).
  ingestion_id varchar(36),
  actor_id text,
  last_error varchar(500),
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calc_queue_pkey PRIMARY KEY (id),
  CONSTRAINT calc_queue_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT calc_queue_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT calc_queue_status_check CHECK (status IN ('pending', 'running', 'done', 'failed')),
  CONSTRAINT calc_queue_range_check CHECK (from_day <= to_day),
  CONSTRAINT calc_queue_kinds_check CHECK (cardinality(kinds) > 0 AND kinds <@ ARRAY['ci', 'delivery', 'work', 'quality']::text[])
);
-- The drain's claim (oldest waiting entry first) and the merge on enqueue (pending entries of a team).
CREATE INDEX IF NOT EXISTS calc_queue_waiting_idx ON public.calc_queue (enqueued_at, id) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS calc_queue_team_idx ON public.calc_queue (team_id, status);
CREATE INDEX IF NOT EXISTS calc_queue_company_idx ON public.calc_queue (company_id, status);
ALTER TABLE public.calc_queue ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.calc_queue_kicks (
  company_id varchar(36) NOT NULL,
  kicked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calc_queue_kicks_pkey PRIMARY KEY (company_id),
  CONSTRAINT calc_queue_kicks_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE
);
ALTER TABLE public.calc_queue_kicks ENABLE ROW LEVEL SECURITY;

COMMIT;
