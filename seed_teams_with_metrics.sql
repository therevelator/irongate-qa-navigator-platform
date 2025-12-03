/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

-- IronGate QA Navigator - Teams with KPI Metrics Seed Data
-- This file seeds 14 teams with comprehensive KPI data
-- ⚠️  WARNING: This file does NOT delete existing data!
-- ⚠️  Existing teams and manually edited data are PRESERVED.

USE irongate_qa;

-- NOTE: We use INSERT IGNORE to add only NEW records
-- Existing teams and data will NOT be modified or deleted

-- Insert companies (IGNORE if already exists)
INSERT IGNORE INTO companies (id, name, domain, logo_url, settings, created_at, updated_at, is_active) VALUES
('novatech','Mastercard','mastercard.com',NULL,NULL,NOW(),NOW(),1);

-- Insert departments (IGNORE if already exists)
INSERT IGNORE INTO departments (id, company_id, name, description, manager_id, created_at, updated_at, is_active) VALUES
('dept-decision-mgmt','novatech','Decision Management','AI-powered decision management and fraud detection',NULL,NOW(),NOW(),1),
('dept-payments','novatech','Payments Processing','Core payment processing and transaction management',NULL,NOW(),NOW(),1),
('dept-security','novatech','Security & Compliance','Security, fraud prevention, and regulatory compliance',NULL,NOW(),NOW(),1),
('dept-digital','novatech','Digital Products','Mobile apps, web portals, and digital experiences',NULL,NOW(),NOW(),1);

-- Insert teams (IGNORE if already exists)
INSERT IGNORE INTO teams (id, company_id, department_id, name, description, lead_id, platform, created_at, updated_at, is_active) VALUES
-- Decision Management Department (6 teams)
('team-nebula','novatech','dept-decision-mgmt','Nebula','AI/ML decision engine','user-1','backend',NOW(),NOW(),1),
('team-voyagers','novatech','dept-decision-mgmt','Voyagers','Real-time decision processing','user-2','api',NOW(),NOW(),1),
('team-sentinels','novatech','dept-decision-mgmt','Sentinels','Monitoring and alerting','user-3','devops',NOW(),NOW(),1),
('team-pioneers','novatech','dept-decision-mgmt','Pioneers','Exploration and innovation','user-4','web',NOW(),NOW(),1),
('team-horizon','novatech','dept-decision-mgmt','Horizon','Data analytics','user-5','backend',NOW(),NOW(),1),
('team-atlas','novatech','dept-decision-mgmt','Atlas','Infrastructure services','user-6','devops',NOW(),NOW(),1),

-- Payments Processing Department (3 teams)
('team-nexus','novatech','dept-payments','Nexus','Core payment processing','user-7','backend',NOW(),NOW(),1),
('team-ledger','novatech','dept-payments','Ledger','Transaction settlement','user-8','backend',NOW(),NOW(),1),
('team-portal','novatech','dept-payments','Portal','Payment gateway','user-9','api',NOW(),NOW(),1),

-- Security & Compliance Department (2 teams)
('team-guardians','novatech','dept-security','Guardians','Fraud detection','user-10','backend',NOW(),NOW(),1),
('team-vanguard','novatech','dept-security','Vanguard','Regulatory compliance','user-11','security',NOW(),NOW(),1),

-- Digital Products Department (3 teams)
('team-catalyst-ios','novatech','dept-digital','Catalyst iOS','iOS mobile app','user-12','mobile',NOW(),NOW(),1),
('team-catalyst-android','novatech','dept-digital','Catalyst Android','Android mobile app','user-13','mobile',NOW(),NOW(),1),
('team-zenith','novatech','dept-digital','Zenith','Customer web portal','user-14','web',NOW(),NOW(),1);

