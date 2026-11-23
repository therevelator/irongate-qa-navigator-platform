-- Executive briefing snapshots per caller scope (docs/PRODUCT_GUIDE.md "Executive briefing"):
-- opening the briefing stores today's snapshot of the figures the caller sees and shows the last
-- 30 days of snapshots of that same scope. A super admin's scope is the whole company
-- (scope_key 'company', every existing row); a manager's or team lead's scope is the set of teams
-- in their analytics scope (scope_key 'teams:<hash of the sorted team ids>'). Scopes never mix:
-- one row per company, scope and day.
-- Idempotent.

ALTER TABLE company_kpi_snapshots ADD COLUMN IF NOT EXISTS scope_key TEXT NOT NULL DEFAULT 'company';

ALTER TABLE company_kpi_snapshots DROP CONSTRAINT IF EXISTS company_kpi_snapshots_unique_company_date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_kpi_snapshots_unique_company_scope_date') THEN
    ALTER TABLE company_kpi_snapshots
      ADD CONSTRAINT company_kpi_snapshots_unique_company_scope_date UNIQUE (company_id, scope_key, snapshot_date);
  END IF;
END $$;
