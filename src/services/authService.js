/**
 * Auth Service — registration, login, tokens, OTP, password reset
 *
 * FIX C-04: socialLogin() now verifies idToken server-side via provider APIs.
 * FIX H-07: sendOtp() now delivers via Twilio when TWILIO_* env vars are set.
 * FIX H-10: registerUser/registerAgent use async bcrypt.hash; min password 8 chars.
 * FIX L-05: JWT_SECRET fallback throws in all environments, not just production.
 * FIX M-06: socialLogin() creates SocialAccount record in Prisma on email match.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../prismaClient');
const { assertUserNotBanned } = require('../utils/ban.utils');
const { normalizeRole } = require('../utils/userNormalize');

function throwAuthError(message, errorCode) {
  const err = new Error(message);
  err.errorCode = errorCode;
  throw err;
}

// FIX L-05: throw immediately if default secrets are used in any environment
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET || JWT_SECRET.includes('change_me')) {
  throw new Error('JWT_SECRET must be set to a strong random value (not the default)');
}
if (!JWT_REFRESH_SECRET || JWT_REFRESH_SECRET.includes('change_me')) {
  throw new Error('JWT_REFRESH_SECRET must be set to a strong random value (not the default)');
}

const JWT_EXPIRES = '15m';
const JWT_REFRESH_EXPIRES = '7d';
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const RESET_EXPIRY_MS = 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

// SQLite uses snake_case column names — map rows to a consistent shape.
const SQLITE_USER_AUTH_COLS =
  'id, username, password_hash, role, status, is_banned, ban_expires_at, ban_type';

function mapSqliteUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    password_hash: row.password_hash,
    role: row.role,
    status: row.status,
    isBanned: Boolean(row.is_banned),
    banExpiresAt: row.ban_expires_at != null ? new Date(row.ban_expires_at) : null,
    banType: row.ban_type,
  };
}

function normalizeAccountStatus(status) {
  const s = String(status || 'active').toUpperCase();
  if (s === 'BANNED') return 'BANNED';
  if (s === 'SUSPENDED') return 'SUSPENDED';
  if (s === 'PENDING_APPROVAL') return 'PENDING_APPROVAL';
  if (s === 'REJECTED') return 'REJECTED';
  return 'ACTIVE';
}

function isAccountSuspended(user) {
  if (!user) return true;
  if (user.isBanned) return true;
  const status = normalizeAccountStatus(user.status);
  return status === 'BANNED' || status === 'SUSPENDED';
}

function clearExpiredSqliteBan(db, user) {
  if (user.isBanned && user.banExpiresAt && user.banExpiresAt <= new Date()) {
    db.prepare(
      'UPDATE users SET is_banned = 0, ban_expires_at = NULL, ban_type = NULL WHERE id = ?',
    ).run(user.id);
    user.isBanned = false;
    user.banExpiresAt = null;
    user.banType = null;
  }
}

function throwIfBanned(user) {
  if (user.isBanned) {
    const err = new Error('Account is suspended');
    err.code = 'USER_BANNED';
    err.banExpiresAt = user.banExpiresAt;
    throw err;
  }
  if (isAccountSuspended(user)) {
    const err = new Error('Account is suspended');
    err.code = 'USER_BANNED';
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function generateAccessToken(userId, username, role) {
  const payload = { 
    sub: userId, 
    userId, 
    username, 
    role: normalizeRole(role) 
  };
  console.log('Generating access token for:', payload);
  return jwt.sign(
    payload,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES },
  );
}

function generateRefreshToken(userId) {
  const payload = { userId, type: 'refresh' };
  console.log('Generating refresh token for:', payload);
  return jwt.sign(
    payload,
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES },
  );
}

function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    console.log('Verified access token payload:', payload);
    return payload;
  } catch (err) {
    console.error('JWT access token verification failed:', err.message);
    throwAuthError('Invalid or expired access token', 'AUTH_FAILED');
  }
}

function verifyRefreshToken(token) {
  try {
    const payload = jwt.verify(token, JWT_REFRESH_SECRET);
    if (payload.type !== 'refresh') {
      console.error('Invalid refresh token type:', payload.type);
      throwAuthError('Invalid token type', 'AUTH_FAILED');
    }
    console.log('Verified refresh token payload:', payload);
    return payload;
  } catch (err) {
    console.error('JWT refresh token verification failed:', err.message);
    throwAuthError('Invalid or expired refresh token', 'AUTH_FAILED');
  }
}

async function storeRefreshToken(userId, token) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId, token, expiresAt },
  });
}

async function revokeRefreshToken(token) {
  await prisma.refreshToken.deleteMany({ where: { token } });
}

async function revokeAllRefreshTokens(userId) {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}

async function getRefreshTokenInfo(token) {
  const stored = await prisma.refreshToken.findUnique({ where: { token } });
  if (!stored) return null;
  return { userId: stored.userId };
}

async function issueTokenPair(userId, username, role) {
  const accessToken = generateAccessToken(userId, username, role);
  const refreshToken = generateRefreshToken(userId);
  await storeRefreshToken(userId, refreshToken);
  return { accessToken, refreshToken };
}

// ---------------------------------------------------------------------------
// Prisma sync helper
// ---------------------------------------------------------------------------

async function syncPrismaUser(user) {
  const status = normalizeAccountStatus(user.status);
  const baseData = {
    username: user.username,
    email: user.email ?? null,
    phone: user.phone ?? null,
    role: normalizeRole(user.role),
    status,
    agentCode: user.agentCode ?? null,
    passwordHash: user.passwordHash ?? null,
  };

  const optionalFields = [
    'avatar',
    'displayName',
    'bio',
    'gender',
    'birthday',
    'countryCode',
    'interests',
    'agencyName',
    // ✅ REMOVED: 'teamSize' - only stored in AgencyRequest, not needed in User
    // ✅ REMOVED: 'offeredServices' - only stored in AgencyRequest, not needed in User
  ];

  for (const field of optionalFields) {
    if (user[field] !== undefined) {
      baseData[field] = field === 'birthday' && user[field]
        ? new Date(user[field])
        : user[field] || null;
    }
  }

  const existing = await prisma.user.findUnique({ where: { id: user.id } });

  if (existing) {
    await prisma.user.update({
      where: { id: user.id },
      data: baseData,
    });
    return;
  }

  await prisma.user.create({
    data: {
      id: user.id,
      avatar: user.avatar ?? null,
      displayName: user.displayName ?? null,
      bio: user.bio ?? null,
      gender: user.gender ?? null,
      birthday: user.birthday ? new Date(user.birthday) : null,
      countryCode: user.countryCode ?? null,
      interests: user.interests ?? null,
      agencyName: user.agencyName ?? null,
      teamSize: user.teamSize ?? null,
      offeredServices: user.offeredServices ?? null,
      ...baseData,
    },
  });
}

// ---------------------------------------------------------------------------
// Social login token verification
// FIX C-04: Verify idToken server-side against each provider's API.
// ---------------------------------------------------------------------------

async function verifyGoogleIdToken(idToken) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }
  try {
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    return {
      providerId: payload.sub,
      email: payload.email,
      username: payload.name,
      avatar: payload.picture,
    };
  } catch (err) {
    throw new Error(`Google token verification failed: ${err.message}`);
  }
}

async function verifyFacebookToken(accessToken) {
  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
    throw new Error('FACEBOOK_APP_ID and FACEBOOK_APP_SECRET are not configured');
  }
  try {
    const appToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;
    const debugUrl = `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${appToken}`;
    const debugRes = await fetch(debugUrl);
    const debugData = await debugRes.json();
    if (!debugData.data?.is_valid) {
      throw new Error('Invalid Facebook access token');
    }
    const userId = debugData.data.user_id;
    const profileRes = await fetch(`https://graph.facebook.com/${userId}?fields=id,name,email,picture&access_token=${accessToken}`);
    const profile = await profileRes.json();
    return {
      providerId: profile.id,
      email: profile.email || null,
      username: profile.name,
      avatar: profile.picture?.data?.url || null,
    };
  } catch (err) {
    throw new Error(`Facebook token verification failed: ${err.message}`);
  }
}

async function verifyAppleIdToken(idToken) {
  try {
    const appleSignin = require('apple-signin-auth');
    const payload = await appleSignin.verifyIdToken(idToken, {
      audience: process.env.APPLE_CLIENT_ID || process.env.APP_BUNDLE_ID,
      ignoreExpiration: false,
    });
    return {
      providerId: payload.sub,
      email: payload.email || null,
      username: null, // Apple doesn't provide name in token
      avatar: null,
    };
  } catch (err) {
    throw new Error(`Apple token verification failed: ${err.message}`);
  }
}

async function verifySocialToken(provider, idToken) {
  // In development without token verification libraries, allow stub if explicitly enabled
  if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_SOCIAL_STUB === 'true') {
    console.warn('[auth] Social token verification stubbed — ALLOW_SOCIAL_STUB=true');
    return null; // caller will use client-supplied values
  }

  if (provider === 'google') return verifyGoogleIdToken(idToken);
  if (provider === 'facebook') return verifyFacebookToken(idToken);
  if (provider === 'apple') return verifyAppleIdToken(idToken);
  throw new Error(`Unknown provider: ${provider}`);
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

function parseProfilePayload(body = {}) {
  const {
    displayName,
    bio,
    gender,
    birthday,
    countryCode,
    interests,
    avatar,
    agencyName,
    teamSize, // ✅ ADDED: needed for AgencyRequest
    offeredServices, // ✅ ADDED: needed for AgencyRequest
  } = body;

  return {
    displayName: displayName && typeof displayName === 'string'
      ? displayName.trim().slice(0, 100)
      : null,
    bio: bio && typeof bio === 'string' ? bio.trim().slice(0, 500) : null,
    gender: gender && typeof gender === 'string' ? gender.trim().slice(0, 20) : null,
    birthday: birthday && typeof birthday === 'string' ? birthday : null,
    countryCode: countryCode && typeof countryCode === 'string'
      ? countryCode.trim().slice(0, 10)
      : null,
    interests: Array.isArray(interests) ? interests.slice(0, 20) : null,
    avatar: avatar && typeof avatar === 'string' ? avatar.slice(0, 2048) : null,
    agencyName: agencyName && typeof agencyName === 'string'
      ? agencyName.trim().slice(0, 100)
      : null,
    // ✅ ADDED: Agency-specific fields (not stored in User table, but passed to AgencyRequest)
    teamSize: teamSize && typeof teamSize === 'string' ? teamSize.trim() : null,
    offeredServices: Array.isArray(offeredServices) ? offeredServices.slice(0, 50) : [],
  };
}

function applyProfileToSqlite(db, userId, profile) {
  db.prepare(`
    UPDATE users SET
      display_name = COALESCE(?, display_name),
      bio = COALESCE(?, bio),
      gender = COALESCE(?, gender),
      birthday = COALESCE(?, birthday),
      country_code = COALESCE(?, country_code),
      interests = COALESCE(?, interests),
      avatar = COALESCE(?, avatar),
      agency_name = COALESCE(?, agency_name),
      updated_at = unixepoch()
    WHERE id = ?
  `).run(
    profile.displayName,
    profile.bio,
    profile.gender,
    profile.birthday,
    profile.countryCode,
    profile.interests ? JSON.stringify(profile.interests) : null,
    profile.avatar,
    profile.agencyName,
    userId,
  );
}

// ---------------------------------------------------------------------------
// Registration
// FIX H-10: async bcrypt.hash, minimum 8-char password
// ---------------------------------------------------------------------------

async function registerUser(db, { username, email, phone, password, profile = {} }) {
  console.log('Registering user:', username, email, phone);
  if (!username || !password) throwAuthError('Username and password required', 'VALIDATION_ERROR');
  if (!email && !phone) throwAuthError('Email or phone required', 'VALIDATION_ERROR');
  if (password.length < MIN_PASSWORD_LENGTH) {
    throwAuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 'VALIDATION_ERROR');
  }

  const existingUsername = db.prepare(
    'SELECT id FROM users WHERE username = ?',
  ).get(username);
  if (existingUsername) throwAuthError('Username is already taken', 'CONFLICT');

  if (email) {
    const existingEmail = db.prepare(
      'SELECT id FROM users WHERE email = ?',
    ).get(email);
    if (existingEmail) throwAuthError('Email already in use', 'CONFLICT');
  }

  if (phone) {
    const existingPhone = db.prepare(
      'SELECT id FROM users WHERE phone = ?',
    ).get(phone);
    if (existingPhone) throwAuthError('Phone already in use', 'CONFLICT');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = uuidv4();

  // Prisma check/create
  try {
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          email ? { email } : {},
          phone ? { phone } : {},
        ],
      },
    });
    if (existing) {
      if (existing.username === username) throwAuthError('Username is already taken', 'CONFLICT');
      if (email && existing.email === email) throwAuthError('Email already in use', 'CONFLICT');
      if (phone && existing.phone === phone) throwAuthError('Phone already in use', 'CONFLICT');
    }

    await prisma.user.create({
      data: {
        id: userId,
        username,
        email,
        phone,
        passwordHash,
        role: 'USER',
        ...profile,
      },
    });
  } catch (err) {
    console.error('Prisma registration failed:', err);
    throwAuthError('Database registration error', 500);
  }

  // SQLite legacy
  db.prepare(`
    INSERT INTO users (id, username, email, phone, password_hash, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, username, email || null, phone || null, passwordHash, 'USER');

  applyProfileToSqlite(db, userId, profile);

  return { userId, username, role: 'USER', passwordHash, ...profile };
}

async function completeRegistration(db, {
  userId,
  username,
  role,
  passwordHash,
  email,
  phone,
  agentCode,
  accountType,
  status,
  agencyApproved,
  profileCompleted,
  ...profile
}) {
  await syncPrismaUser({
    id: userId,
    username,
    email,
    phone,
    role,
    passwordHash,
    agentCode,
    accountType,
    status: status || 'active',
    ...profile,
  });
  const tokens = await issueTokenPair(userId, username, role);
  return { 
    userId, 
    username, 
    role, 
    agentCode, 
    accountType, 
    status: status || 'ACTIVE',
    agencyApproved: agencyApproved || false,
    profileCompleted: profileCompleted !== undefined ? profileCompleted : true,
    ...tokens 
  };
}

async function completeProfile(db, userId, profile) {
  const { displayName, countryCode, gender, dateOfBirth, interests, accountType } = profile;
  
  // Update in Prisma — store all profile fields
  // NOTE: profileCompleted field requires migration 20260719000001_add_profile_completed
  // to be applied to the DB. Until then, we derive profile completeness from
  // the presence of displayName/countryCode/gender (set in this same update).
  try {
    const updateData = {
      displayName: displayName || null,
      gender: gender || null,
      birthday: dateOfBirth ? new Date(dateOfBirth) : null,
      countryCode: countryCode || null,
      interests: interests ? JSON.stringify(interests) : null,
      updatedAt: new Date(),
    };

    // Apply profileCompleted only if the column exists (migration applied)
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { ...updateData, profileCompleted: true },
      });
    } catch (migErr) {
      if (migErr.message && migErr.message.includes('profileCompleted')) {
        // Migration not yet applied — update without the new field
        await prisma.user.update({
          where: { id: userId },
          data: updateData,
        });
      } else {
        throw migErr;
      }
    }
  } catch (err) {
    console.error('Prisma profile update failed:', err);
    throwAuthError('Database profile update error', 500);
  }

  // Update in SQLite (Legacy)
  try {
    db.prepare(`
      UPDATE users 
      SET display_name = ?, gender = ?, birthday = ?, country_code = ?, interests = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(displayName || null, gender || null, dateOfBirth || null, countryCode || null, interests ? JSON.stringify(interests) : null, userId);
  } catch (sqliteErr) {
    console.warn('SQLite profile update failed (non-critical):', sqliteErr.message);
  }
  
  // Get fresh user from Prisma — do NOT select profileCompleted (migration may not be applied yet)
  const user = await prisma.user.findUnique({ 
    where: { id: userId }, 
    select: { 
      id: true,
      username: true, 
      role: true,
      agentCode: true,
      accountType: true,
      agencyApproved: true,
      agencyApprovedAt: true,
      status: true,
      displayName: true,
      countryCode: true,
      gender: true,
    } 
  });
  if (!user) throwAuthError('User not found', 404);

  // profileCompleted = true because we just set displayName/countryCode/gender
  const profileCompleted = !!(user.displayName || user.countryCode || user.gender);

  // Issue fresh tokens after profile completion
  const tokens = await issueTokenPair(userId, user.username, user.role);
  
  return { 
    userId: user.id,
    username: user.username,
    role: user.role,
    agentCode: user.agentCode,
    accountType: user.accountType,
    agencyApproved: user.agencyApproved,
    agencyApprovedAt: user.agencyApprovedAt,
    status: user.status,
    profileCompleted,
    ...tokens 
  };
}

/**
 * @deprecated This function is deprecated and will be removed in a future version.
 * Use POST /api/agency/register instead for agency registration.
 * 
 * IMPORTANT: This function creates accountType='AGENCY_OWNER' despite its name.
 * It conflates "Agent" (referral marketer) with "Agency" (business entity).
 * Kept temporarily for backward compatibility only.
 */
