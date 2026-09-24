const express = require('express');
const prisma = require('../prismaClient');
const agentService = require('../services/agent.service');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticate, requireRole('ADMIN', 'SUPER_ADMIN'));

// GET /admin/agents
router.get('/agents', async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const status = req.query.status || null;
    const skip = (page - 1) * limit;
    const where = status ? { status } : {};

    const rows = await prisma.agentProfile.findMany({
      where,
      include: { user: true },
      orderBy: { totalEarned: 'desc' },
      take: limit,
      skip,
    });

    const total = await prisma.agentProfile.count({ where });

    const data = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      username: row.user.username,
      avatar: row.user.avatar,
      agentCode: row.agentCode,
      status: row.status,
      tier: row.tier,
      totalReferred: row.totalReferred,
      activeReferred: row.activeReferred,
      totalEarned: row.totalEarned,
      monthlyEarned: row.monthlyEarned,
      rating: row.rating,
      joinedAt: row.joinedAt,
      updatedAt: row.updatedAt,
    }));

    res.json({ success: true, page, limit, total, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /admin/agents/:id/status
router.put('/agents/:id/status', async (req, res) => {
  try {
    const status = req.body.status;
    const updated = await agentService.updateAgentStatus(req.params.id, status);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /admin/agents/:id/tier
router.post('/agents/:id/tier', async (req, res) => {
  try {
    const tier = req.body.tier;
    const updated = await agentService.updateAgentTier(req.params.id, tier);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /admin/agents/:id/commissions
router.get('/agents/:id/commissions', async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const sourceType = req.query.sourceType || null;
    const data = await agentService.getAgentCommissions(req.params.id, page, limit, sourceType);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
