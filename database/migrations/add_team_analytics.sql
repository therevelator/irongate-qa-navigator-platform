-- Migration: Add Team Analytics Tables
-- Date: 2025-11-29
-- Description: Add comprehensive team-based analytics tables

-- Team Analytics Summary Table
-- Stores aggregated analytics per team per period
CREATE TABLE IF NOT EXISTS team_analytics (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  team_id CHAR(36) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_type ENUM('daily', 'weekly', 'monthly', 'quarterly') DEFAULT 'weekly',
  
  -- Test Metrics
  total_test_cases INT DEFAULT 0,
  passed_tests INT DEFAULT 0,
  failed_tests INT DEFAULT 0,
  skipped_tests INT DEFAULT 0,
  test_pass_rate DECIMAL(5,2) DEFAULT 0.00,
  avg_test_duration_seconds DECIMAL(10,2) DEFAULT 0.00,
  flaky_test_count INT DEFAULT 0,
  
  -- Code Metrics
  code_coverage DECIMAL(5,2) DEFAULT 0.00,
  code_churn INT DEFAULT 0,
  lines_added INT DEFAULT 0,
  lines_removed INT DEFAULT 0,
  
  -- Deployment Metrics
  deployment_count INT DEFAULT 0,
  successful_deployments INT DEFAULT 0,
  failed_deployments INT DEFAULT 0,
  rollback_count INT DEFAULT 0,
  avg_deployment_time_minutes DECIMAL(10,2) DEFAULT 0.00,
  
  -- Bug/Defect Metrics
  bugs_created INT DEFAULT 0,
  bugs_resolved INT DEFAULT 0,
  bugs_open INT DEFAULT 0,
  critical_bugs INT DEFAULT 0,
  avg_bug_resolution_hours DECIMAL(10,2) DEFAULT 0.00,
  
  -- Sprint/Velocity Metrics
  story_points_committed INT DEFAULT 0,
  story_points_completed INT DEFAULT 0,
  velocity DECIMAL(5,2) DEFAULT 0.00,
  carryover_points INT DEFAULT 0,
  
  -- Developer Metrics (aggregated)
  avg_pr_merge_time_hours DECIMAL(10,2) DEFAULT 0.00,
  avg_code_review_time_hours DECIMAL(10,2) DEFAULT 0.00,
  total_prs_merged INT DEFAULT 0,
  total_code_reviews INT DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  UNIQUE KEY unique_team_period (team_id, period_start, period_end, period_type),
  KEY idx_team_period (team_id, period_start DESC),
  KEY idx_period_type (period_type),
  CONSTRAINT fk_team_analytics_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test Execution History per Team
-- Stores detailed test execution data per team
CREATE TABLE IF NOT EXISTS team_test_executions (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  team_id CHAR(36) NOT NULL,
  execution_date DATE NOT NULL,
  
  -- Execution Summary
  total_tests INT DEFAULT 0,
  passed INT DEFAULT 0,
  failed INT DEFAULT 0,
  skipped INT DEFAULT 0,
  blocked INT DEFAULT 0,
  
  -- Timing
  total_duration_seconds INT DEFAULT 0,
  avg_duration_seconds DECIMAL(10,2) DEFAULT 0.00,
  
  -- Categories
  unit_tests INT DEFAULT 0,
  integration_tests INT DEFAULT 0,
  e2e_tests INT DEFAULT 0,
  api_tests INT DEFAULT 0,
  
  -- Environment
  environment VARCHAR(50) DEFAULT 'staging',
  build_number VARCHAR(100),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  KEY idx_team_date (team_id, execution_date DESC),
  CONSTRAINT fk_team_test_exec_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Team Pipeline Metrics
-- CI/CD pipeline performance per team
CREATE TABLE IF NOT EXISTS team_pipeline_metrics (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  team_id CHAR(36) NOT NULL,
  recorded_date DATE NOT NULL,
  
  -- Pipeline Stats
  total_builds INT DEFAULT 0,
  successful_builds INT DEFAULT 0,
  failed_builds INT DEFAULT 0,
  build_success_rate DECIMAL(5,2) DEFAULT 0.00,
  
  -- Timing
  avg_build_time_minutes DECIMAL(10,2) DEFAULT 0.00,
  avg_queue_time_minutes DECIMAL(10,2) DEFAULT 0.00,
  
  -- Stages
  avg_compile_time_minutes DECIMAL(10,2) DEFAULT 0.00,
  avg_test_time_minutes DECIMAL(10,2) DEFAULT 0.00,
  avg_deploy_time_minutes DECIMAL(10,2) DEFAULT 0.00,
  
  -- Bottlenecks
  slowest_stage VARCHAR(100),
  most_failing_stage VARCHAR(100),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  UNIQUE KEY unique_team_date (team_id, recorded_date),
  KEY idx_team_date (team_id, recorded_date DESC),
  CONSTRAINT fk_team_pipeline_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Note: The following ALTER statements may show errors if columns already exist.
-- This is expected and safe to ignore.

-- Add team_id to technical_debt
-- Run separately and ignore "Duplicate column" errors
ALTER TABLE technical_debt ADD COLUMN team_id CHAR(36) NULL;
ALTER TABLE technical_debt ADD INDEX idx_tech_debt_team (team_id);

-- Add team_id to test_cases  
ALTER TABLE test_cases ADD COLUMN team_id CHAR(36) NULL;
ALTER TABLE test_cases ADD INDEX idx_test_cases_team (team_id);

-- Add team_id to performance_metrics
ALTER TABLE performance_metrics ADD COLUMN team_id CHAR(36) NULL;
ALTER TABLE performance_metrics ADD INDEX idx_perf_metrics_team (team_id);
