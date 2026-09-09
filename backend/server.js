console.log("Backend server starting...");
require("dotenv").config();

const path = require("path");
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const session = require("express-session");
const { passport, isGoogleOAuthConfigured } = require("./config/passport");
const youtubeService = require("./services/youtubeService");
const { classifyVideoMatch } = require("./services/videoMatcher");

const app = express();

app.use(cors());
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

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // set true once the app is served over HTTPS
      maxAge: 5 * 60 * 1000, // only needs to survive the OAuth round-trip
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
// TEMPORARY SINGLE-USER ASSUMPTION
// This project currently has no login/session system, but content_id
// requires a valid users.user_id (foreign key). Until auth is added,
// every write uses this fixed user. Seed it once with:
//   INSERT INTO users (username, email, password_hash) VALUES ('elena', 'elena@example.com', 'placeholder');
// and set its real id below (or via DEFAULT_USER_ID in .env).
// ---------------------------------------------------------------------
const DEFAULT_USER_ID = Number(process.env.DEFAULT_USER_ID) || 1;

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

async function getConnectedYoutubeChannelId() {
  const [rows] = await db.query(
    "SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 1",
    [DEFAULT_USER_ID]
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
// later phases (competitor topics, opportunity relevance) something
// concrete to compare a creator's own content scope against, instead of
// inventing a second ad hoc "topic" concept.
// =======================================================================

app.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      "SELECT category_id, category_name, description FROM categories ORDER BY category_name"
    );
    res.json(rows);
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
  asyncHandler(async (req, res) => {
    const params = [];
    let sql = "SELECT * FROM content";
    if (req.query.user_id) {
      sql += " WHERE user_id = ?";
      params.push(req.query.user_id);
    }
    sql += " ORDER BY created_at DESC";
    const [rows] = await db.query(sql, params);
    await attachCategories(rows, "content_id");
    res.json(rows);
  })
);

app.get(
  "/content/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await db.query("SELECT * FROM content WHERE content_id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "Content not found" });
    }
    await attachCategories(rows, "content_id");
    res.json(rows[0]);
  })
);

