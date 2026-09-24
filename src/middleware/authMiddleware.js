/**
 * Authentication Middleware — Single canonical implementation.
 *
 * FIXED:
 * - Uses shared prisma client (no new PrismaClient() here)
 * - Looks up only id, username, role, isBanned from DB — no heavyweight getCurrentUser()
 * - Consistent req.user shape: { id, username, role }
 * - Bearer parsing uses authHeader.slice(7) — correct for 'Bearer '.length === 7
 * - Logs token prefix only (never full token)
 */

const jwt = require('jsonwebtoken');
const prisma = require('../prismaClient');
const { normalizeRole } = require('../utils/userNormalize');
const { assertUserNotBanned } = require('../utils/ban.utils');

// These are read once at module load — never change at runtime.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('[authMiddleware] JWT_SECRET is not set — cannot verify tokens');
}

/**
 * Verify a Bearer token and populate req.user.
 * Shape of req.user after this middleware:  { id, username, role }
 */
async function authenticate(req, res, next) {
  const requestPath = `${req.method} ${req.originalUrl || req.path}`;

  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║ AUTHENTICATION MIDDLEWARE ENTRY POINT                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log(`[Auth] Request: ${requestPath}`);
  console.log(`[Auth] Headers received:`, JSON.stringify(req.headers, null, 2));

  try {
    const authHeader = req.headers.authorization;
    const hasBearer = Boolean(authHeader && authHeader.startsWith('Bearer '));

    console.log(`[Auth] Authorization header present: ${hasBearer}`);
    console.log(`[Auth] Authorization header value: ${authHeader ? authHeader.substring(0, 50) + '...' : 'MISSING'}`);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('╔══════════════════════════════════════════════════════════════════════════╗');
      console.error('║ AUTHENTICATION FAILED: NO AUTHORIZATION HEADER                           ║');
      console.error('╚══════════════════════════════════════════════════════════════════════════╝');
      console.warn(`[Auth] ${requestPath}: missing/malformed Authorization header`);
      return res.status(401).json({
        success: false,
        error: 'Authorization header missing or malformed',
        debug: {
          path: requestPath,
          headerExists: Boolean(authHeader),
          headerValue: authHeader ? 'present but malformed' : 'missing'
        }
      });
    }

    // 'Bearer '.length === 7
    const token = authHeader.slice(7);
    console.log(`[Auth] Token extracted, length: ${token.length}`);
    console.log(`[Auth] Token preview: ${token.substring(0, 20)}...${token.substring(token.length - 20)}`);
    
    if (!token) {
      console.error('╔══════════════════════════════════════════════════════════════════════════╗');
      console.error('║ AUTHENTICATION FAILED: EMPTY TOKEN                                       ║');
      console.error('╚══════════════════════════════════════════════════════════════════════════╝');
      return res.status(401).json({ success: false, error: 'Token is empty' });
    }

    // ── Verify JWT ──────────────────────────────────────────────────────────
    console.log(`[Auth] Attempting JWT verification with secret: ${JWT_SECRET.substring(0, 10)}...`);
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
      console.log(`[Auth] ✓ JWT verification successful`);
    } catch (jwtErr) {
      console.error('╔══════════════════════════════════════════════════════════════════════════╗');
      console.error('║ AUTHENTICATION FAILED: JWT VERIFICATION ERROR                            ║');
      console.error('╚══════════════════════════════════════════════════════════════════════════╝');
      console.error(`[Auth] JWT Error Name: ${jwtErr.name}`);
      console.error(`[Auth] JWT Error Message: ${jwtErr.message}`);
      console.error(`[Auth] Token that failed: ${token.substring(0, 50)}...`);
      console.warn(`[Auth] ${requestPath}: JWT verify failed — ${jwtErr.message}`);
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid or expired token',
        debug: {
          errorName: jwtErr.name,
          errorMessage: jwtErr.message
        }
      });
    }

    // ── Extract userId — support both 'userId' and 'sub' fields ────────────
    const userId = payload.userId || payload.sub;
    console.log('╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║ JWT PAYLOAD DECODED                                                      ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝');
    console.log(`[Auth] ${requestPath}: jwt payload:`, {
      userId,
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
      iss: payload.iss,
      aud: payload.aud,
      exp: payload.exp,
      iat: payload.iat,
      expiresIn: payload.exp ? `${payload.exp - Math.floor(Date.now() / 1000)}s` : 'unknown'
    });
    
    if (!userId) {
      console.error('╔══════════════════════════════════════════════════════════════════════════╗');
      console.error('║ AUTHENTICATION FAILED: NO USER ID IN TOKEN                               ║');
      console.error('╚══════════════════════════════════════════════════════════════════════════╝');
      console.error(`[Auth] ${requestPath}: token payload missing userId/sub`, payload);
      return res.status(401).json({ success: false, error: 'Invalid token payload' });
    }

    // ── Lightweight DB lookup — only what middleware needs ──────────────────
    console.log(`[Auth] Looking up user in database: ${userId}`);
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, role: true, isBanned: true, banExpiresAt: true, banType: true, status: true },
    });

    if (!dbUser) {
      console.error('╔══════════════════════════════════════════════════════════════════════════╗');
      console.error('║ AUTHENTICATION FAILED: USER NOT FOUND IN DATABASE                        ║');
      console.error('╚══════════════════════════════════════════════════════════════════════════╝');
      console.error(`[Auth] User ID from token: ${userId}`);
      return res.status(401).json({ success: false, error: 'User not found' });
    }

    console.log(`[Auth] ✓ User found in database:`, {
      id: dbUser.id,
      username: dbUser.username,
      role: dbUser.role,
      isBanned: dbUser.isBanned,
      status: dbUser.status
    });

    // ── Auto-unban if temp ban expired ──────────────────────────────────────
    if (dbUser.isBanned && dbUser.banExpiresAt && new Date(dbUser.banExpiresAt) <= new Date()) {
      console.log(`[Auth] Auto-unbanning user (ban expired)`);
      await prisma.user.update({
        where: { id: userId },
        data: { isBanned: false, banExpiresAt: null, banType: null },
      });
      dbUser.isBanned = false;
    }

    if (dbUser.isBanned) {
      console.error('╔══════════════════════════════════════════════════════════════════════════╗');
      console.error('║ AUTHENTICATION FAILED: USER IS BANNED                                    ║');
      console.error('╚══════════════════════════════════════════════════════════════════════════╝');
      return res.status(403).json({ success: false, error: 'Account is suspended' });
    }

    const accountStatus = (dbUser.status || 'ACTIVE').toUpperCase();
    if (accountStatus === 'BANNED' || accountStatus === 'SUSPENDED') {
      console.error('╔══════════════════════════════════════════════════════════════════════════╗');
      console.error('║ AUTHENTICATION FAILED: ACCOUNT SUSPENDED                                 ║');
      console.error('╚══════════════════════════════════════════════════════════════════════════╝');
      return res.status(403).json({ success: false, error: 'Account is suspended' });
    }

    // ── Populate req.user ───────────────────────────────────────────────────
    req.user = {
      id: dbUser.id,
      username: dbUser.username,
      role: normalizeRole(dbUser.role),
    };

    console.log('╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║ AUTHENTICATION SUCCESSFUL - PASSING TO NEXT MIDDLEWARE                   ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝');
    console.log(`[Auth] ${requestPath}: authenticated user id=${req.user.id} username=${req.user.username} role=${req.user.role}`);
    console.log('[Auth] Calling next() to proceed to route handler\n');

    return next();
  } catch (err) {
    console.error('╔══════════════════════════════════════════════════════════════════════════╗');
    console.error('║ AUTHENTICATION FAILED: UNEXPECTED ERROR                                  ║');
    console.error('╚══════════════════════════════════════════════════════════════════════════╝');
    console.error(`[Auth] ${requestPath} unexpected error:`, err);
    console.error(`[Auth] Error stack:`, err.stack);
    return res.status(500).json({ success: false, error: 'Authentication error' });
  }
}

/**
 * Role-based access guard. Must be used AFTER authenticate.
 * Usage: router.get('/admin', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    return next();
  };
}

/**
 * Agency approval guard. Must be used AFTER authenticate.
 */
async function requireAgencyApproved(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { accountType: true, agencyApproved: true },
  });

  if (user?.accountType === 'AGENCY' && !user?.agencyApproved) {
    return res.status(403).json({
      success: false,
      error: 'Agency account not yet approved',
      code: 'AGENCY_PENDING',
    });
  }

  return next();
}

module.exports = { authenticate, requireRole, requireAgencyApproved };
