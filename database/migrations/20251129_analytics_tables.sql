-- Migration: Add analytics tables for all features
-- Date: 2025-11-29

-- ============================================================================
-- 1. PIPELINE STAGES (for CI/CD Pipeline Insights)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  company_id CHAR(36) NOT NULL,
  team_id CHAR(36) NULL,
  name VARCHAR(100) NOT NULL,
  stage_order INT NOT NULL DEFAULT 0,
  avg_duration_seconds INT DEFAULT 0,
  success_rate DECIMAL(5,2) DEFAULT 100.00,
  cpu_usage DECIMAL(5,2) DEFAULT 0,
  memory_usage DECIMAL(5,2) DEFAULT 0,
  cost_per_run DECIMAL(10,2) DEFAULT 0,
  bottleneck_score DECIMAL(5,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pipeline_company (company_id),
  KEY idx_pipeline_team (team_id),
  KEY idx_pipeline_order (stage_order),
  CONSTRAINT fk_pipeline_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_pipeline_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pipeline run history
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  company_id CHAR(36) NOT NULL,
  team_id CHAR(36) NULL,
  stage_id CHAR(36) NOT NULL,
  status ENUM('success', 'failed', 'running', 'cancelled') NOT NULL DEFAULT 'running',
  duration_seconds INT DEFAULT 0,
  triggered_by VARCHAR(100) NULL,
  commit_sha VARCHAR(40) NULL,
  branch VARCHAR(100) NULL,
  started_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  error_message TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_run_company (company_id),
  KEY idx_run_stage (stage_id),
  KEY idx_run_started (started_at),
  CONSTRAINT fk_run_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_run_stage FOREIGN KEY (stage_id) REFERENCES pipeline_stages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 2. BUSINESS IMPACT METRICS
-- ============================================================================
CREATE TABLE IF NOT EXISTS business_impact_metrics (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  company_id CHAR(36) NOT NULL,
  metric_name VARCHAR(100) NOT NULL,
  quality_score DECIMAL(5,2) DEFAULT 0,
  revenue_impact DECIMAL(15,2) DEFAULT 0,
  customer_satisfaction DECIMAL(5,2) DEFAULT 0,
  feature_adoption_rate DECIMAL(5,2) DEFAULT 0,
  correlation_strength DECIMAL(5,4) DEFAULT 0,
  recorded_date DATE NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bim_company (company_id),
  KEY idx_bim_date (recorded_date),
  UNIQUE KEY unique_metric_date (company_id, metric_name, recorded_date),
  CONSTRAINT fk_bim_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. UPDATE EXISTING TABLES TO ADD team_id WHERE MISSING
-- ============================================================================

-- Add team_id to test_cases if not exists
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS team_id CHAR(36) NULL AFTER department_id;
ALTER TABLE test_cases ADD CONSTRAINT fk_tc_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

-- Add team_id to flaky_tests if not exists  
ALTER TABLE flaky_tests ADD COLUMN IF NOT EXISTS team_id CHAR(36) NULL AFTER test_case_id;
ALTER TABLE flaky_tests ADD COLUMN IF NOT EXISTS company_id CHAR(36) NULL AFTER team_id;
ALTER TABLE flaky_tests ADD COLUMN IF NOT EXISTS test_name VARCHAR(255) NULL;
ALTER TABLE flaky_tests ADD COLUMN IF NOT EXISTS failure_pattern ENUM('timing', 'environment', 'data', 'network', 'unknown') DEFAULT 'unknown';

-- Add team_id to performance_metrics
ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS team_id CHAR(36) NULL AFTER id;
ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS company_id CHAR(36) NULL AFTER team_id;

-- Add team_id to technical_debt
ALTER TABLE technical_debt ADD COLUMN IF NOT EXISTS team_id CHAR(36) NULL AFTER department_id;
ALTER TABLE technical_debt ADD COLUMN IF NOT EXISTS company_id CHAR(36) NULL AFTER team_id;
ALTER TABLE technical_debt ADD COLUMN IF NOT EXISTS category ENUM('code_quality', 'architecture', 'testing', 'documentation', 'security') DEFAULT 'code_quality';
ALTER TABLE technical_debt ADD COLUMN IF NOT EXISTS cost_of_delay DECIMAL(10,2) DEFAULT 0;
ALTER TABLE technical_debt ADD COLUMN IF NOT EXISTS priority_score DECIMAL(5,2) DEFAULT 0;

-- ============================================================================
-- 4. INSERT DEFAULT PIPELINE STAGES (run once per company)
-- ============================================================================
-- This will be handled by the application when a company is created

-- ============================================================================
-- 5. TEST EXECUTION RUNS TABLE (enhanced)
-- ============================================================================
CREATE TABLE IF NOT EXISTS test_execution_runs (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  company_id CHAR(36) NOT NULL,
  team_id CHAR(36) NULL,
  test_suite VARCHAR(255) NOT NULL,
  test_case_id CHAR(36) NULL,
  status ENUM('running', 'passed', 'failed', 'blocked', 'skipped') NOT NULL DEFAULT 'running',
  start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_time TIMESTAMP NULL,
  duration_seconds INT DEFAULT 0,
  assigned_to CHAR(36) NULL,
  dependencies JSON NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ter_company (company_id),
  KEY idx_ter_team (team_id),
  KEY idx_ter_status (status),
  KEY idx_ter_start (start_time),
  CONSTRAINT fk_ter_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_ter_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
