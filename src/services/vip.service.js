/**
 * VIP Service
 *
 * FIX M-04: checkAndExpireVips() now handles SVIP roles, not just VIP.
 * FIX M-09: purchaseFrame/purchaseEntrance wrapped in a single transaction
 *           to prevent coins being debited without the item being assigned.
 * FIX H-09: (in admin.vip.routes.js) — role update on manual grant.
 */

const prisma = require('../prismaClient');
const coinsService = require('./coins.service');
const agentService = require('./agent.service');
const vipCacheService = require('./vip.cache.service');
const vipRecalcService = require('./vip.recalc.service');

const { TIER_ORDER } = require('../config/tierOrder');
const { getTierDefinition, normalizeTier } = require('../config/premium.tiers');

async function subscribeTier(userId, tier, source = 'coins', autoRenew = false, outerTx = null, isTest = false, transactionId = null, paymentProvider = null, subscriptionType = null, purchaseStatus = 'COMPLETED') {
  const plan = await prisma.vipPlan.findUnique({ where: { tier } });
  if (!plan) throw new Error('Plan not found');

  let vipTxId = null;

  const run = async (tx) => {
    if (source === 'coins' && !isTest) {
      await coinsService.debitCoins(userId, plan.priceCoins, 'VIP_PURCHASE', null, `Subscribe ${tier}`, tx);
    }

    const now = new Date();
    const durationDays = plan.durationDays || 30;
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const existing = await tx.userVip.findUnique({ where: { userId } });
    const newStatus = tier === 'NONE' ? 'NONE' : 'ACTIVE';
    if (existing) {
      await tx.userVip.update({
        where: { userId },
        data: {
          tier,
          status: newStatus,
          startedAt: now,
          expiresAt,
          autoRenew,
          renewSource: source,
          subscriptionType: subscriptionType,
          paymentProvider: paymentProvider,
          transactionId: transactionId,
          purchaseStatus: purchaseStatus,
          isTestSubscription: isTest,
        },
      });
    } else {
      await tx.userVip.create({
        data: {
          userId,
          tier,
          status: newStatus,
          startedAt: now,
          expiresAt,
          autoRenew,
          renewSource: source,
          subscriptionType: subscriptionType,
          paymentProvider: paymentProvider,
          transactionId: transactionId,
          purchaseStatus: purchaseStatus,
          isTestSubscription: isTest,
        },
      });
    }

    const vipTx = await tx.vipTransaction.create({
      data: {
        userId,
        fromTier: existing ? existing.tier : 'NONE',
        toTier: tier,
        coinsSpent: (source === 'coins' && !isTest) ? plan.priceCoins : null,
        egpSpent: (source === 'egp' && !isTest) ? plan.priceEGP : null,
        durationDays: plan.durationDays,
      },
    });
    vipTxId = vipTx.id;

    await vipRecalcService.recordVipSpendEvent(
      {
        userId,
        kind: 'SPEND',
        sourceType: 'VIP_PURCHASE',
        sourceId: vipTx.id,
        amount: source === 'coins' ? plan.priceCoins : 0,
        metadata: { tier, source, isTest },
      },
      tx,
    );

    const user = await tx.user.findUnique({ where: { id: userId } });
    if (user && ['USER', 'VIP', 'SVIP'].includes(user.role)) {
      const newRole = tier.startsWith('SVIP') || tier === 'TEST_SVIP' ? 'SVIP' : tier.startsWith('VIP') || tier === 'TEST_VIP' ? 'VIP' : 'USER';
      const data = { role: newRole };
      if (tier.startsWith('SVIP')) {
        data.svipLevel = Number(tier.replace('SVIP_', '')) || null;
      } else if (tier === 'TEST_SVIP') {
        data.svipLevel = 1; // Match SVIP_1 level
      } else if (tier.startsWith('VIP') || tier === 'TEST_VIP') {
        data.svipLevel = null;
        data.role = 'VIP';
      } else if (tier === 'VIP') {
        data.svipLevel = null;
        data.role = 'VIP';
      } else {
        data.svipLevel = null;
      }
      if (user.role !== newRole || user.svipLevel !== data.svipLevel) {
        await tx.user.update({ where: { id: userId }, data });
      }
    }

    if (plan.frameId) {
      await tx.userFrame.upsert({
        where: { userId_frameId: { userId, frameId: plan.frameId } },
        update: { isActive: true, purchasedAt: new Date() },
        create: { userId, frameId: plan.frameId, isActive: true },
      });
    }

    if (plan.entranceId) {
      await tx.userEntrance.upsert({
        where: { userId_entranceId: { userId, entranceId: plan.entranceId } },
        update: { isActive: true, purchasedAt: new Date() },
        create: { userId, entranceId: plan.entranceId, isActive: true },
      });
    }

    return { tier, expiresAt };
  };

  const result = outerTx ? await run(outerTx) : await prisma.$transaction(async (tx) => run(tx));

  await vipCacheService.invalidateVipStatus(userId);
  await emitVipStatusUpdate(userId);

  if (vipTxId) {
    try {
      await agentService.activateReferral(userId, 'VIP_PURCHASE');
      await agentService.calculateCommission(userId, 'VIP_PURCHASE', vipTxId, plan.priceCoins || 0);
    } catch (commissionErr) {
      console.warn('Agent commission or activation failed:', commissionErr.message);
    }
  }

  return result;
}

