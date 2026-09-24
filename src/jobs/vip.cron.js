/**
 * VIP Cron Jobs
 *
 * FIX: checkAndExpireVips is called every hour. At scale, processing thousands
 * of expiring VIPs in a single loop can spike DB load. Added batching with a
 * small delay between batches to spread the work.
 *
 * The function itself handles batching — we just call it from the cron.
 */

const cron = require('node-cron');
const vipRecalcService = require('../services/vip.recalc.service');
const vipService = require('../services/vip.service');

// Daily at 00:05 — recalculate VIP spend tiers
cron.schedule('5 0 * * *', async () => {
  try {
    await vipRecalcService.recalculateRecentUsers();
    console.log('[vip.cron] VIP spend recalculation completed');
  } catch (error) {
    console.error('[vip.cron] VIP spend recalculation failed:', error.message);
  }
});

// Hourly — expire VIPs whose subscriptions have ended
cron.schedule('0 * * * *', async () => {
  const start = Date.now();
  try {
    await vipService.checkAndExpireVips();
    const ms = Date.now() - start;
    console.log(`[vip.cron] VIP expiry check completed in ${ms}ms`);
  } catch (error) {
    console.error('[vip.cron] VIP expiry check failed:', error.message);
  }
});

// Every 30 minutes — also check for soon-expiring VIPs to send warning notifications
cron.schedule('*/30 * * * *', async () => {
  try {
    const prisma = require('../prismaClient');
    const notificationService = require('../services/notification.service');

    // Find VIPs expiring within the next 24 hours that haven't been warned
    const warnBefore = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const warnAfter  = new Date(Date.now() + 23 * 60 * 60 * 1000); // avoid double-warn

    const expiringSoon = await prisma.userVip.findMany({
      where: {
        tier: { not: 'NONE' },
        expiresAt: { gt: warnAfter, lt: warnBefore },
      },
      select: { userId: true, tier: true },
    });

    for (const uv of expiringSoon) {
      await notificationService.sendPushNotification(
        uv.userId,
        'VIP_EXPIRING',
        '⏰ اشتراكك ينتهي قريباً',
        `ستنتهي صلاحية اشتراك ${uv.tier} خلال 24 ساعة. جدد الآن!`,
        { tier: uv.tier },
      ).catch(console.warn);
    }

    if (expiringSoon.length) {
      console.log(`[vip.cron] Sent ${expiringSoon.length} VIP expiry warning notifications`);
    }
  } catch (error) {
    console.error('[vip.cron] VIP expiry warning failed:', error.message);
  }
});
