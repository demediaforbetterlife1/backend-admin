const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const loyaltyService = require('../services/loyalty.service');

router.get('/status', authenticate, async (req, res) => {
  try {
    const status = await loyaltyService.getUserStatus(req.user.id);
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/thresholds', async (req, res) => {
  try {
    res.json({
      success: true,
      data: loyaltyService.LEVEL_THRESHOLDS.map((xp, index) => ({
        level: index,
        xpThreshold: xp,
      })).filter((item) => item.level > 0),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/refresh', authenticate, async (req, res) => {
  try {
    const status = await loyaltyService.getUserStatus(req.user.id);
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
