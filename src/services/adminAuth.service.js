/**
 * Admin Authentication Service
 *
 * Handles login, token issuance, refresh, and logout for dashboard
 * AdminAccount records — completely separate from the Flutter User auth flow.
 *
 * Tokens use the same JWT_SECRET / JWT_REFRESH_SECRET as the user tokens
 * but carry role: 'ADMIN' | 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT' and
 * type: 'admin_access' / 'admin_refresh' so they cannot be confused with
 * user tokens.
 */

'use strict';

const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const prisma   = require('../prismaClient');

const JWT_SECRET         = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

const ACCESS_EXPIRES  = '15m';
const REFRESH_EXPIRES = '7d';
const REFRESH_MS      = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LEN = 8;

// ── Helpers ────────────────────────────────────────────────────────────────

function adminError(message, status = 401) {
  const err   = new Error(message);
  err.status  = status;
  err.isAdmin = true;
  throw err;
}

function generateAccessToken(admin) {
  return jwt.sign(
    {
      sub:   admin.id,
      id:    admin.id,
      email: admin.email,
      name:  admin.name,
      role:  admin.role,
      type:  'admin_access',
    },
    JWT_SECRET,
    { expiresIn: ACCESS_EXPIRES },
  );
}

function generateRefreshToken(adminId) {
  // jti (JWT ID) is a random unique identifier that prevents token collisions
  // when multiple login attempts occur within the same second.
  const jti = require('crypto').randomBytes(16).toString('hex');
  return jwt.sign(
    { sub: adminId, adminId, type: 'admin_refresh', jti },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES },
  );
}

async function storeRefreshToken(adminId, token) {
  await prisma.adminRefreshToken.create({
    data: { adminId, token, expiresAt: new Date(Date.now() + REFRESH_MS) },
  });
}

async function issueTokenPair(admin) {
  const accessToken  = generateAccessToken(admin);
  const refreshToken = generateRefreshToken(admin.id);
  await storeRefreshToken(admin.id, refreshToken);
  return { accessToken, refreshToken };
}

