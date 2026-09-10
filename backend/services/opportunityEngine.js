// backend/services/opportunityEngine.js
//
// Pure, side-effect-free scoring logic for missed-content-opportunity
// detection (Project B, Objective 4). Nothing here talks to the database
// or any external API — the caller (server.js) gathers the real,
// already-collected data (competitor_content rows, the creator's own
// category usage, the creator's own published content) and passes it in
// here as plain values. Keeping the arithmetic isolated like this is
// what makes it unit-testable and explainable in a defence: every
// input/output pair can be checked by hand against the formula below.
//
// ---------------------------------------------------------------------
// WHAT COUNTS AS A "MISSED OPPORTUNITY" HERE (deliberately NOT the same
// thing as a missed *scheduled* item):
//
//   A topic that at least one tracked competitor posted about within the
//   last OPPORTUNITY_WINDOW_DAYS days, which is relevant to a category
//   the creator actually creates content in, and which the creator has
//   NOT published anything matching in that same window.
//
// This module only computes the SCORE for a candidate that already
// satisfies that definition — the relevance/coverage checks themselves
// live in server.js (detectMissedOpportunities()) alongside the SQL that
// gathers the real data.
// ---------------------------------------------------------------------

const OPPORTUNITY_WINDOW_DAYS = 14;

// Relevance — two tiers, each explainable in one sentence.
const RELEVANCE_CATEGORY_MATCH = 100; // competitor's logged category exactly matches a category the creator has used
const RELEVANCE_KEYWORD_MATCH = 60; // no category match, but the topic text contains a category name the creator has used

// Competitor activity — how many distinct competitors covered the topic
// in the window. 1 competitor = some evidence, 2+ = strong evidence.
// Capped at 100 so a topic covered by many competitors never exceeds
// the scale.
const COMPETITOR_ACTIVITY_PER_COMPETITOR = 50;

// Engagement — the competitor content's own average engagement rate on
// this topic, benchmarked against a fixed reference rate. Average
// engagement at or above this benchmark scores full marks; below it,
// the score scales down linearly. This is a documented constant, not a
// value invented at runtime — state it plainly in the defence.
const ENGAGEMENT_BENCHMARK_RATE = 10;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function computeRelevanceScore(categoryMatched) {
  return categoryMatched ? RELEVANCE_CATEGORY_MATCH : RELEVANCE_KEYWORD_MATCH;
}

function computeCompetitorActivityScore(distinctCompetitorCount) {
  return round2(clamp((distinctCompetitorCount || 0) * COMPETITOR_ACTIVITY_PER_COMPETITOR, 0, 100));
}

function computeEngagementScore(averageCompetitorEngagementRate) {
  const rate = Number(averageCompetitorEngagementRate) || 0;
  return round2(clamp((rate / ENGAGEMENT_BENCHMARK_RATE) * 100, 0, 100));
}

// Timeliness — how recently the most recent competitor post on this
// topic went out, relative to the opportunity window. A post from today
// scores 100; a post from OPPORTUNITY_WINDOW_DAYS days ago (or more)
// scores 0.
function computeTimelinessScore(daysSinceLatestCompetitorPost, windowDays = OPPORTUNITY_WINDOW_DAYS) {
  if (daysSinceLatestCompetitorPost === null || daysSinceLatestCompetitorPost === undefined) {
    return 0;
  }
  const ratio = 1 - daysSinceLatestCompetitorPost / windowDays;
  return round2(clamp(ratio * 100, 0, 100));
}

/**
 * Combines the four bounded (0-100) sub-scores into the final weighted
 * opportunity score and impact classification.
 *
 *   opportunity_score = 0.30(relevance) + 0.25(competitorActivity)
 *                      + 0.25(engagement) + 0.20(timeliness)
 *
 *   0-39   = Low
 *   40-69  = Medium
 *   70-100 = High
 */
function computeOpportunityScore({ relevance, competitorActivity, engagement, timeliness }) {
  const r = clamp(Number(relevance) || 0, 0, 100);
  const c = clamp(Number(competitorActivity) || 0, 0, 100);
  const e = clamp(Number(engagement) || 0, 0, 100);
  const t = clamp(Number(timeliness) || 0, 0, 100);

  const score = round2(0.3 * r + 0.25 * c + 0.25 * e + 0.2 * t);
  return { opportunityScore: score, impactLevel: classifyImpact(score) };
}

function classifyImpact(score) {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

module.exports = {
  OPPORTUNITY_WINDOW_DAYS,
  RELEVANCE_CATEGORY_MATCH,
  RELEVANCE_KEYWORD_MATCH,
  COMPETITOR_ACTIVITY_PER_COMPETITOR,
  ENGAGEMENT_BENCHMARK_RATE,
  computeRelevanceScore,
  computeCompetitorActivityScore,
  computeEngagementScore,
  computeTimelinessScore,
  computeOpportunityScore,
  classifyImpact,
};