/**
 * VIP Recalculation Service
 *
 * FIX C-03: Removed ensureVipStorage() — DDL inside transactions breaks
 *           PostgreSQL atomicity. VipSpendLedger table is managed by Prisma migrations.
 * FIX C-05: buildVipSnapshot now always includes userId in the returned object.
 * FIX H-04: getSubscriptionTier invalidates cache immediately on expiry detection.
 * FIX M-05: recalculateRecentUsers processes in parallel batches of 50.
 * FIX L-04: ensureRedis() called once at startup, not on every cache operation.
 */

const prisma = require('../prismaClient');
const vipCacheService = require('./vip.cache.service');
const { TIER_DEFINITIONS, getTierFromSpend, chooseEffectiveTier, normalizeTier } = require('../config/vip.attributes');
const { getTierDefinition } = require('../config/premium.tiers');

const DEFAULT_SNAPSHOT = {
  tier: 'NONE',
  earningBonus: 1,
  maxRooms: 1,
  canRecord: false,
  canGoPrivate: false,
  seatPriority: false,
  antiKickLevel: 0,
  supportLevel: 'BASIC',
  features: [],
  activeFrame: null,
  activeEntrance: null,
  expiresAt: null,
  autoRenew: false,
  spend: 0,
  recharge: 0,
  cacheVersion: 1,
  lastUpdated: null,
  role: 'USER',
  svipLevel: null,
};

// FIX L-04: Redis is initialized once at startup via initializeRedisOnce()
let redisInitialized = false;

async function ensureRedis() {
  if (redisInitialized) return;
  if (process.env.REDIS_URL) {
    await vipCacheService.initializeRedis();
    redisInitialized = true;
  }
}

// Called once from index.js at startup
async function initializeRedisOnce() {
  await ensureRedis();
}

async function getLegacyMetrics(userId, tx = prisma) {
  const wallet = await tx.userWallet.findUnique({ where: { userId } });
  return {
    spend: wallet?.totalSpent ?? 0,
    recharge: wallet?.totalEarned ?? 0,
  };
}

async function getSpendMetrics(userId, tx = prisma) {
  // FIX C-03: No ensureVipStorage() call — table exists via Prisma migration
  // FIX: Use prisma directly if tx might be expired to avoid transaction errors
  const client = tx === prisma ? prisma : prisma;
  
  const ledgerRows = await client.vipSpendLedger.findMany({
    where: { userId },
    select: { amount: true, kind: true },
  });

  if (!ledgerRows.length) {
    return getLegacyMetrics(userId, client);
  }

  const spend = ledgerRows
    .filter((row) => row.kind === 'SPEND')
    .reduce((sum, row) => sum + row.amount, 0);
  const recharge = ledgerRows
    .filter((row) => row.kind === 'RECHARGE')
    .reduce((sum, row) => sum + row.amount, 0);

  return { spend, recharge };
}

/**
 * FIX H-04: Invalidate cache immediately when expiry is detected,
 *           so stale VIP status is not served for up to 1 hour.
 */
async function getSubscriptionTier(userId, tx = prisma) {
  // FIX: Use prisma directly if tx might be expired to avoid transaction errors
  const client = tx === prisma ? prisma : prisma;
  
  const userVip = await client.userVip.findUnique({ where: { userId } });
  if (!userVip || !userVip.tier || userVip.tier === 'NONE') return 'NONE';
  if (userVip.expiresAt && userVip.expiresAt <= new Date()) {
    // FIX H-04: invalidate cache immediately on expiry detection
    await vipCacheService.invalidateVipStatus(userId);
    return 'NONE';
  }
  return userVip.tier;
}

async function getFeatureMetadata(tier, tx = prisma) {
  const normalizedTier = normalizeTier(tier);

  if (TIER_DEFINITIONS[normalizedTier]) {
    return TIER_DEFINITIONS[normalizedTier];
  }

  const plan = await tx.vipPlan.findUnique({ where: { tier: normalizedTier } });
  if (!plan) return null;

  return {
    tier: normalizedTier,
    displayName: plan.nameAr,
    minSpend: 0,
    earningBonus: plan.earningBonus,
    maxRooms: plan.maxRooms,
    canRecord: plan.canRecord,
    canGoPrivate: plan.canGoPrivate,
    seatPriority: plan.seatPriority,
    antiKickLevel: plan.maxRooms >= 5 ? 4 : plan.maxRooms >= 4 ? 3 : 2,
    supportLevel: plan.maxRooms >= 5 ? 'DEDICATED' : plan.maxRooms >= 4 ? 'VIP_SUPPORT' : 'PRIORITY',
    features: plan.features,
  };
}

/**
 * FIX C-05: Always include userId in the returned snapshot object.
 */
