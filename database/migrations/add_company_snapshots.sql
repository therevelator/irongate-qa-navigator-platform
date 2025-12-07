CREATE TABLE IF NOT EXISTS company_kpi_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  snapshot_date DATE NOT NULL,
  
  -- Executive Metrics
  engineering_health_score DECIMAL(5,2),
  delivery_performance_score DECIMAL(5,2),
  developer_wellness_index DECIMAL(5,2),
  tech_debt_status_score DECIMAL(5,2),
  pipeline_health_score DECIMAL(5,2),
  
  -- Detailed Aggregates
  avg_qa_score DECIMAL(5,2),
  avg_test_coverage DECIMAL(5,2),
  avg_defect_escape_rate DECIMAL(5,2),
  avg_flakiness_rate DECIMAL(5,2),
  automation_coverage DECIMAL(5,2),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_company_date (company_id, snapshot_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
