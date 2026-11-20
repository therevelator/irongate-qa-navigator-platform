-- QE Navigator v2, phase 3: work and code quality (docs/V2_PLAN.md, "Phase 3").
-- Customers send raw issues (Jira / Linear) and static-analysis reports (SARIF 2.1.0); QE Navigator
-- calculates defect escape rate, defect density, sprint velocity, commitment, carryover, blocked
-- time and sizing accuracy (server/lib/calc/work.ts) and the code quality score, findings by
-- severity and rule and new vs fixed findings (server/lib/calc/quality.ts).
--
--   issue_sprints        one row per sprint / cycle of a team (team + sprint id): name, state, start,
--                        planned end, completed
--   issues               one row per issue (team + issue key): type, status and its category, resolution,
--                        environment found in, story points, original estimate, time logged, the sprints
--                        it has been in, created / resolved; created and updated by key
--   issue_transitions    the changes of an issue (status, flagged, sprint) with their times: blocked
--                        time, scope at sprint start; idempotent by issue + field + time + value
--   analysis_reports     one row per static-analysis report (team + tool + repository + commit + run +
--                        attempt): counts by severity, lines of code when sent, new / fixed findings
--                        against the previous report of the same repository, branch and tool
--   analysis_findings    the findings of a report: rule, severity, file, line, message, fingerprint, new
--   raw_uploads.kind     also issues and static-analysis
--   is_sample            sample (demo) rows: evidence only, never written to the KPI storage
--
-- Retention (db-keepalive, cleanupRawData): findings 35 days (the latest report per repository and tool
-- keeps its findings), reports, sprints and resolved issues 13 months (open issues are kept).
-- Idempotent and additive. RLS on, no policies (the API connects as the table owner).

ALTER TABLE public.raw_uploads DROP CONSTRAINT IF EXISTS raw_uploads_kind_check;
ALTER TABLE public.raw_uploads ADD CONSTRAINT raw_uploads_kind_check
  CHECK (kind IN ('tests', 'coverage', 'pipelines', 'deployments', 'commits', 'incidents', 'issues', 'static-analysis'));

