-- Migration: Create Missing Team Tables
-- Date: 2025-11-29
-- Description: Create technical_debt, test_cases, and performance_metrics tables with team support

-- Technical Debt Table (per team)
CREATE TABLE IF NOT EXISTS technical_debt (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  team_id CHAR(36) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  severity ENUM('critical', 'high', 'medium', 'low') DEFAULT 'medium',
  category ENUM('code_quality', 'testing', 'documentation', 'infrastructure', 'security', 'performance') DEFAULT 'code_quality',
  impact_score INT DEFAULT 0,
  effort_hours DECIMAL(10,2),
  status ENUM('open', 'in_progress', 'resolved', 'wont_fix') DEFAULT 'open',
  source VARCHAR(100),
  file_path VARCHAR(500),
  line_number INT,
  assigned_to CHAR(36),
  created_by CHAR(36),
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  KEY idx_tech_debt_team (team_id),
  KEY idx_tech_debt_severity (severity),
  KEY idx_tech_debt_status (status),
  KEY idx_tech_debt_category (category),
  CONSTRAINT fk_tech_debt_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test Cases Table (per team)
CREATE TABLE IF NOT EXISTS test_cases (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  team_id CHAR(36) NOT NULL,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  test_type ENUM('unit', 'integration', 'e2e', 'api', 'performance', 'security', 'manual') DEFAULT 'unit',
  priority ENUM('critical', 'high', 'medium', 'low') DEFAULT 'medium',
  status ENUM('active', 'obsolete', 'draft', 'disabled') DEFAULT 'active',
  requirement_id VARCHAR(100),
  file_path VARCHAR(500),
  class_name VARCHAR(255),
  method_name VARCHAR(255),
  
  -- Execution stats
  pass_rate DECIMAL(5,2) DEFAULT 0.00,
  execution_count INT DEFAULT 0,
  last_execution_status ENUM('passed', 'failed', 'skipped', 'blocked') NULL,
  last_executed TIMESTAMP NULL,
  avg_duration_ms INT DEFAULT 0,
  
  -- Flakiness tracking
  flakiness_score DECIMAL(5,2) DEFAULT 0.00,
  consecutive_failures INT DEFAULT 0,
  is_flaky BOOLEAN DEFAULT FALSE,
  
  -- Quality metrics
  effectiveness_score DECIMAL(5,2) DEFAULT 0.00,
  maintenance_cost_hours DECIMAL(10,2) DEFAULT 0.00,
  
  created_by CHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  KEY idx_test_cases_team (team_id),
  KEY idx_test_cases_type (test_type),
  KEY idx_test_cases_status (status),
  KEY idx_test_cases_flaky (is_flaky),
  KEY idx_test_cases_requirement (requirement_id),
  CONSTRAINT fk_test_cases_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test Case Tags
CREATE TABLE IF NOT EXISTS test_case_tags (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  test_case_id CHAR(36) NOT NULL,
  tag VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  KEY idx_test_tags_case (test_case_id),
  KEY idx_test_tags_tag (tag),
  CONSTRAINT fk_test_tags_case FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test Executions History
CREATE TABLE IF NOT EXISTS test_executions (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  test_case_id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  status ENUM('passed', 'failed', 'skipped', 'blocked') NOT NULL,
  duration_ms INT,
  error_message TEXT,
  stack_trace TEXT,
  environment VARCHAR(50) DEFAULT 'staging',
  build_number VARCHAR(100),
  branch VARCHAR(255),
  executed_by CHAR(36),
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  KEY idx_test_exec_case (test_case_id),
  KEY idx_test_exec_team (team_id),
  KEY idx_test_exec_status (status),
  KEY idx_test_exec_date (executed_at DESC),
  CONSTRAINT fk_test_exec_case FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_test_exec_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Performance Metrics Table (per team)
CREATE TABLE IF NOT EXISTS performance_metrics (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  team_id CHAR(36) NOT NULL,
  recorded_date DATE NOT NULL,
  
  -- API/Endpoint Performance
  endpoint VARCHAR(500),
  method VARCHAR(10) DEFAULT 'GET',
  response_time_p50_ms INT,
  response_time_p95_ms INT,
  response_time_p99_ms INT,
  throughput_per_minute INT,
  error_rate DECIMAL(5,2),
  
  -- Application Performance
  cpu_usage_avg DECIMAL(5,2),
  memory_usage_avg DECIMAL(5,2),
  disk_io_avg DECIMAL(10,2),
  network_io_avg DECIMAL(10,2),
  
  -- Database Performance
  db_query_time_avg_ms INT,
  db_connections_avg INT,
  slow_queries_count INT,
  
  -- Frontend Performance
  page_load_time_ms INT,
  first_contentful_paint_ms INT,
  largest_contentful_paint_ms INT,
  time_to_interactive_ms INT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  KEY idx_perf_team (team_id),
  KEY idx_perf_date (recorded_date DESC),
  KEY idx_perf_endpoint (endpoint),
  CONSTRAINT fk_perf_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Flaky Tests Summary (per team)
CREATE TABLE IF NOT EXISTS flaky_tests (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  test_case_id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  flakiness_score DECIMAL(5,2) DEFAULT 0.00,
  failure_count INT DEFAULT 0,
  pass_count INT DEFAULT 0,
  total_runs INT DEFAULT 0,
  last_flaky_at TIMESTAMP NULL,
  root_cause VARCHAR(255),
  suggested_fix TEXT,
  is_quarantined BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  UNIQUE KEY unique_flaky_test (test_case_id),
  KEY idx_flaky_team (team_id),
  KEY idx_flaky_score (flakiness_score DESC),
  CONSTRAINT fk_flaky_case FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_flaky_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
