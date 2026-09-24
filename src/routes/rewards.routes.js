const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const dailyRewardService = require('../services/dailyReward.service');
const loginRewardService = require('../services/loginReward.service');
const loyaltyService = require('../services/loyalty.service');

const router = express.Router();

router.get('/daily', authenticate, async (req, res) => {
  try {
    const [vipDaily, loginDaily, loyalty] = await Promise.all([
      dailyRewardService.getDailyRewardStatus(req.user.id),
      loginRewardService.getLoginRewardStatus(req.user.id),
      loyaltyService.getUserStatus(req.user.id),
    ]);
    res.json({
      success: true,
      data: { vipDaily, loginDaily, loyalty },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/daily/vip/claim', authenticate, async (req, res) => {
  try {
    const data = await dailyRewardService.claimDailyReward(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    const status = error.code === 'ALREADY_CLAIMED' ? 400 : 500;
    res.status(status).json({ success: false, error: error.message, code: error.code });
  }
});

router.post('/daily/login/claim', authenticate, async (req, res) => {
  try {
    const data = await loginRewardService.claimLoginReward(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    const status = error.code === 'ALREADY_CLAIMED' ? 400 : 500;
    res.status(status).json({ success: false, error: error.message, code: error.code });
  }
});

module.exports = router;
