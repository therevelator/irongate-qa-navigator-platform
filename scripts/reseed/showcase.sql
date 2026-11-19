-- Production showcase company (scripts/reseed/README.md): turns the standard sample company of
-- `npm run seed:demo` (id demo-northwind, every row recognisable as sample data, kept current by
-- the nightly refresh) into "Meridian Financial Technologies" with a fuller organisation.
-- Run once, on a database that holds ONLY the demo company, after `npm run seed:demo`.
-- Ids keep their 'demo-' prefix: the nightly refresh (runRefreshDates) recognises them.

-- 1. Name and e-mail domain everywhere (text, varchar and jsonb columns of the public schema)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name, c.data_type FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.data_type IN ('text', 'character varying', 'jsonb')
       AND c.column_name NOT IN ('id', 'password_hash', 'token_hash')
  LOOP
    IF r.data_type = 'jsonb' THEN
      EXECUTE format($f$UPDATE public.%I SET %I = replace(replace(replace(%I::text, 'Northwind Payments (Sample data)', 'Meridian Financial Technologies'), 'northwind.example', 'meridian-fintech.example'), 'Northwind', 'Meridian')::jsonb
                        WHERE %I::text ~* 'northwind'$f$, r.table_name, r.column_name, r.column_name, r.column_name);
    ELSE
      EXECUTE format($f$UPDATE public.%I SET %I = replace(replace(replace(%I, 'Northwind Payments (Sample data)', 'Meridian Financial Technologies'), 'northwind.example', 'meridian-fintech.example'), 'Northwind', 'Meridian')
                        WHERE %I ~* 'northwind'$f$, r.table_name, r.column_name, r.column_name, r.column_name);
    END IF;
  END LOOP;
END $$;

UPDATE public.companies SET name = 'Meridian Financial Technologies', domain = 'meridian-fintech.example' WHERE id = 'demo-northwind';

-- 2. Departments named as the organisation chart
UPDATE public.departments SET name = 'Payments', description = 'Checkout, ledger, settlements and card issuing' WHERE id = 'demo-dept-payments';
UPDATE public.departments SET name = 'Mobile & Digital', description = 'Mobile banking app, customer web portal and merchant dashboard' WHERE id = 'demo-dept-digital';
UPDATE public.departments SET name = 'Lending & Risk', description = 'Fraud detection, KYC, onboarding and credit risk' WHERE id = 'demo-dept-risk';
UPDATE public.departments SET name = 'Platform & Infrastructure', description = 'Developer platform, CI/CD, data warehouse and reporting' WHERE id = 'demo-dept-platform';

-- 3. More people: a VP Engineering (super admin), a finance director and an external auditor
--    (viewers), a leaver (deactivated), two engineers in a second team, two pending invitations.
INSERT INTO public.users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, timezone, is_active, email_verified, created_at, last_login)
SELECT v.id, v.email, u.password_hash, v.first, v.last, v.role, 'demo-northwind', v.dept, v.team, 'Europe/London', v.active, TRUE, now() - interval '200 days', CASE WHEN v.active THEN now() - interval '2 days' ELSE NULL END
  FROM (VALUES
    ('demo-u-victoria-hale', 'victoria.hale@meridian-fintech.example', 'Victoria', 'Hale', 'super_admin', 'demo-dept-platform', NULL, TRUE),
    ('demo-u-david-ashford', 'david.ashford@meridian-fintech.example', 'David', 'Ashford', 'viewer', 'demo-dept-payments', 'demo-team-ledger', TRUE),
    ('demo-u-karen-whitfield', 'karen.whitfield@meridian-fintech.example', 'Karen', 'Whitfield', 'viewer', 'demo-dept-risk', 'demo-team-kyc', TRUE),
    ('demo-u-peter-lang', 'peter.lang@meridian-fintech.example', 'Peter', 'Lang', 'qa_engineer', 'demo-dept-payments', 'demo-team-cards', FALSE)
  ) AS v(id, email, first, last, role, dept, team, active)
  CROSS JOIN (SELECT password_hash FROM public.users WHERE id = 'demo-u-alex-morgan') u
ON CONFLICT DO NOTHING;

INSERT INTO public.role_assignments (id, company_id, user_id, role, scope_type, scope_id, created_at, created_by, revoked_at, revoked_by) VALUES
  ('demo-ra-victoria-hale-company', 'demo-northwind', 'demo-u-victoria-hale', 'super_admin', 'company', 'demo-northwind', now() - interval '200 days', 'demo-u-alex-morgan', NULL, NULL),
  ('demo-ra-david-ashford-ledger', 'demo-northwind', 'demo-u-david-ashford', 'viewer', 'team', 'demo-team-ledger', now() - interval '150 days', 'demo-u-alex-morgan', NULL, NULL),
  ('demo-ra-karen-whitfield-kyc', 'demo-northwind', 'demo-u-karen-whitfield', 'viewer', 'team', 'demo-team-kyc', now() - interval '40 days', 'demo-u-alex-morgan', NULL, NULL),
  ('demo-ra-peter-lang-cards', 'demo-northwind', 'demo-u-peter-lang', 'qa_engineer', 'team', 'demo-team-cards', now() - interval '300 days', 'demo-u-priya-raman', now() - interval '21 days', 'demo-u-priya-raman'),
  ('demo-ra-mia-thompson-ledger', 'demo-northwind', 'demo-u-mia-thompson', 'qa_engineer', 'team', 'demo-team-ledger', now() - interval '60 days', 'demo-u-priya-raman', NULL, NULL),
  ('demo-ra-ivan-kowalski-fraud', 'demo-northwind', 'demo-u-ivan-kowalski', 'qa_engineer', 'team', 'demo-team-fraud', now() - interval '45 days', 'demo-u-sofia-lindqvist', NULL, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO public.team_members (user_id, team_id, role, joined_at) VALUES
  ('demo-u-mia-thompson', 'demo-team-ledger', 'member', now() - interval '60 days'),
  ('demo-u-ivan-kowalski', 'demo-team-fraud', 'member', now() - interval '45 days')
ON CONFLICT DO NOTHING;

-- Pending invitations (the token hashes match no token: the links cannot be used; resend to issue new ones).
INSERT INTO public.invitations (id, company_id, email, role, scope_type, scope_id, token_hash, invited_by, created_at, expires_at, last_sent_at, send_count)
VALUES
  ('demo-inv-new-hire-checkout', 'demo-northwind', 'jordan.ellis@meridian-fintech.example', 'qa_engineer', 'team', 'demo-team-checkout',
   encode(sha256(convert_to('demo-inv-new-hire-checkout-' || gen_random_uuid()::text, 'UTF8')), 'hex'), 'demo-u-olivia-bennett', now() - interval '2 days', now() + interval '5 days', now() - interval '2 days', 1),
  ('demo-inv-pm-mobile', 'demo-northwind', 'sana.qureshi@meridian-fintech.example', 'viewer', 'team', 'demo-team-mobile',
   encode(sha256(convert_to('demo-inv-pm-mobile-' || gen_random_uuid()::text, 'UTF8')), 'hex'), 'demo-u-daniel-okafor', now() - interval '1 day', now() + interval '6 days', now() - interval '1 day', 1)
ON CONFLICT DO NOTHING;
