-- =====================================================================
-- Migration 02 — OPTIONAL, only needed for subscriber (follower) sync.
--
-- follower_metrics already stores (user_id, platform_id, recorded_at,
-- follower_count); the only thing missing is which YouTube channel
-- belongs to the creator. The smallest defensible change is one nullable
-- column on users — no OAuth, no new table, no new authentication.
--
-- If the project later supports several accounts per platform, this can
-- be superseded by a platform_accounts table; the column is nullable so
-- nothing breaks in the meantime.
--
-- Run in MySQL Workbench against content_creator_db, then set the value:
--   UPDATE users SET youtube_channel_id = 'UCxxxxxxxxxxxxxxxxxxxxxx'
--   WHERE user_id = 1;
-- (The UC… ID is shown at youtube.com/account_advanced while signed in.)
-- =====================================================================

USE `content_creator_db`;

ALTER TABLE `users`
  ADD COLUMN `youtube_channel_id` VARCHAR(50) NULL DEFAULT NULL AFTER `password_hash`;
