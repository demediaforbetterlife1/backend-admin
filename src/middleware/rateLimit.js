/**
 * Rate limiting middleware
 *
 * ADDED: financialLimiter — covers /coins/verify-receipt, /payment/verify-receipt,
 *        /vip/subscribe, /vip/subscribe-inapp, /wallet/withdraw.
 * ADDED: reportLimiter — covers /moderation/report (prevents report flooding).
 * ADDED: deviceTokenLimiter — covers /notifications/token (prevents table flooding).
 * ADDED: roomLimiter — covers room create/join/request-seat.
 */

const rateLimit = require('express-rate-limit');

// ── Auth endpoints ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'OTP rate limit exceeded' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts' },
});

// ── Financial mutation endpoints ──────────────────────────────────────────────
// Covers: /coins/verify-receipt, /payment/verify-receipt,
//         /vip/subscribe, /vip/subscribe-inapp, /wallet/withdraw
// Keyed per authenticated user ID to prevent bypass via IP rotation.
const financialLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour
  max: 10,                      // 10 financial operations per user per hour
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many financial requests — please wait before trying again' },
  // Skip if no user yet (authenticate middleware rejects unauthenticated reqs first)
  skip: (req) => !req.user,
});

// ── Moderation report endpoint ────────────────────────────────────────────────
// Prevents a single user from flooding reports against another user.
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour
  max: 10,                      // 10 reports per user per hour
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many reports — please wait before submitting more' },
  skip: (req) => !req.user,
});

// ── Device token registration endpoint ───────────────────────────────────────
// Prevents flooding the device_tokens table.
const deviceTokenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour
  max: 20,                      // 20 token registrations per user per hour
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many device token requests' },
  skip: (req) => !req.user,
});

// ── Room operation endpoints ──────────────────────────────────────────────────
// Covers: POST /rooms (create), POST /rooms/:id/join, POST /rooms/:id/request-seat
const roomLimiter = rateLimit({
  windowMs: 60 * 1000,         // 1 minute
  max: 10,                      // 10 room ops per user per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many room requests — please slow down' },
  skip: (req) => !req.user,
});

// ── Admin dashboard endpoints ─────────────────────────────────────────────────
// Strict login limiter for the admin panel — 10 attempts per 15 min per IP
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many admin login attempts — please try again in 15 minutes' },
});

// General admin API limiter — 300 requests per minute per admin
const adminApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => req.admin?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Admin API rate limit exceeded' },
  skip: (req) => !req.admin,
});

module.exports = {
  authLimiter,
  otpLimiter,
  loginLimiter,
  financialLimiter,
  reportLimiter,
  deviceTokenLimiter,
  roomLimiter,
  adminLoginLimiter,
  adminApiLimiter,
};