async function buildVipSnapshot(userId, tx = prisma) {
  const [metrics, subscriptionTier] = await Promise.all([
    getSpendMetrics(userId, tx),
    getSubscriptionTier(userId, tx),
  ]);

  const spendTier = getTierFromSpend(metrics.spend);
  const effectiveTier = chooseEffectiveTier(subscriptionTier, spendTier);
  const metadata = (await getFeatureMetadata(effectiveTier, tx)) || DEFAULT_SNAPSHOT;

  const [activeFrame, activeEntrance, userVip] = await Promise.all([
    tx.userFrame.findFirst({ where: { userId, isActive: true }, include: { frame: true } }),
    tx.userEntrance.findFirst({ where: { userId, isActive: true }, include: { entrance: true } }),
    tx.userVip.findUnique({ where: { userId } }),
  ]);

  // FIX C-05: userId is always set in the snapshot
  const tierDef = getTierDefinition(effectiveTier) || {};
  return {
    userId,  // always present
    ...DEFAULT_SNAPSHOT,
    ...metadata,
    tier: effectiveTier,
    earningBonus: metadata.earningBonus ?? DEFAULT_SNAPSHOT.earningBonus,
    maxRooms: metadata.maxRooms ?? DEFAULT_SNAPSHOT.maxRooms,
    canRecord: metadata.canRecord ?? DEFAULT_SNAPSHOT.canRecord,
    canGoPrivate: metadata.canGoPrivate ?? DEFAULT_SNAPSHOT.canGoPrivate,
    seatPriority: metadata.seatPriority ?? DEFAULT_SNAPSHOT.seatPriority,
    antiKickLevel: metadata.antiKickLevel ?? DEFAULT_SNAPSHOT.antiKickLevel,
    supportLevel: metadata.supportLevel ?? DEFAULT_SNAPSHOT.supportLevel,
    features: metadata.features ?? DEFAULT_SNAPSHOT.features,
    nicknameColor: tierDef.nicknameColor || metadata.nicknameColor || null,
    ghostMode: userVip?.ghostMode ?? false,
    invisibleMode: userVip?.invisibleMode ?? false,
    canGhost: Boolean(tierDef.ghostMode),
    canInvisible: Boolean(tierDef.invisibleMode),
    activeFrame: activeFrame?.frame ?? null,
    activeEntrance: activeEntrance?.entrance ?? null,
    expiresAt: userVip?.expiresAt ?? null,
    autoRenew: userVip?.autoRenew ?? false,
    spend: metrics.spend,
    recharge: metrics.recharge,
    cacheVersion: 1,
    lastUpdated: new Date().toISOString(),
    role: effectiveTier === 'NONE' ? 'USER' : effectiveTier.startsWith('SVIP') ? 'SVIP' : 'VIP',
    svipLevel: effectiveTier.startsWith('SVIP') ? Number(effectiveTier.replace('SVIP_', '')) : null,
  };
}

async function persistVipStatus(snapshot, tx = prisma) {
  // FIX C-05: snapshot.userId is always set by buildVipSnapshot
  if (!snapshot.userId) {
    console.error('[vip.recalc] persistVipStatus called with snapshot missing userId — skipping');
    return snapshot;
  }

  const role = snapshot.role || (snapshot.tier === 'NONE' ? 'USER' : snapshot.tier.startsWith('SVIP') ? 'SVIP' : 'VIP');
  const svipLevel = snapshot.tier.startsWith('SVIP') ? Number(snapshot.tier.replace('SVIP_', '')) : null;

  await tx.user.update({
    where: { id: snapshot.userId },
    data: { role, svipLevel },
  });

  return snapshot;
}

async function recordVipSpendEvent(event, tx = prisma) {
  // FIX C-03: No ensureVipStorage() call
  const { userId, kind, sourceType, sourceId, amount, metadata } = event;
  if (!userId || !kind || !amount || amount <= 0) return null;

  // FIX: Use prisma directly if tx might be expired to avoid transaction errors
  const client = tx === prisma ? prisma : prisma;
  
  const transaction = await client.vipSpendLedger.create({
    data: {
      userId,
      kind,
      sourceType,
      sourceId: sourceId || null,
      amount,
      metadata: metadata || {},
    },
  });

  // FIX: Don't build snapshot during transaction to avoid timeout issues
  // The snapshot will be rebuilt on next cache refresh
  return transaction;
  return snapshot;
}

async function refreshVipCache(userId, snapshot) {
  await vipCacheService.setVipStatus(userId, snapshot);
  return snapshot;
}

async function getCachedVipStatus(userId) {
  const cached = await vipCacheService.getVipStatus(userId);
  if (cached) return cached;
  return recalculateVipStatus(userId);
}

async function recalculateVipStatus(userId, tx = prisma) {
  const snapshot = await buildVipSnapshot(userId, tx);
  // FIX C-05: userId already in snapshot
  await persistVipStatus(snapshot, tx);
  await refreshVipCache(userId, snapshot);
  return snapshot;
}

/**
 * FIX M-05: Process in parallel batches of 50 instead of sequential loop.
 */
async function recalculateRecentUsers() {
  // FIX C-03: No ensureVipStorage() call
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const ledgerRows = await prisma.vipSpendLedger.findMany({
    where: { createdAt: { gte: since } },
    select: { userId: true },
    distinct: ['userId'],
  });

  const BATCH = 50;
  for (let i = 0; i < ledgerRows.length; i += BATCH) {
    await Promise.all(
      ledgerRows.slice(i, i + BATCH).map((row) =>
        recalculateVipStatus(row.userId).catch((err) =>
          console.error('[vip.recalc] Failed recalculation for user', row.userId, err.message)
        )
      )
    );
  }
}

module.exports = {
  ensureRedis,
  initializeRedisOnce,
  getLegacyMetrics,
  getSpendMetrics,
  buildVipSnapshot,
  persistVipStatus,
  recordVipSpendEvent,
  recalculateVipStatus,
  refreshVipCache,
  getCachedVipStatus,
  recalculateRecentUsers,
};
