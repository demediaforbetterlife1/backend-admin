const cron = require('node-cron');
const agentService = require('../services/agent.service');

cron.schedule('0 1 * * *', async () => {
  try {
    await agentService.checkInactiveReferrals();
    console.log('[agent.cron] Inactive referrals checked');
  } catch (err) {
    console.error('[agent.cron] checkInactiveReferrals failed:', err);
  }
});

cron.schedule('0 0 1 * *', async () => {
  try {
    await agentService.resetMonthlyEarnings();
    console.log('[agent.cron] Monthly agent earnings reset');
  } catch (err) {
    console.error('[agent.cron] resetMonthlyEarnings failed:', err);
  }
});