async function registerAgent(db, { username, email, phone, password, profile = {} }) {
  console.warn('[DEPRECATED] registerAgent() called - use POST /api/agency/register instead');
  
  if (!username || !password) throwAuthError('Username and password required', 'VALIDATION_ERROR');
  if (!email && !phone) throwAuthError('Email or phone required', 'VALIDATION_ERROR');
  if (password.length < MIN_PASSWORD_LENGTH) {
    throwAuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 'VALIDATION_ERROR');
  }

  const existingUsername = db.prepare(
    'SELECT id FROM users WHERE username = ?',
  ).get(username);
  if (existingUsername) throwAuthError('Username is already taken', 'CONFLICT');

  if (email) {
    const existingEmail = db.prepare(
      'SELECT id FROM users WHERE email = ?',
    ).get(email);
    if (existingEmail) throwAuthError('Email already in use', 'CONFLICT');
  }

  if (phone) {
    const existingPhone = db.prepare(
      'SELECT id FROM users WHERE phone = ?',
    ).get(phone);
    if (existingPhone) throwAuthError('Phone already in use', 'CONFLICT');
  }

  // FIX H-10: async hash
  const passwordHash = await bcrypt.hash(password, 12);
  let agentCode;
  let isUnique = false;
  while (!isUnique) {
    const suffix = Math.random().toString(36).substring(2, 7).toUpperCase();
    agentCode = `AGT-${suffix}`;
    const dup = db.prepare('SELECT id FROM users WHERE agent_code = ?').get(agentCode);
    isUnique = !dup;
  }

  const userId = uuidv4();

  // Register agent as AGENCY accountType with PENDING_APPROVAL status
  // This ensures agents go through approval workflow like agencies
  try {
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          email ? { email } : {},
          phone ? { phone } : {},
        ],
      },
    });
    if (existing) {
      if (existing.username === username) throwAuthError('Username is already taken', 'CONFLICT');
      if (email && existing.email === email) throwAuthError('Email already in use', 'CONFLICT');
      if (phone && existing.phone === phone) throwAuthError('Phone already in use', 'CONFLICT');
    }

    await prisma.user.create({
      data: {
        id: userId,
        username,
        email,
        phone,
        passwordHash,
        role: 'USER',
        agentCode,
        accountType: 'USER', // ✅ FIXED: 'USER' not 'AGENCY' (will change to 'AGENCY_OWNER' after approval)
        status: 'PENDING_APPROVAL',
        agencyApproved: false,
        profileCompleted: true,
        ...profile,
      },
    });

    // Create agency request for admin approval
    await prisma.agencyRequest.create({
      data: {
        userId,
        agencyName: profile.agencyName || username,
        ownerName: profile.displayName || username,
        phone: phone || '',
        email: email,
        bio: profile.bio,
        teamSize: profile.teamSize,
        offeredServices: profile.offeredServices || [],
        status: 'PENDING',
      },
    });
  } catch (err) {
    console.error('Prisma agent registration failed:', err);
    throwAuthError('Database registration error', 500);
  }

  db.prepare(`
    INSERT INTO users (id, username, email, phone, password_hash, role, agent_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, username, email || null, phone || null, passwordHash, 'USER', agentCode);

  applyProfileToSqlite(db, userId, profile);

  return { 
    userId, 
    username, 
    role: 'USER',  // USER until approved
    agentCode, 
    passwordHash, 
    accountType: 'USER', // ✅ FIXED: 'USER' not 'AGENCY' (will change to 'AGENCY_OWNER' after approval)
    status: 'PENDING_APPROVAL',
    agencyApproved: false,
    profileCompleted: true,
    ...profile 
  };
}

async function registerAgency(db, { username, email, phone, password, profile = {} }) {
  console.log('[AGENCY_REGISTER] authService.registerAgency() called');
  console.log('[AGENCY_REGISTER] username:', username);
  console.log('[AGENCY_REGISTER] email:', email);
  console.log('[AGENCY_REGISTER] phone:', phone);
  console.log('[AGENCY_REGISTER] profile keys:', Object.keys(profile));
  
  if (!username || !password) throwAuthError('Username and password required', 'VALIDATION_ERROR');
  if (!email && !phone) throwAuthError('Email or phone required', 'VALIDATION_ERROR');
  if (password.length < MIN_PASSWORD_LENGTH) {
    throwAuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 'VALIDATION_ERROR');
  }

  console.log('[AGENCY_REGISTER] stage=CHECK_SQLITE_DUPLICATES');
  const existingUsername = db.prepare(
    'SELECT id FROM users WHERE username = ?',
  ).get(username);
  if (existingUsername) throwAuthError('Username is already taken', 'CONFLICT');

  if (email) {
    const existingEmail = db.prepare(
      'SELECT id FROM users WHERE email = ?',
    ).get(email);
    if (existingEmail) throwAuthError('Email already in use', 'CONFLICT');
  }

  if (phone) {
    const existingPhone = db.prepare(
      'SELECT id FROM users WHERE phone = ?',
    ).get(phone);
    if (existingPhone) throwAuthError('Phone already in use', 'CONFLICT');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = uuidv4();
  console.log('[AGENCY_REGISTER] generated userId:', userId);

  try {
    console.log('[AGENCY_REGISTER] stage=CHECK_PRISMA_DUPLICATES');
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          email ? { email } : {},
          phone ? { phone } : {},
        ],
      },
    });
    if (existing) {
      console.log('[AGENCY_REGISTER] Prisma duplicate found');
      if (existing.username === username) throwAuthError('Username is already taken', 'CONFLICT');
      if (email && existing.email === email) throwAuthError('Email already in use', 'CONFLICT');
      if (phone && existing.phone === phone) throwAuthError('Phone already in use', 'CONFLICT');
    }

    console.log('[AGENCY_REGISTER] stage=CREATE_USER');
    // Create user with PENDING_APPROVAL status
    // ✅ FIX: Use accountType: 'USER' during pending approval
    // Will be changed to 'AGENCY_OWNER' after admin approval
    await prisma.user.create({
      data: {
        id: userId,
        username,
        email,
        phone,
        passwordHash,
        role: 'USER',
        accountType: 'USER', // ✅ FIXED: 'USER' not 'AGENCY' (will change to 'AGENCY_OWNER' after approval)
        status: 'PENDING_APPROVAL',
        agencyApproved: false,
        profileCompleted: true, // Agency registration is complete, just needs approval
        ...profile,
      },
    });
    console.log('[AGENCY_REGISTER] User created successfully');

    console.log('[AGENCY_REGISTER] stage=CREATE_AGENCY_REQUEST');
    // Create agency request in separate table for admin review
    await prisma.agencyRequest.create({
      data: {
        userId,
        agencyName: profile.agencyName || username,
        ownerName: profile.displayName || username,
        phone: phone || '',
        email: email,
        bio: profile.bio,
        teamSize: profile.teamSize,
        offeredServices: profile.offeredServices || [],
        status: 'PENDING',
      },
    });
    console.log('[AGENCY_REGISTER] AgencyRequest created successfully');
  } catch (err) {
    console.error('[AGENCY_REGISTER] ═══════════════════════════════════════');
    console.error('[AGENCY_REGISTER] Prisma error occurred');
    console.error('[AGENCY_REGISTER] Error name:', err.name);
    console.error('[AGENCY_REGISTER] Error code:', err.code);
    console.error('[AGENCY_REGISTER] Error message:', err.message);
    if (err.meta) {
      console.error('[AGENCY_REGISTER] Error meta:', JSON.stringify(err.meta, null, 2));
    }
    if (err.code === 'P2002') {
      console.error('[AGENCY_REGISTER] Unique constraint violation on:', err.meta?.target);
    }
    console.error('[AGENCY_REGISTER] ═══════════════════════════════════════');
    
    // Provide user-friendly error messages
    if (err.code === 'P2002') {
      const target = err.meta?.target;
      if (target?.includes('username')) throwAuthError('Username is already taken', 'CONFLICT');
      if (target?.includes('email')) throwAuthError('Email already in use', 'CONFLICT');
      if (target?.includes('phone')) throwAuthError('Phone already in use', 'CONFLICT');
    }
    
    throwAuthError('Database registration error', 500);
  }

  console.log('[AGENCY_REGISTER] stage=INSERT_SQLITE');
  db.prepare(`
    INSERT INTO users (id, username, email, phone, password_hash, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, username, email || null, phone || null, passwordHash, 'USER');

  applyProfileToSqlite(db, userId, profile);

  console.log('[AGENCY_REGISTER] authService.registerAgency() complete');
  // ✅ FIX: Return accountType: 'USER' during pending (will become 'AGENCY_OWNER' after approval)
  return { userId, username, role: 'USER', passwordHash, accountType: 'USER', status: 'PENDING_APPROVAL', ...profile };
}

