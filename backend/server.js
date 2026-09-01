console.log("Backend server starting...");
require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

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
    res.json(rows[0]);
  })
);

app.post(
  "/content",
  asyncHandler(async (req, res) => {
    const { title, description, content_type, status } = req.body || {};

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

    const [rows] = await db.query("SELECT * FROM content WHERE content_id = ?", [
      result.insertId,
    ]);
    res.status(201).json(rows[0]);
  })
);

app.put(
  "/content/:id",
  asyncHandler(async (req, res) => {
    const { title, description, content_type, status } = req.body || {};
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

    const [rows] = await db.query("SELECT * FROM content WHERE content_id = ?", [
      id,
    ]);
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

    const [scriptResult] = await db.query(
      `INSERT INTO scripts (content_id, title, script_content, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [finalContentId, title, script_content, notes || null, status || "draft"]
    );

    const [rows] = await db.query(`${SCRIPT_SELECT} WHERE s.script_id = ?`, [
      scriptResult.insertId,
    ]);
    res.status(201).json(rows[0]);
  })
);

app.put(
  "/scripts/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title, script_content, notes, status, content_type } = req.body || {};

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

    const [rows] = await db.query(`${SCRIPT_SELECT} WHERE s.script_id = ?`, [id]);
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
    const { scheduled_date, platform_id, status, published_at } = req.body || {};

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

    await db.query(
      `UPDATE scheduled_content SET
         scheduled_date = COALESCE(?, scheduled_date),
         platform_id = COALESCE(?, platform_id),
         status = COALESCE(?, status),
         published_at = COALESCE(?, published_at)
       WHERE schedule_id = ?`,
      [scheduled_date, platform_id, status, finalPublishedAt, id]
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
// ANALYTICS (read-only aggregation over performance_metrics)
// =======================================================================

app.get(
  "/analytics/summary",
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(`
      SELECT
        COALESCE(SUM(views), 0) AS total_views,
        COALESCE(SUM(likes), 0) AS total_likes,
        COALESCE(SUM(comments), 0) AS total_comments,
        COALESCE(SUM(shares), 0) AS total_shares,
        COALESCE(ROUND(AVG(
          CASE WHEN views = 0 THEN 0 ELSE (likes + comments + shares) / views * 100 END
        ), 2), 0) AS average_engagement_rate
      FROM performance_metrics
    `);
    res.json(castNumbers(rows[0], ["total_views", "total_likes", "total_comments", "total_shares", "average_engagement_rate"]));
  })
);

app.get(
  "/analytics/top-content",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 5, 50);
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
      ORDER BY engagement_rate DESC
      LIMIT ?
      `,
      [limit]
    );
    res.json(castNumbersAll(rows, ["views", "likes", "comments", "shares", "engagement_rate"]));
  })
);

app.get(
  "/analytics/platform-performance",
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(`
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
      LEFT JOIN performance_metrics pm ON pm.platform_id = p.platform_id
      GROUP BY p.platform_id, p.platform_name
      ORDER BY p.platform_name
    `);
    res.json(castNumbersAll(rows, ["total_views", "total_likes", "total_comments", "total_shares", "average_engagement_rate"]));
  })
);

app.get(
  "/analytics/performance-over-time",
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(`
      SELECT
        DATE(recorded_at) AS date,
        COALESCE(SUM(views), 0) AS views,
        COALESCE(SUM(likes), 0) AS likes,
        COALESCE(SUM(comments), 0) AS comments,
        COALESCE(SUM(shares), 0) AS shares
      FROM performance_metrics
      GROUP BY DATE(recorded_at)
      ORDER BY date ASC
    `);
    res.json(castNumbersAll(rows, ["views", "likes", "comments", "shares"]));
  })
);

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