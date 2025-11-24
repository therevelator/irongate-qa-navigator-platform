-- Verification Script for IronGate QA Navigator Seed Data
-- Run this to verify your database setup

USE irongate_qa;

SELECT '========================================' as '';
SELECT '🔍 DATABASE VERIFICATION REPORT' as '';
SELECT '========================================' as '';
SELECT '' as '';

-- 1. Count Summary
SELECT '📊 DATA SUMMARY' as '';
SELECT '----------------' as '';
SELECT CONCAT('Companies: ', COUNT(*)) as count FROM companies;
SELECT CONCAT('Departments: ', COUNT(*)) as count FROM departments;
SELECT CONCAT('Teams: ', COUNT(*)) as count FROM teams;
SELECT CONCAT('KPI Snapshots: ', COUNT(*)) as count FROM kpi_snapshots;
SELECT '' as '';

-- 2. Teams by Department
SELECT '🏢 TEAMS BY DEPARTMENT' as '';
SELECT '----------------------' as '';
SELECT 
    d.name as Department,
    COUNT(t.id) as Team_Count,
    ROUND(AVG(k.qa_score), 1) as Avg_QA_Score
FROM departments d
LEFT JOIN teams t ON d.id = t.department_id
LEFT JOIN kpi_snapshots k ON t.id = k.team_id
GROUP BY d.name
ORDER BY Avg_QA_Score DESC;
SELECT '' as '';

-- 3. Top Performing Teams
SELECT '⭐ TOP 5 PERFORMING TEAMS' as '';
SELECT '--------------------------' as '';
SELECT 
    t.name as Team,
    t.platform as Platform,
    d.name as Department,
    k.qa_score as QA_Score,
    k.status as Status,
    CONCAT(k.test_coverage, '%') as Test_Coverage,
    CONCAT(k.automation_coverage, '%') as Automation
FROM teams t
JOIN departments d ON t.department_id = d.id
JOIN kpi_snapshots k ON t.id = k.team_id
ORDER BY k.qa_score DESC
LIMIT 5;
SELECT '' as '';

-- 4. Teams Needing Attention
SELECT '⚠️  TEAMS NEEDING ATTENTION (QA Score < 75)' as '';
SELECT '-------------------------------------------' as '';
SELECT 
    t.name as Team,
    t.platform as Platform,
    d.name as Department,
    k.qa_score as QA_Score,
    k.status as Status,
    CONCAT(k.test_coverage, '%') as Test_Coverage,
    k.defect_density as Defect_Density
FROM teams t
JOIN departments d ON t.department_id = d.id
JOIN kpi_snapshots k ON t.id = k.team_id
WHERE k.qa_score < 75
ORDER BY k.qa_score ASC;
SELECT '' as '';

-- 5. Performance Distribution
SELECT '📈 QA SCORE DISTRIBUTION' as '';
SELECT '------------------------' as '';
SELECT 
    CASE 
        WHEN qa_score >= 90 THEN '🌟 Excellent (90+)'
        WHEN qa_score >= 85 THEN '⭐ High (85-89)'
        WHEN qa_score >= 75 THEN '✅ Good (75-84)'
        WHEN qa_score >= 65 THEN '⚠️  Fair (65-74)'
        ELSE '❌ Needs Work (<65)'
    END as Performance_Level,
    COUNT(*) as Team_Count,
    CONCAT(ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM kpi_snapshots), 1), '%') as Percentage
FROM kpi_snapshots
GROUP BY Performance_Level
ORDER BY MIN(qa_score) DESC;
SELECT '' as '';

-- 6. Key Metrics Overview
SELECT '📊 KEY METRICS OVERVIEW' as '';
SELECT '-----------------------' as '';
SELECT 
    CONCAT(ROUND(AVG(test_coverage), 1), '%') as Avg_Test_Coverage,
    CONCAT(ROUND(AVG(automation_coverage), 1), '%') as Avg_Automation,
    ROUND(AVG(defect_density), 2) as Avg_Defect_Density,
    ROUND(AVG(deployment_frequency_per_week), 1) as Avg_Deployments_Week,
    CONCAT(ROUND(AVG(system_availability), 2), '%') as Avg_Availability,
    ROUND(AVG(mttr_hours), 1) as Avg_MTTR_Hours
FROM kpi_snapshots;
SELECT '' as '';

-- 7. Platform Distribution
SELECT '💻 TEAMS BY PLATFORM' as '';
SELECT '--------------------' as '';
SELECT 
    platform as Platform,
    COUNT(*) as Team_Count,
    ROUND(AVG(k.qa_score), 1) as Avg_QA_Score
FROM teams t
LEFT JOIN kpi_snapshots k ON t.id = k.team_id
GROUP BY platform
ORDER BY Avg_QA_Score DESC;
SELECT '' as '';

-- 8. Deployment Frequency Leaders
SELECT '🚀 TOP DEPLOYMENT FREQUENCY' as '';
SELECT '----------------------------' as '';
SELECT 
    t.name as Team,
    k.deployment_frequency_per_week as Deployments_Per_Week,
    ROUND(k.lead_time_days, 1) as Lead_Time_Days,
    ROUND(k.mttr_hours, 1) as MTTR_Hours
FROM teams t
JOIN kpi_snapshots k ON t.id = k.team_id
ORDER BY k.deployment_frequency_per_week DESC
LIMIT 5;
SELECT '' as '';

-- 9. Test Coverage Champions
SELECT '🛡️  HIGHEST TEST COVERAGE' as '';
SELECT '-------------------------' as '';
SELECT 
    t.name as Team,
    CONCAT(k.test_coverage, '%') as Test_Coverage,
    CONCAT(k.automation_coverage, '%') as Automation,
    k.code_quality_score as Code_Quality
FROM teams t
JOIN kpi_snapshots k ON t.id = k.team_id
ORDER BY k.test_coverage DESC
LIMIT 5;
SELECT '' as '';

-- 10. System Reliability
SELECT '🔧 SYSTEM RELIABILITY METRICS' as '';
SELECT '------------------------------' as '';
SELECT 
    t.name as Team,
    CONCAT(k.system_availability, '%') as Availability,
    k.mtbf_hours as MTBF_Hours,
    k.infrastructure_failures as Failures,
    CONCAT(k.change_failure_rate, '%') as Change_Failure_Rate
FROM teams t
JOIN kpi_snapshots k ON t.id = k.team_id
ORDER BY k.system_availability DESC;
SELECT '' as '';

SELECT '========================================' as '';
SELECT '✅ VERIFICATION COMPLETE!' as '';
SELECT '========================================' as '';
SELECT '' as '';
SELECT 'Your database is ready to use! 🎉' as '';
SELECT 'Start the backend server: cd server && npm run dev' as '';
SELECT '' as '';
