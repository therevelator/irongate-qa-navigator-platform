-- Job title of a person (e.g. "Product Owner", "Scrum Master"), shown in the top bar and on Team
-- detail; when empty the app shows the role label instead (server/lib/roleLabels.ts).
-- Set by super admins on the Users page. Additive and idempotent; nothing is dropped.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS job_title varchar(120);