app.post(
  "/content",
  asyncHandler(async (req, res) => {
    const { title, description, content_type, status, category_ids } = req.body || {};

    if (!title || !content_type) {
      return res
        .status(400)
        .json({ message: "title and content_type are required" });
    }

    const [result] = await db.query(
      `INSERT INTO content (user_id, title, description, content_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [DEFAULT_USER_ID, title, description || null, content_type, status || "draft"]
    );

    await setContentCategories(result.insertId, category_ids);

    const [rows] = await db.query("SELECT * FROM content WHERE content_id = ?", [
      result.insertId,
    ]);
    await attachCategories(rows, "content_id");
    res.status(201).json(rows[0]);
  })
);

app.put(
  "/content/:id",
  asyncHandler(async (req, res) => {
    const { title, description, content_type, status, category_ids } = req.body || {};
    const { id } = req.params;

    const [existing] = await db.query(
      "SELECT * FROM content WHERE content_id = ?",
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Content not found" });
    }

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

    await setContentCategories(id, category_ids);

    const [rows] = await db.query("SELECT * FROM content WHERE content_id = ?", [
      id,
    ]);
    await attachCategories(rows, "content_id");
    res.json(rows[0]);
  })
);

app.delete(
  "/content/:id",
  asyncHandler(async (req, res) => {
    try {
      const [result] = await db.query(
        "DELETE FROM content WHERE content_id = ?",
        [req.params.id]
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
  asyncHandler(async (req, res) => {
    const params = [];
    let sql = SCRIPT_SELECT;
    if (req.query.content_id) {
      sql += " WHERE s.content_id = ?";
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
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(`${SCRIPT_SELECT} WHERE s.script_id = ?`, [
      req.params.id,
    ]);
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

    let finalContentId = content_id;

    if (finalContentId) {
      const [contentRows] = await db.query(
        "SELECT content_id FROM content WHERE content_id = ?",
        [finalContentId]
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
        [DEFAULT_USER_ID, title, content_type]
      );
      finalContentId = contentResult.insertId;
    }

    await setContentCategories(finalContentId, category_ids);

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
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title, script_content, notes, status, content_type, category_ids } = req.body || {};

    const [existing] = await db.query(
      "SELECT * FROM scripts WHERE script_id = ?",
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Script not found" });
    }

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

    await setContentCategories(existing[0].content_id, category_ids);

    const [rows] = await db.query(`${SCRIPT_SELECT} WHERE s.script_id = ?`, [id]);
    await attachCategories(rows, "content_id");
    res.json(rows[0]);
  })
);

app.delete(
  "/scripts/:id",
  asyncHandler(async (req, res) => {
    const [result] = await db.query("DELETE FROM scripts WHERE script_id = ?", [
      req.params.id,
    ]);
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
  asyncHandler(async (req, res) => {
    await updateMissedScheduledContent();
    const [rows] = await db.query(`${SCHEDULED_SELECT} ORDER BY sc.scheduled_date ASC`);
    res.json(rows);
  })
);

app.get(
  "/scheduled-content/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(`${SCHEDULED_SELECT} WHERE sc.schedule_id = ?`, [
      req.params.id,
    ]);
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
      "SELECT content_id FROM content WHERE content_id = ?",
      [content_id]
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
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { scheduled_date, platform_id, status, published_at, external_content_url } =
      req.body || {};

    const [existing] = await db.query(
      "SELECT * FROM scheduled_content WHERE schedule_id = ?",
      [id]
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
          ? await getConnectedYoutubeChannelId()
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
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const [existing] = await db.query(
      "SELECT * FROM scheduled_content WHERE schedule_id = ?",
      [id]
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
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const [existing] = await db.query(
      "SELECT * FROM scheduled_content WHERE schedule_id = ?",
      [id]
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

async function getScheduleForYoutubeMatch(scheduleId) {
  const [rows] = await db.query(
    `SELECT sc.schedule_id, sc.content_id, sc.platform_id, sc.external_content_id,
            c.title AS content_title, p.platform_name
     FROM scheduled_content sc
     JOIN content c ON c.content_id = sc.content_id
     JOIN platforms p ON p.platform_id = sc.platform_id
     WHERE sc.schedule_id = ?`,
    [scheduleId]
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
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const schedule = await getScheduleForYoutubeMatch(id);
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
      [DEFAULT_USER_ID]
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
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { video_id: videoId } = req.body || {};

    if (!videoId) {
      return res.status(400).json({ message: "video_id is required" });
    }

    const schedule = await getScheduleForYoutubeMatch(id);
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
      [DEFAULT_USER_ID]
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
  asyncHandler(async (req, res) => {
    const [result] = await db.query(
      "DELETE FROM scheduled_content WHERE schedule_id = ?",
      [req.params.id]
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
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(`${PERFORMANCE_SELECT} ORDER BY pm.recorded_at DESC`);
    res.json(castNumbersAll(rows, ["engagement_rate"]));
  })
);

app.get(
  "/performance-metrics/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(`${PERFORMANCE_SELECT} WHERE pm.metric_id = ?`, [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "Performance metric not found" });
    }
    res.json(castNumbers(rows[0], ["engagement_rate"]));
  })
);

app.post(
  "/performance-metrics",
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
      "SELECT content_id FROM content WHERE content_id = ?",
      [content_id]
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
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const [existing] = await db.query(
      "SELECT * FROM performance_metrics WHERE metric_id = ?",
      [id]
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
  asyncHandler(async (req, res) => {
    const [result] = await db.query(
      "DELETE FROM performance_metrics WHERE metric_id = ?",
      [req.params.id]
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
// users.youtube_channel_id column, for DEFAULT_USER_ID (see note above).
// =======================================================================

app.get("/auth/youtube", (req, res, next) => {
  if (!isGoogleOAuthConfigured) {
    return res.redirect(`${FRONTEND_URL}/analytics.html?youtube=config_missing`);
  }
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

app.get(
  "/auth/youtube/callback",
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

    // The OAuth token was only ever needed for the lookup below — clear
    // it out of the session now rather than leaving it sitting around.
    req.logout(() => {});

    if (!accessToken) {
      return res.redirect(`${FRONTEND_URL}/analytics.html?youtube=error`);
    }

    let channelId;
    try {
      channelId = await youtubeService.getMyChannelId(accessToken);
    } catch (error) {
      console.error("YouTube channel lookup failed:", error.message);
      return res.redirect(`${FRONTEND_URL}/analytics.html?youtube=error`);
    }

    await db.query("UPDATE users SET youtube_channel_id = ? WHERE user_id = ?", [
      channelId,
      DEFAULT_USER_ID,
    ]);

    res.redirect(`${FRONTEND_URL}/analytics.html?youtube=connected`);
  })
);

// Lets the frontend ask "is YouTube connected?" without ever seeing a
// token — this is a plain DB read keyed on DEFAULT_USER_ID, the same
// single-creator assumption used everywhere else in this file.
app.get(
  "/youtube/connection-status",
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      "SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 5",
      [DEFAULT_USER_ID]
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
  asyncHandler(async (req, res) => {
    const { scheduleId } = req.params;

    const [scheduleRows] = await db.query(
      `SELECT sc.schedule_id, sc.content_id, sc.platform_id,
              sc.external_content_id, p.platform_name
       FROM scheduled_content sc
       JOIN platforms p ON p.platform_id = sc.platform_id
       WHERE sc.schedule_id = ?`,
      [scheduleId]
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
  asyncHandler(async (req, res) => {
    const [userRows] = await db.query(
      `SELECT user_id, youtube_channel_id
       FROM users
       WHERE user_id = ?
       LIMIT 5`,
      [DEFAULT_USER_ID]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        message: "Default creator/user was not found.",
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
  asyncHandler(async (req, res) => {
    const [userRows] = await db.query(
      `SELECT user_id, youtube_channel_id FROM users WHERE user_id = ? LIMIT 1`,
      [DEFAULT_USER_ID]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        message: "Default creator/user was not found.",
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
      [DEFAULT_USER_ID, platformRows[0].platform_id, user.youtube_channel_id]
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
      [info.channelId, DEFAULT_USER_ID]
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
  asyncHandler(async (req, res) => {
    await db.query(
      `UPDATE users SET youtube_channel_id = NULL WHERE user_id = ?`,
      [DEFAULT_USER_ID]
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
  asyncHandler(async (req, res) => {
    const [userRows] = await db.query(
      `SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 1`,
      [DEFAULT_USER_ID]
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
  asyncHandler(async (req, res) => {
    // PART 4: only ever total up YouTube metrics recorded under the
    // currently connected channel — see YT_CHANNEL_SCOPE_SQL above.
    const scoped = await hasChannelScopingColumn();
    const currentChannelId = scoped ? await getConnectedYoutubeChannelId() : null;

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
      JOIN platforms p ON p.platform_id = pm.platform_id
      ${scoped ? `WHERE ${YT_CHANNEL_SCOPE_SQL}` : ""}
      `,
      scoped ? [currentChannelId] : []
    );
    res.json(castNumbers(rows[0], ["total_views", "total_likes", "total_comments", "total_shares", "average_engagement_rate"]));
  })
);

