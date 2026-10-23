console.log("Backend server starting...");
require("dotenv").config();

const path = require("path");
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { passport, isGoogleOAuthConfigured } = require("./config/passport");
const youtubeService = require("./services/youtubeService");
const { classifyVideoMatch } = require("./services/videoMatcher");
const opportunityEngine = require("./services/opportunityEngine");
const eventRules = require("./services/eventRules");
const recommendationEngine = require("./services/recommendationEngine");

const app = express();

const corsOrigin = process.env.FRONTEND_URL || "http://localhost:3000";

// The frontend is sometimes opened through VS Code Live Server (for example
// http://127.0.0.1:5500) during local development instead of being served by
// Express itself. Keep the configured FRONTEND_URL as the primary origin,
// but also allow local loopback origins so the browser can send the existing
// session cookie to the API. This does not open CORS to arbitrary websites.
function isAllowedCorsOrigin(origin) {
  if (!origin || origin === corsOrigin) return true;

  try {
    const url = new URL(origin);
    const isLocalLoopback =
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:");

    return isLocalLoopback;
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedCorsOrigin(origin)) return callback(null, true);
      return callback(new Error("CORS origin is not allowed."));
    },
    credentials: true,
  })
);
app.use(express.json());

// Serves the existing vanilla frontend as-is (no build step, no changes
// to any frontend file's location). This also gives the app a stable
// http://localhost:3000 origin to redirect back to once Google OAuth
// finishes — see FRONTEND_URL and the /auth/youtube/callback route below.
app.use(express.static(path.join(__dirname, "..", "frontend")));

// ---------------------------------------------------------------------
// SESSION + PASSPORT (YouTube OAuth connection only)
// A session is required for Passport to carry state between
// GET /auth/youtube and GET /auth/youtube/callback. It is intentionally
// minimal: nothing about "being logged in" is tracked here, and the
// per-request session data created during OAuth is cleared (req.logout)
// as soon as the callback route has used it. See config/passport.js.
// ---------------------------------------------------------------------
if (!process.env.SESSION_SECRET) {
  console.warn(
    "[server] SESSION_SECRET is not set in backend/.env — using an insecure " +
      "development-only fallback. Set a real SESSION_SECRET before deploying."
  );
}

// PHASE 1: this session cookie now backs two things that share the same
// browser session — Passport's short OAuth round-trip (see config/passport.js)
// and the real "am I logged in" state for the app (req.session.userId, set
// by /auth/login and /auth/register below). It needs to survive more than a
// few minutes for that second use, so the maxAge below is now a real login
// duration, not just "long enough for a redirect to Google and back".
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // set true once the app is served over HTTPS
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days — a real login session, not just an OAuth round-trip
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Where to send the browser back to once the OAuth round-trip (which
// happens entirely on this server's own origin) is done. Defaults to
// this same server, since it now serves the frontend (see express.static
// above); override in .env if the frontend is served elsewhere.
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// ---------------------------------------------------------------------
// PHASE 1 — APPLICATION AUTHENTICATION
// Replaces the old DEFAULT_USER_ID single-user assumption. Every route
// that reads/writes a specific creator's data now gets that creator's
// real id from req.session.userId (set by /auth/login or /auth/register
// below), never from a fixed constant and never from anything the client
// sends. requireAuth() rejects any request with no active session before
// the route handler ever runs; getUserId() is a small helper so route
// code reads req.session.userId in one consistent place.
// ---------------------------------------------------------------------
const SALT_ROUNDS = 10;

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: "Authentication required. Please log in." });
  }
  next();
}

function getUserId(req) {
  return req.session.userId;
}

// DATABASE CONNECTION (pooled, promise-based)
const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: process.env.DB_PASSWORD,
  database: "content_creator_db",
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
});

db.getConnection()
  .then((conn) => {
    console.log("Connected to MySQL!");
    conn.release();
  })
  .catch((err) => console.error("Database connection failed:", err));

// Wraps an async route handler so thrown/rejected errors reach Express's
// error handler instead of crashing the process or hanging the request.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// =======================================================================
// APPLICATION AUTHENTICATION (Phase 1)
// This is the real "who is using this app" login system — separate from
// the Google OAuth flow further down, which only ever connects a YouTube
// channel and never establishes an app session by itself. These four
// routes are the only ones that write/read req.session.userId directly;
// every other route below either requires it via requireAuth() or reads
// it via getUserId(req).
// =======================================================================

// A fixed, pre-computed bcrypt hash of a random value that is never a
// real password. Used only when no matching user is found, so that
// /auth/login always performs one bcrypt.compare() call either way —
// this keeps a wrong-username response and a wrong-password response
// taking roughly the same amount of time, instead of a missing user
// short-circuiting instantly and leaking (via timing) whether a given
// username/email exists.
const DUMMY_PASSWORD_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8u1QAaAO7lCXQ3iH8/Y7t8u5m1Q7dK";

app.post(
  "/auth/register",
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body || {};

    if (!username || !email || !password) {
      return res.status(400).json({ message: "username, email and password are required" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ message: "password must be at least 8 characters" });
    }

    const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);

    let insertId;
    try {
      const [result] = await db.query(
        `INSERT INTO users (username, email, password_hash, created_at)
         VALUES (?, ?, ?, NOW())`,
        [username, email, passwordHash]
      );
      insertId = result.insertId;
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "That username or email is already registered." });
      }
      throw err;
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ message: "Could not start session after registration" });
      req.session.userId = insertId;
      res.status(201).json({ user_id: insertId, username, email });
    });
  })
);

app.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "username (or email) and password are required" });
    }

    const [rows] = await db.query(
      "SELECT user_id, username, email, password_hash FROM users WHERE username = ? OR email = ? LIMIT 1",
      [username, username]
    );
    const user = rows[0];

    // See DUMMY_PASSWORD_HASH above: this bcrypt.compare() always runs,
    // whether or not `user` was found, so login timing doesn't reveal
    // whether the username/email exists.
    const passwordMatches = await bcrypt.compare(
      String(password),
      (user && user.password_hash) || DUMMY_PASSWORD_HASH
    );

    if (!user || !user.password_hash || !passwordMatches) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ message: "Could not start session" });
      req.session.userId = user.user_id;
      res.json({ user_id: user.user_id, username: user.username, email: user.email });
    });
  })
);

app.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: "Could not log out" });
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out" });
  });
});

app.get(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      "SELECT user_id, username, email, youtube_channel_id FROM users WHERE user_id = ?",
      [getUserId(req)]
    );
    if (rows.length === 0) {
      // The logged-in user's row no longer exists (deleted directly in
      // the DB) — treat the session as no longer valid.
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Not logged in" });
    }
    res.json(rows[0]);
  })
);

// =======================================================================
// PHASE 4 — CREATOR PROFILE, TOPICS, ONBOARDING
// Requires database/phase4_creator_profiles_topics.sql to have been run.
// Every route uses requireAuth + getUserId(req); no user id is ever read
// from the request body, query string, or URL.
// =======================================================================

const PROFILE_LIMITS = { displayName: 100, niche: 100, bio: 500, topic: 60, maxTopics: 20 };

// Trim, collapse inner whitespace, reject control characters / angle
// brackets and over-long values. Returns the cleaned string or null.
function normalizeTopicName(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > PROFILE_LIMITS.topic) return null;
  if (/[\u0000-\u001f\u007f<>]/.test(cleaned)) return null;
  return cleaned;
}

// Returns { value } (string or null) or { error }. Empty optional text
// becomes null; required text must be non-empty.
function cleanProfileText(raw, label, max, required) {
  if (raw === null || raw === undefined) raw = "";
  if (typeof raw !== "string") return { error: `${label} must be text.` };
  const value = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (/[\u0000-\u001f\u007f<>]/.test(value)) return { error: `${label} contains invalid characters.` };
  if (!value) return required ? { error: `${label} is required.` } : { value: null };
  if (value.length > max) return { error: `${label} must be ${max} characters or fewer.` };
  return { value };
}

// Never leaks SQL text or stack traces to the browser. A missing table
// (migration not run yet) is reported as 503 so the frontend can tell it
// apart from "this user has no profile yet" (which is a normal 200).
function sendProfileError(res, err) {
  if (err && err.code === "ER_NO_SUCH_TABLE") {
    return res.status(503).json({
      code: "PROFILE_SCHEMA_MISSING",
      message: "Profile storage is not set up yet. The Phase 4 database migration has not been run.",
    });
  }
  console.error("[profile] request failed:", err && (err.code || err.message));
  return res.status(500).json({ message: "Could not complete the profile request. Please try again." });
}

