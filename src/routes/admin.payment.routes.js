const express = require('express');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const prisma = require('../prismaClient');

const router = express.Router();

router.use(authenticate, requireRole('SUPER_ADMIN'));

// GET /admin/payments?page=1&limit=20&status=SUCCESS
router.get('/payments', async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const status = req.query.status || null;
    const skip = (page - 1) * limit;
    const where = status ? { status } : {};

    const [rows, total] = await Promise.all([
      prisma.paymentOrder.findMany({
        where,
        include: { user: { select: { id: true, username: true, email: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.paymentOrder.count({ where }),
    ]);

    res.json({ success: true, page, limit, total, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /admin/payments/:id
router.get('/payments/:id', async (req, res) => {
  try {
    const order = await prisma.paymentOrder.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { id: true, username: true, email: true, phone: true } } },
    });
    if (!order) return res.status(404).json({ success: false, error: 'Payment order not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