async function approveAgency(agencyUserId, adminAccountId) {
  // Get the agency request
  const agencyRequest = await prisma.agencyRequest.findUnique({
    where: { userId: agencyUserId },
    include: { user: true },
  });

  if (!agencyRequest) {
    throw new Error('Agency request not found');
  }

  if (agencyRequest.status !== 'PENDING') {
    throw new Error('Agency request is not pending');
  }

  // Check if agency entity already exists (shouldn't happen, but safety check)
  const existingAgency = await prisma.agency.findUnique({
    where: { ownerId: agencyUserId },
  });

  if (existingAgency) {
    throw new Error('Agency already exists for this user');
  }

  // Create Agency entity from AgencyRequest data
  const agency = await prisma.agency.create({
    data: {
      ownerId: agencyUserId,
      name: agencyRequest.agencyName,
      description: agencyRequest.bio,
      country: agencyRequest.country,
      profileImage: agencyRequest.profileImage || agencyRequest.user.avatar,
      documents: agencyRequest.documents || [],
      teamSize: agencyRequest.teamSize,
      offeredServices: agencyRequest.offeredServices || [],
      level: 'STANDARD',
      commissionRate: 0.0,
      status: 'ACTIVE',
      totalEarnings: 0,
    },
  });

  // Update User accountType and status
  await prisma.user.update({
    where: { id: agencyUserId },
    data: {
      accountType: 'AGENCY_OWNER',
      status: 'ACTIVE',
      agencyApproved: true,
      agencyApprovedAt: new Date(),
      agencyApprovedBy: null, // AdminAccount.id, not User.id - set to null for foreign key safety
    },
  });

  // Update AgencyRequest status
  await prisma.agencyRequest.update({
    where: { userId: agencyUserId },
    data: {
      status: 'APPROVED',
      reviewedBy: null, // AdminAccount.id, not User.id - set to null for foreign key safety
      reviewedAt: new Date(),
    },
  });

  // Create notification
  await prisma.notification.create({
    data: {
      id: uuidv4(),
      userId: agencyUserId,
      type: 'AGENCY_APPROVED',
      titleAr: 'تمت الموافقة على الوكالة',
      bodyAr: `تم قبول طلب إنشاء وكالة "${agency.name}". يمكنك الآن إدارة وكالتك ودعوة الأعضاء.`,
      data: { agencyId: agency.id },
    },
  });

  // Log audit trail
  await prisma.auditLog.create({
    data: {
      userId: agencyUserId,
      action: 'AGENCY_APPROVED',
      metadata: { 
        agencyId: agency.id,
        agencyName: agency.name,
        approvedBy: adminAccountId,
      },
    },
  });

  return agency;
}