function safeAdmin(admin) {
  return {
    id:          admin.id,
    email:       admin.email,
    name:        admin.name,
    role:        admin.role,
    lastLoginAt: admin.lastLoginAt,
    createdAt:   admin.createdAt,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * POST /api/admin/auth/login
 */
async function login(email, password) {
  if (!email || !password) adminError('Email and password required', 400);

  const admin = await prisma.adminAccount.findFirst({
    where: { email: email.toLowerCase().trim(), deletedAt: null },
  });

  if (!admin || !admin.isActive) adminError('Invalid credentials', 401);

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) adminError('Invalid credentials', 401);

  // Stamp last login
  await prisma.adminAccount.update({
    where: { id: admin.id },
    data:  { lastLoginAt: new Date() },
  });

  const tokens = await issueTokenPair(admin);
  return { ...tokens, admin: safeAdmin(admin) };
}

/**
 * POST /api/admin/auth/refresh
 */
async function refresh(refreshToken) {
  if (!refreshToken) adminError('Refresh token required', 400);

  let payload;
  try {
    payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
  } catch {
    adminError('Invalid or expired refresh token', 401);
  }

  if (payload.type !== 'admin_refresh') adminError('Invalid token type', 401);

  const stored = await prisma.adminRefreshToken.findUnique({ where: { token: refreshToken } });
  if (!stored || stored.expiresAt <= new Date()) {
    await prisma.adminRefreshToken.deleteMany({ where: { token: refreshToken } });
    adminError('Refresh token revoked or expired', 401);
  }

  const admin = await prisma.adminAccount.findUnique({
    where: { id: stored.adminId },
  });
  if (!admin || !admin.isActive || admin.deletedAt) adminError('Account inactive', 401);

  // Token rotation — delete old, issue new pair
  await prisma.adminRefreshToken.delete({ where: { token: refreshToken } });
  const tokens = await issueTokenPair(admin);
  return { ...tokens, admin: safeAdmin(admin) };
}

/**
 * POST /api/admin/auth/logout
 */
async function logout(refreshToken) {
  if (refreshToken) {
    await prisma.adminRefreshToken.deleteMany({ where: { token: refreshToken } });
  }
  return { success: true };
}

/**
 * POST /api/admin/auth/logout-all  (revoke all sessions for an admin)
 */
async function logoutAll(adminId) {
  await prisma.adminRefreshToken.deleteMany({ where: { adminId } });
  return { success: true };
}

/**
 * Create the first SUPER_ADMIN account (seed — idempotent).
 * Called once from index.js on startup when ADMIN_SEED_EMAIL is set.
 */
async function seedSuperAdmin() {
  const email    = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;
  const name     = process.env.ADMIN_SEED_NAME || 'Super Admin';

  if (!email || !password) return;
  if (password.length < MIN_PASSWORD_LEN) {
    console.warn('[adminAuth] ADMIN_SEED_PASSWORD is too short — skipping seed');
    return;
  }

  const existing = await prisma.adminAccount.findFirst({ where: { email: email.toLowerCase() } });
  if (existing) {
    console.log('[adminAuth] Seed admin already exists — skipping');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminAccount.create({
    data: { email: email.toLowerCase(), passwordHash, name, role: 'SUPER_ADMIN' },
  });
  console.log(`[adminAuth] ✅ Seed SUPER_ADMIN created: ${email}`);
}

/**
 * List all admin accounts (SUPER_ADMIN only).
 */
async function listAdmins() {
  return prisma.adminAccount.findMany({
    where:   { deletedAt: null },
    select:  { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Create a new admin account.
 */
async function createAdmin({ email, name, password, role }) {
  if (!email || !name || !password) adminError('email, name, and password are required', 400);
  if (password.length < MIN_PASSWORD_LEN) adminError(`Password must be at least ${MIN_PASSWORD_LEN} chars`, 400);

  const exists = await prisma.adminAccount.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
  if (exists) adminError('Email already in use', 409);

  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.adminAccount.create({
    data: { email: email.toLowerCase(), passwordHash, name, role: role || 'ADMIN' },
  });
}

/**
 * Update admin account.
 */
async function updateAdmin(id, { name, role, isActive }) {
  const admin = await prisma.adminAccount.findFirst({ where: { id, deletedAt: null } });
  if (!admin) adminError('Admin not found', 404);

  return prisma.adminAccount.update({
    where: { id },
    data:  { ...(name !== undefined && { name }), ...(role !== undefined && { role }), ...(isActive !== undefined && { isActive }) },
  });
}

/**
 * Soft-delete admin account.
 */
async function deleteAdmin(id) {
  const admin = await prisma.adminAccount.findFirst({ where: { id, deletedAt: null } });
  if (!admin) adminError('Admin not found', 404);
  // Revoke all sessions first
  await prisma.adminRefreshToken.deleteMany({ where: { adminId: id } });
  return prisma.adminAccount.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
}

/**
 * Reset admin password.
 */
async function resetAdminPassword(id, newPassword) {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LEN) {
    adminError(`Password must be at least ${MIN_PASSWORD_LEN} chars`, 400);
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.adminRefreshToken.deleteMany({ where: { adminId: id } });
  return prisma.adminAccount.update({ where: { id }, data: { passwordHash } });
}

/**
 * Write an admin audit log entry.
 */
async function writeAuditLog(adminId, { action, resource, resourceId, ipAddress, userAgent, metadata } = {}) {
  try {
    await prisma.adminAuditLog.create({
      data: { adminId, action, resource: resource ?? null, resourceId: resourceId ?? null, ipAddress: ipAddress ?? null, userAgent: userAgent ?? null, metadata: metadata ?? null },
    });
  } catch (err) {
    console.warn('[adminAuth] audit log write failed:', err.message);
  }
}

module.exports = {
  login,
  refresh,
  logout,
  logoutAll,
  seedSuperAdmin,
  listAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  resetAdminPassword,
  writeAuditLog,
  safeAdmin,
};