app.get(
  "/analytics/top-content",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 5, 50);

    // PART 4: exclude YouTube metrics linked under a channel that isn't
    // the one currently connected — see YT_CHANNEL_SCOPE_SQL above.
    const scoped = await hasChannelScopingColumn();
    const currentChannelId = scoped ? await getConnectedYoutubeChannelId() : null;

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
      ${scoped ? `WHERE ${YT_CHANNEL_SCOPE_SQL}` : ""}
      ORDER BY engagement_rate DESC
      LIMIT ?
      `,
      scoped ? [currentChannelId, limit] : [limit]
    );
    res.json(castNumbersAll(rows, ["views", "likes", "comments", "shares", "engagement_rate"]));
  })
);

app.get(
  "/analytics/platform-performance",
  asyncHandler(async (req, res) => {
    // PART 4: the join condition (not a WHERE clause) is what has to
    // carry the channel scope here — this query LEFT JOINs FROM
    // platforms so that a platform with zero rows still shows a 0 row;
    // putting the filter in WHERE instead would turn that LEFT JOIN
    // back into an effective INNER JOIN and drop platforms with no
    // *currently-scoped* data instead of just zeroing their totals.
    const scoped = await hasChannelScopingColumn();
    const currentChannelId = scoped ? await getConnectedYoutubeChannelId() : null;

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
        ${scoped ? `AND ${YT_CHANNEL_SCOPE_SQL}` : ""}
      GROUP BY p.platform_id, p.platform_name
      ORDER BY p.platform_name
      `,
      scoped ? [currentChannelId] : []
    );
    res.json(castNumbersAll(rows, ["total_views", "total_likes", "total_comments", "total_shares", "average_engagement_rate"]));
  })
);

