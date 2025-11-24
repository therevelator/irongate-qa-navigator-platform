-- Update Quality Cowboys team QA score to 36
USE irongate_qa;

-- First, check if the team exists
SELECT id, name FROM teams WHERE name LIKE '%Cowboys%';

-- Insert or update KPI snapshot for Quality Cowboys
INSERT INTO kpi_snapshots (
  team_id, 
  snapshot_date, 
  qa_score, 
  status,
  test_coverage,
  test_flakiness_rate,
  defect_density,
  defect_escape_rate,
  code_quality_score,
  avg_build_time_minutes,
  test_execution_time_minutes,
  deployment_frequency_per_week,
  lead_time_days,
  mttr_hours,
  parallel_test_efficiency,
  sprint_velocity,
  sprint_commitment_rate,
  sprint_carryover,
  first_time_pass_rate,
  blocked_time_hours,
  automation_coverage,
  automation_roi,
  change_failure_rate,
  mtbf_hours,
  system_availability,
  infrastructure_failures
)
SELECT 
  t.id,
  CURDATE(),
  36,
  'critical',
  65.5,
  12.5,
  0.85,
  8.2,
  58,
  28,
  85,
  2,
  7.5,
  6.8,
  52.3,
  28,
  68.2,
  38.5,
  58.3,
  45,
  62.5,
  125.5,
  12.8,
  280,
  98.45,
  18
FROM teams t
WHERE t.name LIKE '%Cowboys%'
ON DUPLICATE KEY UPDATE
  qa_score = 36,
  status = 'critical',
  snapshot_date = CURDATE(),
  test_coverage = 65.5,
  defect_density = 0.85,
  automation_coverage = 62.5;

-- Verify the update
SELECT 
    t.name as team_name,
    t.id as team_id,
    k.qa_score,
    k.status,
    k.test_coverage,
    k.defect_density,
    k.automation_coverage,
    k.snapshot_date
FROM teams t
LEFT JOIN kpi_snapshots k ON t.id = k.team_id
WHERE t.name LIKE '%Cowboys%';