CREATE TABLE IF NOT EXISTS public.issue_sprints (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  upload_id varchar(36),
  external_id varchar(200) NOT NULL,
  name varchar(255),
  state text NOT NULL DEFAULT 'active',
  started_at timestamptz,
  ends_at timestamptz,
  completed_at timestamptz,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issue_sprints_pkey PRIMARY KEY (id),
  CONSTRAINT issue_sprints_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT issue_sprints_upload_fk FOREIGN KEY (upload_id) REFERENCES public.raw_uploads(id) ON DELETE SET NULL,
  CONSTRAINT issue_sprints_state_check CHECK (state IN ('future', 'active', 'closed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS issue_sprints_uq ON public.issue_sprints (team_id, external_id);
CREATE INDEX IF NOT EXISTS issue_sprints_team_completed_idx ON public.issue_sprints (team_id, completed_at);
ALTER TABLE public.issue_sprints ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.issues (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  upload_id varchar(36),
  external_id varchar(200) NOT NULL,
  source varchar(20) NOT NULL DEFAULT 'json',
  title varchar(500),
  issue_type text NOT NULL DEFAULT 'other',
  type_label varchar(100),
  status varchar(100),
  status_category text NOT NULL DEFAULT 'todo',
  resolution varchar(100),
  priority varchar(50),
  -- The environment the issue was found in, as sent, and what it means: production (escaped) or pre_release.
  environment varchar(255),
  found_in text,
  story_points numeric(8,2),
  estimate_hours numeric(10,2),
  time_logged_hours numeric(10,2),
  -- The sprints (issue_sprints.external_id) the issue has been in, oldest first.
  sprint_ids varchar(200)[] NOT NULL DEFAULT '{}'::varchar[],
  labels varchar(100)[] NOT NULL DEFAULT '{}'::varchar[],
  components varchar(200)[] NOT NULL DEFAULT '{}'::varchar[],
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz,
  source_updated_at timestamptz,
  day date NOT NULL,
  url varchar(1000),
  event_hash varchar(64),
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issues_pkey PRIMARY KEY (id),
  CONSTRAINT issues_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT issues_upload_fk FOREIGN KEY (upload_id) REFERENCES public.raw_uploads(id) ON DELETE SET NULL,
  CONSTRAINT issues_type_check CHECK (issue_type IN ('bug', 'story', 'task', 'subtask', 'epic', 'spike', 'other')),
  CONSTRAINT issues_status_category_check CHECK (status_category IN ('todo', 'in_progress', 'done')),
  CONSTRAINT issues_found_in_check CHECK (found_in IS NULL OR found_in IN ('production', 'pre_release'))
);
CREATE UNIQUE INDEX IF NOT EXISTS issues_uq ON public.issues (team_id, external_id);
CREATE INDEX IF NOT EXISTS issues_team_opened_idx ON public.issues (team_id, opened_at);
CREATE INDEX IF NOT EXISTS issues_team_resolved_idx ON public.issues (team_id, resolved_at);
CREATE INDEX IF NOT EXISTS issues_sprints_idx ON public.issues USING gin (sprint_ids);
ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.issue_transitions (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  issue_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  field text NOT NULL,
  from_value varchar(255),
  to_value varchar(255) NOT NULL DEFAULT '',
  -- status: the category of to_value (todo, in_progress, done, blocked); flagged: on / off.
  to_category text,
  at timestamptz NOT NULL,
  upload_id varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issue_transitions_pkey PRIMARY KEY (id),
  CONSTRAINT issue_transitions_issue_fk FOREIGN KEY (issue_id) REFERENCES public.issues(id) ON DELETE CASCADE,
  CONSTRAINT issue_transitions_field_check CHECK (field IN ('status', 'flagged', 'sprint'))
);
CREATE UNIQUE INDEX IF NOT EXISTS issue_transitions_uq ON public.issue_transitions (issue_id, field, at, to_value);
CREATE INDEX IF NOT EXISTS issue_transitions_team_at_idx ON public.issue_transitions (team_id, at);
ALTER TABLE public.issue_transitions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.analysis_reports (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  upload_id varchar(36),
  tool varchar(100) NOT NULL,
  tool_version varchar(100),
  repo varchar(255) NOT NULL DEFAULT '',
  branch varchar(255),
  commit_sha varchar(80) NOT NULL DEFAULT '',
  run_id varchar(200) NOT NULL DEFAULT '',
  attempt integer NOT NULL DEFAULT 1,
  analyzed_at timestamptz NOT NULL,
  day date NOT NULL,
  -- Lines of code sent with the report (null: the code size comes from the latest coverage report).
  lines_of_code integer,
  findings integer NOT NULL DEFAULT 0,
  critical integer NOT NULL DEFAULT 0,
  high integer NOT NULL DEFAULT 0,
  medium integer NOT NULL DEFAULT 0,
  low integer NOT NULL DEFAULT 0,
  info integer NOT NULL DEFAULT 0,
  suppressed integer NOT NULL DEFAULT 0,
  rules integer NOT NULL DEFAULT 0,
  -- Against the previous report of the same repository, branch and tool (null: the first report).
  previous_report_id varchar(36),
  new_findings integer,
  fixed_findings integer,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_reports_pkey PRIMARY KEY (id),
  CONSTRAINT analysis_reports_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT analysis_reports_upload_fk FOREIGN KEY (upload_id) REFERENCES public.raw_uploads(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS analysis_reports_uq ON public.analysis_reports (team_id, tool, repo, commit_sha, run_id, attempt);
CREATE INDEX IF NOT EXISTS analysis_reports_team_day_idx ON public.analysis_reports (team_id, day);
CREATE INDEX IF NOT EXISTS analysis_reports_series_idx ON public.analysis_reports (team_id, repo, tool, analyzed_at);
ALTER TABLE public.analysis_reports ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.analysis_findings (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  report_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  fingerprint varchar(64) NOT NULL,
  rule_id varchar(255) NOT NULL,
  rule_name varchar(255),
  severity text NOT NULL,
  level varchar(20),
  category varchar(50),
  message varchar(1000),
  path varchar(1000),
  line integer,
  is_new boolean NOT NULL DEFAULT false,
  CONSTRAINT analysis_findings_pkey PRIMARY KEY (id),
  CONSTRAINT analysis_findings_report_fk FOREIGN KEY (report_id) REFERENCES public.analysis_reports(id) ON DELETE CASCADE,
  CONSTRAINT analysis_findings_severity_check CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info'))
);
CREATE UNIQUE INDEX IF NOT EXISTS analysis_findings_uq ON public.analysis_findings (report_id, fingerprint);
CREATE INDEX IF NOT EXISTS analysis_findings_team_rule_idx ON public.analysis_findings (team_id, rule_id);
ALTER TABLE public.analysis_findings ENABLE ROW LEVEL SECURITY;
