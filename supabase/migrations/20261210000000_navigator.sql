-- Hours lost per week, findings and data readiness (additive, idempotent).
--
--   lost_hours_weekly    hours lost per team, week (12 rolling 7-day windows) and cause, calculated from the raw
--                        records (packages/engine/src/calc/lostHours.ts). A cache: rewritten for a team on every
--                        refresh (server/lib/lostHours.ts), never typed in.
--   lost_hours_state     what the latest week's hours are made of (stages, pipelines, issues, deploys) and how many
--                        records each cause saw.
--   exporter_discovery   what the QE Navigator Exporter found in each tool on its last run, per team and source
--                        (envelope kind "discovery"): records per kind, runs without a test or coverage report,
--                        jobs and projects it could not map to a team. Read by the Data readiness page.

CREATE TABLE IF NOT EXISTS public.lost_hours_weekly (
  team_id varchar(36) NOT NULL,
  company_id varchar(36) NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  cause text NOT NULL,
  hours numeric(10,2) NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lost_hours_weekly_pkey PRIMARY KEY (team_id, week_start, cause),
  CONSTRAINT lost_hours_weekly_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT lost_hours_weekly_cause_check CHECK (cause IN ('slow_stage', 'flaky_rerun', 'blocked', 'failed_change', 'review_wait'))
);
CREATE INDEX IF NOT EXISTS lost_hours_weekly_company_idx ON public.lost_hours_weekly (company_id, week_start);
ALTER TABLE public.lost_hours_weekly ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lost_hours_state (
  team_id varchar(36) NOT NULL,
  company_id varchar(36) NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  samples jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lost_hours_state_pkey PRIMARY KEY (team_id),
  CONSTRAINT lost_hours_state_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE
);
ALTER TABLE public.lost_hours_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.exporter_discovery (
  team_id varchar(36) NOT NULL,
  source varchar(64) NOT NULL,
  company_id varchar(36) NOT NULL,
  exporter_version varchar(40),
  reported_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT exporter_discovery_pkey PRIMARY KEY (team_id, source),
  CONSTRAINT exporter_discovery_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE
);
ALTER TABLE public.exporter_discovery ENABLE ROW LEVEL SECURITY;
