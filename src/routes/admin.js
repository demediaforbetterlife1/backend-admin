/**
 * Admin routes — full control panel.
 *
 * FIX C-01: Switched from legacy auth.js (lowercase 'admin' role, no ban check)
 *           to authMiddleware.js (uppercase roles, ban-aware).
 * FIX C-02: /users/:id/ban now updates Prisma, revokes tokens, kicks sockets.
 * FIX M-02: Replaced string-interpolated SQL in earnings-breakdown with params.
 * FIX L-04: DELETE /users/:id wrapped in a single db.transaction().
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const prisma = require('../prismaClient');
const { authenticate, requireRole } = require('../middleware/authMiddleware'); // FIX C-01
const { parsePagination, currentMonthPeriod } = require('../helpers');

const router = express.Router();

// FIX C-01: use uppercase roles that match JWT payload
router.use(authenticate, requireRole('ADMIN', 'SUPER_ADMIN'));

// ---------------------------------------------------------------------------
// GET /api/admin/applications
// ---------------------------------------------------------------------------
router.get('/applications', (req, res) => {
  const agents = db.prepare(`
    SELECT a.id, a.status, a.invite_code, u.created_at AS applied_at,
           u.username, u.email
    FROM agents a JOIN users u ON u.id = a.id
    WHERE a.status = 'pending'
    ORDER BY u.created_at ASC
  `).all();

  const hosts = db.prepare(`
    SELECT h.id, h.status, u.created_at AS applied_at,
           u.username, u.email
    FROM hosts h JOIN users u ON u.id = h.id
    WHERE h.status = 'pending'
    ORDER BY u.created_at ASC
  `).all();

  res.json({ agents, hosts });
});

// ---------------------------------------------------------------------------
// POST /api/admin/agents/:id/approve
// ---------------------------------------------------------------------------
router.post('/agents/:id/approve', (req, res) => {
  const { id } = req.params;
  const agent = db.prepare(`SELECT id FROM agents WHERE id = ?`).get(id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  db.prepare(`
    UPDATE agents SET status = 'active', approved_at = unixepoch(), approved_by = ?
    WHERE id = ?
  `).run(req.user.id, id);
  db.prepare(`UPDATE users SET role = 'AGENT' WHERE id = ?`).run(id);
  res.json({ message: 'Agent approved' });
});

// ---------------------------------------------------------------------------
// POST /api/admin/agents/create
// ---------------------------------------------------------------------------
router.post('/agents/create', (req, res) => {
  const { email, userId } = req.body;
  if (!email && !userId) {
    return res.status(400).json({ error: 'Provide either email or userId' });
  }

  let user;
  if (userId) {
    user = db.prepare(`SELECT id, username, role FROM users WHERE id = ?`).get(userId.trim());
    if (!user) return res.status(404).json({ error: 'No user found with that ID' });
  } else {
    user = db.prepare(`SELECT id, username, role FROM users WHERE LOWER(email) = LOWER(?)`)
      .get(email.trim());
    if (!user) return res.status(404).json({ error: 'No user found with that email' });
  }

  const existing = db.prepare(`SELECT id, status FROM agents WHERE id = ?`).get(user.id);
  if (existing) {
    if (existing.status === 'active') {
      return res.status(400).json({ error: `${user.username} is already an active agent` });
    }
    db.prepare(`UPDATE agents SET status = 'active', approved_at = unixepoch(), approved_by = ? WHERE id = ?`)
      .run(req.user.id, user.id);
    db.prepare(`UPDATE users SET role = 'AGENT' WHERE id = ?`).run(user.id);
    return res.json({ message: `${user.username} re-activated as agent`, username: user.username });
  }

  const { generateInviteCode } = require('../helpers');
  const inviteCode = generateInviteCode();
  db.prepare(`INSERT INTO agents (id, invite_code, status, approved_at, approved_by) VALUES (?, ?, 'active', unixepoch(), ?)`)
    .run(user.id, inviteCode, req.user.id);
  db.prepare(`UPDATE users SET role = 'AGENT' WHERE id = ?`).run(user.id);

  res.status(201).json({
    message: `${user.username} added as agent`,
    username: user.username,
    userId: user.id,
    inviteCode,
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/agents/:id/remove
// ---------------------------------------------------------------------------
router.post('/agents/:id/remove', (req, res) => {
  const { id } = req.params;
  const agent = db.prepare(`
    SELECT a.id, u.username FROM agents a JOIN users u ON u.id = a.id WHERE a.id = ?
  `).get(id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  db.prepare(`DELETE FROM subordinate_agents WHERE master_id = ? OR subordinate_id = ?`).run(id, id);
  db.prepare(`DELETE FROM agency_types WHERE agent_id = ?`).run(id);
  db.prepare(`DELETE FROM bonuses WHERE agent_id = ?`).run(id);
  db.prepare(`DELETE FROM withdrawals WHERE agent_id = ?`).run(id);
  db.prepare(`DELETE FROM targets WHERE user_id = ?`).run(id);
  db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
  db.prepare(`UPDATE users SET role = 'USER' WHERE id = ?`).run(id);

  res.json({ message: `${agent.username} removed as agent` });
});

// ---------------------------------------------------------------------------
// POST /api/admin/agents/:id/reject
// ---------------------------------------------------------------------------
router.post('/agents/:id/reject', (req, res) => {
  db.prepare(`UPDATE agents SET status = 'suspended' WHERE id = ?`).run(req.params.id);
  res.json({ message: 'Agent rejected' });
});

// ---------------------------------------------------------------------------
// POST /api/admin/hosts/:id/approve
// ---------------------------------------------------------------------------
router.post('/hosts/:id/approve', (req, res) => {
  const { id } = req.params;
  const host = db.prepare(`SELECT id FROM hosts WHERE id = ?`).get(id);
  if (!host) return res.status(404).json({ error: 'Host not found' });

  db.prepare(`
    UPDATE hosts SET status = 'active', approved_at = unixepoch(), approved_by = ?
    WHERE id = ?
  `).run(req.user.id, id);
  db.prepare(`UPDATE users SET role = 'HOST' WHERE id = ?`).run(id);
  res.json({ message: 'Host approved' });
});

// ---------------------------------------------------------------------------
// POST /api/admin/hosts/:id/reject
// ---------------------------------------------------------------------------
router.post('/hosts/:id/reject', (req, res) => {
  db.prepare(`UPDATE hosts SET status = 'suspended' WHERE id = ?`).run(req.params.id);
  res.json({ message: 'Host rejected' });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/agents/:id/commission
// ---------------------------------------------------------------------------
router.patch('/agents/:id/commission', (req, res) => {
  const rate = parseFloat(req.body.rate);
  if (isNaN(rate) || rate < 0 || rate > 1)
    return res.status(400).json({ error: 'rate must be 0–1' });
  db.prepare(`UPDATE agents SET commission_rate = ? WHERE id = ?`).run(rate, req.params.id);
  res.json({ message: 'Commission updated', rate });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/hosts/:id/commission
// ---------------------------------------------------------------------------
router.patch('/hosts/:id/commission', (req, res) => {
  const rate = parseFloat(req.body.rate);
  if (isNaN(rate) || rate < 0 || rate > 1)
    return res.status(400).json({ error: 'rate must be 0–1' });
  db.prepare(`UPDATE hosts SET commission_rate = ? WHERE id = ?`).run(rate, req.params.id);
  res.json({ message: 'Commission updated', rate });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/targets/:id
// ---------------------------------------------------------------------------
router.patch('/targets/:id', (req, res) => {
  const goal = parseFloat(req.body.goal);
  if (isNaN(goal) || goal <= 0)
    return res.status(400).json({ error: 'goal must be positive' });
  const r = db.prepare(`UPDATE targets SET goal = ? WHERE id = ?`).run(goal, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Target not found' });
  res.json({ message: 'Target updated', goal });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/ban
// FIX C-02: Updates both SQLite and Prisma, revokes tokens, kicks from rooms.
// ---------------------------------------------------------------------------
router.post('/users/:id/ban', async (req, res) => {
  try {
    const { id } = req.params;
    const { banType = 'ONE_DAY' } = req.body;

    const allowedBanTypes = ['ONE_DAY', 'THREE_DAYS', 'NETWORK'];
    if (!allowedBanTypes.includes(banType)) {
      return res.status(400).json({ error: 'banType must be ONE_DAY, THREE_DAYS, or NETWORK' });
    }

    const user = db.prepare(`SELECT id, username FROM users WHERE id = ?`).get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const days = banType === 'THREE_DAYS' ? 3 : banType === 'NETWORK' ? null : 1;
    const banExpiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

    // Update SQLite
    db.prepare(`UPDATE users SET status = 'banned' WHERE id = ?`).run(id);

    // Update Prisma (PostgreSQL)
    await prisma.user.update({
      where: { id },
      data: { isBanned: true, banType, banExpiresAt },
    });

    // Revoke all active sessions
    const authService = require('../services/authService');
    await authService.revokeAllRefreshTokens(id);

    // Kick from all active rooms
    const { kickUserFromAllRooms } = require('../socket/room.socket');
    await kickUserFromAllRooms(id);

    res.json({ message: 'User banned', banType, banExpiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/unban
// ---------------------------------------------------------------------------
router.post('/users/:id/unban', async (req, res) => {
  try {
    const { id } = req.params;

    db.prepare(`UPDATE users SET status = 'active' WHERE id = ?`).run(id);

    await prisma.user.update({
      where: { id },
      data: { isBanned: false, banExpiresAt: null, banType: null },
    });

    res.json({ message: 'User unbanned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:id
// FIX L-04: All deletes wrapped in a single db.transaction().
// ---------------------------------------------------------------------------
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;

  const user = db.prepare(`SELECT id, username, role FROM users WHERE id = ?`).get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (['ADMIN', 'SUPER_ADMIN', 'admin'].includes(user.role)) {
    return res.status(403).json({ error: 'Cannot delete admin accounts' });
  }

  // FIX L-04: wrap all deletes in a single transaction
  const deleteUser = db.transaction(() => {
    db.prepare(`DELETE FROM bonuses           WHERE agent_id = ?`).run(id);
    db.prepare(`DELETE FROM withdrawals       WHERE agent_id = ?`).run(id);
    db.prepare(`DELETE FROM usdt_settlements  WHERE agent_id = ?`).run(id);
    db.prepare(`DELETE FROM agency_types      WHERE agent_id = ?`).run(id);
    db.prepare(`DELETE FROM subordinate_agents WHERE master_id = ? OR subordinate_id = ?`).run(id, id);
    db.prepare(`DELETE FROM referral_log      WHERE agent_id = ? OR invitee_id = ?`).run(id, id);
    db.prepare(`DELETE FROM targets           WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM earnings          WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM room_sessions     WHERE host_id = ?`).run(id);
    db.prepare(`DELETE FROM invitations       WHERE agent_id = ? OR invitee_id = ?`).run(id, id);
    db.prepare(`DELETE FROM gifts             WHERE sender_id = ? OR receiver_id = ?`).run(id, id);
    db.prepare(`DELETE FROM agents            WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM hosts             WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM users             WHERE id = ?`).run(id);
  });

  deleteUser();
  res.json({ message: `User ${user.username} deleted permanently` });
});

// ---------------------------------------------------------------------------
// GET /api/admin/analytics
// ---------------------------------------------------------------------------
router.get('/analytics', (req, res) => {
  const period = currentMonthPeriod();

  const totalUsers    = db.prepare(`SELECT COUNT(*) AS cnt FROM users`).get();
  const totalAgents   = db.prepare(`SELECT COUNT(*) AS cnt FROM agents WHERE status = 'active'`).get();
  const totalHosts    = db.prepare(`SELECT COUNT(*) AS cnt FROM hosts  WHERE status = 'active'`).get();
  const totalGifts    = db.prepare(`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS vol FROM gifts`).get();
  const totalEarnings = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM earnings`).get();
  const pendingApps   = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM agents WHERE status = 'pending') AS agents,
      (SELECT COUNT(*) FROM hosts  WHERE status = 'pending') AS hosts
  `).get();
  const newUsers7d = db.prepare(`
    SELECT COUNT(*) AS cnt FROM users WHERE created_at >= (unixepoch() - 7 * 86400)
  `).get();

  const monthlyHostEarnings  = db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS total FROM earnings
    WHERE type = 'host_commission' AND created_at >= unixepoch(? || '-01')
  `).get(period);
  const monthlyAgentEarnings = db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS total FROM earnings
    WHERE type = 'agent_commission' AND created_at >= unixepoch(? || '-01')
  `).get(period);
  const monthlyGifts = db.prepare(`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS vol FROM gifts
    WHERE created_at >= unixepoch(? || '-01')
  `).get(period);

  res.json({
    users:    { total: totalUsers.cnt, newLast7Days: newUsers7d.cnt },
    agents:   { active: totalAgents.cnt, pending: pendingApps.agents },
    hosts:    { active: totalHosts.cnt,  pending: pendingApps.hosts  },
    gifts:    { count: totalGifts.cnt,   volume: totalGifts.vol      },
    earnings: { total: totalEarnings.total },
    monthly: {
      period,
      hostEarnings:  monthlyHostEarnings.total,
      agentEarnings: monthlyAgentEarnings.total,
      giftsCount:    monthlyGifts.cnt,
      giftsVolume:   monthlyGifts.vol,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------
router.get('/users', (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);
  const { role, status } = req.query;

  let where = 'WHERE 1=1';
  const params = [];
  if (role)   { where += ' AND role = ?';   params.push(role); }
  if (status) { where += ' AND status = ?'; params.push(status); }

  const rows = db.prepare(`
    SELECT id, username, email, role, status, invited_by, created_at
    FROM users ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM users ${where}`).all(...params)[0];
  res.json({ page, limit, total: total.cnt, rows });
});

// ---------------------------------------------------------------------------
// GET /api/admin/agents-list
// ---------------------------------------------------------------------------
router.get('/agents-list', (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);
  const period = currentMonthPeriod();
  const { status } = req.query;

  const allowedStatuses = ['pending', 'active', 'suspended'];
  const params = [];
  let where = '';
  if (status) {
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }
    where = 'WHERE a.status = ?';
    params.push(status);
  }

  const rows = db.prepare(`
    SELECT
      a.id, a.status, a.invite_code, a.commission_rate,
      a.total_invites, a.active_invites, a.total_earnings,
      u.username, u.email,
      COALESCE(me.total, 0) AS monthly_earnings,
      COALESCE(we.total, 0) AS weekly_earnings,
      COALESCE(inv.cnt, 0)  AS monthly_invites
    FROM agents a
    JOIN users u ON u.id = a.id
    LEFT JOIN (
      SELECT user_id, SUM(amount) AS total FROM earnings
      WHERE type = 'agent_commission' AND created_at >= unixepoch(? || '-01')
      GROUP BY user_id
    ) me ON me.user_id = a.id
    LEFT JOIN (
      SELECT user_id, SUM(amount) AS total FROM earnings
      WHERE type = 'agent_commission' AND created_at >= (unixepoch() - 7*86400)
      GROUP BY user_id
    ) we ON we.user_id = a.id
    LEFT JOIN (
      SELECT agent_id, COUNT(*) AS cnt FROM invitations
      WHERE created_at >= unixepoch(? || '-01')
      GROUP BY agent_id
    ) inv ON inv.agent_id = a.id
    ${where}
    ORDER BY a.total_earnings DESC
    LIMIT ? OFFSET ?
  `).all(period, period, ...params, limit, offset);

  const total = db.prepare(
    `SELECT COUNT(*) AS cnt FROM agents a ${where}`
  ).get(...params);

  const { syncAgentTargets } = require('./agents');
  const enriched = rows.map(r => ({
    ...r,
    targets: syncAgentTargets(r.id),
  }));

  res.json({ page, limit, total: total.cnt, period, rows: enriched });
});

// ---------------------------------------------------------------------------
// GET /api/admin/hosts-list
// ---------------------------------------------------------------------------
router.get('/hosts-list', (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);
  const period = currentMonthPeriod();
  const { status } = req.query;

  const allowedStatuses = ['pending', 'active', 'suspended'];
  const params = [];
  let where = '';
  if (status) {
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }
    where = 'WHERE h.status = ?';
    params.push(status);
  }

  const rows = db.prepare(`
    SELECT
      h.id, h.status, h.commission_rate,
      h.total_room_time, h.total_gifts, h.total_earnings,
      ROUND(h.total_room_time / 3600.0, 2) AS total_hours,
      u.username, u.email,
      COALESCE(me.total, 0)  AS monthly_earnings,
      COALESCE(we.total, 0)  AS weekly_earnings,
      COALESCE(mg.cnt, 0)    AS monthly_gifts_count,
      COALESCE(mg.vol, 0)    AS monthly_gifts_volume
    FROM hosts h
    JOIN users u ON u.id = h.id
    LEFT JOIN (
      SELECT user_id, SUM(amount) AS total FROM earnings
      WHERE type = 'host_commission' AND created_at >= unixepoch(? || '-01')
      GROUP BY user_id
    ) me ON me.user_id = h.id
    LEFT JOIN (
      SELECT user_id, SUM(amount) AS total FROM earnings
      WHERE type = 'host_commission' AND created_at >= (unixepoch() - 7*86400)
      GROUP BY user_id
    ) we ON we.user_id = h.id
    LEFT JOIN (
      SELECT receiver_id, COUNT(*) AS cnt, SUM(amount) AS vol FROM gifts
      WHERE created_at >= unixepoch(? || '-01')
      GROUP BY receiver_id
    ) mg ON mg.receiver_id = h.id
    ${where}
    ORDER BY h.total_earnings DESC
    LIMIT ? OFFSET ?
  `).all(period, period, ...params, limit, offset);

  const total = db.prepare(
    `SELECT COUNT(*) AS cnt FROM hosts h ${where}`
  ).get(...params);

  const { syncHostTargets } = require('./hosts');
  const enriched = rows.map(r => ({
    ...r,
    targets: syncHostTargets(r.id),
  }));

  res.json({ page, limit, total: total.cnt, period, rows: enriched });
});

// ---------------------------------------------------------------------------
// GET /api/admin/earnings-breakdown
// FIX M-02: Replaced string-interpolated SQL with parameterized queries.
// ---------------------------------------------------------------------------
router.get('/earnings-breakdown', (req, res) => {
  const period = currentMonthPeriod();

  const byType = db.prepare(`
    SELECT type, COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt
    FROM earnings
    GROUP BY type
  `).all();

  // FIX M-02: use parameterized query instead of template literal interpolation
  const topHosts = db.prepare(`
    SELECT u.username, h.total_earnings, h.total_gifts,
           ROUND(h.total_room_time/3600.0,2) AS hours,
           COALESCE(me.total,0) AS monthly_earnings
    FROM hosts h
    JOIN users u ON u.id = h.id
    LEFT JOIN (
      SELECT user_id, SUM(amount) AS total FROM earnings
      WHERE type = 'host_commission' AND created_at >= unixepoch(? || '-01')
      GROUP BY user_id
    ) me ON me.user_id = h.id
    WHERE h.status = 'active'
    ORDER BY monthly_earnings DESC
    LIMIT 5
  `).all(period);

  const topAgents = db.prepare(`
    SELECT u.username, a.total_earnings, a.total_invites,
           COALESCE(me.total,0) AS monthly_earnings
    FROM agents a
    JOIN users u ON u.id = a.id
    LEFT JOIN (
      SELECT user_id, SUM(amount) AS total FROM earnings
      WHERE type = 'agent_commission' AND created_at >= unixepoch(? || '-01')
      GROUP BY user_id
    ) me ON me.user_id = a.id
    WHERE a.status = 'active'
    ORDER BY monthly_earnings DESC
    LIMIT 5
  `).all(period);

  const daily = db.prepare(`
    SELECT
      date(created_at, 'unixepoch') AS day,
      COALESCE(SUM(CASE WHEN type='host_commission'  THEN amount ELSE 0 END),0) AS host_earnings,
      COALESCE(SUM(CASE WHEN type='agent_commission' THEN amount ELSE 0 END),0) AS agent_earnings,
      COUNT(*) AS transactions
    FROM earnings
    WHERE created_at >= (unixepoch() - 7*86400)
    GROUP BY day
    ORDER BY day ASC
  `).all();

  res.json({ period, byType, topHosts, topAgents, daily });
});

module.exports = router;
