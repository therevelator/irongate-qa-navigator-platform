-- =============================================================================
-- Migration: Enhanced Business Impact Correlation Tables
-- Date: 2025-12-01
-- Description: Comprehensive tables for statistical correlation analysis
-- Supports: Quality Metrics (X) vs Business KPIs (Y) with time-series data
-- =============================================================================

-- Drop existing tables if they exist (for clean migration)
-- DROP TABLE IF EXISTS business_impact_history;
-- DROP TABLE IF EXISTS business_impact_config;

-- =============================================================================
-- 1. MONTHLY QUALITY METRICS (Independent Variables - X)
-- =============================================================================
CREATE TABLE IF NOT EXISTS business_impact_quality_metrics (
  id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  month_year VARCHAR(7) NOT NULL, -- Format: 'YYYY-MM'
  
  -- Code Quality & Engineering Health
  test_coverage DECIMAL(5,2) DEFAULT NULL,           -- Percentage (0-100)
  defect_density DECIMAL(8,4) DEFAULT NULL,          -- Bugs per KLOC
  defect_escape_rate DECIMAL(5,2) DEFAULT NULL,      -- Percentage
  mttr_hours DECIMAL(8,2) DEFAULT NULL,              -- Mean Time to Restore (hours)
  deployment_frequency DECIMAL(8,2) DEFAULT NULL,    -- Deployments per month
  lead_time_days DECIMAL(8,2) DEFAULT NULL,          -- Days from commit to production
  code_quality_score DECIMAL(5,2) DEFAULT NULL,      -- Overall quality score (0-100)
  change_failure_rate DECIMAL(5,2) DEFAULT NULL,     -- Percentage of failed deployments
  
  -- Metadata
  manually_edited TINYINT(1) DEFAULT 0,
  data_source VARCHAR(100) DEFAULT 'manual',         -- 'manual', 'jira', 'jenkins', etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  UNIQUE KEY unique_team_month_quality (team_id, month_year),
  KEY idx_team (team_id),
  KEY idx_month (month_year),
  CONSTRAINT fk_quality_metrics_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 2. MONTHLY BUSINESS KPIs (Dependent Variables - Y)
-- =============================================================================
CREATE TABLE IF NOT EXISTS business_impact_business_kpis (
  id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  month_year VARCHAR(7) NOT NULL, -- Format: 'YYYY-MM'
  
  -- Revenue & Customers
  monthly_revenue DECIMAL(15,2) DEFAULT NULL,        -- Revenue in dollars
  active_users INT DEFAULT NULL,                      -- Monthly active users
  churn_rate DECIMAL(5,2) DEFAULT NULL,              -- Percentage of lost users
  feature_adoption_rate DECIMAL(5,2) DEFAULT NULL,   -- Percentage using key features
  new_customers INT DEFAULT NULL,                     -- New customers acquired
  customer_lifetime_value DECIMAL(12,2) DEFAULT NULL, -- Average CLV
  
  -- Satisfaction & Support
  nps_score DECIMAL(5,2) DEFAULT NULL,               -- Net Promoter Score (-100 to 100)
  csat_score DECIMAL(5,2) DEFAULT NULL,              -- Customer Satisfaction (0-100)
  support_ticket_volume INT DEFAULT NULL,            -- Total tickets
  avg_resolution_time_hours DECIMAL(8,2) DEFAULT NULL, -- Average ticket resolution time
  
  -- Metadata
  manually_edited TINYINT(1) DEFAULT 0,
  data_source VARCHAR(100) DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  UNIQUE KEY unique_team_month_kpi (team_id, month_year),
  KEY idx_team (team_id),
  KEY idx_month (month_year),
  CONSTRAINT fk_business_kpis_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 3. CONTEXT / NORMALIZATION PARAMETERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS business_impact_context (
  id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  month_year VARCHAR(7) NOT NULL, -- Format: 'YYYY-MM'
  
  -- Team & Capacity
  team_size INT DEFAULT NULL,                        -- Number of team members
  sprint_length_days INT DEFAULT 14,                 -- Sprint duration
  working_days INT DEFAULT NULL,                     -- Working days in month
  
  -- Delivery Context
  feature_release_count INT DEFAULT NULL,            -- Features released
  bug_fix_count INT DEFAULT NULL,                    -- Bugs fixed
  tech_debt_items_resolved INT DEFAULT NULL,         -- Tech debt addressed
  
  -- User Context
  user_growth_rate DECIMAL(5,2) DEFAULT NULL,        -- % user growth/decline
  total_user_base INT DEFAULT NULL,                  -- Total registered users
  
  -- External Factors
  is_holiday_season TINYINT(1) DEFAULT 0,            -- Holiday/seasonal flag
  marketing_spend DECIMAL(12,2) DEFAULT NULL,        -- Marketing budget
  major_incident_count INT DEFAULT 0,                -- Major outages
  downtime_minutes INT DEFAULT 0,                    -- Total downtime
  
  -- Metadata
  notes TEXT DEFAULT NULL,
  manually_edited TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  UNIQUE KEY unique_team_month_context (team_id, month_year),
  KEY idx_team (team_id),
  KEY idx_month (month_year),
  CONSTRAINT fk_context_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 4. CALCULATED CORRELATIONS (Cached Results)
-- =============================================================================
CREATE TABLE IF NOT EXISTS business_impact_correlations (
  id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  
  -- Correlation pair
  quality_metric VARCHAR(50) NOT NULL,               -- X variable name
  business_kpi VARCHAR(50) NOT NULL,                 -- Y variable name
  
  -- Statistical results
  pearson_correlation DECIMAL(4,3) DEFAULT NULL,     -- -1.000 to 1.000
  p_value DECIMAL(10,8) DEFAULT NULL,                -- Statistical significance
  sample_size INT DEFAULT NULL,                      -- Number of data points
  confidence_level DECIMAL(5,2) DEFAULT 95.00,       -- Confidence level %
  
  -- Time range
  start_month VARCHAR(7) NOT NULL,
  end_month VARCHAR(7) NOT NULL,
  
  -- Interpretation
  correlation_strength VARCHAR(20) DEFAULT NULL,     -- 'strong', 'moderate', 'weak', 'none'
  is_significant TINYINT(1) DEFAULT 0,               -- p_value < 0.05
  
  -- Metadata
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  UNIQUE KEY unique_correlation_pair (team_id, quality_metric, business_kpi),
  KEY idx_team (team_id),
  KEY idx_quality_metric (quality_metric),
  KEY idx_business_kpi (business_kpi),
  CONSTRAINT fk_correlations_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 5. DATA REQUIREMENTS TRACKING
-- =============================================================================
CREATE TABLE IF NOT EXISTS business_impact_data_status (
  id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  
  -- Data completeness
  months_with_quality_data INT DEFAULT 0,
  months_with_kpi_data INT DEFAULT 0,
  months_with_paired_data INT DEFAULT 0,            -- Both X and Y exist
  
  -- Date range
  earliest_month VARCHAR(7) DEFAULT NULL,
  latest_month VARCHAR(7) DEFAULT NULL,
  
  -- Validation
  is_correlation_ready TINYINT(1) DEFAULT 0,        -- >= 6 months paired data
  missing_quality_metrics TEXT DEFAULT NULL,        -- JSON array of missing metrics
  missing_kpi_metrics TEXT DEFAULT NULL,            -- JSON array of missing KPIs
  
  -- Last check
  last_validated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  UNIQUE KEY unique_team_status (team_id),
  KEY idx_team (team_id),
  CONSTRAINT fk_status_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
