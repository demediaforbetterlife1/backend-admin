/**
 * Loyalty Decay Cron Job
 *
 * FIX H-06: Moved cron registration out of loyalty.service.js to prevent
 *           duplicate registrations when the module is imported multiple times.
 */

const cron = require('node-cron');
const loyaltyService = require('../services/loyalty.service');

// Run daily at midnight
cron.schedule('0 0 * * *', async () => {
  try {
    await loyaltyService.runDecayJob();
    console.log('[loyalty.cron] Decay job completed');
  } catch (error) {
    console.error('[loyalty.cron] Decay job failed:', error.message);
  }
});

console.log('[loyalty.cron] Scheduled daily decay job at 00:00');
