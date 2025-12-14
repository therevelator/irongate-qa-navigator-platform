-- Developer Productivity Snapshots Table
-- Stores daily productivity metrics snapshots for historical tracking

CREATE TABLE IF NOT EXISTS developer_productivity_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  developer_id VARCHAR(100) NOT NULL,
  snapshot_date DATE NOT NULL,
  
  -- Raw metrics (hours per day)
  focus_time_hours DECIMAL(5,2) DEFAULT 0,
  pr_merge_time_avg DECIMAL(5,2) DEFAULT 0,
  code_review_time_avg DECIMAL(5,2) DEFAULT 0,
  meeting_time_hours DECIMAL(5,2) DEFAULT 0,
  context_switches_per_day INT DEFAULT 0,
  
  -- Normalized values (0-1)
  focus_time_norm DECIMAL(5,4) DEFAULT 0,
  pr_time_norm DECIMAL(5,4) DEFAULT 0,
  review_time_norm DECIMAL(5,4) DEFAULT 0,
  meeting_time_norm DECIMAL(5,4) DEFAULT 0,
  context_switches_norm DECIMAL(5,4) DEFAULT 0,
  
  -- Calculated DDPS score (0-1)
  ddps_score DECIMAL(5,4) DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_developer_date (developer_id, snapshot_date),
  INDEX idx_snapshot_date (snapshot_date),
  
  -- Constraints
  FOREIGN KEY (developer_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_developer_date (developer_id, snapshot_date)
);

-- Add comment
ALTER TABLE developer_productivity_snapshots 
  COMMENT = 'Stores daily DDPS (Daily Developer Productivity Score) snapshots for historical tracking';
