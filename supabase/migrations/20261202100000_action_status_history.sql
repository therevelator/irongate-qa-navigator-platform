-- IronGate QA Navigator: who changed the status of a tracked action, and when (Team detail → Action plan).
--
--  1. team_actions.status_changed_by / status_changed_at: the person who last set the action's status
--     (creation counts) and when (UTC). status_changed_by is NULL for a change made by the system
--     (team_action_events.source = 'system') and for rows whose history is unknown.
--  2. team_action_events: the status history of every action, one row per change, written by the
--     server in the same transaction as the change (server/lib/actions.ts): from_status NULL = created.
--     source 'user' (changed_by = the signed-in person; NULL later only if that user was deleted) or
--     'system' (an automatic change, changed_by NULL). Deleted with its action.
--  3. Backfill of existing rows. The history is only filled where it is knowable: from the change
--     history (audit_log 'action.create' / 'action.status' entries, which name the person), for actions
--     that have no history row yet. status_changed_at: the time of the last known change to the current
--     status, else completed_at for done / dropped actions where set, else updated_at; status_changed_by
--     only from that known change, else left NULL.
--
-- Idempotent: safe to run more than once. Additive: nothing is dropped or renamed.
-- RLS on, no policies (the API is the only reader, as for every other table).
-- Target: Postgres 16/17 (Supabase), run as postgres.

BEGIN;

ALTER TABLE public.team_actions ADD COLUMN IF NOT EXISTS status_changed_by varchar(36);
ALTER TABLE public.team_actions ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_actions_status_changed_by_fk') THEN
    ALTER TABLE public.team_actions
      ADD CONSTRAINT team_actions_status_changed_by_fk FOREIGN KEY (status_changed_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.team_action_events (
  id varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  company_id varchar(36) NOT NULL,
  team_id varchar(36) NOT NULL,
  action_id varchar(36) NOT NULL,
  -- NULL: the action was created (with to_status).
  from_status text,
  to_status text NOT NULL,
  changed_by varchar(36),
  -- 'user': changed by the signed-in person; 'system': an automatic change (changed_by NULL).
  source text NOT NULL DEFAULT 'user',
  changed_at timestamptz NOT NULL DEFAULT now(),
  note text,
  CONSTRAINT team_action_events_pkey PRIMARY KEY (id),
  CONSTRAINT team_action_events_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT team_action_events_team_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT team_action_events_action_fk FOREIGN KEY (action_id) REFERENCES public.team_actions(id) ON DELETE CASCADE,
  CONSTRAINT team_action_events_changed_by_fk FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT team_action_events_status_check CHECK (
    (from_status IS NULL OR from_status IN ('open', 'in_progress', 'done', 'dropped')) AND to_status IN ('open', 'in_progress', 'done', 'dropped')
  ),
  CONSTRAINT team_action_events_source_check CHECK (source IN ('user', 'system')),
  CONSTRAINT team_action_events_note_check CHECK (note IS NULL OR length(note) <= 500)
);
CREATE INDEX IF NOT EXISTS team_action_events_action_idx ON public.team_action_events (action_id, changed_at);
ALTER TABLE public.team_action_events ENABLE ROW LEVEL SECURITY;

-- Backfill 1: the knowable history, from the change history, for actions without any history row.
INSERT INTO public.team_action_events (id, company_id, team_id, action_id, from_status, to_status, changed_by, source, changed_at)
SELECT md5('team_action_events:' || l.id)::uuid::text, a.company_id, a.team_id, a.id,
       CASE WHEN l.action = 'action.create' THEN NULL ELSE l.before->>'status' END,
       l.after->>'status', u.id, 'user', l.created_at
  FROM public.audit_log l
  JOIN public.team_actions a ON a.id = l.entity_id AND a.company_id = l.company_id
  LEFT JOIN public.users u ON u.id = l.actor_id
 WHERE l.entity_type = 'action' AND l.undone_at IS NULL
   AND (l.action = 'action.create' OR (l.action = 'action.status' AND l.before->>'status' IS DISTINCT FROM l.after->>'status'))
   AND l.after->>'status' IN ('open', 'in_progress', 'done', 'dropped')
   AND (l.action = 'action.create' OR l.before->>'status' IN ('open', 'in_progress', 'done', 'dropped'))
   AND NOT EXISTS (SELECT 1 FROM public.team_action_events e WHERE e.action_id = a.id)
ON CONFLICT (id) DO NOTHING;

-- Backfill 2: when the status was last set, and by whom where known.
UPDATE public.team_actions a
   SET status_changed_at = COALESCE(last.changed_at, CASE WHEN a.status IN ('done', 'dropped') THEN a.completed_at END, a.updated_at),
       status_changed_by = last.changed_by
  FROM public.team_actions a2
  LEFT JOIN LATERAL (
    SELECT e.changed_at, e.changed_by, e.to_status FROM public.team_action_events e
     WHERE e.action_id = a2.id ORDER BY e.changed_at DESC, e.from_status IS NULL LIMIT 1
  ) last0 ON true
  LEFT JOIN LATERAL (SELECT last0.changed_at, last0.changed_by WHERE last0.to_status = a2.status) last ON true
 WHERE a2.id = a.id AND a.status_changed_at IS NULL;

COMMIT;
