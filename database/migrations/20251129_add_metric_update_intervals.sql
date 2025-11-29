-- Migration: Add metric update intervals configuration table
-- Date: 2025-11-29

CREATE TABLE IF NOT EXISTS metric_update_intervals (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  company_id CHAR(36) NOT NULL,
  metric_key VARCHAR(100) NOT NULL,
  interval_value INT NOT NULL,
  interval_unit ENUM('minutes','hours','days','weeks','months') NOT NULL DEFAULT 'days',
  custom_label VARCHAR(100) NULL,
  updated_by CHAR(36) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_company_metric (company_id, metric_key),
  KEY idx_metric_update_company (company_id),
  CONSTRAINT fk_metric_update_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
