-- =============================================================================
-- Migration: Add business impact configuration tables
-- Date: 2025-11-30
-- Description: Tables to store configurable business impact correlation data
-- MySQL 8.0 compatible
-- =============================================================================

-- Business Impact Correlations table
-- Stores configurable correlation data for each quality metric
CREATE TABLE business_impact_config (
  id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  metric_name VARCHAR(100) NOT NULL,
  quality_score DECIMAL(5,2) DEFAULT 0.00,
  revenue_impact DECIMAL(12,2) DEFAULT 0.00, -- Annual revenue impact in dollars
  customer_satisfaction DECIMAL(5,2) DEFAULT 0.00, -- NPS score
  feature_adoption_rate DECIMAL(5,2) DEFAULT 0.00, -- Percentage
  correlation_strength DECIMAL(3,2) DEFAULT 0.00, -- 0.00 to 1.00
  manually_edited TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_team_metric (team_id, metric_name),
  KEY idx_team (team_id),
  KEY idx_metric (metric_name),
  CONSTRAINT fk_business_impact_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historical Trends Configuration table
-- Stores 12 months of configurable historical data
CREATE TABLE business_impact_history (
  id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  month_year VARCHAR(20) NOT NULL, -- Format: '2025-01', '2025-02', etc.
  quality_score DECIMAL(5,2) DEFAULT 0.00,
  revenue_impact DECIMAL(12,2) DEFAULT 0.00, -- Monthly revenue in dollars
  customer_satisfaction DECIMAL(5,2) DEFAULT 0.00,
  churn_rate DECIMAL(5,2) DEFAULT 0.00, -- Percentage
  manually_edited TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_team_month (team_id, month_year),
  KEY idx_team (team_id),
  KEY idx_month (month_year),
  CONSTRAINT fk_business_impact_history_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
