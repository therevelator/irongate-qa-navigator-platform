-- IronGate QA Navigator: the non-responder list after a pulse escalation is a once-a-day snapshot
--
-- After an escalation, the people told see who has not answered the running period yet. A live list
-- would let someone who checks it often tell roughly when a person answered (never what). The list
-- shown is therefore the day's snapshot: taken when the escalation goes out and then once a day by
-- the hourly pulse job on its first run of the (UTC) day. A member who answers drops off the next day.
-- One row per team, period and day; user_ids are the members who had not answered then.
-- Nothing here refers to an answer.
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed.
-- Row level security is enabled with no policies, so only the API (table owner) can read it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pulse_nonresponder_days (
  team_id varchar(36) NOT NULL,
  company_id varchar(36) NOT NULL,
  period_start date NOT NULL,
  day date NOT NULL,
  user_ids varchar(36)[] NOT NULL DEFAULT '{}',
  CONSTRAINT pulse_nonresponder_days_pkey PRIMARY KEY (team_id, period_start, day),
  CONSTRAINT pulse_nonresponder_days_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT pulse_nonresponder_days_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE
);

ALTER TABLE public.pulse_nonresponder_days ENABLE ROW LEVEL SECURITY;

COMMIT;