async function loadCreatorProfile(userId) {
  const [profiles] = await db.query(
    `SELECT display_name, primary_niche, bio, onboarding_completed_at
       FROM creator_profiles WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  const [topics] = await db.query(
    "SELECT topic_id, topic_name FROM creator_topics WHERE user_id = ? ORDER BY topic_name",
    [userId]
  );
  const p = profiles[0] || null;
  return {
    profile: p
      ? { display_name: p.display_name, primary_niche: p.primary_niche, bio: p.bio }
      : null,
    topics,
    onboarding_completed: !!(p && p.onboarding_completed_at),
  };
}

// Available to later phases (opportunity engine). Not used by Phase 4
// routes and deliberately separate from getCreatorTopics(), which returns
// category-based topics derived from content and must keep that shape.
async function getCreatorProfileTopics(userId) {
  const [rows] = await db.query(
    "SELECT topic_id, topic_name FROM creator_topics WHERE user_id = ? ORDER BY topic_name",
    [userId]
  );
  return rows;
}

app.get(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      res.json(await loadCreatorProfile(getUserId(req)));
    } catch (err) {
      sendProfileError(res, err);
    }
  })
);

// Create or update. Only the fields present in the body are changed, so
// an unrelated update never wipes the others.
app.put(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = req.body || {};
    const changes = {};

    if (body.display_name !== undefined) {
      const r = cleanProfileText(body.display_name, "Display name", PROFILE_LIMITS.displayName, true);
      if (r.error) return res.status(400).json({ message: r.error });
      changes.display_name = r.value;
    }
    let nicheInput = null; // validated against `categories` once we know the stored value
    if (body.primary_niche !== undefined) {
      const r = cleanProfileText(body.primary_niche, "Primary niche", PROFILE_LIMITS.niche, false);
      if (r.error) return res.status(400).json({ message: r.error });
      changes.primary_niche = r.value;
      nicheInput = r.value;
    }
    if (body.bio !== undefined) {
      const r = cleanProfileText(body.bio, "Bio", PROFILE_LIMITS.bio, false);
      if (r.error) return res.status(400).json({ message: r.error });
      changes.bio = r.value;
    }

    try {
      const [existing] = await db.query(
        "SELECT user_id, primary_niche FROM creator_profiles WHERE user_id = ? LIMIT 1",
        [userId]
      );

      // Niche must be one of the shared categories (stored as the canonical
      // category name). A legacy free-text niche that is already saved may be
      // kept unchanged, but no new free-text value is accepted.
      if (nicheInput) {
        const category = await findCategory({ name: nicheInput });
        if (category) {
          changes.primary_niche = category.category_name;
        } else {
          const stored = existing[0] && existing[0].primary_niche;
          if (!stored || categoryKey(stored) !== categoryKey(nicheInput)) {
            return res.status(400).json({ message: "Choose a primary niche from the list." });
          }
          changes.primary_niche = stored;
        }
      }

      if (!existing.length) {
        if (!changes.display_name) {
          return res.status(400).json({ message: "Display name is required." });
        }
        try {
          await db.query(
            `INSERT INTO creator_profiles (user_id, display_name, primary_niche, bio)
             VALUES (?, ?, ?, ?)`,
            [userId, changes.display_name, changes.primary_niche || null, changes.bio || null]
          );
        } catch (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ message: "Profile was just created in another tab. Please retry." });
          }
          throw err;
        }
      } else {
        const columns = Object.keys(changes); // whitelisted names above, never user input
        if (columns.length) {
          await db.query(
            `UPDATE creator_profiles SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE user_id = ?`,
            [...columns.map((c) => changes[c]), userId]
          );
        }
      }

      res.json(await loadCreatorProfile(userId));
    } catch (err) {
      sendProfileError(res, err);
    }
  })
);

app.post(
  "/profile/topics",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const body = req.body || {};

    // A topic is a shared category, chosen by category_id (preferred) or by
    // name. The canonical category name is what gets stored, so the same
    // topic can never be saved under two spellings.
    let category = null;
    if (body.category_id !== undefined && body.category_id !== null && body.category_id !== "") {
      category = await findCategory({ id: body.category_id });
    } else {
      const requested = normalizeTopicName(body.topic_name);
      if (!requested) {
        return res.status(400).json({
          message: `Topic must be 1-${PROFILE_LIMITS.topic} characters of plain text.`,
        });
      }
      category = await findCategory({ name: requested });
    }
    if (!category) {
      return res.status(400).json({ message: "Choose a topic from the list." });
    }
    const topicName = category.category_name;

    try {
      const [existingTopics] = await db.query(
        "SELECT topic_name FROM creator_topics WHERE user_id = ?",
        [userId]
      );
      if (existingTopics.some((t) => categoryKey(t.topic_name) === categoryKey(topicName))) {
        return res.status(409).json({ message: "You already have that topic." });
      }
      const total = existingTopics.length;
      if (total >= PROFILE_LIMITS.maxTopics) {
        return res.status(400).json({ message: `You can keep up to ${PROFILE_LIMITS.maxTopics} topics.` });
      }

      const [result] = await db.query(
        "INSERT INTO creator_topics (user_id, topic_name) VALUES (?, ?)",
        [userId, topicName]
      );
      res.status(201).json({ topic_id: result.insertId, topic_name: topicName });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "You already have that topic." });
      }
      sendProfileError(res, err);
    }
  })
);

app.delete(
  "/profile/topics/:topicId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const topicId = Number(req.params.topicId);
    if (!Number.isInteger(topicId) || topicId <= 0) {
      return res.status(400).json({ message: "Invalid topic id." });
    }
    try {
      // user_id in the WHERE clause is the ownership check. Someone else's
      // topic id produces the same 404 as a nonexistent one.
      const [result] = await db.query(
        "DELETE FROM creator_topics WHERE topic_id = ? AND user_id = ?",
        [topicId, getUserId(req)]
      );
      if (!result.affectedRows) return res.status(404).json({ message: "Topic not found." });
      res.json({ message: "Topic removed." });
    } catch (err) {
      sendProfileError(res, err);
    }
  })
);

// Marks onboarding complete only if the SERVER already holds a display
// name and at least one topic for this user. The browser's claim that it
// finished is never trusted.
app.post(
  "/profile/complete",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    try {
      const state = await loadCreatorProfile(userId);
      if (!state.profile || !state.profile.display_name) {
        return res.status(400).json({ message: "Save your display name before finishing setup." });
      }
      if (!state.topics.length) {
        return res.status(400).json({ message: "Add at least one topic before finishing setup." });
      }
      await db.query(
        `UPDATE creator_profiles
            SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
          WHERE user_id = ?`,
        [userId]
      );
      res.json(await loadCreatorProfile(userId));
    } catch (err) {
      sendProfileError(res, err);
    }
  })
);

// =======================================================================
// AUTOMATIC MISSED-CONTENT DETECTION
// A scheduled item is "missed" the moment its scheduled_date is in the
// past and nobody ever marked it Published. Nothing here asks the creator
// to declare anything missed manually — this just persists what is
// already true. Published and Cancelled rows are never touched.
// =======================================================================
async function updateMissedScheduledContent() {
  await db.query(
    `UPDATE scheduled_content
     SET status = 'Missed'
     WHERE status = 'Scheduled'
       AND scheduled_date < NOW()`
  );
}

// mysql2 returns SUM()/AVG()/ROUND() results as strings (DECIMAL columns
// are stringified to avoid silent precision loss). The frontend/analytics
// layer expects real numbers, so cast the specific aggregate/computed
// fields back to Number before sending JSON. Plain INT columns (views,
// likes, etc.) already come back as numbers and don't need this.
function castNumbers(row, fields) {
  if (!row) return row;
  for (const field of fields) {
    if (row[field] !== undefined && row[field] !== null) {
      row[field] = Number(row[field]);
    }
  }
  return row;
}
function castNumbersAll(rows, fields) {
  rows.forEach((row) => castNumbers(row, fields));
  return rows;
}

// =======================================================================
// PART 4 SUPPORT — per-channel analytics scoping
//
// Root cause (see database/migrations/002_scheduled_content_channel_scoping.sql
// for the full write-up): performance_metrics/content/scheduled_content
// had no column recording which YouTube channel was connected when a
// video was linked, so switching channels never hid a previous channel's
// synced metrics from the "current channel" analytics views — there was
// nothing to filter on. scheduled_content.youtube_channel_id (added by
// that migration) is the fix; these two helpers support it:
//
//   - getConnectedYoutubeChannelId(): the channel analytics should be
//     scoped to right now.
//   - hasChannelScopingColumn(): lets every query below detect whether
//     the migration has actually been run yet, and fall back to the
//     previous (unscoped) behaviour with a one-time warning instead of
//     throwing a SQL error, if it hasn't.
// =======================================================================

async function getConnectedYoutubeChannelId(userId) {
  const [rows] = await db.query(
    "SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return (rows[0] && rows[0].youtube_channel_id) || null;
}

let _hasChannelScopingColumnPromise = null;
function hasChannelScopingColumn() {
  if (!_hasChannelScopingColumnPromise) {
    _hasChannelScopingColumnPromise = db
      .query("SHOW COLUMNS FROM scheduled_content LIKE 'youtube_channel_id'")
      .then(([rows]) => rows.length > 0)
      .catch(() => false);
    _hasChannelScopingColumnPromise.then((has) => {
      if (!has) {
        console.warn(
          "[server] scheduled_content.youtube_channel_id is missing — run " +
            "database/migrations/002_scheduled_content_channel_scoping.sql " +
            "to enable per-channel analytics scoping (PART 4 fix). Analytics " +
            "will keep working, but a previously-connected channel's synced " +
            "metrics may still appear alongside the currently connected " +
            "channel's until that migration is run."
        );
      }
    });
  }
  return _hasChannelScopingColumnPromise;
}

// Shared WHERE fragment: with `pm` = performance_metrics and `p` =
// platforms already joined/aliased in the calling query, this keeps
// every non-YouTube row (nothing else has a channel concept here) and
// only keeps YouTube rows whose linked scheduled_content was stamped
// with the CURRENTLY connected channel id. Expects exactly one `?`
// parameter: the current channel id (or null, which correctly excludes
// every YouTube row when nothing is connected).
const YT_CHANNEL_SCOPE_SQL = `
  (
    LOWER(p.platform_name) <> 'youtube'
    OR EXISTS (
      SELECT 1 FROM scheduled_content sc
      WHERE sc.content_id = pm.content_id
        AND sc.platform_id = pm.platform_id
        AND sc.youtube_channel_id = ?
    )
  )
`;

// =======================================================================
// CREATOR POSTING GOALS
// Requires database/phase_posting_goals.sql to have been run. One row per
// creator in creator_posting_goals. Every route uses requireAuth +
// getUserId(req); no user id is ever read from the body, query or URL.
//
// A goal is a TARGET, not a schedule: progress is simply the number of
// posts actually published in the current day / week / month, compared with
// the creator's target. It is kept separate from Schedule Adherence
// (/analytics/consistency), which only looks at scheduled items that were due.
//
// "Published post" = a scheduled_content row with status 'Published'
// (one per platform it went out on), placed in a window by published_at,
// falling back to scheduled_date when published_at is empty.
// =======================================================================

const POSTING_GOAL_TYPES = ["daily", "weekly", "monthly", "custom"];
const POSTING_GOAL_PERIODS = ["day", "week", "month"];
const POSTING_GOAL_MAX_TARGET = { day: 20, week: 50, month: 200 };

// Static SQL fragments keyed by a whitelisted period — never built from
// request input. Weeks run Monday–Sunday (same as the ISO weeks used by
// /analytics/consistency/trend).
const POSTING_GOAL_WINDOWS = {
  day: {
    label: "today",
    start: "CURDATE()",
    end: "(CURDATE() + INTERVAL 1 DAY)",
  },
  week: {
    label: "this week",
    start: "(CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY)",
    end: "(CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY + INTERVAL 7 DAY)",
  },
  month: {
    label: "this month",
    start: "DATE_FORMAT(CURDATE(), '%Y-%m-01')",
    end: "(DATE_FORMAT(CURDATE(), '%Y-%m-01') + INTERVAL 1 MONTH)",
  },
};

function sendPostingGoalError(res, err) {
  if (err && err.code === "ER_NO_SUCH_TABLE") {
    return res.status(503).json({
      code: "POSTING_GOAL_SCHEMA_MISSING",
      message: "Posting goal storage is not set up yet. The posting goals database migration has not been run.",
    });
  }
  console.error("[posting-goal] request failed:", err && (err.code || err.message));
  return res.status(500).json({ message: "Could not complete the posting goal request. Please try again." });
}

// Returns { value: { goal_type, target_count, period } } or { error }.
function normalizePostingGoalInput(body) {
  const { goal_type, target_count, period } = body || {};

  if (!POSTING_GOAL_TYPES.includes(goal_type)) {
    return { error: "Choose a posting rhythm: daily, weekly, monthly or custom." };
  }

  let resolvedPeriod;
  let resolvedCount;

  if (goal_type === "daily") {
    // "Every day" is always exactly one post per day.
    resolvedPeriod = "day";
    resolvedCount = 1;
  } else {
    resolvedPeriod =
      goal_type === "weekly" ? "week" : goal_type === "monthly" ? "month" : period;
    if (!POSTING_GOAL_PERIODS.includes(resolvedPeriod)) {
      return { error: "Choose whether the custom target is per day, week or month." };
    }
    if (typeof target_count !== "number" || !Number.isInteger(target_count)) {
      return { error: "Number of posts must be a whole number." };
    }
    resolvedCount = target_count;
  }

  const max = POSTING_GOAL_MAX_TARGET[resolvedPeriod];
  if (resolvedCount < 1 || resolvedCount > max) {
    return { error: `Number of posts per ${resolvedPeriod} must be between 1 and ${max}.` };
  }

  return { value: { goal_type, target_count: resolvedCount, period: resolvedPeriod } };
}

async function loadPostingGoal(userId) {
  const [rows] = await db.query(
    "SELECT goal_type, target_count, period FROM creator_posting_goals WHERE user_id = ? LIMIT 1",
    [userId]
  );
  if (rows.length === 0) return null;
  return {
    goal_type: rows[0].goal_type,
    target_count: Number(rows[0].target_count),
    period: rows[0].period,
  };
}

async function computePostingGoalProgress(userId, goal) {
  const w = POSTING_GOAL_WINDOWS[goal.period];
  if (!w) return null;

  // scheduled_content has no user_id of its own — ownership is via the
  // parent content row, same as everywhere else in this file.
  const [rows] = await db.query(
    `SELECT COUNT(*) AS published_count
       FROM scheduled_content sc
       JOIN content c ON c.content_id = sc.content_id
      WHERE c.user_id = ?
        AND sc.status = 'Published'
        AND COALESCE(sc.published_at, sc.scheduled_date) >= ${w.start}
        AND COALESCE(sc.published_at, sc.scheduled_date) < ${w.end}`,
    [userId]
  );

  const publishedCount = Number(rows[0].published_count) || 0;
  return {
    period: goal.period,
    window_label: w.label,
    published_count: publishedCount,
    target_count: goal.target_count,
    // goal.target_count is validated >= 1, so this never divides by zero.
    percentage: Number(((publishedCount / goal.target_count) * 100).toFixed(1)),
  };
}

async function buildPostingGoalResponse(userId) {
  const goal = await loadPostingGoal(userId);
  if (!goal) return { goal: null, progress: null };
  return { goal, progress: await computePostingGoalProgress(userId, goal) };
}

app.get(
  "/posting-goal",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      res.json(await buildPostingGoalResponse(getUserId(req)));
    } catch (err) {
      sendPostingGoalError(res, err);
    }
  })
);

app.put(
  "/posting-goal",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = normalizePostingGoalInput(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const userId = getUserId(req);
    const { goal_type, target_count, period } = parsed.value;

    try {
      await db.query(
        `INSERT INTO creator_posting_goals (user_id, goal_type, target_count, period)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE goal_type = ?, target_count = ?, period = ?`,
        [userId, goal_type, target_count, period, goal_type, target_count, period]
      );
      res.json(await buildPostingGoalResponse(userId));
    } catch (err) {
      sendPostingGoalError(res, err);
    }
  })
);

app.delete(
  "/posting-goal",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await db.query("DELETE FROM creator_posting_goals WHERE user_id = ?", [getUserId(req)]);
      res.json({ goal: null, progress: null });
    } catch (err) {
      sendPostingGoalError(res, err);
    }
  })
);

// TEST ROUTE
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// =======================================================================
// PLATFORMS
// =======================================================================

app.get(
  "/platforms",
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      "SELECT platform_id, platform_name, is_active FROM platforms ORDER BY platform_name"
    );
    res.json(rows);
  })
);

// =======================================================================
// CATEGORIES
// Read-only reference data (seeded once, see database/SCHEMA2.sql) plus
// the content_categories join table. Both existed in the schema from the
// start but had zero routes touching them until now. Wiring this up
// gives content planning (Objective 1) real categorisation, and gives
// later phases (opportunity relevance) something concrete to compare a
// creator's own content scope against, instead of inventing a second ad
// hoc "topic" concept. The same table is the single source for the profile
// niche/topic dropdowns and the write.html category list (Phase 2).
// =======================================================================

// Shared category helpers (Phase 2). `categories` is the one source of
// truth for niche, topic and content-category choices.
function categoryKey(name) {
  return String(name === null || name === undefined ? "" : name)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function loadAllCategories() {
  const [rows] = await db.query(
    "SELECT category_id, category_name, description FROM categories ORDER BY category_name"
  );
  return rows;
}

// Finds a category by id or by (case/whitespace-insensitive) name.
// Returns the canonical row or null. Never creates categories.
async function findCategory({ id, name }) {
  const all = await loadAllCategories();
  if (id !== undefined && id !== null && id !== "") {
    const n = Number(id);
    return all.find((c) => c.category_id === n) || null;
  }
  const key = categoryKey(name);
  if (!key) return null;
  return all.find((c) => categoryKey(c.category_name) === key) || null;
}

// Validates a category_ids array from a request body. Returns
// { ids } (ids === undefined when the body did not mention categories, so
// callers keep their "leave existing assignments alone" behaviour) or
// { error }. Duplicates are removed; unknown ids are rejected rather than
// silently dropped or replaced.
async function resolveCategoryIds(raw) {
  if (raw === undefined) return { ids: undefined };
  if (!Array.isArray(raw)) return { error: "category_ids must be an array." };
  const ids = [];
  for (const value of raw) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return { error: "category_ids must contain valid category ids." };
    if (!ids.includes(n)) ids.push(n);
  }
  if (ids.length === 0) return { ids };
  const [rows] = await db.query(
    "SELECT category_id FROM categories WHERE category_id IN (?)",
    [ids]
  );
  if (rows.length !== ids.length) {
    return { error: "One or more selected categories do not exist." };
  }
  return { ids };
}

app.get(
  "/categories",
  asyncHandler(async (req, res) => {
    res.json(await loadAllCategories());
  })
);

// The categories this creator configured through onboarding/profile: their
// primary niche and topics, matched to `categories` by name. Used by
// write.html so its category list follows the profile. When nothing is
// configured (or the profile tables are not available) the full list is
// returned with configured:false so the page still works.
app.get(
  "/categories/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const all = await loadAllCategories();
    const names = [];
    try {
      const [topics] = await db.query(
        "SELECT topic_name FROM creator_topics WHERE user_id = ?",
        [userId]
      );
      topics.forEach((t) => names.push(t.topic_name));
      const [profiles] = await db.query(
        "SELECT primary_niche FROM creator_profiles WHERE user_id = ? LIMIT 1",
        [userId]
      );
      if (profiles[0] && profiles[0].primary_niche) names.push(profiles[0].primary_niche);
    } catch (err) {
      if (err.code !== "ER_NO_SUCH_TABLE") throw err;
    }
    const wanted = new Set(names.map(categoryKey));
    const mine = all.filter((c) => wanted.has(categoryKey(c.category_name)));
    res.json({
      configured: mine.length > 0,
      categories: mine.length > 0 ? mine : all,
    });
  })
);

// Attaches `categories: [{category_id, category_name}]` to each row in
// `items`, matched on `idField` (e.g. "content_id"), using one batched
// query instead of N+1 per-row queries. Rows with no assigned categories
// get `categories: []`, not an omitted field, so the frontend never has
// to null-check it.
async function attachCategories(items, idField) {
  if (items.length === 0) return items;
  const ids = items.map((item) => item[idField]);
  const [rows] = await db.query(
    `SELECT cc.content_id, c.category_id, c.category_name
     FROM content_categories cc
     JOIN categories c ON c.category_id = cc.category_id
     WHERE cc.content_id IN (?)`,
    [ids]
  );
  const byContentId = new Map();
  for (const row of rows) {
    if (!byContentId.has(row.content_id)) byContentId.set(row.content_id, []);
    byContentId.get(row.content_id).push({
      category_id: row.category_id,
      category_name: row.category_name,
    });
  }
  items.forEach((item) => {
    item.categories = byContentId.get(item[idField]) || [];
  });
  return items;
}

// Replaces every category assignment for one content item with
// `categoryIds` (an array of category_id). Pass an empty array to clear
// all categories for that content item. If categoryIds is undefined
// (the caller's request body didn't mention categories at all), this is
// a no-op — existing assignments are left untouched, so a plain
// title/status update never accidentally wipes categorisation.
async function setContentCategories(contentId, categoryIds) {
  if (categoryIds === undefined) return;
  await db.query("DELETE FROM content_categories WHERE content_id = ?", [contentId]);
  const ids = Array.isArray(categoryIds) ? categoryIds.filter((id) => id) : [];
  if (ids.length === 0) return;
  const values = ids.map((categoryId) => [contentId, categoryId]);
  await db.query(
    "INSERT INTO content_categories (content_id, category_id) VALUES ?",
    [values]
  );
}

// =======================================================================
// CONTENT
// =======================================================================

app.get(
  "/content",
  requireAuth,
  asyncHandler(async (req, res) => {
    // Always scoped to the logged-in user — a user_id in the query string
    // (the old behaviour) is never trusted; it is simply ignored now.
    const [rows] = await db.query(
      "SELECT * FROM content WHERE user_id = ? ORDER BY created_at DESC",
      [getUserId(req)]
    );
    await attachCategories(rows, "content_id");
    res.json(rows);
  })
);

app.get(
  "/content/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      "SELECT * FROM content WHERE content_id = ? AND user_id = ?",
      [req.params.id, getUserId(req)]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Content not found" });
    }
    await attachCategories(rows, "content_id");
    res.json(rows[0]);
  })
);

app.post(
  "/content",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { title, description, content_type, status, category_ids } = req.body || {};

    if (!title || !content_type) {
      return res
        .status(400)
        .json({ message: "title and content_type are required" });
    }

    const cats = await resolveCategoryIds(category_ids);
    if (cats.error) return res.status(400).json({ message: cats.error });

    const [result] = await db.query(
      `INSERT INTO content (user_id, title, description, content_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [getUserId(req), title, description || null, content_type, status || "draft"]
    );

    await setContentCategories(result.insertId, cats.ids);

    const [rows] = await db.query("SELECT * FROM content WHERE content_id = ?", [
      result.insertId,
    ]);
    await attachCategories(rows, "content_id");
    res.status(201).json(rows[0]);
  })
);

app.put(
  "/content/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { title, description, content_type, status, category_ids } = req.body || {};
    const { id } = req.params;

    const [existing] = await db.query(
      "SELECT * FROM content WHERE content_id = ? AND user_id = ?",
      [id, getUserId(req)]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Content not found" });
    }

    const cats = await resolveCategoryIds(category_ids);
    if (cats.error) return res.status(400).json({ message: cats.error });

    await db.query(
      `UPDATE content SET
         title = COALESCE(?, title),
         description = COALESCE(?, description),
         content_type = COALESCE(?, content_type),
         status = COALESCE(?, status),
         updated_at = NOW()
       WHERE content_id = ?`,
      [title, description, content_type, status, id]
    );

    await setContentCategories(id, cats.ids);

    const [rows] = await db.query("SELECT * FROM content WHERE content_id = ?", [
      id,
    ]);
    await attachCategories(rows, "content_id");
    res.json(rows[0]);
  })
);

app.delete(
  "/content/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const [result] = await db.query(
        "DELETE FROM content WHERE content_id = ? AND user_id = ?",
        [req.params.id, getUserId(req)]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Content not found" });
      }
      res.json({ message: "Content deleted" });
    } catch (err) {
      if (err.code === "ER_ROW_IS_REFERENCED_2" || err.code === "ER_ROW_IS_REFERENCED") {
        return res.status(409).json({
          message:
            "Cannot delete content: it still has linked scripts or scheduled items. Delete those first.",
        });
      }
      throw err;
    }
  })
);

