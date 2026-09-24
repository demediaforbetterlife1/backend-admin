const prisma = require('../prismaClient');
const coinsService = require('./coins.service');
const loyaltyService = require('./loyalty.service');
const vipRecalcService = require('./vip.recalc.service');
const vipService = require('./vip.service');
const notificationService = require('./notification.service');
const { TIER_ORDER, normalizeTier } = require('../config/premium.tiers');

const giftComboState = new Map();
const COMBO_WINDOW_MS = 15000;

function trackGiftCombo(senderId, roomId, giftId, gift) {
  const key = `${senderId}:${roomId}:${giftId}`;
  const now = Date.now();
  let entry = giftComboState.get(key);
  if (!entry || now - entry.lastAt > COMBO_WINDOW_MS) {
    entry = { count: 1, lastAt: now };
  } else {
    entry.count += 1;
    entry.lastAt = now;
  }
  giftComboState.set(key, entry);

  const threshold = gift.comboCount || 3;
  const comboCount = entry.count;
  const isCombo = comboCount >= 2;
  const isFullscreen = Boolean(gift.isLegendary) || comboCount >= threshold;
  const comboMultiplier = isCombo ? Math.min(1 + (comboCount - 1) * 0.1, 3) : 1;

  return { comboCount, isCombo, isFullscreen, comboMultiplier };
}

async function getGiftsGrouped() {
  const gifts = await prisma.gift.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  const grouped = gifts.reduce((acc, g) => {
    (acc[g.category] = acc[g.category] || []).push(g);
    return acc;
  }, {});
  return grouped;
}

async function sendGift(senderId, giftId, receiverId, roomId, quantity = 1) {
  if (senderId === receiverId) throw new Error('Cannot send gift to yourself');
  if (!quantity || quantity < 1 || quantity > 99) throw new Error('Invalid quantity');

  // Simplified transaction without VIP complexity to avoid timeout issues
  const result = await prisma.$transaction(async (tx) => {
    const gift = await tx.gift.findUnique({ where: { id: giftId } });
    if (!gift || !gift.isActive) throw new Error('Gift not available');

    const receiver = await tx.user.findUnique({ where: { id: receiverId } });
    if (!receiver) throw new Error('Receiver not found');

    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (!room || !room.isActive) throw new Error('Room not found');

    const totalCoins = gift.coinPrice * quantity;

    const giftTx = await tx.giftTransaction.create({
      data: {
        giftId,
        senderId,
        receiverId,
        roomId,
        quantity,
        totalCoins,
      },
    });

    // Direct debit/credit without VIP complexity
    await coinsService.debitCoins(
      senderId,
      totalCoins,
      'GIFT_SENT',
      giftTx.id,
      `Sent ${quantity}x ${gift.name}`,
      tx,
    );

    await coinsService.creditCoins(
      receiverId,
      totalCoins,
      'GIFT_RECEIVED',
      giftTx.id,
      `Received ${quantity}x ${gift.name}`,
      tx,
    );

    return { gift, transaction: giftTx, senderId, receiverId, roomId, quantity };
  });

  // POST-TRANSACTION: Record spend in VipSpendLedger for VIP tier progression
  try {
    await vipRecalcService.recordVipSpendEvent({
      userId: senderId,
      kind: 'SPEND',
      sourceType: 'GIFT_SENT',
      sourceId: result.transaction.id,
      amount: result.transaction.totalCoins,
      metadata: { 
        giftId: result.gift.id, 
        giftName: result.gift.name,
        receiverId,
        roomId: result.roomId,
        quantity: result.quantity,
      },
    });
    
    // Award XP for sending gift (loyalty progression)
    await loyaltyService.awardXp(
      senderId,
      'gift_sent',
      Math.min(result.transaction.totalCoins * 0.1, 50), // 10% of coins as XP, max 50 per gift
      { giftId: result.gift.id, receiverId, amount: result.transaction.totalCoins }
    );
  } catch (err) {
    console.warn('Failed to record VIP spend or award XP for gift', err.message);
  }

  const sender = await prisma.user.findUnique({ where: { id: senderId }, select: { username: true } });
  await notificationService.sendPushNotification(
    result.receiverId,
    'GIFT_RECEIVED',
    '🎁 استلمت هدية!',
    `${sender?.username || 'Someone'} أرسل لك ${result.gift.nameAr}`,
    { senderId, giftId, roomId: result.roomId },
  ).catch((err) => console.warn('Gift notification failed', err.message));

  try {
    const io = global.__io;
    if (io) {
      const combo = trackGiftCombo(senderId, result.roomId, result.gift.id, result.gift);
      const senderUser = await prisma.user.findUnique({ where: { id: senderId } });
      const receiverUser = await prisma.user.findUnique({ where: { id: receiverId } });
      const roomNs = io.of('/room');
      roomNs.to(result.roomId).emit('gift-received', {
        senderId,
        senderName: senderUser?.username,
        senderAvatar: senderUser?.avatar,
        receiverId,
        receiverName: receiverUser?.username,
        giftId: result.gift.id,
        giftName: result.gift.name,
        giftNameAr: result.gift.nameAr,
        giftAnimationUrl: result.gift.animationUrl,
        animationUrl: result.gift.animationUrl,
        quantity: result.quantity,
        totalCoins: result.transaction.totalCoins,
        creditedCoins: result.transaction.totalCoins,
        isLegendary: result.gift.isLegendary,
        comboCount: combo.comboCount,
        isCombo: combo.isCombo,
        isFullscreen: combo.isFullscreen,
        comboMultiplier: combo.comboMultiplier,
        timestamp: new Date().toISOString(),
      });

      // Broadcast updated leaderboard so all clients can refresh gift rankings.
      const leaderboard = await getGiftLeaderboard(result.roomId, 10);
      roomNs.to(result.roomId).emit('gift-leaderboard-updated', {
        roomId: result.roomId,
        leaderboard,
      });
    }
  } catch (err) {
    console.error('Failed to emit gift socket event', err);
  }

  return { gift: result.gift, transaction: result.transaction };
}

