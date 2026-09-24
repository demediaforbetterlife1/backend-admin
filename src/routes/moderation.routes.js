const express = require('express');
const router = express.Router();
const moderationService = require('../services/moderation.service');
const { authenticate } = require('../middleware/authMiddleware');
const { reportLimiter } = require('../middleware/rateLimit');

router.post('/report', authenticate, reportLimiter, async (req, res) => {
  try {
    const { reportedUserId, roomId, reason, description } = req.body;
    if (!reportedUserId || !reason) {
      return res.status(400).json({ success: false, error: 'reportedUserId and reason are required' });
    }

    // Prevent self-reporting
    if (reportedUserId === req.user.id) {
      return res.status(400).json({ success: false, error: 'Cannot report yourself' });
    }

    const report = await moderationService.submitReport(
      req.user.id,
      reportedUserId,
      roomId || null,
      reason,
      description || null,
    );

    res.status(201).json({ success: true, data: report });
  } catch (err) {
    console.error('[moderation] POST /report:', err.message);
    res.status(400).json({ success: false, error: 'Failed to submit report' });
  }
});

router.get('/reports', authenticate, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const data = await moderationService.getReportsForUser(req.user.id, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[moderation] GET /reports:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load reports' });
  }
});

module.exports = router;
