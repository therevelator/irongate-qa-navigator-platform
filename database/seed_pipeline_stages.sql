-- Seed Pipeline Stages for all existing companies
-- Run this once to populate initial data

-- Get all active companies-- Initial seed for pipeline stages per company
-- Bottleneck formula: durationFactor = clamp(((z + 2)/4) * 60, 0, 60)
-- where z = (stage_duration - mean) / stddev, failureFactor = (1 - success_rate) * 40
-- Final bottleneck_score = durationFactor + failureFactor
INSERT INTO pipeline_stages (company_id, team_id, name, stage_order, avg_duration_seconds, success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score, is_active)
SELECT 
  c.id as company_id,
  NULL as team_id,
  'Build' as name,
  1 as stage_order,
  FLOOR(100 + RAND() * 40) as avg_duration_seconds,
  ROUND(96 + RAND() * 3, 2) as success_rate,
  ROUND(70 + RAND() * 15, 2) as cpu_usage,
  ROUND(55 + RAND() * 15, 2) as memory_usage,
  ROUND(0.12 + RAND() * 0.08, 2) as cost_per_run,
  ROUND(20 + RAND() * 30, 2) as bottleneck_score,
  1 as is_active
FROM companies c
WHERE c.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.company_id = c.id AND ps.name = 'Build');

INSERT INTO pipeline_stages (company_id, team_id, name, stage_order, avg_duration_seconds, success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score, is_active)
SELECT 
  c.id as company_id,
  NULL as team_id,
  'Unit Tests' as name,
  2 as stage_order,
  FLOOR(150 + RAND() * 60) as avg_duration_seconds,
  ROUND(94 + RAND() * 4, 2) as success_rate,
  ROUND(45 + RAND() * 15, 2) as cpu_usage,
  ROUND(35 + RAND() * 15, 2) as memory_usage,
  ROUND(0.08 + RAND() * 0.05, 2) as cost_per_run,
  ROUND(15 + RAND() * 25, 2) as bottleneck_score,
  1 as is_active
FROM companies c
WHERE c.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.company_id = c.id AND ps.name = 'Unit Tests');

INSERT INTO pipeline_stages (company_id, team_id, name, stage_order, avg_duration_seconds, success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score, is_active)
SELECT 
  c.id as company_id,
  NULL as team_id,
  'Integration Tests' as name,
  3 as stage_order,
  FLOOR(250 + RAND() * 100) as avg_duration_seconds,
  ROUND(90 + RAND() * 5, 2) as success_rate,
  ROUND(60 + RAND() * 15, 2) as cpu_usage,
  ROUND(50 + RAND() * 15, 2) as memory_usage,
  ROUND(0.20 + RAND() * 0.10, 2) as cost_per_run,
  ROUND(40 + RAND() * 30, 2) as bottleneck_score,
  1 as is_active
FROM companies c
WHERE c.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.company_id = c.id AND ps.name = 'Integration Tests');

INSERT INTO pipeline_stages (company_id, team_id, name, stage_order, avg_duration_seconds, success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score, is_active)
SELECT 
  c.id as company_id,
  NULL as team_id,
  'Security Scan' as name,
  4 as stage_order,
  FLOOR(70 + RAND() * 40) as avg_duration_seconds,
  ROUND(97 + RAND() * 2.5, 2) as success_rate,
  ROUND(25 + RAND() * 15, 2) as cpu_usage,
  ROUND(20 + RAND() * 15, 2) as memory_usage,
  ROUND(0.06 + RAND() * 0.04, 2) as cost_per_run,
  ROUND(10 + RAND() * 20, 2) as bottleneck_score,
  1 as is_active
FROM companies c
WHERE c.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.company_id = c.id AND ps.name = 'Security Scan');

INSERT INTO pipeline_stages (company_id, team_id, name, stage_order, avg_duration_seconds, success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score, is_active)
SELECT 
  c.id as company_id,
  NULL as team_id,
  'Deploy to Staging' as name,
  5 as stage_order,
  FLOOR(45 + RAND() * 30) as avg_duration_seconds,
  ROUND(95 + RAND() * 4, 2) as success_rate,
  ROUND(35 + RAND() * 15, 2) as cpu_usage,
  ROUND(30 + RAND() * 15, 2) as memory_usage,
  ROUND(0.10 + RAND() * 0.05, 2) as cost_per_run,
  ROUND(15 + RAND() * 20, 2) as bottleneck_score,
  1 as is_active
FROM companies c
WHERE c.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.company_id = c.id AND ps.name = 'Deploy to Staging');

INSERT INTO pipeline_stages (company_id, team_id, name, stage_order, avg_duration_seconds, success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score, is_active)
SELECT 
  c.id as company_id,
  NULL as team_id,
  'E2E Tests' as name,
  6 as stage_order,
  FLOOR(350 + RAND() * 150) as avg_duration_seconds,
  ROUND(85 + RAND() * 8, 2) as success_rate,
  ROUND(75 + RAND() * 15, 2) as cpu_usage,
  ROUND(65 + RAND() * 15, 2) as memory_usage,
  ROUND(0.28 + RAND() * 0.15, 2) as cost_per_run,
  ROUND(55 + RAND() * 30, 2) as bottleneck_score,
  1 as is_active
FROM companies c
WHERE c.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.company_id = c.id AND ps.name = 'E2E Tests');

INSERT INTO pipeline_stages (company_id, team_id, name, stage_order, avg_duration_seconds, success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score, is_active)
SELECT 
  c.id as company_id,
  NULL as team_id,
  'Deploy to Prod' as name,
  7 as stage_order,
  FLOOR(35 + RAND() * 20) as avg_duration_seconds,
  ROUND(98 + RAND() * 1.8, 2) as success_rate,
  ROUND(30 + RAND() * 15, 2) as cpu_usage,
  ROUND(25 + RAND() * 15, 2) as memory_usage,
  ROUND(0.08 + RAND() * 0.05, 2) as cost_per_run,
  ROUND(10 + RAND() * 15, 2) as bottleneck_score,
  1 as is_active
FROM companies c
WHERE c.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.company_id = c.id AND ps.name = 'Deploy to Prod');

-- Create initial history snapshots for all stages
INSERT INTO pipeline_stage_history (stage_id, company_id, team_id, name, duration_seconds, success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score)
SELECT 
  ps.id,
  ps.company_id,
  ps.team_id,
  ps.name,
  ps.avg_duration_seconds,
  ps.success_rate,
  ps.cpu_usage,
  ps.memory_usage,
  ps.cost_per_run,
  ps.bottleneck_score
FROM pipeline_stages ps
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_stage_history psh 
  WHERE psh.stage_id = ps.id 
    AND DATE(psh.recorded_at) = CURDATE()
);

-- Log seeder run
INSERT INTO seeder_runs (seeder_name, records_affected, status)
SELECT 'pipeline_stages_initial', COUNT(*), 'success'
FROM pipeline_stages;
