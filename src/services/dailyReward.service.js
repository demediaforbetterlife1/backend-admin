const prisma = require('../prismaClient');
const coinsService = require('./coins.service');
const vipService = require('./vip.service');

const { getDailyRewardAmount } = require('../config/premium.tiers');

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function getDailyRewardStatus(userId) {
  const vipStatus = await vipService.getVipPrivileges(userId);
  const tier = vipStatus?.tier || 'NONE';
  const today = startOfUtcDay();

  const existing = await prisma.dailyRewardClaim.findUnique({
    where: { userId_claimedDate: { userId, claimedDate: today } },
  });

  const amount = getDailyRewardAmount(tier);
  const nextAvailableAt = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  return {
    tier,
    amount,
    available: !existing,
    claimedAt: existing?.createdAt || null,
    nextAvailableAt,
  };
}

async function claimDailyReward(userId) {
  const status = await getDailyRewardStatus(userId);
  if (!status.available) {
    const err = new Error('Daily reward has already been claimed today');
    err.code = 'ALREADY_CLAIMED';
    throw err;
  }

  const claimDate = startOfUtcDay();
  return prisma.$transaction(async (tx) => {
    const claim = await tx.dailyRewardClaim.create({
      data: {
        userId,
        claimedDate: claimDate,
        rewardType: 'VIP_DAILY',
        coins: status.amount,
        metadata: { tier: status.tier },
      },
    });

    await coinsService.creditCoins(
      userId,
      status.amount,
      'DAILY_REWARD',
      claim.id,
      `Daily VIP reward for ${status.tier}`,
      tx,
      {
        userId,
        kind: 'RECHARGE',
        sourceType: 'DAILY_REWARD',
        sourceId: claim.id,
        amount: status.amount,
        metadata: { tier: status.tier },
      },
    );

    return {
      claimId: claim.id,
      tier: status.tier,
      amount: status.amount,
      nextAvailableAt: status.nextAvailableAt,
    };
  });
}

module.exports = {
  getDailyRewardStatus,
  claimDailyReward,
};