async function rejectAgency(agencyUserId, rejectionReason = null) {
  // Get the agency request
  const agencyRequest = await prisma.agencyRequest.findUnique({
    where: { userId: agencyUserId },
  });

  if (!agencyRequest) {
    throw new Error('Agency request not found');
  }

  if (agencyRequest.status !== 'PENDING') {
    throw new Error('Agency request is not pending');
  }

  // Update user status to REJECTED
  // Note: We check for AGENCY_OWNER accountType now (updated from AGENCY)
  const updated = await prisma.user.update({
    where: { id: agencyUserId },
    data: {
      status: 'REJECTED',
      // Keep accountType as AGENCY_OWNER so user can resubmit
    },
  });

  // Update agency request status with rejection reason
  await prisma.agencyRequest.update({
    where: { userId: agencyUserId },
    data: {
      status: 'REJECTED',
      rejectionReason,
      reviewedAt: new Date(),
    },
  });

  // Create notification
  await prisma.notification.create({
    data: {
      id: uuidv4(),
      userId: agencyUserId,
      type: 'AGENCY_REJECTED',
      titleAr: 'تم رفض طلب الوكالة',
      bodyAr: rejectionReason || 'للأسف لم تتم الموافقة على طلب الوكالة الخاص بك في هذا الوقت. يمكنك تعديل الطلب وإعادة تقديمه.',
      data: { reason: rejectionReason },
    },
  });

  // Log audit trail
  await prisma.auditLog.create({
    data: {
      userId: agencyUserId,
      action: 'AGENCY_REJECTED',
      metadata: { reason: rejectionReason },
    },
  });

  return updated;
}

