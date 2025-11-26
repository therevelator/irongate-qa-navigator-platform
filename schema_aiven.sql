-- IronGate QA Navigator - MySQL Schema
-- Version: 1.0
-- Database: MySQL 8.0+

-- Create database
CREATE DATABASE IF NOT EXISTS irongate_qa 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE irongate_qa;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Companies
CREATE TABLE IF NOT EXISTS companies (
  id CHAR(36) PRIMARY KEY ,
  name VARCHAR(255) NOT NULL,
  domain VARCHAR(255) NOT NULL UNIQUE,
  logo_url TEXT,
  settings JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  INDEX idx_companies_domain (domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  id CHAR(36) PRIMARY KEY ,
  company_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  manager_id CHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  UNIQUE KEY unique_dept_per_company (company_id, name),
  INDEX idx_departments_company (company_id),
  INDEX idx_departments_manager (manager_id),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY ,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role ENUM('super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer') NOT NULL,
  company_id CHAR(36) NOT NULL,
  department_id CHAR(36) NOT NULL,
  primary_team_id CHAR(36),
  avatar_url TEXT,
  phone VARCHAR(50),
  timezone VARCHAR(50) DEFAULT 'UTC',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL,
  is_active BOOLEAN DEFAULT true,
  email_verified BOOLEAN DEFAULT false,
  email_verified_at TIMESTAMP NULL,
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMP NULL,
  failed_login_attempts INT DEFAULT 0,
  locked_until TIMESTAMP NULL,
  INDEX idx_users_email (email),
  INDEX idx_users_company (company_id),
  INDEX idx_users_department (department_id),
  INDEX idx_users_primary_team (primary_team_id),
  INDEX idx_users_role (role),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Teams
CREATE TABLE IF NOT EXISTS teams (
  id CHAR(36) PRIMARY KEY ,
  company_id CHAR(36) NOT NULL,
  department_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  platform ENUM('Web', 'Mobile', 'API', 'Backend', 'Payment', 'Security', 'DevOps'),
  lead_id CHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  UNIQUE KEY unique_team_per_dept (department_id, name),
  INDEX idx_teams_company (company_id),
  INDEX idx_teams_department (department_id),
  INDEX idx_teams_lead (lead_id),
  INDEX idx_teams_platform (platform),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add foreign keys after all tables are created
ALTER TABLE users ADD FOREIGN KEY (primary_team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE departments ADD FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL;

-- Team Members (Many-to-Many)
CREATE TABLE IF NOT EXISTS team_members (
  user_id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  role ENUM('lead', 'member', 'contributor') DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, team_id),
  INDEX idx_team_members_user (user_id),
  INDEX idx_team_members_team (team_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- METRICS & KPI TABLES
-- ============================================================================

-- KPI Snapshots
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id CHAR(36) PRIMARY KEY ,
  team_id CHAR(36) NOT NULL,
  snapshot_date DATE NOT NULL,
  test_coverage DECIMAL(5,2),
  test_flakiness_rate DECIMAL(5,2),
  defect_density DECIMAL(6,3),
  defect_escape_rate DECIMAL(5,2),
  code_quality_score INT,
  avg_build_time_minutes INT,
  test_execution_time_minutes INT,
  deployment_frequency_per_week INT,
  lead_time_days DECIMAL(4,2),
  mttr_hours DECIMAL(6,2),
  parallel_test_efficiency DECIMAL(5,2),
  sprint_velocity INT,
  sprint_commitment_rate DECIMAL(5,2),
  sprint_carryover DECIMAL(5,2),
  first_time_pass_rate DECIMAL(5,2),
  blocked_time_hours INT,
  automation_coverage DECIMAL(5,2),
  automation_roi DECIMAL(6,2),
  change_failure_rate DECIMAL(5,2),
  mtbf_hours INT,
  system_availability DECIMAL(5,3),
  infrastructure_failures INT,
  qa_score INT,
  status ENUM('good', 'warning', 'critical'),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_team_snapshot_date (team_id, snapshot_date),
  INDEX idx_kpi_snapshots_team_date (team_id, snapshot_date DESC),
  INDEX idx_kpi_snapshots_date (snapshot_date DESC),
  INDEX idx_kpi_snapshots_status (status),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sprint Velocity
CREATE TABLE IF NOT EXISTS sprint_velocity (
  id CHAR(36) PRIMARY KEY ,
  team_id CHAR(36) NOT NULL,
  sprint_name VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  committed_points INT NOT NULL,
  delivered_points INT NOT NULL,
  carryover_points INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_team_sprint (team_id, sprint_name),
  INDEX idx_sprint_velocity_team (team_id, start_date DESC),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Business Metrics
CREATE TABLE IF NOT EXISTS business_metrics (
  id CHAR(36) PRIMARY KEY ,
  company_id CHAR(36) NOT NULL,
  metric_date DATE NOT NULL,
  revenue DECIMAL(15,2),
  mrr DECIMAL(15,2),
  arr DECIMAL(15,2),
  customer_satisfaction_nps INT,
  customer_satisfaction_csat DECIMAL(5,2),
  churn_rate DECIMAL(5,2),
  feature_adoption_rate DECIMAL(5,2),
  support_ticket_volume INT,
  user_engagement_score DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_company_metric_date (company_id, metric_date),
  INDEX idx_business_metrics_company (company_id, metric_date DESC),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- ADVANCED FEATURES TABLES
-- ============================================================================

-- Flaky Tests
CREATE TABLE IF NOT EXISTS flaky_tests (
  id CHAR(36) PRIMARY KEY ,
  team_id CHAR(36) NOT NULL,
  test_name VARCHAR(255) NOT NULL,
  test_suite VARCHAR(191),
  file_path TEXT,
  total_runs INT DEFAULT 0,
  failed_runs INT DEFAULT 0,
  flakiness_score DECIMAL(5,2),
  consecutive_failures INT DEFAULT 0,
  failure_pattern ENUM('timing', 'environment', 'data', 'network', 'unknown'),
  suggested_fix TEXT,
  status ENUM('active', 'quarantined', 'fixed', 'ignored') DEFAULT 'active',
  first_failed_at TIMESTAMP NULL,
  last_failed_at TIMESTAMP NULL,
  fixed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_team_test (team_id, test_name(191), test_suite),
  INDEX idx_flaky_tests_team (team_id),
  INDEX idx_flaky_tests_status (status),
  INDEX idx_flaky_tests_score (flakiness_score DESC),
  INDEX idx_flaky_tests_pattern (failure_pattern),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Flaky Test Executions
CREATE TABLE IF NOT EXISTS flaky_test_executions (
  id CHAR(36) PRIMARY KEY ,
  flaky_test_id CHAR(36) NOT NULL,
  execution_date TIMESTAMP NOT NULL,
  passed BOOLEAN NOT NULL,
  duration_ms INT,
  error_message TEXT,
  stack_trace TEXT,
  environment JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_flaky_executions_test (flaky_test_id, execution_date DESC),
  FOREIGN KEY (flaky_test_id) REFERENCES flaky_tests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Technical Debt
CREATE TABLE IF NOT EXISTS technical_debt (
  id CHAR(36) PRIMARY KEY ,
  team_id CHAR(36) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  category ENUM('code_quality', 'architecture', 'testing', 'documentation', 'security'),
  priority ENUM('critical', 'high', 'medium', 'low'),
  cost_of_delay DECIMAL(10,2),
  business_impact INT CHECK (business_impact BETWEEN 1 AND 10),
  effort_estimate INT,
  roi_score DECIMAL(6,2),
  status ENUM('open', 'in_progress', 'resolved', 'wont_fix') DEFAULT 'open',
  assigned_to CHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  created_by CHAR(36),
  INDEX idx_tech_debt_team (team_id),
  INDEX idx_tech_debt_status (status),
  INDEX idx_tech_debt_priority (priority),
  INDEX idx_tech_debt_roi (roi_score DESC),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pipeline Executions
CREATE TABLE IF NOT EXISTS pipeline_executions (
  id CHAR(36) PRIMARY KEY ,
  team_id CHAR(36) NOT NULL,
  pipeline_name VARCHAR(255) NOT NULL,
  execution_number INT NOT NULL,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NULL,
  duration_seconds INT,
  status ENUM('success', 'failed', 'cancelled', 'running'),
  stages JSON,
  compute_cost DECIMAL(10,4),
  triggered_by CHAR(36),
  commit_sha VARCHAR(40),
  branch VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pipeline_team (team_id, started_at DESC),
  INDEX idx_pipeline_status (status),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Performance Tests
CREATE TABLE IF NOT EXISTS performance_tests (
  id CHAR(36) PRIMARY KEY ,
  team_id CHAR(36) NOT NULL,
  test_name VARCHAR(255) NOT NULL,
  endpoint VARCHAR(500),
  executed_at TIMESTAMP NOT NULL,
  duration_seconds INT,
  response_time_p50 INT,
  response_time_p95 INT,
  response_time_p99 INT,
  response_time_max INT,
  requests_per_second DECIMAL(10,2),
  concurrent_users INT,
  total_requests INT,
  failed_requests INT,
  error_rate DECIMAL(5,2),
  cpu_usage_percent DECIMAL(5,2),
  memory_usage_mb INT,
  passed BOOLEAN,
  sla_violated BOOLEAN,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_perf_tests_team (team_id, executed_at DESC),
  INDEX idx_perf_tests_endpoint (endpoint(255)),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Developer Productivity
CREATE TABLE IF NOT EXISTS developer_productivity (
  id CHAR(36) PRIMARY KEY ,
  user_id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  metric_date DATE NOT NULL,
  code_review_time_hours DECIMAL(6,2),
  pr_merge_time_hours DECIMAL(6,2),
  prs_created INT,
  prs_reviewed INT,
  commits INT,
  lines_added INT,
  lines_deleted INT,
  context_switches INT,
  focus_time_hours DECIMAL(5,2),
  meeting_time_hours DECIMAL(5,2),
  happiness_score INT CHECK (happiness_score BETWEEN 1 AND 100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_metric_date (user_id, metric_date),
  INDEX idx_dev_productivity_user (user_id, metric_date DESC),
  INDEX idx_dev_productivity_team (team_id, metric_date DESC),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test Cases
CREATE TABLE IF NOT EXISTS test_cases (
  id CHAR(36) PRIMARY KEY ,
  team_id CHAR(36) NOT NULL,
  test_id VARCHAR(255) NOT NULL,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  type ENUM('unit', 'integration', 'e2e', 'performance', 'security'),
  priority ENUM('critical', 'high', 'medium', 'low'),
  execution_count INT DEFAULT 0,
  pass_count INT DEFAULT 0,
  fail_count INT DEFAULT 0,
  bugs_found INT DEFAULT 0,
  effectiveness_score DECIMAL(5,2),
  last_updated_at TIMESTAMP NULL,
  maintenance_time_hours DECIMAL(6,2),
  is_automated BOOLEAN DEFAULT false,
  is_redundant BOOLEAN DEFAULT false,
  requirement_ids JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_team_test_id (team_id, test_id),
  INDEX idx_test_cases_team (team_id),
  INDEX idx_test_cases_type (type),
  INDEX idx_test_cases_effectiveness (effectiveness_score DESC),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test Executions
CREATE TABLE IF NOT EXISTS test_executions (
  id CHAR(36) PRIMARY KEY ,
  team_id CHAR(36) NOT NULL,
  execution_date DATE NOT NULL,
  total_tests INT DEFAULT 0,
  passed INT DEFAULT 0,
  failed INT DEFAULT 0,
  skipped INT DEFAULT 0,
  duration_minutes INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_team_execution_date (team_id, execution_date),
  INDEX idx_test_executions_team (team_id, execution_date DESC),
  INDEX idx_test_executions_date (execution_date DESC),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Defects
CREATE TABLE IF NOT EXISTS defects (
  id CHAR(36) PRIMARY KEY ,
  team_id CHAR(36) NOT NULL,
  defect_id VARCHAR(100) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  severity ENUM('critical', 'high', 'medium', 'low') NOT NULL,
  status ENUM('open', 'in_progress', 'resolved', 'closed', 'wont_fix') DEFAULT 'open',
  priority ENUM('critical', 'high', 'medium', 'low'),
  found_in_environment ENUM('production', 'staging', 'qa', 'dev'),
  assigned_to CHAR(36),
  reported_by CHAR(36),
  found_date DATE,
  resolved_date DATE NULL,
  root_cause TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_team_defect_id (team_id, defect_id),
  INDEX idx_defects_team (team_id),
  INDEX idx_defects_status (status),
  INDEX idx_defects_severity (severity),
  INDEX idx_defects_assigned (assigned_to),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gamification Points
CREATE TABLE IF NOT EXISTS gamification_points (
  id CHAR(36) PRIMARY KEY ,
  user_id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  points INT NOT NULL,
  reason VARCHAR(500) NOT NULL,
  category VARCHAR(50),
  awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  awarded_by CHAR(36),
  INDEX idx_gamification_user (user_id, awarded_at DESC),
  INDEX idx_gamification_team (team_id, awarded_at DESC),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (awarded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gamification Badges
CREATE TABLE IF NOT EXISTS gamification_badges (
  id CHAR(36) PRIMARY KEY ,
  user_id CHAR(36) NOT NULL,
  badge_type VARCHAR(100) NOT NULL,
  badge_name VARCHAR(255) NOT NULL,
  description TEXT,
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_badges_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- AUDIT & SECURITY TABLES
-- ============================================================================

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY ,
  user_id CHAR(36),
  company_id CHAR(36) NOT NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id CHAR(36),
  old_values JSON,
  new_values JSON,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_logs_user (user_id, created_at DESC),
  INDEX idx_audit_logs_company (company_id, created_at DESC),
  INDEX idx_audit_logs_resource (resource_type, resource_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- API Tokens
CREATE TABLE IF NOT EXISTS api_tokens (
  id CHAR(36) PRIMARY KEY ,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  scopes JSON,
  last_used_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_api_tokens_user (user_id),
  INDEX idx_api_tokens_hash (token_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Team Summary View
CREATE OR REPLACE VIEW team_summary AS
SELECT 
  t.id,
  t.name,
  t.platform,
  d.name as department_name,
  c.name as company_name,
  CONCAT(u.first_name, ' ', u.last_name) as team_lead_name,
  COUNT(DISTINCT tm.user_id) as member_count,
  k.qa_score,
  k.status,
  k.snapshot_date as last_snapshot_date
FROM teams t
JOIN departments d ON t.department_id = d.id
JOIN companies c ON t.company_id = c.id
LEFT JOIN users u ON t.lead_id = u.id
LEFT JOIN team_members tm ON t.id = tm.team_id
LEFT JOIN (
  SELECT ks.* FROM kpi_snapshots ks
  INNER JOIN (
    SELECT team_id, MAX(snapshot_date) as max_date
    FROM kpi_snapshots
    GROUP BY team_id
  ) latest ON ks.team_id = latest.team_id AND ks.snapshot_date = latest.max_date
) k ON t.id = k.team_id
WHERE t.is_active = true
GROUP BY t.id, t.name, t.platform, d.name, c.name, u.first_name, u.last_name, 
         k.qa_score, k.status, k.snapshot_date;

-- ============================================================================
-- DONE
-- ============================================================================

SELECT 'Schema created successfully!' as message;
