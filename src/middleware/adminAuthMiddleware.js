/**
 * Admin Authentication Middleware
 *
 * Validates admin access tokens (type: 'admin_access') and populates
 * req.admin with { id, email, name, role }.
 *
 * Use requireAdminRole(...roles) after authenticateAdmin to enforce RBAC.
 *
 * Role hierarchy (highest → lowest):
 *   SUPER_ADMIN (100) > ADMIN (75) > MODERATOR (50) > SUPPORT (25)
 */

'use strict';

const jwt    = require('jsonwebtoken');
const prisma = require('../prismaClient');

const JWT_SECRET = process.env.JWT_SECRET;

const ROLE_LEVEL = {
  SUPER_ADMIN: 100,
  ADMIN:       75,
  MODERATOR:   50,
  SUPPORT:     25,
};

/**
 * Verify admin Bearer token and populate req.admin.
 */
async function authenticateAdmin(req, res, next) {
  const requestInfo = {
    method: req.method,
    path: req.path,
    hasAuthHeader: !!req.headers.authorization,
    authHeaderFormat: req.headers.authorization ? req.headers.authorization.substring(0, 20) + '...' : 'NONE'
  };
  console.log('🔐 [adminAuthMiddleware.js] authenticateAdmin() called:', JSON.stringify(requestInfo));
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ [adminAuthMiddleware.js] Authorization header missing or malformed');
    return res.status(401).json({ success: false, error: 'Authorization header missing or malformed' });
  }

  const token = authHeader.slice(7);
  if (!token) {
    console.log('❌ [adminAuthMiddleware.js] Token is empty');
    return res.status(401).json({ success: false, error: 'Token is empty' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    console.log('❌ [adminAuthMiddleware.js] JWT verification failed:', err.message);
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }

  if (payload.type !== 'admin_access') {
    console.log('❌ [adminAuthMiddleware.js] Wrong token type:', payload.type);
    return res.status(401).json({ success: false, error: 'Not an admin token' });
  }

  const adminId = payload.sub || payload.id;
  if (!adminId) {
    console.log('❌ [adminAuthMiddleware.js] No admin ID in token payload');
    return res.status(401).json({ success: false, error: 'Invalid token payload' });
  }

  // Lightweight DB lookup — only what we need
  const admin = await prisma.adminAccount.findFirst({
    where:  { id: adminId, deletedAt: null, isActive: true },
    select: { id: true, email: true, name: true, role: true },
  }).catch((err) => {
    console.log('❌ [adminAuthMiddleware.js] Database lookup failed:', err.message);
    return null;
  });

  if (!admin) {
    console.log('❌ [adminAuthMiddleware.js] Admin account not found or inactive for ID:', adminId);
    return res.status(401).json({ success: false, error: 'Admin account not found or inactive' });
  }

  console.log('✅ [adminAuthMiddleware.js] Admin authenticated:', { id: admin.id, email: admin.email, role: admin.role });
  req.admin = admin;
  return next();
}

/**
 * Role guard — must be used AFTER authenticateAdmin.
 * Pass the minimum required role (or an array of allowed roles).
 *
 * Usage:
 *   router.delete('/admins/:id', authenticateAdmin, requireAdminRole('SUPER_ADMIN'), handler)
 *   router.get('/reports',       authenticateAdmin, requireAdminRole('SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'), handler)
 */
function requireAdminRole(...roles) {
  const minLevel = Math.min(...roles.map(r => ROLE_LEVEL[r] ?? 999));
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const level = ROLE_LEVEL[req.admin.role] ?? 0;
    if (level < minLevel) {
      return res.status(403).json({ success: false, error: `Requires one of: ${roles.join(', ')}. Your role: ${req.admin.role}` });
    }
    return next();
  };
}

/**
 * Convenience guard — minimum ADMIN level.
 */
const requireAdmin       = requireAdminRole('ADMIN', 'SUPER_ADMIN');

/**
 * Convenience guard — SUPER_ADMIN only.
 */
const requireSuperAdmin  = requireAdminRole('SUPER_ADMIN');

/**
 * Convenience guard — MODERATOR and above.
 */
const requireModerator   = requireAdminRole('MODERATOR', 'ADMIN', 'SUPER_ADMIN');

/**
 * Convenience guard — any authenticated admin (SUPPORT and above).
 */
const requireSupport     = requireAdminRole('SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN');

/**
 * Extract IP address from request.
 */
function getAdminIp(req) {
  return (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || null;
}

module.exports = {
  authenticateAdmin,
  requireAdminRole,
  requireAdmin,
  requireSuperAdmin,
  requireModerator,
  requireSupport,
  getAdminIp,
  ROLE_LEVEL,
};