async function suspendAgency(agencyUserId) {
  const updated = await prisma.user.update({
    where: { id: agencyUserId, accountType: 'AGENCY' },
    data: {
      status: 'SUSPENDED',
    },
  });

  await prisma.notification.create({
    data: {
      id: uuidv4(),
      userId: agencyUserId,
      type: 'AGENCY_SUSPENDED',
      titleAr: 'تم تعليق حساب الوكالة',
      bodyAr: 'تم تعليق حساب الوكالة الخاص بك. يرجى الاتصال بالدعم للحصول على مزيد من التفاصيل.',
    },
  });

  return updated;
}

async function getPendingAgencies() {
  return prisma.user.findMany({
    where: { accountType: 'AGENCY', status: 'PENDING_APPROVAL' },
    select: {
      id: true,
      username: true,
      email: true,
      phone: true,
      agencyName: true,
      createdAt: true,
      agencyRequest: {
        select: {
          id: true,
          agencyName: true,
          ownerName: true,
          phone: true,
          email: true,
          bio: true,
          teamSize: true,
          offeredServices: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function getAgencyRequestStatus(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      accountType: true,
      status: true,
      agencyApproved: true,
      role: true,
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (user.accountType !== 'AGENCY') {
    return {
      status: 'NOT_AGENCY',
      message: 'User is not registered as agency',
    };
  }

  const agencyRequest = await prisma.agencyRequest.findUnique({
    where: { userId },
    select: {
      status: true,
      rejectionReason: true,
      createdAt: true,
      reviewedAt: true,
    },
  });

  return {
    accountStatus: user.status,
    requestStatus: agencyRequest?.status || 'NOT_FOUND',
    rejectionReason: agencyRequest?.rejectionReason,
    agencyApproved: user.agencyApproved,
    role: user.role,
    createdAt: agencyRequest?.createdAt,
    reviewedAt: agencyRequest?.reviewedAt,
  };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function loginUser(db, { email, phone, password }) {
  if (!password) throwAuthError('Password required', 'VALIDATION_ERROR');
  if (!email && !phone) throwAuthError('Email or phone required', 'VALIDATION_ERROR');

  const row = db.prepare(
    `SELECT ${SQLITE_USER_AUTH_COLS} FROM users WHERE email = ? OR phone = ?`,
  ).get(email || null, phone || null);
  const user = mapSqliteUser(row);

  if (!user) throwAuthError('User not found', 'AUTH_FAILED');

  clearExpiredSqliteBan(db, user);
  throwIfBanned(user);

  if (!await bcrypt.compare(password, user.password_hash)) {
    throwAuthError('Incorrect password', 'AUTH_FAILED');
  }

  await assertUserNotBanned(user.id);

  // Check if user is rejected (for agencies/agents)
  const prismaStatus = await prisma.user.findUnique({
    where: { id: user.id },
    select: { status: true, accountType: true },
  });
  
  if (prismaStatus?.status === 'REJECTED' && prismaStatus?.accountType === 'AGENCY') {
    throwAuthError('Your agency/agent application was rejected. Please contact support for more information.', 'ACCOUNT_REJECTED');
  }

  if (prismaStatus?.status === 'PENDING_APPROVAL' && prismaStatus?.accountType === 'AGENCY') {
    throwAuthError('Your agency/agent application is pending approval. Please wait for admin review.', 'PENDING_APPROVAL');
  }

  await syncPrismaUser({
    id: user.id,
    username: user.username,
    email: email || null,
    phone: phone || null,
    role: user.role,
    status: user.status,
    passwordHash: user.password_hash,
    // Do not pass profile fields — partial sync preserves existing Prisma profile data.
  });

  // Fetch profile completion status from Prisma — use existing fields, not the new column
  // (profileCompleted column requires migration 20260719000001 to be applied first)
  const prismaUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      accountType: true,
      agencyApproved: true,
      agencyApprovedAt: true,
      displayName: true,
      countryCode: true,
      gender: true,
    },
  });

  const tokens = await issueTokenPair(user.id, user.username, user.role);
  return {
    userId: user.id,
    username: user.username,
    role: normalizeRole(user.role),
    accountType: prismaUser?.accountType || 'USER',
    agencyApproved: prismaUser?.agencyApproved || false,
    agencyApprovedAt: prismaUser?.agencyApprovedAt || null,
    profileCompleted: !!(prismaUser?.displayName || prismaUser?.countryCode || prismaUser?.gender),
    ...tokens,
  };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async function refreshTokens(db, refreshToken) {
  // Step 1 — verify JWT signature and type (throws 401 on tampered/expired tokens)
  const payload = verifyRefreshToken(refreshToken);

  // Step 2 — confirm the token still exists in the DB (not revoked)
  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
  if (!stored || stored.expiresAt <= new Date()) {
    // Best-effort cleanup of any stale rows for this token string
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    throwAuthError('Refresh token revoked or expired', 'AUTH_FAILED');
  }

  // BUG FIX: `userId` was used as a free variable here — it was never declared
  // in this scope, causing `ReferenceError: userId is not defined` on every
  // refresh call → the asyncHandler caught it → 500 response.
  // Use `stored.userId` (authoritative from DB) instead of the JWT payload
  // value so a compromised payload cannot reference a different user's record.
  const userId = stored.userId;

  // Step 3 — load the user and check account standing
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      isBanned: true,
      banExpiresAt: true,
      banType: true,
      passwordHash: true, // Needed for revocation check
    },
  });

  if (!user) {
    throwAuthError('User not found', 'NOT_FOUND');
  }

  // FIX: Check temporary bans - if banExpiresAt is in the past, auto-unban
  if (user.isBanned && user.banExpiresAt && new Date(user.banExpiresAt) <= new Date()) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isBanned: false,
        banExpiresAt: null,
        banType: null,
      },
    });
    user.isBanned = false;
  }

  // Check if currently banned
  if (user.isBanned) {
    const err = new Error('Account is suspended');
    err.code = 'USER_BANNED';
    throw err;
  }

  const accountStatus = normalizeAccountStatus(user.status);
  if (accountStatus === 'BANNED' || accountStatus === 'SUSPENDED') {
    const err = new Error('Account is suspended');
    err.code = 'USER_BANNED';
    throw err;
  }

  // Security check: Verify the user's password hasn't changed since this token was issued
  // We can use the iat (issued at) to compare against a passwordChangedAt field if we had one.
  // For now, rotation is handled by issuing a new token pair and deleting the old one.

  // Issue new pair (token rotation — old token deleted above)
  await prisma.refreshToken.delete({ where: { token: refreshToken } });
  const tokens = await issueTokenPair(user.id, user.username, user.role);
  return tokens;
}

