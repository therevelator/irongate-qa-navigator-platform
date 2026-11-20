-- QE Navigator v2, phase 2: delivery and reliability (docs/V2_PLAN.md, "Phase 2").
-- Customers send raw deployment, commit and incident events; QE Navigator calculates deployment
-- frequency, lead time for changes, change failure rate, MTTR, MTBF, availability and incidents per
-- deploy (server/lib/calc/delivery.ts).
--
--   deployments_raw      one row per deployment (team + event id): environment, service, commits,
--                        start / finish, result (success, failure, rolled_back), rollback of, hotfix
--   deployment_commits   commits of a deployment or a push: sha, authored / committed time and a
--                        salted hash of the author (never a name or e-mail address)
--   incidents_raw        one row per incident (team + event id): opened / acknowledged / resolved,
--                        severity, service, outage, category, linked deployment; created and updated by id
--   incident_updates     the stream of status changes of an incident
--   service_teams        service name → team, set in Connect your CI, for events that carry no team
--   raw_uploads.kind     also deployments, commits and incidents
--   is_sample            sample (demo) rows: evidence only, never written to the KPI storage
--
-- Retention (db-keepalive, cleanupRawData): 13 months like the other raw rows.
-- Idempotent and additive. RLS on, no policies (the API connects as the table owner).

ALTER TABLE public.raw_uploads DROP CONSTRAINT IF EXISTS raw_uploads_kind_check;
ALTER TABLE public.raw_uploads ADD CONSTRAINT raw_uploads_kind_check
  CHECK (kind IN ('tests', 'coverage', 'pipelines', 'deployments', 'commits', 'incidents'));

CREATE TABLE IF NOT EXISTS public.deployments_raw (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  upload_id varchar(36),
  external_id varchar(200) NOT NULL,
  environment varchar(100) NOT NULL,
  is_production boolean NOT NULL DEFAULT false,
  service varchar(255),
  commit_sha varchar(80) NOT NULL DEFAULT '',
  -- The commits named by the event (the head commit, a list); with commit_from, a range.
  commit_shas varchar(80)[] NOT NULL DEFAULT '{}'::varchar[],
  commit_from varchar(80),
  started_at timestamptz,
  finished_at timestamptz NOT NULL,
  day date NOT NULL,
  result text NOT NULL,
  rollback_of varchar(200),
  is_hotfix boolean NOT NULL DEFAULT false,
  url varchar(1000),
  event_hash varchar(64),
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deployments_raw_pkey PRIMARY KEY (id),
  CONSTRAINT deployments_raw_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT deployments_raw_upload_fk FOREIGN KEY (upload_id) REFERENCES public.raw_uploads(id) ON DELETE SET NULL,
  CONSTRAINT deployments_raw_result_check CHECK (result IN ('success', 'failure', 'rolled_back'))
);
CREATE UNIQUE INDEX IF NOT EXISTS deployments_raw_uq ON public.deployments_raw (team_id, external_id);
CREATE INDEX IF NOT EXISTS deployments_raw_team_finished_idx ON public.deployments_raw (team_id, finished_at);
CREATE INDEX IF NOT EXISTS deployments_raw_company_idx ON public.deployments_raw (company_id, external_id);
ALTER TABLE public.deployments_raw ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.deployment_commits (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  upload_id varchar(36),
  -- The deployment's event id ('' for commits of a push that is not linked to a deployment).
  deployment_external_id varchar(200) NOT NULL DEFAULT '',
  sha varchar(80) NOT NULL,
  authored_at timestamptz,
  committed_at timestamptz,
  author_hash varchar(64),
  branch varchar(255),
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deployment_commits_pkey PRIMARY KEY (id),
  CONSTRAINT deployment_commits_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT deployment_commits_upload_fk FOREIGN KEY (upload_id) REFERENCES public.raw_uploads(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS deployment_commits_uq ON public.deployment_commits (team_id, sha, deployment_external_id);
CREATE INDEX IF NOT EXISTS deployment_commits_deploy_idx ON public.deployment_commits (team_id, deployment_external_id);
ALTER TABLE public.deployment_commits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.incidents_raw (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  upload_id varchar(36),
  external_id varchar(200) NOT NULL,
  title varchar(500),
  severity text NOT NULL DEFAULT 'medium',
  severity_label varchar(50),
  service varchar(255),
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  day date NOT NULL,
  -- Outage: counts as downtime in the availability (null: decided by severity, critical and high).
  outage boolean,
  category varchar(50),
  deployment_external_id varchar(200),
  source varchar(30),
  url varchar(1000),
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incidents_raw_pkey PRIMARY KEY (id),
  CONSTRAINT incidents_raw_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT incidents_raw_upload_fk FOREIGN KEY (upload_id) REFERENCES public.raw_uploads(id) ON DELETE SET NULL,
  CONSTRAINT incidents_raw_severity_check CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  CONSTRAINT incidents_raw_status_check CHECK (status IN ('open', 'acknowledged', 'resolved'))
);
CREATE UNIQUE INDEX IF NOT EXISTS incidents_raw_uq ON public.incidents_raw (team_id, external_id);
CREATE INDEX IF NOT EXISTS incidents_raw_team_opened_idx ON public.incidents_raw (team_id, opened_at);
ALTER TABLE public.incidents_raw ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.incident_updates (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  incident_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  status text NOT NULL,
  at timestamptz NOT NULL,
  severity text,
  upload_id varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_updates_pkey PRIMARY KEY (id),
  CONSTRAINT incident_updates_incident_fk FOREIGN KEY (incident_id) REFERENCES public.incidents_raw(id) ON DELETE CASCADE,
  CONSTRAINT incident_updates_status_check CHECK (status IN ('open', 'acknowledged', 'resolved'))
);
CREATE UNIQUE INDEX IF NOT EXISTS incident_updates_uq ON public.incident_updates (incident_id, status, at);
ALTER TABLE public.incident_updates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.service_teams (
  company_id varchar(36) NOT NULL,
  service varchar(255) NOT NULL,
  team_id varchar(36) NOT NULL,
  updated_by varchar(36),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_teams_pkey PRIMARY KEY (company_id, service),
  CONSTRAINT service_teams_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT service_teams_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE
);
ALTER TABLE public.service_teams ENABLE ROW LEVEL SECURITY;
