// =======================================================================
// YOUTUBE DATA API v3 SERVICE
//
// All communication with YouTube lives here so server.js only deals with
// clean, already-validated data. Nothing in this file ever logs or returns
// the API key.
//
// IMPORTANT LIMITATION — SHARES:
// YouTube Data API v3 does NOT expose a share count for a video. The
// `statistics` part returns viewCount / likeCount / commentCount (and
// favoriteCount, which is deprecated and always 0). There is no public
// shareCount field. Share counts are only available to the channel owner
// through YouTube Analytics API v2 (OAuth-authenticated, "sharingService"
// dimension), which is out of scope for this public-statistics MVP.
// Therefore `shares` is returned as null and must never be fabricated.
// =======================================================================

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

// Errors that are safe to show a user. `status` is the HTTP status the
// route should reply with; `message` never contains the API key.
class YouTubeServiceError extends Error {
  constructor(message, status = 502, code = "YOUTUBE_ERROR") {
    super(message);
    this.name = "YouTubeServiceError";
    this.status = status;
    this.code = code;
  }
}

// A YouTube video ID is always 11 characters of [A-Za-z0-9_-].
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

// A channel ID is always "UC" + 22 characters of [A-Za-z0-9_-].
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Extracts a YouTube video ID from a URL, or accepts a bare video ID.
 *
 * Supported:
 *   https://www.youtube.com/watch?v=VIDEO_ID (with any extra query params)
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/shorts/VIDEO_ID
 *   https://www.youtube.com/embed/VIDEO_ID
 *   https://www.youtube.com/live/VIDEO_ID
 *   https://m.youtube.com/... and http:// / protocol-less variants
 *   VIDEO_ID on its own
 *
 * @returns {string|null} the 11-character video ID, or null if not found.
 */
function extractYouTubeVideoId(input) {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (trimmed === "") return null;

  if (VIDEO_ID_PATTERN.test(trimmed)) return trimmed;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch (_) {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");

  if (host === "youtu.be") {
    const candidate = url.pathname.split("/").filter(Boolean)[0];
    return VIDEO_ID_PATTERN.test(candidate || "") ? candidate : null;
  }

  if (host !== "youtube.com" && host !== "music.youtube.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[0] === "watch") {
    const candidate = url.searchParams.get("v");
    return VIDEO_ID_PATTERN.test(candidate || "") ? candidate : null;
  }

  if (["shorts", "embed", "live", "v"].includes(segments[0])) {
    const candidate = segments[1];
    return VIDEO_ID_PATTERN.test(candidate || "") ? candidate : null;
  }

  return null;
}

/**
 * Extracts a channel ID from a /channel/UC... URL, or accepts a bare ID.
 * Handle URLs (@name) and legacy /user/ URLs are deliberately NOT resolved
 * here — that needs an extra API call and is not required by the MVP.
 *
 * @returns {string|null}
 */
function extractYouTubeChannelId(input) {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (trimmed === "") return null;

  if (CHANNEL_ID_PATTERN.test(trimmed)) return trimmed;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch (_) {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "channel" && CHANNEL_ID_PATTERN.test(segments[1] || "")) {
    return segments[1];
  }

  return null;
}

function getApiKey() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key || key.trim() === "") {
    throw new YouTubeServiceError(
      "YouTube integration is not configured on the server (missing API key). Add GOOGLE_API_KEY to backend/.env and restart the server.",
      503,
      "MISSING_API_KEY"
    );
  }
  return key.trim();
}