// =======================================================================
// SCRIPTS
// scripts.script_id / scripts.content_id / scripts.title /
// scripts.script_content / scripts.notes / scripts.status
// =======================================================================

const SCRIPT_SELECT = `
  SELECT
    s.script_id, s.content_id, s.title, s.script_content, s.notes,
    s.status, s.created_at, s.updated_at,
    c.title AS content_title, c.content_type, c.status AS content_status
  FROM scripts s
  JOIN content c ON c.content_id = s.content_id
`;

app.get(
  "/scripts",
  requireAuth,
  asyncHandler(async (req, res) => {
    // Scripts have no user_id of their own — ownership is always via the
    // parent content row, so c.user_id = ? is the actual isolation check.
    const params = [getUserId(req)];
    let sql = `${SCRIPT_SELECT} WHERE c.user_id = ?`;
    if (req.query.content_id) {
      sql += " AND s.content_id = ?";
      params.push(req.query.content_id);
    }
    sql += " ORDER BY s.created_at DESC";
    const [rows] = await db.query(sql, params);
    await attachCategories(rows, "content_id");
    res.json(rows);
  })
);

app.get(
  "/scripts/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      `${SCRIPT_SELECT} WHERE s.script_id = ? AND c.user_id = ?`,
      [req.params.id, getUserId(req)]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Script not found" });
    }
    await attachCategories(rows, "content_id");
    res.json(rows[0]);
  })
);

// CREATE SCRIPT
// If content_id is supplied, the script attaches to that existing content.
// Otherwise a content row is created automatically from title/content_type
// so the existing single-page "write a script" UI doesn't need a separate
// "create content" step.
app.post(
  "/scripts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      title,
      script_content,
      notes,
      status,
      content_id,
      content_type, // used only when auto-creating content ("folder" in the old UI)
      category_ids,
    } = req.body || {};

    if (!title || !script_content) {
      return res.status(400).json({ message: "title and script_content are required" });
    }

    const cats = await resolveCategoryIds(category_ids);
    if (cats.error) return res.status(400).json({ message: cats.error });

    let finalContentId = content_id;

    if (finalContentId) {
      const [contentRows] = await db.query(
        "SELECT content_id FROM content WHERE content_id = ? AND user_id = ?",
        [finalContentId, getUserId(req)]
      );
      if (contentRows.length === 0) {
        return res.status(400).json({ message: "content_id does not reference an existing content item" });
      }
    } else {
      if (!content_type) {
        return res.status(400).json({
          message: "content_id or content_type is required to create a script",
        });
      }
      const [contentResult] = await db.query(
        `INSERT INTO content (user_id, title, description, content_type, status, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'draft', NOW(), NOW())`,
        [getUserId(req), title, content_type]
      );
      finalContentId = contentResult.insertId;
    }

    await setContentCategories(finalContentId, cats.ids);

    const [scriptResult] = await db.query(
      `INSERT INTO scripts (content_id, title, script_content, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [finalContentId, title, script_content, notes || null, status || "draft"]
    );

    const [rows] = await db.query(`${SCRIPT_SELECT} WHERE s.script_id = ?`, [
      scriptResult.insertId,
    ]);
    await attachCategories(rows, "content_id");
    res.status(201).json(rows[0]);
  })
);

app.put(
  "/scripts/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title, script_content, notes, status, content_type, category_ids } = req.body || {};

    const [existing] = await db.query(
      `SELECT s.* FROM scripts s
       JOIN content c ON c.content_id = s.content_id
       WHERE s.script_id = ? AND c.user_id = ?`,
      [id, getUserId(req)]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Script not found" });
    }

    const cats = await resolveCategoryIds(category_ids);
    if (cats.error) return res.status(400).json({ message: cats.error });

    await db.query(
      `UPDATE scripts SET
         title = COALESCE(?, title),
         script_content = COALESCE(?, script_content),
         notes = COALESCE(?, notes),
         status = COALESCE(?, status),
         updated_at = NOW()
       WHERE script_id = ?`,
      [title, script_content, notes, status, id]
    );

    // content_type conceptually belongs to `content`, not `scripts` — if the
    // caller sends it (e.g. the old "folder" selector), update the parent row.
    if (content_type) {
      await db.query(
        "UPDATE content SET content_type = ?, updated_at = NOW() WHERE content_id = ?",
        [content_type, existing[0].content_id]
      );
    }

    await setContentCategories(existing[0].content_id, cats.ids);

    const [rows] = await db.query(`${SCRIPT_SELECT} WHERE s.script_id = ?`, [id]);
    await attachCategories(rows, "content_id");
    res.json(rows[0]);
  })
);

app.delete(
  "/scripts/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [result] = await db.query(
      `DELETE s FROM scripts s
       JOIN content c ON c.content_id = s.content_id
       WHERE s.script_id = ? AND c.user_id = ?`,
      [req.params.id, getUserId(req)]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Script not found" });
    }
    res.json({ message: "Script deleted" });
  })
);

// =======================================================================
// SCHEDULED CONTENT
// (this replaces the old /events-based calendar logic — the real `events`
// table is left untouched, see note in the write-up)
// =======================================================================

const SCHEDULED_SELECT = `
  SELECT
    sc.schedule_id, sc.content_id, sc.platform_id, sc.scheduled_date,
    sc.published_at, sc.status,
    sc.external_content_id, sc.external_content_url,
    CASE
      WHEN sc.status = 'Scheduled' AND sc.scheduled_date < NOW() THEN 'Missed'
      ELSE sc.status
    END AS computed_status,
    c.title AS content_title, c.content_type,
    p.platform_name
  FROM scheduled_content sc
  JOIN content c ON c.content_id = sc.content_id
  JOIN platforms p ON p.platform_id = sc.platform_id
`;

app.get(
  "/scheduled-content",
  requireAuth,
  asyncHandler(async (req, res) => {
    await updateMissedScheduledContent();
    // scheduled_content has no user_id of its own — ownership is always
    // via the parent content row (c.user_id).
    const [rows] = await db.query(
      `${SCHEDULED_SELECT} WHERE c.user_id = ? ORDER BY sc.scheduled_date ASC`,
      [getUserId(req)]
    );
    res.json(rows);
  })
);

app.get(
  "/scheduled-content/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      `${SCHEDULED_SELECT} WHERE sc.schedule_id = ? AND c.user_id = ?`,
      [req.params.id, getUserId(req)]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Scheduled item not found" });
    }
    res.json(rows[0]);
  })
);

// CREATE SCHEDULED CONTENT
// Accepts either a single platform_id or an array platform_ids (the
// calendar UI lets a creator tick several platforms for one piece of
// content on one date) and inserts one scheduled_content row per platform.
app.post(
  "/scheduled-content",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { content_id, platform_id, platform_ids, scheduled_date, status } =
      req.body || {};

    if (!content_id || !scheduled_date) {
      return res
        .status(400)
        .json({ message: "content_id and scheduled_date are required" });
    }

    const ids = Array.isArray(platform_ids) && platform_ids.length
      ? platform_ids
      : platform_id
      ? [platform_id]
      : [];

    if (ids.length === 0) {
      return res.status(400).json({ message: "platform_id or platform_ids is required" });
    }

    const [contentRows] = await db.query(
      "SELECT content_id FROM content WHERE content_id = ? AND user_id = ?",
      [content_id, getUserId(req)]
    );
    if (contentRows.length === 0) {
      return res.status(400).json({ message: "content_id does not reference an existing content item" });
    }

    const [platformRows] = await db.query(
      `SELECT platform_id FROM platforms WHERE platform_id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    if (platformRows.length !== ids.length) {
      return res.status(400).json({ message: "One or more platform_id values do not reference an existing platform" });
    }

    const created = [];
    for (const pid of ids) {
      const [result] = await db.query(
        `INSERT INTO scheduled_content (content_id, platform_id, scheduled_date, status)
         VALUES (?, ?, ?, ?)`,
        [content_id, pid, scheduled_date, status || "Scheduled"]
      );

      // keep content_platforms in sync (ignore if the pair already exists)
      await db.query(
        "INSERT IGNORE INTO content_platforms (content_id, platform_id) VALUES (?, ?)",
        [content_id, pid]
      );

      const [rows] = await db.query(`${SCHEDULED_SELECT} WHERE sc.schedule_id = ?`, [
        result.insertId,
      ]);
      created.push(rows[0]);
    }

    res.status(201).json(ids.length === 1 ? created[0] : created);
  })
);

app.put(
  "/scheduled-content/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { scheduled_date, platform_id, status, published_at, external_content_url } =
      req.body || {};

    const [existing] = await db.query(
      `SELECT sc.* FROM scheduled_content sc
       JOIN content c ON c.content_id = sc.content_id
       WHERE sc.schedule_id = ? AND c.user_id = ?`,
      [id, getUserId(req)]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Scheduled item not found" });
    }

    if (platform_id) {
      const [platformRows] = await db.query(
        "SELECT platform_id FROM platforms WHERE platform_id = ?",
        [platform_id]
      );
      if (platformRows.length === 0) {
        return res.status(400).json({ message: "platform_id does not reference an existing platform" });
      }
    }

    // auto-stamp published_at the first time status becomes Published
    let finalPublishedAt = published_at;
    if (status === "Published" && !published_at && !existing[0].published_at) {
      finalPublishedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    }

    // Linking a published video: this is content the creator is pointing us
    // to, not analytics they're typing in. The external ID is always derived
    // here on the server from the URL — a client-supplied ID is never trusted.
    let finalExternalUrl;
    let finalExternalId;
    let finalYoutubeChannelId;
    const scopingColumnAvailable = await hasChannelScopingColumn();
    if (external_content_url !== undefined) {
      if (external_content_url === null || external_content_url === "") {
        // explicit clear (e.g. "unlink video") — clears the recorded
        // channel attribution along with it, see PART 4.
        finalExternalUrl = null;
        finalExternalId = null;
        finalYoutubeChannelId = null;
      } else {
        const derivedId = youtubeService.extractVideoId(external_content_url);
        if (!derivedId) {
          return res.status(400).json({
            message:
              "Could not recognize that as a YouTube video URL. Paste a link like https://www.youtube.com/watch?v=... , https://youtu.be/... , or a Shorts link.",
          });
        }
        finalExternalUrl = external_content_url;
        finalExternalId = derivedId;
        // Best-effort attribution: unlike find-youtube-video/select-youtube-video,
        // a pasted URL is never verified against the connected channel's own
        // uploads (see youtubeService.getVideoStatistics usage there) — this
        // just records which channel was connected at the moment of linking,
        // for PART 4 analytics scoping. Use those two routes instead of a
        // pasted URL when the video's real channel ownership matters.
        finalYoutubeChannelId = scopingColumnAvailable
          ? await getConnectedYoutubeChannelId(getUserId(req))
          : null;
      }
    }

    const setClauses = [
      "scheduled_date = COALESCE(?, scheduled_date)",
      "platform_id = COALESCE(?, platform_id)",
      "status = COALESCE(?, status)",
      "published_at = COALESCE(?, published_at)",
      "external_content_url = CASE WHEN ? THEN ? ELSE external_content_url END",
      "external_content_id = CASE WHEN ? THEN ? ELSE external_content_id END",
    ];
    const params = [
      scheduled_date,
      platform_id,
      status,
      finalPublishedAt,
      external_content_url !== undefined,
      finalExternalUrl,
      external_content_url !== undefined,
      finalExternalId,
    ];
    if (scopingColumnAvailable) {
      setClauses.push("youtube_channel_id = CASE WHEN ? THEN ? ELSE youtube_channel_id END");
      params.push(external_content_url !== undefined, finalYoutubeChannelId);
    }
    params.push(id);

    await db.query(
      `UPDATE scheduled_content SET ${setClauses.join(", ")} WHERE schedule_id = ?`,
      params
    );

    const [rows] = await db.query(`${SCHEDULED_SELECT} WHERE sc.schedule_id = ?`, [id]);
    res.json(rows[0]);
  })
);

// Convenience endpoint for the "mark as published" test step.
app.patch(
  "/scheduled-content/:id/publish",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const [existing] = await db.query(
      `SELECT sc.* FROM scheduled_content sc
       JOIN content c ON c.content_id = sc.content_id
       WHERE sc.schedule_id = ? AND c.user_id = ?`,
      [id, getUserId(req)]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Scheduled item not found" });
    }

    await db.query(
      `UPDATE scheduled_content SET status = 'Published', published_at = NOW()
       WHERE schedule_id = ?`,
      [id]
    );

    const [rows] = await db.query(`${SCHEDULED_SELECT} WHERE sc.schedule_id = ?`, [id]);
    res.json(rows[0]);
  })
);

// Reverses "Mark as Published" — this is purely an application-state
// revert (Published -> Scheduled). It never touches the real YouTube
// video: external_content_id/external_content_url (the linked video) are
// intentionally left as-is, since unpublishing in this app has nothing to
// do with deleting/unpublishing the actual upload on YouTube. No new
// status value is introduced — Scheduled is already part of the existing
// scheduled_content status vocabulary.
app.patch(
  "/scheduled-content/:id/unpublish",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const [existing] = await db.query(
      `SELECT sc.* FROM scheduled_content sc
       JOIN content c ON c.content_id = sc.content_id
       WHERE sc.schedule_id = ? AND c.user_id = ?`,
      [id, getUserId(req)]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Scheduled item not found" });
    }

    await db.query(
      `UPDATE scheduled_content SET status = 'Scheduled', published_at = NULL
       WHERE schedule_id = ?`,
      [id]
    );

    const [rows] = await db.query(`${SCHEDULED_SELECT} WHERE sc.schedule_id = ?`, [id]);
    res.json(rows[0]);
  })
);

// =======================================================================
// AUTOMATIC YOUTUBE VIDEO MATCHING
// Replaces the old "paste a YouTube URL" workflow. Uses the creator's own
// connected channel (users.youtube_channel_id, set once during OAuth) and
// the scheduled item's own content title — already present via the
// content/scripts relationship, never a new/duplicate title field — to
// find the matching video. This never runs a blind, site-wide YouTube
// search, and it never guesses: an ambiguous result goes back to the
// frontend as candidates for the creator to choose from, and a genuine
// miss is reported as "no match" rather than being forced onto a video
// that might be wrong.
// =======================================================================

async function getScheduleForYoutubeMatch(scheduleId, userId) {
  const [rows] = await db.query(
    `SELECT sc.schedule_id, sc.content_id, sc.platform_id, sc.external_content_id,
            c.title AS content_title, p.platform_name
     FROM scheduled_content sc
     JOIN content c ON c.content_id = sc.content_id
     JOIN platforms p ON p.platform_id = sc.platform_id
     WHERE sc.schedule_id = ? AND c.user_id = ?`,
    [scheduleId, userId]
  );
  return rows[0] || null;
}

function buildYoutubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// Shared by both routes below: the only place that actually writes
// external_content_id/external_content_url once a video has been
// identified, whether that happened automatically or via the creator's
// own selection from a candidate list.
// channelId: the connected channel this video was just verified against
// (both call sites below already look this up before calling here).
// Stamped into scheduled_content.youtube_channel_id so PART 4's
// analytics scoping can tell this video apart from one linked under a
// different, previously-connected channel — see YT_CHANNEL_SCOPE_SQL
// above. Skipped gracefully (falls back to the pre-migration UPDATE) if
// the migration hasn't been run yet.
async function linkYoutubeVideo(scheduleId, videoId, channelId) {
  if (await hasChannelScopingColumn()) {
    await db.query(
      `UPDATE scheduled_content
       SET external_content_id = ?, external_content_url = ?, youtube_channel_id = ?
       WHERE schedule_id = ?`,
      [videoId, buildYoutubeWatchUrl(videoId), channelId || null, scheduleId]
    );
  } else {
    await db.query(
      `UPDATE scheduled_content SET external_content_id = ?, external_content_url = ?
       WHERE schedule_id = ?`,
      [videoId, buildYoutubeWatchUrl(videoId), scheduleId]
    );
  }
  const [rows] = await db.query(`${SCHEDULED_SELECT} WHERE sc.schedule_id = ?`, [scheduleId]);
  return rows[0];
}

