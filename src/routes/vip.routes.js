const express = require('express');
const router = express.Router();
const vipService = require('../services/vip.service');
const loyaltyService = require('../services/loyalty.service');
const paymentService = require('../services/payment.service');
const dailyRewardService = require('../services/dailyReward.service');
const { authenticate } = require('../middleware/authMiddleware');
const { financialLimiter } = require('../middleware/rateLimit');
const prisma = require('../prismaClient');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');

// GET /vip/plans
router.get('/plans', asyncHandler(async (req, res) => {
  const plans = await prisma.vipPlan.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  sendSuccess(res, plans);
}));

// POST /vip/subscribe - Initiate VIP subscription (coins-based)
router.post('/subscribe', authenticate, financialLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { tier, autoRenew = false } = req.body;
  const result = await vipService.subscribeTier(userId, tier, 'coins', autoRenew);
  sendSuccess(res, result);
}));

// POST /vip/test-subscribe — free test subscription for development only.
//
// SECURITY FIX: previously this endpoint had no environment guard, meaning
// ANY authenticated user in ANY environment could activate free VIP.
//
// Now it requires DEV_FREE_SUBSCRIPTIONS=true in the environment (which
// env.js blocks from being set in staging/production). This matches the
// same pattern as ALLOW_IAP_STUB and ALLOW_SOCIAL_STUB.
router.post('/test-subscribe', authenticate, asyncHandler(async (req, res) => {
  if (process.env.DEV_FREE_SUBSCRIPTIONS !== 'true') {
    return sendError(res, 'Test subscriptions are disabled in this environment', 403, 'DEV_ONLY');
  }
  const userId = req.user.id;
  const { tier, autoRenew = false } = req.body;
  const result = await vipService.testSubscribeTier(userId, tier, autoRenew);
  sendSuccess(res, result, 200, 'Test subscription activated successfully');
}));

// POST /vip/subscribe-inapp - Subscribe to VIP via in-app purchase
router.post('/subscribe-inapp', authenticate, financialLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { tier, receipt, platform, autoRenew = false } = req.body;
  
  if (!receipt || !platform || !tier) {
    return sendError(res, 'receipt, platform, and tier are required', 400);
  }

  const order = await paymentService.handleInAppReceipt(
    userId,
    receipt,
    platform,
    'VIP_SUBSCRIPTION',
    tier,
    autoRenew,
  );

  sendSuccess(res, order);
}));

// POST /vip/cancel
router.post('/cancel', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const result = await vipService.cancelSubscription(userId);
  sendSuccess(res, result);
}));

// GET /vip/daily-reward
router.get('/daily-reward', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const data = await dailyRewardService.getDailyRewardStatus(userId);
  sendSuccess(res, data);
}));

// POST /vip/daily-reward/claim
router.post('/daily-reward/claim', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const data = await dailyRewardService.claimDailyReward(userId);
  sendSuccess(res, data);
}));

// GET /vip/status
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const [privileges, loyaltyStatus] = await Promise.all([
    vipService.getVipPrivileges(userId),
    loyaltyService.getUserStatus(userId),
  ]);

  sendSuccess(res, {
    ...privileges,
    ...loyaltyStatus,
  });
}));

// GET /vip/frames
router.get('/frames', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const frames = await prisma.frame.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    const owned = await prisma.userFrame.findMany({ where: { userId } });
    const ownedSet = new Set(owned.map(o => o.frameId));
    const active = owned.find(o => o.isActive);
    const list = frames.map(f => ({ ...f, isOwned: ownedSet.has(f.id), isActive: active && active.frameId === f.id }));
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /vip/frames/:id/purchase
router.post('/frames/:id/purchase', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const frameId = req.params.id;
    const up = await vipService.purchaseFrame(userId, frameId);
    res.json({ success: true, data: up });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /vip/frames/:id/activate
router.post('/frames/:id/activate', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const frameId = req.params.id;
    await vipService.activateFrame(userId, frameId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /vip/entrances
router.get('/entrances', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const entrances = await prisma.entrance.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    const owned = await prisma.userEntrance.findMany({ where: { userId } });
    const ownedSet = new Set(owned.map(o => o.entranceId));
    const active = owned.find(o => o.isActive);
    const list = entrances.map(e => ({ ...e, isOwned: ownedSet.has(e.id), isActive: active && active.entranceId === e.id }));
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /vip/entrances/:id/purchase
router.post('/entrances/:id/purchase', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const entranceId = req.params.id;
    const up = await vipService.purchaseEntrance(userId, entranceId);
    res.json({ success: true, data: up });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /vip/entrances/:id/activate
router.post('/entrances/:id/activate', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const entranceId = req.params.id;
    await vipService.activateEntrance(userId, entranceId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /vip/privacy — ghost & invisible mode settings
router.get('/privacy', authenticate, async (req, res) => {
  try {
    const data = await vipService.getPrivacySettings(req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /vip/privacy — toggle ghost/invisible (SVIP gated)
router.patch('/privacy', authenticate, async (req, res) => {
  try {
    const data = await vipService.setPrivacySettings(req.user.id, req.body);
    res.json({ success: true, data });
  } catch (err) {
    const status = err.code === 'TIER_REQUIRED' ? 403 : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code });
  }
});

module.exports = router;
