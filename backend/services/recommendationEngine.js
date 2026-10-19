// backend/services/recommendationEngine.js
//
// Pure, side-effect-free RULE logic for recommendation generation
// (Project B, Objective 4). Nothing here talks to the database — the
// caller (server.js: generateRecommendations()) gathers the creator's own,
// already-collected data and passes plain values in here. Keeping the
// thresholds and mappings isolated like this is what makes them
// unit-testable and explainable in a defence: every input/output pair can
// be checked by hand.
//
// Each rule follows: DATA -> ANALYSIS (done by the caller) -> RULE (this
// file) -> RECOMMENDATION (built by the caller). Nothing in this file
// generates a prediction of views, engagement or growth.
//
// Competitor-based rules were removed from this module: server.js never
// called them, and the final design does not use competitor data.

// ---- Recommendation types ---------------------------------------------------
// Types the engine creates today.
const RECOMMENDATION_TYPES = {
  REVIEW_MISSED_CONTENT: "ReviewMissedContent", // Rule A
  PRODUCE_MORE_IN_CATEGORY: "ProduceMoreInCategory", // Rule B
  COVER_TOPIC_AGAIN: "CoverTopicAgain", // from ContentGap
  SCHEDULE_POST: "SchedulePost", // from PostingOpportunity
  PLAN_EVENT_CONTENT: "PlanEventContent", // from EventOpportunity
  EXPLORE_RECENT_TOPIC: "ExploreRecentTopic", // from RecentTopic
};

// Opportunity type -> recommendation type. HighPerformingTopic is
// deliberately absent: it describes the same signal as Rule B, so Rule B
// produces that one recommendation and links to the opportunity.
const OPPORTUNITY_TO_RECOMMENDATION_TYPE = {
  ContentGap: RECOMMENDATION_TYPES.COVER_TOPIC_AGAIN,
  PostingOpportunity: RECOMMENDATION_TYPES.SCHEDULE_POST,
  EventOpportunity: RECOMMENDATION_TYPES.PLAN_EVENT_CONTENT,
  RecentTopic: RECOMMENDATION_TYPES.EXPLORE_RECENT_TOPIC,
};

// Display order (lower number = shown first). Time-bound items first.
// Unknown/legacy types (e.g. old ActOnOpportunity rows) sort last.
const DISPLAY_ORDER = [
  RECOMMENDATION_TYPES.PLAN_EVENT_CONTENT,
  RECOMMENDATION_TYPES.REVIEW_MISSED_CONTENT,
  RECOMMENDATION_TYPES.SCHEDULE_POST,
  RECOMMENDATION_TYPES.PRODUCE_MORE_IN_CATEGORY,
  RECOMMENDATION_TYPES.COVER_TOPIC_AGAIN,
  RECOMMENDATION_TYPES.EXPLORE_RECENT_TOPIC,
];

function opportunityRecommendationType(opportunityType) {
  return OPPORTUNITY_TO_RECOMMENDATION_TYPE[opportunityType] || null;
}

// Returns an SQL expression (no trailing comma) usable inside ORDER BY.
// `columnName` is only ever a column identifier chosen by our own code,
// but it is validated anyway because it is interpolated into SQL text.
function displayOrderSql(columnName = "recommendation_type") {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(String(columnName))) {
    throw new Error(`displayOrderSql: invalid column name "${columnName}"`);
  }
  const whens = DISPLAY_ORDER
    .map((type, index) => `WHEN '${type}' THEN ${index + 1}`)
    .join(" ");
  return `CASE ${columnName} ${whens} ELSE ${DISPLAY_ORDER.length + 1} END`;
}

// ---- Rule A: posting consistency is low ------------------------------------
// Fires when consistency % (published / (published+missed) * 100, the same
// formula /analytics/consistency uses) drops below this threshold.
// Requires a minimum sample so one early miss doesn't trigger it.
const CONSISTENCY_LOW_THRESHOLD = 70;
const MIN_ELIGIBLE_FOR_CONSISTENCY_RULE = 3;

function qualifiesForConsistencyReview(consistencyPercentage, eligibleContent) {
  if (consistencyPercentage === null || consistencyPercentage === undefined) return false;
  if ((eligibleContent || 0) < MIN_ELIGIBLE_FOR_CONSISTENCY_RULE) return false;
  return consistencyPercentage < CONSISTENCY_LOW_THRESHOLD;
}

// ---- Rule B: a content category outperforms the creator's own average -----
// Fires when a category's average engagement rate is at least this
// multiple of the creator's overall average, with a minimum number of
// tracked records so a single post doesn't count as a "pattern".
const CATEGORY_OUTPERFORM_MULTIPLIER = 1.5;
const MIN_CONTENT_FOR_CATEGORY_RULE = 2;

function qualifiesForCategoryRecommendation(categoryAvgEngagement, categoryContentCount, overallAvgEngagement) {
  if ((categoryContentCount || 0) < MIN_CONTENT_FOR_CATEGORY_RULE) return false;
  if (!overallAvgEngagement || overallAvgEngagement <= 0) return false;
  return categoryAvgEngagement >= overallAvgEngagement * CATEGORY_OUTPERFORM_MULTIPLIER;
}

// ---- Rules C-F: an Active opportunity is still worth recommending ---------
// Fires for an Active opportunity whose type maps to a recommendation type
// and whose deadline (if it has one) has not passed. Uses no score and no
// impact level — opportunities are detected from the creator's own data,
// not ranked by a numerical model.
function parseDbDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function qualifiesForOpportunityRecommendation(opportunity, now = new Date()) {
  if (!opportunity) return false;
  if (opportunity.status !== "Active") return false;
  if (!opportunityRecommendationType(opportunity.opportunity_type)) return false;
  const deadline = parseDbDate(opportunity.opportunity_deadline);
  if (deadline && deadline.getTime() < now.getTime()) return false;
  return true;
}

// The topic / weekday / event name an opportunity is about. Opportunity
// titles are built as "<Label>: <subject>" (e.g. "Content gap: Prayer"),
// so the subject is everything after the first ": ".
function opportunitySubject(opportunity) {
  const title = String((opportunity && opportunity.title) || "").trim();
  const separator = title.indexOf(": ");
  const subject = separator >= 0 ? title.slice(separator + 2).trim() : title;
  return subject || "this topic";
}

// ---- Resurfacing --------------------------------------------------------------
// A recommendation the creator Dismissed/Actioned stays closed for this
// long, after which it may be shown again if the signal is still true.
const RESURFACE_AFTER_DAYS = 30;

function shouldResurface(closedAt, now = new Date()) {
  const date = parseDbDate(closedAt);
  if (!date) return false; // unknown date: respect the creator's decision
  return now.getTime() - date.getTime() >= RESURFACE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

module.exports = {
  RECOMMENDATION_TYPES,
  RESURFACE_AFTER_DAYS,
  CONSISTENCY_LOW_THRESHOLD,
  MIN_ELIGIBLE_FOR_CONSISTENCY_RULE,
  CATEGORY_OUTPERFORM_MULTIPLIER,
  MIN_CONTENT_FOR_CATEGORY_RULE,
  displayOrderSql,
  opportunityRecommendationType,
  opportunitySubject,
  qualifiesForConsistencyReview,
  qualifiesForCategoryRecommendation,
  qualifiesForOpportunityRecommendation,
  shouldResurface,
};