// Looks up the connected channel and runs the search + classification.
// Can be called either right after publishing or any time the creator
// explicitly asks to (re)search — the frontend gates *when* the button is
// shown, this route doesn't need to know why it was called.
app.post(
  "/scheduled-content/:id/find-youtube-video",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const schedule = await getScheduleForYoutubeMatch(id, getUserId(req));
    if (!schedule) {
      return res.status(404).json({ message: "Scheduled item not found" });
    }
    if ((schedule.platform_name || "").toLowerCase() !== "youtube") {
      return res.status(400).json({
        message: `This scheduled item is on ${schedule.platform_name || "an unknown platform"}, not YouTube. Automatic video matching currently supports YouTube only.`,
      });
    }

    const [userRows] = await db.query(
      "SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 5",
      [getUserId(req)]
    );
    const channelId = userRows[0] && userRows[0].youtube_channel_id;
    if (!channelId) {
      return res.status(400).json({
        message: "Connect your YouTube account first (see the Analytics page), then try again.",
        code: "YOUTUBE_NOT_CONNECTED",
      });
    }

    let candidates;
    try {
      candidates = await youtubeService.searchChannelVideosByTitle(channelId, schedule.content_title);
    } catch (error) {
      if (error instanceof youtubeService.YouTubeServiceError) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      throw error;
    }

    const result = classifyVideoMatch(schedule.content_title, candidates);

    if (result.matchType === "exact" || result.matchType === "normalized") {
      const scheduled = await linkYoutubeVideo(id, result.match.videoId, channelId);
      return res.json({ matchType: result.matchType, video: result.match, scheduled });
    }

    if (result.matchType === "multiple") {
      return res.json({ matchType: "multiple", candidates: result.candidates });
    }

    res.json({
      matchType: "none",
      message: "No matching video was found on your connected YouTube channel.",
    });
  })
);

// Called when the creator picks one of several candidates returned above.
// The chosen video ID is never trusted blindly — it's re-verified against
// the connected channel before anything is written, the same principle
// already used for URL-derived IDs elsewhere in this file.
app.post(
  "/scheduled-content/:id/select-youtube-video",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { video_id: videoId } = req.body || {};

    if (!videoId) {
      return res.status(400).json({ message: "video_id is required" });
    }

    const schedule = await getScheduleForYoutubeMatch(id, getUserId(req));
    if (!schedule) {
      return res.status(404).json({ message: "Scheduled item not found" });
    }
    if ((schedule.platform_name || "").toLowerCase() !== "youtube") {
      return res.status(400).json({
        message: `This scheduled item is on ${schedule.platform_name || "an unknown platform"}, not YouTube.`,
      });
    }

    const [userRows] = await db.query(
      "SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 5",
      [getUserId(req)]
    );
    const channelId = userRows[0] && userRows[0].youtube_channel_id;
    if (!channelId) {
      return res.status(400).json({
        message: "Connect your YouTube account first (see the Analytics page), then try again.",
        code: "YOUTUBE_NOT_CONNECTED",
      });
    }

    let stats;
    try {
      stats = await youtubeService.getVideoStatistics(videoId);
    } catch (error) {
      if (error instanceof youtubeService.YouTubeServiceError) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      throw error;
    }

    if (stats.channelId !== channelId) {
      return res.status(400).json({
        message: "That video does not belong to your connected YouTube channel.",
      });
    }

    const scheduled = await linkYoutubeVideo(id, videoId, channelId);
    res.json({ matchType: "manual", video: { videoId, title: stats.title }, scheduled });
  })
);

app.delete(
  "/scheduled-content/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [result] = await db.query(
      `DELETE sc FROM scheduled_content sc
       JOIN content c ON c.content_id = sc.content_id
       WHERE sc.schedule_id = ? AND c.user_id = ?`,
      [req.params.id, getUserId(req)]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Scheduled item not found" });
    }
    res.json({ message: "Scheduled item deleted" });
  })
);

// =======================================================================
// PERFORMANCE METRICS
// performance_metrics.metric_id / content_id / platform_id / recorded_at
// views / likes / comments / shares
// =======================================================================

const PERFORMANCE_SELECT = `
  SELECT
    pm.metric_id, pm.content_id, c.title AS content_title,
    pm.platform_id, p.platform_name, pm.recorded_at,
    pm.views, pm.likes, pm.comments, pm.shares,
    CASE
      WHEN pm.views = 0 THEN 0
      ELSE ROUND((pm.likes + pm.comments + pm.shares) / pm.views * 100, 2)
    END AS engagement_rate
  FROM performance_metrics pm
  JOIN content c ON c.content_id = pm.content_id
  JOIN platforms p ON p.platform_id = pm.platform_id
`;

// Every count field must be a non-negative integer. Missing/invalid values
// are rejected outright (per spec: never silently coerce bad data to 0).
function validateMetricCounts(body, { requireAll }) {
  const fields = ["views", "likes", "comments", "shares"];
  const errors = [];
  const parsed = {};

  for (const field of fields) {
    const value = body[field];

    if (value === undefined || value === null) {
      if (requireAll) errors.push(`${field} is required`);
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
      errors.push(`${field} must be an integer`);
      continue;
    }
    if (value < 0) {
      errors.push(`${field} cannot be negative`);
      continue;
    }
    parsed[field] = value;
  }

  return { errors, parsed };
}

app.get(
  "/performance-metrics",
  requireAuth,
  asyncHandler(async (req, res) => {
    // performance_metrics has no user_id of its own — ownership is via
    // the parent content row (c.user_id), same as scripts/scheduled-content.
    const [rows] = await db.query(
      `${PERFORMANCE_SELECT} WHERE c.user_id = ? ORDER BY pm.recorded_at DESC`,
      [getUserId(req)]
    );
    res.json(castNumbersAll(rows, ["engagement_rate"]));
  })
);

app.get(
  "/performance-metrics/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      `${PERFORMANCE_SELECT} WHERE pm.metric_id = ? AND c.user_id = ?`,
      [req.params.id, getUserId(req)]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Performance metric not found" });
    }
    res.json(castNumbers(rows[0], ["engagement_rate"]));
  })
);

app.post(
  "/performance-metrics",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { content_id, platform_id, recorded_at } = req.body || {};

    if (!content_id || !platform_id) {
      return res.status(400).json({ message: "content_id and platform_id are required" });
    }

    const { errors, parsed } = validateMetricCounts(req.body || {}, { requireAll: true });
    if (errors.length > 0) {
      return res.status(400).json({ message: "Invalid metric values", errors });
    }

    const [contentRows] = await db.query(
      "SELECT content_id FROM content WHERE content_id = ? AND user_id = ?",
      [content_id, getUserId(req)]
    );
    if (contentRows.length === 0) {
      return res.status(400).json({ message: "content_id does not reference an existing content item" });
    }

    const [platformRows] = await db.query(
      "SELECT platform_id FROM platforms WHERE platform_id = ?",
      [platform_id]
    );
    if (platformRows.length === 0) {
      return res.status(400).json({ message: "platform_id does not reference an existing platform" });
    }

    const [result] = await db.query(
      `INSERT INTO performance_metrics (content_id, platform_id, recorded_at, views, likes, comments, shares)
       VALUES (?, ?, COALESCE(?, NOW()), ?, ?, ?, ?)`,
      [content_id, platform_id, recorded_at || null, parsed.views, parsed.likes, parsed.comments, parsed.shares]
    );

    const [rows] = await db.query(`${PERFORMANCE_SELECT} WHERE pm.metric_id = ?`, [
      result.insertId,
    ]);
    res.status(201).json(castNumbers(rows[0], ["engagement_rate"]));
  })
);

app.put(
  "/performance-metrics/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const [existing] = await db.query(
      `SELECT pm.* FROM performance_metrics pm
       JOIN content c ON c.content_id = pm.content_id
       WHERE pm.metric_id = ? AND c.user_id = ?`,
      [id, getUserId(req)]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Performance metric not found" });
    }

    const { errors, parsed } = validateMetricCounts(req.body || {}, { requireAll: false });
    if (errors.length > 0) {
      return res.status(400).json({ message: "Invalid metric values", errors });
    }

    // content_id/platform_id are intentionally not editable here — a metric
    // row's identity (which content, which platform) shouldn't change after
    // the fact; delete and re-create if it was logged against the wrong one.
    await db.query(
      `UPDATE performance_metrics SET
         views = COALESCE(?, views),
         likes = COALESCE(?, likes),
         comments = COALESCE(?, comments),
         shares = COALESCE(?, shares)
       WHERE metric_id = ?`,
      [parsed.views, parsed.likes, parsed.comments, parsed.shares, id]
    );

    const [rows] = await db.query(`${PERFORMANCE_SELECT} WHERE pm.metric_id = ?`, [id]);
    res.json(castNumbers(rows[0], ["engagement_rate"]));
  })
);

app.delete(
  "/performance-metrics/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [result] = await db.query(
      `DELETE pm FROM performance_metrics pm
       JOIN content c ON c.content_id = pm.content_id
       WHERE pm.metric_id = ? AND c.user_id = ?`,
      [req.params.id, getUserId(req)]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Performance metric not found" });
    }
    res.json({ message: "Performance metric deleted" });
  })
);

// =======================================================================
// YOUTUBE ACCOUNT CONNECTION (Google OAuth via Passport)
//
// Lets the creator connect their YouTube account so the app can find
// their channel ID automatically instead of it being typed in manually.
// This is separate from GOOGLE_API_KEY (used above/below for public
// video and channel statistics) — OAuth here is used for exactly one
// thing: identifying the authenticated user's own channel right after
// they authorise the app. No OAuth token is ever stored or sent to the
// frontend; only the resulting channel ID is persisted, in the existing
// users.youtube_channel_id column, for whichever creator is logged in.
// =======================================================================

// requireAuth here means: you must be logged into the app itself before
// you can start the "connect my YouTube channel" OAuth round-trip. This
// app-login session (req.session.userId) lives in the same cookie/session
// object Passport uses, but under a different key — passport.authenticate
// and the later req.logout() call below only ever touch their own
// req.session.passport key, so req.session.userId survives the whole
// round-trip untouched. That's what lets the callback route below know
// *which* creator's users row to update.
app.get("/auth/youtube", requireAuth, (req, res, next) => {
  if (!isGoogleOAuthConfigured) {
    return res.redirect(`${FRONTEND_URL}/analytics.html?youtube=config_missing`);
  }

  // Keep the application user's identity separate from Passport's temporary
  // Google identity. The callback must always update the creator who clicked
  // "Connect YouTube", never whichever Google profile Passport last loaded.
  req.session.youtubeOAuthUserId = getUserId(req);
  req.session.save((saveError) => {
    if (saveError) return next(saveError);
    passport.authenticate("google", {
    // profile: minimal identification of the Google account itself.
    // youtube.readonly: the narrowest scope that allows looking up
    // which channel belongs to this account (channels.list?mine=true).
    // Nothing broader (uploads, comments, video management, etc.) is
    // requested, since nothing in this task writes to YouTube.
    scope: ["profile", "https://www.googleapis.com/auth/youtube.readonly"],
    prompt: "select_account",
    })(req, res, next);
  });
});

app.get(
  "/auth/youtube/callback",
  requireAuth,
  (req, res, next) => {
    if (!isGoogleOAuthConfigured) {
      return res.redirect(`${FRONTEND_URL}/analytics.html?youtube=config_missing`);
    }
    passport.authenticate("google", {
      session: true,
      failureRedirect: `${FRONTEND_URL}/analytics.html?youtube=error`,
    })(req, res, next);
  },
  asyncHandler(async (req, res) => {
    const accessToken = req.user && req.user.accessToken;
    const userId = Number(req.session && req.session.youtubeOAuthUserId);

    if (!accessToken || !Number.isInteger(userId) || userId <= 0) {
      return res.redirect(`${FRONTEND_URL}/analytics.html?youtube=error`);
    }

    let channelId;
    try {
      channelId = await youtubeService.getMyChannelId(accessToken);
    } catch (error) {
      console.error("YouTube channel lookup failed:", error.message);
      req.session.youtubeOAuthUserId = null;
      req.logout(() => {});
      return res.redirect(`${FRONTEND_URL}/analytics.html?youtube=error`);
    }

    await db.query("UPDATE users SET youtube_channel_id = ? WHERE user_id = ?", [
      channelId,
      userId,
    ]);

    // OAuth is complete. Clear Passport's temporary Google identity and the
    // one-use application-user marker, but keep req.session.userId intact.
    req.session.youtubeOAuthUserId = null;
    req.logout(() => {});

    res.redirect(`${FRONTEND_URL}/analytics.html?youtube=connected`);
  })
);

// Lets the frontend ask "is YouTube connected?" without ever seeing a
// token — scoped to whichever creator is currently logged in.
app.get(
  "/youtube/connection-status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      "SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 5",
      [getUserId(req)]
    );

    const channelId = rows[0] && rows[0].youtube_channel_id;
    if (!channelId) {
      return res.json({ connected: false });
    }
    res.json({ connected: true, channelId });
  })
);

// =======================================================================
// PERFORMANCE METRICS SYNC (YouTube)
// Pulls genuine statistics from the YouTube Data API for a scheduled
// item's linked video and records them as a new performance_metrics
// snapshot. This route intentionally does NOT accept views/likes/
// comments/shares in the body — those values come exclusively from
// youtubeService, never from the client.
// =======================================================================

app.post(
  "/performance-metrics/sync/:scheduleId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { scheduleId } = req.params;

    const [scheduleRows] = await db.query(
      `SELECT sc.schedule_id, sc.content_id, sc.platform_id,
              sc.external_content_id, p.platform_name
       FROM scheduled_content sc
       JOIN content c ON c.content_id = sc.content_id
       JOIN platforms p ON p.platform_id = sc.platform_id
       WHERE sc.schedule_id = ? AND c.user_id = ?`,
      [scheduleId, getUserId(req)]
    );

    if (scheduleRows.length === 0) {
      return res.status(404).json({ message: "Scheduled item not found" });
    }

    const schedule = scheduleRows[0];

    if ((schedule.platform_name || "").toLowerCase() !== "youtube") {
      return res.status(400).json({
        message: `This scheduled item is on ${schedule.platform_name || "an unknown platform"}, not YouTube. Analytics sync currently supports YouTube only.`,
      });
    }

    if (!schedule.external_content_id) {
      return res.status(400).json({
        message: "No YouTube video is linked to this scheduled item yet. Connect a video URL first.",
      });
    }

    // Any manual counts in the body are ignored on purpose — genuine
    // statistics only come from the YouTube API call below.
    const stats = await youtubeService.getVideoStatistics(schedule.external_content_id);

    // Dedupe guard: if this exact content/platform was synced in the last
    // 60 seconds (e.g. an accidental double-click on "Sync"), update that
    // snapshot instead of inserting a near-duplicate one. Older snapshots
    // are never touched — history is preserved.
    const [recent] = await db.query(
      `SELECT metric_id FROM performance_metrics
       WHERE content_id = ? AND platform_id = ? AND recorded_at >= (NOW() - INTERVAL 60 SECOND)
       ORDER BY recorded_at DESC LIMIT 5`,
      [schedule.content_id, schedule.platform_id]
    );

    let metricId;
    if (recent.length > 0) {
      metricId = recent[0].metric_id;
      await db.query(
        `UPDATE performance_metrics SET views = ?, likes = ?, comments = ?, shares = ?
         WHERE metric_id = ?`,
        [stats.views, stats.likes, stats.comments, stats.shares || 0, metricId]
      );
    } else {
      const [result] = await db.query(
        `INSERT INTO performance_metrics (content_id, platform_id, recorded_at, views, likes, comments, shares)
         VALUES (?, ?, NOW(), ?, ?, ?, ?)`,
        [schedule.content_id, schedule.platform_id, stats.views, stats.likes, stats.comments, stats.shares || 0]
      );
      metricId = result.insertId;
    }

    const [rows] = await db.query(`${PERFORMANCE_SELECT} WHERE pm.metric_id = ?`, [metricId]);
    res.json({
      ...castNumbers(rows[0], ["engagement_rate"]),
      // shares is stored as 0 (schema requires NOT NULL) but the API never
      // provided a real value — surface that distinction to the frontend.
      shares_available: stats.shares !== null,
      video_title: stats.title,
    });
  })
);

// =======================================================================
// YOUTUBE SUBSCRIBER SYNC
// Pulls the creator's public YouTube subscriber count from the YouTube
// Data API and stores it as a historical follower_metrics snapshot.
// The request body is intentionally ignored: subscriber counts are never
// accepted from the client.
// =======================================================================