// Test subscription function
async function testSubscribeTier(userId, tier, autoRenew = false) {
  if (process.env.TEST_PREMIUM_MODE !== 'true') {
    throw new Error('Test mode is disabled');
  }
  const testTier = tier === 'SVIP' ? 'TEST_SVIP' : 'TEST_VIP';
  return await subscribeTier(userId, testTier, 'test', autoRenew, null, true);
}

async function getVipPrivileges(userId) {
  return await vipRecalcService.getCachedVipStatus(userId);
}

async function applyEarningBonus(userId, baseCoins) {
  const priv = await getVipPrivileges(userId);
  const bonus = priv.earningBonus || 1.0;
  const amount = Math.round(baseCoins * bonus);
  return amount;
}

async function emitVipStatusUpdate(userId) {
  try {
    const io = global.__io;
    if (!io) return;

    const ns = io.of('/room');
    const payload = { userId, updatedAt: new Date().toISOString() };

    // Emit to user's personal room
    ns.to(`user:${userId}`).emit('user-vip-status-updated', payload);

    const seats = await prisma.seat.findMany({
      where: { userId },
      select: { roomId: true },
    });
    
    for (const { roomId } of seats) {
      ns.to(roomId).emit('user-vip-status-updated', payload);
    }
  } catch (err) {
    console.warn('Failed to emit VIP status update', err.message);
  }
}

async function cancelSubscription(userId) {
  const existing = await prisma.userVip.findUnique({ where: { userId } });
  if (!existing || existing.tier === 'NONE') {
    throw new Error('No active subscription to cancel');
  }

  await prisma.userVip.update({ where: { userId }, data: { autoRenew: false } });
  await vipCacheService.invalidateVipStatus(userId);
  await emitVipStatusUpdate(userId);
  return { canceled: true };
}

/**
 * FIX M-09: purchaseFrame wrapped in a single transaction so coins debit
 * and inventory assignment are atomic.
 */
async function purchaseFrame(userId, frameId) {
  const frame = await prisma.frame.findUnique({ where: { id: frameId } });
  if (!frame || !frame.isActive) throw new Error('Frame not found');

  const userVip = await prisma.userVip.findUnique({ where: { userId } });
  const userTier = userVip ? userVip.tier : 'NONE';

  // Check tier requirement for free frames
  if ((!frame.coinPrice || frame.coinPrice === 0) && TIER_ORDER[userTier] < TIER_ORDER[frame.tier]) {
    const err = new Error('Frame requires higher tier');
    err.code = 'TIER_REQUIRED';
    throw err;
  }

  // FIX M-09: atomic debit + upsert
  const up = await prisma.$transaction(async (tx) => {
    if (frame.coinPrice && frame.coinPrice > 0) {
      await coinsService.debitCoins(userId, frame.coinPrice, 'FRAME_PURCHASE', null, `Purchase frame ${frame.name}`, tx, {
        userId,
        kind: 'SPEND',
        sourceType: 'FRAME_PURCHASE',
        amount: frame.coinPrice,
        metadata: { frameId },
      });
    }

    return tx.userFrame.upsert({
      where: { userId_frameId: { userId, frameId } },
      update: { isActive: false, purchasedAt: new Date() },
      create: { userId, frameId, isActive: false },
    });
  });

  const active = await prisma.userFrame.findFirst({ where: { userId, isActive: true } });
  if (!active) {
    await activateFrame(userId, frameId);
  }

  await vipCacheService.invalidateVipStatus(userId);
  return up;
}

async function activateFrame(userId, frameId) {
  const owned = await prisma.userFrame.findUnique({
    where: { userId_frameId: { userId, frameId } },
  });
  if (!owned) {
    const err = new Error('Frame not owned');
    err.code = 'NOT_OWNED';
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await tx.userFrame.updateMany({ where: { userId }, data: { isActive: false } });
    await tx.userFrame.update({ where: { userId_frameId: { userId, frameId } }, data: { isActive: true } });
  });
  await vipCacheService.invalidateVipStatus(userId);

  try {
    const io = global.__io;
    if (io) {
      const activeFrame = await prisma.userFrame.findFirst({
        where: { userId, isActive: true },
        include: { frame: true },
      });
      const seats = await prisma.seat.findMany({ where: { userId }, select: { roomId: true } });
      const payload = { userId, activeFrame: activeFrame?.frame || null };
      const ns = io.of('/room');
      for (const { roomId } of seats) {
        ns.to(roomId).emit('user-cosmetic-update', payload);
      }
    }
  } catch (emitErr) {
    console.warn('Failed to emit cosmetic update', emitErr.message);
  }
}

