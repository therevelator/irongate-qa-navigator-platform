-- QA Dashboard Database Schema
-- Compatible with MySQL 5.7+ and PlanetScale 

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role ENUM('admin', 'manager', 'user') DEFAULT 'user',
  avatar_url VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  color VARCHAR(7) DEFAULT '#3b82f6',
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Team members junction table
CREATE TABLE IF NOT EXISTS team_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('lead', 'member') DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_team_user (team_id, user_id),
  INDEX idx_team (team_id),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Departments table
CREATE TABLE IF NOT EXISTS departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  team_id INT,
  manager_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_team (team_id),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test cases table
CREATE TABLE IF NOT EXISTS test_cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  requirement_id VARCHAR(100),
  status ENUM('active', 'obsolete', 'redundant') DEFAULT 'active',
  pass_rate DECIMAL(5,2) DEFAULT 0.00,
  execution_count INT DEFAULT 0,
  effectiveness_score DECIMAL(5,2) DEFAULT 0.00,
  avg_duration DECIMAL(10,2) DEFAULT 0.00,
  last_executed TIMESTAMP NULL,
  department_id INT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_status (status),
  INDEX idx_department (department_id),
  INDEX idx_requirement (requirement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test case tags
CREATE TABLE IF NOT EXISTS test_case_tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  test_case_id INT NOT NULL,
  tag VARCHAR(100) NOT NULL,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  INDEX idx_test_case (test_case_id),
  INDEX idx_tag (tag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Metrics table
CREATE TABLE IF NOT EXISTS metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  metric_type VARCHAR(100) NOT NULL,
  metric_name VARCHAR(255) NOT NULL,
  metric_value DECIMAL(15,2),
  metric_unit VARCHAR(50),
  department_id INT,
  team_id INT,
  user_id INT,
  metadata JSON,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_type (metric_type),
  INDEX idx_recorded_at (recorded_at),
  INDEX idx_department (department_id),
  INDEX idx_team (team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test executions table
CREATE TABLE IF NOT EXISTS test_executions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  test_case_id INT NOT NULL,
  status ENUM('passed', 'failed', 'skipped', 'blocked') NOT NULL,
  duration INT,
  error_message TEXT,
  executed_by INT,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (executed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_test_case (test_case_id),
  INDEX idx_status (status),
  INDEX idx_executed_at (executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Flaky tests tracking
CREATE TABLE IF NOT EXISTS flaky_tests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  test_case_id INT NOT NULL,
  flakiness_score DECIMAL(5,2),
  failure_count INT DEFAULT 0,
  pass_count INT DEFAULT 0,
  last_flaky_at TIMESTAMP NULL,
  suggested_fix TEXT,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  UNIQUE KEY unique_test_case (test_case_id),
  INDEX idx_score (flakiness_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Technical debt items
CREATE TABLE IF NOT EXISTS technical_debt (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  severity ENUM('critical', 'high', 'medium', 'low') DEFAULT 'medium',
  impact_score INT DEFAULT 0,
  effort_hours DECIMAL(10,2),
  status ENUM('open', 'in_progress', 'resolved', 'wont_fix') DEFAULT 'open',
  department_id INT,
  assigned_to INT,
  created_by INT,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_severity (severity),
  INDEX idx_status (status),
  INDEX idx_department (department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Performance metrics
CREATE TABLE IF NOT EXISTS performance_metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  endpoint VARCHAR(500) NOT NULL,
  method VARCHAR(10) DEFAULT 'GET',
  response_time_p50 INT,
  response_time_p95 INT,
  response_time_p99 INT,
  throughput INT,
  error_rate DECIMAL(5,2),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_endpoint (endpoint),
  INDEX idx_recorded_at (recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Developer productivity metrics
CREATE TABLE IF NOT EXISTS developer_metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  pr_merge_time_avg DECIMAL(10,2),
  code_review_time_avg DECIMAL(10,2),
  focus_time_hours DECIMAL(5,2),
  meeting_time_hours DECIMAL(5,2),
  context_switches_per_day INT,
  happiness_score DECIMAL(3,1),
  recorded_date DATE NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_date (user_id, recorded_date),
  INDEX idx_user (user_id),
  INDEX idx_date (recorded_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100),
  entity_id INT,
  old_value JSON,
  new_value JSON,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_user (user_id),
  INDEX idx_action (action),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default admin user (password: admin123 - CHANGE THIS!)
INSERT INTO users (email, password_hash, name, role) VALUES
('admin@qadashboard.com', '$2a$10$YourHashedPasswordHere', 'Admin User', 'admin')
ON DUPLICATE KEY UPDATE email=email;

-- Insert sample team
INSERT INTO teams (name, description, color) VALUES
('Engineering', 'Main engineering team', '#3b82f6'),
('QA Team', 'Quality assurance team', '#10b981')
ON DUPLICATE KEY UPDATE name=name;
