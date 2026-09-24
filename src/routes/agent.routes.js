const express = require('express');
const agentService = require('../services/agent.service');
const walletService = require('../services/wallet.service');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /agent/profile
router.get('/profile', authenticate, requireRole('AGENT'), async (req, res) => {
  try {
    const stats = await agentService.getAgentStats(req.user.id);
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// GET /agent/referrals?page=1&limit=20
router.get('/referrals', authenticate, requireRole('AGENT'), async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const profile = await agentService.getAgentById((await agentService.getAgentStats(req.user.id)).profile.id);
    const data = await agentService.getAgentReferrals(profile.id, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /agent/commissions?page=1&limit=20&sourceType=GIFT_SENT
router.get('/commissions', authenticate, requireRole('AGENT'), async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const sourceType = req.query.sourceType || null;
    const profile = await agentService.getAgentById((await agentService.getAgentStats(req.user.id)).profile.id);
    const data = await agentService.getAgentCommissions(profile.id, page, limit, sourceType);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /agent/leaderboard?period=monthly|alltime
router.get('/leaderboard', async (req, res) => {
  try {
    const period = req.query.period === 'alltime' ? 'alltime' : 'monthly';
    const data = await agentService.getLeaderboard(period, 20);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /agent/share-link
router.get('/share-link', authenticate, requireRole('AGENT'), async (req, res) => {
  try {
    const data = await agentService.getShareLink(req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// POST /agent/withdraw
router.post('/withdraw', authenticate, requireRole('AGENT'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { coinsAmount, method, accountInfo } = req.body;
    if (!coinsAmount || !method) {
      return res.status(400).json({ success: false, error: 'coinsAmount and method are required' });
    }

    const request = await walletService.requestWithdrawal(userId, Number(coinsAmount), method, accountInfo || {});
    res.status(201).json({ success: true, data: request });
  } catch (err) {
    if (err.code === 'MIN_WITHDRAWAL' || err.code === 'PENDING_WITHDRAWAL') {
      return res.status(400).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
