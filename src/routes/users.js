/**
 * User routes — profile management.
 *
 * CRITICAL FIX: Static routes (/me, /online, /online/count) are registered
 * BEFORE the dynamic /:id route. Express matches routes in declaration order,
 * so /online/count would previously match /:id with id='online/count',
 * causing getCurrentUser('online') → user not found → 401.
 */

const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/authMiddleware');
const moderationService = require('../services/moderation.service');
const notificationService = require('../services/notification.service');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function logProfileAction(action, userId, details = {}) {
  console.log(`[PROFILE] ${action}`, { userId, timestamp: new Date().toISOString(), ...details });
}

function getVipLevelFromTier(tier) {
  if (!tier || tier === 'NONE') return 0;
  if (tier === 'VIP' || tier === 'TEST_VIP') return 1;
  if (tier.startsWith('SVIP_')) return 3 + (parseInt(tier.slice(5), 10) || 0);
  if (tier === 'TEST_SVIP') return 4;
  return 0;
}

function getVipBadgeLabel(tier) {
  if (!tier || tier === 'NONE') return null;
  if (tier === 'VIP' || tier === 'TEST_VIP') return 'VIP';
  if (tier.startsWith('SVIP_')) return `SVIP ${parseInt(tier.slice(5), 10) || 1}`;
  if (tier === 'TEST_SVIP') return 'SVIP 1';
  return tier;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC ROUTES FIRST — must appear before /:id
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// GET /api/users/me — current user full profile
// ---------------------------------------------------------------------------
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  logProfileAction('GET_ME', userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { wallet: true, UserVip: true },
  });

  if (!user) {
    return sendError(res, 'User not found', 404);
  }

  const [
    followersCount,
    followingCount,
    postsCount,
    roomsCreatedCount,
    giftsReceived,
    giftsSent,
    activeFrame,
    activeEntrance,
  ] = await Promise.all([
    prisma.follow.count({ where: { followingId: userId } }),
    prisma.follow.count({ where: { followerId: userId } }),
    prisma.post.count({ where: { userId } }),
    prisma.room.count({ where: { ownerId: userId } }),
    prisma.giftTransaction.count({ where: { receiverId: userId } }),
    prisma.giftTransaction.count({ where: { senderId: userId } }),
    prisma.userFrame.findFirst({ where: { userId, isActive: true }, include: { frame: true } }),
    prisma.userEntrance.findFirst({ where: { userId, isActive: true }, include: { entrance: true } }),
  ]);

  const badges = [];
  if (user.UserVip && user.UserVip.tier !== 'NONE') {
    badges.push({ id: `vip-${user.UserVip.tier}`, label: getVipBadgeLabel(user.UserVip.tier), color: '#FFD700' });
  }
  if (user.accountType === 'AGENCY' && user.agencyApproved) {
    badges.push({ id: 'agency', label: 'Agency', color: '#8B5CF6' });
  }

  sendSuccess(res, {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    avatar: user.avatar,
    bio: user.bio,
    gender: user.gender,
    countryCode: user.countryCode,
    birthday: user.birthday,
    interests: user.interests,
    role: user.role,
    accountType: user.accountType,
    agencyName: user.agencyName,
    agencyApproved: user.agencyApproved,
    vipLevel: getVipLevelFromTier(user.UserVip?.tier),
    svipLevel: user.svipLevel || 0,
    vipTier: user.UserVip?.tier || 'NONE',
    vipStatus: user.UserVip?.status || 'NONE',
    vipExpiresAt: user.UserVip?.expiresAt || null,
    coins: user.wallet?.coinBalance || 0,
    diamonds: 0,
    frameId: activeFrame?.frameId || null,
    entranceId: activeEntrance?.entranceId || null,
    followersCount,
    followingCount,
    friendsCount: 0,
    postsCount,
    roomsCreatedCount,
    giftsReceived,
    giftsSent,
    visitorsCount: 0,
    isOnline: user.status === 'ACTIVE',
    isBanned: user.isBanned,
    createdAt: user.createdAt,
    lastSeen: user.updatedAt,
    badges,
  });
}));

