/**
 * Shared utility helpers.
 */

const { v4: uuidv4 } = require('uuid');

// ---------------------------------------------------------------------------
// Period helpers (for targets / ranking resets)
// ---------------------------------------------------------------------------

/** Returns "YYYY-MM" for the current month */
function currentMonthPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Returns "YYYY-WNN" for the current ISO week */
function currentWeekPeriod() {
  const d = new Date();
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const week = Math.ceil(((d - jan4) / 86400000 + jan4.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Invite code generator
// ---------------------------------------------------------------------------

/** Generates a short uppercase alphanumeric invite code */
function generateInviteCode() {
  return uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

function parsePagination(query) {
  const page  = Math.max(1, parseInt(query.page  ?? 1,  10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? 20, 10)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

module.exports = { currentMonthPeriod, currentWeekPeriod, generateInviteCode, parsePagination };
