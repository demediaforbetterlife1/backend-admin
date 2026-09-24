const prisma = require('../prismaClient');
const inappService = require('./inapp.purchase.service');

async function initiatePayment(userId, type, itemId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  let amountEGP;
  let amountCents;

  if (type === 'COIN_PURCHASE') {
    const pkg = await prisma.coinPackage.findUnique({ where: { id: itemId } });
    if (!pkg) throw new Error('Coin package not found');
    amountEGP = pkg.priceEGP;
    amountCents = Math.round(amountEGP * 100);
  } else if (type === 'VIP_SUBSCRIPTION') {
    const plan = await prisma.vipPlan.findUnique({ where: { tier: itemId } });
    if (!plan) throw new Error('VIP plan not found');
    amountEGP = plan.priceEGP;
    amountCents = Math.round(amountEGP * 100);
  } else {
    throw new Error('Invalid payment type');
  }

  return {
    type,
    itemId,
    amountEGP,
    amountCents,
    currency: 'EGP',
    message: 'Use in-app purchase on your device to complete payment',
  };
}

async function getOrderStatus(orderId, userId) {
  const order = await prisma.paymentOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('Order not found');
  if (order.userId !== userId) throw new Error('Not authorized');
  return order;
}

async function getUserOrders(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.paymentOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    }),
    prisma.paymentOrder.count({ where: { userId } }),
  ]);

  return { rows, total, page, limit };
}

async function handleInAppReceipt(userId, receipt, platform, type, itemId, autoRenew = false) {
  try {
    const order = await inappService.processReceiptAndFulfill(userId, receipt, platform, type, itemId, autoRenew);

    const notificationService = require('./notification.service');
    await notificationService.sendPushNotification(
      userId,
      'SYSTEM',
      '✅ تم الدفع بنجاح',
      'تم تفعيل دفعتك بنجاح، وتم تحديث رصيدك أو اشتراكك.',
      { orderId: order.id },
    ).catch((err) => console.warn('Notification failed:', err.message));

    if (order.type === 'COIN_PURCHASE') {
      try {
        const agentService = require('./agent.service');
        // FIX: commission must be calculated on the COINS credited to the user,
        // not on amountCents (EGP × 100). Previously passing amountCents (e.g. 1000
        // for a 10 EGP package) meant the commission base was 25× too high if the
        // package gives 40 coins, or 100× too low if it gives 4000 coins.
        // We look up the package to get the actual coins amount.
        const coinsService = require('./coins.service');
        const packages = await coinsService.getPackages();
        const pkg = packages.find((p) => p.id === order.itemId);
        const baseCoins = pkg ? pkg.coins + (pkg.bonusCoins || 0) : 0;
        if (baseCoins > 0) {
          await agentService.calculateCommission(userId, 'COIN_PURCHASE', order.id, baseCoins);
        }
      } catch (commissionErr) {
        console.warn('Agent commission failed:', commissionErr.message);
      }
    }

    return order;
  } catch (err) {
    const notificationService = require('./notification.service');
    await notificationService.sendPushNotification(
      userId,
      'SYSTEM',
      '❌ فشل الدفع',
      err.message || 'حدث خطأ أثناء معالجة الدفع.',
      { error: err.message },
    ).catch((error) => console.warn('Notification failed:', error.message));

    throw err;
  }
}

module.exports = {
  initiatePayment,
  getOrderStatus,
  getUserOrders,
  handleInAppReceipt,
};
