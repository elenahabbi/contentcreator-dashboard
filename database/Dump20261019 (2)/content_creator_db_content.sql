-- MySQL dump 10.13  Distrib 8.0.43, for Win64 (x86_64)
--
-- Host: localhost    Database: content_creator_db
-- ------------------------------------------------------
-- Server version	5.5.5-10.4.32-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `content`
--

DROP TABLE IF EXISTS `content`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `content` (
  `content_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `content_type` varchar(50) DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'Idea',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`content_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `content_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `content`
--

LOCK TABLES `content` WRITE;
/*!40000 ALTER TABLE `content` DISABLE KEYS */;
INSERT INTO `content` VALUES (1,1,'Test Script',NULL,'short-form','draft','2026-08-31 20:37:34','2026-08-31 20:37:34'),(2,1,'Trial 01 script',NULL,'short-form','draft','2026-09-01 04:53:25','2026-09-01 04:53:25'),(3,1,'Test Event 01',NULL,'general','draft','2026-09-01 05:06:40','2026-09-01 05:06:40'),(4,1,'Yt scheduled item',NULL,'short-form','draft','2026-09-01 09:21:26','2026-09-01 09:21:26'),(5,1,'Yt scheduled item',NULL,'general','draft','2026-09-01 18:51:28','2026-09-01 18:51:28'),(6,1,'llllllllllll',NULL,'general','draft','2026-09-02 08:40:41','2026-09-02 08:40:41'),(7,1,'Why Are Oil Prices Rising Again?',NULL,'short-form','draft','2026-09-02 14:34:20','2026-09-02 14:34:20'),(8,1,'The UN Just Gave a Major Climate Warning',NULL,'short-form','draft','2026-09-02 14:35:02','2026-09-02 14:35:02'),(9,1,'Is AI About to Overheat the Economy?',NULL,'short-form','draft','2026-09-02 14:36:24','2026-09-02 14:36:24'),(10,1,'Why Are Global Markets Falling?',NULL,'short-form','draft','2026-09-02 14:36:50','2026-09-02 14:36:50'),(11,1,'Why Are People Turning Against AI Data Centres?',NULL,'short-form','draft','2026-09-02 14:37:27','2026-09-02 14:37:27'),(12,1,'Why Is Extreme Weather Getting So Dangerous?',NULL,'short-form','draft','2026-09-02 14:37:56','2026-09-02 14:37:56'),(13,1,'Event 05',NULL,'general','draft','2026-09-02 21:11:15','2026-09-02 21:11:15'),(14,1,'llllllllllll',NULL,'general','draft','2026-09-02 21:11:24','2026-09-02 21:11:24'),(15,1,'Just decide (Proverb 132)',NULL,'general','draft','2026-09-10 15:17:08','2026-09-10 15:17:08'),(16,1,'Just decide (Proverb 132)',NULL,'general','draft','2026-09-10 15:17:36','2026-09-10 15:17:36'),(17,1,'When judgement comes (Proverb 133)',NULL,'short-form','draft','2026-09-10 15:20:56','2026-09-10 15:20:56'),(18,3,'God\'s Ultimate Answer To Pain | Job 38-39 study',NULL,'general','draft','2026-09-24 11:58:07','2026-09-24 11:58:07'),(19,3,'God\'s Ultimate Answer To Pain | Job 38-39 study',NULL,'long-form','draft','2026-09-24 12:01:02','2026-09-24 12:01:02'),(20,3,'Proverb',NULL,'general','draft','2026-10-23 09:19:44','2026-10-23 09:19:44'),(21,3,'Proverbb',NULL,'general','draft','2026-10-23 09:28:01','2026-10-23 09:28:01');
/*!40000 ALTER TABLE `content` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-23 13:07:35