/**
 * FIX M-09: purchaseEntrance wrapped in a single transaction.
 */
async function purchaseEntrance(userId, entranceId) {
  const entrance = await prisma.entrance.findUnique({ where: { id: entranceId } });
  if (!entrance || !entrance.isActive) throw new Error('Entrance not found');

  const userVip = await prisma.userVip.findUnique({ where: { userId } });
  const userTier = userVip ? userVip.tier : 'NONE';

  // Check tier requirement for free entrances
  if ((!entrance.coinPrice || entrance.coinPrice === 0) && TIER_ORDER[userTier] < TIER_ORDER[entrance.tier]) {
    const err = new Error('Entrance requires higher tier');
    err.code = 'TIER_REQUIRED';
    throw err;
  }

  // FIX M-09: atomic debit + upsert
  const up = await prisma.$transaction(async (tx) => {
    if (entrance.coinPrice && entrance.coinPrice > 0) {
      await coinsService.debitCoins(userId, entrance.coinPrice, 'ENTRANCE_PURCHASE', null, `Purchase entrance ${entrance.name}`, tx, {
        userId,
        kind: 'SPEND',
        sourceType: 'ENTRANCE_PURCHASE',
        amount: entrance.coinPrice,
        metadata: { entranceId },
      });
    }

    return tx.userEntrance.upsert({
      where: { userId_entranceId: { userId, entranceId } },
      update: { isActive: false, purchasedAt: new Date() },
      create: { userId, entranceId, isActive: false },
    });
  });

  const active = await prisma.userEntrance.findFirst({ where: { userId, isActive: true } });
  if (!active) {
    await activateEntrance(userId, entranceId);
  }

  await vipCacheService.invalidateVipStatus(userId);
  return up;
}

async function activateEntrance(userId, entranceId) {
  const owned = await prisma.userEntrance.findUnique({
    where: { userId_entranceId: { userId, entranceId } },
  });
  if (!owned) {
    const err = new Error('Entrance not owned');
    err.code = 'NOT_OWNED';
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await tx.userEntrance.updateMany({ where: { userId }, data: { isActive: false } });
    await tx.userEntrance.update({ where: { userId_entranceId: { userId, entranceId } }, data: { isActive: true } });
  });
  await vipCacheService.invalidateVipStatus(userId);

  try {
    const io = global.__io;
    if (io) {
      const activeEntrance = await prisma.userEntrance.findFirst({
        where: { userId, isActive: true },
        include: { entrance: true },
      });
      const seats = await prisma.seat.findMany({ where: { userId }, select: { roomId: true } });
      const payload = { userId, activeEntrance: activeEntrance?.entrance || null };
      const ns = io.of('/room');
      for (const { roomId } of seats) {
        ns.to(roomId).emit('user-cosmetic-update', payload);
      }
    }
  } catch (emitErr) {
    console.warn('Failed to emit entrance cosmetic update', emitErr.message);
  }
}

async function setPrivacySettings(userId, { ghostMode, invisibleMode }) {
  const priv = await getVipPrivileges(userId);
  const tierDef = getTierDefinition(priv?.tier || 'NONE');
  if (!tierDef) throw new Error('VIP subscription required');

  const data = {};
  if (typeof ghostMode === 'boolean') {
    if (ghostMode && !tierDef.ghostMode) {
      const err = new Error('Ghost mode requires SVIP 5 or higher');
      err.code = 'TIER_REQUIRED';
      throw err;
    }
    data.ghostMode = ghostMode;
  }
  if (typeof invisibleMode === 'boolean') {
    if (invisibleMode && !tierDef.invisibleMode) {
      const err = new Error('Invisible mode requires SVIP 8 or higher');
      err.code = 'TIER_REQUIRED';
      throw err;
    }
    data.invisibleMode = invisibleMode;
  }

  if (!Object.keys(data).length) throw new Error('No privacy settings provided');

  await prisma.userVip.upsert({
    where: { userId },
    update: data,
    create: { userId, tier: normalizeTier(priv.tier), ...data },
  });

  await vipCacheService.invalidateVipStatus(userId);
  await emitVipStatusUpdate(userId);
  return { ghostMode: data.ghostMode, invisibleMode: data.invisibleMode };
}

