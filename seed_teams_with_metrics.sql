-- Comprehensive Seed Data with Metrics for IronGate QA Navigator
-- Run this after schema.sql

USE irongate_qa;

-- ============================================================================
-- CLEAR EXISTING DATA (for re-seeding)
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE kpi_snapshots;
TRUNCATE TABLE team_members;
TRUNCATE TABLE teams;
TRUNCATE TABLE departments;
TRUNCATE TABLE companies;
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- COMPANY
-- ============================================================================

INSERT INTO companies (id, name, domain, is_active) 
VALUES ('company-mastercard', 'Mastercard', 'mastercard.com', true);

-- ============================================================================
-- DEPARTMENTS
-- ============================================================================

INSERT INTO departments (id, company_id, name, description, is_active) VALUES
('dept-decision-mgmt', 'company-mastercard', 'Decision Management', 'AI-powered decision management and fraud detection', true),
('dept-payments', 'company-mastercard', 'Payments Processing', 'Core payment processing and transaction management', true),
('dept-security', 'company-mastercard', 'Security & Compliance', 'Security, fraud prevention, and regulatory compliance', true),
('dept-digital', 'company-mastercard', 'Digital Products', 'Mobile apps, web portals, and digital experiences', true);

-- ============================================================================
-- TEAMS
-- ============================================================================

-- Decision Management Teams
INSERT INTO teams (id, company_id, department_id, name, description, platform, is_active) VALUES
('team-nebula', 'company-mastercard', 'dept-decision-mgmt', 'Nebula', 'AI/ML decision engine development', 'Backend', true),
('team-voyagers', 'company-mastercard', 'dept-decision-mgmt', 'Voyagers', 'Real-time decision processing', 'API', true),
('team-sentinels', 'company-mastercard', 'dept-decision-mgmt', 'Sentinels', 'Monitoring and alerting systems', 'DevOps', true),
('team-pioneers', 'company-mastercard', 'dept-decision-mgmt', 'Pioneers', 'Exploration and innovation team', 'Web', true),
('team-horizon', 'company-mastercard', 'dept-decision-mgmt', 'Horizon', 'Data analytics and insights', 'Backend', true),
('team-atlas', 'company-mastercard', 'dept-decision-mgmt', 'Atlas', 'Infrastructure and platform services', 'DevOps', true);

-- Payments Teams
INSERT INTO teams (id, company_id, department_id, name, description, platform, is_active) VALUES
('team-nexus', 'company-mastercard', 'dept-payments', 'Nexus', 'Core payment processing engine', 'Backend', true),
('team-ledger', 'company-mastercard', 'dept-payments', 'Ledger', 'Transaction settlement and reconciliation', 'Backend', true),
('team-portal', 'company-mastercard', 'dept-payments', 'Portal', 'Payment gateway and API services', 'API', true);

-- Security Teams
INSERT INTO teams (id, company_id, department_id, name, description, platform, is_active) VALUES
('team-guardians', 'company-mastercard', 'dept-security', 'Guardians', 'Real-time fraud detection and prevention', 'Backend', true),
('team-vanguard', 'company-mastercard', 'dept-security', 'Vanguard', 'Regulatory compliance and audit', 'Security', true);

-- Digital Teams
INSERT INTO teams (id, company_id, department_id, name, description, platform, is_active) VALUES
('team-catalyst-ios', 'company-mastercard', 'dept-digital', 'Catalyst iOS', 'iOS mobile application', 'Mobile', true),
('team-catalyst-android', 'company-mastercard', 'dept-digital', 'Catalyst Android', 'Android mobile application', 'Mobile', true),
('team-zenith', 'company-mastercard', 'dept-digital', 'Zenith', 'Customer web portal', 'Web', true);

-- ============================================================================
-- KPI SNAPSHOTS (Latest data for each team)
-- ============================================================================

-- Nebula Team (High Performer - Backend)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density, 
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-nebula', CURDATE(), 96.5, 2.1, 0.18, 1.2, 92, 12, 45,
  8, 2.3, 1.8, 87.5, 65, 94.2, 8.5, 91.3,
  12, 94.8, 285.5, 2.1, 720, 99.95, 2, 92, 'good'
);

-- Voyagers Team (High Performer - API)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-voyagers', CURDATE(), 94.2, 3.5, 0.21, 1.8, 89, 10, 38,
  10, 1.9, 2.2, 82.3, 58, 91.5, 12.3, 88.7,
  15, 92.3, 265.8, 3.2, 650, 99.92, 3, 88, 'good'
);

-- Sentinels Team (Good - DevOps)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-sentinels', CURDATE(), 91.8, 4.2, 0.28, 2.5, 85, 15, 52,
  6, 3.1, 2.8, 78.9, 52, 87.3, 15.8, 84.2,
  20, 89.5, 245.2, 4.1, 580, 99.88, 5, 82, 'good'
);

