/**
 * Agent routes — targets + earnings fully synced from live data.
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate: requireAuth, requireRole } = require('../middleware/authMiddleware');
const { generateInviteCode, currentMonthPeriod, parsePagination } = require('../helpers');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Internal helper — sync all agent targets from live data, return rows
// ---------------------------------------------------------------------------
function syncAgentTargets(agentId) {
  const period = currentMonthPeriod();

  const defaults = [
    { metric: 'invites',      goal: 50,    cycle: 'monthly' },
    { metric: 'coins_earned', goal: 10000, cycle: 'monthly' },
    { metric: 'active_users', goal: 20,    cycle: 'monthly' },
  ];

  for (const t of defaults) {
    const exists = db.prepare(
      `SELECT id FROM targets WHERE user_id = ? AND metric = ? AND period = ?`
    ).get(agentId, t.metric, period);

    if (!exists) {
      db.prepare(`
        INSERT INTO targets (id, user_id, role, metric, goal, current, cycle, period)
        VALUES (?, ?, 'agent', ?, ?, 0, ?, ?)
      `).run(uuidv4(), agentId, t.metric, t.goal, t.cycle, period);
    }
  }

  // Pull live values
  const agent = db.prepare(
    `SELECT total_invites, active_invites, total_earnings FROM agents WHERE id = ?`
  ).get(agentId);

  if (agent) {
    // Period earnings from ledger (more accurate than total_earnings for monthly)
    const periodEarnings = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM earnings
      WHERE user_id = ? AND type = 'agent_commission'
        AND created_at >= unixepoch(? || '-01')
    `).get(agentId, period);

    db.prepare(`UPDATE targets SET current = ? WHERE user_id = ? AND metric = ? AND period = ?`)
      .run(agent.total_invites, agentId, 'invites', period);
    db.prepare(`UPDATE targets SET current = ? WHERE user_id = ? AND metric = ? AND period = ?`)
      .run(periodEarnings.total, agentId, 'coins_earned', period);
    db.prepare(`UPDATE targets SET current = ? WHERE user_id = ? AND metric = ? AND period = ?`)
      .run(agent.active_invites, agentId, 'active_users', period);
  }

  const rows = db.prepare(
    `SELECT * FROM targets WHERE user_id = ? AND period = ? ORDER BY metric`
  ).all(agentId, period);

  return rows.map(t => ({
    ...t,
    progress: t.goal > 0 ? Math.min(100, Math.round((t.current / t.goal) * 100)) : 0,
  }));
}

// Export for use in admin route
module.exports.syncAgentTargets = syncAgentTargets;

// ---------------------------------------------------------------------------
// POST /api/agents/apply
// ---------------------------------------------------------------------------
router.post('/apply', (req, res) => {
  const userId = req.user.id;
  const existing = db.prepare(`SELECT id FROM agents WHERE id = ?`).get(userId);
  if (existing) return res.status(400).json({ error: 'Already applied or registered as agent' });

  const inviteCode = generateInviteCode();
  db.prepare(`INSERT INTO agents (id, invite_code, status) VALUES (?, ?, 'pending')`)
    .run(userId, inviteCode);

  res.status(201).json({ message: 'Application submitted, pending admin approval', inviteCode });
});

// ---------------------------------------------------------------------------
// GET /api/agents/dashboard
// ---------------------------------------------------------------------------
router.get('/dashboard', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const agentId = (['ADMIN', 'SUPER_ADMIN'].includes(req.user.role) && req.query.agentId)
    ? req.query.agentId
    : req.user.id;

  const agent = db.prepare(`
    SELECT a.*, u.username, u.email
    FROM agents a JOIN users u ON u.id = a.id
    WHERE a.id = ?
  `).get(agentId);

  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const period = currentMonthPeriod();

  const monthlyEarnings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM earnings
    WHERE user_id = ? AND type = 'agent_commission'
      AND created_at >= unixepoch(? || '-01')
  `).get(agentId, period);

  const weeklyEarnings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM earnings
    WHERE user_id = ? AND type = 'agent_commission'
      AND created_at >= (unixepoch() - 7 * 86400)
  `).get(agentId);

  const recentInvitees = db.prepare(`
    SELECT u.id, u.username, u.status, u.created_at
    FROM invitations i
    JOIN users u ON u.id = i.invitee_id
    WHERE i.agent_id = ?
    ORDER BY i.created_at DESC
    LIMIT 10
  `).all(agentId);

  // Rank among active agents by total_earnings
  const rank = db.prepare(`
    SELECT COUNT(*) + 1 AS rank
    FROM agents
    WHERE total_earnings > (SELECT total_earnings FROM agents WHERE id = ?)
      AND status = 'active'
  `).get(agentId);

  const targets = syncAgentTargets(agentId);

  res.json({
    agent: {
      id:             agent.id,
      username:       agent.username,
      email:          agent.email,
      inviteCode:     agent.invite_code,
      status:         agent.status,
      commissionRate: agent.commission_rate,
      totalInvites:   agent.total_invites,
      activeInvites:  agent.active_invites,
      totalEarnings:  agent.total_earnings,
      cycleStart:     agent.cycle_start,
    },
    stats: {
      monthlyEarnings: monthlyEarnings.total,
      weeklyEarnings:  weeklyEarnings.total,
    },
    rank: rank.rank,
    targets,
    recentInvitees,
  });
});

// ---------------------------------------------------------------------------
// GET /api/agents/invite-code
// ---------------------------------------------------------------------------
router.get('/invite-code', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const agent = db.prepare(`SELECT invite_code FROM agents WHERE id = ?`).get(req.user.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const baseUrl = process.env.APP_URL || 'https://yourapp.com';
  res.json({
    inviteCode: agent.invite_code,
    inviteLink: `${baseUrl}/register?ref=${agent.invite_code}`,
  });
});

// ---------------------------------------------------------------------------
// GET /api/agents/targets
// ---------------------------------------------------------------------------
router.get('/targets', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const agentId = req.user.id;
  const targets = syncAgentTargets(agentId);
  res.json({ period: currentMonthPeriod(), targets });
});

// ---------------------------------------------------------------------------
// GET /api/agents/earnings?page=1&limit=20
// ---------------------------------------------------------------------------
router.get('/earnings', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);

  const rows = db.prepare(`
    SELECT
      e.id, e.amount, e.type, e.created_at,
      g.amount     AS gift_amount,
      g.room_id    AS gift_room_id,
      g.sender_id,
      sender.username AS sender_username,
      receiver.username AS host_username
    FROM earnings e
    LEFT JOIN gifts g        ON g.id = e.ref_id
    LEFT JOIN users sender   ON sender.id = g.sender_id
    LEFT JOIN users receiver ON receiver.id = g.receiver_id
    WHERE e.user_id = ? AND e.type = 'agent_commission'
    ORDER BY e.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) AS cnt FROM earnings WHERE user_id = ? AND type = 'agent_commission'
  `).get(req.user.id);

  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(e.amount), 0)  AS total_earned,
      COALESCE(SUM(g.amount), 0)  AS total_gifts_volume,
      COUNT(*)                     AS total_transactions
    FROM earnings e
    LEFT JOIN gifts g ON g.id = e.ref_id
    WHERE e.user_id = ? AND e.type = 'agent_commission'
  `).get(req.user.id);

  res.json({ page, limit, total: total.cnt, summary, rows });
});

module.exports = router;
module.exports.syncAgentTargets = syncAgentTargets;