async function getPrivacySettings(userId) {
  const [userVip, priv] = await Promise.all([
    prisma.userVip.findUnique({ where: { userId } }),
    getVipPrivileges(userId),
  ]);
  const tierDef = getTierDefinition(priv?.tier || 'NONE') || {};
  return {
    ghostMode: userVip?.ghostMode ?? false,
    invisibleMode: userVip?.invisibleMode ?? false,
    canGhost: Boolean(tierDef.ghostMode),
    canInvisible: Boolean(tierDef.invisibleMode),
    tier: priv?.tier || 'NONE',
  };
}

/**
 * FIX M-04: Handle SVIP roles on expiry, not just VIP.
 */
async function checkAndExpireVips() {
  const now = new Date();
  const expiring = await prisma.userVip.findMany({ where: { expiresAt: { lt: now }, tier: { not: 'NONE' } } });

  for (const uv of expiring) {
    try {
      if (uv.autoRenew && uv.renewSource === 'coins') {
        const plan = await prisma.vipPlan.findUnique({ where: { tier: uv.tier } });
        try {
          // FIX: wrap debit + expiry extension in a single transaction so a
          // crash between the two operations can't leave the user charged
          // without getting their subscription extended.
          await prisma.$transaction(async (tx) => {
            await coinsService.debitCoins(uv.userId, plan.priceCoins, 'VIP_RENEW', null, `Auto-renew ${uv.tier}`, tx);
            const newExpires = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
            await tx.userVip.update({ where: { userId: uv.userId }, data: { expiresAt: newExpires } });
            await tx.vipTransaction.create({ data: { userId: uv.userId, fromTier: uv.tier, toTier: uv.tier, coinsSpent: plan.priceCoins, durationDays: plan.durationDays } });
          });

          const notificationService = require('./notification.service');
          await notificationService.sendPushNotification(
            uv.userId, 'VIP_RENEWED',
            '✅ تم تجديد اشتراكك',
            `تم تجديد اشتراك ${uv.tier} تلقائياً لمدة 30 يوم`,
            { tier: uv.tier },
          ).catch(console.warn);
          continue;
        } catch (err) {
          console.warn('Auto-renew failed for user', uv.userId, err.message);
          // Fall through to expiry logic and notify the user
          const notificationService = require('./notification.service');
          await notificationService.sendPushNotification(
            uv.userId, 'VIP_RENEWAL_FAILED',
            '❌ فشل تجديد الاشتراك',
            'لم يتم تجديد اشتراك VIP تلقائياً بسبب عدم كفاية الرصيد.',
            { tier: uv.tier },
          ).catch(console.warn);
        }
      }

      await prisma.userVip.update({ where: { userId: uv.userId }, data: { tier: 'NONE', status: 'EXPIRED', expiresAt: null, autoRenew: false } });

      const user = await prisma.user.findUnique({ where: { id: uv.userId } });
      // FIX M-04: downgrade both VIP and SVIP roles
      if (user && ['VIP', 'SVIP'].includes(user.role)) {
        await prisma.user.update({ where: { id: uv.userId }, data: { role: 'USER', svipLevel: null } });
      }

      await vipCacheService.invalidateVipStatus(uv.userId);
      await emitVipStatusUpdate(uv.userId);

      try {
        const io = global.__io;
        if (io) {
          const ns = io.of('/room');
          // FIX: scope vip-expired to only the rooms the user is currently in,
          // not broadcast to ALL connected clients (user data leak + unnecessary traffic).
          const userSeats = await prisma.seat.findMany({
            where: { userId: uv.userId },
            select: { roomId: true },
          });
          const roomIds = [...new Set(userSeats.map((s) => s.roomId))];
          for (const roomId of roomIds) {
            ns.to(roomId).emit('vip-expired', { userId: uv.userId });
          }
          // Also notify the specific user's socket connections
          ns.to(`user:${uv.userId}`).emit('vip-expired', { userId: uv.userId });
        }
      } catch (err) {
        console.error('Failed to emit vip-expired', err);
      }

      const notificationService = require('./notification.service');
      await notificationService.sendPushNotification(
        uv.userId, 'VIP_EXPIRED',
        '⏰ انتهى اشتراكك',
        'انتهت صلاحية اشتراك VIP الخاص بك.',
        { tier: uv.tier },
      ).catch(console.warn);
    } catch (err) {
      console.error('Failed processing expiry for', uv.userId, err);
    }
  }
}

module.exports = {
  subscribeTier,
  testSubscribeTier,
  getVipPrivileges,
  applyEarningBonus,
  emitVipStatusUpdate,
  purchaseFrame,
  activateFrame,
  purchaseEntrance,
  activateEntrance,
  cancelSubscription,
  checkAndExpireVips,
  setPrivacySettings,
  getPrivacySettings,
};
