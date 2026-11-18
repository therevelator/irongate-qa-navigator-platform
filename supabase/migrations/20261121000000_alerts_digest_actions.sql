-- IronGate QA Navigator: alerts, notifications, weekly digest and tracked actions
--
--  1. alert_rules: which alert rules run, with their parameters, per company with department and
--     team overrides (team > department > company > the code defaults in server/lib/alerts.ts).
--     Rules: threshold_breach (a KPI turns warning / critical against the target valid at its
--     date), metric_stale (a metric is older than its expected update interval), score_drop (the
--     QA score fell by at least N points in D days) and ingestion_failure (rejected or partial
--     ingestion requests in the last H hours).
--  2. alerts: one row per condition while it lasts (open = resolved_at IS NULL; at most one open
--     alert per company and dedupe_key), acknowledged by a user, resolved by the evaluator when the
--     condition is gone. team_id is NULL for company-level alerts (ingestion failures that name no
--     team).
--  3. notifications: the in-app inbox (bell) per user; notification_preferences: per user channels
--     (in-app, immediate email, weekly digest) and the minimum severity; no row = the defaults.
--  4. company_notification_settings: per company Slack incoming webhook (stored encrypted by the
--     server, only a masked hint is readable), minimum severity, digest summary to Slack.
--  5. notification_deliveries: outbox / delivery log of every email and Slack message (alert,
--     digest, test), with its status; never holds a webhook URL.
--  6. team_actions: tracked improvement actions per team (owner, due date, status, linked metric
--     with its baseline value) and the outcome computed from the stored metric values at completion
--     and 14 / 30 days later.
--
-- Nothing existing is changed: there is no earlier data to backfill (no alert or action existed
-- before this release). Idempotent: safe to run more than once. Additive: nothing is dropped.
-- Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. alert_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_rules (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  scope_type text NOT NULL,
  scope_id varchar(36) NOT NULL,
  rule text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_rules_pkey PRIMARY KEY (id),
  CONSTRAINT alert_rules_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT alert_rules_updated_by_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT alert_rules_scope_check CHECK (scope_type IN ('company', 'department', 'team')),
  CONSTRAINT alert_rules_rule_check CHECK (rule IN ('threshold_breach', 'metric_stale', 'score_drop', 'ingestion_failure'))
);
CREATE UNIQUE INDEX IF NOT EXISTS alert_rules_scope_uq ON public.alert_rules (company_id, scope_type, scope_id, rule);
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alerts (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36),
  rule text NOT NULL,
  metric_key text,
  severity text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- rule|team|metric: one open alert per condition.
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by varchar(36),
  resolved_at timestamptz,
  CONSTRAINT alerts_pkey PRIMARY KEY (id),
  CONSTRAINT alerts_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT alerts_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT alerts_ack_by_fk FOREIGN KEY (acknowledged_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT alerts_rule_check CHECK (rule IN ('threshold_breach', 'metric_stale', 'score_drop', 'ingestion_failure')),
  CONSTRAINT alerts_severity_check CHECK (severity IN ('info', 'warning', 'critical'))
);
CREATE UNIQUE INDEX IF NOT EXISTS alerts_open_uq ON public.alerts (company_id, dedupe_key) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS alerts_company_created_idx ON public.alerts (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_team_idx ON public.alerts (team_id, created_at DESC);
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6. team_actions (before notifications: notifications reference it)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_actions (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  title text NOT NULL,
  description text,
  -- Where the action came from: a recommendation (rule-based / AI), an alert, or typed in.
  origin text NOT NULL DEFAULT 'manual',
  alert_id varchar(36),
  owner_id varchar(36),
  due_date date,
  status text NOT NULL DEFAULT 'open',
  metric_key text,
  -- The latest stored value of the metric when the action was created (metric_values).
  baseline_value numeric,
  baseline_at timestamptz,
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  -- Outcome checkpoints (computed by server/lib/actions.ts from metric_values, never entered):
  -- the value at completion, and 14 / 30 days after completion, each with the time it is for
  -- and its verdict against the baseline (improved / unchanged / worse / no_data).
  completion_value numeric,
  completion_value_at timestamptz,
  completion_outcome text,
  d14_value numeric,
  d14_value_at timestamptz,
  d14_outcome text,
  d30_value numeric,
  d30_value_at timestamptz,
  d30_outcome text,
  CONSTRAINT team_actions_pkey PRIMARY KEY (id),
  CONSTRAINT team_actions_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT team_actions_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT team_actions_alert_fk FOREIGN KEY (alert_id) REFERENCES public.alerts(id) ON DELETE SET NULL,
  CONSTRAINT team_actions_owner_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT team_actions_created_by_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT team_actions_status_check CHECK (status IN ('open', 'in_progress', 'done', 'dropped')),
  CONSTRAINT team_actions_origin_check CHECK (origin IN ('manual', 'recommendation', 'alert')),
  CONSTRAINT team_actions_outcome_check CHECK (
    (completion_outcome IS NULL OR completion_outcome IN ('improved', 'unchanged', 'worse', 'no_data')) AND
    (d14_outcome IS NULL OR d14_outcome IN ('improved', 'unchanged', 'worse', 'no_data')) AND
    (d30_outcome IS NULL OR d30_outcome IN ('improved', 'unchanged', 'worse', 'no_data'))
  )
);
CREATE INDEX IF NOT EXISTS team_actions_team_idx ON public.team_actions (team_id, status, due_date);
CREATE INDEX IF NOT EXISTS team_actions_company_idx ON public.team_actions (company_id, status);
CREATE INDEX IF NOT EXISTS team_actions_owner_idx ON public.team_actions (owner_id) WHERE owner_id IS NOT NULL;
ALTER TABLE public.team_actions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. notifications + notification_preferences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  user_id varchar(36) NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text,
  team_id varchar(36),
  alert_id varchar(36),
  action_id varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT notifications_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT notifications_alert_fk FOREIGN KEY (alert_id) REFERENCES public.alerts(id) ON DELETE CASCADE,
  CONSTRAINT notifications_action_fk FOREIGN KEY (action_id) REFERENCES public.team_actions(id) ON DELETE CASCADE,
  CONSTRAINT notifications_kind_check CHECK (kind IN ('alert', 'action')),
  CONSTRAINT notifications_severity_check CHECK (severity IN ('info', 'warning', 'critical'))
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON public.notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_alert_idx ON public.notifications (alert_id) WHERE alert_id IS NOT NULL;
-- One in-app notification per user and alert (an escalation updates it and marks it unread).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_alert_uq ON public.notifications (user_id, alert_id) WHERE alert_id IS NOT NULL;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id varchar(36) NOT NULL,
  company_id varchar(36) NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  email_immediate boolean NOT NULL DEFAULT false,
  weekly_digest boolean NOT NULL DEFAULT true,
  min_severity text NOT NULL DEFAULT 'warning',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id),
  CONSTRAINT notification_preferences_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT notification_preferences_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT notification_preferences_severity_check CHECK (min_severity IN ('info', 'warning', 'critical'))
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. company_notification_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_notification_settings (
  company_id varchar(36) NOT NULL,
  -- AES-256-GCM ciphertext of the Slack incoming webhook URL (server/lib/notifications.ts);
  -- the plaintext is never returned by the API nor logged.
  slack_webhook_enc text,
  -- Masked form shown in Parameters, e.g. "hooks.slack.com/services/…/…abcd".
  slack_webhook_hint text,
  slack_enabled boolean NOT NULL DEFAULT false,
  slack_min_severity text NOT NULL DEFAULT 'critical',
  slack_digest boolean NOT NULL DEFAULT false,
  updated_by varchar(36),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_notification_settings_pkey PRIMARY KEY (company_id),
  CONSTRAINT company_notification_settings_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT company_notification_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT company_notification_settings_severity_check CHECK (slack_min_severity IN ('info', 'warning', 'critical'))
);
ALTER TABLE public.company_notification_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. notification_deliveries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  channel text NOT NULL,
  kind text NOT NULL,
  user_id varchar(36),
  -- Email address for email; 'slack' for Slack (the webhook itself is never stored here).
  recipient text NOT NULL,
  alert_id varchar(36),
  subject text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  error text,
  attempts integer NOT NULL DEFAULT 0,
  -- Prevents sending the same message twice (e.g. digest:<user>:<week>, alert:<id>:<user>:<severity>).
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id),
  CONSTRAINT notification_deliveries_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT notification_deliveries_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT notification_deliveries_alert_fk FOREIGN KEY (alert_id) REFERENCES public.alerts(id) ON DELETE SET NULL,
  CONSTRAINT notification_deliveries_channel_check CHECK (channel IN ('email', 'slack')),
  CONSTRAINT notification_deliveries_kind_check CHECK (kind IN ('alert', 'digest', 'test')),
  CONSTRAINT notification_deliveries_status_check CHECK (status IN ('pending', 'sent', 'logged', 'failed', 'skipped'))
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_dedupe_uq ON public.notification_deliveries (company_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notification_deliveries_pending_idx ON public.notification_deliveries (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS notification_deliveries_company_idx ON public.notification_deliveries (company_id, created_at DESC);
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

COMMIT;
