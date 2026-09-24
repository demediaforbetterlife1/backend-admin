const express = require('express');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../prismaClient');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

const adminOnly = [authenticate, requireRole('ADMIN', 'SUPER_ADMIN')];

// ── GET /api/admin/posts/reports ───────────────────────────────────────────────
router.get('/posts/reports', ...adminOnly, async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page)  || 1);
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip     = (page - 1) * limit;
    const reason   = req.query.reason   || undefined;
    const resolved = req.query.resolved === 'true' ? true
                   : req.query.resolved === 'false' ? false
                   : undefined;

    const where = {
      ...(reason   !== undefined ? { reason }   : {}),
      ...(resolved !== undefined ? { resolved } : {}),
    };

    const [reports, total] = await Promise.all([
      prisma.postReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          post:     { select: { id: true, content: true, mediaUrls: true, userId: true } },
          reporter: { select: { id: true, username: true, avatar: true } },
        },
      }),
      prisma.postReport.count({ where }),
    ]);

    res.json({
      success: true,
      data:    reports,
      meta:    { page, limit, total, hasMore: skip + reports.length < total },
    });
  } catch (err) {
    console.error('[ADMIN] GET /posts/reports error:', err);
    res.status(500).json({ success: false, error: 'Failed to load reports' });
  }
});

// ── PUT /api/admin/posts/reports/:reportId/resolve ────────────────────────────
router.put('/posts/reports/:reportId/resolve', ...adminOnly, async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action }   = req.body;

    if (!['dismiss', 'delete_post', 'warn_user', 'ban_user'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid action. Must be: dismiss | delete_post | warn_user | ban_user' });
    }

    const report = await prisma.postReport.findUnique({
      where:   { id: reportId },
      include: { post: { select: { id: true, userId: true, mediaUrls: true } } },
    });

    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    if (report.resolved) return res.status(409).json({ success: false, error: 'Report already resolved' });

    await prisma.$transaction(async (tx) => {
      await tx.postReport.update({
        where: { id: reportId },
        data:  { resolved: true, resolvedAt: new Date(), resolvedBy: req.user.id, resolution: action },
      });

      if (action === 'delete_post' && report.post) {
        await tx.post.delete({ where: { id: report.post.id } });
      }

      if (action === 'ban_user' && report.post) {
        await tx.user.update({
          where: { id: report.post.userId },
          data:  { isBanned: true },
        });
      }

      if (action === 'warn_user' && report.post) {
        await tx.userWarning.create({
          data: {
            id:      uuidv4(),
            userId:  report.post.userId,
            reason:  `Post reported for: ${report.reason}`,
            adminId: req.user.id,
          },
        });
      }
    });

    res.json({ success: true, message: `Report resolved with action: ${action}` });
  } catch (err) {
    console.error('[ADMIN] PUT /posts/reports/:id/resolve error:', err);
    res.status(500).json({ success: false, error: 'Failed to resolve report' });
  }
});

// ── GET /api/admin/posts/reports/stats ────────────────────────────────────────
router.get('/posts/reports/stats', ...adminOnly, async (req, res) => {
  try {
    const [total, unresolved, byReason] = await Promise.all([
      prisma.postReport.count(),
      prisma.postReport.count({ where: { resolved: false } }),
      prisma.postReport.groupBy({ by: ['reason'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
    ]);

    res.json({
      success: true,
      data:    { total, unresolved, resolved: total - unresolved, byReason },
    });
  } catch (err) {
    console.error('[ADMIN] GET /posts/reports/stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to load report stats' });
  }
});

module.exports = router;
