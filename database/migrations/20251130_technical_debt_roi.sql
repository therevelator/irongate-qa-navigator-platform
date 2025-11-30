-- Migration: Add ROI impact metrics to technical_debt table
-- Date: 2025-11-30

-- Add impact metrics columns for ROI calculation (MySQL 5.7 compatible)
-- Run each ALTER separately to handle existing columns gracefully

SET @dbname = 'irongate_qa';
SET @tablename = 'technical_debt';

-- Add affected_users column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'affected_users') > 0,
  'SELECT 1',
  'ALTER TABLE technical_debt ADD COLUMN affected_users INT DEFAULT 0'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Add support_tickets_monthly column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'support_tickets_monthly') > 0,
  'SELECT 1',
  'ALTER TABLE technical_debt ADD COLUMN support_tickets_monthly INT DEFAULT 0'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Add downtime_minutes_monthly column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'downtime_minutes_monthly') > 0,
  'SELECT 1',
  'ALTER TABLE technical_debt ADD COLUMN downtime_minutes_monthly INT DEFAULT 0'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Add revenue_impact_percent column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'revenue_impact_percent') > 0,
  'SELECT 1',
  'ALTER TABLE technical_debt ADD COLUMN revenue_impact_percent DECIMAL(5,2) DEFAULT 0'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Add sla_breaches_monthly column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'sla_breaches_monthly') > 0,
  'SELECT 1',
  'ALTER TABLE technical_debt ADD COLUMN sla_breaches_monthly INT DEFAULT 0'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Update existing rows with estimated impact based on severity
UPDATE technical_debt SET
  affected_users = CASE severity
    WHEN 'critical' THEN FLOOR(500 + RAND() * 500)
    WHEN 'high' THEN FLOOR(100 + RAND() * 200)
    WHEN 'medium' THEN FLOOR(20 + RAND() * 80)
    ELSE FLOOR(1 + RAND() * 20)
  END,
  support_tickets_monthly = CASE severity
    WHEN 'critical' THEN FLOOR(20 + RAND() * 30)
    WHEN 'high' THEN FLOOR(8 + RAND() * 12)
    WHEN 'medium' THEN FLOOR(2 + RAND() * 6)
    ELSE FLOOR(0 + RAND() * 2)
  END,
  downtime_minutes_monthly = CASE severity
    WHEN 'critical' THEN FLOOR(30 + RAND() * 90)
    WHEN 'high' THEN FLOOR(5 + RAND() * 25)
    WHEN 'medium' THEN FLOOR(0 + RAND() * 5)
    ELSE 0
  END,
  revenue_impact_percent = CASE severity
    WHEN 'critical' THEN ROUND(2 + RAND() * 3, 2)
    WHEN 'high' THEN ROUND(0.5 + RAND() * 1.5, 2)
    WHEN 'medium' THEN ROUND(0.1 + RAND() * 0.4, 2)
    ELSE ROUND(0 + RAND() * 0.1, 2)
  END,
  sla_breaches_monthly = CASE severity
    WHEN 'critical' THEN FLOOR(2 + RAND() * 4)
    WHEN 'high' THEN FLOOR(0 + RAND() * 2)
    ELSE 0
  END
WHERE affected_users = 0 OR affected_users IS NULL;

-- Add index for quick ROI-based sorting (ignore error if already exists)
-- CREATE INDEX idx_debt_impact ON technical_debt (severity, affected_users, support_tickets_monthly);
