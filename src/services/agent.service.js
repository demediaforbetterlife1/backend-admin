/**
 * Agent Service
 *
 * FIX C-02: calculateCommission now credits coins INSIDE the transaction.
 * FIX H-03: calculateCommission argument order documented and validated.
 * FIX M-07: checkInactiveReferrals fixed — checks activity, not activation date.
 * FIX M-01: resetMonthlyEarnings processes in batches to avoid table lock.
 */

const prisma = require('../prismaClient');
const coinsService = require('./coins.service');
const notificationService = require('./notification.service');
const { AGENT_CONFIG } = require('../config/agent.config');

function generateAgentCode() {
  const suffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `AGT-${suffix}`;
}

async function createAgentProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  let agentCode = user.agentCode;
  if (!agentCode) {
    let unique = false;
    while (!unique) {
      agentCode = generateAgentCode();
      const existing = await prisma.user.findUnique({ where: { agentCode } });
      unique = !existing;
    }
    const updateData = { agentCode };
    if (user.role !== 'AGENT') updateData.role = 'AGENT';
    await prisma.user.update({ where: { id: userId }, data: updateData });
  }

  const existingProfile = await prisma.agentProfile.findUnique({ where: { userId } });
  if (existingProfile) return existingProfile;

  return prisma.agentProfile.create({ data: { userId, agentCode } });
}

async function registerWithReferral(newUserId, agentCode) {
  if (!agentCode) return null;

  const agentProfile = await prisma.agentProfile.findUnique({ where: { agentCode } });
  if (!agentProfile) throw new Error('Agent code not found');

  const existingReferral = await prisma.referral.findUnique({ where: { referredUserId: newUserId } });
  if (existingReferral) return existingReferral;

  const referral = await prisma.referral.create({
    data: { agentId: agentProfile.id, referredUserId: newUserId },
  });

  await prisma.agentProfile.update({
    where: { id: agentProfile.id },
    data: { totalReferred: { increment: 1 } },
  });

  return referral;
}

function isActivationAction(action) {
  return AGENT_CONFIG.referralActivationActions.includes(action);
}

async function activateReferral(referredUserId, action) {
  if (!isActivationAction(action)) return null;

  const referral = await prisma.referral.findUnique({ where: { referredUserId } });
  if (!referral || referral.status !== 'PENDING') return null;

  const agentProfile = await prisma.agentProfile.findUnique({ where: { id: referral.agentId } });
  if (!agentProfile) return null;

  await prisma.$transaction(async (tx) => {
    await tx.referral.update({
      where: { referredUserId },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    });
    await tx.agentProfile.update({
      where: { id: agentProfile.id },
      data: { activeReferred: { increment: 1 } },
    });
  });

  await recalculateTier(agentProfile.id);

  notificationService.sendPushNotification(
    agentProfile.userId,
    'AGENT_REFERRAL_ACTIVE',
    'مستخدم جديد أصبح نشطاً بفضلك 🎉',
    'تهانينا! أحد المحالين الخاصين بك أصبح نشطًا.',
    { referredUserId },
  ).catch(console.warn);

  return referral;
}

function getTierForActiveReferred(activeCount) {
  const thresholds = AGENT_CONFIG.tierThresholds;
  if (activeCount >= thresholds.DIAMOND.min) return 'DIAMOND';
  if (activeCount >= thresholds.PLATINUM.min) return 'PLATINUM';
  if (activeCount >= thresholds.GOLD.min) return 'GOLD';
  if (activeCount >= thresholds.SILVER.min) return 'SILVER';
  return 'BRONZE';
}

async function recalculateTier(agentId) {
  const agent = await prisma.agentProfile.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  const newTier = getTierForActiveReferred(agent.activeReferred);
  if (newTier === agent.tier) return agent;

  const updated = await prisma.agentProfile.update({
    where: { id: agentId },
    data: { tier: newTier },
  });

  notificationService.sendPushNotification(
    updated.userId,
    'AGENT_TIER_UPGRADE',
    `⬆️ ترقية! أصبحت وكيل ${newTier}`,
    `تقدم وكالتك إلى المستوى ${newTier}. استمر في الأداء الرائع!`,
    { newTier },
  ).catch(console.warn);

  return updated;
}

