/**
 * Rankings / leaderboard routes.
 *
 * GET /api/rankings/agents   — top agents (invites + earnings)
 * GET /api/rankings/hosts    — top hosts (gifts + room time)
 */

const express = require('express');
const prisma = require('../prismaClient');
const db = require('../db');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/rankings?type=room|wealth|charm
// ---------------------------------------------------------------------------
router.get('/', authenticate, async (req, res) => {
  const type = String(req.query.type || 'room').toLowerCase();
  const limit = Math.min(50, parseInt(req.query.limit ?? 20, 10) || 20);

  try {
    if (type === 'room') {
      const rooms = await prisma.room.findMany({
        where: { isActive: true },
        include: {
          owner: { select: { id: true, username: true, avatar: true } },
          seats: { where: { userId: { not: null } } },
          giftTransactions: { select: { totalCoins: true } },
        },
        take: 100,
      });

      const items = rooms
        .map((room) => ({
          id: room.id,
          name: room.name,
          username: room.owner.username,
          avatar: room.owner.avatar,
          score: room.seats.length * 10 + room.giftTransactions.reduce((s, g) => s + g.totalCoins, 0),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item, i) => ({ ...item, rank: i + 1 }));

      return res.json({ success: true, type: 'room', items });
    }

    if (type === 'wealth') {
      const wallets = await prisma.userWallet.findMany({
        orderBy: { totalSpent: 'desc' },
        take: limit,
        include: { user: { select: { id: true, username: true, avatar: true } } },
      });
      const items = wallets.map((w, i) => ({
        id: w.userId,
        username: w.user.username,
        avatar: w.user.avatar,
        score: w.totalSpent,
        rank: i + 1,
      }));
      return res.json({ success: true, type: 'wealth', items });
    }

    if (type === 'charm') {
      const receivers = await prisma.giftTransaction.groupBy({
        by: ['receiverId'],
        _sum: { totalCoins: true },
        orderBy: { _sum: { totalCoins: 'desc' } },
        take: limit,
      });
      const userIds = receivers.map((r) => r.receiverId);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, avatar: true },
      });
      const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
      const items = receivers.map((r, i) => ({
        id: r.receiverId,
        username: userMap[r.receiverId]?.username,
        avatar: userMap[r.receiverId]?.avatar,
        score: r._sum.totalCoins ?? 0,
        rank: i + 1,
      }));
      return res.json({ success: true, type: 'charm', items });
    }

    if (type === 'gifters' || type === 'gifter') {
      const period = String(req.query.period || 'weekly').toLowerCase();
      const since = new Date();
      if (period === 'monthly') since.setDate(since.getDate() - 30);
      else if (period === 'seasonal') since.setDate(since.getDate() - 90);
      else since.setDate(since.getDate() - 7);

      const senders = await prisma.giftTransaction.groupBy({
        by: ['senderId'],
        where: { createdAt: { gte: since } },
        _sum: { totalCoins: true },
        orderBy: { _sum: { totalCoins: 'desc' } },
        take: limit,
      });
      const userIds = senders.map((s) => s.senderId);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, avatar: true, role: true, svipLevel: true },
      });
      const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
      const items = senders.map((s, i) => ({
        id: s.senderId,
        username: userMap[s.senderId]?.username,
        avatar: userMap[s.senderId]?.avatar,
        role: userMap[s.senderId]?.role,
        svipLevel: userMap[s.senderId]?.svipLevel,
        score: s._sum.totalCoins ?? 0,
        rank: i + 1,
      }));
      return res.json({ success: true, type: 'gifters', period, items });
    }

    if (type === 'vip' || type === 'svip') {
      const activeFilter = { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
      const vips = await prisma.userVip.findMany({
        where: type === 'svip'
          ? { OR: [{ tier: { startsWith: 'SVIP' } }, { tier: 'TEST_SVIP' }], ...activeFilter }
          : { OR: [{ tier: 'VIP' }, { tier: { startsWith: 'VIP_' } }, { tier: 'TEST_VIP' }], ...activeFilter },
        include: { User: { select: { id: true, username: true, avatar: true, svipLevel: true } } },
        take: 100,
      });
      const items = vips
        .map((v) => ({
          id: v.userId,
          username: v.User?.username,
          avatar: v.User?.avatar,
          tier: v.tier,
          svipLevel: v.User?.svipLevel,
          score: v.startedAt ? v.startedAt.getTime() : 0,
        }))
        .sort((a, b) => (b.svipLevel || 0) - (a.svipLevel || 0))
        .slice(0, limit)
        .map((item, i) => ({ ...item, rank: i + 1 }));
      return res.json({ success: true, type, items });
    }

    return res.status(400).json({ success: false, error: 'Invalid ranking type' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Legacy SQLite rankings (agents/hosts)

// ---------------------------------------------------------------------------
// GET /api/rankings/agents?limit=20&period=monthly
// ---------------------------------------------------------------------------
router.get('/agents', (req, res) => {
  const limit  = Math.min(100, parseInt(req.query.limit ?? 20, 10));
  const period = req.query.period ?? 'monthly';

  // FIX M-02: use parameterized queries instead of string interpolation
  let timeFilter = '';
  const timeParams = [];
  if (period === 'monthly') {
    const { currentMonthPeriod } = require('../helpers');
    const p = currentMonthPeriod();
    timeFilter = `AND earn.created_at >= unixepoch(? || '-01')`;
    timeParams.push(p);
  } else if (period === 'weekly') {
    timeFilter = `AND earn.created_at >= (unixepoch() - 7 * 86400)`;
  }

  const rows = db.prepare(`
    SELECT
      a.id,
      u.username,
      a.total_invites,
      a.active_invites,
      a.total_earnings,
      COALESCE(period_earn.total, 0) AS period_earnings,
      ROW_NUMBER() OVER (ORDER BY COALESCE(period_earn.total, 0) DESC) AS rank
    FROM agents a
    JOIN users u ON u.id = a.id
    LEFT JOIN (
      SELECT earn.user_id, SUM(earn.amount) AS total
      FROM earnings earn
      WHERE earn.type = 'agent_commission' ${timeFilter}
      GROUP BY earn.user_id
    ) period_earn ON period_earn.user_id = a.id
    WHERE a.status = 'active'
    ORDER BY period_earnings DESC
    LIMIT ?
  `).all(...timeParams, limit);

  res.json({ period, leaderboard: rows });
});

// ---------------------------------------------------------------------------
// GET /api/rankings/hosts?limit=20&period=monthly
// ---------------------------------------------------------------------------
router.get('/hosts', (req, res) => {
  const limit  = Math.min(100, parseInt(req.query.limit ?? 20, 10));
  const period = req.query.period ?? 'monthly';

  // FIX M-02: parameterized queries
  let timeFilter = '';
  const timeParams = [];
  if (period === 'monthly') {
    const { currentMonthPeriod } = require('../helpers');
    const p = currentMonthPeriod();
    timeFilter = `AND earn.created_at >= unixepoch(? || '-01')`;
    timeParams.push(p);
  } else if (period === 'weekly') {
    timeFilter = `AND earn.created_at >= (unixepoch() - 7 * 86400)`;
  }

  const rows = db.prepare(`
    SELECT
      h.id,
      u.username,
      h.total_room_time,
      ROUND(h.total_room_time / 3600.0, 2) AS total_hours,
      h.total_gifts,
      h.total_earnings,
      COALESCE(period_earn.total, 0) AS period_earnings,
      ROW_NUMBER() OVER (ORDER BY COALESCE(period_earn.total, 0) DESC) AS rank
    FROM hosts h
    JOIN users u ON u.id = h.id
    LEFT JOIN (
      SELECT earn.user_id, SUM(earn.amount) AS total
      FROM earnings earn
      WHERE earn.type = 'host_commission' ${timeFilter}
      GROUP BY earn.user_id
    ) period_earn ON period_earn.user_id = h.id
    WHERE h.status = 'active'
    ORDER BY period_earnings DESC
    LIMIT ?
  `).all(...timeParams, limit);

  res.json({ period, leaderboard: rows });
});

module.exports = router;
