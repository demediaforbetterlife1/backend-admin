const prisma = require('../prismaClient');
const coinsService = require('./coins.service');
const loyaltyService = require('./loyalty.service');

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const STREAK_REWARDS = [10, 15, 20, 30, 40, 50, 75, 100, 150, 200];

function rewardForStreak(streak) {
  const idx = Math.min(streak - 1, STREAK_REWARDS.length - 1);
  return STREAK_REWARDS[Math.max(0, idx)];
}

async function getLoginRewardStatus(userId) {
  const today = startOfUtcDay();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const todayClaim = await prisma.loginRewardClaim.findUnique({
    where: { userId_claimedDate: { userId, claimedDate: today } },
  });
  const yesterdayClaim = await prisma.loginRewardClaim.findUnique({
    where: { userId_claimedDate: { userId, claimedDate: yesterday } },
  });

  const streak = todayClaim?.dayStreak ?? (yesterdayClaim ? yesterdayClaim.dayStreak + 1 : 1);
  const amount = rewardForStreak(todayClaim?.dayStreak ?? streak);

  return {
    available: !todayClaim,
    dayStreak: todayClaim?.dayStreak ?? streak,
    amount,
    xp: 10 + Math.min(streak, 7) * 5,
    claimedAt: todayClaim?.createdAt || null,
    nextAvailableAt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
  };
}

async function claimLoginReward(userId) {
  const status = await getLoginRewardStatus(userId);
  if (!status.available) {
    const err = new Error('Login reward already claimed today');
    err.code = 'ALREADY_CLAIMED';
    throw err;
  }

  const claimDate = startOfUtcDay();
  const yesterday = new Date(claimDate.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayClaim = await prisma.loginRewardClaim.findUnique({
    where: { userId_claimedDate: { userId, claimedDate: yesterday } },
  });
  const dayStreak = yesterdayClaim ? yesterdayClaim.dayStreak + 1 : 1;
  const coins = rewardForStreak(dayStreak);
  const xp = 10 + Math.min(dayStreak, 7) * 5;

  return prisma.$transaction(async (tx) => {
    const claim = await tx.loginRewardClaim.create({
      data: { userId, claimedDate: claimDate, dayStreak, coins, xp },
    });

    await coinsService.creditCoins(userId, coins, 'LOGIN_REWARD', claim.id, `Day ${dayStreak} login reward`, tx);
    await loyaltyService.awardXp(userId, 'daily_login', xp, { dayStreak }, tx);

    return { claimId: claim.id, dayStreak, coins, xp, nextAvailableAt: status.nextAvailableAt };
  });
}

module.exports = { getLoginRewardStatus, claimLoginReward };
