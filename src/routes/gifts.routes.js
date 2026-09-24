const express = require('express');
const router = express.Router();
const giftsService = require('../services/gifts.service');
const { authenticate } = require('../middleware/authMiddleware');
const { rateLimit } = require('express-rate-limit');
// FIX: rate-limit gift sends — 30 gifts per minute per user to prevent
// coin-drain abuse via rapid scripted sends.
const giftSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many gifts — please slow down' },
  skip: (req) => !req.user, // authenticate fires before this, so user is always set
});

// GET /gifts — grouped available gifts
router.get('/', async (req, res) => {
  try {
    const grouped = await giftsService.getGiftsGrouped();
    res.json({ success: true, data: grouped });
  } catch (err) {
    console.error('[gifts] GET /:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load gifts' });
  }
});

// POST /gifts/send
router.post('/send', authenticate, giftSendLimiter, async (req, res) => {
  try {
    const senderId = req.user.id;
    const { giftId, receiverId, roomId, quantity } = req.body;

    // FIX: validate required fields at route level
    if (!giftId || !receiverId || !roomId) {
      return res.status(400).json({ success: false, error: 'giftId, receiverId, and roomId are required' });
    }

    // FIX: clamp quantity to a safe integer range — prevents coin-drain via
    // large quantity values (e.g. quantity: 999999). Max 99 per single send.
    const qty = Math.max(1, Math.min(99, parseInt(quantity, 10) || 1));

    const result = await giftsService.sendGift(senderId, giftId, receiverId, roomId, qty);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS') {
      return res.status(400).json({ success: false, error: 'Insufficient balance' });
    }
    console.error('[gifts] POST /send:', err.message);
    res.status(500).json({ success: false, error: 'Failed to send gift' });
  }
});

// GET /gifts/history?type=sent&page=1&limit=20
router.get('/history', authenticate, async (req, res) => {
  try {
    const type = req.query.type === 'received' ? 'received' : 'sent';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const data = await giftsService.getGiftHistory(req.user.id, type, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[gifts] GET /history:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load gift history' });
  }
});

// GET /gifts/leaderboard/:roomId — top gift senders in a room
router.get('/leaderboard/:roomId', authenticate, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const data = await giftsService.getGiftLeaderboard(req.params.roomId, limit);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[gifts] GET /leaderboard:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load leaderboard' });
  }
});

// GET /gifts/stats/:roomId — aggregate gift stats for a room
router.get('/stats/:roomId', authenticate, async (req, res) => {
  try {
    const data = await giftsService.getRoomGiftStats(req.params.roomId);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[gifts] GET /stats:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load gift stats' });
  }
});

module.exports = router;
