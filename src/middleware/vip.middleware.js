/**
 * VIP middleware
 *
 * FIX: Replaced per-invocation `new PrismaClient()` with a single shared
 * module-level instance. Previously every HTTP request guarded by requireVip()
 * instantiated a fresh Prisma client with its own connection pool — a textbook
 * connection-pool exhaustion vector under moderate load (each idle pool holds
 * 2–10 connections by default).
 */
const prisma = require('../prismaClient');

const { TIER_ORDER } = require('../config/tierOrder');

function requireVip(minTier) {
  return async (req, res, next) => {
    try {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

      const uv = await prisma.userVip.findUnique({ where: { userId } });
      let userTier = uv ? uv.tier : 'NONE';
      if (uv?.expiresAt && uv.expiresAt <= new Date()) userTier = 'NONE';

      if (TIER_ORDER[userTier] < TIER_ORDER[minTier]) {
        return res.status(403).json({ success: false, error: 'VIP tier required', required: minTier, current: userTier });
      }

      next();
    } catch (err) {
      // FIX: never expose raw Prisma/internal error messages to clients
      console.error('[requireVip] error:', err.message);
      res.status(500).json({ success: false, error: 'Failed to verify VIP status' });
    }
  };
}

module.exports = { requireVip };
