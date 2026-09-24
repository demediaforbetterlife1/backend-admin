/**
 * Admin Moderation Routes
 *
 * FIX H-06: Allow ADMIN role (not just SUPER_ADMIN) for standard moderation
 *           actions (view reports, reset profile, reset room, view warnings,
 *           manage banned words).
 *           Network ban and report review remain SUPER_ADMIN only.
 */

const express = require('express');
const router = express.Router();
const moderationService = require('../services/moderation.service');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

// ---------------------------------------------------------------------------
// Routes accessible to both ADMIN and SUPER_ADMIN
// ---------------------------------------------------------------------------

// GET /admin/moderation/reports
router.get('/reports', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const status = req.query.status;
    const reason = req.query.reason;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const data = await moderationService.getAllReports({ status, reason }, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /admin/moderation/reports/:id/review
// FIX H-06: ADMIN can warn/ban_1d/ban_3d; network ban restricted to SUPER_ADMIN
router.put('/reports/:id/review', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { action, adminNote } = req.body;
    if (!action) {
      return res.status(400).json({ success: false, error: 'action is required' });
    }

    // Network ban is SUPER_ADMIN only
    if (action === 'ban_network' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'Network ban requires SUPER_ADMIN role' });
    }

    const report = await moderationService.reviewReport(req.params.id, req.user.id, action, adminNote);
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /admin/moderation/banned-words
router.get('/banned-words', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = await moderationService.getBannedWords();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/moderation/banned-words
router.post('/banned-words', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { word, severity } = req.body;
    if (!word || !severity) {
      return res.status(400).json({ success: false, error: 'word and severity are required' });
    }
    const data = await moderationService.addBannedWord(word, severity);
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /admin/moderation/banned-words/:id
router.delete('/banned-words/:id', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    await moderationService.removeBannedWord(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /admin/moderation/users/:userId/reset-profile
router.post('/users/:userId/reset-profile', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = await moderationService.resetUserProfile(req.params.userId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /admin/moderation/rooms/:roomId/reset
router.post('/rooms/:roomId/reset', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = await moderationService.resetRoom(req.params.roomId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /admin/moderation/warnings/:userId
router.get('/warnings/:userId', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = await moderationService.getWarningsForUser(req.params.userId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// MISSING FEATURE: POST /admin/moderation/users/:userId/ban
// Direct ban endpoint with banType — no need to go through report review flow
// ---------------------------------------------------------------------------
router.post('/users/:userId/ban', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { banType = 'ONE_DAY', reason } = req.body;

    const allowedBanTypes = ['ONE_DAY', 'THREE_DAYS', 'NETWORK'];
    if (!allowedBanTypes.includes(banType)) {
      return res.status(400).json({ success: false, error: 'banType must be ONE_DAY, THREE_DAYS, or NETWORK' });
    }

    // Network ban is SUPER_ADMIN only
    if (banType === 'NETWORK' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'Network ban requires SUPER_ADMIN role' });
    }

    const prisma = require('../prismaClient');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const days = banType === 'THREE_DAYS' ? 3 : banType === 'NETWORK' ? null : 1;
    const banExpiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

    await prisma.user.update({
      where: { id: userId },
      data: { isBanned: true, banType, banExpiresAt },
    });

    // Record warning
    if (reason) {
      await prisma.userWarning.create({
        data: { userId, reason: `Admin ban: ${reason}`, sourceId: null },
      });
    }

    // Revoke sessions and kick from rooms
    const authService = require('../services/authService');
    await authService.revokeAllRefreshTokens(userId);
    const { kickUserFromAllRooms } = require('../socket/room.socket');
    await kickUserFromAllRooms(userId);

    // Notify user
    const notificationService = require('../services/notification.service');
    await notificationService.sendPushNotification(
      userId,
      'USER_BANNED',
      'تم تعليق حسابك',
      banType === 'NETWORK'
        ? 'تم تعليق حسابك بشكل دائم.'
        : `تم تعليق حسابك لمدة ${days} يوم.`,
      { banType },
    ).catch(console.warn);

    res.json({ success: true, message: 'User banned', banType, banExpiresAt });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// MISSING FEATURE: POST /admin/moderation/users/:userId/unban
router.post('/users/:userId/unban', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { userId } = req.params;
    const prisma = require('../prismaClient');

    await prisma.user.update({
      where: { id: userId },
      data: { isBanned: false, banExpiresAt: null, banType: null },
    });

    res.json({ success: true, message: 'User unbanned' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
