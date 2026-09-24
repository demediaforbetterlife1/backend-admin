/**
 * Authentication Routes
 *
 * Complete rebuild with:
 * - Standardized API responses (successResponse/errorResponse)
 * - Comprehensive input validation before processing
 * - Proper HTTP status codes
 * - No raw error exposure to UI
 * - Consistent error handling
 */

const express = require('express');
const authService = require('../services/authService');
const { authenticate, requireRole, requireAgencyApproved } = require('../middleware/authMiddleware');
const { authLimiter, otpLimiter, loginLimiter } = require('../middleware/rateLimit');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');
const { validateRegisterRequest, validateRole } = require('../utils/validation');
const { logAudit } = require('../utils/auditLogger');

const router = express.Router();
const agentService = require('../services/agent.service');

router.use(authLimiter);

// ---------------------------------------------------------------------------
// POST /api/auth/register/user  — public self-registration
// ---------------------------------------------------------------------------
router.post('/register/user', asyncHandler(async (req, res) => {
  const db = req.app.locals.db;
  const { username, email, phone, password, agentCode } = req.body;

  // Validate all inputs BEFORE processing
  const validated = validateRegisterRequest(req.body, false);
  const profile = authService.parseProfilePayload(req.body);

  // Check for prohibited content
  const moderationService = require('../services/moderation.service');
  const nameCheck = await moderationService.filterMessage(validated.username || '');
  if (nameCheck.blocked) {
    return sendError(res, 'Username contains prohibited content', 400, 'CONTENT_BLOCKED');
  }

  // Register user
  try {
    const base = await authService.registerUser(db, {
      username: nameCheck.filtered || validated.username,
      email: validated.email,
      phone: validated.phone,
      password: validated.password,
      profile,
    });
    // Generate tokens
    const tokens = await authService.issueTokenPair(base.userId, base.username, base.role);

    await logAudit({
      action: 'REGISTER',
      userId: base.userId,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
      userAgent: req.headers['user-agent'] || null,
      metadata: { email: validated.email, phone: validated.phone },
    });

    // Return base info only, do NOT complete registration yet
    sendSuccess(res, { 
        userId: base.userId,
        username: base.username,
        role: base.role,
        email: validated.email,
        phone: validated.phone,
        avatar: profile.avatar || null,
        profileCompleted: false,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
    }, 201, 'Account created, please complete profile');
  } catch (error) {
    console.error('Registration failed:', error);
    throw error;
  }
}));

// ---------------------------------------------------------------------------
// POST /api/auth/complete-profile
// ---------------------------------------------------------------------------
router.post('/complete-profile', authenticate, asyncHandler(async (req, res) => {
  const db = req.app.locals.db;
  const { validateProfileRequest } = require('../utils/validation');
  const profile = validateProfileRequest(req.body);

  const result = await authService.completeProfile(db, req.user.id, profile);

  sendSuccess(res, result, 200, 'Profile completed successfully');
}));

// ---------------------------------------------------------------------------
// POST /api/auth/register/agent  — public self-registration for agents
// ---------------------------------------------------------------------------
router.post('/register/agent', asyncHandler(async (req, res) => {
  const db = req.app.locals.db;
  const validated = validateRegisterRequest(req.body, true);
  const profile = authService.parseProfilePayload(req.body);

  const moderationService = require('../services/moderation.service');
  const nameCheck = await moderationService.filterMessage(validated.username);
  if (nameCheck.blocked) {
    return sendError(res, 'Username contains prohibited content', 400, 'CONTENT_BLOCKED');
  }

  const base = await authService.registerAgent(db, {
    username: nameCheck.filtered || validated.username,
    email: validated.email,
    phone: validated.phone,
    password: validated.password,
    profile,
  });

  const result = await authService.completeRegistration(db, {
    ...base,
    email: validated.email,
    phone: validated.phone,
  });

  try {
    await agentService.createAgentProfile(result.userId);
  } catch (profileErr) {
    console.warn('Agent profile creation failed:', profileErr.message);
  }

  sendSuccess(res, result, 201, 'Agent account created successfully');
}));