app.post(
  "/api/analytics/youtube/subscribers/sync",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [userRows] = await db.query(
      `SELECT user_id, youtube_channel_id
       FROM users
       WHERE user_id = ?
       LIMIT 5`,
      [getUserId(req)]
    );

    if (userRows.length === 0) {
      // Can't normally happen once logged in (the session's user_id came
      // from this same table), but handled defensively in case the row
      // was deleted directly in the DB after login.
      return res.status(404).json({
        message: "Your user account was not found.",
        code: "USER_NOT_FOUND",
      });
    }

    const user = userRows[0];

    if (!user.youtube_channel_id) {
      return res.status(400).json({
        message: "Your YouTube channel ID has not been configured.",
        code: "YOUTUBE_CHANNEL_NOT_CONFIGURED",
      });
    }

    const [platformRows] = await db.query(
      `SELECT platform_id
       FROM platforms
       WHERE LOWER(platform_name) = 'youtube'
         AND is_active = 1
       LIMIT 5`
    );

    if (platformRows.length === 0) {
      return res.status(500).json({
        message: "The YouTube platform is not configured in the database.",
        code: "YOUTUBE_PLATFORM_NOT_CONFIGURED",
      });
    }

    const platformId = platformRows[0].platform_id;

        // Prevent accidental duplicate snapshots from repeated clicks within
    // 60 seconds. Existing history is never overwritten. Scoped to the
    // currently connected channel_id so that switching channels and
    // syncing right away is never mistaken for a duplicate of the
    // *previous* channel's last snapshot.
    const [recentRows] = await db.query(
      `SELECT follower_metric_id, recorded_at, follower_count
       FROM follower_metrics
       WHERE user_id = ?
         AND platform_id = ?
         AND channel_id = ?
         AND recorded_at >= (NOW() - INTERVAL 60 SECOND)
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [user.user_id, platformId, user.youtube_channel_id]
    );

    if (recentRows.length > 0) {
      return res.status(200).json({
        message: "YouTube subscribers were synced recently. No duplicate snapshot was created.",
        duplicate: true,
        recorded_at: recentRows[0].recorded_at,
        follower_count: Number(recentRows[0].follower_count),
      });
    }

    let stats;
    try {
      stats = await youtubeService.getChannelStatistics(user.youtube_channel_id);
    } catch (error) {
      if (error instanceof youtubeService.YouTubeServiceError) {
        return res.status(error.status).json({
          message: error.message,
          code: error.code,
        });
      }
      throw error;
    }

    if (stats.subscriberCount === null || !Number.isInteger(stats.subscriberCount) || stats.subscriberCount < 0) {
      return res.status(422).json({
        message: "YouTube subscriber count is unavailable for this channel. The channel may have hidden its subscriber count.",
        code: "SUBSCRIBER_COUNT_UNAVAILABLE",
      });
    }

        const [result] = await db.query(
      `INSERT INTO follower_metrics
        (user_id, platform_id, channel_id, recorded_at, follower_count)
       VALUES (?, ?, ?, NOW(), ?)`,
      [user.user_id, platformId, user.youtube_channel_id, stats.subscriberCount]
    );

    const [savedRows] = await db.query(
      `SELECT recorded_at, follower_count
       FROM follower_metrics
       WHERE follower_metric_id = ?
       LIMIT 5`,
      [result.insertId]
    );

    res.status(201).json({
      message: "YouTube subscribers synced successfully.",
      duplicate: false,
      follower_metric_id: result.insertId,
      recorded_at: savedRows[0].recorded_at,
      follower_count: Number(savedRows[0].follower_count),
    });
  })
);

// =======================================================================
// FOLLOWER ANALYTICS
// Returns YouTube subscriber history and growth calculated from stored
// snapshots. No follower/subscriber count is accepted from the client.
//
// Scoped to users.youtube_channel_id (the currently connected channel) so
// that switching channels can never blend one channel's history into
// another's "current"/"previous"/growth figures. Older snapshots that
// belong to a channel that is no longer connected are NOT deleted — they
// simply stop appearing here, because they are no longer the active
// channel's history. See channel_id on follower_metrics.
// =======================================================================

app.get(
  "/api/analytics/followers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [userRows] = await db.query(
      `SELECT user_id, youtube_channel_id FROM users WHERE user_id = ? LIMIT 1`,
      [getUserId(req)]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        message: "Your user account was not found.",
        code: "USER_NOT_FOUND",
      });
    }

    const user = userRows[0];

    const [platformRows] = await db.query(
      `SELECT platform_id
       FROM platforms
       WHERE LOWER(platform_name) = 'youtube'
         AND is_active = 1
       LIMIT 1`
    );

    if (platformRows.length === 0) {
      return res.status(500).json({
        message: "The YouTube platform is not configured in the database.",
        code: "YOUTUBE_PLATFORM_NOT_CONFIGURED",
      });
    }

    // No channel configured at all — an explicit disconnected state, not
    // zero subscribers and not stale data from whatever was connected before.
    if (!user.youtube_channel_id) {
      return res.json({
        connected: false,
        channelId: null,
        currentSubscribers: null,
        previousSubscribers: null,
        subscriberGrowth: null,
        growthRate: null,
        history: [],
      });
    }

    const [rows] = await db.query(
      `SELECT recorded_at, follower_count
       FROM follower_metrics
       WHERE user_id = ?
         AND platform_id = ?
         AND channel_id = ?
       ORDER BY recorded_at ASC`,
      [getUserId(req), platformRows[0].platform_id, user.youtube_channel_id]
    );

    const history = rows.map((row) => ({
      recorded_at: row.recorded_at,
      follower_count: Number(row.follower_count),
    }));

    const current = history.length >= 1 ? history[history.length - 1].follower_count : null;
    const previous = history.length >= 2 ? history[history.length - 2].follower_count : null;

    let subscriberGrowth = null;
    let growthRate = null;

    if (current !== null && previous !== null) {
      subscriberGrowth = current - previous;
      growthRate = previous === 0
        ? null
        : Number(((subscriberGrowth / previous) * 100).toFixed(2));
    }

    res.json({
      connected: true,
      channelId: user.youtube_channel_id,
      currentSubscribers: current,
      previousSubscribers: previous,
      subscriberGrowth,
      growthRate,
      history,
    });
  })
);

// =======================================================================
// YOUTUBE CHANNEL CONNECTION
// Manages which single YouTube channel is "connected" — the only source
// of truth is users.youtube_channel_id, written here and nowhere else.
// There is no OAuth in this app: connecting a channel means providing its
// public channel ID, which is verified against the real YouTube API
// before being saved (so a typo or fake ID can never silently become
// "connected"). No tokens/keys/secrets are ever returned to the client.
// =======================================================================

// Connect a channel for the first time, or switch to a different one.
// Existing follower_metrics/performance_metrics history is untouched —
// it stays tagged to whichever channel_id it was actually recorded under.
app.post(
  "/api/youtube/channel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rawChannelId = (req.body || {}).channel_id;
    const channelId = typeof rawChannelId === "string" ? rawChannelId.trim() : "";

    if (!channelId) {
      return res.status(400).json({
        message: "A YouTube channel ID is required.",
        code: "CHANNEL_ID_REQUIRED",
      });
    }

    // Confirms the ID is well-formed AND belongs to a real, public
    // channel before we ever write it — never trust the client's input
    // as-is. This is the same lookup the sync route and the status route
    // use, so "connected" always means "YouTube confirmed this channel."
    let info;
    try {
      info = await youtubeService.getChannelStatistics(channelId);
    } catch (error) {
      if (error instanceof youtubeService.YouTubeServiceError) {
        return res.status(error.status).json({
          message: error.message,
          code: error.code,
        });
      }
      throw error;
    }

    await db.query(
      `UPDATE users SET youtube_channel_id = ? WHERE user_id = ?`,
      [info.channelId, getUserId(req)]
    );

    res.json({
      connected: true,
      channelId: info.channelId,
      channelName: info.channelName,
      message: "YouTube channel connected.",
    });
  })
);

// Disconnect the active channel. Per the architecture rules: this clears
// the active connection only — it never deletes follower_metrics or
// performance_metrics history.
app.delete(
  "/api/youtube/channel",
  requireAuth,
  asyncHandler(async (req, res) => {
    await db.query(
      `UPDATE users SET youtube_channel_id = NULL WHERE user_id = ?`,
      [getUserId(req)]
    );

    res.json({
      connected: false,
      channelId: null,
      channelName: null,
      message: "YouTube channel disconnected. Historical analytics were kept.",
    });
  })
);

// Diagnostic status check — lets the frontend confirm which channel the
// backend currently considers "connected" without needing to guess from
// stale local state.

app.get(
  "/api/youtube/connection",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [userRows] = await db.query(
      `SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 1`,
      [getUserId(req)]
    );

    if (userRows.length === 0 || !userRows[0].youtube_channel_id) {
      return res.json({ connected: false, channelId: null, channelName: null });
    }

    const channelId = userRows[0].youtube_channel_id;

    try {
      const info = await youtubeService.getChannelStatistics(channelId);
      return res.json({
        connected: true,
        channelId: info.channelId,
        channelName: info.channelName,
      });
    } catch (error) {
      if (error instanceof youtubeService.YouTubeServiceError) {
        // A channel ID is configured but YouTube can't currently confirm
        // it (bad ID, quota, network) — report that plainly instead of
        // pretending the connection is healthy.
        return res.json({
          connected: false,
          channelId,
          channelName: null,
          error: error.message,
        });
      }
      throw error;
    }
  })
);

// =======================================================================
// ANALYTICS (read-only aggregation over performance_metrics)
// =======================================================================

app.get(
  "/analytics/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    // PART 4: only ever total up YouTube metrics recorded under the
    // currently connected channel — see YT_CHANNEL_SCOPE_SQL above.
    // PHASE 1: also scope to the logged-in user's own content — this
    // query previously had no content/user join at all and summed every
    // user's performance_metrics together.
    const userId = getUserId(req);
    const scoped = await hasChannelScopingColumn();
    const currentChannelId = scoped ? await getConnectedYoutubeChannelId(userId) : null;

    const [rows] = await db.query(
      `
      SELECT
        COALESCE(SUM(pm.views), 0) AS total_views,
        COALESCE(SUM(pm.likes), 0) AS total_likes,
        COALESCE(SUM(pm.comments), 0) AS total_comments,
        COALESCE(SUM(pm.shares), 0) AS total_shares,
        COALESCE(ROUND(AVG(
          CASE WHEN pm.views = 0 THEN 0 ELSE (pm.likes + pm.comments + pm.shares) / pm.views * 100 END
        ), 2), 0) AS average_engagement_rate
      FROM performance_metrics pm
      JOIN content c ON c.content_id = pm.content_id
      JOIN platforms p ON p.platform_id = pm.platform_id
      WHERE c.user_id = ?
      ${scoped ? `AND ${YT_CHANNEL_SCOPE_SQL}` : ""}
      `,
      scoped ? [userId, currentChannelId] : [userId]
    );
    res.json(castNumbers(rows[0], ["total_views", "total_likes", "total_comments", "total_shares", "average_engagement_rate"]));
  })
);

app.get(
  "/analytics/top-content",
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 5, 50);
    const userId = getUserId(req);

    // PART 4: exclude YouTube metrics linked under a channel that isn't
    // the one currently connected — see YT_CHANNEL_SCOPE_SQL above.
    const scoped = await hasChannelScopingColumn();
    const currentChannelId = scoped ? await getConnectedYoutubeChannelId(userId) : null;

    const [rows] = await db.query(
      `
      SELECT
        c.content_id, c.title AS content_title, p.platform_name,
        pm.views, pm.likes, pm.comments, pm.shares,
        CASE
          WHEN pm.views = 0 THEN 0
          ELSE ROUND((pm.likes + pm.comments + pm.shares) / pm.views * 100, 2)
        END AS engagement_rate
      FROM performance_metrics pm
      JOIN content c ON c.content_id = pm.content_id
      JOIN platforms p ON p.platform_id = pm.platform_id
      WHERE c.user_id = ?
      ${scoped ? `AND ${YT_CHANNEL_SCOPE_SQL}` : ""}
      ORDER BY engagement_rate DESC
      LIMIT ?
      `,
      scoped ? [userId, currentChannelId, limit] : [userId, limit]
    );
    res.json(castNumbersAll(rows, ["views", "likes", "comments", "shares", "engagement_rate"]));
  })
);

app.get(
  "/analytics/platform-performance",
  requireAuth,
  asyncHandler(async (req, res) => {
    // PART 4: the join condition (not a WHERE clause) is what has to
    // carry the channel scope here — this query LEFT JOINs FROM
    // platforms so that a platform with zero rows still shows a 0 row;
    // putting the filter in WHERE instead would turn that LEFT JOIN
    // back into an effective INNER JOIN and drop platforms with no
    // *currently-scoped* data instead of just zeroing their totals.
    // PHASE 1: the user filter has to live in the same ON clause for the
    // same reason — pm.content_id IN (creator's own content) narrows
    // which performance_metrics rows can match, without ever turning
    // this into an INNER JOIN that would drop platforms with zero of
    // *this* user's data.
    const userId = getUserId(req);
    const scoped = await hasChannelScopingColumn();
    const currentChannelId = scoped ? await getConnectedYoutubeChannelId(userId) : null;

    const [rows] = await db.query(
      `
      SELECT
        p.platform_id, p.platform_name,
        COALESCE(SUM(pm.views), 0) AS total_views,
        COALESCE(SUM(pm.likes), 0) AS total_likes,
        COALESCE(SUM(pm.comments), 0) AS total_comments,
        COALESCE(SUM(pm.shares), 0) AS total_shares,
        COALESCE(ROUND(AVG(
          CASE WHEN pm.views = 0 THEN 0 ELSE (pm.likes + pm.comments + pm.shares) / pm.views * 100 END
        ), 2), 0) AS average_engagement_rate
      FROM platforms p
      LEFT JOIN performance_metrics pm
        ON pm.platform_id = p.platform_id
        AND pm.content_id IN (SELECT content_id FROM content WHERE user_id = ?)
        ${scoped ? `AND ${YT_CHANNEL_SCOPE_SQL}` : ""}
      GROUP BY p.platform_id, p.platform_name
      ORDER BY p.platform_name
      `,
      scoped ? [userId, currentChannelId] : [userId]
    );
    res.json(castNumbersAll(rows, ["total_views", "total_likes", "total_comments", "total_shares", "average_engagement_rate"]));
  })
);

app.get(
  "/analytics/performance-over-time",
  requireAuth,
  asyncHandler(async (req, res) => {
    // PART 4/6: same channel scoping as the other analytics endpoints.
    // PHASE 1: also joins content now, purely to scope to the logged-in
    // user's own performance_metrics rows.
    const userId = getUserId(req);
    const scoped = await hasChannelScopingColumn();
    const currentChannelId = scoped ? await getConnectedYoutubeChannelId(userId) : null;

    const [rows] = await db.query(
      `
      SELECT
        DATE(pm.recorded_at) AS date,
        COALESCE(SUM(pm.views), 0) AS views,
        COALESCE(SUM(pm.likes), 0) AS likes,
        COALESCE(SUM(pm.comments), 0) AS comments,
        COALESCE(SUM(pm.shares), 0) AS shares
      FROM performance_metrics pm
      JOIN content c ON c.content_id = pm.content_id
      JOIN platforms p ON p.platform_id = pm.platform_id
      WHERE c.user_id = ?
      ${scoped ? `AND ${YT_CHANNEL_SCOPE_SQL}` : ""}
      GROUP BY DATE(pm.recorded_at)
      ORDER BY date ASC
      `,
      scoped ? [userId, currentChannelId] : [userId]
    );
    res.json(castNumbersAll(rows, ["views", "likes", "comments", "shares"]));
  })
);

// =======================================================================
// POSTING CONSISTENCY ANALYTICS
// Rule-based (no AI/ML): a scheduled item only ever counts as Published
// or Missed once its deadline has passed — Cancelled items are excluded
// entirely, and Scheduled items whose date hasn't passed yet aren't
// eligible either. updateMissedScheduledContent() runs first so every
// route below always reflects the current, automatically-detected state.
//
//   consistency % = published / (published + missed) * 100
//
// Never divides by zero — an empty eligible set returns null, not 0.
// =======================================================================

// Shared by GET /analytics/consistency and the recommendation engine
// (generateRecommendations() below) so there is exactly one
// implementation of the consistency formula, not two. Does NOT call
// updateMissedScheduledContent() itself — callers run that first, same
// as before.
async function computeOverallConsistency(userId, { start, end } = {}) {
  // scheduled_content has no user_id of its own — ownership is always via
  // the parent content row, same as everywhere else in this file.
  const params = [userId];
  let sql = `
    SELECT sc.status, COUNT(*) AS count
    FROM scheduled_content sc
    JOIN content c ON c.content_id = sc.content_id
    WHERE c.user_id = ? AND sc.status IN ('Published', 'Missed')
  `;
  if (start) {
    sql += " AND sc.scheduled_date >= ?";
    params.push(start);
  }
  if (end) {
    sql += " AND sc.scheduled_date <= ?";
    params.push(end);
  }
  sql += " GROUP BY sc.status";

  const [rows] = await db.query(sql, params);

  let publishedCount = 0;
  let missedCount = 0;
  for (const row of rows) {
    if (row.status === "Published") publishedCount = Number(row.count);
    if (row.status === "Missed") missedCount = Number(row.count);
  }

  const eligibleContent = publishedCount + missedCount;
  const consistencyPercentage =
    eligibleContent === 0
      ? null
      : Number(((publishedCount / eligibleContent) * 100).toFixed(2));

  return { eligibleContent, publishedCount, missedCount, consistencyPercentage };
}

app.get(
  "/analytics/consistency",
  requireAuth,
  asyncHandler(async (req, res) => {
    await updateMissedScheduledContent();
    const result = await computeOverallConsistency(getUserId(req), req.query);
    res.json(result);
  })
);

app.get(
  "/analytics/consistency/by-platform",
  requireAuth,
  asyncHandler(async (req, res) => {
    await updateMissedScheduledContent();

    const [rows] = await db.query(
      `
      SELECT
        p.platform_id, p.platform_name,
        SUM(CASE WHEN sc.status = 'Published' THEN 1 ELSE 0 END) AS publishedCount,
        SUM(CASE WHEN sc.status = 'Missed' THEN 1 ELSE 0 END) AS missedCount
      FROM scheduled_content sc
      JOIN content c ON c.content_id = sc.content_id
      JOIN platforms p ON p.platform_id = sc.platform_id
      WHERE c.user_id = ? AND sc.status IN ('Published', 'Missed')
      GROUP BY p.platform_id, p.platform_name
      ORDER BY p.platform_name
      `,
      [getUserId(req)]
    );

    const result = rows.map((row) => {
      const publishedCount = Number(row.publishedCount);
      const missedCount = Number(row.missedCount);
      const eligible = publishedCount + missedCount;
      return {
        platform: row.platform_name,
        publishedCount,
        missedCount,
        consistencyPercentage:
          eligible === 0 ? null : Number(((publishedCount / eligible) * 100).toFixed(2)),
      };
    });

    res.json(result);
  })
);

app.get(
  "/analytics/consistency/trend",
  requireAuth,
  asyncHandler(async (req, res) => {
    await updateMissedScheduledContent();

    // Only "week" or "month" are supported; anything else falls back to month.
    const groupBy = req.query.groupBy === "week" ? "week" : "month";
    const periodExpr =
      groupBy === "week"
        ? "YEARWEEK(sc.scheduled_date, 3)" // ISO-8601 week
        : "DATE_FORMAT(sc.scheduled_date, '%Y-%m')";

    const [rows] = await db.query(
      `
      SELECT
        ${periodExpr} AS period_key,
        MIN(sc.scheduled_date) AS period_start,
        SUM(CASE WHEN sc.status = 'Published' THEN 1 ELSE 0 END) AS publishedCount,
        SUM(CASE WHEN sc.status = 'Missed' THEN 1 ELSE 0 END) AS missedCount
      FROM scheduled_content sc
      JOIN content c ON c.content_id = sc.content_id
      WHERE c.user_id = ? AND sc.status IN ('Published', 'Missed')
      GROUP BY period_key
      ORDER BY period_key ASC
      `,
      [getUserId(req)]
    );

    const result = rows.map((row) => {
      const publishedCount = Number(row.publishedCount);
      const missedCount = Number(row.missedCount);
      const eligible = publishedCount + missedCount;
      return {
        // "period_start" is the earliest scheduled_date in that bucket —
        // used as a readable label for the chart (no fabricated history,
        // only real buckets that actually contain eligible data).
        period:
          groupBy === "week"
            ? String(row.period_start).slice(0, 10)
            : String(row.period_start).slice(0, 7),
        publishedCount,
        missedCount,
        consistencyPercentage:
          eligible === 0 ? null : Number(((publishedCount / eligible) * 100).toFixed(2)),
      };
    });

    res.json(result);
  })
);

// =======================================================================
// DASHBOARD SUMMARY
//
// One endpoint that gives the dashboard everything it needs in a single
// request, instead of the frontend firing off five separate calls. It
// only reads existing tables via existing patterns (the logged-in user's
// id, updateMissedScheduledContent, the youtube_channel_id/follower_metrics
// pair, performance_metrics) — nothing new is written here.
//
// STATUS NOTE: content.status is not a reliable "is this draft/scheduled/
// published" signal in this schema — it's set once at creation (always
// 'draft') and nothing in the app ever updates it afterwards. The real,
// UI-driven signal for "has this gone out yet" is scheduled_content.status
// (the same field the calendar and /analytics/consistency already treat
// as authoritative), so contentSummary is derived from that instead:
//   - Published: has at least one scheduled_content row with status
//     'Published' (if it went out on any platform, it counts as published)
//   - Scheduled: no Published row, but has at least one 'Scheduled' row
//     whose date hasn't passed
//   - Draft: everything else — including content with a 'Missed' row and
//     nothing else, since a missed slot isn't a live "Scheduled" state and
//     there's no dedicated Missed bucket in this 4-card layout
// =======================================================================

app.get(
  "/dashboard/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);

    // Every section below is loaded independently. If one query fails (a
    // missing column/table, a lock timeout, a bad row), that section comes
    // back empty/null and its message is added to sectionErrors, while the
    // rest of the dashboard still loads. The real error is always printed
    // in the server terminal as "Dashboard: <section> failed:".
    const sectionErrors = {};
    const section = async (key, message, fallback, load) => {
      try {
        return await load();
      } catch (error) {
        console.error(`Dashboard: ${key} failed:`, error);
        sectionErrors[key] = message;
        return fallback;
      }
    };

    // A failure here only means some "Scheduled" rows were not flipped to
    // "Missed" on this request; it must never block the dashboard.
    await section(
      "missedUpdate",
      "Missed-content statuses could not be refreshed.",
      null,
      () => updateMissedScheduledContent()
    );

    // ---- Content summary (single query, EXISTS-based per the note above) ----
    const contentSummary = await section(
      "contentSummary",
      "The content summary could not be loaded.",
      null,
      async () => {
        const [[contentSummaryRow]] = await db.query(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE
                  WHEN EXISTS (
                    SELECT 1 FROM scheduled_content sc
                    WHERE sc.content_id = c.content_id AND sc.status = 'Published'
                  ) THEN 1 ELSE 0
                END) AS published,
            SUM(CASE
                  WHEN NOT EXISTS (
                    SELECT 1 FROM scheduled_content sc
                    WHERE sc.content_id = c.content_id AND sc.status = 'Published'
                  )
                  AND EXISTS (
                    SELECT 1 FROM scheduled_content sc
                    WHERE sc.content_id = c.content_id AND sc.status = 'Scheduled'
                  ) THEN 1 ELSE 0
                END) AS scheduled
          FROM content c
          WHERE c.user_id = ?
          `,
          [userId]
        );

        const total = Number(contentSummaryRow.total) || 0;
        const published = Number(contentSummaryRow.published) || 0;
        const scheduled = Number(contentSummaryRow.scheduled) || 0;
        return { total, draft: total - published - scheduled, scheduled, published };
      }
    );

    // ---- Upcoming content (next 5 future items, grouped by CONTENT) ----
    // The same piece of content is often scheduled on several platforms
    // (several scheduled_content rows sharing one content_id). Fetched
    // ungrouped here — LIMIT is applied after grouping below, otherwise
    // "5 rows" could all be the same content item on 5 platforms while a
    // genuinely different upcoming item never appears.
    const upcomingContent = await section(
      "upcomingContent",
      "Upcoming content could not be loaded.",
      [],
      async () => {
        const [upcomingRawRows] = await db.query(
          `
          SELECT
            sc.content_id, sc.scheduled_date,
            c.title AS content_title, c.content_type,
            p.platform_name
          FROM scheduled_content sc
          JOIN content c ON c.content_id = sc.content_id
          JOIN platforms p ON p.platform_id = sc.platform_id
          WHERE c.user_id = ? AND sc.status = 'Scheduled' AND sc.scheduled_date >= NOW()
          ORDER BY sc.scheduled_date ASC
          `,
          [userId]
        );

        const upcomingGroupsById = new Map();
        for (const row of upcomingRawRows) {
          if (!upcomingGroupsById.has(row.content_id)) {
            upcomingGroupsById.set(row.content_id, {
              content_id: row.content_id,
              content_title: row.content_title,
              content_type: row.content_type,
              platforms: [],
            });
          }
          upcomingGroupsById.get(row.content_id).platforms.push({
            platform_name: row.platform_name,
            scheduled_date: row.scheduled_date,
          });
        }

        return Array.from(upcomingGroupsById.values())
          .map((group) => {
            const earliestDate = group.platforms.reduce(
              (earliest, p) =>
                !earliest || new Date(p.scheduled_date) < new Date(earliest) ? p.scheduled_date : earliest,
              null
            );
            // If every platform shares the same date, surface it once as a
            // single top-level date; otherwise leave it null so the frontend
            // shows each platform's own date instead of a misleading shared one.
            const uniqueDates = new Set(group.platforms.map((p) => String(p.scheduled_date)));
            return {
              content_id: group.content_id,
              content_title: group.content_title,
              content_type: group.content_type,
              scheduled_date: uniqueDates.size === 1 ? group.platforms[0].scheduled_date : null,
              earliest_scheduled_date: earliestDate,
              platforms: group.platforms,
            };
          })
          .sort((a, b) => new Date(a.earliest_scheduled_date) - new Date(b.earliest_scheduled_date))
          .slice(0, 5);
      }
    );

    // ---- Platform overview ----
    // youtubeChannelId is also needed by the performance snapshot below,
    // so it is read once here and shared.
    let youtubeChannelId = null;
    const platforms = await section(
      "platforms",
      "The platform overview could not be loaded.",
      {
        youtube: { connected: false, hasData: false, subscriberCount: null },
        tiktok: { connected: false, available: false },
        instagram: { connected: false, available: false },
      },
      async () => {
        const [userRows] = await db.query(
          "SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 5",
          [userId]
        );
        youtubeChannelId = (userRows[0] && userRows[0].youtube_channel_id) || null;

        let youtubeSubscriberCount = null;
        if (youtubeChannelId) {
          const [ytPlatformRows] = await db.query(
            "SELECT platform_id FROM platforms WHERE LOWER(platform_name) = 'youtube' LIMIT 5"
          );
          if (ytPlatformRows.length > 0) {
            const [latestFollowerRows] = await db.query(
              `SELECT follower_count FROM follower_metrics
               WHERE user_id = ? AND platform_id = ?
               ORDER BY recorded_at DESC LIMIT 5`,
              [userId, ytPlatformRows[0].platform_id]
            );
            if (latestFollowerRows.length > 0) {
              youtubeSubscriberCount = Number(latestFollowerRows[0].follower_count);
            }
          }
        }

        return {
          youtube: {
            connected: Boolean(youtubeChannelId),
            hasData: youtubeSubscriberCount !== null,
            subscriberCount: youtubeSubscriberCount,
          },
          // No TikTok/Instagram integration exists yet (see project scope) —
          // these are never fetched from any API and never show a number.
          tiktok: { connected: false, available: false },
          instagram: { connected: false, available: false },
        };
      }
    );

    // ---- Recent performance snapshot (single most recent metric row) ----
    // PART 4: applies the same current-channel scoping as the Analytics
    // page (see YT_CHANNEL_SCOPE_SQL above) so this card can never show a
    // previously-connected channel's metrics as if they were current.
    // PHASE 1: PERFORMANCE_SELECT already joins content — c.user_id = ?
    // scopes this to the logged-in user's own metrics.
    const latestPerformance = await section(
      "latestPerformance",
      "The recent performance snapshot could not be loaded.",
      null,
      async () => {
        const scopedForSnapshot = await hasChannelScopingColumn();
        const snapshotChannelId = scopedForSnapshot ? youtubeChannelId : null;
        const [latestPerfRows] = await db.query(
          `${PERFORMANCE_SELECT} WHERE c.user_id = ?
           ${scopedForSnapshot ? `AND ${YT_CHANNEL_SCOPE_SQL}` : ""}
           ORDER BY pm.recorded_at DESC LIMIT 5`,
          scopedForSnapshot ? [userId, snapshotChannelId] : [userId]
        );
        return latestPerfRows.length > 0
          ? castNumbers(latestPerfRows[0], ["views", "likes", "comments", "shares", "engagement_rate"])
          : null;
      }
    );

    // ---- Optional sections: opportunities and recommendations ----
    // A failure in either is logged on the server and reported to the
    // frontend in sectionErrors. It never takes down the core dashboard
    // data above, and no placeholder rows are invented: the affected list
    // comes back empty and the frontend is told why.

    // ---- Opportunities (top 5 active, newest detection first) ----
    let topOpportunities = [];
    try {
      try {
        await detectOpportunities(userId);
      } catch (error) {
        console.error("Dashboard: opportunity detection failed:", error);
        sectionErrors.opportunities =
          "Opportunities could not be refreshed. The list below may be incomplete.";
      }
      const [topOpportunityRows] = await db.query(
        `SELECT ${opportunityColumns()}
           FROM opportunities
          WHERE user_id = ? AND status = 'Active'
          ORDER BY detected_at DESC
          LIMIT 5`,
        [userId]
      );
      topOpportunities = topOpportunityRows;
    } catch (error) {
      console.error("Dashboard: loading opportunities failed:", error);
      sectionErrors.opportunities = "Opportunities could not be loaded.";
    }

    // ---- Recommendations (top 5 active, display order) ----
    let topRecommendations = [];
    try {
      try {
        await generateRecommendations(userId);
      } catch (error) {
        console.error("Dashboard: recommendation generation failed:", error);
        sectionErrors.recommendations =
          "Recommendations could not be refreshed. The list below may be incomplete.";
      }
      const [topRecommendationRows] = await db.query(
        `SELECT ${recommendationColumns()} FROM recommendations
          WHERE user_id = ? AND status = 'Active'
          ORDER BY ${recommendationOrderSql()} LIMIT 5`,
        [userId]
      );
      topRecommendations = topRecommendationRows;
    } catch (error) {
      console.error("Dashboard: loading recommendations failed:", error);
      sectionErrors.recommendations = "Recommendations could not be loaded.";
    }

    res.json({
      contentSummary,
      upcomingContent,
      platforms,
      latestPerformance,
      opportunities: topOpportunities,
      recommendations: topRecommendations,
      sectionErrors,
    });
  })
);

