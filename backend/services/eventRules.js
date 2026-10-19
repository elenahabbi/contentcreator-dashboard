// backend/services/eventRules.js
//
// Pure, side-effect-free rules for creator events (Project B, Phase 2).
// Nothing here touches the database or Express, so every rule can be
// checked by hand or unit-tested on its own.
//
// A creator event is a date that matters to the creator's content (a
// holiday, a conference, a series launch). It is NOT a scheduled post:
// scheduled posts live in scheduled_content and are managed on the
// calendar. Events only feed the opportunity engine, and only when they
// match one of the creator's own topics.

// Opportunity titles are built as "Event opportunity: <title> (YYYY-MM-DD)"
// and stored in opportunities.title varchar(255), so the event title is
// capped well below 255 to guarantee the derived title always fits.
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_SOURCE_LENGTH = 255;
const MAX_KEYWORDS_LENGTH = 1000;

// Dates outside this range are almost certainly typos (e.g. 0026-10-20).
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

// How far ahead an event can be and still be considered by the
// opportunity engine.
const EVENT_LOOKAHEAD_DAYS = 90;

// True only for a real calendar date written as YYYY-MM-DD
// (rejects 2026-02-30, 2026-13-01, "tomorrow", 20261020, ...).
function isValidEventDate(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Optional text field: undefined stays undefined (not supplied);
// null / "" / whitespace become null (cleared); anything else must be a
// string within the limit.
function readOptionalText(body, field, maxLength, errors, value) {
  if (!Object.prototype.hasOwnProperty.call(body, field) || body[field] === undefined) return;
  const raw = body[field];
  if (raw === null) {
    value[field] = null;
    return;
  }
  if (typeof raw !== "string") {
    errors.push(`${field} must be text.`);
    return;
  }
  const trimmed = raw.trim();
  if (trimmed.length > maxLength) {
    errors.push(`${field} must be at most ${maxLength} characters.`);
    return;
  }
  value[field] = trimmed === "" ? null : trimmed;
}

// Accepts "easter, lent" or ["easter", "lent"]; stores "easter, lent".
function normalizeKeywords(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw).split(",");
  const seen = new Set();
  const cleaned = [];
  for (const part of parts) {
    if (typeof part !== "string") return { error: true };
    const keyword = part.trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(keyword);
  }
  return { value: cleaned.length ? cleaned.join(", ") : null };
}

/**
 * Validates an event request body.
 *   partial = false  (create): title and event_date are required.
 *   partial = true   (update): only supplied fields are validated; at
 *                    least one updatable field must be supplied.
 * Returns { errors: string[], value: {...} } where `value` contains only
 * the fields that were supplied, already trimmed/normalised. Unknown
 * fields (including any user_id sent by a client) are ignored.
 */
function validateEventInput(body, { partial = false } = {}) {
  const errors = [];
  const value = {};

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { errors: ["Request body must be a JSON object."], value };
  }

  // title
  if (Object.prototype.hasOwnProperty.call(body, "title") && body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim() === "") {
      errors.push("title is required.");
    } else if (body.title.trim().length > MAX_TITLE_LENGTH) {
      errors.push(`title must be at most ${MAX_TITLE_LENGTH} characters.`);
    } else {
      value.title = body.title.trim();
    }
  } else if (!partial) {
    errors.push("title is required.");
  }

  // event_date
  if (Object.prototype.hasOwnProperty.call(body, "event_date") && body.event_date !== undefined) {
    if (typeof body.event_date === "string" && body.event_date.trim() === "") {
      errors.push("event_date is required.");
    } else if (!isValidEventDate(body.event_date)) {
      errors.push(
        `event_date must be a real calendar date written as YYYY-MM-DD (year ${MIN_YEAR}-${MAX_YEAR}).`
      );
    } else {
      value.event_date = body.event_date;
    }
  } else if (!partial) {
    errors.push("event_date is required.");
  }

  readOptionalText(body, "description", MAX_DESCRIPTION_LENGTH, errors, value);
  readOptionalText(body, "source", MAX_SOURCE_LENGTH, errors, value);

  // relevance_keywords
  if (
    Object.prototype.hasOwnProperty.call(body, "relevance_keywords") &&
    body.relevance_keywords !== undefined
  ) {
    const raw = body.relevance_keywords;
    if (raw === null) {
      value.relevance_keywords = null;
    } else if (typeof raw !== "string" && !Array.isArray(raw)) {
      errors.push("relevance_keywords must be text or a list of keywords.");
    } else {
      const normalised = normalizeKeywords(raw);
      if (normalised.error) {
        errors.push("relevance_keywords must contain only text.");
      } else if (normalised.value && normalised.value.length > MAX_KEYWORDS_LENGTH) {
        errors.push(`relevance_keywords must be at most ${MAX_KEYWORDS_LENGTH} characters.`);
      } else {
        value.relevance_keywords = normalised.value;
      }
    }
  }

  if (partial && errors.length === 0 && Object.keys(value).length === 0) {
    errors.push("No updatable fields were supplied.");
  }

  return { errors, value };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Does the event's own text (title, description, keywords) mention this
// topic as a whole word/phrase? "Art" matches "Art Week" but not "party".
function eventMatchesTopic(event, topicName) {
  const name = String(topicName || "").trim();
  if (!name || !event) return false;
  const haystack = [event.title, event.description, event.relevance_keywords]
    .filter(Boolean)
    .join(" ");
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`,
    "iu"
  );
  return pattern.test(haystack);
}

// First of the creator's own topics that the event mentions, or null.
// No match means no opportunity: an event is never forced into one.
function findMatchingTopic(event, topics) {
  for (const topic of topics || []) {
    if (eventMatchesTopic(event, topic.category_name)) return topic;
  }
  return null;
}

module.exports = {
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_KEYWORDS_LENGTH,
  EVENT_LOOKAHEAD_DAYS,
  isValidEventDate,
  validateEventInput,
  eventMatchesTopic,
  findMatchingTopic,
};