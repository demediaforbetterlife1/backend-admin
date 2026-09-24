/**
 * Agency Hierarchy & Recruitment routes.
 *
 * POST   /api/hierarchy/subordinates/add        — master adds a subordinate by UID
 * GET    /api/hierarchy/subordinates            — master's subordinate list
 * PATCH  /api/hierarchy/subordinates/:id/status — suspend / activate subordinate
 * DELETE /api/hierarchy/subordinates/:id        — remove subordinate
 * GET    /api/hierarchy/referrals               — agent's referral log
 * GET    /api/hierarchy/referrals/summary       — totals: referrals, active, commission
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { currentMonthPeriod, parsePagination } = require('../helpers');

const router = express.Router();
router.use(authenticate, requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'));

// ---------------------------------------------------------------------------
// POST /api/hierarchy/subordinates/add
// Body: { subordinateUid }  — UID is the user's id (UUID string)
// ---------------------------------------------------------------------------
router.post('/subordinates/add', (req, res) => {
  const masterId = req.user.id;
  const { subordinateUid, commissionRate } = req.body;

  if (!subordinateUid) {
    return res.status(400).json({ error: 'subordinateUid is required' });
  }

  // Validate UID format: must be a valid UUID or a 6–12 digit numeric string
  const isUuid    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subordinateUid);
  const isNumeric = /^\d{6,12}$/.test(subordinateUid);
  if (!isUuid && !isNumeric) {
    return res.status(400).json({ error: 'subordinateUid must be a valid UUID or a 6–12 digit numeric ID' });
  }

  // Look up the user
  const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(subordinateUid);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Must be an active agent
  const subAgent = db.prepare(`SELECT id FROM agents WHERE id = ? AND status = 'active'`).get(subordinateUid);
  if (!subAgent) return res.status(400).json({ error: 'Target user is not an active agent' });

  // Cannot add yourself
  if (subordinateUid === masterId) {
    return res.status(400).json({ error: 'Cannot add yourself as a subordinate' });
  }

  // Check for existing relationship
  const existing = db.prepare(`
    SELECT id FROM subordinate_agents WHERE master_id = ? AND subordinate_id = ?
  `).get(masterId, subordinateUid);
  if (existing) return res.status(400).json({ error: 'Already a subordinate' });

  const rate = commissionRate != null ? parseFloat(commissionRate) : 0.08;
  if (isNaN(rate) || rate < 0 || rate > 1) {
    return res.status(400).json({ error: 'commissionRate must be between 0 and 1' });
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO subordinate_agents (id, master_id, subordinate_id, commission_rate)
    VALUES (?, ?, ?, ?)
  `).run(id, masterId, subordinateUid, rate);

  res.status(201).json({ id, message: 'Subordinate agent added' });
});

// ---------------------------------------------------------------------------
// GET /api/hierarchy/subordinates
// ---------------------------------------------------------------------------
router.get('/subordinates', (req, res) => {
  const masterId = (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') && req.query.masterId
    ? req.query.masterId
    : req.user.id;

  const rows = db.prepare(`
    SELECT
      sa.id, sa.status, sa.commission_rate, sa.created_at,
      a.invite_code, a.total_invites, a.active_invites, a.total_earnings,
      u.id AS agent_user_id, u.username, u.email
    FROM subordinate_agents sa
    JOIN agents a ON a.id = sa.subordinate_id
    JOIN users  u ON u.id = sa.subordinate_id
    WHERE sa.master_id = ?
    ORDER BY sa.created_at DESC
  `).all(masterId);

  // Aggregate stats
  const totalInvites  = rows.reduce((s, r) => s + r.total_invites, 0);
  const totalEarnings = rows.reduce((s, r) => s + r.total_earnings, 0);
  const activeCount   = rows.filter(r => r.status === 'active').length;

  res.json({
    subordinates: rows,
    stats: {
      total:         rows.length,
      active:        activeCount,
      totalInvites,
      totalEarnings,
    },
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/hierarchy/subordinates/:id/status
// Body: { status }  — active | suspended
// ---------------------------------------------------------------------------
router.patch('/subordinates/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'status must be active or suspended' });
  }

  const masterId = req.user.id;
  const rel = db.prepare(`SELECT id FROM subordinate_agents WHERE id = ? AND master_id = ?`)
    .get(req.params.id, masterId);

  if (!rel && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Not your subordinate' });
  }

  db.prepare(`UPDATE subordinate_agents SET status = ? WHERE id = ?`)
    .run(status, req.params.id);

  res.json({ message: `Subordinate ${status}` });
});

// ---------------------------------------------------------------------------
// DELETE /api/hierarchy/subordinates/:id
// ---------------------------------------------------------------------------
router.delete('/subordinates/:id', (req, res) => {
  const masterId = req.user.id;
  const rel = db.prepare(`SELECT id FROM subordinate_agents WHERE id = ? AND master_id = ?`)
    .get(req.params.id, masterId);

  if (!rel && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Not your subordinate' });
  }

  db.prepare(`DELETE FROM subordinate_agents WHERE id = ?`).run(req.params.id);
  res.json({ message: 'Subordinate removed' });
});

// ---------------------------------------------------------------------------
// GET /api/hierarchy/referrals?page=1&limit=20
// ---------------------------------------------------------------------------
router.get('/referrals', (req, res) => {
  const agentId = (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') && req.query.agentId
    ? req.query.agentId
    : req.user.id;
  const { limit, offset, page } = parsePagination(req.query);
  const period = currentMonthPeriod();

  const rows = db.prepare(`
    SELECT
      rl.id, rl.event_type, rl.commission, rl.created_at,
      u.id AS invitee_id, u.username, u.status AS invitee_status,
      COALESCE(gm.cnt, 0)   AS gifts_this_month,
      COALESCE(gm.vol, 0)   AS gift_volume_this_month
    FROM referral_log rl
    JOIN users u ON u.id = rl.invitee_id
    LEFT JOIN (
      SELECT sender_id, COUNT(*) AS cnt, SUM(amount) AS vol
      FROM gifts
      WHERE created_at >= unixepoch(? || '-01')
      GROUP BY sender_id
    ) gm ON gm.sender_id = rl.invitee_id
    WHERE rl.agent_id = ?
    ORDER BY rl.created_at DESC
    LIMIT ? OFFSET ?
  `).all(period, agentId, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM referral_log WHERE agent_id = ?`).get(agentId);

  res.json({ page, limit, total: total.cnt, rows });
});

// ---------------------------------------------------------------------------
// GET /api/hierarchy/referrals/summary
// ---------------------------------------------------------------------------
router.get('/referrals/summary', (req, res) => {
  const agentId = (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') && req.query.agentId
    ? req.query.agentId
    : req.user.id;
  const period = currentMonthPeriod();

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM referral_log WHERE agent_id = ?`).get(agentId);

  const active = db.prepare(`
    SELECT COUNT(DISTINCT rl.invitee_id) AS cnt
    FROM referral_log rl
    JOIN gifts g ON g.sender_id = rl.invitee_id
    WHERE rl.agent_id = ? AND g.created_at >= unixepoch(? || '-01')
  `).get(agentId, period);

  const commission = db.prepare(`
    SELECT COALESCE(SUM(commission), 0) AS total FROM referral_log WHERE agent_id = ?
  `).get(agentId);

  res.json({
    totalReferrals:    total.cnt,
    activeThisMonth:   active.cnt,
    totalCommission:   commission.total,
    period,
  });
});

module.exports = router;
