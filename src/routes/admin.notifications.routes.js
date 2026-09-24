const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const notificationService = require('../services/notification.service');
const prisma = require('../prismaClient');

router.post('/notifications/broadcast', authenticate, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { titleAr, bodyAr, data } = req.body;
    const users = await prisma.user.findMany({ where: {}, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await notificationService.sendToMultipleUsers(userIds, 'SYSTEM', titleAr, bodyAr, data || {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/notifications/send', authenticate, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { userId, titleAr, bodyAr, data } = req.body;
    await notificationService.sendPushNotification(userId, 'SYSTEM', titleAr, bodyAr, data || {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
