-- =============================================================================
-- Seed: Business Impact Correlation Demo Data (12 Months)
-- Date: 2025-12-01
-- Description: Realistic time-series data showing correlation patterns
-- =============================================================================

-- First, get the first team ID (you can replace this with a specific team ID)
SET @team_id = (SELECT id FROM teams LIMIT 1);

-- If no team exists, this will fail - make sure you have at least one team
SELECT @team_id AS 'Using Team ID';

-- =============================================================================
-- QUALITY METRICS (X Variables) - Shows improving trend
-- =============================================================================

-- Delete existing data for this team (optional - comment out to append)
DELETE FROM business_impact_quality_metrics WHERE team_id = @team_id;

INSERT INTO business_impact_quality_metrics 
(id, team_id, month_year, test_coverage, defect_density, defect_escape_rate, 
 mttr_hours, deployment_frequency, lead_time_days, code_quality_score, change_failure_rate, manually_edited)
VALUES
-- 12 months ago (Dec 2024) - Starting point
(UUID(), @team_id, '2024-12', 62.5, 4.8, 18.2, 8.5, 4, 12.0, 65.0, 22.0, 1),
-- 11 months ago (Jan 2025)
(UUID(), @team_id, '2025-01', 64.0, 4.5, 17.5, 8.2, 5, 11.5, 66.5, 21.0, 1),
-- 10 months ago (Feb 2025)
(UUID(), @team_id, '2025-02', 65.5, 4.2, 16.8, 7.8, 5, 11.0, 68.0, 20.0, 1),
-- 9 months ago (Mar 2025)
(UUID(), @team_id, '2025-03', 68.0, 3.9, 15.5, 7.2, 6, 10.0, 70.0, 18.5, 1),
-- 8 months ago (Apr 2025)
(UUID(), @team_id, '2025-04', 70.5, 3.6, 14.2, 6.8, 7, 9.5, 72.5, 17.0, 1),
-- 7 months ago (May 2025)
(UUID(), @team_id, '2025-05', 72.0, 3.4, 13.5, 6.5, 8, 9.0, 74.0, 16.0, 1),
-- 6 months ago (Jun 2025)
(UUID(), @team_id, '2025-06', 74.5, 3.1, 12.8, 6.0, 9, 8.5, 76.0, 15.0, 1),
-- 5 months ago (Jul 2025)
(UUID(), @team_id, '2025-07', 76.0, 2.9, 11.5, 5.5, 10, 8.0, 78.0, 14.0, 1),
-- 4 months ago (Aug 2025)
(UUID(), @team_id, '2025-08', 78.5, 2.6, 10.2, 5.0, 11, 7.5, 80.0, 12.5, 1),
-- 3 months ago (Sep 2025)
(UUID(), @team_id, '2025-09', 80.0, 2.4, 9.5, 4.5, 12, 7.0, 82.0, 11.0, 1),
-- 2 months ago (Oct 2025)
(UUID(), @team_id, '2025-10', 82.5, 2.2, 8.8, 4.0, 14, 6.5, 84.0, 10.0, 1),
-- 1 month ago (Nov 2025)
(UUID(), @team_id, '2025-11', 85.0, 2.0, 8.0, 3.5, 16, 6.0, 86.0, 9.0, 1);

-- =============================================================================
-- BUSINESS KPIs (Y Variables) - Shows correlated improvement
-- =============================================================================

DELETE FROM business_impact_business_kpis WHERE team_id = @team_id;

INSERT INTO business_impact_business_kpis
(id, team_id, month_year, monthly_revenue, active_users, churn_rate, 
 feature_adoption_rate, nps_score, csat_score, support_ticket_volume, manually_edited)