router.post('/register/agency', asyncHandler(async (req, res) => {
  console.log('[AGENCY_REGISTER] ═══════════════════════════════════════');
  console.log('[AGENCY_REGISTER] stage=RECEIVE_REQUEST');
  console.log('[AGENCY_REGISTER] body keys:', Object.keys(req.body));
  
  const db = req.app.locals.db;
  
  console.log('[AGENCY_REGISTER] stage=VALIDATION');
  const validated = validateRegisterRequest(req.body, false);
  console.log('[AGENCY_REGISTER] validated username:', validated.username);
  console.log('[AGENCY_REGISTER] validated email:', validated.email);
  console.log('[AGENCY_REGISTER] validated phone:', validated.phone);
  
  const profile = authService.parseProfilePayload(req.body);
  console.log('[AGENCY_REGISTER] profile keys:', Object.keys(profile));

  console.log('[AGENCY_REGISTER] stage=MODERATION_CHECK');
  const moderationService = require('../services/moderation.service');
  const nameCheck = await moderationService.filterMessage(validated.username);
  if (nameCheck.blocked) {
    console.log('[AGENCY_REGISTER] stage=BLOCKED_USERNAME');
    return sendError(res, 'Username contains prohibited content', 400, 'CONTENT_BLOCKED');
  }

  console.log('[AGENCY_REGISTER] stage=REGISTER_AGENCY_CALL');
  const base = await authService.registerAgency(db, {
    username: nameCheck.filtered || validated.username,
    email: validated.email,
    phone: validated.phone,
    password: validated.password,
    profile,
  });
  console.log('[AGENCY_REGISTER] registerAgency returned userId:', base.userId);

  console.log('[AGENCY_REGISTER] stage=AUDIT_LOG');
  await logAudit({
    action: 'AGENCY_REGISTER',
    userId: base.userId,
    ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
    metadata: { email: validated.email, phone: validated.phone },
  });

  console.log('[AGENCY_REGISTER] stage=COMPLETE_REGISTRATION');
  const result = await authService.completeRegistration(db, {
    ...base,
    email: validated.email,
    phone: validated.phone,
  });
  
  console.log('[AGENCY_REGISTER] stage=SUCCESS');
  console.log('[AGENCY_REGISTER] result userId:', result.userId);
  console.log('[AGENCY_REGISTER] result accountType:', result.accountType);
  console.log('[AGENCY_REGISTER] result status:', result.status);
  console.log('[AGENCY_REGISTER] ═══════════════════════════════════════');

  sendSuccess(res, result, 201, 'Agency account registered, pending approval');
}));

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const db = req.app.locals.db;
  const { validateLoginRequest } = require('../utils/validation');
  const validated = validateLoginRequest(req.body);

  const result = await authService.loginUser(db, validated);

  await logAudit({
    action: 'LOGIN',
    userId: result.userId,
    ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
    metadata: { email: validated.email, phone: validated.phone },
  });

  sendSuccess(res, result, 200, 'Login successful');
}));

// ---------------------------------------------------------------------------
// POST /api/auth/send-otp
// Accepts optional `role` to associate the OTP with the selected account type
// ---------------------------------------------------------------------------
router.post('/send-otp', otpLimiter, asyncHandler(async (req, res) => {
  const { validateSendOtpRequest } = require('../utils/validation');
  const validated = validateSendOtpRequest(req.body);

  const result = await authService.sendOtp(validated.phone, validated.role);
  sendSuccess(res, result, 200, 'Verification code sent to your phone');
}));

// ---------------------------------------------------------------------------
// POST /api/auth/verify-otp
// Accepts optional `role` to complete the correct account flow
// ---------------------------------------------------------------------------
router.post('/verify-otp', loginLimiter, asyncHandler(async (req, res) => {
  const db = req.app.locals.db;
  const { validateVerifyOtpRequest } = require('../utils/validation');
  const validated = validateVerifyOtpRequest(req.body);

  const result = await authService.verifyOtp(db, {
    phoneNumber: validated.phone,
    code: validated.code,
    role: validated.role,
  });

  sendSuccess(res, result, 200, 'Verification successful, logged in');
}));

// ---------------------------------------------------------------------------
// POST /api/auth/social-login
// ---------------------------------------------------------------------------
router.post('/social-login', loginLimiter, asyncHandler(async (req, res) => {
  const db = req.app.locals.db;
  const { validateSocialLoginRequest } = require('../utils/validation');
  const validated = validateSocialLoginRequest(req.body);

  const result = await authService.socialLogin(db, {
    provider: validated.provider,
    providerId: validated.providerId,
    email: validated.email,
    username: validated.username,
    avatar: validated.avatar,
    idToken: validated.idToken,
  });

  sendSuccess(res, result, 200, 'Social login successful');
}));

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------
router.post('/refresh', asyncHandler(async (req, res) => {
  const db = req.app.locals.db;
  const { validateRefreshRequest } = require('../utils/validation');
  const validated = validateRefreshRequest(req.body);

  try {
    const result = await authService.refreshTokens(db, validated.refreshToken);
    sendSuccess(res, result, 200, 'Token refreshed');
  } catch (err) {
    // Auth-specific errors (expired, revoked, banned, not found) must return
    // 401 — not 500.  A 500 from this endpoint causes the Flutter TokenManager
    // to keep retrying until it exhausts all attempts and logs the user out.
    const authCodes = new Set(['AUTH_FAILED', 'NOT_FOUND', 'USER_BANNED', 'INVALID_TOKEN']);
    const errCode = err.errorCode || err.code;
    if (errCode && authCodes.has(errCode)) {
      return sendError(res, err.message || 'Unauthorized', 401, errCode);
    }
    // Any other unexpected error: re-throw so the global handler logs it
    throw err;
  }
}));