async function getGiftLeaderboard(roomId, limit = 10) {
  // Aggregate total coins sent per sender in the room, sorted descending.
  const rows = await prisma.giftTransaction.groupBy({
    by: ['senderId'],
    where: { roomId },
    _sum: { totalCoins: true },
    orderBy: { _sum: { totalCoins: 'desc' } },
    take: limit,
  });

  const userIds = rows.map((r) => r.senderId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, avatar: true },
  });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return rows.map((r) => ({
    userId: r.senderId,
    username: userMap[r.senderId]?.username ?? null,
    avatar: userMap[r.senderId]?.avatar ?? null,
    totalCoins: r._sum.totalCoins ?? 0,
  }));
}

async function getRoomGiftStats(roomId) {
  const [totalGifts, totalCoins] = await Promise.all([
    prisma.giftTransaction.count({ where: { roomId } }),
    prisma.giftTransaction.aggregate({ where: { roomId }, _sum: { totalCoins: true } }),
  ]);
  return { totalGifts, totalCoins: totalCoins._sum.totalCoins ?? 0 };
}

async function getGiftHistory(userId, type = 'sent', page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  if (type === 'sent') {
    const rows = await prisma.giftTransaction.findMany({ where: { senderId: userId }, orderBy: { createdAt: 'desc' }, take: limit, skip });
    const total = await prisma.giftTransaction.count({ where: { senderId: userId } });
    return { rows, total };
  }
  const rows = await prisma.giftTransaction.findMany({ where: { receiverId: userId }, orderBy: { createdAt: 'desc' }, take: limit, skip });
  const total = await prisma.giftTransaction.count({ where: { receiverId: userId } });
  return { rows, total };
}

module.exports = { getGiftsGrouped, sendGift, getGiftHistory, getGiftLeaderboard, getRoomGiftStats };
