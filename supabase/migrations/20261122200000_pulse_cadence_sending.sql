-- IronGate QA Navigator: wellbeing pulse, more cadences and sending the survey by e-mail
--
--  1. pulse_cadences.cadence also accepts 'monthly' (calendar month) and 'quarterly' (calendar
--     quarter), besides 'weekly' and 'biweekly' (server/lib/pulseRules.ts periodFor).
--  2. pulse_settings: per team, whether the survey is e-mailed automatically at the start of each
--     period (auto_send) and from which period on (auto_send_from). A team gets a row, with
--     auto_send on, the first time a manager sets its cadence.
--  3. pulse_sends: the send log. One row per send of the survey ('survey') or a reminder
--     ('reminder'), manual or automatic, with counts only (never who). The partial unique index
--     makes the automatic send happen at most once per team and period, even with several
--     schedulers running.
--  4. pulse_recipients: who was e-mailed the survey for which team and period (to show
--     "sent to N of M" and who has not been sent it yet). It says nothing about answering.
--  5. pulse_links: personal single-use survey links. Only the sha256 of the token is stored;
--     a link is bound to one user, team and period and expires when the period ends. It holds no
--     time of use (only used = true), and no reference to an answer.
--  Answers stay in pulse_responses without any user id; who answered stays in pulse_participation
--  (only to refuse a second answer). Nothing here links an answer to a person.
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed (the cadence
-- CHECK constraint is replaced by a wider one). Target: Postgres 16/17 (Supabase), run as postgres.
-- Row level security is enabled with no policies, so only the API (table owner) can read these.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Wider cadence constraint
-- ---------------------------------------------------------------------------
ALTER TABLE public.pulse_cadences DROP CONSTRAINT IF EXISTS pulse_cadences_cadence_check;
ALTER TABLE public.pulse_cadences ADD CONSTRAINT pulse_cadences_cadence_check
  CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'quarterly'));

-- ---------------------------------------------------------------------------
-- 2. pulse_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulse_settings (
  team_id varchar(36) NOT NULL,
  company_id varchar(36) NOT NULL,
  auto_send boolean NOT NULL DEFAULT TRUE,
  -- First period (its start day) the automatic send covers.
  auto_send_from date,
  updated_by varchar(36),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pulse_settings_pkey PRIMARY KEY (team_id),
  CONSTRAINT pulse_settings_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT pulse_settings_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT pulse_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER TABLE public.pulse_settings ENABLE ROW LEVEL SECURITY;

-- Teams whose cadence a manager already set get automatic sending from their next period.
INSERT INTO public.pulse_settings (team_id, company_id, auto_send, auto_send_from, updated_by)
SELECT DISTINCT ON (c.team_id) c.team_id, c.company_id, TRUE, NULL, NULL
  FROM public.pulse_cadences c
 WHERE c.created_by IS NOT NULL
 ORDER BY c.team_id, c.effective_from DESC
ON CONFLICT (team_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. pulse_sends (send log; counts only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulse_sends (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  kind text NOT NULL,
  trigger text NOT NULL,
  actor_id varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Members e-mailed by this send / of them delivered by the mail server.
  recipients integer NOT NULL DEFAULT 0,
  delivered integer NOT NULL DEFAULT 0,
  -- Reminders: how many had answered when it was sent (an aggregate, used to decide whether the
  -- reminder count may be shown without revealing fewer than 3 answers).
  answered integer,
  channel text NOT NULL DEFAULT 'log',
  CONSTRAINT pulse_sends_pkey PRIMARY KEY (id),
  CONSTRAINT pulse_sends_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT pulse_sends_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT pulse_sends_actor_fk FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT pulse_sends_kind_check CHECK (kind IN ('survey', 'reminder')),
  CONSTRAINT pulse_sends_trigger_check CHECK (trigger IN ('manual', 'auto')),
  CONSTRAINT pulse_sends_period_check CHECK (period_end > period_start),
  CONSTRAINT pulse_sends_counts_check CHECK (recipients >= 0 AND delivered >= 0 AND delivered <= recipients)
);

CREATE INDEX IF NOT EXISTS pulse_sends_team_idx ON public.pulse_sends (team_id, period_start DESC, created_at DESC);
-- At most one automatic survey send per team and period.
CREATE UNIQUE INDEX IF NOT EXISTS pulse_sends_auto_once ON public.pulse_sends (team_id, period_start)
  WHERE trigger = 'auto' AND kind = 'survey';

ALTER TABLE public.pulse_sends ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. pulse_recipients (who was e-mailed the survey; not who answered)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulse_recipients (
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  user_id varchar(36) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  first_sent_at timestamptz NOT NULL DEFAULT now(),
  -- true once the mail server accepted a survey e-mail for this person and period.
  delivered boolean NOT NULL DEFAULT FALSE,
  CONSTRAINT pulse_recipients_pkey PRIMARY KEY (team_id, user_id, period_start),
  CONSTRAINT pulse_recipients_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT pulse_recipients_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT pulse_recipients_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

ALTER TABLE public.pulse_recipients ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. pulse_links (personal single-use links; sha256 of the token only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulse_links (
  token_hash varchar(64) NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  user_id varchar(36) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT FALSE,
  CONSTRAINT pulse_links_pkey PRIMARY KEY (token_hash),
  CONSTRAINT pulse_links_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT pulse_links_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT pulse_links_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT pulse_links_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS pulse_links_member_idx ON public.pulse_links (team_id, user_id, period_start);
CREATE INDEX IF NOT EXISTS pulse_links_expiry_idx ON public.pulse_links (expires_at);

ALTER TABLE public.pulse_links ENABLE ROW LEVEL SECURITY;

COMMIT;