// ---------------------------------------------------------------------------
// GET /api/users/me/stats — current user statistics
// ---------------------------------------------------------------------------
router.get('/me/stats', authenticate, async (req, res) => {
  const userId = req.user.id;
  logProfileAction('GET_STATS', userId);

  try {
    const [followersCount, followingCount, giftsReceived, giftsSent, roomsCreated, messagesSent] =
      await Promise.all([
        prisma.follow.count({ where: { followingId: userId } }),
        prisma.follow.count({ where: { followerId: userId } }),
        prisma.giftTransaction.count({ where: { receiverId: userId } }),
        prisma.giftTransaction.count({ where: { senderId: userId } }),
        prisma.room.count({ where: { ownerId: userId } }),
        prisma.roomMessage.count({ where: { userId } }),
      ]);

    res.json({
      success: true,
      data: {
        followersCount,
        followingCount,
        giftsReceived,
        giftsSent,
        visitorsCount: 0,
        roomsCreated,
        roomsJoined: 0,
        messagesSent,
      },
    });
  } catch (err) {
    console.error('[PROFILE] GET_STATS error:', err);
    res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/users/me/update — update profile fields
// ---------------------------------------------------------------------------
router.put('/me/update', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { displayName, bio, gender, countryCode, birthday, interests } = req.body;
  logProfileAction('UPDATE_PROFILE', userId);

  const updateData = {};

  if (displayName !== undefined) {
    const nameCheck = await moderationService.filterMessage(displayName.trim());
    if (nameCheck.blocked) {
      return sendError(res, 'Display name contains prohibited content', 400);
    }
    updateData.displayName = nameCheck.filtered.trim();
  }

  if (bio !== undefined) {
    const bioCheck = await moderationService.filterMessage(bio.trim());
    if (bioCheck.blocked) {
      return sendError(res, 'Bio contains prohibited content', 400);
    }
    updateData.bio = bioCheck.filtered.trim();
  }

  if (gender !== undefined) updateData.gender = gender;
  if (countryCode !== undefined) updateData.countryCode = countryCode;
  if (birthday !== undefined) updateData.birthday = birthday ? new Date(birthday) : null;
  if (interests !== undefined) updateData.interests = interests;

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: { id: true, username: true, displayName: true, bio: true, gender: true, countryCode: true, birthday: true, interests: true, avatar: true },
  });

  sendSuccess(res, updatedUser, 200, 'Profile updated successfully');
}));

// ---------------------------------------------------------------------------
// POST /api/users/me/follow/:id — follow a user
// ---------------------------------------------------------------------------
router.post('/me/follow/:id', authenticate, asyncHandler(async (req, res) => {
  const followerId = req.user.id;
  const followingId = req.params.id;

  if (followerId === followingId) {
    return sendError(res, 'Cannot follow yourself', 400);
  }

  const targetUser = await prisma.user.findUnique({ where: { id: followingId }, select: { id: true } });
  if (!targetUser) {
    return sendError(res, 'User not found', 404);
  }

  const existing = await prisma.follow.findFirst({ where: { followerId, followingId } });
  if (existing) {
    return sendError(res, 'Already following this user', 400);
  }

  await prisma.follow.create({
    data: { id: require('crypto').randomUUID(), followerId, followingId },
  });

  notificationService.sendPushNotification(
    followingId,
    'NEW_FOLLOWER',
    'New Follower',
    `${req.user.username} started following you`,
    { userId: followerId },
  ).catch(() => {});

  sendSuccess(res, null, 200, 'Followed successfully');
}));

// ---------------------------------------------------------------------------
// POST /api/users/me/unfollow/:id — unfollow a user
// ---------------------------------------------------------------------------
router.post('/me/unfollow/:id', authenticate, asyncHandler(async (req, res) => {
  const followerId = req.user.id;
  const followingId = req.params.id;

  await prisma.follow.deleteMany({ where: { followerId, followingId } });
  sendSuccess(res, null, 200, 'Unfollowed successfully');
}));

// ---------------------------------------------------------------------------
// GET /api/users/search — search users by username or display name
// MUST be before /:id
// Real database search with partial match, case-insensitive
// ---------------------------------------------------------------------------
router.get('/search', authenticate, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(50, parseInt(req.query.limit || '20', 10));

  if (!q) {
    return sendSuccess(res, []);
  }

  logProfileAction('SEARCH_USERS', req.user.id, { query: q, limit });

  // Search in username, displayName with case-insensitive partial match
  const users = await prisma.user.findMany({
    where: {
      isBanned: false, // Exclude banned users from search
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatar: true,
      bio: true,
      role: true,
      status: true,
      UserVip: {
        select: {
          tier: true,
          status: true,
          expiresAt: true,
        },
      },
    },
    take: limit,
    orderBy: [
      { status: 'desc' }, // Online users first
      { createdAt: 'desc' },
    ],
  });

  // Transform to include vipLevel for frontend compatibility
  const results = users.map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    bio: user.bio,
    role: user.role,
    status: user.status,
    vipLevel: getVipLevelFromTier(user.UserVip?.tier),
    vipTier: user.UserVip?.tier || 'NONE',
    isOnline: user.status === 'ACTIVE',
  }));

  sendSuccess(res, results);
}));

// ---------------------------------------------------------------------------
// GET /api/users/online — list online users
// MUST be before /:id
// ---------------------------------------------------------------------------
router.get('/online', authenticate, asyncHandler(async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit || '20', 10));

  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, username: true, avatar: true },
    take: limit,
  });

  sendSuccess(res, users);
}));