app.get(
  "/analytics/performance-over-time",
  asyncHandler(async (req, res) => {
    // PART 4/6: same channel scoping as the other analytics endpoints —
    // needs a platforms join (this query previously had none) purely to
    // evaluate that condition.
    const scoped = await hasChannelScopingColumn();
    const currentChannelId = scoped ? await getConnectedYoutubeChannelId() : null;

    const [rows] = await db.query(
      `
      SELECT
        DATE(pm.recorded_at) AS date,
        COALESCE(SUM(pm.views), 0) AS views,
        COALESCE(SUM(pm.likes), 0) AS likes,
        COALESCE(SUM(pm.comments), 0) AS comments,
        COALESCE(SUM(pm.shares), 0) AS shares
      FROM performance_metrics pm
      JOIN platforms p ON p.platform_id = pm.platform_id
      ${scoped ? `WHERE ${YT_CHANNEL_SCOPE_SQL}` : ""}
      GROUP BY DATE(pm.recorded_at)
      ORDER BY date ASC
      `,
      scoped ? [currentChannelId] : []
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

app.get(
  "/analytics/consistency",
  asyncHandler(async (req, res) => {
    await updateMissedScheduledContent();

    const { start, end } = req.query;
    const params = [];
    let sql = `
      SELECT status, COUNT(*) AS count
      FROM scheduled_content
      WHERE status IN ('Published', 'Missed')
    `;
    if (start) {
      sql += " AND scheduled_date >= ?";
      params.push(start);
    }
    if (end) {
      sql += " AND scheduled_date <= ?";
      params.push(end);
    }
    sql += " GROUP BY status";

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

    res.json({
      eligibleContent,
      publishedCount,
      missedCount,
      consistencyPercentage,
    });
  })
);

app.get(
  "/analytics/consistency/by-platform",
  asyncHandler(async (req, res) => {
    await updateMissedScheduledContent();

    const [rows] = await db.query(`
      SELECT
        p.platform_id, p.platform_name,
        SUM(CASE WHEN sc.status = 'Published' THEN 1 ELSE 0 END) AS publishedCount,
        SUM(CASE WHEN sc.status = 'Missed' THEN 1 ELSE 0 END) AS missedCount
      FROM scheduled_content sc
      JOIN platforms p ON p.platform_id = sc.platform_id
      WHERE sc.status IN ('Published', 'Missed')
      GROUP BY p.platform_id, p.platform_name
      ORDER BY p.platform_name
    `);

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
  asyncHandler(async (req, res) => {
    await updateMissedScheduledContent();

    // Only "week" or "month" are supported; anything else falls back to month.
    const groupBy = req.query.groupBy === "week" ? "week" : "month";
    const periodExpr =
      groupBy === "week"
        ? "YEARWEEK(scheduled_date, 3)" // ISO-8601 week
        : "DATE_FORMAT(scheduled_date, '%Y-%m')";

    const [rows] = await db.query(`
      SELECT
        ${periodExpr} AS period_key,
        MIN(scheduled_date) AS period_start,
        SUM(CASE WHEN status = 'Published' THEN 1 ELSE 0 END) AS publishedCount,
        SUM(CASE WHEN status = 'Missed' THEN 1 ELSE 0 END) AS missedCount
      FROM scheduled_content
      WHERE status IN ('Published', 'Missed')
      GROUP BY period_key
      ORDER BY period_key ASC
    `);

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
// only reads existing tables via existing patterns (DEFAULT_USER_ID,
// updateMissedScheduledContent, the youtube_channel_id/follower_metrics
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
  asyncHandler(async (req, res) => {
    await updateMissedScheduledContent();

    // ---- Content summary (single query, EXISTS-based per the note above) ----
    const [[contentSummaryRow]] = await db.query(`
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
    `);

    const total = Number(contentSummaryRow.total) || 0;
    const published = Number(contentSummaryRow.published) || 0;
    const scheduled = Number(contentSummaryRow.scheduled) || 0;
    const draft = total - published - scheduled;

    // ---- Upcoming content (next 5 future items, grouped by CONTENT) ----
    // The same piece of content is often scheduled on several platforms
    // (several scheduled_content rows sharing one content_id). Fetched
    // ungrouped here — LIMIT is applied after grouping below, otherwise
    // "5 rows" could all be the same content item on 5 platforms while a
    // genuinely different upcoming item never appears.
    const [upcomingRawRows] = await db.query(`
      SELECT
        sc.content_id, sc.scheduled_date,
        c.title AS content_title, c.content_type,
        p.platform_name
      FROM scheduled_content sc
      JOIN content c ON c.content_id = sc.content_id
      JOIN platforms p ON p.platform_id = sc.platform_id
      WHERE sc.status = 'Scheduled' AND sc.scheduled_date >= NOW()
      ORDER BY sc.scheduled_date ASC
    `);

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

    const upcomingContent = Array.from(upcomingGroupsById.values())
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

    // ---- Platform overview ----
    const [userRows] = await db.query(
      "SELECT youtube_channel_id FROM users WHERE user_id = ? LIMIT 5",
      [DEFAULT_USER_ID]
    );
    const youtubeChannelId = userRows[0] && userRows[0].youtube_channel_id;

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
          [DEFAULT_USER_ID, ytPlatformRows[0].platform_id]
        );
        if (latestFollowerRows.length > 0) {
          youtubeSubscriberCount = Number(latestFollowerRows[0].follower_count);
        }
      }
    }

    const platforms = {
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

    // ---- Recent performance snapshot (single most recent metric row) ----
    // PART 4: applies the same current-channel scoping as the Analytics
    // page (see YT_CHANNEL_SCOPE_SQL above) so this card can never show a
    // previously-connected channel's metrics as if they were current.
    const scopedForSnapshot = await hasChannelScopingColumn();
    const snapshotChannelId = scopedForSnapshot ? youtubeChannelId : null;
    const [latestPerfRows] = await db.query(
      `${PERFORMANCE_SELECT} ${scopedForSnapshot ? `WHERE ${YT_CHANNEL_SCOPE_SQL}` : ""}
       ORDER BY pm.recorded_at DESC LIMIT 5`,
      scopedForSnapshot ? [snapshotChannelId] : []
    );
    const latestPerformance = latestPerfRows.length > 0
      ? castNumbers(latestPerfRows[0], ["views", "likes", "comments", "shares", "engagement_rate"])
      : null;

    res.json({
      contentSummary: { total, draft, scheduled, published },
      upcomingContent,
      platforms,
      latestPerformance,
    });
  })
);

// =======================================================================
// COMPETITORS
// Manually-recorded public activity only. There is no live API that
// exposes another creator's private analytics (and scraping competitor
// pages is out of scope), so every number here is what the creator has
// entered by hand from what is publicly visible on a competitor's post.
// Nothing here is fabricated or estimated — see /analytics/competitor-
// activity's `dataSource` field, which states this explicitly for the UI.
// =======================================================================

const COMPETITOR_SELECT = `
  SELECT co.competitor_id, co.user_id, co.name, co.platform_id,
         p.platform_name, co.profile_url, co.category, co.created_at
  FROM competitors co
  JOIN platforms p ON p.platform_id = co.platform_id
`;

app.get(
  "/competitors",
  asyncHandler(async (req, res) => {
    const params = [DEFAULT_USER_ID];
    let sql = `${COMPETITOR_SELECT} WHERE co.user_id = ?`;
    if (req.query.platform_id) {
      sql += " AND co.platform_id = ?";
      params.push(req.query.platform_id);
    }
    sql += " ORDER BY co.name";
    const [rows] = await db.query(sql, params);
    res.json(rows);
  })
);

app.get(
  "/competitors/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      `${COMPETITOR_SELECT} WHERE co.competitor_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Competitor not found" });
    }
    res.json(rows[0]);
  })
);

app.post(
  "/competitors",
  asyncHandler(async (req, res) => {
    const { name, platform_id, profile_url, category } = req.body || {};
    if (!name || !platform_id) {
      return res.status(400).json({ message: "name and platform_id are required" });
    }
    try {
      const [result] = await db.query(
        `INSERT INTO competitors (user_id, name, platform_id, profile_url, category, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [DEFAULT_USER_ID, name, platform_id, profile_url || null, category || null]
      );
      const [rows] = await db.query(
        `${COMPETITOR_SELECT} WHERE co.competitor_id = ?`,
        [result.insertId]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === "ER_NO_REFERENCED_ROW_2" || err.code === "ER_NO_REFERENCED_ROW") {
        return res.status(400).json({ message: "platform_id does not reference an existing platform" });
      }
      throw err;
    }
  })
);

app.put(
  "/competitors/:id",
  asyncHandler(async (req, res) => {
    const { name, platform_id, profile_url, category } = req.body || {};
    const { id } = req.params;

    const [existing] = await db.query(
      "SELECT * FROM competitors WHERE competitor_id = ?",
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Competitor not found" });
    }

    try {
      await db.query(
        `UPDATE competitors SET
           name = COALESCE(?, name),
           platform_id = COALESCE(?, platform_id),
           profile_url = COALESCE(?, profile_url),
           category = COALESCE(?, category)
         WHERE competitor_id = ?`,
        [name, platform_id, profile_url, category, id]
      );
    } catch (err) {
      if (err.code === "ER_NO_REFERENCED_ROW_2" || err.code === "ER_NO_REFERENCED_ROW") {
        return res.status(400).json({ message: "platform_id does not reference an existing platform" });
      }
      throw err;
    }

    const [rows] = await db.query(
      `${COMPETITOR_SELECT} WHERE co.competitor_id = ?`,
      [id]
    );
    res.json(rows[0]);
  })
);

app.delete(
  "/competitors/:id",
  asyncHandler(async (req, res) => {
    // competitor_content rows cascade-delete automatically (FK ON DELETE CASCADE)
    const [result] = await db.query(
      "DELETE FROM competitors WHERE competitor_id = ?",
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Competitor not found" });
    }
    res.json({ message: "Competitor deleted" });
  })
);

// ---- Competitor content: manually recorded public posts ----
// engagement_rate reuses the exact formula used everywhere else in this
// file — (likes + comments + shares) / views * 100, 0 when views = 0 —
// so there is never a second, inconsistent engagement calculation.

const COMPETITOR_CONTENT_SELECT = `
  SELECT cc.competitor_content_id, cc.competitor_id, cc.title, cc.topic,
         cc.published_at, cc.views, cc.likes, cc.comments, cc.shares, cc.source_url,
         CASE WHEN cc.views = 0 THEN 0
              ELSE ROUND((cc.likes + cc.comments + cc.shares) / cc.views * 100, 2)
         END AS engagement_rate
  FROM competitor_content cc
`;

app.get(
  "/competitors/:id/content",
  asyncHandler(async (req, res) => {
    const [competitor] = await db.query(
      "SELECT competitor_id FROM competitors WHERE competitor_id = ?",
      [req.params.id]
    );
    if (competitor.length === 0) {
      return res.status(404).json({ message: "Competitor not found" });
    }

    const params = [req.params.id];
    let sql = `${COMPETITOR_CONTENT_SELECT} WHERE cc.competitor_id = ?`;
    if (req.query.start) {
      sql += " AND cc.published_at >= ?";
      params.push(req.query.start);
    }
    if (req.query.end) {
      sql += " AND cc.published_at <= ?";
      params.push(req.query.end);
    }
    sql += " ORDER BY cc.published_at DESC";

    const [rows] = await db.query(sql, params);
    res.json(castNumbersAll(rows, ["views", "likes", "comments", "shares", "engagement_rate"]));
  })
);

app.post(
  "/competitors/:id/content",
  asyncHandler(async (req, res) => {
    const { title, topic, published_at, views, likes, comments, shares, source_url } =
      req.body || {};
    const competitorId = req.params.id;

    const [competitor] = await db.query(
      "SELECT competitor_id FROM competitors WHERE competitor_id = ?",
      [competitorId]
    );
    if (competitor.length === 0) {
      return res.status(404).json({ message: "Competitor not found" });
    }
    if (!title) {
      return res.status(400).json({ message: "title is required" });
    }

    const [result] = await db.query(
      `INSERT INTO competitor_content
         (competitor_id, title, topic, published_at, views, likes, comments, shares, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        competitorId,
        title,
        topic || null,
        published_at || null,
        views || 0,
        likes || 0,
        comments || 0,
        shares || 0,
        source_url || null,
      ]
    );

    const [rows] = await db.query(
      `${COMPETITOR_CONTENT_SELECT} WHERE cc.competitor_content_id = ?`,
      [result.insertId]
    );
    res.status(201).json(castNumbers(rows[0], ["views", "likes", "comments", "shares", "engagement_rate"]));
  })
);

app.put(
  "/competitor-content/:id",
  asyncHandler(async (req, res) => {
    const { title, topic, published_at, views, likes, comments, shares, source_url } =
      req.body || {};
    const { id } = req.params;

    const [existing] = await db.query(
      "SELECT * FROM competitor_content WHERE competitor_content_id = ?",
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Competitor content not found" });
    }

    await db.query(
      `UPDATE competitor_content SET
         title = COALESCE(?, title),
         topic = COALESCE(?, topic),
         published_at = COALESCE(?, published_at),
         views = COALESCE(?, views),
         likes = COALESCE(?, likes),
         comments = COALESCE(?, comments),
         shares = COALESCE(?, shares),
         source_url = COALESCE(?, source_url)
       WHERE competitor_content_id = ?`,
      [title, topic, published_at, views, likes, comments, shares, source_url, id]
    );

    const [rows] = await db.query(
      `${COMPETITOR_CONTENT_SELECT} WHERE cc.competitor_content_id = ?`,
      [id]
    );
    res.json(castNumbers(rows[0], ["views", "likes", "comments", "shares", "engagement_rate"]));
  })
);

app.delete(
  "/competitor-content/:id",
  asyncHandler(async (req, res) => {
    const [result] = await db.query(
      "DELETE FROM competitor_content WHERE competitor_content_id = ?",
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Competitor content not found" });
    }
    res.json({ message: "Competitor content deleted" });
  })
);

// ---- Competitor activity analytics ----
// Posting frequency + average engagement per competitor over a rolling
// window, placed next to the creator's own posting frequency + average
// engagement over the IDENTICAL window, so the comparison the panel
// asked for ("relative performance") is apples-to-apples. Reuses the
// existing channel-scoping helper for the creator's YouTube figures —
// no second scoping mechanism.

app.get(
  "/analytics/competitor-activity",
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days) || 30;

    const [competitorRows] = await db.query(
      `
      SELECT
        co.competitor_id, co.name, p.platform_name,
        COUNT(cc.competitor_content_id) AS postCount,
        COALESCE(ROUND(AVG(
          CASE WHEN cc.views = 0 THEN 0 ELSE (cc.likes + cc.comments + cc.shares) / cc.views * 100 END
        ), 2), 0) AS averageEngagementRate,
        COALESCE(SUM(cc.views), 0) AS totalViews
      FROM competitors co
      JOIN platforms p ON p.platform_id = co.platform_id
      LEFT JOIN competitor_content cc
        ON cc.competitor_id = co.competitor_id
        AND cc.published_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      WHERE co.user_id = ?
      GROUP BY co.competitor_id, co.name, p.platform_name
      ORDER BY postCount DESC
      `,
      [days, DEFAULT_USER_ID]
    );

    const scoped = await hasChannelScopingColumn();
    const currentChannelId = scoped ? await getConnectedYoutubeChannelId() : null;

    const [creatorPublishedRows] = await db.query(
      `SELECT COUNT(*) AS postCount
       FROM scheduled_content
       WHERE status = 'Published' AND published_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );

    const [creatorEngagementRows] = await db.query(
      `
      SELECT COALESCE(ROUND(AVG(
        CASE WHEN pm.views = 0 THEN 0 ELSE (pm.likes + pm.comments + pm.shares) / pm.views * 100 END
      ), 2), 0) AS averageEngagementRate
      FROM performance_metrics pm
      JOIN platforms p ON p.platform_id = pm.platform_id
      WHERE pm.recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ${scoped ? `AND ${YT_CHANNEL_SCOPE_SQL}` : ""}
      `,
      scoped ? [days, currentChannelId] : [days]
    );

    res.json({
      windowDays: days,
      dataSource:
        "Competitor figures are manually recorded by the creator from publicly visible posts — not synced from any live API.",
      creator: {
        postCount: Number(creatorPublishedRows[0].postCount),
        averageEngagementRate: Number(creatorEngagementRows[0].averageEngagementRate),
      },
      competitors: castNumbersAll(competitorRows, ["postCount", "averageEngagementRate", "totalViews"]),
    });
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
  console.error("DB/SERVER ERROR:", err);
  res.status(500).json({ message: err.sqlMessage || err.message || "Unexpected server error" });
});

// START SERVER (ALWAYS LAST)
app.listen(3000, () => {
  console.log("Server running on port 3000");
});