const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const shopService = require('../services/shop.service');

const router = express.Router();

router.get('/catalog', authenticate, async (req, res) => {
  try {
    const data = await shopService.getShopCatalog(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/inventory', authenticate, async (req, res) => {
  try {
    const data = await shopService.getUserInventory(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/bundles/:id/purchase', authenticate, async (req, res) => {
  try {
    const purchase = await shopService.purchaseBundle(req.user.id, req.params.id);
    res.json({ success: true, data: purchase });
  } catch (error) {
    const code = error.message.includes('Insufficient') ? 400 : 500;
    res.status(code).json({ success: false, error: error.message });
  }
});

module.exports = router;
