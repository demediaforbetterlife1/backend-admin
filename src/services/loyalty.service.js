/**
 * Loyalty / XP Service
 *
 * FIX H-01: awardXp no longer calls getUserXp inside a transaction (aggregate
 *           not supported in all Prisma tx versions). XP write is atomic;
 *           level recalc is scheduled async after the transaction commits.
 * FIX H-06: Cron job removed from this module — moved to jobs/loyalty.cron.js.
 * FIX L-02: Grace period activation now sends a notification to the user.
 */

const prisma = require('../prismaClient');

const LEVEL_THRESHOLDS = [
  0, 300, 500, 800, 1200, 1800, 2700, 4000, 5500, 7500,
  10000, 13000, 17000, 22000, 28000, 36000,
];

const LEVELS = LEVEL_THRESHOLDS.length - 1;

const RETENTION_RULES = {
  VIP:   { spend: 5,  voiceMinutes: 120, gifts: 1 },
  SVIP:  { spend: 15, voiceMinutes: 240, gifts: 3 },
  ELITE: { spend: 30, voiceMinutes: 420, gifts: 5 },
};

function getTierLabel(level) {
  return level <= 7 ? 'VIP' : 'SVIP';
}

function getBadge(level) {
  if (level <= 2) return 'Bronze VIP';
  if (level <= 4) return 'Silver VIP';
  if (level <= 6) return 'Gold VIP';
  if (level === 7) return 'Royal VIP';
  if (level <= 9) return 'SVIP Sapphire';
  if (level <= 11) return 'SVIP Diamond';
  if (level <= 13) return 'SVIP Platinum';
  if (level === 14) return 'SVIP Legend';
  return 'SVIP Emperor';
}

function getEntranceEffect(level) {
  if (level <= 2) return 'Basic shimmer ring';
  if (level <= 4) return 'Glow trail and soft particles';
  if (level <= 6) return 'Burst effect with pulse';
  if (level === 7) return 'Circular portal effect';
  if (level <= 9) return 'Blue energy ring';
  if (level <= 11) return 'Halo and prism wave';
  if (level <= 13) return 'Beam of light and entry title';
  if (level === 14) return 'Room spotlight and custom text';
  return 'Full-screen cinematic entrance with room-wide announcement';
}

function getAdminPrivileges(level) {
  if (level <= 4) return ['Room priority boost'];
  if (level <= 7) return ['Room priority boost', 'VIP room highlight'];
  if (level <= 10) return ['Room priority boost', 'VIP room highlight', 'Gift tray priority'];
  if (level <= 11) return ['Room priority boost', 'VIP room highlight', 'Gift tray priority', 'Anti-mute immunity'];
  if (level <= 13) return ['Room priority boost', 'VIP room highlight', 'Gift tray priority', 'Anti-mute immunity', 'Kick protection'];
  return ['Room priority boost', 'VIP room highlight', 'Gift tray priority', 'Anti-mute immunity', 'Kick protection', 'Ban protection'];
}

function getExclusiveGifts(level) {
  if (level < 8) return [];
  if (level === 8) return ['Golden Flower Bundle'];
  if (level === 9) return ['Neon Rocket'];
  if (level === 10) return ['Crystal Crown Gift'];
  if (level === 11) return ['Royal Spark Gift'];
  if (level === 12) return ['Private Room Celebration Pack'];
  if (level === 13) return ['Limited Edition Aurora Gift'];
  if (level === 14) return ['Mythic Gift Pack'];
  return ['Eternal Legend Gift Set'];
}

function getSupportTier(level) {
  if (level < 8) return 'standard';
  if (level < 12) return 'priority';
  if (level < 14) return 'fast_track';
  return 'concierge';
}

function getRetentionRequirements(level) {
  if (level <= 7) return RETENTION_RULES.VIP;
  if (level <= 11) return RETENTION_RULES.SVIP;
  return RETENTION_RULES.ELITE;
}

function getLevelFromXp(xpTotal) {
  let level = 1;
  for (let i = 1; i <= LEVELS; i++) {
    if (xpTotal >= LEVEL_THRESHOLDS[i]) level = i;
  }
  return level;
}

function clampLevel(level) {
  return Math.max(1, Math.min(LEVELS, level));
}

