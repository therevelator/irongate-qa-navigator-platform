-- =============================================================================
-- Migration: Rename company from Mastercard to NovaTech
-- Date: 2025-11-30
-- Description: Updates company name and domain while preserving all IDs and relationships
-- =============================================================================

-- Update company name and domain (ID remains unchanged)
UPDATE companies 
SET 
  name = 'NovaTech',
  domain = 'novatech.io',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'novatech';

-- Update any user emails that reference the old domain (optional, for demo users)
UPDATE users 
SET 
  email = REPLACE(email, '@mastercard.com', '@novatech.io'),
  updated_at = CURRENT_TIMESTAMP
WHERE email LIKE '%@mastercard.com';

-- Log the migration
INSERT INTO seeder_runs (seeder_name, records_affected, status, notes)
VALUES ('rename_company_mastercard_to_novatech', 1, 'success', 'Renamed company from Mastercard to NovaTech, domain from mastercard.com to novatech.io');

-- Verification query (run manually to confirm)
-- SELECT id, name, domain FROM companies WHERE id = 'novatech';