/**
 * Calculate and credit agent commission.
 *
 * FIX C-02: creditCoins is now called INSIDE the transaction so the coin
 *           credit and commission record are atomic.
 *
 * FIX H-03: Parameters:
 *   @param {string} referredUserId - The user whose action triggered the commission
 *   @param {string} sourceType     - CommissionSource enum: GIFT_SENT | VIP_PURCHASE | COIN_PURCHASE
 *   @param {string} sourceId       - The ID of the source record (giftTx.id, orderId, etc.)
 *   @param {number} baseCoins      - The coin amount to calculate commission on (must be a number)
 */
async function calculateCommission(referredUserId, sourceType, sourceId, baseCoins) {
  // FIX H-03: validate baseCoins is actually a number
  const baseCoinsNum = Number(baseCoins);
  if (!referredUserId || !sourceType || !sourceId || !Number.isFinite(baseCoinsNum) || baseCoinsNum <= 0) {
    return null;
  }

  const referral = await prisma.referral.findUnique({ where: { referredUserId } });
  if (!referral || referral.status !== 'ACTIVE') return null;

  const agentProfile = await prisma.agentProfile.findUnique({ where: { id: referral.agentId } });
  if (!agentProfile) return null;

  const baseRate = AGENT_CONFIG.commissionRates[sourceType];
  if (!baseRate) return null;

  const finalRate = baseRate * (AGENT_CONFIG.tierBonusMultiplier[agentProfile.tier] || 1);
  const earnedCoins = Math.floor(baseCoinsNum * finalRate);
  if (earnedCoins <= 0) return null;

  // FIX: check for existing commission on the same sourceId before creating.
  // Without this, a client retry or network timeout can cause the same IAP
  // receipt to trigger calculateCommission twice, crediting the agent double.
  const commission = await prisma.$transaction(async (tx) => {
    const existing = await tx.agentCommission.findFirst({
      where: { agentId: agentProfile.id, sourceId, sourceType },
    });
    if (existing) return existing; // idempotent — skip duplicate

    const comm = await tx.agentCommission.create({
      data: {
        agentId: agentProfile.id,
        referredUserId,
        sourceType,
        sourceId,
        baseCoins: baseCoinsNum,
        rate: finalRate,
        earnedCoins,
      },
    });

    // Credit coins inside the same transaction
    await coinsService.creditCoins(
      agentProfile.userId,
      earnedCoins,
      'COMMISSION',
      comm.id,
      `Referral commission ${sourceType}`,
      tx,
    );

    await tx.agentProfile.update({
      where: { id: agentProfile.id },
      data: {
        totalEarned: { increment: earnedCoins },
        monthlyEarned: { increment: earnedCoins },
      },
    });

    return comm;
  });

  // Notification is fire-and-forget — outside the transaction
  notificationService.sendPushNotification(
    agentProfile.userId,
    'AGENT_COMMISSION',
    `💰 كسبت ${earnedCoins} كوين عمولة`,
    `لقد حصلت على ${earnedCoins} كوين من عمولة ${sourceType}.`,
    { earnedCoins: String(earnedCoins), sourceType },
  ).catch(console.warn);

  return commission;
}

