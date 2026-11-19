-- Meridian Financial Technologies: Scrum wording on top of the generated sample history
-- (scripts/reseed/README.md). Run after `npm run seed:demo -- --fill-existing --company mft-meridian`.
-- Two-week sprints: the sprint running today is Sprint 47 (sprint = 47 - whole fortnights ago).

-- Tracked actions read like retrospective actions of the sprint they were agreed in.
UPDATE public.team_actions
   SET title = left('Sprint ' || (47 - floor(extract(epoch FROM (now() - created_at)) / (14 * 86400)))::int || ' retro: ' || title, 200)
 WHERE company_id = 'mft-meridian' AND title NOT LIKE 'Sprint % retro:%';

-- Saved views named for the Scrum events they are used in.
UPDATE public.saved_views SET name = CASE name
    WHEN 'Needs attention' THEN 'Sprint review: teams needing attention'
    WHEN 'Lowest coverage first' THEN 'Quality review: lowest coverage first'
    WHEN 'Weakest QA scores' THEN 'Engineering review: weakest QA scores'
    WHEN 'Flaky tests: Lending Journey' THEN 'Lending Journey retro: flaky tests'
    ELSE name END
 WHERE company_id = 'mft-meridian';

-- Pulse comments in the voice of each team's retrospective (anonymous, as always).
WITH c(team_id, n, txt) AS (VALUES
  ('mft-team-payments-core-116', 0, 'Good sprint: the refactor of the ledger posting landed without drama.'),
  ('mft-team-payments-core-116', 1, 'Pairing on the settlement batch worked well, keep doing it.'),
  ('mft-team-payments-core-116', 2, 'Review lead time is short again, thanks to the smaller PRs.'),
  ('mft-team-payments-core-116', 3, 'Release went out on the last day of the sprint with no rollback.'),
  ('mft-team-lending-journey-64', 0, 'Too many escaped defects from the credit decision step, we keep firefighting.'),
  ('mft-team-lending-journey-64', 1, 'The flaky onboarding tests block merges every day.'),
  ('mft-team-lending-journey-64', 2, 'Scope changed twice mid-sprint; hard to plan.'),
  ('mft-team-lending-journey-64', 3, 'On-call this sprint was exhausting.'),
  ('mft-team-mobile-experience-140', 0, 'Things are better since we split the release train from the app store review.'),
  ('mft-team-mobile-experience-140', 1, 'The new device farm runs cut our test time a lot.'),
  ('mft-team-mobile-experience-140', 2, 'Still some carry-over, but much less than last quarter.'),
  ('mft-team-mobile-experience-140', 3, 'Retro actions are actually getting done now.'))
UPDATE public.pulse_responses r SET comment = c.txt
  FROM c
 WHERE r.company_id = 'mft-meridian' AND r.comment IS NOT NULL AND c.team_id = r.team_id
   AND c.n = ('x' || substr(md5(r.id), 1, 8))::bit(32)::int & 3;
