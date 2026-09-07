// backend/services/videoMatcher.js
//
// Pure, side-effect-free title matching for the automatic YouTube video
// workflow. Given the system's content/script title and a list of
// candidate videos returned by youtubeService.searchChannelVideosByTitle
// (already scoped to the creator's own connected channel — this module
// never talks to any API itself), decides whether the correct video can
// be identified automatically, or whether the creator needs to choose.
//
// Matching priority (see PART 2 / MATCHING LOGIC of the spec):
//   Level 1 — Exact match (case-insensitive, otherwise verbatim)
//   Level 2 — Normalised match (case/whitespace/punctuation-insensitive)
//   Level 3 — Multiple plausible matches -> return candidates, let the
//             creator choose. This also covers "no exact/normalised
//             match, but the channel search still returned plausible
//             results" — those are surfaced as candidates rather than
//             silently discarded.
//   Level 4 — No match at all -> caller reports a clear "not found"
//             message. Never fabricated, never randomly chosen.
//
// This module never picks between multiple equally-good matches itself —
// that decision is always handed back to the creator.

// Collapses case, punctuation and extra whitespace so trivial differences
// (an extra "!", double spaces, mixed case) don't block an automatic
// match. Deliberately conservative: only strips characters that aren't
// letters/numbers/whitespace, so meaningfully different titles still
// compare as different.
function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "") // strip punctuation/symbols
    .replace(/\s+/g, " ")
    .trim();
}

function exactMatch(title, candidateTitle) {
  return String(title || "").trim().toLowerCase() === String(candidateTitle || "").trim().toLowerCase();
}

function normalizedMatch(title, candidateTitle) {
  return normalizeTitle(title) === normalizeTitle(candidateTitle);
}

/**
 * Classifies a set of candidate videos (from the creator's own channel)
 * against the system's content title.
 *
 * @param {string} title - the content/script title to match against
 * @param {Array<{videoId, title, publishedAt, thumbnailUrl}>} candidates
 * @returns {
 *   { matchType: 'exact' | 'normalized', match: candidate } |
 *   { matchType: 'multiple', candidates: candidate[] } |
 *   { matchType: 'none' }
 * }
 */
function classifyVideoMatch(title, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];

  if (list.length === 0) {
    return { matchType: "none" };
  }

  // Level 1 — exact, case-insensitive match.
  const exactMatches = list.filter((c) => exactMatch(title, c.title));
  if (exactMatches.length === 1) {
    return { matchType: "exact", match: exactMatches[0] };
  }
  if (exactMatches.length > 1) {
    // Never guess between two identically-titled uploads — let the
    // creator pick the right one.
    return { matchType: "multiple", candidates: exactMatches };
  }

  // Level 2 — normalised match (case/punctuation/whitespace-insensitive).
  const normalizedMatches = list.filter((c) => normalizedMatch(title, c.title));
  if (normalizedMatches.length === 1) {
    return { matchType: "normalized", match: normalizedMatches[0] };
  }
  if (normalizedMatches.length > 1) {
    return { matchType: "multiple", candidates: normalizedMatches };
  }

  // Level 3 — nothing matched cleanly, but the channel search still
  // returned plausible-looking results (it was already scoped to this
  // title). Never auto-select one; hand them all to the creator.
  return { matchType: "multiple", candidates: list };
}

module.exports = {
  classifyVideoMatch,
  normalizeTitle,
};