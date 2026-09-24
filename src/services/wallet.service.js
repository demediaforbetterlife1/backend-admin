const prisma = require('../prismaClient');
const coinsService = require('./coins.service');

const MIN_WITHDRAWAL = 1000;

async function getWallet(userId) {
  // FIX: use upsert to prevent race condition between findUnique + create.
  // A concurrent request between the two calls could try to create the wallet
  // twice, causing a unique constraint violation crash.
  const wallet = await prisma.userWallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  const pending = await prisma.withdrawalRequest.findMany({ where: { userId, status: 'PENDING' } });
  return { wallet, pendingWithdrawal: pending.length > 0 };
}

async function requestWithdrawal(userId, coinsAmount, method, accountInfo) {
  if (coinsAmount < MIN_WITHDRAWAL) {
    const err = new Error('Minimum withdrawal not met');
    err.code = 'MIN_WITHDRAWAL';
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.withdrawalRequest.findFirst({ where: { userId, status: 'PENDING' } });
    if (existing) {
      const err = new Error('Pending withdrawal exists');
      err.code = 'PENDING_WITHDRAWAL';
      throw err;
    }

    await coinsService.debitCoins(
      userId,
      coinsAmount,
      'WITHDRAWAL',
      null,
      `Withdrawal requested: ${coinsAmount}`,
      tx,
    );

    const usdAmount = coinsAmount / coinsService.COIN_RATE.coinsPerUSD;

    return tx.withdrawalRequest.create({
      data: {
        userId,
        coinsAmount,
        usdAmount,
        method,
        accountInfo,
        status: 'PENDING',
      },
    });
  });
}

async function getWithdrawals(userId) {
  return prisma.withdrawalRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
}

module.exports = { getWallet, requestWithdrawal, getWithdrawals, MIN_WITHDRAWAL };
