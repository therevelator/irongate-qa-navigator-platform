mysqldump: [Warning] Using a password on the command line interface can be insecure.
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
-- Dumping data for table `teams`
--

LOCK TABLES `teams` WRITE;
/*!40000 ALTER TABLE `teams` DISABLE KEYS */;
INSERT INTO `teams` (`id`, `company_id`, `department_id`, `name`, `description`, `lead_id`, `created_at`, `updated_at`, `is_active`) VALUES ('team-1764026202608-vcbic0w8g','company-mastercard','dept-digital','Mavericks','test',NULL,'2025-11-24 23:16:42','2025-11-24 23:16:42',1),('team-1764026220944-y6sngw6ms','company-mastercard','dept-digital','LegacyCode Warriors','test 001',NULL,'2025-11-24 23:17:00','2025-11-25 20:31:37',1),('team-1764026236967-uphpblii4','company-mastercard','dept-payments','QualityCowboys','tttt',NULL,'2025-11-24 23:17:16','2025-11-25 21:31:50',0),('team-1764098322554-4r4dpedwc','company-mastercard','dept-payments','fvgbhnjm','dcfvgbhnj',NULL,'2025-11-25 19:18:42','2025-11-25 19:18:42',1);
/*!40000 ALTER TABLE `teams` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `companies`
--

LOCK TABLES `companies` WRITE;
/*!40000 ALTER TABLE `companies` DISABLE KEYS */;
INSERT INTO `companies` (`id`, `name`, `domain`, `logo_url`, `settings`, `created_at`, `updated_at`, `is_active`) VALUES ('company-mastercard','Mastercard','mastercard.com',NULL,NULL,'2025-11-24 23:13:09','2025-11-24 23:13:09',1);
/*!40000 ALTER TABLE `companies` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `departments`
--

LOCK TABLES `departments` WRITE;
/*!40000 ALTER TABLE `departments` DISABLE KEYS */;
INSERT INTO `departments` (`id`, `company_id`, `name`, `description`, `manager_id`, `created_at`, `updated_at`, `is_active`) VALUES ('dept-decision-mgmt','company-mastercard','Decision Management','AI-powered decision management and fraud detection',NULL,'2025-11-24 23:13:09','2025-11-24 23:13:09',1),('dept-digital','company-mastercard','Digital Products','Mobile apps, web portals, and digital experiences',NULL,'2025-11-24 23:13:09','2025-11-24 23:13:09',1),('dept-payments','company-mastercard','Payments Processing','Core payment processing and transaction management',NULL,'2025-11-24 23:13:09','2025-11-24 23:13:09',1),('dept-security','company-mastercard','Security & Compliance','Security, fraud prevention, and regulatory compliance',NULL,'2025-11-24 23:13:09','2025-11-24 23:13:09',1);
/*!40000 ALTER TABLE `departments` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-11-27  0:41:39
