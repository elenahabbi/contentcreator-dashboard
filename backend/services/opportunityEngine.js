// backend/services/opportunityEngine.js
//
// Rule helpers for the creator-data-based opportunity system.
// Database access stays in server.js so the rules remain easy to understand
// and test for a final-year project.

const OPPORTUNITY_TYPES = [
  "ContentGap",
  "RecentTopic",
  "PostingOpportunity",
  "EventOpportunity",
  "HighPerformingTopic",
];

function isValidOpportunityType(type) {
  return OPPORTUNITY_TYPES.includes(type);
}

function hasRecentContent(latestDate, days = 30, now = new Date()) {
  if (!latestDate) return false;
  const date = new Date(latestDate);
  if (Number.isNaN(date.getTime())) return false;
  return now.getTime() - date.getTime() < days * 24 * 60 * 60 * 1000;
}

function qualifiesAsHighPerformingTopic(
  categoryAverage,
  overallAverage,
  categoryRecordCount,
  { multiplier = 1.5, minimumRecords = 2 } = {}
) {
  if ((categoryRecordCount || 0) < minimumRecords) return false;
  if (!overallAverage || overallAverage <= 0) return false;
  return Number(categoryAverage || 0) >= Number(overallAverage) * multiplier;
}

module.exports = {
  OPPORTUNITY_TYPES,
  isValidOpportunityType,
  hasRecentContent,
  qualifiesAsHighPerformingTopic,
};
