-- MySQL dump 10.13  Distrib 9.3.0, for macos14.7 (arm64)
--
-- Host: localhost    Database: irongate_qa
-- ------------------------------------------------------
-- Server version	9.0.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `business_metrics`
--

DROP TABLE IF EXISTS `business_metrics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `business_metrics` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `metric_date` date NOT NULL,
  `revenue` decimal(15,2) DEFAULT NULL,
  `mrr` decimal(15,2) DEFAULT NULL,
  `arr` decimal(15,2) DEFAULT NULL,
  `customer_satisfaction_nps` int DEFAULT NULL,
  `customer_satisfaction_csat` decimal(5,2) DEFAULT NULL,
  `churn_rate` decimal(5,2) DEFAULT NULL,
  `feature_adoption_rate` decimal(5,2) DEFAULT NULL,
  `support_ticket_volume` int DEFAULT NULL,
  `user_engagement_score` decimal(5,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_company_metric_date` (`company_id`,`metric_date`),
  KEY `idx_business_metrics_company` (`company_id`,`metric_date` DESC),
  CONSTRAINT `business_metrics_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `business_metrics`
--

LOCK TABLES `business_metrics` WRITE;
/*!40000 ALTER TABLE `business_metrics` DISABLE KEYS */;
/*!40000 ALTER TABLE `business_metrics` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `companies`
--

DROP TABLE IF EXISTS `companies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `companies` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `domain` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `logo_url` text COLLATE utf8mb4_unicode_ci,
  `settings` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_active` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `domain` (`domain`),
  KEY `idx_companies_domain` (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `companies`
--

LOCK TABLES `companies` WRITE;
/*!40000 ALTER TABLE `companies` DISABLE KEYS */;
INSERT INTO `companies` VALUES ('company-mastercard','Mastercard','mastercard.com',NULL,NULL,'2025-11-24 23:13:09','2025-11-24 23:13:09',1);
/*!40000 ALTER TABLE `companies` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `departments`
--

DROP TABLE IF EXISTS `departments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `departments` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `manager_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_active` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_dept_per_company` (`company_id`,`name`),
  KEY `idx_departments_company` (`company_id`),
  KEY `idx_departments_manager` (`manager_id`),
  CONSTRAINT `departments_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `departments_ibfk_2` FOREIGN KEY (`manager_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `departments_ibfk_3` FOREIGN KEY (`manager_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `departments`
--

LOCK TABLES `departments` WRITE;
/*!40000 ALTER TABLE `departments` DISABLE KEYS */;
INSERT INTO `departments` VALUES ('dept-decision-mgmt','company-mastercard','Decision Management','AI-powered decision management and fraud detection',NULL,'2025-11-24 23:13:09','2025-11-24 23:13:09',1),('dept-digital','company-mastercard','Digital Products','Mobile apps, web portals, and digital experiences',NULL,'2025-11-24 23:13:09','2025-11-24 23:13:09',1),('dept-payments','company-mastercard','Payments Processing','Core payment processing and transaction management',NULL,'2025-11-24 23:13:09','2025-11-24 23:13:09',1),('dept-security','company-mastercard','Security & Compliance','Security, fraud prevention, and regulatory compliance',NULL,'2025-11-24 23:13:09','2025-11-24 23:13:09',1);
/*!40000 ALTER TABLE `departments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kpi_snapshots`
--

DROP TABLE IF EXISTS `kpi_snapshots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_snapshots` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `team_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `snapshot_date` date NOT NULL,
  `test_coverage` decimal(5,2) DEFAULT NULL,
  `test_flakiness_rate` decimal(5,2) DEFAULT NULL,
  `defect_density` decimal(6,3) DEFAULT NULL,
  `defect_escape_rate` decimal(5,2) DEFAULT NULL,
  `code_quality_score` int DEFAULT NULL,
  `avg_build_time_minutes` int DEFAULT NULL,
  `test_execution_time_minutes` int DEFAULT NULL,
  `deployment_frequency_per_week` int DEFAULT NULL,
  `lead_time_days` decimal(4,2) DEFAULT NULL,
  `mttr_hours` decimal(6,2) DEFAULT NULL,
  `parallel_test_efficiency` decimal(5,2) DEFAULT NULL,
  `sprint_velocity` int DEFAULT NULL,
  `sprint_commitment_rate` decimal(5,2) DEFAULT NULL,
  `sprint_carryover` decimal(5,2) DEFAULT NULL,
  `first_time_pass_rate` decimal(5,2) DEFAULT NULL,
  `blocked_time_hours` int DEFAULT NULL,
  `automation_coverage` decimal(5,2) DEFAULT NULL,
  `automation_roi` decimal(6,2) DEFAULT NULL,
  `change_failure_rate` decimal(5,2) DEFAULT NULL,
  `mtbf_hours` int DEFAULT NULL,
  `system_availability` decimal(5,3) DEFAULT NULL,
  `infrastructure_failures` int DEFAULT NULL,
  `qa_score` int DEFAULT NULL,
  `status` enum('good','warning','critical') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_team_snapshot_date` (`team_id`,`snapshot_date`),
  KEY `idx_kpi_snapshots_team_date` (`team_id`,`snapshot_date` DESC),
  KEY `idx_kpi_snapshots_date` (`snapshot_date` DESC),
  KEY `idx_kpi_snapshots_status` (`status`),
  CONSTRAINT `kpi_snapshots_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kpi_snapshots`
--

LOCK TABLES `kpi_snapshots` WRITE;
/*!40000 ALTER TABLE `kpi_snapshots` DISABLE KEYS */;
INSERT INTO `kpi_snapshots` VALUES ('21f57de2-ca35-11f0-ac53-364ad037a080','team-1764098322554-4r4dpedwc','2025-11-25',73.38,2.50,0.496,1.79,78,5,45,14,1.84,8.02,82.40,55,89.70,5.16,71.77,23,78.00,362.52,1.90,96,99.531,5,91,'good','2025-11-25 19:30:00'),('7e9bb2b2-c98d-11f0-ac53-364ad037a080','team-1764026202608-vcbic0w8g','2025-11-25',70.43,1.78,1.038,5.23,84,15,31,6,1.07,7.54,74.48,40,75.94,11.16,60.10,24,87.73,235.22,1.79,118,99.868,5,89,'good','2025-11-24 23:30:00'),('7e9c66f8-c98d-11f0-ac53-364ad037a080','team-1764026220944-y6sngw6ms','2025-11-25',68.36,0.24,1.314,3.61,82,9,26,9,3.60,3.07,70.50,40,89.64,23.02,67.72,14,65.23,233.10,2.75,115,99.929,3,78,'warning','2025-11-24 23:30:00'),('7e9c91d2-c98d-11f0-ac53-364ad037a080','team-1764026236967-uphpblii4','2025-11-25',76.40,2.89,1.448,6.76,90,15,33,11,1.93,7.78,91.81,31,92.93,12.00,71.93,28,69.00,280.50,2.49,108,99.458,7,84,'warning','2025-11-24 23:30:00'),('95b23f3e-cb04-11f0-ac53-364ad037a080','team-1764026202608-vcbic0w8g','2025-11-26',93.16,2.55,1.292,4.27,89,6,55,15,3.41,6.10,89.46,57,85.17,11.38,67.04,22,93.62,206.73,9.14,143,99.424,2,80,'warning','2025-11-26 20:15:00'),('95b3320e-cb04-11f0-ac53-364ad037a080','team-1764026220944-y6sngw6ms','2025-11-26',76.34,0.60,0.485,7.79,88,6,28,18,2.74,4.64,74.45,45,90.49,11.51,70.03,17,78.49,293.37,5.28,131,99.801,7,89,'good','2025-11-26 20:15:00'),('95b35ed2-cb04-11f0-ac53-364ad037a080','team-1764098322554-4r4dpedwc','2025-11-26',70.05,2.83,1.111,5.90,94,14,40,8,4.50,2.38,80.76,40,92.32,12.70,73.56,21,61.05,306.68,6.79,131,99.238,5,89,'good','2025-11-26 20:15:00');
/*!40000 ALTER TABLE `kpi_snapshots` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sprint_velocity`
--

DROP TABLE IF EXISTS `sprint_velocity`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sprint_velocity` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `team_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sprint_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `committed_points` int NOT NULL,
  `delivered_points` int NOT NULL,
  `carryover_points` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_team_sprint` (`team_id`,`sprint_name`),
  KEY `idx_sprint_velocity_team` (`team_id`,`start_date` DESC),
  CONSTRAINT `sprint_velocity_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sprint_velocity`
--

LOCK TABLES `sprint_velocity` WRITE;
/*!40000 ALTER TABLE `sprint_velocity` DISABLE KEYS */;
/*!40000 ALTER TABLE `sprint_velocity` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `team_members`
--

DROP TABLE IF EXISTS `team_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_members` (
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `team_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('lead','member','contributor') COLLATE utf8mb4_unicode_ci DEFAULT 'member',
  `joined_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`,`team_id`),
  KEY `idx_team_members_user` (`user_id`),
  KEY `idx_team_members_team` (`team_id`),
  CONSTRAINT `team_members_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `team_members_ibfk_2` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `team_members`
--

LOCK TABLES `team_members` WRITE;
/*!40000 ALTER TABLE `team_members` DISABLE KEYS */;
/*!40000 ALTER TABLE `team_members` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `teams`
--

DROP TABLE IF EXISTS `teams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teams` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `department_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `lead_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_active` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_team_per_dept` (`department_id`,`name`),
  KEY `idx_teams_company` (`company_id`),
  KEY `idx_teams_department` (`department_id`),
  KEY `idx_teams_lead` (`lead_id`),
  CONSTRAINT `teams_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `teams_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `teams_ibfk_3` FOREIGN KEY (`lead_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `teams`
--

LOCK TABLES `teams` WRITE;
/*!40000 ALTER TABLE `teams` DISABLE KEYS */;
INSERT INTO `teams` VALUES ('team-1764026202608-vcbic0w8g','company-mastercard','dept-digital','Mavericks','test',NULL,'2025-11-24 23:16:42','2025-11-24 23:16:42',1),('team-1764026220944-y6sngw6ms','company-mastercard','dept-digital','LegacyCode Warriors','test 001',NULL,'2025-11-24 23:17:00','2025-11-25 20:31:37',1),('team-1764026236967-uphpblii4','company-mastercard','dept-payments','QualityCowboys','tttt',NULL,'2025-11-24 23:17:16','2025-11-25 21:31:50',0),('team-1764098322554-4r4dpedwc','company-mastercard','dept-payments','fvgbhnjm','dcfvgbhnj',NULL,'2025-11-25 19:18:42','2025-11-25 19:18:42',1);
/*!40000 ALTER TABLE `teams` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('super_admin','qa_manager','team_lead','qa_engineer','viewer') COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `department_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `primary_team_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `avatar_url` text COLLATE utf8mb4_unicode_ci,
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timezone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'UTC',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_login` timestamp NULL DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `email_verified` tinyint(1) DEFAULT '0',
  `email_verified_at` timestamp NULL DEFAULT NULL,
  `password_reset_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_reset_expires` timestamp NULL DEFAULT NULL,
  `failed_login_attempts` int DEFAULT '0',
  `locked_until` timestamp NULL DEFAULT NULL,
  `created_by` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_users_email` (`email`),
  KEY `idx_users_company` (`company_id`),
  KEY `idx_users_department` (`department_id`),
  KEY `idx_users_primary_team` (`primary_team_id`),
  KEY `idx_users_role` (`role`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `users_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `users_ibfk_3` FOREIGN KEY (`primary_team_id`) REFERENCES `teams` (`id`) ON DELETE SET NULL,
  CONSTRAINT `users_ibfk_4` FOREIGN KEY (`primary_team_id`) REFERENCES `teams` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES ('10000004','david.lee@mastercard.com','$2b$10$rQ8K7JZ9Z8Z9Z8Z9Z8Z9ZuK7JZ9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8','David','Lee','qa_engineer','company-mastercard','dept-digital','team-1764026220944-y6sngw6ms',NULL,NULL,'UTC','2025-11-24 23:10:44','2025-11-25 19:07:11',NULL,1,1,NULL,NULL,NULL,0,NULL,NULL),('10000005','emma.wilson@mastercard.com','$2b$10$rQ8K7JZ9Z8Z9Z8Z9Z8Z9ZuK7JZ9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8','Emma','Wilson','qa_engineer','company-mastercard','dept-digital','team-1764026220944-y6sngw6ms',NULL,NULL,'UTC','2025-11-24 23:10:44','2025-11-24 23:17:47',NULL,1,1,NULL,NULL,NULL,0,NULL,NULL),('10000006','frank.miller@mastercard.com','$2b$10$rQ8K7JZ9Z8Z9Z8Z9Z8Z9ZuK7JZ9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8','Frank','Miller','qa_engineer','company-mastercard','dept-payments','team-1764026236967-uphpblii4',NULL,NULL,'UTC','2025-11-24 23:10:44','2025-11-24 23:17:55',NULL,1,1,NULL,NULL,NULL,0,NULL,NULL),('10000007','grace.chen@mastercard.com','$2b$10$rQ8K7JZ9Z8Z9Z8Z9Z8Z9ZuK7JZ9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8','Grace','Chen','qa_engineer','company-mastercard','dept-payments','team-1764026236967-uphpblii4',NULL,NULL,'UTC','2025-11-24 23:10:44','2025-11-25 19:14:53',NULL,1,1,NULL,NULL,NULL,0,NULL,NULL),('10000008','henry.brown@mastercard.com','$2b$10$rQ8K7JZ9Z8Z9Z8Z9Z8Z9ZuK7JZ9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8','Henry','Brown','qa_engineer','company-mastercard','dept-digital','team-1764026220944-y6sngw6ms',NULL,NULL,'UTC','2025-11-24 23:10:44','2025-11-24 23:18:06',NULL,1,1,NULL,NULL,NULL,0,NULL,NULL),('10000009','iris.garcia@mastercard.com','$2b$10$rQ8K7JZ9Z8Z9Z8Z9Z8Z9ZuK7JZ9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8','Iris','Garcia','qa_engineer','company-mastercard','dept-digital','team-1764026202608-vcbic0w8g',NULL,NULL,'UTC','2025-11-24 23:10:44','2025-11-25 20:25:38',NULL,1,1,NULL,NULL,NULL,0,NULL,NULL),('10000010','jack.martinez@mastercard.com','$2b$10$rQ8K7JZ9Z8Z9Z8Z9Z8Z9ZuK7JZ9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8','Jack','Martinez','qa_engineer','company-mastercard','dept-payments','team-1764026236967-uphpblii4',NULL,NULL,'UTC','2025-11-24 23:10:44','2025-11-25 15:21:17',NULL,1,1,NULL,NULL,NULL,0,NULL,NULL),('10000013','mia.thomas@mastercard.com','$2b$10$rQ8K7JZ9Z8Z9Z8Z9Z8Z9ZuK7JZ9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8','Mia','Thomas','qa_engineer','company-mastercard','dept-engineering',NULL,NULL,NULL,'UTC','2025-11-24 23:10:44','2025-11-24 23:10:44',NULL,1,1,NULL,NULL,NULL,0,NULL,NULL),('10000014','noah.white@mastercard.com','$2b$10$rQ8K7JZ9Z8Z9Z8Z9Z8Z9ZuK7JZ9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8','Noah','White','qa_engineer','company-mastercard','dept-engineering',NULL,NULL,NULL,'UTC','2025-11-24 23:10:44','2025-11-24 23:10:44',NULL,1,1,NULL,NULL,NULL,0,NULL,NULL),('10000015','olivia.harris@mastercard.com','$2b$10$rQ8K7JZ9Z8Z9Z8Z9Z8Z9ZuK7JZ9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8Z9Z8','Olivia','Harris','qa_engineer','company-mastercard','dept-engineering',NULL,NULL,NULL,'UTC','2025-11-24 23:10:44','2025-11-24 23:10:44',NULL,1,1,NULL,NULL,NULL,0,NULL,NULL),('user-1763682905539-dr6qzyue9','testuser@example.com','$2b$10$vN8dAmES332BgHopYmX3Z.gV4kes0J.hsgKUkNmLAyCVU6jVFJ2DK','Test','User','qa_engineer','company-mastercard','dept-decision-mgmt','team-quasars',NULL,NULL,'UTC','2025-11-20 23:55:05','2025-11-20 23:55:05',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763682944123-xhubbkh69','john@john.com','$2b$10$VgOs09lMqfe/DTJn6hT2ZOpthuXNWdTr5Ntfd7ctu5R4CArMHstTq','John','Updated','qa_manager','company-mastercard','dept-decision-mgmt','team-astronauts',NULL,NULL,'UTC','2025-11-20 23:55:44','2025-11-21 12:44:44','2025-11-20 23:56:07',1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763756196061-59f4fv98d','ionut.n.apostu@gmail.com','$2b$10$i17gxRP1EkoVUgPkaRx9r.kFsXDIjtvRRR5eWD12mr0sXc7RpAH0y','Ionut','Apostu','qa_engineer','company-mastercard','dept-decision-mgmt','team-1763682705861-442ypntgb',NULL,NULL,'UTC','2025-11-21 20:16:36','2025-11-21 20:16:36',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-lead'),('user-1763756790687-jdr4cqw8x','ionut.apostu@gmail.com','$2b$10$P/qJ2fqNvDUvvD9BI5VjTOjeL/U5yI0lIYe/0KStpaLyrAQcIZQ7.','Ionut','Apostu','qa_engineer','company-mastercard','dept-decision-mgmt','team-watchmen',NULL,NULL,'UTC','2025-11-21 20:26:30','2025-11-21 20:31:27',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-lead'),('user-1763762971558-qi2rd7qcc','test-1763762971499@irongate.com','$2b$10$faJrheTxKcn8qiGxUOOQB.tLy4QVOhWMGRTISeYcAjnWgUpUZ8soS','Test','User','qa_engineer','company-mastercard','dept-decision-mgmt','team-quasars',NULL,NULL,'UTC','2025-11-21 22:09:31','2025-11-21 22:09:31',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763849040245-mx8zw2e0g','test-1763849040185@irongate.com','$2b$10$2weXuSrHW0WzSU4BSt5LQOAGx0qSVPiAk5s8X7y4V7ZNJrp54azuC','Test','User','qa_engineer','company-mastercard','dept-decision-mgmt','team-quasars',NULL,NULL,'UTC','2025-11-22 22:04:00','2025-11-22 22:04:00',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763850916144-7vp94idxf','jjj@jjj.com','$2b$10$CyKRVtLbQ/JYH5YLz54mreDV9wop/Nf7RWgUQj5xWRThe97l8Er9q','jjj','jjj','qa_manager','company-mastercard','dept-decision-mgmt','team-quasars',NULL,NULL,'UTC','2025-11-22 22:35:16','2025-11-22 22:35:16',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763851316717-y4rvs0wsi','test-1763851316657@irongate.com','$2b$10$qrlqizoo5mzKs7GsoMlBp.RkMQFLXRuoWe5dW5sT1byl4T3EQWp4m','Test','User','qa_engineer','company-mastercard','dept-decision-mgmt','team-quasars',NULL,NULL,'UTC','2025-11-22 22:41:56','2025-11-22 22:41:56',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763851316817-yvky7o2j6','delete-test-1763851316758@irongate.com','$2b$10$u5GTyWYCxg7FoYTahAhxOuuV7W20DfOD80PVwM0pf8lMB.XIluV/u','Delete','Test','qa_engineer','company-mastercard','dept-decision-mgmt','team-quasars',NULL,NULL,'UTC','2025-11-22 22:41:56','2025-11-22 22:41:56',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763851350315-c4pxjl6p9','test-1763851350253@irongate.com','$2b$10$4UDq5CjVROOeD7dUibT9feUm01D/qS6pB4bRhbAX9.JoY6AaYYHi.','Test','User','qa_engineer','company-mastercard','dept-decision-mgmt','team-quasars',NULL,NULL,'UTC','2025-11-22 22:42:30','2025-11-22 22:42:30',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763851443759-0s45tk1rs','test-1763851443699@irongate.com','$2b$10$FcQVAnne3CrvMlB/hMtliOT4pijxGvjoSYP/okhyKNd4ILWviah9C','Test','User','qa_engineer','company-mastercard','dept-decision-mgmt','team-quasars',NULL,NULL,'UTC','2025-11-22 22:44:03','2025-11-22 22:44:03',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763853771943-tdupwzejt','test-user-1763853771070@irongate.com','$2b$10$B2MnHcfXK44rJM8KPRXQuucKrpkBe2vTLhmbuFxaSLI1pbrQrrsQO','Test','User','qa_engineer','company-mastercard','dept-decision-mgmt','team-grid',NULL,NULL,'UTC','2025-11-22 23:22:51','2025-11-22 23:22:51',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763853793489-qzjacpzmw','team-lead-1763853792627@irongate.com','$2b$10$vmbOgPqtgiiHmLBWxNix1.rOVLPs4UjIRWLhBtQSoENtmxpIXMCvy','Team','Lead','team_lead','company-mastercard','dept-decision-mgmt','team-grid',NULL,NULL,'UTC','2025-11-22 23:23:13','2025-11-22 23:23:13',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-manager'),('user-1763853814948-dvuu9jwnv','engineer-1763853814149@irongate.com','$2b$10$HUkM3Bxi/pmJcNG1rYesleSPZyMLtv2CnHMpWen7Hpui504LaSRJ.','QA1','Engineer','qa_engineer','company-mastercard','dept-decision-mgmt','team-watchmen',NULL,NULL,'UTC','2025-11-22 23:23:34','2025-11-22 23:27:12',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-lead'),('user-1763855437950-2r8ralckv','test-user-1763855437064@irongate.com','$2b$10$sBfhzHRdtN42ZoYWQComz.JMzSp6DAwGrYwAdtk5EfJcVsBsVQWoW','Test','User','qa_engineer','company-mastercard','dept-decision-mgmt','team-grid',NULL,NULL,'UTC','2025-11-22 23:50:37','2025-11-22 23:50:37',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763855459522-qnhuxw9na','team-lead-1763855458653@irongate.com','$2b$10$p2VKu5AtVJGcn1mUzLQYfOAM82dzADqPQ4lxTpiYtgNXBBbiTHL1a','Team','Lead','team_lead','company-mastercard','dept-decision-mgmt','team-grid',NULL,NULL,'UTC','2025-11-22 23:50:59','2025-11-22 23:50:59',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-manager'),('user-1763855480967-58pxyti1e','engineer-1763855480173@irongate.com','$2b$10$LQToMLObL1BKRRalJ4tlbOEhERRNsIy1RtybRcxAjLA3NR0Ak1p5W','QA','Engineer','qa_engineer','company-mastercard','dept-decision-mgmt','team-watchmen',NULL,NULL,'UTC','2025-11-22 23:51:20','2025-11-22 23:51:20',NULL,1,1,NULL,NULL,NULL,0,NULL,'user-lead'),('user-1763923334504-e2ca2jrwd','hgf@hji21111.com','$2b$10$5G.ZEbWINA84uyvjksfPluxIIh9Z7sGoAUvVUSrbQ5sarocATxMpW','test11111','test11111','qa_engineer','company-mastercard','dept-quality-engineering','team-1763923303895-zjupzflcj',NULL,NULL,'UTC','2025-11-23 18:42:14','2025-11-24 12:38:50','2025-11-23 20:47:05',1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763923709930-j7sf8f6bj','dfghj@cvb.com','$2b$10$z9l4/.IeaHy4J3yl.sRLJOHtzfUIQHz0V8h7/5RFhye4Qsy77ue.i','hfh','hgh','qa_manager','company-mastercard','dept-engineering','team-1763923679124-wlv08asl3',NULL,NULL,'UTC','2025-11-23 18:48:29','2025-11-24 12:50:34','2025-11-24 12:50:34',1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-1763988087907-sm99s4nji','testing1@testing1.com','$2b$10$sL0cIbeDdOgiA9bvO672kuC2KhDQCHcjGpj2lRhQzYU0EB8nyHE1W','test1','test1','team_lead','company-mastercard','dept-engineering','team-1763987806446-2nnq8orqe',NULL,NULL,'UTC','2025-11-24 12:41:27','2025-11-24 23:06:42','2025-11-24 22:47:42',1,1,NULL,NULL,NULL,0,NULL,'user-admin'),('user-admin','admin@irongate.com','$2b$10$WQpcuEcTOreEzXIOPXMkSOUxw4ycW7G6.EqTeHTH2ignvfSmW9WsC','Admin','User','super_admin','company-mastercard','dept-decision-mgmt','team-quasars',NULL,NULL,'UTC','2025-11-20 23:05:08','2025-11-25 15:11:27','2025-11-25 15:11:27',1,1,NULL,NULL,NULL,0,NULL,NULL),('user-engineer','engineer@irongate.com','$2b$10$WQpcuEcTOreEzXIOPXMkSOUxw4ycW7G6.EqTeHTH2ignvfSmW9WsC','Updated','Engineer','qa_engineer','company-mastercard','dept-decision-mgmt','team-quasars',NULL,NULL,'UTC','2025-11-20 23:05:08','2025-11-25 15:10:26','2025-11-25 15:10:26',1,1,NULL,NULL,NULL,0,NULL,NULL),('user-lead','lead@irongate.com','$2b$10$WQpcuEcTOreEzXIOPXMkSOUxw4ycW7G6.EqTeHTH2ignvfSmW9WsC','Team','Lead','team_lead','company-mastercard','dept-decision-mgmt','team-watchmen',NULL,NULL,'UTC','2025-11-20 23:05:08','2025-11-25 15:10:59','2025-11-25 15:10:59',1,1,NULL,NULL,NULL,0,NULL,NULL),('user-manager','manager@irongate.com','$2b$10$WQpcuEcTOreEzXIOPXMkSOUxw4ycW7G6.EqTeHTH2ignvfSmW9WsC','QA','Manager','qa_manager','company-mastercard','dept-decision-mgmt','team-pulsars',NULL,NULL,'UTC','2025-11-20 23:05:08','2025-11-23 10:18:46','2025-11-23 10:18:46',1,1,NULL,NULL,NULL,0,NULL,NULL),('user-viewer','viewer@irongate.com','$2b$10$WQpcuEcTOreEzXIOPXMkSOUxw4ycW7G6.EqTeHTH2ignvfSmW9WsC','View','Only','viewer','company-mastercard','dept-decision-mgmt','team-grid',NULL,NULL,'UTC','2025-11-20 23:05:08','2025-11-23 10:13:24','2025-11-23 10:13:24',1,1,NULL,NULL,NULL,0,NULL,NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-11-26 22:51:17