async function getAgentStats(userId) {
  const profile = await prisma.agentProfile.findUnique({
    where: { userId },
    include: {
      user: true,
      referrals: { include: { referredUser: true }, orderBy: { joinedAt: 'desc' }, take: 20 },
      commissions: { include: { referredUser: true }, orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });

  if (!profile) throw new Error('Agent profile not found');

  return {
    profile,
    recentReferrals: profile.referrals,
    recentCommissions: profile.commissions,
  };
}

async function getLeaderboard(period = 'monthly', limit = 20) {
  const order = period === 'alltime' ? { totalEarned: 'desc' } : { monthlyEarned: 'desc' };
  const rows = await prisma.agentProfile.findMany({
    orderBy: [order],
    take: limit,
    include: { user: true },
  });

  return rows.map((row, index) => ({
    rank: index + 1,
    agentName: row.user.username,
    avatar: row.user.avatar,
    tier: row.tier,
    totalReferred: row.totalReferred,
    monthlyEarned: row.monthlyEarned,
    totalEarned: row.totalEarned,
    agentCode: row.agentCode,
  }));
}

async function getAgentReferrals(agentId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [referrals, total] = await Promise.all([
    prisma.referral.findMany({
      where: { agentId },
      include: { referredUser: true },
      orderBy: { joinedAt: 'desc' },
      take: limit,
      skip,
    }),
    prisma.referral.count({ where: { agentId } }),
  ]);
  return { referrals, total, page, limit };
}

async function getAgentCommissions(agentId, page = 1, limit = 20, sourceType = null) {
  const skip = (page - 1) * limit;
  const where = sourceType ? { agentId, sourceType } : { agentId };
  const [commissions, total] = await Promise.all([
    prisma.agentCommission.findMany({
      where,
      include: { referredUser: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    }),
    prisma.agentCommission.count({ where }),
  ]);
  return { commissions, total, page, limit };
}

async function getAgentById(agentId) {
  return prisma.agentProfile.findUnique({ where: { id: agentId }, include: { user: true } });
}

async function updateAgentStatus(agentId, status) {
  const valid = ['ACTIVE', 'SUSPENDED', 'BANNED'];
  if (!valid.includes(status)) throw new Error('Invalid agent status');
  return prisma.agentProfile.update({ where: { id: agentId }, data: { status } });
}

async function updateAgentTier(agentId, tier) {
  const valid = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'];
  if (!valid.includes(tier)) throw new Error('Invalid agent tier');
  return prisma.agentProfile.update({ where: { id: agentId }, data: { tier } });
}

/**
 * FIX M-01: Process in batches of 500 to avoid locking the table.
 */
async function resetMonthlyEarnings() {
  const BATCH = 500;
  let cursor = null;
  let processed = 0;

  while (true) {
    const agents = await prisma.agentProfile.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (!agents.length) break;

    const ids = agents.map((a) => a.id);
    await prisma.agentProfile.updateMany({
      where: { id: { in: ids } },
      data: { monthlyEarned: 0 },
    });

    processed += agents.length;
    cursor = agents[agents.length - 1].id;

    if (agents.length < BATCH) break;
  }

  console.log(`[agent] Monthly earnings reset for ${processed} agents`);
  return processed;
}

/**
 * FIX M-07: Check inactivity by looking at recent coin transactions,
 *           not by activation date. Remove the incorrect activatedAt filter.
 */
async function checkInactiveReferrals() {
  const cutoff = new Date(Date.now() - AGENT_CONFIG.inactivityDays * 24 * 60 * 60 * 1000);

  // FIX M-07: fetch ALL active referrals, not just those activated before cutoff
  const activeReferrals = await prisma.referral.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, referredUserId: true, agentId: true },
  });

  for (const referral of activeReferrals) {
    try {
      const recentActivity = await prisma.coinTransaction.findFirst({
        where: { userId: referral.referredUserId, createdAt: { gte: cutoff } },
        select: { id: true },
      });

      if (!recentActivity) {
        await prisma.$transaction(async (tx) => {
          await tx.referral.update({
            where: { id: referral.id },
            data: { status: 'INACTIVE' },
          });
          await tx.agentProfile.update({
            where: { id: referral.agentId },
            data: { activeReferred: { decrement: 1 } },
          });
        });

        await recalculateTier(referral.agentId);
      }
    } catch (err) {
      console.warn(`[agent] checkInactiveReferrals failed for referral ${referral.id}:`, err.message);
    }
  }
}

async function getShareLink(userId) {
  const profile = await prisma.agentProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error('Agent profile not found');

  const baseUrl = process.env.APP_URL || 'https://yourapp.com';
  return {
    agentCode: profile.agentCode,
    webLink: `${baseUrl}/register?agent=${profile.agentCode}`,
    deepLink: `yourapp://register?agent=${profile.agentCode}`,
  };
}

module.exports = {
  createAgentProfile,
  registerWithReferral,
  activateReferral,
  calculateCommission,
  recalculateTier,
  getAgentStats,
  getAgentById,
  getLeaderboard,
  getAgentReferrals,
  getAgentCommissions,
  updateAgentStatus,
  updateAgentTier,
  resetMonthlyEarnings,
  checkInactiveReferrals,
  getShareLink,
};
