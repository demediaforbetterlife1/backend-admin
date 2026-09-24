const express = require('express');
const router = express.Router();
const paymentService = require('../services/payment.service');
const paymentWebhookService = require('../services/payment.webhook.service');
const { authenticate } = require('../middleware/authMiddleware');

// POST /payment/initiate - Get pricing info for in-app purchase
router.post('/initiate', authenticate, async (req, res) => {
  try {
    const { type, itemId } = req.body;
    if (!type || !itemId) {
      return res.status(400).json({ success: false, error: 'type and itemId are required' });
    }

    const data = await paymentService.initiatePayment(req.user.id, type, itemId);
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /payment/verify-receipt - Verify in-app purchase receipt
router.post('/verify-receipt', authenticate, async (req, res) => {
  try {
    const { receipt, platform, type, itemId, autoRenew = false } = req.body;
    if (!receipt || !platform || !type || !itemId) {
      return res.status(400).json({ 
        success: false, 
        error: 'receipt, platform, type, and itemId are required' 
      });
    }

    const order = await paymentService.handleInAppReceipt(
      req.user.id,
      receipt,
      platform,
      type,
      itemId,
      autoRenew,
    );
    
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /payment/orders?page=1&limit=20
router.get('/orders', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const data = await paymentService.getUserOrders(req.user.id, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /payment/orders/:id
router.get('/orders/:id', authenticate, async (req, res) => {
  try {
    const order = await paymentService.getOrderStatus(req.params.id, req.user.id);
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// POST /payment/webhook
router.post('/webhook', async (req, res) => {
  try {
    const { platform, payload } = req.body;
    const headerSecret = req.headers['x-webhook-secret'] || req.headers['x_webhook_secret'];

    const result = await paymentWebhookService.handleWebhook(platform, payload, headerSecret);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
