-- IronGate QA Navigator: wellbeing pulse non-response warning, reminders and escalation
--
--  1. pulse_settings: per team, set by its managers, team lead and super admins
--       warning_after_days   (default 2)  days after the survey went out before a member who has
--                                         not answered sees an in-app warning
--       reminder_emails      (default on) automatic reminder e-mails to members who have not answered
--       reminder_every_days  (default 3)  how often
--       escalate_after_days  (default 5)  days after the survey went out before the names of the
--                                         members who have not answered go to escalate_to
--       escalate_to          (default 'both') team_lead | department_managers | both
--     auto_send_decided: FALSE on rows created only by saving these settings, so setting the
--     cadence for the first time still switches automatic sending on (existing rows: TRUE).
--  2. pulse_recipients.last_reminder_on: the day the member was last sent a reminder (at most one
--     reminder per person per day).
--  3. pulse_sends: kind 'escalation' (at most one per team and period, partial unique index) and
--     escalated_to (who was told, to show them the current list on the team's pulse screen).
--  4. notifications / notification_deliveries: kind 'pulse' (the escalation notice).
--  Participation (who answered) now also drives the list of members who have not answered. It
--  still holds no time and no reference to an answer; answers stay in pulse_responses without any
--  user id (and are rewritten in random order on every answer, so row order matches nothing).
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed (CHECK
-- constraints are replaced by wider ones). Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. pulse_settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.pulse_settings ADD COLUMN IF NOT EXISTS warning_after_days integer NOT NULL DEFAULT 2;
ALTER TABLE public.pulse_settings ADD COLUMN IF NOT EXISTS reminder_emails boolean NOT NULL DEFAULT TRUE;
ALTER TABLE public.pulse_settings ADD COLUMN IF NOT EXISTS reminder_every_days integer NOT NULL DEFAULT 3;
ALTER TABLE public.pulse_settings ADD COLUMN IF NOT EXISTS escalate_after_days integer NOT NULL DEFAULT 5;
ALTER TABLE public.pulse_settings ADD COLUMN IF NOT EXISTS escalate_to text NOT NULL DEFAULT 'both';
ALTER TABLE public.pulse_settings ADD COLUMN IF NOT EXISTS auto_send_decided boolean NOT NULL DEFAULT TRUE;

ALTER TABLE public.pulse_settings DROP CONSTRAINT IF EXISTS pulse_settings_reminders_check;
ALTER TABLE public.pulse_settings ADD CONSTRAINT pulse_settings_reminders_check CHECK (
  warning_after_days BETWEEN 0 AND 30
  AND reminder_every_days BETWEEN 1 AND 30
  AND escalate_after_days BETWEEN 1 AND 60
  AND warning_after_days < escalate_after_days
  AND escalate_to IN ('team_lead', 'department_managers', 'both')
);

-- ---------------------------------------------------------------------------
-- 2. pulse_recipients.last_reminder_on
-- ---------------------------------------------------------------------------
ALTER TABLE public.pulse_recipients ADD COLUMN IF NOT EXISTS last_reminder_on date;

-- ---------------------------------------------------------------------------
-- 3. pulse_sends: escalation
-- ---------------------------------------------------------------------------
ALTER TABLE public.pulse_sends DROP CONSTRAINT IF EXISTS pulse_sends_kind_check;
ALTER TABLE public.pulse_sends ADD CONSTRAINT pulse_sends_kind_check CHECK (kind IN ('survey', 'reminder', 'escalation'));
ALTER TABLE public.pulse_sends ADD COLUMN IF NOT EXISTS escalated_to varchar(36)[];
-- At most one escalation per team and period.
CREATE UNIQUE INDEX IF NOT EXISTS pulse_sends_escalation_once ON public.pulse_sends (team_id, period_start)
  WHERE kind = 'escalation';

-- ---------------------------------------------------------------------------
-- 4. notification kinds
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('alert', 'action', 'pulse'));
ALTER TABLE public.notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_kind_check;
ALTER TABLE public.notification_deliveries ADD CONSTRAINT notification_deliveries_kind_check CHECK (kind IN ('alert', 'digest', 'test', 'pulse'));

COMMIT;