VALUES
-- 12 months ago - Lower metrics
(UUID(), @team_id, '2024-12', 420000, 12500, 6.8, 42.0, 28, 68.0, 485, 1),
-- 11 months ago
(UUID(), @team_id, '2025-01', 435000, 13200, 6.5, 44.0, 30, 69.5, 470, 1),
-- 10 months ago
(UUID(), @team_id, '2025-02', 455000, 14100, 6.2, 46.5, 33, 71.0, 455, 1),
-- 9 months ago
(UUID(), @team_id, '2025-03', 480000, 15200, 5.8, 49.0, 36, 72.5, 435, 1),
-- 8 months ago
(UUID(), @team_id, '2025-04', 510000, 16500, 5.4, 52.0, 40, 74.0, 415, 1),
-- 7 months ago
(UUID(), @team_id, '2025-05', 545000, 17800, 5.0, 55.5, 44, 75.5, 390, 1),
-- 6 months ago
(UUID(), @team_id, '2025-06', 585000, 19200, 4.6, 58.0, 48, 77.0, 365, 1),
-- 5 months ago
(UUID(), @team_id, '2025-07', 625000, 20800, 4.2, 61.5, 52, 78.5, 340, 1),
-- 4 months ago
(UUID(), @team_id, '2025-08', 670000, 22500, 3.8, 65.0, 56, 80.0, 310, 1),
-- 3 months ago
(UUID(), @team_id, '2025-09', 720000, 24500, 3.5, 68.5, 60, 81.5, 285, 1),
-- 2 months ago
(UUID(), @team_id, '2025-10', 775000, 26800, 3.2, 72.0, 64, 83.0, 260, 1),
-- 1 month ago - Highest metrics
(UUID(), @team_id, '2025-11', 835000, 29500, 2.8, 76.0, 68, 85.0, 235, 1);

-- =============================================================================
-- CONTEXT DATA - Normalization factors
-- =============================================================================

DELETE FROM business_impact_context WHERE team_id = @team_id;

INSERT INTO business_impact_context
(id, team_id, month_year, team_size, sprint_length_days, feature_release_count,
 total_user_base, user_growth_rate, downtime_minutes, is_holiday_season, manually_edited)
VALUES
-- 12 months ago
(UUID(), @team_id, '2024-12', 8, 14, 2, 45000, 2.5, 120, 1, 1),
-- 11 months ago
(UUID(), @team_id, '2025-01', 8, 14, 3, 46500, 3.3, 95, 0, 1),
-- 10 months ago
(UUID(), @team_id, '2025-02', 9, 14, 3, 48200, 3.7, 85, 0, 1),
-- 9 months ago
(UUID(), @team_id, '2025-03', 9, 14, 4, 50500, 4.8, 70, 0, 1),
-- 8 months ago
(UUID(), @team_id, '2025-04', 10, 14, 4, 53200, 5.3, 55, 0, 1),
-- 7 months ago
(UUID(), @team_id, '2025-05', 10, 14, 5, 56500, 6.2, 45, 0, 1),
-- 6 months ago
(UUID(), @team_id, '2025-06', 11, 14, 5, 60200, 6.5, 35, 0, 1),
-- 5 months ago
(UUID(), @team_id, '2025-07', 11, 14, 6, 64500, 7.1, 30, 0, 1),
-- 4 months ago
(UUID(), @team_id, '2025-08', 12, 14, 6, 69500, 7.8, 25, 0, 1),
-- 3 months ago
(UUID(), @team_id, '2025-09', 12, 14, 7, 75200, 8.2, 20, 0, 1),
-- 2 months ago
(UUID(), @team_id, '2025-10', 13, 14, 8, 82000, 9.0, 15, 0, 1),
-- 1 month ago
(UUID(), @team_id, '2025-11', 14, 14, 9, 90000, 9.8, 10, 0, 1);

-- =============================================================================
-- UPDATE DATA STATUS
-- =============================================================================

DELETE FROM business_impact_data_status WHERE team_id = @team_id;

INSERT INTO business_impact_data_status
(id, team_id, months_with_quality_data, months_with_kpi_data, months_with_paired_data,
 earliest_month, latest_month, is_correlation_ready, last_validated_at)
VALUES
(UUID(), @team_id, 12, 12, 12, '2024-12', '2025-11', 1, NOW());

-- =============================================================================
-- VERIFY SEED DATA
-- =============================================================================

SELECT 'Quality Metrics Seeded:' AS status, COUNT(*) AS count 
FROM business_impact_quality_metrics WHERE team_id = @team_id;

SELECT 'Business KPIs Seeded:' AS status, COUNT(*) AS count 
FROM business_impact_business_kpis WHERE team_id = @team_id;

SELECT 'Context Data Seeded:' AS status, COUNT(*) AS count 
FROM business_impact_context WHERE team_id = @team_id;

-- Show sample of the data
SELECT 'Sample Quality Data:' AS info;
SELECT month_year, test_coverage, defect_density, defect_escape_rate, mttr_hours, code_quality_score
FROM business_impact_quality_metrics 
WHERE team_id = @team_id 
ORDER BY month_year DESC LIMIT 3;

SELECT 'Sample Business KPIs:' AS info;
SELECT month_year, monthly_revenue, active_users, churn_rate, nps_score, feature_adoption_rate
FROM business_impact_business_kpis 
WHERE team_id = @team_id 
ORDER BY month_year DESC LIMIT 3;
