/**
 * Financial Management routes — earnings, bonuses, withdrawals.
 *
 * GET    /api/financial/earnings/summary        — current vs previous month
 * GET    /api/financial/earnings/breakdown      — by source (gift, referral, override)
 * GET    /api/financial/bonuses                 — agent's bonus records
 * POST   /api/financial/bonuses/calculate       — trigger bonus calculation for period
 * POST   /api/financial/bonuses/:id/claim       — claim a bonus
 * GET    /api/financial/withdrawals             — agent's withdrawal history
 * POST   /api/financial/withdrawals/request     — submit withdrawal request
 * GET    /api/financial/withdrawals/all         — admin: all withdrawal requests
 * PATCH  /api/financial/withdrawals/:id/approve — admin: approve withdrawal
 * PATCH  /api/financial/withdrawals/:id/reject  — admin: reject withdrawal
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate: requireAuth, requireRole } = require('../middleware/authMiddleware');
const { currentMonthPeriod, parsePagination } = require('../helpers');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Bonus thresholds (configurable via env or hardcoded defaults)
// ---------------------------------------------------------------------------
const INVITE_BONUS_THRESHOLD  = parseInt(process.env.INVITE_BONUS_THRESHOLD  ?? '30',    10);
const VOLUME_BONUS_THRESHOLD  = parseFloat(process.env.VOLUME_BONUS_THRESHOLD ?? '10000');
const INVITE_BONUS_AMOUNT     = parseFloat(process.env.INVITE_BONUS_AMOUNT    ?? '500');
const VOLUME_BONUS_AMOUNT     = parseFloat(process.env.VOLUME_BONUS_AMOUNT    ?? '1000');
const FULL_BONUS_AMOUNT       = parseFloat(process.env.FULL_BONUS_AMOUNT      ?? '2000');
const MIN_WITHDRAWAL          = parseFloat(process.env.MIN_WITHDRAWAL         ?? '50');

// ---------------------------------------------------------------------------
// Helper — previous month period string "YYYY-MM"
// ---------------------------------------------------------------------------
function previousMonthPeriod() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// GET /api/financial/earnings/summary
// Returns current month, previous month, trend %, and breakdown
// ---------------------------------------------------------------------------
router.get('/earnings/summary', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const agentId = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN' ? (req.query.agentId || req.user.id) : req.user.id;

  const cur  = currentMonthPeriod();
  const prev = previousMonthPeriod();

  const currentEarnings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM earnings
    WHERE user_id = ? AND type = 'agent_commission'
      AND created_at >= unixepoch(? || '-01')
      AND created_at <  unixepoch(? || '-01', '+1 month')
  `).get(agentId, cur, cur);

  const previousEarnings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM earnings
    WHERE user_id = ? AND type = 'agent_commission'
      AND created_at >= unixepoch(? || '-01')
      AND created_at <  unixepoch(? || '-01', '+1 month')
  `).get(agentId, prev, prev);

  const curTotal  = currentEarnings.total;
  const prevTotal = previousEarnings.total;
  const trendPct  = prevTotal > 0
    ? +((curTotal - prevTotal) / prevTotal * 100).toFixed(2)
    : (curTotal > 0 ? 100 : 0);

  // Breakdown by source for current month
  const giftCommission = db.prepare(`
    SELECT COALESCE(SUM(e.amount), 0) AS total
    FROM earnings e
    WHERE e.user_id = ? AND e.type = 'agent_commission'
      AND e.created_at >= unixepoch(? || '-01')
  `).get(agentId, cur);

  // Referral bonuses from bonuses table
  const referralBonuses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM bonuses
    WHERE agent_id = ? AND period = ? AND type != 'full_bonus'
  `).get(agentId, cur);

  // Sub-agency override: earnings from subordinates' activity
  const subOverride = db.prepare(`
    SELECT COALESCE(SUM(e.amount), 0) AS total
    FROM earnings e
    JOIN subordinate_agents sa ON sa.subordinate_id = e.user_id
    WHERE sa.master_id = ? AND e.type = 'agent_commission'
      AND e.created_at >= unixepoch(? || '-01')
  `).get(agentId, cur);

  res.json({
    currentPeriod:  cur,
    previousPeriod: prev,
    currentTotal:   curTotal,
    previousTotal:  prevTotal,
    trendPercent:   trendPct,
    trendDirection: trendPct >= 0 ? 'up' : 'down',
    breakdown: {
      giftCommissions:    giftCommission.total,
      referralBonuses:    referralBonuses.total,
      subAgencyOverrides: subOverride.total,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/financial/earnings/breakdown?period=YYYY-MM
// ---------------------------------------------------------------------------
router.get('/earnings/breakdown', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const agentId = (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') && req.query.agentId
    ? req.query.agentId
    : req.user.id;
  const period = req.query.period ?? currentMonthPeriod();

  const rows = db.prepare(`
    SELECT
      e.id, e.amount, e.type, e.created_at,
      g.amount AS gift_amount,
      sender.username AS sender_username
    FROM earnings e
    LEFT JOIN gifts g ON g.id = e.ref_id
    LEFT JOIN users sender ON sender.id = g.sender_id
    WHERE e.user_id = ? AND e.type = 'agent_commission'
      AND e.created_at >= unixepoch(? || '-01')
    ORDER BY e.created_at DESC
    LIMIT 100
  `).all(agentId, period);

  res.json({ period, rows });
});

// ---------------------------------------------------------------------------
// GET /api/financial/bonuses
// ---------------------------------------------------------------------------
router.get('/bonuses', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const agentId = (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') && req.query.agentId
    ? req.query.agentId
    : req.user.id;
  const period = req.query.period ?? currentMonthPeriod();

  const bonuses = db.prepare(`
    SELECT * FROM bonuses WHERE agent_id = ? AND period = ? ORDER BY created_at DESC
  `).all(agentId, period);

  // Progress toward thresholds
  const agent = db.prepare(`SELECT total_invites FROM agents WHERE id = ?`).get(agentId);
  const periodEarnings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM earnings
    WHERE user_id = ? AND type = 'agent_commission'
      AND created_at >= unixepoch(? || '-01')
  `).get(agentId, period);

  const inviteCurrent  = agent?.total_invites ?? 0;
  const volumeCurrent  = periodEarnings.total;

  res.json({
    period,
    bonuses,
    progress: {
      invites: {
        current:   inviteCurrent,
        threshold: INVITE_BONUS_THRESHOLD,
        pct:       Math.min(100, Math.round(inviteCurrent / INVITE_BONUS_THRESHOLD * 100)),
        reward:    INVITE_BONUS_AMOUNT,
        met:       inviteCurrent >= INVITE_BONUS_THRESHOLD,
      },
      volume: {
        current:   volumeCurrent,
        threshold: VOLUME_BONUS_THRESHOLD,
        pct:       Math.min(100, Math.round(volumeCurrent / VOLUME_BONUS_THRESHOLD * 100)),
        reward:    VOLUME_BONUS_AMOUNT,
        met:       volumeCurrent >= VOLUME_BONUS_THRESHOLD,
      },
      fullBonus: {
        reward: FULL_BONUS_AMOUNT,
        met:    inviteCurrent >= INVITE_BONUS_THRESHOLD && volumeCurrent >= VOLUME_BONUS_THRESHOLD,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/financial/bonuses/calculate
// Calculates and records bonuses for the current period (idempotent)
// ---------------------------------------------------------------------------
router.post('/bonuses/calculate', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const agentId = (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') && req.body.agentId
    ? req.body.agentId
    : req.user.id;
  const period = currentMonthPeriod();

  const agent = db.prepare(`SELECT total_invites FROM agents WHERE id = ?`).get(agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const periodEarnings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM earnings
    WHERE user_id = ? AND type = 'agent_commission'
      AND created_at >= unixepoch(? || '-01')
  `).get(agentId, period);

  const inviteMet = agent.total_invites >= INVITE_BONUS_THRESHOLD;
  const volumeMet = periodEarnings.total >= VOLUME_BONUS_THRESHOLD;

  const created = [];

  const upsertBonus = (type, amount) => {
    const existing = db.prepare(
      `SELECT id FROM bonuses WHERE agent_id = ? AND type = ? AND period = ?`
    ).get(agentId, type, period);
    if (!existing) {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO bonuses (id, agent_id, type, amount, period)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, agentId, type, amount, period);
      created.push({ type, amount });
    }
  };

  if (inviteMet) upsertBonus('invite_bonus', INVITE_BONUS_AMOUNT);
  if (volumeMet) upsertBonus('volume_bonus', VOLUME_BONUS_AMOUNT);
  if (inviteMet && volumeMet) upsertBonus('full_bonus', FULL_BONUS_AMOUNT);

  res.json({ period, created, message: created.length ? 'Bonuses calculated' : 'No new bonuses' });
});

// ---------------------------------------------------------------------------
// POST /api/financial/bonuses/:id/claim
// ---------------------------------------------------------------------------
router.post('/bonuses/:id/claim', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const bonus = db.prepare(`SELECT * FROM bonuses WHERE id = ?`).get(req.params.id);
  if (!bonus) return res.status(404).json({ error: 'Bonus not found' });
  if (bonus.agent_id !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Not your bonus' });
  }
  if (bonus.claimed) return res.status(400).json({ error: 'Already claimed' });

  db.prepare(`UPDATE bonuses SET claimed = 1, claimed_at = unixepoch() WHERE id = ?`)
    .run(req.params.id);

  // Credit earnings ledger
  db.prepare(`
    INSERT INTO earnings (id, user_id, type, amount, ref_id)
    VALUES (?, ?, 'agent_commission', ?, ?)
  `).run(uuidv4(), bonus.agent_id, bonus.amount, bonus.id);

  db.prepare(`UPDATE agents SET total_earnings = total_earnings + ? WHERE id = ?`)
    .run(bonus.amount, bonus.agent_id);

  res.json({ message: 'Bonus claimed', amount: bonus.amount });
});

// ---------------------------------------------------------------------------
// GET /api/financial/withdrawals
// ---------------------------------------------------------------------------
router.get('/withdrawals', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const agentId = (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') && req.query.agentId
    ? req.query.agentId
    : req.user.id;
  const { limit, offset, page } = parsePagination(req.query);

  const rows = db.prepare(`
    SELECT * FROM withdrawals WHERE agent_id = ?
    ORDER BY requested_at DESC LIMIT ? OFFSET ?
  `).all(agentId, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM withdrawals WHERE agent_id = ?`).get(agentId);

  // Withdrawable balance = total_earnings - sum of approved/pending withdrawals
  const agent = db.prepare(`SELECT total_earnings FROM agents WHERE id = ?`).get(agentId);
  const committed = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals
    WHERE agent_id = ? AND status IN ('pending', 'approved')
  `).get(agentId);

  const withdrawable = Math.max(0, (agent?.total_earnings ?? 0) - committed.total);

  res.json({ page, limit, total: total.cnt, withdrawable, rows });
});

// ---------------------------------------------------------------------------
// POST /api/financial/withdrawals/request
// Body: { amount, method, account_details }
// ---------------------------------------------------------------------------
router.post('/withdrawals/request', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const agentId = req.user.id;
  const { amount, method, account_details } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'amount must be positive' });
  }
  if (Number(amount) < MIN_WITHDRAWAL) {
    return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} Diamonds` });
  }
  if (!method || !account_details) {
    return res.status(400).json({ error: 'method and account_details are required' });
  }

  // Check withdrawable balance
  const agent = db.prepare(`SELECT total_earnings FROM agents WHERE id = ?`).get(agentId);
  const committed = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals
    WHERE agent_id = ? AND status IN ('pending', 'approved')
  `).get(agentId);
  const withdrawable = Math.max(0, (agent?.total_earnings ?? 0) - committed.total);

  if (Number(amount) > withdrawable) {
    return res.status(400).json({
      error: `Amount exceeds withdrawable balance (${withdrawable.toFixed(2)} Diamonds)`,
    });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO withdrawals (id, agent_id, amount, method, account_details)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, agentId, Number(amount), method, account_details);

  res.status(201).json({ id, message: 'Withdrawal request submitted', status: 'pending' });
});

// ---------------------------------------------------------------------------
// GET /api/financial/withdrawals/all  — admin
// ---------------------------------------------------------------------------
router.get('/withdrawals/all', requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);
  const { status } = req.query;

  let where = 'WHERE 1=1';
  const params = [];
  if (status) { where += ' AND w.status = ?'; params.push(status); }

  const rows = db.prepare(`
    SELECT w.*, u.username, u.email
    FROM withdrawals w
    JOIN users u ON u.id = w.agent_id
    ${where}
    ORDER BY w.requested_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM withdrawals w ${where}`).all(...params)[0];
  res.json({ page, limit, total: total.cnt, rows });
});

// ---------------------------------------------------------------------------
// PATCH /api/financial/withdrawals/:id/approve  — admin
// ---------------------------------------------------------------------------
router.patch('/withdrawals/:id/approve', requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const w = db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Withdrawal not found' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Only pending withdrawals can be approved' });

  db.prepare(`
    UPDATE withdrawals SET status = 'approved', resolved_at = unixepoch(), resolved_by = ?
    WHERE id = ?
  `).run(req.user.id, req.params.id);

  res.json({ message: 'Withdrawal approved' });
});

// ---------------------------------------------------------------------------
// PATCH /api/financial/withdrawals/:id/reject  — admin
// Body: { reason }
// ---------------------------------------------------------------------------
router.patch('/withdrawals/:id/reject', requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'rejection reason is required' });
  }

  const w = db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Withdrawal not found' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Only pending withdrawals can be rejected' });

  db.prepare(`
    UPDATE withdrawals
    SET status = 'rejected', rejection_reason = ?, resolved_at = unixepoch(), resolved_by = ?
    WHERE id = ?
  `).run(reason.trim(), req.user.id, req.params.id);

  res.json({ message: 'Withdrawal rejected' });
});

module.exports = router;