// =======================================================================
// CREATOR EVENTS
// A creator event is a date that matters to the creator's content (a
// holiday, a conference, a series launch). It is NOT a scheduled post:
// scheduled posts live in scheduled_content and are managed on the
// calendar. Events feed the opportunity engine (detectEventOpportunities
// below) only when they match one of the creator's own topics.
//
// Ownership: every query is scoped by the signed-in user's id
// (req.session.userId via getUserId); user_id is never read from the
// request body, query string or URL.
// =======================================================================

const EVENT_SELECT = `
  SELECT event_id, title, description, event_date, source, relevance_keywords,
         created_at,
         CASE
           WHEN event_date IS NULL THEN 'Undated'
           WHEN event_date < CURDATE() THEN 'Past'
           WHEN event_date = CURDATE() THEN 'Today'
           ELSE 'Upcoming'
         END AS timing
    FROM events
`;

// Upcoming/today first (soonest first), then past events (most recent
// first), then any legacy rows with no date.
const EVENT_ORDER_SQL = `
  ORDER BY
    CASE
      WHEN event_date IS NULL THEN 2
      WHEN event_date < CURDATE() THEN 1
      ELSE 0
    END,
    CASE
      WHEN event_date IS NULL THEN 0
      WHEN event_date < CURDATE() THEN DATEDIFF(CURDATE(), event_date)
      ELSE DATEDIFF(event_date, CURDATE())
    END,
    event_id
`;

const EVENT_UPDATABLE_COLUMNS = ["title", "description", "event_date", "source", "relevance_keywords"];

function parseEventId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Same creator, same title (case-insensitive), same date = the same
// event. Also stops an accidental double-click from saving it twice.
async function eventAlreadyExists(userId, title, eventDate, excludeEventId = null) {
  const params = [userId, title, eventDate];
  let sql =
    "SELECT event_id FROM events WHERE user_id = ? AND LOWER(title) = LOWER(?) AND event_date = ?";
  if (excludeEventId) {
    sql += " AND event_id <> ?";
    params.push(excludeEventId);
  }
  const [rows] = await db.query(`${sql} LIMIT 1`, params);
  return rows.length > 0;
}

const DUPLICATE_EVENT_MESSAGE = "You already have an event with this title on this date.";

app.get(
  "/events",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      `${EVENT_SELECT} WHERE user_id = ? ${EVENT_ORDER_SQL}`,
      [getUserId(req)]
    );
    res.json(rows);
  })
);

app.get(
  "/events/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = parseEventId(req.params.id);
    if (!eventId) return res.status(404).json({ message: "Event not found" });

    const [rows] = await db.query(
      `${EVENT_SELECT} WHERE event_id = ? AND user_id = ?`,
      [eventId, getUserId(req)]
    );
    if (!rows.length) return res.status(404).json({ message: "Event not found" });
    res.json(rows[0]);
  })
);

