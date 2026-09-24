const prisma = require('../prismaClient');
const coinsService = require('./coins.service');
const vipService = require('./vip.service');
const giftsService = require('./gifts.service');
const { TIER_ORDER, normalizeTier } = require('../config/premium.tiers');

async function getShopCatalog(userId) {
  const [plans, frames, entrances, gifts, bundles, coinPackages, vipStatus] = await Promise.all([
    prisma.vipPlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.frame.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.entrance.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.gift.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.shopBundle.findMany({
      where: {
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.coinPackage.findMany({ where: { isActive: true }, orderBy: { coins: 'asc' } }),
    vipService.getVipPrivileges(userId),
  ]);

  const userTier = normalizeTier(vipStatus?.tier || 'NONE');
  const userTierOrder = TIER_ORDER[userTier] || 0;

  const [ownedFrames, ownedEntrances] = await Promise.all([
    prisma.userFrame.findMany({ where: { userId }, select: { frameId: true, isActive: true } }),
    prisma.userEntrance.findMany({ where: { userId }, select: { entranceId: true, isActive: true } }),
  ]);
  const ownedFrameIds = new Set(ownedFrames.map((f) => f.frameId));
  const ownedEntranceIds = new Set(ownedEntrances.map((e) => e.entranceId));
  const activeFrameId = ownedFrames.find((f) => f.isActive)?.frameId;
  const activeEntranceId = ownedEntrances.find((e) => e.isActive)?.entranceId;

  const mapFrame = (f) => ({
    ...f,
    itemType: 'frame',
    isOwned: ownedFrameIds.has(f.id),
    isActive: activeFrameId === f.id,
    locked: (TIER_ORDER[f.tier] || 0) > userTierOrder && f.coinPrice === 0,
  });

  const mapEntrance = (e) => ({
    ...e,
    itemType: 'entrance',
    isOwned: ownedEntranceIds.has(e.id),
    isActive: activeEntranceId === e.id,
    locked: (TIER_ORDER[e.tier] || 0) > userTierOrder && e.coinPrice === 0,
  });

  const mapGift = (g) => ({
    ...g,
    itemType: 'gift',
    locked: g.isVipOnly && userTierOrder < (TIER_ORDER.VIP_1 || 1),
  });

  return {
    featured: {
      bundles: bundles.filter((b) => b.isFeatured),
      limited: [...frames, ...entrances].filter((i) => i.isLimited),
    },
    categories: {
      vip: plans,
      frames: frames.map(mapFrame),
      entrances: entrances.map(mapEntrance),
      gifts: gifts.map(mapGift),
      bundles,
      coins: coinPackages,
    },
    userTier,
    balance: vipStatus?.coinBalance ?? 0,
  };
}

async function purchaseBundle(userId, bundleId) {
  const bundle = await prisma.shopBundle.findUnique({ where: { id: bundleId } });
  if (!bundle || !bundle.isActive) throw new Error('Bundle not found');
  if (bundle.expiresAt && bundle.expiresAt < new Date()) throw new Error('Bundle expired');

  return prisma.$transaction(async (tx) => {
    await coinsService.debitCoins(
      userId,
      bundle.coinPrice,
      'SHOP_PURCHASE',
      bundleId,
      `Bundle: ${bundle.name}`,
      tx,
    );

    const purchase = await tx.shopPurchase.create({
      data: {
        userId,
        bundleId,
        itemType: 'bundle',
        itemId: bundleId,
        coinsSpent: bundle.coinPrice,
        metadata: bundle.items,
      },
    });

    const items = Array.isArray(bundle.items) ? bundle.items : [];
    for (const item of items) {
      if (item.type === 'frame' && item.id) {
        await tx.userFrame.upsert({
          where: { userId_frameId: { userId, frameId: item.id } },
          update: {},
          create: { userId, frameId: item.id },
        });
      }
      if (item.type === 'entrance' && item.id) {
        await tx.userEntrance.upsert({
          where: { userId_entranceId: { userId, entranceId: item.id } },
          update: {},
          create: { userId, entranceId: item.id },
        });
      }
      if (item.type === 'coins' && item.amount) {
        await coinsService.creditCoins(userId, item.amount, 'BONUS', purchase.id, 'Bundle bonus coins', tx);
      }
    }

    return purchase;
  });
}

async function getUserInventory(userId) {
  const [frames, entrances, vipStatus] = await Promise.all([
    prisma.userFrame.findMany({
      where: { userId },
      include: { frame: true },
      orderBy: { purchasedAt: 'desc' },
    }),
    prisma.userEntrance.findMany({
      where: { userId },
      include: { entrance: true },
      orderBy: { purchasedAt: 'desc' },
    }),
    vipService.getVipPrivileges(userId),
  ]);

  return {
    tier: vipStatus?.tier || 'NONE',
    frames: frames.map((uf) => ({ ...uf.frame, isOwned: true, isActive: uf.isActive, purchasedAt: uf.purchasedAt })),
    entrances: entrances.map((ue) => ({ ...ue.entrance, isOwned: true, isActive: ue.isActive, purchasedAt: ue.purchasedAt })),
    activeFrame: frames.find((f) => f.isActive)?.frame || null,
    activeEntrance: entrances.find((e) => e.isActive)?.entrance || null,
  };
}

module.exports = { getShopCatalog, purchaseBundle, getUserInventory };
