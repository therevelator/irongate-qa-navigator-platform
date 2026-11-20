-- IronGate QA Navigator v2 phase 4 (Improve, for teams): forecasts and recommendations.
--
--  1. forecasts: per team and metric (the KPI columns and qa_score), the projection 8 weeks ahead
--     from the team's own history with an 80 % band, the expected target crossing (with the target
--     valid then) or "on track", or "not enough data" with the reason. One row per team and metric,
--     replaced on every recalculation (hourly job for teams whose forecasts are older than a day,
--     and on demand). Method: server/lib/forecast/math.ts.
--  2. recommendations: rule-based improvement recommendations per team (server/lib/recommendations),
--     ranked by expected effect, each with its evidence, next step, expected effect (a range) and
--     confidence. One row per team, rule and subject; status open / accepted (→ a tracked action) /
--     dismissed (with a reason). `active` is false once the rule no longer fires (then an open one is
--     hidden; accepted and dismissed ones stay as history).
--  3. team_actions.recommendation_id: the recommendation an action was created from.
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed.
-- Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

CREATE TABLE IF NOT EXISTS public.forecasts (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  metric_key text NOT NULL,
  status text NOT NULL,
  reason text,
  method text NOT NULL,
  as_of date NOT NULL,
  points_used integer NOT NULL DEFAULT 0,
  history_from date,
  history_to date,
  last_value numeric,
  last_day date,
  slope_per_week numeric,
  sigma numeric,
  trend text,
  -- [{ day, value, low, high }] weekly, 1..8 weeks after as_of.
  projection jsonb NOT NULL DEFAULT '[]'::jsonb,
  outlook text,
  crossing_day date,
  crossing_earliest date,
  crossing_latest date,
  -- { kind: 'min' | 'max', good, warning } or { kind: 'band', low, high }; the target valid at as_of / at the horizon.
  target_now jsonb,
  target_at_end jsonb,
  confidence text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forecasts_pkey PRIMARY KEY (id),
  CONSTRAINT forecasts_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT forecasts_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT forecasts_status_check CHECK (status IN ('ok', 'insufficient')),
  CONSTRAINT forecasts_outlook_check CHECK (outlook IS NULL OR outlook IN ('on_track', 'will_miss', 'will_reach', 'stays_off', 'no_target')),
  CONSTRAINT forecasts_trend_check CHECK (trend IS NULL OR trend IN ('improving', 'worsening', 'flat')),
  CONSTRAINT forecasts_confidence_check CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low'))
);
CREATE UNIQUE INDEX IF NOT EXISTS forecasts_team_metric_uq ON public.forecasts (team_id, metric_key);
CREATE INDEX IF NOT EXISTS forecasts_company_idx ON public.forecasts (company_id, computed_at);
ALTER TABLE public.forecasts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.recommendations (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  rule_key text NOT NULL,
  -- What the recommendation is about within the rule (a stage, a file set, …); '' for one per rule.
  subject_key text NOT NULL DEFAULT '',
  title text NOT NULL,
  -- [{ label, value, detail? }] the numbers it is based on; items: tests / files / stages named.
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_step text NOT NULL,
  metric_key text,
  -- { metric, from, low, high, unit, horizonWeeks, basis }: expected value range after the step.
  effect jsonb,
  confidence text NOT NULL DEFAULT 'low',
  score numeric NOT NULL DEFAULT 0,
  rank integer,
  active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'open',
  action_id varchar(36),
  dismiss_reason text,
  decided_by varchar(36),
  decided_at timestamptz,
  first_seen timestamptz NOT NULL DEFAULT now(),
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendations_pkey PRIMARY KEY (id),
  CONSTRAINT recommendations_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT recommendations_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT recommendations_action_fk FOREIGN KEY (action_id) REFERENCES public.team_actions(id) ON DELETE SET NULL,
  CONSTRAINT recommendations_decided_by_fk FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT recommendations_status_check CHECK (status IN ('open', 'accepted', 'dismissed')),
  CONSTRAINT recommendations_confidence_check CHECK (confidence IN ('high', 'medium', 'low'))
);
CREATE UNIQUE INDEX IF NOT EXISTS recommendations_team_rule_uq ON public.recommendations (team_id, rule_key, subject_key);
CREATE INDEX IF NOT EXISTS recommendations_company_idx ON public.recommendations (company_id, status);
CREATE INDEX IF NOT EXISTS recommendations_action_idx ON public.recommendations (action_id) WHERE action_id IS NOT NULL;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.team_actions ADD COLUMN IF NOT EXISTS recommendation_id varchar(36);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_actions_recommendation_fk') THEN
    ALTER TABLE public.team_actions
      ADD CONSTRAINT team_actions_recommendation_fk FOREIGN KEY (recommendation_id) REFERENCES public.recommendations(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS team_actions_recommendation_idx ON public.team_actions (recommendation_id) WHERE recommendation_id IS NOT NULL;

COMMIT;
