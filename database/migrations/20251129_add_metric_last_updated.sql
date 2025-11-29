-- Migration: Add metric last updated tracking table
-- Date: 2025-11-29

CREATE TABLE IF NOT EXISTS metric_last_updated (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  company_id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  metric_key VARCHAR(100) NOT NULL,
  last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_update_at TIMESTAMP NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_team_metric (team_id, metric_key),
  KEY idx_metric_last_updated_company (company_id),
  KEY idx_metric_last_updated_next (next_update_at),
  CONSTRAINT fk_metric_last_updated_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_metric_last_updated_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
