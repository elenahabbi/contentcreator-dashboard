// backend/services/youtubeService.js
//
// Thin, read-only wrapper around YouTube Data API v3. Handles:
//   - extracting a video ID from a pasted URL (or a bare ID)
//   - fetching genuine public video statistics
//   - fetching genuine public channel statistics (not wired to a route yet)
//
// No OAuth, no writes, no data invented. If YouTube doesn't provide a
// value (e.g. share count), this module returns null for it rather than
// guessing — callers must not backfill a fake number.

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

class YouTubeServiceError extends Error {
  constructor(message, { status = 502, code = "YOUTUBE_API_ERROR" } = {}) {
    super(message);
    this.name = "YouTubeServiceError";
    this.status = status;
    this.code = code;
  }
}

// Matches the video ID out of the common URL shapes creators paste.
// Order matters: watch URLs can carry other query params before/after `v=`.
const VIDEO_URL_PATTERNS = [
  /youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/,
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
];
const BARE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
// YouTube channel IDs are 24 characters and normally begin with "UC".
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Extracts an 11-character YouTube video ID from a URL the user pasted,
 * or returns the input as-is if it already looks like a bare video ID.
 * Returns null if nothing recognizable was found (caller should treat
 * that as a validation error, not silently continue).
 */
function extractVideoId(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (BARE_ID_PATTERN.test(trimmed)) return trimmed;

  for (const pattern of VIDEO_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function getApiKey() {
  const key = process.env.GOOGLE_API_KEY;
  // "..." is the placeholder shipped in .env.example-style files — treat
  // it the same as "not configured" rather than sending it to Google.
  if (!key || key === "...") {
    throw new YouTubeServiceError(
      "YouTube API is not configured. Set a real GOOGLE_API_KEY in backend/.env.",
      { status: 500, code: "MISSING_API_KEY" }
    );
  }
  return key;
}

async function callYouTubeApi(path) {
  const apiKey = getApiKey();
  const url = `${YOUTUBE_API_BASE}${path}${path.includes("?") ? "&" : "?"}key=${apiKey}`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    // Never log the URL (it contains the API key) or the raw error object.
    throw new YouTubeServiceError(
      "Could not reach the YouTube API. Check your network connection.",
      { status: 502, code: "NETWORK_ERROR" }
    );
  }

  if (!response.ok) {
    // 403 from this API is almost always quota exhaustion or a bad/restricted
    // key. Map both to a clean, frontend-safe message — never forward
    // Google's raw error body, which can be verbose and implementation-specific.
    if (response.status === 403) {
      throw new YouTubeServiceError(
        "YouTube API quota exceeded or access denied. Try again later.",
        { status: 429, code: "QUOTA_OR_ACCESS_DENIED" }
      );
    }
    throw new YouTubeServiceError("YouTube API request failed.", {
      status: 502,
      code: "YOUTUBE_API_ERROR",
    });
  }

  return response.json();
}

// ---------------------------------------------------------------------
// OAUTH-AUTHENTICATED CALLS
//
// Everything above this point uses GOOGLE_API_KEY and only ever reads
// PUBLIC data (any video/channel ID, whether or not it belongs to this
// app's creator). That key can never tell us which channel belongs to
// the person who just logged in — for that we need a per-user OAuth
// access token obtained via Google/Passport (see config/passport.js and
// the /auth/youtube routes in server.js). callYouTubeApiWithToken() is
// the OAuth equivalent of callYouTubeApi() above: same error shape,
// but authenticated with a Bearer token instead of an API key, and used
// ONLY to identify the authenticated user's own channel right after
// they connect. It is never used for public video/channel stats.
// ---------------------------------------------------------------------
async function callYouTubeApiWithToken(path, accessToken) {
  const url = `${YOUTUBE_API_BASE}${path}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    throw new YouTubeServiceError(
      "Could not reach the YouTube API. Check your network connection.",
      { status: 502, code: "NETWORK_ERROR" }
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new YouTubeServiceError(
        "YouTube authorization was rejected or has expired. Please reconnect your YouTube account.",
        { status: 401, code: "YOUTUBE_AUTH_REJECTED" }
      );
    }
    throw new YouTubeServiceError("YouTube API request failed.", {
      status: 502,
      code: "YOUTUBE_API_ERROR",
    });
  }

  return response.json();
}

/**
 * Identifies the YouTube channel belonging to the Google account that
 * just completed OAuth, using their access token (never an API key —
 * "mine=true" only means something when the request is authenticated
 * as that specific user). Called exactly once, right after a successful
 * /auth/youtube/callback, so the resulting channel ID can be stored in
 * users.youtube_channel_id without the creator ever typing it in.
 */
async function getMyChannelId(accessToken) {
  if (!accessToken) {
    throw new YouTubeServiceError("Missing YouTube OAuth access token.", {
      status: 400,
      code: "MISSING_ACCESS_TOKEN",
    });
  }

  const data = await callYouTubeApiWithToken("/channels?part=id&mine=true", accessToken);

  const channelId = data.items && data.items[0] && data.items[0].id;
  if (!channelId) {
    throw new YouTubeServiceError(
      "No YouTube channel was found on this Google account.",
      { status: 404, code: "NO_YOUTUBE_CHANNEL" }
    );
  }

  return channelId;
}

/**
 * Retrieves genuine viewCount/likeCount/commentCount for one public video.
 *
 * NOTE: YouTube Data API v3 does not expose a share count anywhere in its
 * response payloads. `shares` is always returned as null here — never
 * fabricate a number for it. Downstream consumers (the sync route, the
 * database) must treat a null share count as "unknown", not "zero".
 */
async function getVideoStatistics(videoId) {
  if (!videoId || !BARE_ID_PATTERN.test(videoId)) {
    throw new YouTubeServiceError("A valid 11-character YouTube video ID is required.", {
      status: 400,
      code: "INVALID_VIDEO_ID",
    });
  }

  const data = await callYouTubeApi(`/videos?part=statistics,snippet&id=${videoId}`);

  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new YouTubeServiceError("No public YouTube video was found for that ID.", {
      status: 404,
      code: "VIDEO_NOT_FOUND",
    });
  }

  const item = data.items[0];
  const stats = item.statistics || {};

  return {
    videoId,
    title: item.snippet?.title || null,
    // Which channel actually owns this video — used by the automatic
    // matching workflow to confirm a candidate/selected video really
    // belongs to the creator's own connected channel before it's linked.
    channelId: item.snippet?.channelId || null,
    views: stats.viewCount !== undefined ? Number(stats.viewCount) : 0,
    likes: stats.likeCount !== undefined ? Number(stats.likeCount) : 0,
    comments: stats.commentCount !== undefined ? Number(stats.commentCount) : 0,
    // Not available from this API. Do not fabricate.
    shares: null,
    recordedAt: new Date().toISOString(),
  };
}

// Minimal decoder for the handful of HTML entities YouTube titles commonly
// contain (e.g. "R&amp;D", "It&#39;s..."). Not a general-purpose HTML
// decoder — just enough so title matching isn't thrown off by encoding.
function decodeHtmlEntities(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Searches ONLY the given channel's own videos for ones whose title is
 * close to `query` — this is never a blind, site-wide YouTube search.
 * Used by the automatic video-matching workflow so the creator never has
 * to paste a URL: we already know their channel (stored once during
 * OAuth, see getMyChannelId()), so we just ask YouTube "what has this
 * channel uploaded that looks like this title?"
 *
 * Uses GOOGLE_API_KEY like the other public-data calls in this file — a
 * channel's uploaded videos are public once published, so no per-user
 * OAuth token is required for this call, only the channel ID itself
 * (which OAuth was used to discover, once, at connect time).
 */
async function searchChannelVideosByTitle(channelId, query, { maxResults = 10 } = {}) {
  if (typeof channelId !== "string" || !CHANNEL_ID_PATTERN.test(channelId.trim())) {
    throw new YouTubeServiceError(
      "A valid YouTube channel ID is required (for example, UC followed by 22 characters).",
      { status: 400, code: "INVALID_CHANNEL_ID" }
    );
  }

  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    throw new YouTubeServiceError(
      "A content title is required to search for a matching video.",
      { status: 400, code: "MISSING_TITLE" }
    );
  }

  const cappedMaxResults = Math.min(Math.max(Number(maxResults) || 10, 1), 25);
  const data = await callYouTubeApi(
    `/search?part=snippet&type=video&order=relevance&maxResults=${cappedMaxResults}` +
      `&channelId=${encodeURIComponent(channelId.trim())}&q=${encodeURIComponent(trimmedQuery)}`
  );

  return (Array.isArray(data.items) ? data.items : [])
    .filter((item) => item.id && item.id.videoId)
    .map((item) => ({
      videoId: item.id.videoId,
      title: decodeHtmlEntities(item.snippet?.title || ""),
      publishedAt: item.snippet?.publishedAt || null,
      // Not every search result guarantees a thumbnail size — fall back
      // gracefully rather than showing a broken image.
      thumbnailUrl:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        null,
    }));
}

/**
 * Retrieves genuine subscriberCount AND the channel's display name/title
 * for a public channel.
 *
 * ROOT CAUSE (PART 5 — "Connected — No name"): this used to request only
 * `part=statistics`, so the API response never included a snippet/title
 * at all, and the `channelName` field callers expect (server.js's
 * /api/youtube/channel and /api/youtube/connection routes both read
 * `info.channelName`) was always undefined — not because the channel
 * name couldn't be retrieved, but because it was never asked for. Adding
 * `snippet` to the same, already-authenticated request retrieves the
 * title with no extra API call.
 */
async function getChannelStatistics(channelId) {
  if (
    typeof channelId !== "string" ||
    !CHANNEL_ID_PATTERN.test(channelId.trim())
  ) {
    throw new YouTubeServiceError(
      "A valid YouTube channel ID is required (for example, UC followed by 22 characters).",
      {
        status: 400,
        code: "INVALID_CHANNEL_ID",
      }
    );
  }

  const cleanChannelId = channelId.trim();
  const data = await callYouTubeApi(
    `/channels?part=snippet,statistics&id=${encodeURIComponent(cleanChannelId)}`
  );

  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new YouTubeServiceError("No public YouTube channel was found for that ID.", {
      status: 404,
      code: "CHANNEL_NOT_FOUND",
    });
  }

  const item = data.items[0];
  const stats = item.statistics || {};

  // Some channels hide their subscriber count. Returning null makes that
  // limitation explicit; the database route will refuse to store it.
  return {
    channelId: cleanChannelId,
    // Genuinely returned by YouTube for every public channel. null only
    // if the API response is ever missing a snippet entirely (never
    // fabricated) — callers should show a clear fallback in that case,
    // not silently imply the name was retrieved.
    channelName: item.snippet?.title || null,
    subscriberCount: stats.hiddenSubscriberCount
      ? null
      : Number(stats.subscriberCount),
    recordedAt: new Date().toISOString(),
  };
}


/**
 * Searches recent public YouTube videos for a creator-selected topic.
 *
 * This deliberately uses the existing Data API key path and returns only
 * simple topic/title/date information needed by the opportunity engine.
 * It does not scrape YouTube, track competitors, or predict performance.
 */
async function searchPublicVideosByTopic(query, { maxResults = 5 } = {}) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    throw new YouTubeServiceError("A topic is required for YouTube search.", {
      status: 400,
      code: "MISSING_TOPIC",
    });
  }

  const cappedMaxResults = Math.min(Math.max(Number(maxResults) || 5, 1), 25);
  const data = await callYouTubeApi(
    `/search?part=snippet&type=video&order=date&maxResults=${cappedMaxResults}` +
      `&q=${encodeURIComponent(trimmedQuery)}`
  );

  return (Array.isArray(data.items) ? data.items : [])
    .filter((item) => item.id && item.id.videoId)
    .map((item) => ({
      videoId: item.id.videoId,
      title: decodeHtmlEntities(item.snippet?.title || ""),
      publishedAt: item.snippet?.publishedAt || null,
      channelTitle: decodeHtmlEntities(item.snippet?.channelTitle || ""),
      thumbnailUrl:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        null,
    }));
}

module.exports = {
  YouTubeServiceError,
  extractVideoId,
  getVideoStatistics,
  getChannelStatistics,
  getMyChannelId,
  searchChannelVideosByTitle,
  searchPublicVideosByTopic,
};