-- Insert KPI snapshots for each team (IGNORE if already exists)
INSERT IGNORE INTO kpi_snapshots (
  team_id, snapshot_date, qa_score, status,
  test_coverage, test_flakiness_rate, defect_density, defect_escape_rate, code_quality_score,
  avg_build_time_minutes, test_execution_time_minutes, deployment_frequency_per_week, lead_time_days,
  mttr_hours, parallel_test_efficiency, sprint_velocity, sprint_commitment_rate, sprint_carryover,
  first_time_pass_rate, blocked_time_hours, automation_coverage, automation_roi,
  change_failure_rate, mtbf_hours, system_availability, infrastructure_failures
) VALUES
-- Decision Management Department
('team-nebula', NOW(), 92, 'good', 97.2, 1.8, 0.15, 0.9, 94, 10, 38, 10, 1.8, 1.5, 89, 68, 96, 7, 93, 10, 96, 295, 1.8, 780, 99.97, 1),
('team-voyagers', NOW(), 88, 'good', 94.5, 2.1, 0.18, 1.2, 91, 11, 42, 9, 2.1, 1.8, 87, 65, 94, 9, 91, 12, 94, 285, 2.1, 750, 99.95, 2),
('team-sentinels', NOW(), 82, 'good', 89.8, 2.8, 0.22, 1.5, 87, 13, 48, 7, 2.8, 2.2, 82, 58, 91, 12, 87, 15, 89, 265, 2.8, 700, 99.92, 3),
('team-pioneers', NOW(), 68, 'warning', 82.1, 4.2, 0.38, 2.8, 78, 18, 62, 5, 4.2, 3.5, 72, 45, 82, 18, 78, 22, 81, 195, 4.2, 580, 99.78, 6),
('team-horizon', NOW(), 85, 'good', 91.3, 2.5, 0.20, 1.3, 88, 12, 45, 8, 2.5, 2.0, 85, 62, 92, 11, 88, 14, 91, 275, 2.5, 720, 99.93, 2),
('team-atlas', NOW(), 90, 'good', 95.7, 2.0, 0.16, 1.1, 92, 11, 40, 9, 2.0, 1.7, 88, 66, 95, 8, 92, 11, 93, 290, 2.0, 760, 99.96, 1),

-- Payments Processing Department
('team-nexus', NOW(), 94, 'good', 98.1, 1.5, 0.12, 0.8, 95, 9, 35, 11, 1.5, 1.3, 91, 70, 97, 6, 95, 9, 97, 305, 1.5, 800, 99.98, 1),
('team-ledger', NOW(), 86, 'good', 92.8, 2.3, 0.19, 1.4, 89, 12, 44, 8, 2.3, 1.9, 86, 63, 93, 10, 89, 13, 92, 280, 2.3, 730, 99.94, 2),
('team-portal', NOW(), 87, 'good', 93.5, 2.2, 0.18, 1.3, 90, 11, 41, 8, 2.2, 1.8, 87, 64, 93, 9, 90, 12, 93, 285, 2.2, 740, 99.95, 2),

-- Security & Compliance Department
('team-guardians', NOW(), 93, 'good', 96.8, 1.9, 0.14, 1.0, 93, 10, 39, 10, 1.9, 1.6, 90, 67, 96, 7, 93, 10, 95, 295, 1.9, 770, 99.97, 1),
('team-vanguard', NOW(), 83, 'good', 90.2, 2.7, 0.21, 1.6, 86, 14, 50, 7, 2.7, 2.3, 83, 59, 90, 13, 86, 16, 88, 260, 2.7, 690, 99.91, 3),

-- Digital Products Department
('team-catalyst-ios', NOW(), 73, 'warning', 84.5, 3.8, 0.35, 2.5, 80, 16, 58, 6, 3.8, 3.2, 75, 48, 85, 16, 80, 20, 84, 210, 3.8, 610, 99.82, 5),
('team-catalyst-android', NOW(), 71, 'warning', 83.2, 4.1, 0.37, 2.7, 79, 17, 60, 5, 4.1, 3.4, 73, 46, 83, 17, 79, 21, 82, 200, 4.1, 590, 99.79, 6),
('team-zenith', NOW(), 80, 'good', 88.9, 3.0, 0.25, 1.8, 84, 15, 52, 7, 3.0, 2.5, 79, 55, 88, 14, 84, 17, 86, 240, 3.0, 660, 99.88, 4);

SELECT '✅ Seed data inserted successfully!' as status;
SELECT '📊 Teams created: 14' as summary;
SELECT '📈 KPI snapshots created: 14' as metrics;
SELECT '🎯 Ready for dashboard!' as next_step;