function getLevelProgress(level, xpTotal) {
  const start = LEVEL_THRESHOLDS[level - 1] || 0;
  const end = LEVEL_THRESHOLDS[level] || LEVEL_THRESHOLDS[LEVELS];
  const xpInLevel = Math.max(0, xpTotal - start);
  const xpNeeded = Math.max(0, end - xpTotal);
  
  // FIX: For max level (15), show full progress if XP exceeds final threshold
  // This prevents negative xpToNextLevel when user has XP > 36,000
  if (level === LEVELS && xpTotal >= end) {
    return {
      xpCurrentLevel: end - start,
      xpToNextLevel: 0,
    };
  }
  
  return {
    xpCurrentLevel: xpInLevel,
    xpToNextLevel: xpNeeded,
  };
}

function getPerks(level) {
  return {
    badge: getBadge(level),
    entranceEffect: getEntranceEffect(level),
    adminPrivileges: getAdminPrivileges(level),
    exclusiveGifts: getExclusiveGifts(level),
    supportTier: getSupportTier(level),
  };
}

function getBonusMultiplier(level) {
  if (level <= 2) return 1.05;
  if (level <= 4) return 1.08;
  if (level <= 6) return 1.12;
  if (level <= 7) return 1.15;
  if (level <= 9) return 1.20;
  if (level <= 11) return 1.24;
  if (level <= 13) return 1.28;
  if (level === 14) return 1.35;
  return 1.45;
}

async function getUserXp(userId) {
  const aggregate = await prisma.userLevelEvent.aggregate({
    where: { userId },
    _sum: { xpAmount: true },
  });
  return aggregate._sum.xpAmount || 0;
}

async function getMonthlyActivity(userId) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const [voiceRows, giftRows, paymentRows] = await Promise.all([
    prisma.userLevelEvent.findMany({
      where: { userId, eventType: 'voice_minutes', createdAt: { gte: start } },
      select: { metadata: true },
    }),
    prisma.giftTransaction.findMany({
      where: { senderId: userId, createdAt: { gte: start } },
      select: { id: true },
    }),
    prisma.paymentOrder.findMany({
      where: { userId, status: 'SUCCESS', createdAt: { gte: start } },
      select: { amountEGP: true },
    }),
  ]);

  return {
    monthlyVoiceMinutes: voiceRows.reduce((sum, r) => sum + (r.metadata?.minutes || 0), 0),
    monthlyGiftCount: giftRows.length,
    monthlySpend: paymentRows.reduce((sum, r) => sum + (r.amountEGP || 0), 0),
  };
}

async function syncUserTier(userId, level) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  const desiredRole = level <= 7 ? 'VIP' : 'SVIP';
  const shouldUpdateRole = ['USER', 'VIP', 'SVIP'].includes(user.role);
  
  // FIX: Write loyalty level to loyaltyLevel field (PRIMARY)
  // Keep svipLevel for backward compatibility but prioritize loyaltyLevel
  const updates = { 
    loyaltyLevel: level,              // PRIMARY: 1-15 loyalty progression
    svipLevel: level,                 // DEPRECATED: Keep for backward compat
    tierGraceActive: false, 
    tierGraceUntil: null 
  };

  if (shouldUpdateRole && user.role !== desiredRole) updates.role = desiredRole;

  const needsUpdate =
    user.loyaltyLevel !== level ||
    user.svipLevel !== level ||
    user.tierGraceActive !== false ||
    user.tierGraceUntil !== null ||
    (shouldUpdateRole && user.role !== desiredRole);

  if (needsUpdate) {
    await prisma.user.update({ where: { id: userId }, data: updates });
  }
}

async function getUserStatus(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  const xpTotal = await getUserXp(userId);
  const level = clampLevel(getLevelFromXp(xpTotal));
  await syncUserTier(userId, level);

  const [refreshedUser, progress, activity] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    Promise.resolve(getLevelProgress(level, xpTotal)),
    getMonthlyActivity(userId),
  ]);

  const retention = getRetentionRequirements(level);
  const exceedsRetention =
    activity.monthlySpend >= retention.spend &&
    activity.monthlyVoiceMinutes >= retention.voiceMinutes &&
    activity.monthlyGiftCount >= retention.gifts;

  return {
    userId,
    level,
    tier: getTierLabel(level),
    xpTotal,
    xpCurrentLevel: progress.xpCurrentLevel,
    xpToNextLevel: progress.xpToNextLevel,
    bonusMultiplier: getBonusMultiplier(level),
    perks: getPerks(level),
    monthlySpend: activity.monthlySpend,
    monthlyVoiceMinutes: activity.monthlyVoiceMinutes,
    monthlyGiftCount: activity.monthlyGiftCount,
    retentionRequirements: retention,
    retentionHealthy: exceedsRetention,
    tierGraceActive: refreshedUser.tierGraceActive,
    tierGraceUntil: refreshedUser.tierGraceUntil,
  };
}

