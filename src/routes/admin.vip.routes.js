/**
 * Admin VIP Routes
 *
 * FIX H-09: POST /admin/vip/grant now updates the user's role field
 *           in addition to the UserVip record.
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const prisma = require('../prismaClient');
const vipService = require('../services/vip.service');

// POST /admin/vip/plans - create or update
router.post('/vip/plans', authenticate, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const data = req.body;
    const plan = await prisma.vipPlan.upsert({ where: { tier: data.tier }, update: data, create: data });
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/vip/frames
router.post('/vip/frames', authenticate, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const data = req.body;
    const frame = await prisma.frame.create({ data });
    res.json({ success: true, data: frame });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /admin/vip/frames/:id
router.put('/vip/frames/:id', authenticate, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body;
    const frame = await prisma.frame.update({ where: { id }, data });
    res.json({ success: true, data: frame });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/vip/entrances
router.post('/vip/entrances', authenticate, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const data = req.body;
    const ent = await prisma.entrance.create({ data });
    res.json({ success: true, data: ent });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /admin/vip/entrances/:id
router.put('/vip/entrances/:id', authenticate, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body;
    const ent = await prisma.entrance.update({ where: { id }, data });
    res.json({ success: true, data: ent });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/vip/grant - manual grant to user
// FIX H-09: also update the user's role field to VIP/USER
router.post('/vip/grant', authenticate, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { userId, tier, days = 30 } = req.body;

    if (!userId || !tier) {
      return res.status(400).json({ success: false, error: 'userId and tier are required' });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const existing = await prisma.userVip.findUnique({ where: { userId } });

    await prisma.$transaction(async (tx) => {
      const newStatus = tier === 'NONE' ? 'NONE' : 'ACTIVE';
      if (existing) {
        await tx.userVip.update({ where: { userId }, data: { tier, status: newStatus, startedAt: now, expiresAt, autoRenew: false } });
      } else {
        await tx.userVip.create({ data: { userId, tier, status: newStatus, startedAt: now, expiresAt, autoRenew: false } });
      }

      await tx.vipTransaction.create({
        data: { userId, fromTier: existing ? existing.tier : 'NONE', toTier: tier, durationDays: days },
      });

      // FIX H-09: update the user's role to match the granted tier
      const newRole = tier === 'NONE' ? 'USER' : (String(tier).startsWith('SVIP') || tier === 'TEST_SVIP' ? 'SVIP' : 'VIP');
      const svipLevel = String(tier).startsWith('SVIP_') ? Number(String(tier).replace('SVIP_', '')) : tier === 'TEST_SVIP' ? 1 : null;
      await tx.user.update({ where: { id: userId }, data: { role: newRole, svipLevel } });
    });

    // Invalidate VIP cache
    const vipCacheService = require('../services/vip.cache.service');
    await vipCacheService.invalidateVipStatus(userId);
    await vipService.emitVipStatusUpdate(userId);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test endpoints (only in development/staging)
const isProd = process.env.NODE_ENV === 'production';
if (!isProd) {
  // POST /admin/test/activate-vip/:userId - Activate Test VIP
  router.post('/test/activate-vip/:userId', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res) => {
    try {
      const { userId } = req.params;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const existing = await prisma.userVip.findUnique({ where: { userId } });

      await prisma.$transaction(async (tx) => {
        if (existing) {
          await tx.userVip.update({ 
          where: { userId }, 
          data: { 
            tier: 'TEST_VIP', 
            status: 'ACTIVE',
            startedAt: now, 
            expiresAt, 
            autoRenew: false 
          } 
        });
        } else {
          await tx.userVip.create({ 
          data: { 
            userId, 
            tier: 'TEST_VIP', 
            status: 'ACTIVE',
            startedAt: now, 
            expiresAt, 
            autoRenew: false 
          } 
        });
        }

        await tx.vipTransaction.create({
          data: { userId, fromTier: existing ? existing.tier : 'NONE', toTier: 'TEST_VIP', durationDays: 30 },
        });

        // Update user's role and svipLevel
        await tx.user.update({ 
          where: { id: userId }, 
          data: { role: 'VIP', svipLevel: null } 
        });
      });

      // Invalidate VIP cache
      const vipCacheService = require('../services/vip.cache.service');
      await vipCacheService.invalidateVipStatus(userId);
      await vipService.emitVipStatusUpdate(userId);

      res.json({ success: true, message: 'Test VIP activated successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /admin/test/activate-svip/:userId - Activate Test SVIP
  router.post('/test/activate-svip/:userId', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res) => {
    try {
      const { userId } = req.params;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const existing = await prisma.userVip.findUnique({ where: { userId } });

      await prisma.$transaction(async (tx) => {
        if (existing) {
          await tx.userVip.update({ 
          where: { userId }, 
          data: { 
            tier: 'TEST_SVIP', 
            status: 'ACTIVE',
            startedAt: now, 
            expiresAt, 
            autoRenew: false 
          } 
        });
        } else {
          await tx.userVip.create({ 
          data: { 
            userId, 
            tier: 'TEST_SVIP', 
            status: 'ACTIVE',
            startedAt: now, 
            expiresAt, 
            autoRenew: false 
          } 
        });
        }

        await tx.vipTransaction.create({
          data: { userId, fromTier: existing ? existing.tier : 'NONE', toTier: 'TEST_SVIP', durationDays: 30 },
        });

        // Update user's role and svipLevel
        await tx.user.update({ 
          where: { id: userId }, 
          data: { role: 'SVIP', svipLevel: 1 } 
        });
      });

      // Invalidate VIP cache
      const vipCacheService = require('../services/vip.cache.service');
      await vipCacheService.invalidateVipStatus(userId);
      await vipService.emitVipStatusUpdate(userId);

      res.json({ success: true, message: 'Test SVIP activated successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /admin/test/remove-subscription/:userId - Remove Premium
  router.post('/test/remove-subscription/:userId', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), async (req, res) => {
    try {
      const { userId } = req.params;

      const existing = await prisma.userVip.findUnique({ where: { userId } });

      if (!existing) {
        return res.status(404).json({ success: false, error: 'User has no VIP subscription' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.userVip.update({
          where: { userId },
          data: {
            tier: 'NONE',
            status: 'CANCELLED',
            expiresAt: null,
            autoRenew: false,
          },
        });
        await tx.vipTransaction.create({
          data: { userId, fromTier: existing.tier, toTier: 'NONE', durationDays: 0 },
        });

        // Update user's role and svipLevel back to defaults
        await tx.user.update({ 
          where: { id: userId }, 
          data: { role: 'USER', svipLevel: null } 
        });
      });

      // Invalidate VIP cache
      const vipCacheService = require('../services/vip.cache.service');
      await vipCacheService.invalidateVipStatus(userId);
      await vipService.emitVipStatusUpdate(userId);

      res.json({ success: true, message: 'Premium removed successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

module.exports = router;
