-- Seed realistic business impact data for Alpha Team
-- Team ID: 971925bf-6cbd-4cb9-b75b-41bd81d44824

-- Delete existing data for this team first
DELETE FROM business_impact_quality_metrics WHERE team_id = '971925bf-6cbd-4cb9-b75b-41bd81d44824';
DELETE FROM business_impact_business_kpis WHERE team_id = '971925bf-6cbd-4cb9-b75b-41bd81d44824';
DELETE FROM business_impact_context WHERE team_id = '971925bf-6cbd-4cb9-b75b-41bd81d44824';
DELETE FROM business_impact_correlations WHERE team_id = '971925bf-6cbd-4cb9-b75b-41bd81d44824';

-- Insert Quality Metrics (12 months of realistic data)
INSERT INTO business_impact_quality_metrics (id, team_id, month_year, test_coverage, defect_density, defect_escape_rate, mttr_hours, deployment_frequency, lead_time_days, code_quality_score, change_failure_rate, manually_edited, created_at, updated_at) VALUES
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2024-12', 67.2, 4.8, 22.5, 8.2, 4, 14, 71.3, 24.5, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-01', 69.5, 4.5, 21.0, 7.8, 5, 13, 72.8, 23.0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-02', 71.8, 4.2, 19.5, 7.5, 5, 12, 74.2, 21.5, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-03', 73.2, 3.9, 18.0, 7.0, 6, 11, 75.5, 20.0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-04', 74.8, 3.7, 17.2, 6.8, 6, 11, 76.8, 18.5, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-05', 76.5, 3.4, 15.8, 6.5, 7, 10, 78.2, 17.0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-06', 78.0, 3.2, 14.5, 6.2, 7, 10, 79.5, 15.5, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-07', 79.2, 3.0, 13.8, 5.8, 8, 9, 80.8, 14.2, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-08', 80.5, 2.8, 12.5, 5.5, 8, 9, 82.0, 13.0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-09', 81.8, 2.6, 11.2, 5.2, 9, 8, 83.2, 11.8, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-10', 83.0, 2.4, 10.0, 4.8, 10, 8, 84.5, 10.5, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-11', 84.5, 2.2, 9.0, 4.5, 11, 7, 85.8, 9.2, 0, NOW(), NOW());

-- Insert Business KPIs (12 months of realistic data)
INSERT INTO business_impact_business_kpis (id, team_id, month_year, monthly_revenue, active_users, churn_rate, feature_adoption_rate, nps_score, csat_score, support_ticket_volume, manually_edited, created_at, updated_at) VALUES
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2024-12', 385000, 12500, 7.2, 38.5, 28, 68.5, 620, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-01', 398000, 13200, 6.8, 40.2, 32, 70.2, 590, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-02', 412000, 14100, 6.5, 42.8, 35, 71.8, 565, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-03', 428000, 15000, 6.2, 44.5, 38, 73.5, 540, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-04', 445000, 15800, 5.8, 46.8, 42, 75.0, 510, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-05', 462000, 16700, 5.5, 48.5, 45, 76.5, 485, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-06', 480000, 17500, 5.2, 50.2, 48, 78.0, 460, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-07', 498000, 18400, 4.8, 52.5, 52, 79.5, 435, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-08', 518000, 19200, 4.5, 54.8, 55, 81.0, 410, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-09', 538000, 20100, 4.2, 56.5, 58, 82.5, 385, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-10', 560000, 21000, 3.8, 58.8, 62, 84.0, 360, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-11', 582000, 22000, 3.5, 61.2, 65, 85.5, 340, 0, NOW(), NOW());

-- Insert Context Data (12 months)
INSERT INTO business_impact_context (id, team_id, month_year, team_size, sprint_length_days, feature_release_count, total_user_base, user_growth_rate, downtime_minutes, is_holiday_season, manually_edited, created_at, updated_at) VALUES
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2024-12', 8, 14, 3, 42000, 5.2, 145, 1, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-01', 8, 14, 2, 44100, 5.0, 130, 0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-02', 9, 14, 3, 46400, 5.2, 120, 0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-03', 9, 14, 4, 48800, 5.2, 110, 0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-04', 9, 14, 3, 51200, 4.9, 100, 0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-05', 10, 14, 4, 53800, 5.1, 90, 0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-06', 10, 14, 4, 56500, 5.0, 85, 0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-07', 10, 14, 5, 59200, 4.8, 75, 0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-08', 11, 14, 4, 62000, 4.7, 65, 0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-09', 11, 14, 5, 65000, 4.8, 55, 0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-10', 12, 14, 5, 68200, 4.9, 45, 0, 0, NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', '2025-11', 12, 14, 6, 71600, 5.0, 40, 0, 0, NOW(), NOW());

-- Insert pre-calculated correlations (realistic values between 0.3 and 0.8)
INSERT INTO business_impact_correlations (id, team_id, quality_metric, business_kpi, pearson_correlation, p_value, sample_size, correlation_strength, is_significant, start_month, end_month, created_at, updated_at) VALUES
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'test_coverage', 'monthly_revenue', 0.72, 0.008, 12, 'strong', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'test_coverage', 'active_users', 0.68, 0.015, 12, 'moderate', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'test_coverage', 'churn_rate', -0.65, 0.022, 12, 'moderate', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'test_coverage', 'nps_score', 0.71, 0.010, 12, 'strong', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'test_coverage', 'csat_score', 0.74, 0.006, 12, 'strong', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'test_coverage', 'support_ticket_volume', -0.69, 0.013, 12, 'moderate', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'defect_density', 'monthly_revenue', -0.58, 0.048, 12, 'moderate', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'defect_density', 'churn_rate', 0.62, 0.032, 12, 'moderate', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'defect_density', 'nps_score', -0.55, 0.064, 12, 'moderate', 0, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'defect_density', 'support_ticket_volume', 0.67, 0.018, 12, 'moderate', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'defect_escape_rate', 'monthly_revenue', -0.63, 0.028, 12, 'moderate', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'defect_escape_rate', 'churn_rate', 0.70, 0.011, 12, 'strong', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'defect_escape_rate', 'csat_score', -0.66, 0.020, 12, 'moderate', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'mttr_hours', 'csat_score', -0.52, 0.082, 12, 'moderate', 0, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'mttr_hours', 'nps_score', -0.48, 0.115, 12, 'weak', 0, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'code_quality_score', 'monthly_revenue', 0.75, 0.005, 12, 'strong', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'code_quality_score', 'active_users', 0.64, 0.025, 12, 'moderate', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'code_quality_score', 'churn_rate', -0.61, 0.035, 12, 'moderate', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'deployment_frequency', 'feature_adoption_rate', 0.58, 0.048, 12, 'moderate', 1, '2024-12', '2025-11', NOW(), NOW()),
(UUID(), '971925bf-6cbd-4cb9-b75b-41bd81d44824', 'change_failure_rate', 'churn_rate', 0.54, 0.070, 12, 'moderate', 0, '2024-12', '2025-11', NOW(), NOW());
