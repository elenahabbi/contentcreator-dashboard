// backend/services/recommendationEngine.js
//
// Pure, side-effect-free RULE logic for recommendation generation
// (Project B, Objective 4). Nothing here talks to the database — the
// caller (server.js: generateRecommendations()) gathers the real,
// already-collected data (from the existing consistency, performance and
// competitor-activity queries — no second copy of those formulas) and
// passes plain values in here. Keeping the thresholds isolated like this
// is what makes them unit-testable and explainable in a defence: every
// input/output pair can be checked by hand.
//
// Each rule follows: DATA -> ANALYSIS (done by the caller) -> RULE (this
// file) -> RECOMMENDATION (built by the caller from the boolean this file
// returns). No rule here generates natural-language text — that keeps
// the "explainable, not an LLM guessing" property the brief asks for.

// ---- Rule 1: posting consistency is low ----------------------------------
// Fires when consistency % (published / (published+missed) * 100, the
// same formula /analytics/consistency already uses) drops below this
// threshold. Requires a minimum sample so one early miss on a brand-new
// account doesn't immediately trigger it.
const CONSISTENCY_LOW_THRESHOLD = 70;
const MIN_ELIGIBLE_FOR_CONSISTENCY_RULE = 3;

function qualifiesForConsistencyReview(consistencyPercentage, eligibleContent) {
  if (consistencyPercentage === null || consistencyPercentage === undefined) return false;
  if ((eligibleContent || 0) < MIN_ELIGIBLE_FOR_CONSISTENCY_RULE) return false;
  return consistencyPercentage < CONSISTENCY_LOW_THRESHOLD;
}

// ---- Rule 2: a content category clearly outperforms the creator's own
// overall average -----------------------------------------------------------
// Fires when a category's average engagement rate (same engagement-rate
// formula used everywhere else) is at least this multiple of the
// creator's overall average. Requires a minimum number of published
// items in that category so a single high-performing post doesn't count
// as a "pattern".
const CATEGORY_OUTPERFORM_MULTIPLIER = 1.5;
const MIN_CONTENT_FOR_CATEGORY_RULE = 2;

function qualifiesForCategoryRecommendation(categoryAvgEngagement, categoryContentCount, overallAvgEngagement) {
  if ((categoryContentCount || 0) < MIN_CONTENT_FOR_CATEGORY_RULE) return false;
  if (!overallAvgEngagement || overallAvgEngagement <= 0) return false;
  return categoryAvgEngagement >= overallAvgEngagement * CATEGORY_OUTPERFORM_MULTIPLIER;
}

// ---- Rule 3: a high-impact opportunity is still actionable ----------------
// Fires for any opportunity already classified "High" by opportunityEngine
// (see opportunityEngine.js) that is still Active and whose deadline (the
// end of its opportunity window) has not yet passed. A Low/Medium
// opportunity, or one past its deadline, is not actionable — the creator
// missed the window, so recommending it would be misleading.
function qualifiesForOpportunityAction(opportunity) {
  if (!opportunity) return false;
  if (opportunity.status !== "Active") return false;
  if (opportunity.impact_level !== "High") return false;
  if (opportunity.opportunity_deadline && new Date(opportunity.opportunity_deadline) < new Date()) {
    return false;
  }
  return true;
}

// ---- Rule 4: a tracked competitor significantly outperforms the creator --
// Fires when a competitor's average engagement rate is at least this
// multiple of the creator's own average, over the same window used by
// /analytics/competitor-activity. A floor on the competitor's own rate
// avoids two near-zero numbers (e.g. 0.2% vs 0.1%) counting as
// "significant" just because the ratio is large.
const COMPETITOR_OUTPERFORM_MULTIPLIER = 1.5;
const MIN_COMPETITOR_ENGAGEMENT_FLOOR = 1; // percent

function qualifiesForCompetitorReview(competitorAvgEngagement, competitorPostCount, creatorAvgEngagement) {
  if (!competitorPostCount) return false;
  if (competitorAvgEngagement < MIN_COMPETITOR_ENGAGEMENT_FLOOR) return false;
  if (!creatorAvgEngagement || creatorAvgEngagement <= 0) {
    // Creator has no measurable engagement yet but the competitor does —
    // still worth surfacing, since there's nothing to divide by.
    return true;
  }
  return competitorAvgEngagement >= creatorAvgEngagement * COMPETITOR_OUTPERFORM_MULTIPLIER;
}

module.exports = {
  CONSISTENCY_LOW_THRESHOLD,
  MIN_ELIGIBLE_FOR_CONSISTENCY_RULE,
  CATEGORY_OUTPERFORM_MULTIPLIER,
  MIN_CONTENT_FOR_CATEGORY_RULE,
  COMPETITOR_OUTPERFORM_MULTIPLIER,
  MIN_COMPETITOR_ENGAGEMENT_FLOOR,
  qualifiesForConsistencyReview,
  qualifiesForCategoryRecommendation,
  qualifiesForOpportunityAction,
  qualifiesForCompetitorReview,
};