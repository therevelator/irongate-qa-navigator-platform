# Database Schema Design - MySQL
## IronGate QA Navigator - Complete Schema

---

## Database Configuration

**Database**: MySQL 8.0+  
**Storage Engine**: InnoDB  
**Character Set**: utf8mb4  
**Collation**: utf8mb4_unicode_ci

```sql
CREATE DATABASE irongate_qa 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE irongate_qa;
```

---

## Core Tables

### 1. Companies
```sql
CREATE TABLE companies (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name VARCHAR(255) NOT NULL,
  domain VARCHAR(255) NOT NULL UNIQUE,
  logo_url TEXT,
  settings JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  ai_enabled BOOLEAN DEFAULT false,
  INDEX idx_companies_domain (domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

### 5b. Developer Metrics (Per-Developer Productivity)

Used to store per-developer metrics that power Developer Insights.

```sql
CREATE TABLE developer_metrics (
  id VARCHAR(50) PRIMARY KEY DEFAULT (CONCAT('dm-', UNIX_TIMESTAMP(), '-', SUBSTRING(UUID(), 1, 8))),
  team_id VARCHAR(50) NOT NULL,
  developer_id VARCHAR(50) NOT NULL,
  pr_merge_time_avg DECIMAL(10,2) DEFAULT 0,
  code_review_time_avg DECIMAL(10,2) DEFAULT 0,
  focus_time_hours DECIMAL(10,2) DEFAULT 0,
  meeting_time_hours DECIMAL(10,2) DEFAULT 0,
  context_switches_per_day INT DEFAULT 0,
  happiness_score DECIMAL(3,1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (developer_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_team_developer (team_id, developer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Notes:**
- `teams.ai_enabled` controls whether team-level AI insights are available.
- `users.developer_insights_enabled` gates whether a given developer appears in Developer Insights for their team.
- `developer_metrics` is populated by internal jobs or manual input and is read by the `/api/teams/:id/developer-ai-suggestions` endpoint.

---

### 2. Departments
```sql
CREATE TABLE departments (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
```

---

### 3. Users
```sql
CREATE TABLE users (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role ENUM('super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer') NOT NULL,
  
  -- Organizational context
  company_id CHAR(36) NOT NULL,
  department_id CHAR(36) NOT NULL,
  primary_team_id CHAR(36),
  
  -- Profile
  avatar_url TEXT,
  phone VARCHAR(50),
  timezone VARCHAR(50) DEFAULT 'UTC',
  
  -- Status
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL,
  is_active BOOLEAN DEFAULT true,
  developer_insights_enabled BOOLEAN DEFAULT false,
  email_verified BOOLEAN DEFAULT false,
  email_verified_at TIMESTAMP NULL,
  
  -- Security
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
```

---

### 4. Teams
```sql
CREATE TABLE teams (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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

-- Add foreign key to users.primary_team_id after teams table is created
ALTER TABLE users 
  ADD FOREIGN KEY (primary_team_id) REFERENCES teams(id) ON DELETE SET NULL;

-- Add foreign key to departments.manager_id after users table is created
ALTER TABLE departments 
  ADD FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL;
```

---

### 5. Team Members (Many-to-Many)
```sql
CREATE TABLE team_members (
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
```

---

## Metrics & KPI Tables

### 6. KPI Snapshots (Daily Aggregates)
```sql
CREATE TABLE kpi_snapshots (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  team_id CHAR(36) NOT NULL,
  snapshot_date DATE NOT NULL,
  
  -- Quality Metrics (5)
  test_coverage DECIMAL(5,2),
  test_flakiness_rate DECIMAL(5,2),
  defect_density DECIMAL(6,3),
  defect_escape_rate DECIMAL(5,2),
  code_quality_score INT,
  
  -- Speed Metrics (6)
  avg_build_time_minutes INT,
  test_execution_time_minutes INT,
  deployment_frequency_per_week INT,
  lead_time_days DECIMAL(4,2),
  mttr_hours DECIMAL(6,2),
  parallel_test_efficiency DECIMAL(5,2),
  
  -- Agile Metrics (7)
  sprint_velocity INT,
  sprint_commitment_rate DECIMAL(5,2),
  sprint_carryover DECIMAL(5,2),
  first_time_pass_rate DECIMAL(5,2),
  blocked_time_hours INT,
  automation_coverage DECIMAL(5,2),
  automation_roi DECIMAL(6,2),
  
  -- Reliability Metrics (4)
  change_failure_rate DECIMAL(5,2),
  mtbf_hours INT,
  system_availability DECIMAL(5,3),
  infrastructure_failures INT,
  
  -- Calculated
  qa_score INT,
  status ENUM('good', 'warning', 'critical'),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_team_snapshot_date (team_id, snapshot_date),
  INDEX idx_kpi_snapshots_team_date (team_id, snapshot_date DESC),
  INDEX idx_kpi_snapshots_date (snapshot_date DESC),
  INDEX idx_kpi_snapshots_status (status),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

### 7. Sprint Velocity History
```sql
CREATE TABLE sprint_velocity (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
```

---

## Advanced Features Tables

### 8. Flaky Tests
```sql
CREATE TABLE flaky_tests (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  team_id CHAR(36) NOT NULL,
  test_name VARCHAR(500) NOT NULL,
  test_suite VARCHAR(255),
  file_path TEXT,
  
  -- Flakiness metrics
  total_runs INT DEFAULT 0,
  failed_runs INT DEFAULT 0,
  flakiness_score DECIMAL(5,2),
  consecutive_failures INT DEFAULT 0,
  
  -- Pattern detection
  failure_pattern ENUM('timing', 'environment', 'data', 'network', 'unknown'),
  suggested_fix TEXT,
  
  -- Status
  status ENUM('active', 'quarantined', 'fixed', 'ignored') DEFAULT 'active',
  first_failed_at TIMESTAMP NULL,
  last_failed_at TIMESTAMP NULL,
  fixed_at TIMESTAMP NULL,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_team_test (team_id, test_name, test_suite),
  INDEX idx_flaky_tests_team (team_id),
  INDEX idx_flaky_tests_status (status),
  INDEX idx_flaky_tests_score (flakiness_score DESC),
  INDEX idx_flaky_tests_pattern (failure_pattern),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

### 9. Flaky Test Executions
```sql
CREATE TABLE flaky_test_executions (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
```

---

### 10. Technical Debt Items
```sql
CREATE TABLE technical_debt (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  team_id CHAR(36) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  
  -- Categorization
  category ENUM('code_quality', 'architecture', 'testing', 'documentation', 'security'),
  priority ENUM('critical', 'high', 'medium', 'low'),
  
  -- Impact assessment
  cost_of_delay DECIMAL(10,2),
  business_impact INT CHECK (business_impact BETWEEN 1 AND 10),
  effort_estimate INT,
  roi_score DECIMAL(6,2),
  
  -- Status
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
```

---

### 11. CI/CD Pipeline Metrics
```sql
CREATE TABLE pipeline_executions (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
```

---

### 12. Business Impact Metrics
```sql
CREATE TABLE business_metrics (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
```

---

### 13. Performance Test Results
```sql
CREATE TABLE performance_tests (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
```

---

### 14. Developer Productivity Metrics
```sql
CREATE TABLE developer_productivity (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
```

---

### 15. Test Cases
```sql
CREATE TABLE test_cases (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
```

---

### 16. Gamification
```sql
CREATE TABLE gamification_points (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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

CREATE TABLE gamification_badges (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL,
  badge_type VARCHAR(100) NOT NULL,
  badge_name VARCHAR(255) NOT NULL,
  description TEXT,
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_badges_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## Audit & Security Tables

### 17. Audit Logs
```sql
CREATE TABLE audit_logs (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
```

---

### 18. API Tokens
```sql
CREATE TABLE api_tokens (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
```

---

## Views

### Team Summary View
```sql
CREATE VIEW team_summary AS
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
```

---

## MySQL-Specific Features

### Partitioning for Time-Series Data
```sql
-- Partition kpi_snapshots by month for better performance
ALTER TABLE kpi_snapshots
PARTITION BY RANGE (YEAR(snapshot_date) * 100 + MONTH(snapshot_date)) (
  PARTITION p202501 VALUES LESS THAN (202502),
  PARTITION p202502 VALUES LESS THAN (202503),
  PARTITION p202503 VALUES LESS THAN (202504),
  PARTITION p202504 VALUES LESS THAN (202505),
  PARTITION p202505 VALUES LESS THAN (202506),
  PARTITION p202506 VALUES LESS THAN (202507),
  PARTITION p202507 VALUES LESS THAN (202508),
  PARTITION p202508 VALUES LESS THAN (202509),
  PARTITION p202509 VALUES LESS THAN (202510),
  PARTITION p202510 VALUES LESS THAN (202511),
  PARTITION p202511 VALUES LESS THAN (202512),
  PARTITION p202512 VALUES LESS THAN (202601),
  PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

---

## Estimated Storage (MySQL)

**Per Team (1 year)**:
- KPI Snapshots: ~365 rows × 1 KB = 365 KB
- Flaky Tests: ~50 tests × 2 KB = 100 KB
- Pipeline Executions: ~1000 runs × 5 KB = 5 MB
- Test Cases: ~500 cases × 2 KB = 1 MB

**Total per team**: ~6.5 MB/year  
**For 100 teams**: ~650 MB/year

---

## MySQL Configuration Recommendations

```ini
# my.cnf or my.ini

[mysqld]
# Character set
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci

# InnoDB settings
innodb_buffer_pool_size=1G
innodb_log_file_size=256M
innodb_flush_log_at_trx_commit=2
innodb_flush_method=O_DIRECT

# Query cache (disabled in MySQL 8.0+)
# Use application-level caching instead

# Max connections
max_connections=200

# Timeouts
wait_timeout=28800
interactive_timeout=28800
```

---

*Schema Version: 1.0 (MySQL)*  
*Last Updated: November 20, 2025*
