/**
 * Notification Cleanup Cron Job
 *
 * FIX H-07: Moved cron registration out of notification.service.js to prevent
 *           duplicate registrations when the service is imported multiple times.
 */

const cron = require('node-cron');
const notificationService = require('../services/notification.service');

// Run weekly on Sunday at midnight
cron.schedule('0 0 * * 0', async () => {
  try {
    const result = await notificationService.deleteExpiredNotifications();
    console.log('[notification.cron] Cleanup completed, deleted:', result.count);
  } catch (err) {
    console.error('[notification.cron] Cleanup failed:', err.message);
  }
});

console.log('[notification.cron] Scheduled weekly notification cleanup at Sunday 00:00');