// Counts come back from the API as strings ("1234"). Some are omitted
// entirely when the creator has hidden them (e.g. likes can be hidden),
// in which case we return null rather than pretending the value is 0.
function parseCount(value) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Single place where we actually talk to Google. Uses the global fetch
// built into Node 18+ (this project runs on Node 20) — no extra dependency.
async function callYouTubeApi(endpoint, params) {
  if (typeof fetch !== "function") {
    throw new YouTubeServiceError(
      "This Node.js version has no built-in fetch. Node 18 or newer is required.",
      500,
      "FETCH_UNAVAILABLE"
    );
  }

  const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("key", getApiKey());

  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    // Network-level failure — never include the URL (it carries the key).
    throw new YouTubeServiceError(
      "Could not reach the YouTube API. Check the server's internet connection and try again.",
      502,
      "NETWORK_ERROR"
    );
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const reason = body?.error?.errors?.[0]?.reason || "";

    if (response.status === 403 && (reason === "quotaExceeded" || reason === "rateLimitExceeded")) {
      throw new YouTubeServiceError(
        "The YouTube API quota has been exhausted for today. Try syncing again tomorrow.",
        429,
        "QUOTA_EXCEEDED"
      );
    }
    if (response.status === 400 || response.status === 403) {
      throw new YouTubeServiceError(
        "YouTube rejected the request. The API key may be invalid or the YouTube Data API v3 may not be enabled for it.",
        502,
        "API_KEY_REJECTED"
      );
    }

    throw new YouTubeServiceError(
      `YouTube API request failed (HTTP ${response.status}).`,
      502,
      "API_ERROR"
    );
  }

  return body || {};
}

/**
 * Retrieves genuine public statistics for one video.
 *
 * @param {string} videoId an 11-character YouTube video ID.
 * @returns {Promise<{videoId: string, title: string|null, publishedAt: string|null,
 *   views: number|null, likes: number|null, comments: number|null,
 *   shares: null, sharesUnavailableReason: string, recordedAt: Date}>}
 */
async function getVideoStatistics(videoId) {
  if (!VIDEO_ID_PATTERN.test(String(videoId || ""))) {
    throw new YouTubeServiceError(
      "Invalid YouTube video ID.",
      400,
      "INVALID_VIDEO_ID"
    );
  }

  const data = await callYouTubeApi("videos", {
    part: "statistics,snippet",
    id: videoId,
  });

  const item = Array.isArray(data.items) ? data.items[0] : null;
  if (!item) {
    throw new YouTubeServiceError(
      "No YouTube video found for that ID. It may have been deleted or made private.",
      404,
      "VIDEO_NOT_FOUND"
    );
  }

  const stats = item.statistics || {};

  // Only the fields the application actually needs are returned — the raw
  // API payload is never passed through to the frontend.
  return {
    videoId,
    title: item.snippet?.title || null,
    publishedAt: item.snippet?.publishedAt || null,
    views: parseCount(stats.viewCount),
    likes: parseCount(stats.likeCount),
    comments: parseCount(stats.commentCount),
    shares: null, // see LIMITATION note at the top of this file
    sharesUnavailableReason:
      "YouTube Data API v3 does not expose a share count for videos.",
    recordedAt: new Date(),
  };
}

/**
 * Retrieves public channel statistics (used for follower/subscriber
 * tracking). subscriberCount is hidden by some channels, in which case
 * the API omits it and we return null.
 *
 * @param {string} channelId a "UC..." channel ID.
 */
async function getChannelStatistics(channelId) {
  if (!CHANNEL_ID_PATTERN.test(String(channelId || ""))) {
    throw new YouTubeServiceError(
      "Invalid YouTube channel ID. It should look like UCxxxxxxxxxxxxxxxxxxxxxx.",
      400,
      "INVALID_CHANNEL_ID"
    );
  }

  const data = await callYouTubeApi("channels", {
    part: "statistics,snippet",
    id: channelId,
  });

  const item = Array.isArray(data.items) ? data.items[0] : null;
  if (!item) {
    throw new YouTubeServiceError(
      "No YouTube channel found for that ID.",
      404,
      "CHANNEL_NOT_FOUND"
    );
  }

  const stats = item.statistics || {};

  return {
    channelId,
    title: item.snippet?.title || null,
    subscribers: stats.hiddenSubscriberCount ? null : parseCount(stats.subscriberCount),
    subscribersHidden: Boolean(stats.hiddenSubscriberCount),
    views: parseCount(stats.viewCount),
    videoCount: parseCount(stats.videoCount),
    recordedAt: new Date(),
  };
}

// True when GOOGLE_API_KEY is present. Used by routes that want to report
// a configuration problem before doing database work.
function isConfigured() {
  const key = process.env.GOOGLE_API_KEY;
  return Boolean(key && key.trim() !== "");
}

module.exports = {
  YouTubeServiceError,
  extractYouTubeVideoId,
  extractYouTubeChannelId,
  getVideoStatistics,
  getChannelStatistics,
  isConfigured,
};