// ---------------------------------------------------------------------------
// OTP
// FIX H-07: Deliver via Twilio when TWILIO_* env vars are set.
// ---------------------------------------------------------------------------

async function sendOtp(phoneNumber, role) {
  if (!phoneNumber) throw new Error('Phone number required');

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

  await prisma.otpCode.updateMany({
    where: { phone: phoneNumber, used: false },
    data: { used: true },
  });

  await prisma.otpCode.create({
    data: { phone: phoneNumber, code, expiresAt, role: role || null },
  });

  // Deliver via Twilio when configured; fall back to console log in development.
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    try {
      const twilio = require('twilio');
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: `Your verification code is: ${code}. It expires in 5 minutes.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber,
      });
    } catch (err) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[OTP] Twilio delivery failed:', err.message);
        throw new Error('SMS service is temporarily unavailable. Please try again.');
      }
      console.warn(`[OTP] Twilio delivery failed (${err.message}) — dev fallback`);
      console.log(`[OTP] ${phoneNumber}: ${code}`);
    }
  } else if (process.env.NODE_ENV !== 'production') {
    console.log(`[OTP] ${phoneNumber}: ${code}`);
  } else {
    console.error('[OTP] Twilio credentials not configured — OTP not delivered!');
    throw new Error('SMS service is not configured. Please contact support.');
  }

  return { success: true, message: 'OTP sent to phone' };
}

async function verifyOtp(db, { phoneNumber, code, role }) {
  // Build a dynamic where clause: if a role is provided, match it; otherwise
  // accept any role for the latest unused code for the phone number.
  const whereClause = {
    phone: phoneNumber,
    used: false,
    expiresAt: { gt: new Date() },
  };
  if (role) {
    whereClause.role = role;
  }

  const otp = await prisma.otpCode.findFirst({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
  });

  if (!otp || otp.code !== code) throwAuthError('Incorrect or expired OTP', 'AUTH_FAILED');

  await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } });

  let user = mapSqliteUser(
    db.prepare(`SELECT ${SQLITE_USER_AUTH_COLS} FROM users WHERE phone = ?`).get(phoneNumber),
  );

  if (!user) {
    const userId = uuidv4();
    const username = `user_${phoneNumber.replace(/\D/g, '').slice(-6)}_${userId.slice(0, 4)}`;
    const targetRole = role || 'USER';
    db.prepare(`
      INSERT INTO users (id, username, phone, role, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, username, phoneNumber, targetRole, 'active');
    user = {
      id: userId,
      username,
      role: targetRole,
      status: 'active',
      isBanned: false,
      banExpiresAt: null,
      banType: null,
    };
    await syncPrismaUser({
      id: userId,
      username,
      email: null,
      phone: phoneNumber,
      role: targetRole,
      status: 'active',
      passwordHash: null,
    });
  }

  clearExpiredSqliteBan(db, user);
  throwIfBanned(user);

  await assertUserNotBanned(user.id);

  // Fetch profile completion status from Prisma — use existing fields
  const prismaOtpUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      accountType: true,
      agencyApproved: true,
      agencyApprovedAt: true,
      displayName: true,
      countryCode: true,
      gender: true,
    },
  });

  const tokens = await issueTokenPair(user.id, user.username, user.role);
  return {
    userId: user.id,
    username: user.username,
    role: normalizeRole(user.role),
    accountType: prismaOtpUser?.accountType || 'USER',
    agencyApproved: prismaOtpUser?.agencyApproved || false,
    agencyApprovedAt: prismaOtpUser?.agencyApprovedAt || null,
    profileCompleted: !!(prismaOtpUser?.displayName || prismaOtpUser?.countryCode || prismaOtpUser?.gender),
    ...tokens,
  };
}

