-- =====================================================================
-- Migration 01 — link a scheduled item to the published post on the
-- external platform (additive only, no data is changed or removed).
--
-- scheduled_content is one row per (content, platform), which is exactly
-- where a platform-specific reference belongs: the same content can be a
-- YouTube video ID and a TikTok video ID at the same time.
--
-- Run in MySQL Workbench against the content_creator_db schema.
-- Check first whether the columns already exist:
--     SHOW COLUMNS FROM content_creator_db.scheduled_content;
-- If external_content_id / external_content_url are already listed,
-- skip this migration.
-- =====================================================================

USE `content_creator_db`;

ALTER TABLE `scheduled_content`
  ADD COLUMN `external_content_id` VARCHAR(255) NULL DEFAULT NULL AFTER `status`,
  ADD COLUMN `external_content_url` VARCHAR(500) NULL DEFAULT NULL AFTER `external_content_id`;