app.post(
  "/events",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { errors, value } = eventRules.validateEventInput(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors.join(" "), errors });
    }

    if (await eventAlreadyExists(userId, value.title, value.event_date)) {
      return res.status(409).json({ message: DUPLICATE_EVENT_MESSAGE });
    }

    let insertId;
    try {
      const [result] = await db.query(
        `INSERT INTO events (user_id, title, description, event_date, source, relevance_keywords)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          value.title,
          value.description ?? null,
          value.event_date,
          value.source ?? null,
          value.relevance_keywords ?? null,
        ]
      );
      insertId = result.insertId;
    } catch (err) {
      // Only reachable if the optional unique index from the Phase 2 SQL
      // has been added and two identical requests race each other.
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: DUPLICATE_EVENT_MESSAGE });
      }
      throw err;
    }

    const [rows] = await db.query(
      `${EVENT_SELECT} WHERE event_id = ? AND user_id = ?`,
      [insertId, userId]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  "/events/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const eventId = parseEventId(req.params.id);
    if (!eventId) return res.status(404).json({ message: "Event not found" });

    const { errors, value } = eventRules.validateEventInput(req.body, { partial: true });
    if (errors.length) {
      return res.status(400).json({ message: errors.join(" "), errors });
    }

    const [existing] = await db.query(
      "SELECT title, event_date FROM events WHERE event_id = ? AND user_id = ?",
      [eventId, userId]
    );
    if (!existing.length) return res.status(404).json({ message: "Event not found" });

    const finalTitle = value.title !== undefined ? value.title : existing[0].title;
    const finalDate = value.event_date !== undefined ? value.event_date : existing[0].event_date;
    if (await eventAlreadyExists(userId, finalTitle, finalDate, eventId)) {
      return res.status(409).json({ message: DUPLICATE_EVENT_MESSAGE });
    }

    const sets = [];
    const params = [];
    for (const column of EVENT_UPDATABLE_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(value, column)) {
        sets.push(`${column} = ?`);
        params.push(value[column]);
      }
    }
    params.push(eventId, userId);

    try {
      await db.query(
        `UPDATE events SET ${sets.join(", ")} WHERE event_id = ? AND user_id = ?`,
        params
      );
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: DUPLICATE_EVENT_MESSAGE });
      }
      throw err;
    }

    const [rows] = await db.query(
      `${EVENT_SELECT} WHERE event_id = ? AND user_id = ?`,
      [eventId, userId]
    );
    res.json(rows[0]);
  })
);

app.delete(
  "/events/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = parseEventId(req.params.id);
    if (!eventId) return res.status(404).json({ message: "Event not found" });

    // opportunities.event_id is ON DELETE SET NULL, so any opportunity
    // derived from this event survives with event_id = NULL; the next
    // detection run expires it (see detectEventOpportunities).
    const [result] = await db.query(
      "DELETE FROM events WHERE event_id = ? AND user_id = ?",
      [eventId, getUserId(req)]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Event not found" });
    res.json({ message: "Event deleted" });
  })
);

// =======================================================================
// OPPORTUNITY DETECTION
//
// Opportunities are decision-support signals based on the creator's own
// topics/content, analytics, schedule, events, and recent public YouTube
// activity. Competitors are deliberately not part of this engine.
//
// Legacy numerical/scoring columns remain in the database for compatibility
// with older rows and the later recommendation cleanup. New detection never
// reads or writes those fields.

const OPPORTUNITY_STATUSES = ["Active", "Actioned", "Dismissed"];

async function getCreatorTopics(userId) {
  const [rows] = await db.query(
    `SELECT DISTINCT cat.category_id, cat.category_name
       FROM content_categories cc
       JOIN categories cat ON cat.category_id = cc.category_id
       JOIN content c ON c.content_id = cc.content_id
      WHERE c.user_id = ?
      ORDER BY cat.category_name`,
    [userId]
  );
  return rows;
}

async function upsertOpportunity({
  userId,
  type,
  title,
  description,
  source,
  deadline = null,
  eventId = null,
}) {
  if (!opportunityEngine.isValidOpportunityType(type)) {
    throw new Error(`Unsupported opportunity type: ${type}`);
  }

   const [existing] = await db.query(
    `SELECT opportunity_id, status, detected_at
       FROM opportunities
      WHERE user_id = ? AND opportunity_type = ? AND title = ?
      ORDER BY opportunity_id DESC
      LIMIT 1`,
    [userId, type, title]
  );
  const latest = existing[0];

  if (latest && latest.status === "Active") {
    await db.query(
      `UPDATE opportunities
          SET description = ?, source = ?, opportunity_deadline = ?,
              event_id = ?, detected_at = NOW()
        WHERE opportunity_id = ? AND user_id = ?`,
      [description, source, deadline, eventId, latest.opportunity_id, userId]
    );
    return "updated";
  }

    if (latest && latest.status === "Expired") {
    // The engine closed this earlier because its signal disappeared; the
    // signal is back, so reopen the same row instead of adding another.
    await db.query(
      `UPDATE opportunities
          SET status = 'Active', description = ?, source = ?, opportunity_deadline = ?,
              event_id = ?, detected_at = NOW()
        WHERE opportunity_id = ? AND user_id = ?`,
      [description, source, deadline, eventId, latest.opportunity_id, userId]
    );
    return "updated";
  }

  // Closed by the creator (Actioned/Dismissed): don't recreate it on the
  // next detection run. detected_at is the last time it was refreshed
  // while Active, i.e. roughly when the creator closed it.
  if (latest && !recommendationEngine.shouldResurface(latest.detected_at)) {
    return "skipped";
  }

  await db.query(
    `INSERT INTO opportunities
       (user_id, event_id, opportunity_type, title, description, source,
        detected_at, opportunity_deadline, status)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, 'Active')`,
    [userId, eventId, type, title, description, source, deadline]
  );
  return "created";
}

async function detectContentGaps(userId, topics) {
  const result = { created: 0, updated: 0, skipped: 0 };      // CHANGED

  for (const topic of topics) {
    const [[row]] = await db.query(
      `SELECT MAX(COALESCE(sc.published_at, c.created_at)) AS latest_date
         FROM content_categories cc
         JOIN content c ON c.content_id = cc.content_id
         LEFT JOIN scheduled_content sc
           ON sc.content_id = c.content_id AND sc.status = 'Published'
        WHERE c.user_id = ? AND cc.category_id = ?`,
      [userId, topic.category_id]
    );

    const latest = row && row.latest_date ? new Date(row.latest_date) : null;
    const recent = opportunityEngine.hasRecentContent(latest, 30);

    if (recent) continue;

    const outcome = await upsertOpportunity({
      userId,
      type: "ContentGap",
      title: `Content gap: ${topic.category_name}`,
      description: latest
        ? `You haven't published recently about ${topic.category_name}. Your last recorded published item in this category was on ${latest.toISOString().slice(0, 10)}.`
        : `You have used ${topic.category_name} as a topic, but no recent published content was found for it.`,
      source: "Creator content history",
    });
    result[outcome]++;
  }

  return result;
}

async function detectPostingOpportunities(userId) {
  const result = { created: 0, updated: 0, skipped: 0 };

  const [history] = await db.query(
    `SELECT DAYOFWEEK(sc.published_at) AS weekday, COUNT(*) AS publish_count
       FROM scheduled_content sc
       JOIN content c ON c.content_id = sc.content_id
      WHERE c.user_id = ?
        AND sc.status = 'Published'
        AND sc.published_at IS NOT NULL
      GROUP BY DAYOFWEEK(sc.published_at)
      HAVING COUNT(*) >= 2`,
    [userId]
  );

  if (!history.length) return result;

  const [scheduled] = await db.query(
    `SELECT scheduled_date
       FROM scheduled_content sc
       JOIN content c ON c.content_id = sc.content_id
      WHERE c.user_id = ?
        AND sc.status = 'Scheduled'
        AND sc.scheduled_date >= NOW()
        AND sc.scheduled_date < DATE_ADD(NOW(), INTERVAL 14 DAY)`,
    [userId]
  );

  const scheduledDates = scheduled.map((row) => new Date(row.scheduled_date));
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  for (const row of history) {
    const weekday = Number(row.weekday) - 1;
    const occurrence = new Date();
    occurrence.setHours(12, 0, 0, 0);

    let daysAhead = (weekday - occurrence.getDay() + 7) % 7;
    if (daysAhead === 0) daysAhead = 7;
    occurrence.setDate(occurrence.getDate() + daysAhead);

    const alreadyScheduled = scheduledDates.some((date) =>
      date.getFullYear() === occurrence.getFullYear() &&
      date.getMonth() === occurrence.getMonth() &&
      date.getDate() === occurrence.getDate()
    );
    if (alreadyScheduled) continue;

    const outcome = await upsertOpportunity({
      userId,
      type: "PostingOpportunity",
      title: `Posting opportunity: ${weekdayNames[weekday]}`,
      description:
        `You have historically published on ${weekdayNames[weekday]} (${row.publish_count} recorded published item(s)), ` +
        `but no content is currently scheduled for ${occurrence.toISOString().slice(0, 10)}.`,
      source: "Creator publishing history and schedule",
      deadline: occurrence,
    });
    result[outcome]++;
  }

  return result;
}

async function detectEventOpportunities(userId, topics) {
  const result = { created: 0, updated: 0, skipped: 0, expired: 0 };
  const currentTitles = new Set();

  // Only this creator's own upcoming events, inside the look-ahead window.
  // Past events never produce opportunities.
  const [events] = await db.query(
    `SELECT event_id, title, description, event_date, source, relevance_keywords
       FROM events
      WHERE user_id = ?
        AND event_date IS NOT NULL
        AND event_date >= CURDATE()
        AND event_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
      ORDER BY event_date ASC`,
    [userId, eventRules.EVENT_LOOKAHEAD_DAYS]
  );

  for (const event of events) {
    // An event with no link to any of the creator's topics is skipped,
    // never forced into an opportunity.
    const topic = eventRules.findMatchingTopic(event, topics);
    if (!topic) continue;

    const dateLabel = String(event.event_date).slice(0, 10);
    // The date is part of the title so the same event on another date (or
    // a recurring event) is its own opportunity, and so moving an event
    // retires the old opportunity instead of leaving a wrong deadline.
    const title = `Event opportunity: ${event.title} (${dateLabel})`;
    currentTitles.add(title);

    const outcome = await upsertOpportunity({
      userId,
      type: "EventOpportunity",
      title,
      description:
        `${event.title} is on ${dateLabel} and its title, description or keywords ` +
        `mention your ${topic.category_name} topic.`,
      source: event.source || "Creator event",
      deadline: new Date(`${dateLabel}T23:59:59`),
      eventId: event.event_id,
    });
    result[outcome]++;
  }

  // Close Active event opportunities whose event is gone, past, edited or
  // no longer matches a topic. They are marked Expired (engine-closed),
  // not Dismissed, which is reserved for the creator's own choice.
  const [activeRows] = await db.query(
    `SELECT opportunity_id, title
       FROM opportunities
      WHERE user_id = ? AND opportunity_type = 'EventOpportunity' AND status = 'Active'`,
    [userId]
  );
  const staleIds = activeRows
    .filter((row) => !currentTitles.has(row.title))
    .map((row) => row.opportunity_id);
  if (staleIds.length) {
    await db.query(
      `UPDATE opportunities SET status = 'Expired'
        WHERE user_id = ? AND opportunity_id IN (?)`,
      [userId, staleIds]
    );
    result.expired = staleIds.length;
  }

  return result;
}

async function detectHighPerformingTopics(userId) {
  const result = { created: 0, updated: 0, skipped: 0 };

  const [[overallRow]] = await db.query(
    `SELECT COALESCE(AVG(
       CASE WHEN pm.views = 0 THEN 0
            ELSE (pm.likes + pm.comments + pm.shares) / pm.views * 100 END
     ), 0) AS overall_engagement
       FROM performance_metrics pm
       JOIN content c ON c.content_id = pm.content_id
      WHERE c.user_id = ?`,
    [userId]
  );
  const overall = Number(overallRow.overall_engagement) || 0;
  if (overall <= 0) return result;

  const [rows] = await db.query(
    `SELECT cat.category_name,
            COUNT(DISTINCT pm.metric_id) AS metric_count,
            COALESCE(AVG(
              CASE WHEN pm.views = 0 THEN 0
                   ELSE (pm.likes + pm.comments + pm.shares) / pm.views * 100 END
            ), 0) AS average_engagement
       FROM content_categories cc
       JOIN categories cat ON cat.category_id = cc.category_id
       JOIN content c ON c.content_id = cc.content_id
       JOIN performance_metrics pm ON pm.content_id = c.content_id
      WHERE c.user_id = ?
      GROUP BY cat.category_id, cat.category_name
      HAVING COUNT(DISTINCT pm.metric_id) >= ?`,
    [userId, recommendationEngine.MIN_CONTENT_FOR_CATEGORY_RULE]
  );

  for (const row of rows) {
    const average = Number(row.average_engagement) || 0;
    if (!opportunityEngine.qualifiesAsHighPerformingTopic(
      average,
      overall,
      Number(row.metric_count),
      {
        multiplier: recommendationEngine.CATEGORY_OUTPERFORM_MULTIPLIER,
        minimumRecords: recommendationEngine.MIN_CONTENT_FOR_CATEGORY_RULE,
      }
    )) continue;

    const outcome = await upsertOpportunity({
      userId,
      type: "HighPerformingTopic",
      title: `High-performing topic: ${row.category_name}`,
      description:
        `${row.category_name} has an average engagement rate of ${average.toFixed(2)}% across ` +
        `${row.metric_count} tracked performance record(s), compared with your overall ` +
        `average of ${overall.toFixed(2)}%.`,
      source: "Creator performance metrics",
    });
    result[outcome]++;
  }

  return result;
}

async function detectRecentTopics(userId, topics) {
  const result = { created: 0, updated: 0, skipped: 0 };
  if (!topics.length) return result;

  const [userRows] = await db.query(
    "SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 1",
    [userId]
  );
  if (!userRows[0]?.youtube_channel_id) return result;

  for (const topic of topics) {
    try {
      const videos = await youtubeService.searchPublicVideosByTopic(topic.category_name, {
        maxResults: 5,
      });
      const recentVideo = videos.find((video) => video.publishedAt);
      if (!recentVideo) continue;

      const outcome = await upsertOpportunity({
        userId,
        type: "RecentTopic",
        title: `Recent topic: ${topic.category_name}`,
        description:
          `A recent public YouTube video relevant to ${topic.category_name} was published: ` +
          `"${recentVideo.title}" on ${new Date(recentVideo.publishedAt).toISOString().slice(0, 10)}.`,
        source: "YouTube Data API",
      });
      result[outcome]++;
    } catch (error) {
      console.error(`Recent YouTube topic lookup failed for "${topic.category_name}":`, error.message);
      result.skipped++;
    }
  }

  return result;
}

async function detectOpportunities(userId) {
  const topics = await getCreatorTopics(userId);
  const result = { created: 0, updated: 0, skipped: 0 };

  for (const detector of [
    () => detectContentGaps(userId, topics),
    () => detectPostingOpportunities(userId),
    () => detectEventOpportunities(userId, topics),
    () => detectHighPerformingTopics(userId),
    () => detectRecentTopics(userId, topics),
  ]) {
    const pass = await detector();
    result.created += pass.created || 0;
    result.updated += pass.updated || 0;
    result.skipped += pass.skipped || 0;
  }

  return result;
}

function opportunityColumns() {
  return `
    opportunity_id, user_id, event_id, opportunity_type, title, description,
    source, detected_at, opportunity_deadline, status
  `;
}

app.get(
  "/opportunities",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await detectOpportunities(userId);

    const params = [userId];
    let sql = `SELECT ${opportunityColumns()} FROM opportunities WHERE user_id = ?`;
    if (req.query.status) {
      sql += " AND status = ?";
      params.push(req.query.status);
    }
    sql += " ORDER BY detected_at DESC";

    const [rows] = await db.query(sql, params);
    res.json(rows);
  })
);

app.get(
  "/opportunities/recent-topics",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const topics = await getCreatorTopics(userId);

    const [userRows] = await db.query(
      "SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 1",
      [userId]
    );
    if (!userRows[0]?.youtube_channel_id) {
      return res.status(400).json({
        message: "Connect a YouTube channel before discovering recent topics.",
        code: "YOUTUBE_CHANNEL_NOT_CONFIGURED",
      });
    }

    const results = [];
    for (const topic of topics) {
      try {
        results.push({
          topic: topic.category_name,
          videos: await youtubeService.searchPublicVideosByTopic(topic.category_name, {
            maxResults: 5,
          }),
        });
      } catch (error) {
        results.push({
          topic: topic.category_name,
          videos: [],
          error: error.message,
        });
      }
    }
    res.json(results);
  })
);

