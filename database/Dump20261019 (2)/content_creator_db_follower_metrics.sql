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
-- Table structure for table `follower_metrics`
--

DROP TABLE IF EXISTS `follower_metrics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `follower_metrics` (
  `follower_metric_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `platform_id` int(11) NOT NULL,
  `channel_id` varchar(24) DEFAULT NULL,
  `recorded_at` datetime NOT NULL DEFAULT current_timestamp(),
  `follower_count` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`follower_metric_id`),
  KEY `platform_id` (`platform_id`),
  KEY `idx_follower_metrics_user_platform_channel` (`user_id`,`platform_id`,`channel_id`),
  CONSTRAINT `follower_metrics_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `follower_metrics_ibfk_2` FOREIGN KEY (`platform_id`) REFERENCES `platforms` (`platform_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `follower_metrics`
--

LOCK TABLES `follower_metrics` WRITE;
/*!40000 ALTER TABLE `follower_metrics` DISABLE KEYS */;
INSERT INTO `follower_metrics` VALUES (1,1,1,NULL,'2026-09-02 11:11:29',0),(2,1,1,NULL,'2026-09-02 11:24:35',113),(3,1,1,NULL,'2026-09-02 11:26:38',113),(4,1,1,NULL,'2026-09-02 11:52:46',113),(5,1,1,NULL,'2026-09-02 17:54:23',1),(6,1,1,NULL,'2026-09-02 17:57:38',1),(7,1,1,NULL,'2026-09-02 18:00:06',1),(8,1,1,NULL,'2026-09-02 18:01:42',1),(9,1,1,NULL,'2026-09-02 18:02:45',1),(10,1,1,NULL,'2026-09-02 23:02:05',3),(11,1,1,NULL,'2026-09-02 23:14:56',3),(12,1,1,NULL,'2026-09-03 00:18:04',3),(13,1,1,'UCjaV7CfsUqdevbz3PrjK0EA','2026-09-03 00:41:41',3),(14,1,1,'UCjaV7CfsUqdevbz3PrjK0EA','2026-09-03 00:53:47',4),(15,1,1,'UCjaV7CfsUqdevbz3PrjK0EA','2026-09-03 12:15:47',4),(16,1,1,'UCh88WUyrJS60w8mr_nl0NMw','2026-09-10 18:12:47',115),(17,3,1,'UCh88WUyrJS60w8mr_nl0NMw','2026-09-28 13:26:10',116),(18,3,1,'UCh88WUyrJS60w8mr_nl0NMw','2026-10-22 12:54:54',117),(19,3,1,'UCh88WUyrJS60w8mr_nl0NMw','2026-10-23 12:55:51',117);
/*!40000 ALTER TABLE `follower_metrics` ENABLE KEYS */;
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
