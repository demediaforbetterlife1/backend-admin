/**
 * Coins Service
 *
 * FIX M-08: purchaseCoins no longer wraps in a nested tx.$transaction() when
 *           an outer transaction client is passed in. This prevents Prisma
 *           nested interactive transaction errors.
 */

const prisma = require('../prismaClient');

async function creditCoins(userId, amount, type = 'PURCHASE', referenceId = null, description = null, tx = prisma, vipSpendEvent = null) {
  if (amount <= 0) throw new Error('Amount must be positive');

  // FIX: use upsert instead of findUnique + create to eliminate the race
  // condition where two concurrent requests both see no wallet and both try
  // to create one, causing a unique constraint violation.
  const wallet = await tx.userWallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  const newBalance = wallet.coinBalance + amount;
  await tx.userWallet.update({
    where: { userId },
    data: { coinBalance: newBalance, totalEarned: wallet.totalEarned + amount },
  });

  const coinTx = await tx.coinTransaction.create({
    data: {
      userId,
      type,
      amount,
      balanceAfter: newBalance,
      referenceId,
      description,
    },
  });

  if (vipSpendEvent) {
    const vipRecalcService = require('./vip.recalc.service');
    await vipRecalcService.recordVipSpendEvent(vipSpendEvent, tx);
  }

  return coinTx;
}

/**
 * FIX M-08: When an outer tx is provided, use it directly instead of
 * wrapping in a nested tx.$transaction() call (which Prisma does not support).
 */
async function purchaseCoins(userId, packageId, orderId = null, tx = prisma) {
  const execute = async (client) => {
    const pkg = await client.coinPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) throw new Error('Package not found');

    // Idempotency: skip if already credited for this order
    const existing = orderId
      ? await client.coinTransaction.findFirst({
          where: { userId, referenceId: orderId, type: 'PURCHASE' },
        })
      : null;
    if (existing) return existing;

    const totalCoins = pkg.coins + (pkg.bonusCoins || 0);
    return creditCoins(
      userId,
      totalCoins,
      'PURCHASE',
      orderId || packageId,
      `Purchased ${pkg.name}`,
      client,
      {
        userId,
        kind: 'RECHARGE',
        sourceType: 'COIN_PURCHASE',
        sourceId: orderId || packageId,
        amount: totalCoins,
        metadata: { packageId, orderId },
      },
    );
  };

  // FIX M-08: if a transaction client was passed in, use it directly
  if (tx !== prisma) {
    return execute(tx);
  }

  // Otherwise start a new transaction
  return prisma.$transaction(execute);
}

async function debitCoins(userId, amount, type = 'GIFT_SENT', referenceId = null, description = null, tx = prisma, vipSpendEvent = null) {
  if (amount <= 0) throw new Error('Amount must be positive');

  // Get current wallet first (outside the main transaction to reduce time)
  const wallet = await tx.userWallet.findUnique({ where: { userId } });
  
  if (!wallet || wallet.coinBalance < amount) {
    const err = new Error('Insufficient balance');
    err.code = 'INSUFFICIENT_FUNDS';
    throw err;
  }

  const newBalance = wallet.coinBalance - amount;

  // Update wallet balance
  await tx.userWallet.update({
    where: { userId },
    data: {
      coinBalance: newBalance,
      totalSpent: { increment: amount },
    },
  });

  // Create transaction record
  const coinTx = await tx.coinTransaction.create({
    data: {
      userId,
      type,
      amount: -amount,
      balanceAfter: newBalance,
      referenceId,
      description,
    },
  });

  if (vipSpendEvent) {
    const vipRecalcService = require('./vip.recalc.service');
    await vipRecalcService.recordVipSpendEvent(vipSpendEvent, tx);
  }

  return coinTx;
}

const COIN_RATE = { coinsPerUSD: 100 };

async function getPackages() {
  return prisma.coinPackage.findMany({
    where: { isActive: true },
    orderBy: { priceEGP: 'asc' },
  });
}

async function getBalance(userId) {
  // FIX: upsert instead of findUnique + create
  const wallet = await prisma.userWallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  return wallet;
}

async function getTransactions(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.coinTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.coinTransaction.count({ where: { userId } }),
  ]);
  return { rows, total, page, limit };
}

module.exports = {
  creditCoins,
  debitCoins,
  purchaseCoins,
  getPackages,
  getBalance,
  getTransactions,
  COIN_RATE,
};