app.get(
  "/opportunities/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      `SELECT ${opportunityColumns()}
         FROM opportunities
        WHERE opportunity_id = ? AND user_id = ?`,
      [req.params.id, getUserId(req)]
    );
    if (!rows.length) return res.status(404).json({ message: "Opportunity not found" });
    res.json(rows[0]);
  })
);

app.put(
  "/opportunities/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    const userId = getUserId(req);

    if (!OPPORTUNITY_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `status must be one of: ${OPPORTUNITY_STATUSES.join(", ")}`,
      });
    }

    const [existing] = await db.query(
      "SELECT opportunity_id FROM opportunities WHERE opportunity_id = ? AND user_id = ?",
      [req.params.id, userId]
    );
    if (!existing.length) return res.status(404).json({ message: "Opportunity not found" });

    await db.query(
      "UPDATE opportunities SET status = ? WHERE opportunity_id = ? AND user_id = ?",
      [status, req.params.id, userId]
    );

    const [rows] = await db.query(
      `SELECT ${opportunityColumns()}
         FROM opportunities
        WHERE opportunity_id = ? AND user_id = ?`,
      [req.params.id, userId]
    );
    res.json(rows[0]);
  })
);

app.delete(
  "/opportunities/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [result] = await db.query(
      "DELETE FROM opportunities WHERE opportunity_id = ? AND user_id = ?",
      [req.params.id, getUserId(req)]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Opportunity not found" });
    res.json({ message: "Opportunity deleted" });
  })
);

app.post(
  "/opportunities/detect",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await detectOpportunities(getUserId(req)));
  })
);



// =======================================================================
// RECOMMENDATION ENGINE (rule-based — see backend/services/
// recommendationEngine.js for the thresholds and rule checks, which are
// pure functions with no DB access so they can be unit-tested on their
// own).
//
// The engine is built ONLY from the creator's own data and the creator's
// own opportunities (see OPPORTUNITY DETECTION above).
//
// DATA -> ANALYSIS -> RULE -> RECOMMENDATION, applied here as:
//   Rule A  low posting consistency            (creator schedule data)
//   Rule B  strong-performing topic/category   (creator performance data)
//   Rule C  ContentGap opportunity
//   Rule D  PostingOpportunity opportunity
//   Rule E  EventOpportunity opportunity
//   Rule F  RecentTopic opportunity
// HighPerformingTopic opportunities are NOT a separate rule: they describe
// the same signal as Rule B, so Rule B produces the single recommendation
// and links it to the matching opportunity.
//
// Each recommendation has a STABLE message per subject (the topic, the
// weekday, the event, the category) so re-running this on the same signal
// updates the existing row instead of creating a duplicate. Numbers and
// dates live in `reason`, which is refreshed on every run.
//
// Recommendation statuses: Active, Actioned, Dismissed (set by the
// creator) and Expired (set by the engine when the signal that produced
// the recommendation is no longer true).
// =======================================================================

const RECOMMENDATION_STATUSES = ["Active", "Actioned", "Dismissed"];

function recommendationColumns() {
  return `
    recommendation_id, user_id, opportunity_id, recommendation_type, title,
    message, reason, created_at, updated_at, status
  `;
}

function recommendationOrderSql() {
  return `${recommendationEngine.displayOrderSql("recommendation_type")}, created_at DESC`;
}

// generateRecommendations() runs from several routes (dashboard summary,
// GET /recommendations, POST /recommendations/generate). Two runs for the
// same user at the same moment could both find "no row yet" and both
// insert. This queues runs per user so they execute one after another.
// (Single Node process only — see the note in the audit about a database
// unique constraint if the app is ever run on several instances.)
const recommendationRunQueues = new Map();

function runRecommendationsExclusively(userId, task) {
  const previous = recommendationRunQueues.get(userId) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  const tail = run.catch(() => {});
  recommendationRunQueues.set(userId, tail);
  tail.then(() => {
    if (recommendationRunQueues.get(userId) === tail) recommendationRunQueues.delete(userId);
  });
  return run;
}

function recommendationKey(type, message) {
  return `${type}|${message}`;
}

function dateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Creates or refreshes one recommendation. Identity is
 * (user, type, message). Outcomes:
 *   created  - no row existed, or a closed row is old enough to resurface
 *   updated  - an Active (or engine-Expired) row was refreshed
 *   skipped  - the creator already Dismissed/Actioned it recently
 */
async function upsertRecommendation({ userId, type, title, message, reason, opportunityId = null }) {
  const [rows] = await db.query(
    `SELECT recommendation_id, status, updated_at
       FROM recommendations
      WHERE user_id = ? AND recommendation_type = ? AND message = ?
      ORDER BY recommendation_id DESC
      LIMIT 1`,
    [userId, type, message]
  );
  const latest = rows[0];

  const insert = async () => {
    await db.query(
      `INSERT INTO recommendations
         (user_id, opportunity_id, recommendation_type, title, message, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Active')`,
      [userId, opportunityId, type, title, message, reason]
    );
    return "created";
  };

  if (!latest) return insert();

  if (latest.status === "Active") {
    await db.query(
      `UPDATE recommendations
          SET title = ?, reason = ?, opportunity_id = ?
        WHERE recommendation_id = ? AND user_id = ?`,
      [title, reason, opportunityId, latest.recommendation_id, userId]
    );
    return "updated";
  }

  if (latest.status === "Expired") {
    // The engine closed it earlier because the signal disappeared; the
    // signal is back, so reopen the same row rather than adding another.
    await db.query(
      `UPDATE recommendations
          SET status = 'Active', title = ?, reason = ?, opportunity_id = ?,
              created_at = NOW()
        WHERE recommendation_id = ? AND user_id = ?`,
      [title, reason, opportunityId, latest.recommendation_id, userId]
    );
    return "updated";
  }

  // Dismissed / Actioned by the creator: respect that unless it has been
  // a long time and the signal is still true.
  if (recommendationEngine.shouldResurface(latest.updated_at)) return insert();
  return "skipped";
}

// Turns one Active opportunity into { type, title, message, reason }.
// Every word that names a topic/day/event comes from the opportunity row.
// Wording is deliberately non-predictive: these are suggestions based on
// the creator's own history, not forecasts of views or engagement.
function buildOpportunityRecommendation(opportunity) {
  const type = recommendationEngine.opportunityRecommendationType(opportunity.opportunity_type);
  if (!type) return null;

  const subject = recommendationEngine.opportunitySubject(opportunity);
  const deadline = opportunity.opportunity_deadline ? dateOnly(opportunity.opportunity_deadline) : null;
  const detail = opportunity.description ? `${opportunity.description} ` : "";
  const sourceNote = opportunity.source ? `Source: ${opportunity.source}.` : "";

  switch (opportunity.opportunity_type) {
    case "ContentGap":
      return {
        type,
        title: `Cover ${subject} again`,
        message: `Consider creating new content about ${subject}, a topic you haven't covered recently.`,
        reason: `${detail}${sourceNote}`.trim(),
      };
    case "PostingOpportunity":
      return {
        type,
        title: `Schedule a ${subject} post`,
        message: `Consider scheduling your next piece of content for ${subject}, based on the days you usually publish.`,
        reason:
          `${detail}This is based on your own posting pattern, not a forecast of the post's results. ${sourceNote}`.trim(),
      };
    case "EventOpportunity":
      return {
        type,
        title: `Plan content for ${subject}`,
        message: `Consider planning content related to ${subject} before the event date.`,
        reason:
          `${detail}${deadline ? `The event is on ${deadline}. ` : ""}${sourceNote}`.trim(),
      };
    case "RecentTopic":
      return {
        type,
        title: `Explore a recent ${subject} topic`,
        message:
          `Consider reviewing a recent public YouTube topic related to ${subject} and deciding whether it suits your audience.`,
        reason:
          `${detail}This is topic discovery only; it says nothing about how content on this topic would perform. ${sourceNote}`.trim(),
      };
    default:
      return null;
  }
}

/**
 * Runs every recommendation rule for ONE user and upserts qualifying
 * recommendations. Returns { created, updated, skipped, expired } counts
 * for a clear before/after when demonstrating this feature.
 *
 * refreshOpportunities: run opportunity detection first. The explicit
 * recommendation routes pass true; the dashboard summary passes nothing
 * because it has just run detection itself (this avoids a second round of
 * YouTube API calls in the same request).
 */
function generateRecommendations(userId, { refreshOpportunities = false } = {}) {
  return runRecommendationsExclusively(userId, async () => {
    const result = { created: 0, updated: 0, skipped: 0, expired: 0 };
    const currentKeys = new Set();

    const apply = async (recommendation) => {
      currentKeys.add(recommendationKey(recommendation.type, recommendation.message));
      const outcome = await upsertRecommendation({ userId, ...recommendation });
      result[outcome]++;
    };

    if (refreshOpportunities) await detectOpportunities(userId);

    // ---- Rule A: low posting consistency (unchanged rule) ----
    await updateMissedScheduledContent();
    const consistency = await computeOverallConsistency(userId);
    if (
      recommendationEngine.qualifiesForConsistencyReview(
        consistency.consistencyPercentage,
        consistency.eligibleContent
      )
    ) {
      await apply({
        type: "ReviewMissedContent",
        title: "Improve posting consistency",
        message:
          "Your posting consistency is below target. Consider reviewing your missed scheduled content and planning your next posts.",
        reason:
          `Posting consistency is ${consistency.consistencyPercentage}% ` +
          `(${consistency.publishedCount} published / ${consistency.missedCount} missed ` +
          `out of ${consistency.eligibleContent} eligible items), below the ${recommendationEngine.CONSISTENCY_LOW_THRESHOLD}% target.`,
      });
    }

    // ---- Active, still-open opportunities for THIS user only ----
    const [opportunityRows] = await db.query(
      `SELECT ${opportunityColumns()}
         FROM opportunities
        WHERE user_id = ? AND status = 'Active'`,
      [userId]
    );

    // ---- Rule B: a topic/category clearly outperforms the creator's own
    // overall average (unchanged rule; one recommendation per category,
    // linked to its HighPerformingTopic opportunity when one exists) ----
    const [[overallRow]] = await db.query(
      `SELECT COALESCE(ROUND(AVG(
         CASE WHEN pm.views = 0 THEN 0 ELSE (pm.likes + pm.comments + pm.shares) / pm.views * 100 END
       ), 2), 0) AS averageEngagementRate
       FROM performance_metrics pm
       JOIN content c ON c.content_id = pm.content_id
       WHERE c.user_id = ?`,
      [userId]
    );
    const overallAvgEngagement = Number(overallRow.averageEngagementRate);

    const [categoryRows] = await db.query(
      `SELECT cat.category_name,
              COUNT(DISTINCT pm.metric_id) AS contentCount,
              COALESCE(ROUND(AVG(
                CASE WHEN pm.views = 0 THEN 0 ELSE (pm.likes + pm.comments + pm.shares) / pm.views * 100 END
              ), 2), 0) AS averageEngagementRate
       FROM content_categories ccat
       JOIN categories cat ON cat.category_id = ccat.category_id
       JOIN content c ON c.content_id = ccat.content_id
       JOIN performance_metrics pm ON pm.content_id = ccat.content_id
       WHERE c.user_id = ?
       GROUP BY cat.category_id, cat.category_name`,
      [userId]
    );

    const highPerformingByTitle = new Map(
      opportunityRows
        .filter((opp) => opp.opportunity_type === "HighPerformingTopic")
        .map((opp) => [opp.title, opp.opportunity_id])
    );

    for (const row of categoryRows) {
      const avg = Number(row.averageEngagementRate);
      const count = Number(row.contentCount);
      if (!recommendationEngine.qualifiesForCategoryRecommendation(avg, count, overallAvgEngagement)) continue;

      await apply({
        type: "ProduceMoreInCategory",
        title: `Create more ${row.category_name} content`,
        message:
          `Your "${row.category_name}" content has been performing strongly compared with your overall content. ` +
          `Consider creating more content around this topic.`,
        reason:
          `Average engagement rate for "${row.category_name}" is ${avg}% across ${count} ` +
          `tracked item(s), vs your overall average of ${overallAvgEngagement}%.`,
        opportunityId: highPerformingByTitle.get(`High-performing topic: ${row.category_name}`) || null,
      });
    }

    // ---- Rules C-F: ContentGap, PostingOpportunity, EventOpportunity,
    // RecentTopic. HighPerformingTopic is intentionally not handled here
    // (covered by Rule B above). ----
    const now = new Date();
    for (const opportunity of opportunityRows) {
      if (!recommendationEngine.qualifiesForOpportunityRecommendation(opportunity, now)) continue;
      const built = buildOpportunityRecommendation(opportunity);
      if (!built) continue;
      await apply({ ...built, opportunityId: opportunity.opportunity_id });
    }

    // ---- Retire Active recommendations whose signal is gone. This also
    // closes any legacy ActOnOpportunity / ReviewCompetitorPatterns rows
    // left over from the old competitor-based engine (kept, not deleted). ----
    const [activeRows] = await db.query(
      `SELECT recommendation_id, recommendation_type, message
         FROM recommendations
        WHERE user_id = ? AND status = 'Active'`,
      [userId]
    );
    const staleIds = activeRows
      .filter((row) => !currentKeys.has(recommendationKey(row.recommendation_type, row.message)))
      .map((row) => row.recommendation_id);
    if (staleIds.length) {
      await db.query(
        `UPDATE recommendations SET status = 'Expired'
          WHERE user_id = ? AND recommendation_id IN (?)`,
        [userId, staleIds]
      );
      result.expired = staleIds.length;
    }

    return result;
  });
}

app.get(
  "/recommendations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    await generateRecommendations(userId, { refreshOpportunities: true });

    const params = [userId];
    let sql = `SELECT ${recommendationColumns()} FROM recommendations WHERE user_id = ?`;
    if (req.query.status) {
      sql += " AND status = ?";
      params.push(req.query.status);
    }
    sql += ` ORDER BY ${recommendationOrderSql()}`;

    const [rows] = await db.query(sql, params);
    res.json(rows);
  })
);

app.put(
  "/recommendations/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    const { id } = req.params;
    const userId = getUserId(req);

    if (!status || !RECOMMENDATION_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `status must be one of: ${RECOMMENDATION_STATUSES.join(", ")}`,
      });
    }

    const [existing] = await db.query(
      "SELECT recommendation_id FROM recommendations WHERE recommendation_id = ? AND user_id = ?",
      [id, userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Recommendation not found" });
    }

    await db.query(
      "UPDATE recommendations SET status = ? WHERE recommendation_id = ? AND user_id = ?",
      [status, id, userId]
    );

    const [rows] = await db.query(
      `SELECT ${recommendationColumns()} FROM recommendations WHERE recommendation_id = ? AND user_id = ?`,
      [id, userId]
    );
    res.json(rows[0]);
  })
);

app.delete(
  "/recommendations/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [result] = await db.query(
      "DELETE FROM recommendations WHERE recommendation_id = ? AND user_id = ?",
      [req.params.id, getUserId(req)]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Recommendation not found" });
    }
    res.json({ message: "Recommendation deleted" });
  })
);

// Explicit trigger, same convention as POST /opportunities/detect —
// useful for a clean before/after moment in a demo or test.
app.post(
  "/recommendations/generate",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await generateRecommendations(getUserId(req), { refreshOpportunities: true });
    res.json(result);
  })
);

// =======================================================================
// 404 HANDLER (must be registered after every route above, and before
// the error handler below). Anything reaching this point matched no
// static frontend file and no API route. Returning JSON here — instead
// of Express's default HTML "Cannot GET ..." page — means a future
// route typo/mismatch surfaces to the frontend as a normal JSON error it
// can display, not as "Unexpected token '<', "<!DOCTYPE"... is not
// valid JSON".
// =======================================================================
app.use((req, res) => {
  res.status(404).json({ message: `No route found for ${req.method} ${req.originalUrl}` });
});

// =======================================================================
// ERROR HANDLING (must be registered last)
// =======================================================================

app.use((err, req, res, next) => {
  // A malformed JSON request body is the client's mistake, not a server failure.
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body is not valid JSON." });
  }

   console.error("DB/SERVER ERROR:", err);

  res.status(500).json({
    message: "An unexpected server error occurred.",
    // Real cause, for local development only. Hidden when NODE_ENV=production.
    ...(process.env.NODE_ENV === "production"
      ? {}
      : { detail: err.sqlMessage || err.message, code: err.code }),
  });
});

// START SERVER (ALWAYS LAST)
app.listen(3000, () => {
  console.log("Server running on port 3000");
});