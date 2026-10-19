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
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `scripts`
--

LOCK TABLES `scripts` WRITE;
/*!40000 ALTER TABLE `scripts` DISABLE KEYS */;
INSERT INTO `scripts` VALUES (4,7,'Why Are Oil Prices Rising Again?','[HOOK]\n\nOkay, why is oil suddenly getting more expensive?\n\n[BODY]\n\nOil prices jumped again today as tensions between the United States and Iran escalated.\n\nAnd this matters because oil isn\'t just about petrol.\n\nWhen oil gets more expensive, transportation and production can become more expensive too.\n\nThat can put pressure on prices around the world.\n\nMarkets are already reacting, with Brent crude climbing above 95 dollars a barrel.\n\nSo basically…\n\nsomething happening thousands of kilometres away can eventually affect what people pay for everyday things.\n\n[ENDING]\n\nThe global economy is basically one giant group project.',NULL,'draft','2026-09-02 14:34:20','2026-09-02 14:34:20'),(5,8,'The UN Just Gave a Major Climate Warning','[HOOK]\n\nThe world just got another major climate warning… and it\'s not exactly comforting.\n\n[BODY]\n\nA new UN report says the world is going to exceed the internationally agreed temperature limit.\n\nScientists and climate experts have warned for years about the risks of rising global temperatures.\n\nAnd we\'re already seeing more extreme heat, droughts, wildfires and floods.\n\nBut the report isn\'t saying there\'s nothing we can do.\n\nIt lays out ways the world could still reduce the damage and eventually bring warming back down.\n\nSo the message isn\'t “give up.”\n\nIt\'s more like…\n\nwe\'re running out of time.\n\n[ENDING]\n\nAnd somehow, we\'re still arguing about whether climate change is real.',NULL,'filmed','2026-09-02 14:35:03','2026-09-02 14:35:03'),(6,9,'Is AI About to Overheat the Economy?','[HOOK]\n\nCould AI actually be overheating the economy?\n\n[BODY]\n\nA Federal Reserve official is warning that the AI boom could be getting dangerously hot.\n\nAI investment has exploded, with companies spending huge amounts of money on data centres, chips and new technology.\n\nBut here\'s the problem:\n\nwhen everyone starts pouring money into the same thing because they expect massive returns, prices can rise far beyond what the technology eventually earns.\n\nThat doesn\'t mean AI is a bubble.\n\nBut it does mean economists are starting to ask whether the investment boom can continue at this speed.\n\n[ENDING]\n\nSo… are we watching the next tech revolution, or another bubble?',NULL,'filmed','2026-09-02 14:36:24','2026-09-02 14:36:24'),(7,10,'Why Are Global Markets Falling?','[HOOK]\n\nStocks are falling around the world. Here\'s the simple explanation.\n\n[BODY]\n\nGlobal markets came under pressure today as tensions between the United States and Iran escalated.\n\nInvestors are worried that disruptions around the Strait of Hormuz could affect global energy supplies.\n\nAnd when investors become nervous about oil supplies, inflation and interest rates, they often start moving money into safer assets.\n\nToday, major markets in Asia and Europe fell, while oil prices climbed.\n\nSo one international conflict can create a chain reaction across financial markets.\n\n[ENDING]\n\nThe stock market really said: “I don\'t like this.”',NULL,'filmed','2026-09-02 14:36:51','2026-09-02 14:36:51'),(8,11,'Why Are People Turning Against AI Data Centres?','[HOOK]\n\nPeople wanted AI.\n\nNow they\'re protesting the buildings that power it.\n\n[BODY]\n\nAI data centres are expanding rapidly around the world.\n\nBut these facilities can consume enormous amounts of electricity and water.\n\nAnd that\'s creating a new problem.\n\nCommunities near proposed data centres are increasingly asking:\n\n“How much is this actually going to cost us?”\n\nSupporters say data centres are essential for the AI economy.\n\nCritics argue that local communities shouldn\'t have to deal with higher energy demand, environmental impacts and huge infrastructure projects without having a say.\n\nSo the AI debate is becoming about more than chatbots.\n\nIt\'s becoming about who pays for the technology boom.\n\n[ENDING]\n\nWould you want a giant AI data centre built next to your home?',NULL,'filmed','2026-09-02 14:37:28','2026-09-02 14:37:28'),(9,12,'Why Is Extreme Weather Getting So Dangerous?','[HOOK]\n\nExtreme weather is becoming a huge story around the world.\n\nBut what\'s actually happening?\n\n[BODY]\n\nThis year has already brought major heat, droughts, wildfires and floods in different parts of the world.\n\nThe World Meteorological Organization says record land and ocean temperatures, along with extreme weather, have continued through July and early August.\n\nAnd now scientists are also watching a strengthening El Niño, which can affect weather patterns around the world.',NULL,'draft','2026-09-02 14:37:56','2026-09-02 14:37:56'),(10,17,'When judgement comes (Proverb 133)','**Proverbs 11:4**\n\n“Riches profit not in the day of wrath: but righteousness delivereth from death.”\n\nThere\'s a day when your money won\'t be able to save you.\n\nYour possessions won\'t matter.\n\nYour status won\'t matter.\n\nYour bank account won\'t matter.\n\nBecause when God\'s judgement comes, earthly riches have no power to deliver you.\n\nSo don\'t spend your life storing up what cannot save you.\n\nPursue righteousness.',NULL,'draft','2026-09-10 15:20:56','2026-09-10 15:20:56'),(11,19,'God\'s Ultimate Answer To Pain | Job 38-39 study','DRAFT FOUR\n\nJob’s suffering recap\nYou might be suffering\nYou might be asking\nI was asking\nJob 38-39 is God answering\n\n\nCHAPTER CARD 01 - WHY GOD? WHEN GOD? HOW GOD? \n\nThe irony of the answers: brief intro\n\n1 Then the Lord answered Job out of the whirlwind, and said,\n\n2 Who is this that darkeneth counsel by words without knowledge?\n\n3 Gird up now thy loins like a man; for I will demand of thee, and answer thou me.\n\n4 Where wast thou when I laid the foundations of the earth? Declare, if thou hast understanding.\n\nWow, so many questions\nOuch, God: us, me\nOuch, God: Job\n\nJob 13:23-24\n“How many are mine iniquities and sins? make me to know my transgression and my sin.\nWherefore hidest thou thy face, and holdest me for thine enemy?” \n\nJob 23:8-9\n“Behold, I go forward, but he is not there; and backward, but I cannot perceive him:\nOn the left hand, where he doth work, but I cannot behold him: he hideth himself on the right hand, that I cannot see him.” \n\n\n\nCHAPTER CARD 02 - WHERE IS GOD?\n\nJob’s real question\nHow pain can go on for so long that the question becomes where God is\nThis was the answer\n\n36 Who hath put wisdom in the inward parts? or who hath given understanding to the heart?\nThe One who has all wisdom lives in us.\n\n41 Who provideth for the raven his food? when his young ones cry unto God, they wander for lack of meat.\nThe provider of the ravens and the lions and the sustainer of everything that exists lives in us\n\nWe may not know \n6 Whereupon are the foundations thereof fastened?\n19 Where is the way where light dwelleth? and as for darkness, where is the place thereof,\n\nWe may not have \nentered into the springs of the sea? or hast thou walked in the search of the depth?\nentered into the treasures of the snow? or hast thou seen the treasures of the hail\n\nBut we know\n5 Who hath laid the measures thereof\n8… who shut up the sea with doors\n25 Who hath divided a watercourse for the overflowing of waters, or a way for the lightning of thunder;\n\n\n\nCHAPTER CARD 02 - GOD IS HERE\n\nJer 9\n23. Thus saith the LORD, Let not the wise man glory in his wisdom, neither let the mighty man glory in his might, let not the rich man glory in his riches:\n24. but let him that glorieth glory in this, that he understandeth and knoweth me, that I am the LORD which exercise lovingkindness, judgment, and righteousness, in the earth: for in these things I delight, saith the LORD.\n\nHow much access we have to God’s Word\nHow much we experience God’s presence\nGod sitting with us in the pain: Biblical examples\nGod sitting with us in the pain: Personal examples\nThe work is done anyway\nBeing Unashamed\n\n36 Who hath put wisdom in the inward parts? or who hath given understanding to the heart?\n\nGod, the solution to it all\n\nCLOSING',NULL,'posted','2026-09-24 12:01:03','2026-09-24 12:01:03');
/*!40000 ALTER TABLE `scripts` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-19 14:29:24
