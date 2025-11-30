-- Migration: Add pipeline configuration table
-- Date: 2025-11-30

CREATE TABLE IF NOT EXISTS pipeline_config (
  id CHAR(36) NOT NULL,
  company_id CHAR(36) NOT NULL,
  time_savings_percent DECIMAL(5,2) DEFAULT 30.00,
  cost_savings_percent DECIMAL(5,2) DEFAULT 25.00,
  cost_per_minute DECIMAL(10,4) DEFAULT 0.50,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_company_config (company_id),
  KEY idx_pc_company (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default config for existing companies
INSERT INTO pipeline_config (id, company_id, time_savings_percent, cost_savings_percent, cost_per_minute)
SELECT UUID(), id, 30.00, 25.00, 0.50
FROM companies
WHERE NOT EXISTS (SELECT 1 FROM pipeline_config pc WHERE pc.company_id = companies.id);