// ---------------------------------------------------------------------------
// POST /api/auth/logout — revoke refresh token (no JWT required)
// ---------------------------------------------------------------------------
router.post('/logout', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    try {
      const token = await authService.getRefreshTokenInfo(refreshToken); // we need to add this to authService.js
      await authService.logout(refreshToken);
      if (token?.userId) {
        await logAudit({
          action: 'LOGOUT',
          userId: token.userId,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
          userAgent: req.headers['user-agent'] || null,
        });
      }
    } catch (err) {
      console.warn('Logout session cleanup failed:', err.message);
    }
  }

  sendSuccess(res, { message: 'Logged out' }, 200, 'Logged out successfully');
}));

// ---------------------------------------------------------------------------
// POST /api/auth/logout-all
// Logout from ALL devices by revoking all refresh tokens
// ---------------------------------------------------------------------------
router.post('/logout-all', authenticate, asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user.id);
  sendSuccess(res, { message: 'Logged out from all devices' }, 200, 'Logged out from all devices');
}));

// ---------------------------------------------------------------------------
// GET /api/auth/me
// Fetch current user data and verify account status
// Protected route - requires valid JWT
// ---------------------------------------------------------------------------
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await authService.getCurrentUser(req.user.id);
  sendSuccess(res, user, 200, 'Current user data');
}));

// ---------------------------------------------------------------------------
// GET /api/auth/status/:userId
// Check if account exists and is active (no auth required, used during splash)
// Safe to call without bearer token
// ---------------------------------------------------------------------------
router.get('/status/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return sendError(res, 'User ID is required', 400, 'INVALID_REQUEST');
  }

  const status = await authService.checkAccountStatus(userId);
  sendSuccess(res, status, 200, 'Account status retrieved');
}));

// Admin routes for agency management
router.get('/admin/agencies/pending', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const pendingAgencies = await authService.getPendingAgencies();
  sendSuccess(res, pendingAgencies);
}));

router.post('/admin/agencies/:agencyUserId/approve', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const { agencyUserId } = req.params;
  const adminUserId = req.user.id;

  await authService.approveAgency(agencyUserId, adminUserId);
  await logAudit({
    action: 'AGENCY_APPROVED',
    userId: adminUserId,
    metadata: { agencyUserId },
  });
  sendSuccess(res, null, 200, 'Agency approved successfully');
}));

router.post('/admin/agencies/:agencyUserId/reject', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const { agencyUserId } = req.params;
  const adminUserId = req.user.id;

  await authService.rejectAgency(agencyUserId);
  await logAudit({
    action: 'AGENCY_REJECTED',
    userId: adminUserId,
    metadata: { agencyUserId },
  });
  sendSuccess(res, null, 200, 'Agency rejected');
}));

router.post('/admin/agencies/:agencyUserId/suspend', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const { agencyUserId } = req.params;
  const adminUserId = req.user.id;

  await authService.suspendAgency(agencyUserId);
  await logAudit({
    action: 'AGENCY_SUSPENDED',
    userId: adminUserId,
    metadata: { agencyUserId },
  });
  sendSuccess(res, null, 200, 'Agency suspended');
}));

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password
// ---------------------------------------------------------------------------
router.post('/forgot-password', otpLimiter, asyncHandler(async (req, res) => {
  const db = req.app.locals.db;
  const result = await authService.requestPasswordReset(db, req.body);
  sendSuccess(res, result, 200, 'If the email exists, a reset link was sent');
}));

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password
// ---------------------------------------------------------------------------
router.post('/reset-password', loginLimiter, asyncHandler(async (req, res) => {
  const db = req.app.locals.db;
  const result = await authService.resetPassword(db, req.body);
  sendSuccess(res, result, 200, 'Password reset successfully');
}));

// ---------------------------------------------------------------------------
// GET /api/auth/agency-status — check agency request status
// ---------------------------------------------------------------------------
router.get('/agency-status', authenticate, asyncHandler(async (req, res) => {
  const status = await authService.getAgencyRequestStatus(req.user.id);
  sendSuccess(res, status, 200, 'Agency status retrieved');
}));

module.exports = router;
