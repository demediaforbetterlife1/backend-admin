const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const prisma = require('../prismaClient');

// GET /admin/coins/withdrawals
router.get('/withdrawals', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const rows = await prisma.withdrawalRequest.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/coins/withdrawals/:id/approve
router.post('/withdrawals/:id/approve', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const id = req.params.id;
    const wr = await prisma.withdrawalRequest.update({ where: { id }, data: { status: 'APPROVED', resolvedAt: new Date() } });
    res.json({ success: true, data: wr });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/coins/withdrawals/:id/reject
router.post('/withdrawals/:id/reject', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const id = req.params.id;
    const wr = await prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!wr) return res.status(404).json({ success: false, error: 'Withdrawal not found' });
    if (wr.status === 'REJECTED') {
      return res.status(400).json({ success: false, error: 'Withdrawal already rejected' });
    }
    if (wr.status !== 'PENDING' && wr.status !== 'APPROVED') {
      return res.status(400).json({ success: false, error: 'Cannot reject withdrawal in current status' });
    }

    // FIX L-03: wrap refund + status update in a single transaction
    await prisma.$transaction(async (tx) => {
      const coinsService = require('../services/coins.service');
      await coinsService.creditCoins(
        wr.userId,
        wr.coinsAmount,
        'REFUND',
        id,
        `Refund for rejected withdrawal ${id}`,
        tx,
      );
      await tx.withdrawalRequest.update({
        where: { id },
        data: { status: 'REJECTED', resolvedAt: new Date() },
      });
    });

    res.json({ success: true, message: 'Withdrawal rejected and coins refunded' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/coins/withdrawals/:id/mark-paid
router.post('/withdrawals/:id/mark-paid', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const id = req.params.id;
    const wr = await prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!wr) return res.status(404).json({ success: false, error: 'Withdrawal not found' });
    if (wr.status !== 'APPROVED') {
      return res.status(400).json({ success: false, error: 'Withdrawal must be approved before marking paid' });
    }

    const updated = await prisma.withdrawalRequest.update({ where: { id }, data: { status: 'PAID', resolvedAt: new Date() } });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