/**
 * FIX H-01: awardXp writes XP inside the caller's transaction (or standalone),
 *           then schedules async level recalc AFTER the transaction commits.
 *           No getUserXp aggregate inside the transaction.
 */
async function awardXp(userId, eventType, xpAmount, metadata = {}, tx = prisma) {
  if (!Number.isFinite(xpAmount) || xpAmount <= 0) return null;

  // Write XP event — works inside or outside a transaction
  await tx.userLevelEvent.create({
    data: { userId, eventType, xpAmount, metadata },
  });

  // FIX H-01: schedule level recalc outside the transaction to avoid
  // aggregate-in-transaction issues and read-your-own-writes problems
  setImmediate(() => {
    getUserXp(userId)
      .then((xpTotal) => {
        const level = clampLevel(getLevelFromXp(xpTotal));
        return syncUserTier(userId, level);
      })
      .catch((err) => console.warn('[loyalty] awardXp recalc failed:', err.message));
  });

  return { userId, eventType, xpAmount };
}

/**
 * FIX L-02: Send notification when grace period is activated.
 */
async function evaluateDecay(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  const status = await getUserStatus(userId);
  const retention = getRetentionRequirements(status.level);
  const meetsRetention =
    status.monthlySpend >= retention.spend &&
    status.monthlyVoiceMinutes >= retention.voiceMinutes &&
    status.monthlyGiftCount >= retention.gifts;

  if (meetsRetention) {
    if (user.tierGraceActive || user.tierGraceUntil) {
      await prisma.user.update({
        where: { id: userId },
        data: { tierGraceActive: false, tierGraceUntil: null },
      });
    }
    return { status: 'active', level: status.level };
  }

  if (!user.tierGraceActive) {
    const graceUntil = new Date();
    graceUntil.setDate(graceUntil.getDate() + 30);
    await prisma.user.update({
      where: { id: userId },
      data: { tierGraceActive: true, tierGraceUntil: graceUntil },
    });

    // FIX L-02: notify user that grace period has started
    const notificationService = require('./notification.service');
    notificationService.sendPushNotification(
      userId,
      'VIP_EXPIRING',
      '⚠️ تنبيه: مستوى VIP الخاص بك في خطر',
      'يرجى الاستمرار في النشاط خلال 30 يومًا لتجنب خفض المستوى.',
      { graceUntil: graceUntil.toISOString() },
    ).catch(console.warn);

    return { status: 'grace', level: status.level, graceUntil };
  }

  if (user.tierGraceUntil && user.tierGraceUntil <= new Date()) {
    const downgradedLevel = Math.max(1, status.level - 1);
    await prisma.user.update({
      where: { id: userId },
      data: { svipLevel: downgradedLevel, tierGraceActive: false, tierGraceUntil: null },
    });
    const downgradedStatus = await getUserStatus(userId);
    return { status: 'downgraded', level: downgradedStatus.level, graceExpired: true };
  }

  return { status: 'grace', level: status.level, graceUntil: user.tierGraceUntil };
}

async function runDecayJob() {
  const users = await prisma.user.findMany({
    where: { svipLevel: { not: null } },
    select: { id: true },
  });

  for (const user of users) {
    try {
      await evaluateDecay(user.id);
    } catch (error) {
      console.warn(`[loyalty] Failed to evaluate decay for ${user.id}:`, error.message);
    }
  }
}

module.exports = {
  LEVEL_THRESHOLDS,
  getUserStatus,
  awardXp,
  evaluateDecay,
  runDecayJob,
  getPerks,
  getBonusMultiplier,
  getTierLabel,
  getLevelFromXp,
  getRetentionRequirements,
  getSupportTier,
};
