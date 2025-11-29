-- Migration: Fix team unique constraint to be per company + department + name
-- Date: 2025-11-29
-- This allows different companies to have teams with the same name in same-named departments

-- Drop the existing constraint
ALTER TABLE teams DROP INDEX unique_team_per_dept;

-- Add new constraint that includes company_id
ALTER TABLE teams ADD UNIQUE KEY unique_team_per_company_dept (company_id, department_id, name);
