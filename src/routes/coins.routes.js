const express = require('express');
const router = express.Router();
const coinsService = require('../services/coins.service');
const paymentService = require('../services/payment.service');
const agentService = require('../services/agent.service');
const { authenticate } = require('../middleware/authMiddleware');
const { financialLimiter } = require('../middleware/rateLimit');

// GET /coins/packages
router.get('/packages', async (req, res) => {
  try {
    const packages = await coinsService.getPackages();
    res.json({ success: true, data: packages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /coins/purchase - Initiate in-app purchase (returns pricing info)
router.post('/purchase', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { packageId } = req.body;

    const pkg = await coinsService.getPackages().then(pkgs => pkgs.find(p => p.id === packageId));
    if (!pkg) return res.status(404).json({ success: false, error: 'Package not found' });

    // Return pricing info for client to initiate in-app purchase
    res.json({ 
      success: true, 
      data: { 
        packageId, 
        amountEGP: pkg.priceEGP, 
        amountUSD: pkg.priceUSD,
        coins: pkg.coins,
        bonusCoins: pkg.bonusCoins || 0,
        message: 'Use in-app purchase on your device to complete payment'
      } 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /coins/verify-receipt - Verify in-app purchase receipt
router.post('/verify-receipt', authenticate, financialLimiter, async (req, res) => {
  try {
    const { receipt, platform, packageId } = req.body;
    if (!receipt || !platform || !packageId) {
      return res.status(400).json({ 
        success: false, 
        error: 'receipt, platform, and packageId are required' 
      });
    }

    const order = await paymentService.handleInAppReceipt(
      req.user.id,
      receipt,
      platform,
      'COIN_PURCHASE',
      packageId
    );

    // FIX H-03: correct argument order — sourceId=order.id, baseCoins=order.amountCents
    try {
      await agentService.calculateCommission(req.user.id, 'COIN_PURCHASE', order.id, order.amountCents);
    } catch (commissionErr) {
      console.warn('Agent commission failed for coin purchase:', commissionErr.message);
    }

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /coins/balance
router.get('/balance', authenticate, async (req, res) => {
  try {
    const wallet = await coinsService.getBalance(req.user.id);
    res.json({ success: true, data: wallet });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /coins/transactions
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const data = await coinsService.getTransactions(req.user.id, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
