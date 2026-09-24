const prisma = require('../prismaClient');
const coinsService = require('./coins.service');
const loyaltyService = require('./loyalty.service');

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const MISSIONS = [
  { id: 'send_gifts', title: 'Gift Giver', titleAr: 'مُهدي', description: 'Send 3 gifts today', target: 3, coins: 50, xp: 30, metric: 'gifts_sent' },
  { id: 'voice_time', title: 'Voice Chat', titleAr: 'صوتي', description: 'Earn 20 voice XP', target: 20, coins: 30, xp: 20, metric: 'voice_xp' },
  { id: 'spend_coins', title: 'Big Spender', titleAr: 'منفق', description: 'Spend 200 coins', target: 200, coins: 80, xp: 50, metric: 'coins_spent' },
  { id: 'chat_active', title: 'Social', titleAr: 'اجتماعي', description: 'Send 10 chat messages', target: 10, coins: 25, xp: 15, metric: 'messages' },
];

const SPEND_TYPES = ['GIFT_SENT', 'FRAME_PURCHASE', 'ENTRANCE_PURCHASE', 'VIP_PURCHASE', 'SHOP_PURCHASE'];

async function getMetricProgress(userId, metric, since) {
  switch (metric) {
    case 'gifts_sent':
      return prisma.giftTransaction.count({ where: { senderId: userId, createdAt: { gte: since } } });
    case 'voice_xp': {
      const rows = await prisma.userLevelEvent.findMany({
        where: { userId, eventType: 'voice_minutes', createdAt: { gte: since } },
        select: { xpAmount: true },
      });
      return rows.reduce((sum, row) => sum + row.xpAmount, 0);
    }
    case 'coins_spent': {
      const rows = await prisma.coinTransaction.findMany({
        where: { userId, type: { in: SPEND_TYPES }, createdAt: { gte: since } },
        select: { amount: true },
      });
      return rows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
    }
    case 'messages':
      return prisma.roomMessage.count({ where: { userId, createdAt: { gte: since } } });
    default:
      return 0;
  }
}

async function getMissionsStatus(userId) {
  const today = startOfUtcDay();
  const claims = await prisma.shopPurchase.findMany({
    where: { userId, itemType: 'mission', createdAt: { gte: today } },
    select: { itemId: true },
  });
  const claimedIds = new Set(claims.map((c) => c.itemId));

  const missions = await Promise.all(
    MISSIONS.map(async (mission) => {
      const progress = await getMetricProgress(userId, mission.metric, today);
      const completed = progress >= mission.target;
      const claimed = claimedIds.has(mission.id);
      return {
        ...mission,
        progress: Math.min(progress, mission.target),
        completed,
        claimed,
        claimable: completed && !claimed,
      };
    }),
  );

  return { missions, resetAt: new Date(today.getTime() + 24 * 60 * 60 * 1000) };
}

async function claimMission(userId, missionId) {
  const mission = MISSIONS.find((m) => m.id === missionId);
  if (!mission) throw new Error('Mission not found');

  const today = startOfUtcDay();
  const existing = await prisma.shopPurchase.findFirst({
    where: { userId, itemType: 'mission', itemId: missionId, createdAt: { gte: today } },
  });
  if (existing) {
    const err = new Error('Mission reward already claimed');
    err.code = 'ALREADY_CLAIMED';
    throw err;
  }

  const progress = await getMetricProgress(userId, mission.metric, today);
  if (progress < mission.target) {
    const err = new Error('Mission not completed yet');
    err.code = 'NOT_COMPLETED';
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const purchase = await tx.shopPurchase.create({
      data: {
        userId,
        itemType: 'mission',
        itemId: missionId,
        coinsSpent: 0,
        metadata: { coins: mission.coins, xp: mission.xp },
      },
    });

    await coinsService.creditCoins(userId, mission.coins, 'BONUS', purchase.id, `Mission: ${mission.title}`, tx);
    await loyaltyService.awardXp(userId, 'mission_complete', mission.xp, { missionId }, tx);

    return { missionId, coins: mission.coins, xp: mission.xp, purchaseId: purchase.id };
  });
}

module.exports = { getMissionsStatus, claimMission, MISSIONS };
