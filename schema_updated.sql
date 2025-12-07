-- IronGate QA Navigator - Updated Database Schema
-- This schema supports the full QA dashboard with companies, departments, teams, and KPI tracking

-- Companies table
CREATE TABLE IF NOT EXISTS companies (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  domain VARCHAR(255),
  logo_url VARCHAR(500),
  settings JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Users table (updated structure)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  name VARCHAR(255), -- for backward compatibility
  role ENUM('super_admin', 'manager', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer') DEFAULT 'viewer',
  primary_team_id VARCHAR(50),
  department_id VARCHAR(50),
  company_id VARCHAR(50),
  avatar_url VARCHAR(500),
  phone VARCHAR(50),
  timezone VARCHAR(50) DEFAULT 'UTC',
  developer_insights_enabled BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verified_at TIMESTAMP NULL,
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMP NULL,
  failed_login_attempts INT DEFAULT 0,
  locked_until TIMESTAMP NULL,
  created_by VARCHAR(50),
  last_login TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_role (role),
  INDEX idx_company (company_id),
  INDEX idx_primary_team (primary_team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Departments table
CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(50) PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  manager_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_company (company_id),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Teams table (updated structure)
CREATE TABLE IF NOT EXISTS teams (
  id VARCHAR(50) PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  department_id VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  platform VARCHAR(50), -- backend, frontend, mobile, api, devops, security, etc.
  lead_id VARCHAR(50),
  ai_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_company (company_id),
  INDEX idx_department (department_id),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Team members junction table
CREATE TABLE IF NOT EXISTS team_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(50) NOT NULL,
  role ENUM('lead', 'member') DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_team_user (team_id, user_id),
  INDEX idx_team (team_id),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- KPI Snapshots table (latest metrics for each team)
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id VARCHAR(50) NOT NULL,
  snapshot_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  qa_score DECIMAL(5,2),
  status ENUM('good', 'warning', 'critical') DEFAULT 'warning',

  -- Quality Metrics
  test_coverage DECIMAL(5,2),
  test_flakiness_rate DECIMAL(5,2),
  defect_density DECIMAL(5,3),
  defect_escape_rate DECIMAL(5,2),
  code_quality_score DECIMAL(5,2),
  first_time_pass_rate DECIMAL(5,2),

  -- Speed & Efficiency
  avg_build_time_minutes DECIMAL(6,1),
  test_execution_time_minutes DECIMAL(6,1),
  deployment_frequency_per_week DECIMAL(4,1),
  lead_time_days DECIMAL(4,1),
  mttr_hours DECIMAL(6,2),

  -- Performance
  parallel_test_efficiency DECIMAL(5,2),
  sprint_velocity DECIMAL(6,1),
  sprint_commitment_rate DECIMAL(5,2),
  sprint_carryover DECIMAL(5,2),
  blocked_time_hours DECIMAL(6,1),

  -- Automation
  automation_coverage DECIMAL(5,2),
  automation_roi DECIMAL(6,1),

  -- Reliability
  change_failure_rate DECIMAL(5,2),
  mtbf_hours DECIMAL(7,1),
  system_availability DECIMAL(5,3),
  infrastructure_failures INT DEFAULT 0,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  UNIQUE KEY unique_team_latest (team_id, snapshot_date),
  INDEX idx_team (team_id),
  INDEX idx_date (snapshot_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Technical debt items
CREATE TABLE IF NOT EXISTS technical_debt (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id VARCHAR(50),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  severity ENUM('critical', 'high', 'medium', 'low') DEFAULT 'medium',
  impact_score INT DEFAULT 0,
  effort_hours DECIMAL(10,2),
  status ENUM('open', 'in_progress', 'resolved', 'wont_fix') DEFAULT 'open',
  assigned_to VARCHAR(50),
  created_by VARCHAR(50),
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_team (team_id),
  INDEX idx_severity (severity),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Developer productivity metrics
CREATE TABLE IF NOT EXISTS developer_metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  developer_id VARCHAR(50) NOT NULL,
  team_id VARCHAR(50),
  pr_merge_time_avg DECIMAL(10,2),
  code_review_time_avg DECIMAL(10,2),
  focus_time_hours DECIMAL(5,2),
  meeting_time_hours DECIMAL(5,2),
  context_switches_per_day INT,
  happiness_score DECIMAL(3,1),
  recorded_date DATE NOT NULL,
  FOREIGN KEY (developer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  UNIQUE KEY unique_developer_date (developer_id, recorded_date),
  INDEX idx_developer (developer_id),
  INDEX idx_team (team_id),
  INDEX idx_date (recorded_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
