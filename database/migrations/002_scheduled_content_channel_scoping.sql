-- database/migrations/002_scheduled_content_channel_scoping.sql
--
-- PART 4 FIX — per-channel analytics scoping
--
-- Problem: performance_metrics/content/scheduled_content had no column
-- recording which YouTube channel was connected at the moment a video
-- was linked to a scheduled item. That meant switching connected
-- YouTube channels (Analytics page -> disconnect/reconnect) never hid a
-- previously-connected channel's synced metrics from the "current
-- channel" analytics views -- there was nothing to filter on.
--
-- backend/server.js already assumes this column exists everywhere it
-- matters (getConnectedYoutubeChannelId, hasChannelScopingColumn,
-- YT_CHANNEL_SCOPE_SQL, linkYoutubeVideo, PUT /scheduled-content/:id) and
-- degrades gracefully with a console warning if it's missing -- nothing
-- crashes without this migration, but channel scoping silently doesn't
-- happen until it's run.
--
-- Safe to run more than once (IF NOT EXISTS on both statements).
-- Requires MySQL 8.0+ or MariaDB 10.0.2+.

ALTER TABLE `scheduled_content`
  ADD COLUMN IF NOT EXISTS `youtube_channel_id` varchar(24) DEFAULT NULL
  AFTER `external_content_url`;

ALTER TABLE `scheduled_content`
  ADD INDEX IF NOT EXISTS `idx_scheduled_content_youtube_channel_id` (`youtube_channel_id`);

-- No data backfill is needed: as of this migration, no existing
-- scheduled_content row has external_content_id set (no video has been
-- linked yet), so there is no pre-existing linked video whose channel
-- attribution would otherwise be missing.