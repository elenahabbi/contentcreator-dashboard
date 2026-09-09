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
-- Table structure for table `categories`
--

DROP TABLE IF EXISTS `categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `categories` (
  `category_id` int(11) NOT NULL AUTO_INCREMENT,
  `category_name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  PRIMARY KEY (`category_id`),
  UNIQUE KEY `category_name` (`category_name`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `categories`
--

LOCK TABLES `categories` WRITE;
/*!40000 ALTER TABLE `categories` DISABLE KEYS */;
INSERT INTO `categories` VALUES (1,'Education','Educational and informative content'),(2,'Faith','Faith and Christian content'),(3,'Lifestyle','Lifestyle-related content'),(4,'Technology','Technology-related content'),(5,'Entertainment','Entertainment content');
/*!40000 ALTER TABLE `categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `competitor_content`
--

DROP TABLE IF EXISTS `competitor_content`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `competitor_content` (
  `competitor_content_id` int(11) NOT NULL AUTO_INCREMENT,
  `competitor_id` int(11) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `topic` varchar(255) DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  `views` int(11) DEFAULT 0,
  `likes` int(11) DEFAULT 0,
  `comments` int(11) DEFAULT 0,
  `shares` int(11) DEFAULT 0,
  `source_url` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`competitor_content_id`),
  KEY `competitor_id` (`competitor_id`),
  CONSTRAINT `competitor_content_ibfk_1` FOREIGN KEY (`competitor_id`) REFERENCES `competitors` (`competitor_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `competitor_content`
--

LOCK TABLES `competitor_content` WRITE;
/*!40000 ALTER TABLE `competitor_content` DISABLE KEYS */;
/*!40000 ALTER TABLE `competitor_content` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `competitors`
--

DROP TABLE IF EXISTS `competitors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `competitors` (
  `competitor_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `name` varchar(150) NOT NULL,
  `platform_id` int(11) NOT NULL,
  `profile_url` varchar(500) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`competitor_id`),
  KEY `user_id` (`user_id`),
  KEY `platform_id` (`platform_id`),
  CONSTRAINT `competitors_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `competitors_ibfk_2` FOREIGN KEY (`platform_id`) REFERENCES `platforms` (`platform_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `competitors`
--

LOCK TABLES `competitors` WRITE;
/*!40000 ALTER TABLE `competitors` DISABLE KEYS */;
/*!40000 ALTER TABLE `competitors` ENABLE KEYS */;
UNLOCK TABLES;

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
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `content`
--

LOCK TABLES `content` WRITE;
/*!40000 ALTER TABLE `content` DISABLE KEYS */;
INSERT INTO `content` VALUES (1,1,'Test Script',NULL,'short-form','draft','2026-08-31 20:37:34','2026-08-31 20:37:34'),(2,1,'Trial 01 script',NULL,'short-form','draft','2026-09-01 04:53:25','2026-09-01 04:53:25'),(3,1,'Test Event 01',NULL,'general','draft','2026-09-01 05:06:40','2026-09-01 05:06:40'),(4,1,'Yt scheduled item',NULL,'short-form','draft','2026-09-01 09:21:26','2026-09-01 09:21:26'),(5,1,'Yt scheduled item',NULL,'general','draft','2026-09-01 18:51:28','2026-09-01 18:51:28'),(6,1,'llllllllllll',NULL,'general','draft','2026-09-02 08:40:41','2026-09-02 08:40:41'),(7,1,'Why Are Oil Prices Rising Again?',NULL,'short-form','draft','2026-09-02 14:34:20','2026-09-02 14:34:20'),(8,1,'The UN Just Gave a Major Climate Warning',NULL,'short-form','draft','2026-09-02 14:35:02','2026-09-02 14:35:02'),(9,1,'Is AI About to Overheat the Economy?',NULL,'short-form','draft','2026-09-02 14:36:24','2026-09-02 14:36:24'),(10,1,'Why Are Global Markets Falling?',NULL,'short-form','draft','2026-09-02 14:36:50','2026-09-02 14:36:50'),(11,1,'Why Are People Turning Against AI Data Centres?',NULL,'short-form','draft','2026-09-02 14:37:27','2026-09-02 14:37:27'),(12,1,'Why Is Extreme Weather Getting So Dangerous?',NULL,'short-form','draft','2026-09-02 14:37:56','2026-09-02 14:37:56');
/*!40000 ALTER TABLE `content` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `content_categories`
--

DROP TABLE IF EXISTS `content_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `content_categories` (
  `content_id` int(11) NOT NULL,
  `category_id` int(11) NOT NULL,
  PRIMARY KEY (`content_id`,`category_id`),
  KEY `category_id` (`category_id`),
  CONSTRAINT `content_categories_ibfk_1` FOREIGN KEY (`content_id`) REFERENCES `content` (`content_id`) ON DELETE CASCADE,
  CONSTRAINT `content_categories_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `content_categories`
--

LOCK TABLES `content_categories` WRITE;
/*!40000 ALTER TABLE `content_categories` DISABLE KEYS */;
/*!40000 ALTER TABLE `content_categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `content_platforms`
--

DROP TABLE IF EXISTS `content_platforms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `content_platforms` (
  `content_id` int(11) NOT NULL,
  `platform_id` int(11) NOT NULL,
  PRIMARY KEY (`content_id`,`platform_id`),
  KEY `platform_id` (`platform_id`),
  CONSTRAINT `content_platforms_ibfk_1` FOREIGN KEY (`content_id`) REFERENCES `content` (`content_id`) ON DELETE CASCADE,
  CONSTRAINT `content_platforms_ibfk_2` FOREIGN KEY (`platform_id`) REFERENCES `platforms` (`platform_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `content_platforms`
--

LOCK TABLES `content_platforms` WRITE;
/*!40000 ALTER TABLE `content_platforms` DISABLE KEYS */;
INSERT INTO `content_platforms` VALUES (1,1),(1,2),(3,2),(4,1),(5,1),(6,2),(6,3),(7,1),(7,2),(8,1),(8,2),(9,1),(9,2);
/*!40000 ALTER TABLE `content_platforms` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `events`
--

DROP TABLE IF EXISTS `events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `events` (
  `event_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `event_date` date DEFAULT NULL,
  `source` varchar(255) DEFAULT NULL,
  `relevance_keywords` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`event_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `events_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `events`
--

LOCK TABLES `events` WRITE;
/*!40000 ALTER TABLE `events` DISABLE KEYS */;
/*!40000 ALTER TABLE `events` ENABLE KEYS */;
UNLOCK TABLES;

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
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `follower_metrics`
--

LOCK TABLES `follower_metrics` WRITE;
/*!40000 ALTER TABLE `follower_metrics` DISABLE KEYS */;
INSERT INTO `follower_metrics` VALUES (1,1,1,NULL,'2026-09-02 11:11:29',0),(2,1,1,NULL,'2026-09-02 11:24:35',113),(3,1,1,NULL,'2026-09-02 11:26:38',113),(4,1,1,NULL,'2026-09-02 11:52:46',113),(5,1,1,NULL,'2026-09-02 17:54:23',1),(6,1,1,NULL,'2026-09-02 17:57:38',1),(7,1,1,NULL,'2026-09-02 18:00:06',1),(8,1,1,NULL,'2026-09-02 18:01:42',1),(9,1,1,NULL,'2026-09-02 18:02:45',1);
/*!40000 ALTER TABLE `follower_metrics` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `opportunities`
--

DROP TABLE IF EXISTS `opportunities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `opportunities` (
  `opportunity_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `event_id` int(11) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `detected_at` datetime NOT NULL DEFAULT current_timestamp(),
  `opportunity_deadline` datetime DEFAULT NULL,
  `relevance_score` decimal(5,2) NOT NULL DEFAULT 0.00,
  `competitor_activity_score` decimal(5,2) NOT NULL DEFAULT 0.00,
  `engagement_score` decimal(5,2) NOT NULL DEFAULT 0.00,
  `timeliness_score` decimal(5,2) NOT NULL DEFAULT 0.00,
  `opportunity_score` decimal(5,2) NOT NULL DEFAULT 0.00,
  `impact_level` varchar(20) NOT NULL DEFAULT 'Low',
  `status` varchar(50) NOT NULL DEFAULT 'Active',
  PRIMARY KEY (`opportunity_id`),
  KEY `user_id` (`user_id`),
  KEY `event_id` (`event_id`),
  CONSTRAINT `opportunities_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `opportunities_ibfk_2` FOREIGN KEY (`event_id`) REFERENCES `events` (`event_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `opportunities`
--

LOCK TABLES `opportunities` WRITE;
/*!40000 ALTER TABLE `opportunities` DISABLE KEYS */;
/*!40000 ALTER TABLE `opportunities` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `performance_metrics`
--

DROP TABLE IF EXISTS `performance_metrics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `performance_metrics` (
  `metric_id` int(11) NOT NULL AUTO_INCREMENT,
  `content_id` int(11) NOT NULL,
  `platform_id` int(11) NOT NULL,
  `recorded_at` datetime NOT NULL DEFAULT current_timestamp(),
  `views` int(11) NOT NULL DEFAULT 0,
  `likes` int(11) NOT NULL DEFAULT 0,
  `comments` int(11) NOT NULL DEFAULT 0,
  `shares` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`metric_id`),
  KEY `content_id` (`content_id`),
  KEY `platform_id` (`platform_id`),
  CONSTRAINT `performance_metrics_ibfk_1` FOREIGN KEY (`content_id`) REFERENCES `content` (`content_id`) ON DELETE CASCADE,
  CONSTRAINT `performance_metrics_ibfk_2` FOREIGN KEY (`platform_id`) REFERENCES `platforms` (`platform_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `performance_metrics`
--

LOCK TABLES `performance_metrics` WRITE;
/*!40000 ALTER TABLE `performance_metrics` DISABLE KEYS */;
INSERT INTO `performance_metrics` VALUES (1,1,1,'2026-09-01 15:11:47',40,7,6,0),(2,1,1,'2026-09-01 22:32:57',41,7,6,0);
/*!40000 ALTER TABLE `performance_metrics` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `platforms`
--

DROP TABLE IF EXISTS `platforms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `platforms` (
  `platform_id` int(11) NOT NULL AUTO_INCREMENT,
  `platform_name` varchar(50) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`platform_id`),
  UNIQUE KEY `platform_name` (`platform_name`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `platforms`
--

LOCK TABLES `platforms` WRITE;
/*!40000 ALTER TABLE `platforms` DISABLE KEYS */;
INSERT INTO `platforms` VALUES (1,'YouTube',1),(2,'TikTok',1),(3,'Instagram',1);
/*!40000 ALTER TABLE `platforms` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `recommendations`
--

DROP TABLE IF EXISTS `recommendations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recommendations` (
  `recommendation_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `opportunity_id` int(11) DEFAULT NULL,
  `recommendation_type` varchar(100) NOT NULL,
  `message` text NOT NULL,
  `reason` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `status` varchar(50) NOT NULL DEFAULT 'Active',
  PRIMARY KEY (`recommendation_id`),
  KEY `user_id` (`user_id`),
  KEY `opportunity_id` (`opportunity_id`),
  CONSTRAINT `recommendations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `recommendations_ibfk_2` FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities` (`opportunity_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `recommendations`
--

LOCK TABLES `recommendations` WRITE;
/*!40000 ALTER TABLE `recommendations` DISABLE KEYS */;
/*!40000 ALTER TABLE `recommendations` ENABLE KEYS */;
UNLOCK TABLES;

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
  `youtube_channel_id` varchar(24) DEFAULT NULL,
  PRIMARY KEY (`schedule_id`),
  KEY `content_id` (`content_id`),
  KEY `platform_id` (`platform_id`),
  KEY `idx_scheduled_content_youtube_channel_id` (`youtube_channel_id`),
  CONSTRAINT `scheduled_content_ibfk_1` FOREIGN KEY (`content_id`) REFERENCES `content` (`content_id`) ON DELETE CASCADE,
  CONSTRAINT `scheduled_content_ibfk_2` FOREIGN KEY (`platform_id`) REFERENCES `platforms` (`platform_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `scheduled_content`
--

LOCK TABLES `scheduled_content` WRITE;
/*!40000 ALTER TABLE `scheduled_content` DISABLE KEYS */;
INSERT INTO `scheduled_content` VALUES (10,7,2,'2026-09-02 00:00:00',NULL,'Missed',NULL,NULL),(11,7,1,'2026-09-02 00:00:00',NULL,'Missed',NULL,NULL),(12,8,2,'2026-09-02 00:00:00',NULL,'Missed',NULL,NULL),(13,8,1,'2026-09-02 00:00:00',NULL,'Missed',NULL,NULL),(14,9,2,'2026-09-02 00:00:00',NULL,'Missed',NULL,NULL),(15,9,1,'2026-09-02 00:00:00',NULL,'Missed',NULL,NULL);
/*!40000 ALTER TABLE `scheduled_content` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `scripts`
--

DROP TABLE IF EXISTS `scripts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scripts` (
  `script_id` int(11) NOT NULL AUTO_INCREMENT,
  `content_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `script_content` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'Draft',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`script_id`),
  KEY `content_id` (`content_id`),
  CONSTRAINT `scripts_ibfk_1` FOREIGN KEY (`content_id`) REFERENCES `content` (`content_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `scripts`
--

LOCK TABLES `scripts` WRITE;
/*!40000 ALTER TABLE `scripts` DISABLE KEYS */;
INSERT INTO `scripts` VALUES (4,7,'Why Are Oil Prices Rising Again?','[HOOK]\n\nOkay, why is oil suddenly getting more expensive?\n\n[BODY]\n\nOil prices jumped again today as tensions between the United States and Iran escalated.\n\nAnd this matters because oil isn\'t just about petrol.\n\nWhen oil gets more expensive, transportation and production can become more expensive too.\n\nThat can put pressure on prices around the world.\n\nMarkets are already reacting, with Brent crude climbing above 95 dollars a barrel.\n\nSo basically…\n\nsomething happening thousands of kilometres away can eventually affect what people pay for everyday things.\n\n[ENDING]\n\nThe global economy is basically one giant group project.',NULL,'draft','2026-09-02 14:34:20','2026-09-02 14:34:20'),(5,8,'The UN Just Gave a Major Climate Warning','[HOOK]\n\nThe world just got another major climate warning… and it\'s not exactly comforting.\n\n[BODY]\n\nA new UN report says the world is going to exceed the internationally agreed temperature limit.\n\nScientists and climate experts have warned for years about the risks of rising global temperatures.\n\nAnd we\'re already seeing more extreme heat, droughts, wildfires and floods.\n\nBut the report isn\'t saying there\'s nothing we can do.\n\nIt lays out ways the world could still reduce the damage and eventually bring warming back down.\n\nSo the message isn\'t “give up.”\n\nIt\'s more like…\n\nwe\'re running out of time.\n\n[ENDING]\n\nAnd somehow, we\'re still arguing about whether climate change is real.',NULL,'filmed','2026-09-02 14:35:03','2026-09-02 14:35:03'),(6,9,'Is AI About to Overheat the Economy?','[HOOK]\n\nCould AI actually be overheating the economy?\n\n[BODY]\n\nA Federal Reserve official is warning that the AI boom could be getting dangerously hot.\n\nAI investment has exploded, with companies spending huge amounts of money on data centres, chips and new technology.\n\nBut here\'s the problem:\n\nwhen everyone starts pouring money into the same thing because they expect massive returns, prices can rise far beyond what the technology eventually earns.\n\nThat doesn\'t mean AI is a bubble.\n\nBut it does mean economists are starting to ask whether the investment boom can continue at this speed.\n\n[ENDING]\n\nSo… are we watching the next tech revolution, or another bubble?',NULL,'filmed','2026-09-02 14:36:24','2026-09-02 14:36:24'),(7,10,'Why Are Global Markets Falling?','[HOOK]\n\nStocks are falling around the world. Here\'s the simple explanation.\n\n[BODY]\n\nGlobal markets came under pressure today as tensions between the United States and Iran escalated.\n\nInvestors are worried that disruptions around the Strait of Hormuz could affect global energy supplies.\n\nAnd when investors become nervous about oil supplies, inflation and interest rates, they often start moving money into safer assets.\n\nToday, major markets in Asia and Europe fell, while oil prices climbed.\n\nSo one international conflict can create a chain reaction across financial markets.\n\n[ENDING]\n\nThe stock market really said: “I don\'t like this.”',NULL,'filmed','2026-09-02 14:36:51','2026-09-02 14:36:51'),(8,11,'Why Are People Turning Against AI Data Centres?','[HOOK]\n\nPeople wanted AI.\n\nNow they\'re protesting the buildings that power it.\n\n[BODY]\n\nAI data centres are expanding rapidly around the world.\n\nBut these facilities can consume enormous amounts of electricity and water.\n\nAnd that\'s creating a new problem.\n\nCommunities near proposed data centres are increasingly asking:\n\n“How much is this actually going to cost us?”\n\nSupporters say data centres are essential for the AI economy.\n\nCritics argue that local communities shouldn\'t have to deal with higher energy demand, environmental impacts and huge infrastructure projects without having a say.\n\nSo the AI debate is becoming about more than chatbots.\n\nIt\'s becoming about who pays for the technology boom.\n\n[ENDING]\n\nWould you want a giant AI data centre built next to your home?',NULL,'filmed','2026-09-02 14:37:28','2026-09-02 14:37:28'),(9,12,'Why Is Extreme Weather Getting So Dangerous?','[HOOK]\n\nExtreme weather is becoming a huge story around the world.\n\nBut what\'s actually happening?\n\n[BODY]\n\nThis year has already brought major heat, droughts, wildfires and floods in different parts of the world.\n\nThe World Meteorological Organization says record land and ocean temperatures, along with extreme weather, have continued through July and early August.\n\nAnd now scientists are also watching a strengthening El Niño, which can affect weather patterns around the world.',NULL,'draft','2026-09-02 14:37:56','2026-09-02 14:37:56');
/*!40000 ALTER TABLE `scripts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `youtube_channel_id` varchar(50) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'Demo Creator','creator@example.com',NULL,'UCjaV7CfsUqdevbz3PrjK0EA','2026-08-31 18:44:04'),(2,'elena','elena@example.com','placeholder','UCjaV7CfsUqdevbz3PrjK0EA','2026-08-31 19:56:25');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'content_creator_db'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-09-02 22:18:05