-- Pioneers Team (Warning - Web)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-pioneers', CURDATE(), 78.5, 8.5, 0.45, 4.2, 72, 22, 68,
  4, 5.2, 4.5, 65.3, 42, 76.8, 28.5, 71.5,
  35, 76.2, 185.3, 7.8, 420, 99.65, 12, 68, 'warning'
);

-- Horizon Team (Good - Backend)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-horizon', CURDATE(), 93.2, 3.8, 0.24, 2.1, 87, 14, 48,
  7, 2.8, 2.5, 81.2, 55, 89.5, 13.2, 86.8,
  18, 90.8, 255.7, 3.5, 620, 99.90, 4, 85, 'good'
);

-- Atlas Team (High Performer - DevOps)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-atlas', CURDATE(), 95.8, 2.5, 0.19, 1.5, 91, 11, 42,
  9, 2.1, 1.9, 85.8, 62, 93.2, 9.8, 90.5,
  14, 93.5, 275.3, 2.5, 700, 99.94, 2, 90, 'good'
);

-- Nexus Team (High Performer - Backend Payment)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-nexus', CURDATE(), 97.2, 1.8, 0.15, 0.9, 94, 10, 40,
  10, 1.8, 1.5, 89.2, 68, 95.8, 7.2, 93.5,
  10, 96.2, 295.8, 1.8, 780, 99.97, 1, 94, 'good'
);

-- Ledger Team (Good - Backend)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-ledger', CURDATE(), 92.5, 3.2, 0.22, 1.9, 88, 13, 46,
  7, 2.5, 2.3, 83.5, 57, 90.2, 11.8, 87.5,
  16, 91.5, 260.5, 3.0, 640, 99.91, 3, 86, 'good'
);

-- Portal Team (Good - API)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-portal', CURDATE(), 93.8, 3.0, 0.20, 1.7, 89, 11, 43,
  8, 2.2, 2.1, 84.8, 60, 91.8, 10.5, 89.2,
  14, 92.8, 268.5, 2.8, 670, 99.93, 3, 87, 'good'
);

-- Guardians Team (High Performer - Security)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-guardians', CURDATE(), 96.8, 2.2, 0.17, 1.1, 93, 11, 44,
  9, 2.0, 1.7, 88.5, 64, 94.5, 8.8, 92.3,
  11, 95.5, 288.2, 2.0, 750, 99.96, 1, 93, 'good'
);

-- Vanguard Team (Good - Security/Compliance)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-vanguard', CURDATE(), 90.5, 4.5, 0.26, 2.3, 84, 16, 50,
  6, 3.2, 2.9, 79.8, 50, 88.5, 14.5, 85.8,
  19, 88.8, 248.5, 3.8, 600, 99.89, 4, 83, 'good'
);

-- Catalyst iOS Team (Warning - Mobile)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-catalyst-ios', CURDATE(), 82.3, 6.8, 0.38, 3.5, 76, 20, 62,
  5, 4.5, 3.8, 70.5, 45, 81.2, 22.5, 76.8,
  28, 80.5, 205.8, 5.8, 480, 99.75, 9, 73, 'warning'
);

-- Catalyst Android Team (Warning - Mobile)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-catalyst-android', CURDATE(), 80.8, 7.2, 0.42, 3.8, 74, 21, 65,
  4, 4.8, 4.2, 68.2, 43, 79.5, 24.8, 74.2,
  32, 78.8, 195.5, 6.5, 450, 99.72, 10, 71, 'warning'
);

-- Zenith Team (Good - Web)
INSERT INTO kpi_snapshots (
  team_id, snapshot_date, test_coverage, test_flakiness_rate, defect_density,
  defect_escape_rate, code_quality_score, avg_build_time_minutes, test_execution_time_minutes,
  deployment_frequency_per_week, lead_time_days, mttr_hours, parallel_test_efficiency,
  sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
  blocked_time_hours, automation_coverage, automation_roi, change_failure_rate,
  mtbf_hours, system_availability, infrastructure_failures, qa_score, status
) VALUES (
  'team-zenith', CURDATE(), 89.5, 4.8, 0.29, 2.6, 82, 17, 54,
  6, 3.5, 3.2, 76.5, 48, 86.8, 16.5, 83.5,
  22, 87.5, 238.8, 4.5, 560, 99.85, 6, 80, 'good'
);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'Seed data with metrics inserted successfully!' as message;
SELECT COUNT(*) as team_count FROM teams;
SELECT COUNT(*) as kpi_snapshot_count FROM kpi_snapshots;

-- Show all teams with their latest QA scores
SELECT 
    t.name as team_name,
    t.platform,
    d.name as department,
    k.qa_score,
    k.status,
    k.test_coverage,
    k.defect_density,
    k.automation_coverage
FROM teams t
JOIN departments d ON t.department_id = d.id
LEFT JOIN kpi_snapshots k ON t.id = k.team_id
ORDER BY k.qa_score DESC;
