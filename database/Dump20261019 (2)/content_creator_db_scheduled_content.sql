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
-- Table structure for table `scheduled_content`
--

DROP TABLE IF EXISTS `scheduled_content`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scheduled_content` (
  `schedule_id` int(11) NOT NULL AUTO_INCREMENT,
  `content_id` int(11) NOT NULL,
  `platform_id` int(11) NOT NULL,
  `scheduled_date` datetime NOT NULL,
  `published_at` datetime DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'Scheduled',
  `external_content_id` varchar(255) DEFAULT NULL,
  `external_content_url` varchar(500) DEFAULT NULL,
  `youtube_channel_id` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`schedule_id`),
  KEY `content_id` (`content_id`),
  KEY `platform_id` (`platform_id`),
  KEY `idx_scheduled_content_youtube_channel_id` (`youtube_channel_id`),
  CONSTRAINT `scheduled_content_ibfk_1` FOREIGN KEY (`content_id`) REFERENCES `content` (`content_id`) ON DELETE CASCADE,
  CONSTRAINT `scheduled_content_ibfk_2` FOREIGN KEY (`platform_id`) REFERENCES `platforms` (`platform_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `scheduled_content`
--

LOCK TABLES `scheduled_content` WRITE;
/*!40000 ALTER TABLE `scheduled_content` DISABLE KEYS */;
INSERT INTO `scheduled_content` VALUES (28,16,2,'2026-09-10 00:00:00','2026-09-10 18:17:44','Published',NULL,NULL,NULL),(29,16,1,'2026-09-10 00:00:00','2026-09-10 18:17:44','Published','EKwD60mHzQo','https://www.youtube.com/watch?v=EKwD60mHzQo','UCh88WUyrJS60w8mr_nl0NMw'),(30,17,2,'2026-09-11 00:00:00',NULL,'Missed',NULL,NULL,NULL),(31,17,1,'2026-09-11 00:00:00',NULL,'Missed',NULL,NULL,NULL),(32,18,1,'2026-09-24 00:00:00','2026-09-24 14:58:17','Published','Mb5Z207Lqgg','https://www.youtube.com/watch?v=Mb5Z207Lqgg','UCh88WUyrJS60w8mr_nl0NMw'),(33,20,2,'2026-10-23 00:00:00',NULL,'Missed',NULL,NULL,NULL),(34,20,1,'2026-10-23 00:00:00',NULL,'Missed',NULL,NULL,NULL),(35,21,2,'2026-10-24 00:00:00',NULL,'Scheduled',NULL,NULL,NULL),(36,21,1,'2026-10-24 00:00:00',NULL,'Scheduled',NULL,NULL,NULL);
/*!40000 ALTER TABLE `scheduled_content` ENABLE KEYS */;
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