// ---------------------------------------------------------------------------
// GET /api/users/online/count — count of online users
// MUST be before /:id — previously this matched /:id with id='online/count'
// causing getCurrentUser('online') → user not found → 401
// ---------------------------------------------------------------------------
router.get('/online/count', authenticate, asyncHandler(async (req, res) => {
  const count = await prisma.user.count({ where: { status: 'ACTIVE' } });
  sendSuccess(res, { count });
}));

// ---------------------------------------------------------------------------
// GET /api/users/blocked — list blocked users
// ---------------------------------------------------------------------------
router.get('/blocked', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  logProfileAction('GET_BLOCKED_USERS', userId);

  const blockedRecords = await prisma.blockedUser.findMany({
    where: { blockerId: userId },
    include: {
      blocked: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const blockedUsers = blockedRecords.map((record) => ({
    id: record.blocked.id,
    username: record.blocked.username,
    displayName: record.blocked.displayName,
    avatar: record.blocked.avatar,
    blockedAt: record.createdAt,
  }));

  sendSuccess(res, blockedUsers);
}));

// ---------------------------------------------------------------------------
// POST /api/users/block/:id — block a user
// ---------------------------------------------------------------------------
router.post('/block/:id', authenticate, asyncHandler(async (req, res) => {
  const blockerId = req.user.id;
  const blockedId = req.params.id;

  if (blockerId === blockedId) {
    return sendError(res, 'Cannot block yourself', 400);
  }

  const targetUser = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
  if (!targetUser) {
    return sendError(res, 'User not found', 404);
  }

  // Check if already blocked
  const existing = await prisma.blockedUser.findUnique({
    where: { blockerId_blockedId: { blockerId, blockedId } },
  });

  if (existing) {
    return sendError(res, 'User is already blocked', 400);
  }

  // Create block record
  await prisma.blockedUser.create({
    data: {
      id: require('crypto').randomUUID(),
      blockerId,
      blockedId,
    },
  });

  // Also unfollow in both directions if following
  await Promise.all([
    prisma.follow.deleteMany({ where: { followerId: blockerId, followingId: blockedId } }),
    prisma.follow.deleteMany({ where: { followerId: blockedId, followingId: blockerId } }),
  ]);

  logProfileAction('BLOCK_USER', blockerId, { blockedUserId: blockedId });
  sendSuccess(res, null, 200, 'User blocked successfully');
}));

// ---------------------------------------------------------------------------
// DELETE /api/users/block/:id — unblock a user
// ---------------------------------------------------------------------------
router.delete('/block/:id', authenticate, asyncHandler(async (req, res) => {
  const blockerId = req.user.id;
  const blockedId = req.params.id;

  await prisma.blockedUser.deleteMany({
    where: { blockerId, blockedId },
  });

  logProfileAction('UNBLOCK_USER', blockerId, { unblockedUserId: blockedId });
  sendSuccess(res, null, 200, 'User unblocked successfully');
}));

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC ROUTES — must appear AFTER all static routes
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// GET /api/users/:id — public profile by user ID
// ---------------------------------------------------------------------------
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const currentUserId = req.user.id;
  logProfileAction('GET_USER_PROFILE', currentUserId, { targetId: userId });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { UserVip: true },
  });

  if (!user) {
    return sendError(res, 'User not found', 404);
  }

  const [followersCount, followingCount, postsCount, roomsCreatedCount, isFollowingRecord] =
    await Promise.all([
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.follow.count({ where: { followerId: userId } }),
      prisma.post.count({ where: { userId } }),
      prisma.room.count({ where: { ownerId: userId } }),
      prisma.follow.findFirst({ where: { followerId: currentUserId, followingId: userId } }),
    ]);

  const badges = [];
  if (user.UserVip && user.UserVip.tier !== 'NONE') {
    badges.push({ id: `vip-${user.UserVip.tier}`, label: getVipBadgeLabel(user.UserVip.tier), color: '#FFD700' });
  }
  if (user.accountType === 'AGENCY' && user.agencyApproved) {
    badges.push({ id: 'agency', label: 'Agency', color: '#8B5CF6' });
  }

  sendSuccess(res, {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    bio: user.bio,
    role: user.role,
    vipLevel: getVipLevelFromTier(user.UserVip?.tier),
    vipTier: user.UserVip?.tier || 'NONE',
    vipStatus: user.UserVip?.status || 'NONE',
    vipExpiresAt: user.UserVip?.expiresAt || null,
    followersCount,
    followingCount,
    postsCount,
    roomsCreatedCount,
    isOnline: user.status === 'ACTIVE',
    badges,
    isFollowing: !!isFollowingRecord,
  });
}));

module.exports = router;
