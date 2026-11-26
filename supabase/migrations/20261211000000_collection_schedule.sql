-- How often the QE Navigator Exporter reads each kind of data, per team (additive, idempotent).
--
--   teams.release_cadence   how often the team releases (continuous, weekly, biweekly, monthly): the recommended
--                           intervals are chosen from it (server/lib/collectionSchedule.ts).
--   collection_schedules    the interval per team and data group, in minutes. No row = the default (15 minutes,
--                           what the Exporter does when nothing is set). The Exporter reads them with its context
--                           (GET /api/ingest/exporter/context) at the start of every run.

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS release_cadence text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_release_cadence_check') THEN
    ALTER TABLE public.teams ADD CONSTRAINT teams_release_cadence_check
      CHECK (release_cadence IS NULL OR release_cadence IN ('continuous', 'weekly', 'biweekly', 'monthly'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.collection_schedules (
  team_id varchar(36) NOT NULL,
  data_group text NOT NULL,
  company_id varchar(36) NOT NULL,
  interval_minutes integer NOT NULL,
  updated_by varchar(36),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_schedules_pkey PRIMARY KEY (team_id, data_group),
  CONSTRAINT collection_schedules_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT collection_schedules_group_check CHECK (data_group IN ('ci', 'delivery', 'work', 'quality', 'automation', 'people')),
  CONSTRAINT collection_schedules_interval_check CHECK (interval_minutes BETWEEN 15 AND 43200)
);
CREATE INDEX IF NOT EXISTS collection_schedules_company_idx ON public.collection_schedules (company_id);
ALTER TABLE public.collection_schedules ENABLE ROW LEVEL SECURITY;
