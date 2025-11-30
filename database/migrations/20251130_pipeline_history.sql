-- Migration: Add pipeline stage history for time-series tracking
-- Date: 2025-11-30
-- Compatible with MySQL 5.7+ and Aiven

-- ============================================================================
-- 1. PIPELINE STAGE HISTORY (preserves snapshots every update)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipeline_stage_history (
  id CHAR(36) NOT NULL,
  stage_id CHAR(36) NOT NULL,
  company_id CHAR(36) NOT NULL,
  team_id CHAR(36) NULL,
  name VARCHAR(100) NOT NULL,
  duration_seconds INT DEFAULT 0,
  success_rate DECIMAL(5,2) DEFAULT 100.00,
  cpu_usage DECIMAL(5,2) DEFAULT 0,
  memory_usage DECIMAL(5,2) DEFAULT 0,
  cost_per_run DECIMAL(10,2) DEFAULT 0,
  bottleneck_score DECIMAL(5,2) DEFAULT 0,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_psh_stage (stage_id),
  KEY idx_psh_company (company_id),
  KEY idx_psh_recorded (recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 2. PIPELINE EXECUTION SUMMARY (aggregated runs per day)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipeline_execution_summary (
  id CHAR(36) NOT NULL,
  company_id CHAR(36) NOT NULL,
  team_id CHAR(36) NULL,
  stage_id CHAR(36) NOT NULL,
  execution_date DATE NOT NULL,
  total_runs INT DEFAULT 0,
  successful_runs INT DEFAULT 0,
  failed_runs INT DEFAULT 0,
  avg_duration_seconds INT DEFAULT 0,
  min_duration_seconds INT DEFAULT 0,
  max_duration_seconds INT DEFAULT 0,
  total_cost DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_stage_date (company_id, stage_id, execution_date),
  KEY idx_pes_company (company_id),
  KEY idx_pes_stage (stage_id),
  KEY idx_pes_date (execution_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. SEEDER TRACKING (to know when last seeded)
-- ============================================================================
CREATE TABLE IF NOT EXISTS seeder_runs (
  id CHAR(36) NOT NULL,
  seeder_name VARCHAR(100) NOT NULL,
  company_id CHAR(36) NULL,
  last_run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  records_affected INT DEFAULT 0,
  status ENUM('success', 'failed') DEFAULT 'success',
  error_message TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_seeder_name (seeder_name),
  KEY idx_seeder_company (company_id),
  KEY idx_seeder_run (last_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