// ---------------------------------------------------------------------------
// Social login
// FIX C-04: Verify idToken server-side.
// FIX M-06: Create SocialAccount record in Prisma on email match.
// ---------------------------------------------------------------------------

async function socialLogin(db, { provider, providerId, email, username, avatar, idToken }) {
  if (!provider || !providerId) throw new Error('Provider and providerId required');

  // FIX C-04: Verify the token server-side
  let verifiedProfile = null;
  if (idToken) {
    verifiedProfile = await verifySocialToken(provider, idToken);
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('idToken is required for social login in production');
  }

  // Use verified values when available, fall back to client-supplied for dev stub
  const resolvedProviderId = verifiedProfile?.providerId || providerId;
  const resolvedEmail = verifiedProfile?.email || email;
  const resolvedUsername = verifiedProfile?.username || username;
  const resolvedAvatar = verifiedProfile?.avatar || avatar;

  let user = mapSqliteUser(
    db.prepare(
      `SELECT ${SQLITE_USER_AUTH_COLS} FROM users WHERE social_provider = ? AND social_provider_id = ?`,
    ).get(provider, resolvedProviderId),
  );

  if (!user && resolvedEmail) {
    user = mapSqliteUser(
      db.prepare(`SELECT ${SQLITE_USER_AUTH_COLS} FROM users WHERE email = ?`).get(resolvedEmail),
    );
    if (user) {
      db.prepare(
        'UPDATE users SET social_provider = ?, social_provider_id = ? WHERE id = ?',
      ).run(provider, resolvedProviderId, user.id);

      // FIX M-06: also create SocialAccount in Prisma
      await prisma.socialAccount.upsert({
        where: { provider_providerId: { provider, providerId: resolvedProviderId } },
        update: { userId: user.id },
        create: { provider, providerId: resolvedProviderId, userId: user.id },
      }).catch((err) => console.warn('SocialAccount upsert failed:', err.message));
    }
  }

  if (!user) {
    const userId = uuidv4();
    const newUsername = resolvedUsername || resolvedEmail?.split('@')[0] || `${provider}_${resolvedProviderId.slice(0, 8)}`;
    db.prepare(`
      INSERT INTO users (id, username, email, avatar, social_provider, social_provider_id, role, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, newUsername, resolvedEmail || null, resolvedAvatar || null, provider, resolvedProviderId, 'USER', 'active');
    user = {
      id: userId,
      username: newUsername,
      role: 'USER',
      status: 'active',
      isBanned: false,
      banExpiresAt: null,
      banType: null,
    };
    await syncPrismaUser({
      id: userId,
      username: newUsername,
      email: resolvedEmail || null,
      phone: null,
      role: 'USER',
      status: 'active',
      passwordHash: null,
      avatar: resolvedAvatar,
    });
    // FIX M-06: create SocialAccount for new user
    await prisma.socialAccount.create({
      data: { provider, providerId: resolvedProviderId, userId },
    }).catch((err) => console.warn('SocialAccount create failed:', err.message));
  }

  clearExpiredSqliteBan(db, user);
  throwIfBanned(user);

  await assertUserNotBanned(user.id);

  // Fetch profile completion status from Prisma — use existing fields
  const prismaSocialUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      accountType: true,
      agencyApproved: true,
      agencyApprovedAt: true,
      displayName: true,
      countryCode: true,
      gender: true,
    },
  });

  const tokens = await issueTokenPair(user.id, user.username, user.role);
  return {
    userId: user.id,
    username: user.username,
    role: normalizeRole(user.role),
    accountType: prismaSocialUser?.accountType || 'USER',
    agencyApproved: prismaSocialUser?.agencyApproved || false,
    agencyApprovedAt: prismaSocialUser?.agencyApprovedAt || null,
    profileCompleted: !!(prismaSocialUser?.displayName || prismaSocialUser?.countryCode || prismaSocialUser?.gender),
    ...tokens,
  };
}

async function getCurrentUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      phone: true,
      role: true,
      avatar: true,
      agentCode: true,
      isBanned: true,
      banExpiresAt: true,
      banType: true,
      status: true,
      accountType: true,
      agencyApproved: true,
      agencyApprovedAt: true,
      // profileCompleted field: requires migration 20260719000001.
      // Derived below from displayName/countryCode/gender until migration is applied.
      displayName: true,
      countryCode: true,
      gender: true,
      UserVip: {
        select: {
          tier: true,
          status: true,
          expiresAt: true,
          autoRenew: true,
        },
      },
    },
  });

  if (!user) {
    throwAuthError('User not found', 'NOT_FOUND');
  }

  // FIX: Check temporary bans - if banExpiresAt is in the past, auto-unban
  if (user.isBanned && user.banExpiresAt && new Date(user.banExpiresAt) <= new Date()) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: false,
        banExpiresAt: null,
        banType: null,
      },
    });
    user.isBanned = false;
    user.banExpiresAt = null;
    user.banType = null;
  }

  // Check if currently banned
  if (user.isBanned) {
    const err = new Error('Account is suspended');
    err.code = 'USER_BANNED';
    err.banExpiresAt = user.banExpiresAt;
    err.banType = user.banType;
    throw err;
  }

  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: normalizeRole(user.role),
    avatar: user.avatar,
    agentCode: user.agentCode || null,
    isBanned: user.isBanned,
    status: user.status || 'ACTIVE',
    accountType: user.accountType || 'USER',
    agencyApproved: user.agencyApproved || false,
    agencyApprovedAt: user.agencyApprovedAt,
    // Computed: profile is complete when any profile field has been filled in.
    // Replace with `user.profileCompleted` once migration 20260719000001 is applied.
    profileCompleted: !!(user.displayName || user.countryCode || user.gender),
    vipTier: user.UserVip?.tier || 'NONE',
    vipStatus: user.UserVip?.status || 'NONE',
    vipExpiresAt: user.UserVip?.expiresAt || null,
    vipAutoRenew: user.UserVip?.autoRenew || false,
  };
}

// ---------------------------------------------------------------------------
// Check Account Status (public - for splash screen)
// Does NOT require auth, used to verify account exists and is not banned
// ---------------------------------------------------------------------------

async function checkAccountStatus(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      isBanned: true,
      banExpiresAt: true,
      banType: true,
      status: true,
    },
  });

  if (!user) {
    return { exists: false, active: false };
  }

  // Auto-unban if temporary ban expired
  if (user.isBanned && user.banExpiresAt && new Date(user.banExpiresAt) <= new Date()) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: false,
        banExpiresAt: null,
        banType: null,
      },
    });
    return { exists: true, active: true, username: user.username };
  }

  return {
    exists: true,
    active: !user.isBanned && normalizeAccountStatus(user.status) === 'ACTIVE',
    username: user.username,
    isBanned: user.isBanned,
    banType: user.banType,
    banExpiresAt: user.banExpiresAt,
  };
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

async function logout(refreshToken) {
  if (refreshToken) await revokeRefreshToken(refreshToken);
  return { success: true, message: 'Logged out' };
}

async function logoutAll(userId) {
  await revokeAllRefreshTokens(userId);
  return { success: true, message: 'Logged out from all devices' };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

async function requestPasswordReset(db, { email }) {
  if (!email) throw new Error('Email required');
  const user = db.prepare('SELECT id, username FROM users WHERE email = ?').get(email);
  if (!user) {
    return { success: true, message: 'If the email exists, a reset link was sent' };
  }

  await syncPrismaUser({ id: user.id, username: user.username, email, phone: null, role: 'USER' });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_EXPIRY_MS);

  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, used: false },
    data: { used: true },
  });

  await prisma.passwordResetToken.create({
    data: { userId: user.id, token, expiresAt },
  });

  if (process.env.NODE_ENV !== 'production' && process.env.LOG_RESET_TOKEN === 'true') {
    console.log(`[password-reset] ${email}: ${token}`);
  }

  return { success: true, message: 'If the email exists, a reset link was sent' };
}

async function resetPassword(db, { token, newPassword }) {
  if (!token || !newPassword) throw new Error('Token and new password required');
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const reset = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!reset || reset.used || reset.expiresAt <= new Date()) {
    throwAuthError('Invalid or expired reset token', 'VALIDATION_ERROR');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, reset.userId);

  await prisma.passwordResetToken.update({ where: { id: reset.id }, data: { used: true } });
  await prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } });
  await revokeAllRefreshTokens(reset.userId);

  return { success: true, message: 'Password updated' };
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  issueTokenPair,
  parseProfilePayload,
  registerUser,
  registerAgent,
  registerAgency,
  completeRegistration,
  completeProfile,
  loginUser,
  refreshTokens,
  sendOtp,
  verifyOtp,
  socialLogin,
  getCurrentUser,
  checkAccountStatus,
  logout,
  logoutAll,
  requestPasswordReset,
  resetPassword,
  revokeAllRefreshTokens,
  getRefreshTokenInfo,
  approveAgency,
  rejectAgency,
  suspendAgency,
  getPendingAgencies,
  getAgencyRequestStatus,
};

// ---------------------------------------------------------------------------
// Get Current User (for session restore & verification)
// FIX: Check ban status including expired bans, return current user data
// ---------------------------------------------------------------------------
