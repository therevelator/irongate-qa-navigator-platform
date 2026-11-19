# Production reseed (one showcase company)

Builds SQL files that empty a database and load one realistic sample company,
**Meridian Financial Technologies** (`meridian-fintech.example`, a reserved domain), for a hosted
demo. Nothing here holds a usable password.

```bash
scripts/reseed/build.sh /path/to/out 2026-11-19
```

1. A fresh local database with every migration of `supabase/migrations` (the production schema).
2. `npm run seed:demo` (the standard sample company; its ids start with `demo-`, so the nightly
   refresh `runRefreshDates` keeps it current), then `showcase.sql` turns it into Meridian:
   4 departments (Payments, Mobile & Digital, Lending & Risk, Platform & Infrastructure),
   10 teams with a lead and 4 engineers each, 4 department managers, a CTO and a VP Engineering
   (super admins), viewers (product manager, risk analyst, finance director, external auditor),
   two engineers in a second team, a deactivated leaver and two pending invitations.
3. `export.mjs` writes:
   - `000_wipe.sql`: `TRUNCATE … RESTART IDENTITY CASCADE` of every public table (listed), except
     `platform_operators`; nothing is dropped, other schemas are untouched.
   - `001.sql` … `NNN.sql`: INSERT statements only, foreign-key order, at most 1.5 MB each, each
     runs on its own in a SQL console. Columns of a foreign-key cycle (`teams.lead_id`,
     `departments.manager_id`, …) are set by UPDATEs in the last file, followed by `setval` for
     identity columns. Not exported: platform support tables, password resets, survey links,
     single sign-on links, server errors, job runs, delivery logs.
   - `users.password_hash` is a placeholder per role: `__HASH_SUPER_ADMIN__`, `__HASH_MANAGER__`,
     `__HASH_TEAM_LEAD__`, `__HASH_ENGINEER__`, `__HASH_VIEWER__`. Replace each with a bcrypt hash
     (`$2b$`, cost 10 or more) before loading.
   - `operator.sql`: the platform support account, with `__BCRYPT_HASH__` (cost 12 recommended).

Order on the target database: apply every migration (at least
`20261125000000_platform_operators.sql`), then `000_wipe.sql`, `001.sql` … in order, then
`operator.sql`.
