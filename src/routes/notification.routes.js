/**
 * Notification Routes
 *
 * FIX: Route order shadowing — `PUT /read-all` MUST be declared BEFORE
 * `PUT /:id/read`. Express matches routes top-to-bottom; placing /:id/read
 * first causes `read-all` to be treated as an ID value, so markAllAsRead
 * was never reachable. Reordered to fix this.
 *
 * FIX: Added deviceTokenLimiter on POST /token to prevent device_tokens
 * table flooding.
 *
 * FIX: Replaced new PrismaClient() per-module with shared singleton pattern.
 *
 * FIX: raw err.message no longer returned in 500 responses.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const notificationService = require('../services/notification.service');
const { deviceTokenLimiter } = require('../middleware/rateLimit');
const prisma = require('../prismaClient');

// ─────────────────────────────────────────────────────────────────────────────
// Device Token Registration
// ─────────────────────────────────────────────────────────────────────────────

// POST /notifications/token
router.post('/token', authenticate, deviceTokenLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { token, platform } = req.body;

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'token is required' });
    }
    if (!platform || !['android', 'ios', 'web'].includes(platform.toLowerCase())) {
      return res.status(400).json({ success: false, error: 'platform must be android, ios, or web' });
    }

    await prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform, isActive: true, updatedAt: new Date() },
      create: { userId, token, platform, isActive: true },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[notifications] POST /token:', err.message);
    res.status(500).json({ success: false, error: 'Failed to register device token' });
  }
});

// DELETE /notifications/token
router.delete('/token', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const token = req.body.token || req.query.token;
    if (!token) {
      return res.status(400).json({ success: false, error: 'token is required' });
    }

    await prisma.deviceToken.updateMany({
      where: { userId, token },
      data: { isActive: false },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[notifications] DELETE /token:', err.message);
    res.status(500).json({ success: false, error: 'Failed to deregister device token' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Notification List & Counts
// ─────────────────────────────────────────────────────────────────────────────

// GET /notifications
router.get('/', authenticate, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const data = await notificationService.getNotifications(req.user.id, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[notifications] GET /:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load notifications' });
  }
});

// GET /notifications/unread-count
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user.id);
    res.json({ success: true, data: { count } });
  } catch (err) {
    console.error('[notifications] GET /unread-count:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get unread count' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Mark Read / Delete
// FIX: /read-all MUST come BEFORE /:id/read — Express matches top-to-bottom,
// so declaring /:id/read first would swallow /read-all (treating 'read-all'
// as an ID), making the endpoint permanently unreachable.
// ─────────────────────────────────────────────────────────────────────────────

// PUT /notifications/read-all  — MUST be BEFORE /:id/read
router.put('/read-all', authenticate, async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[notifications] PUT /read-all:', err.message);
    res.status(500).json({ success: false, error: 'Failed to mark all as read' });
  }
});

// PUT /notifications/:id/read
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    await notificationService.markAsRead(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[notifications] PUT /:id/read:', err.message);
    res.status(500).json({ success: false, error: 'Failed to mark notification as read' });
  }
});

// DELETE /notifications/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await prisma.notification.deleteMany({
      where: { id: req.params.id, userId: req.user.id },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[notifications] DELETE /:id:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete notification' });
  }
});

module.exports = router;
