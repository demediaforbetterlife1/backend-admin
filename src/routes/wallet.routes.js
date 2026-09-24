const express = require('express');
const router = express.Router();
const walletService = require('../services/wallet.service');
const { authenticate } = require('../middleware/authMiddleware');
const { financialLimiter } = require('../middleware/rateLimit');

// GET /wallet
router.get('/', authenticate, async (req, res) => {
  try {
    const data = await walletService.getWallet(req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[wallet] GET /:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load wallet' });
  }
});

// GET /wallet/coins
router.get('/coins', authenticate, async (req, res) => {
  try {
    const wallet = await walletService.getWallet(req.user.id);
    res.json({ success: true, data: { coins: wallet.coinBalance } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load coins' });
  }
});

// GET /wallet/diamonds
router.get('/diamonds', authenticate, async (req, res) => {
  try {
    const wallet = await walletService.getWallet(req.user.id);
    res.json({ success: true, data: { diamonds: wallet.diamondBalance || 0 } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load diamonds' });
  }
});

// GET /wallet/transactions
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const transactions = []; // Mock for now
    res.json({ success: true, data: transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load transactions' });
  }
});

// POST /wallet/topup
router.post('/topup', authenticate, financialLimiter, async (req, res) => {
  try {
    res.json({ success: true, message: 'Topup endpoint' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to topup' });
  }
});

// POST /wallet/withdraw
router.post('/withdraw', authenticate, financialLimiter, async (req, res) => {
  try {
    const { coinsAmount, method, accountInfo } = req.body;

    // FIX: validate coinsAmount is a positive integer at route level
    const coins = parseInt(coinsAmount, 10);
    if (!Number.isInteger(coins) || coins <= 0) {
      return res.status(400).json({ success: false, error: 'coinsAmount must be a positive integer' });
    }
    if (!method || typeof method !== 'string' || method.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'method is required' });
    }

    const wr = await walletService.requestWithdrawal(req.user.id, coins, method.trim(), accountInfo || {});
    res.status(201).json({ success: true, data: wr });
  } catch (err) {
    if (err.code === 'MIN_WITHDRAWAL') {
      return res.status(400).json({ success: false, error: 'Minimum withdrawal not met' });
    }
    if (err.code === 'PENDING_WITHDRAWAL') {
      return res.status(400).json({ success: false, error: 'Pending withdrawal already exists' });
    }
    console.error('[wallet] POST /withdraw:', err.message);
    res.status(500).json({ success: false, error: 'Failed to process withdrawal' });
  }
});

// GET /wallet/withdrawals
router.get('/withdrawals', authenticate, async (req, res) => {
  try {
    const rows = await walletService.getWithdrawals(req.user.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[wallet] GET /withdrawals:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load withdrawals' });
  }
});

module.exports = router;
