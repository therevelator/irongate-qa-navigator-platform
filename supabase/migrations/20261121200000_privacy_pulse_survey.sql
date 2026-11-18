-- IronGate QA Navigator: anonymous wellbeing pulse survey
--
--  1. pulse_cadences: how often a team is asked (weekly / biweekly), as a history. A row says
--     "from effective_from on, periods of 7 or 14 days are counted from effective_from". A change
--     takes effect at the start of the next period, so a running period is never cut short.
--     A team with no row uses the default: biweekly, counted from Monday 2026-01-05
--     (server/lib/pulse.ts DEFAULT_CADENCE / DEFAULT_ANCHOR).
--  2. pulse_responses: the answers. Five questions on a 1-5 scale and an optional comment.
--     There is NO user id and NO timestamp: a row only says which team and which period it
--     belongs to. Every submission rewrites the whole response set of that team and period in
--     random order with fresh random ids (server/lib/pulse.ts submitPulseResponse), so neither the
--     id, the physical row order nor the row's transaction id tells which answer was given when.
--  3. pulse_participation: who has answered for which team and period, only to refuse a second
--     answer. It holds no timestamp and no reference to an answer; it shares no column with
--     pulse_responses that could identify an answer (only team and period, which every answer of
--     that period has).
--  Results are only served as aggregates of closed periods with at least 3 responses
--  (server/lib/privacy.ts K_ANONYMITY_MIN).
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed.
-- Target: Postgres 16/17 (Supabase), run as postgres. Row level security is enabled with no
-- policies, so only the API (table owner) can read these tables.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. pulse_cadences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulse_cadences (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  cadence text NOT NULL,
  effective_from date NOT NULL,
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pulse_cadences_pkey PRIMARY KEY (id),
  CONSTRAINT pulse_cadences_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT pulse_cadences_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT pulse_cadences_created_by_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT pulse_cadences_cadence_check CHECK (cadence IN ('weekly', 'biweekly')),
  CONSTRAINT pulse_cadences_team_from_unique UNIQUE (team_id, effective_from)
);

CREATE INDEX IF NOT EXISTS pulse_cadences_team_idx ON public.pulse_cadences (team_id, effective_from DESC);

ALTER TABLE public.pulse_cadences ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. pulse_responses (anonymous: no user id, no timestamp)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulse_responses (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  -- The period the answer is for: [period_start, period_end) in days.
  period_start date NOT NULL,
  period_end date NOT NULL,
  q_workload smallint NOT NULL,
  q_focus smallint NOT NULL,
  q_support smallint NOT NULL,
  q_energy smallint NOT NULL,
  q_outlook smallint NOT NULL,
  comment text,
  CONSTRAINT pulse_responses_pkey PRIMARY KEY (id),
  CONSTRAINT pulse_responses_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT pulse_responses_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT pulse_responses_period_check CHECK (period_end > period_start),
  CONSTRAINT pulse_responses_scale_check CHECK (
    q_workload BETWEEN 1 AND 5 AND q_focus BETWEEN 1 AND 5 AND q_support BETWEEN 1 AND 5
    AND q_energy BETWEEN 1 AND 5 AND q_outlook BETWEEN 1 AND 5),
  CONSTRAINT pulse_responses_comment_check CHECK (comment IS NULL OR char_length(comment) <= 500)
);

CREATE INDEX IF NOT EXISTS pulse_responses_team_period_idx ON public.pulse_responses (team_id, period_start);

ALTER TABLE public.pulse_responses ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. pulse_participation (duplicate prevention only; not linked to an answer)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulse_participation (
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  user_id varchar(36) NOT NULL,
  period_start date NOT NULL,
  CONSTRAINT pulse_participation_pkey PRIMARY KEY (team_id, user_id, period_start),
  CONSTRAINT pulse_participation_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT pulse_participation_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT pulse_participation_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pulse_participation_user_idx ON public.pulse_participation (user_id);

ALTER TABLE public.pulse_participation ENABLE ROW LEVEL SECURITY;

COMMIT;
