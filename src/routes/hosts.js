/**
 * Host routes — fully working targets + earnings calculation.
 *
 * POST   /api/hosts/apply           — user applies to become a host
 * GET    /api/hosts/dashboard       — host's own dashboard
 * GET    /api/hosts/targets         — current cycle targets + live progress
 * GET    /api/hosts/earnings        — earnings history (paginated)
 * POST   /api/hosts/session/start   — record room session start
 * POST   /api/hosts/session/end     — record room session end + update time target
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate: requireAuth, requireRole } = require('../middleware/authMiddleware');
const { currentMonthPeriod, parsePagination } = require('../helpers');

const router = express.Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Helper — upsert all three host targets for the current period and sync
// their `current` values from live data.  Returns the updated target rows.
// ---------------------------------------------------------------------------
function syncHostTargets(hostId) {
  const period = currentMonthPeriod();

  const defaults = [
    { metric: 'active_hours',   goal: 100,   cycle: 'monthly' },
    { metric: 'coins_earned',   goal: 10000, cycle: 'monthly' },
    { metric: 'gifts_received', goal: 50,    cycle: 'monthly' },
  ];

  // Ensure rows exist
  for (const t of defaults) {
    const exists = db.prepare(
      `SELECT id FROM targets WHERE user_id = ? AND metric = ? AND period = ?`
    ).get(hostId, t.metric, period);

    if (!exists) {
      db.prepare(`
        INSERT INTO targets (id, user_id, role, metric, goal, current, cycle, period)
        VALUES (?, ?, 'host', ?, ?, 0, ?, ?)
      `).run(uuidv4(), hostId, t.metric, t.goal, t.cycle, period);
    }
  }

  // Pull live values from hosts table
  const host = db.prepare(
    `SELECT total_room_time, total_earnings, total_gifts FROM hosts WHERE id = ?`
  ).get(hostId);

  if (host) {
    const hours = +(host.total_room_time / 3600).toFixed(4);

    // Count gifts received this period from the gifts table (more accurate)
    const periodGifts = db.prepare(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS vol
      FROM gifts
      WHERE receiver_id = ?
        AND created_at >= unixepoch(? || '-01')
    `).get(hostId, period);

    // Earnings this period from the earnings ledger
    const periodEarnings = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM earnings
      WHERE user_id = ? AND type = 'host_commission'
        AND created_at >= unixepoch(? || '-01')
    `).get(hostId, period);

    db.prepare(
      `UPDATE targets SET current = ? WHERE user_id = ? AND metric = ? AND period = ?`
    ).run(hours, hostId, 'active_hours', period);

    db.prepare(
      `UPDATE targets SET current = ? WHERE user_id = ? AND metric = ? AND period = ?`
    ).run(periodEarnings.total, hostId, 'coins_earned', period);

    db.prepare(
      `UPDATE targets SET current = ? WHERE user_id = ? AND metric = ? AND period = ?`
    ).run(periodGifts.cnt, hostId, 'gifts_received', period);
  }

  const rows = db.prepare(
    `SELECT * FROM targets WHERE user_id = ? AND period = ? ORDER BY metric`
  ).all(hostId, period);

  return rows.map(t => ({
    ...t,
    progress: t.goal > 0 ? Math.min(100, Math.round((t.current / t.goal) * 100)) : 0,
  }));
}

// ---------------------------------------------------------------------------
// POST /api/hosts/apply
// ---------------------------------------------------------------------------
router.post('/apply', (req, res) => {
  const userId = req.user.id;

  const existing = db.prepare(`SELECT id FROM hosts WHERE id = ?`).get(userId);
  if (existing) {
    return res.status(400).json({ error: 'Already applied or registered as host' });
  }

  db.prepare(`INSERT INTO hosts (id, status) VALUES (?, 'pending')`).run(userId);
  res.status(201).json({ message: 'Application submitted, pending admin approval' });
});

// ---------------------------------------------------------------------------
// GET /api/hosts/dashboard
// ---------------------------------------------------------------------------
router.get('/dashboard', requireRole('HOST', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const hostId = (['ADMIN', 'SUPER_ADMIN'].includes(req.user.role) && req.query.hostId)
    ? req.query.hostId
    : req.user.id;

  const host = db.prepare(`
    SELECT h.*, u.username, u.email
    FROM hosts h
    JOIN users u ON u.id = h.id
    WHERE h.id = ?
  `).get(hostId);

  if (!host) return res.status(404).json({ error: 'Host not found' });

  const period = currentMonthPeriod();

  // Weekly earnings (last 7 days)
  const weeklyEarnings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM earnings
    WHERE user_id = ? AND type = 'host_commission'
      AND created_at >= (unixepoch() - 7 * 86400)
  `).get(hostId);

  // Monthly earnings
  const monthlyEarnings = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM earnings
    WHERE user_id = ? AND type = 'host_commission'
      AND created_at >= unixepoch(? || '-01')
  `).get(hostId, period);

  // Daily gifts (last 24 h)
  const dailyGifts = db.prepare(`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
    FROM gifts
    WHERE receiver_id = ?
      AND created_at >= (unixepoch() - 86400)
  `).get(hostId);

  // Total gifts count (all time)
  const totalGiftsCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM gifts WHERE receiver_id = ?
  `).get(hostId);

  // Recent sessions
  const recentSessions = db.prepare(`
    SELECT * FROM room_sessions
    WHERE host_id = ?
    ORDER BY started_at DESC
    LIMIT 5
  `).all(hostId);

  // Rank among active hosts by total_earnings
  const rank = db.prepare(`
    SELECT COUNT(*) + 1 AS rank
    FROM hosts
    WHERE total_earnings > (SELECT total_earnings FROM hosts WHERE id = ?)
      AND status = 'active'
  `).get(hostId);

  // Sync and return targets inline
  const targets = syncHostTargets(hostId);

  res.json({
    host: {
      id:                   host.id,
      username:             host.username,
      email:                host.email,
      status:               host.status,
      commissionRate:       host.commission_rate,
      totalRoomTimeSeconds: host.total_room_time,
      totalRoomTimeHours:   +(host.total_room_time / 3600).toFixed(2),
      totalGiftsVolume:     host.total_gifts,       // sum of gift amounts
      totalGiftsCount:      totalGiftsCount.cnt,    // number of gifts
      totalEarnings:        host.total_earnings,
    },
    stats: {
      dailyGiftsCount:   dailyGifts.cnt,
      dailyGiftsTotal:   dailyGifts.total,
      weeklyEarnings:    weeklyEarnings.total,
      monthlyEarnings:   monthlyEarnings.total,
    },
    rank:     rank.rank,
    targets,
    recentSessions,
  });
});

// ---------------------------------------------------------------------------
// GET /api/hosts/targets
// ---------------------------------------------------------------------------
router.get('/targets', requireRole('HOST', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const hostId = req.user.id;
  const targets = syncHostTargets(hostId);
  res.json({ period: currentMonthPeriod(), targets });
});

// ---------------------------------------------------------------------------
// GET /api/hosts/earnings?page=1&limit=20
// ---------------------------------------------------------------------------
router.get('/earnings', requireRole('HOST', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);

  const rows = db.prepare(`
    SELECT
      e.id, e.amount, e.type, e.created_at,
      g.amount  AS gift_amount,
      g.room_id AS gift_room_id,
      g.sender_id,
      u.username AS sender_username
    FROM earnings e
    LEFT JOIN gifts g ON g.id = e.ref_id
    LEFT JOIN users u ON u.id = g.sender_id
    WHERE e.user_id = ? AND e.type = 'host_commission'
    ORDER BY e.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM earnings
    WHERE user_id = ? AND type = 'host_commission'
  `).get(req.user.id);

  // Summary totals
  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(e.amount), 0)  AS total_earned,
      COALESCE(SUM(g.amount), 0)  AS total_gifts_volume,
      COUNT(*)                     AS total_transactions
    FROM earnings e
    LEFT JOIN gifts g ON g.id = e.ref_id
    WHERE e.user_id = ? AND e.type = 'host_commission'
  `).get(req.user.id);

  res.json({ page, limit, total: total.cnt, summary, rows });
});

// ---------------------------------------------------------------------------
// POST /api/hosts/session/start
// Body: { roomId }
// ---------------------------------------------------------------------------
router.post('/session/start', requireRole('HOST', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });

  // Auto-close any open session first
  db.prepare(`
    UPDATE room_sessions
    SET ended_at = unixepoch(),
        duration = unixepoch() - started_at
    WHERE host_id = ? AND ended_at IS NULL
  `).run(req.user.id);

  const sessionId = uuidv4();
  db.prepare(`
    INSERT INTO room_sessions (id, host_id, room_id)
    VALUES (?, ?, ?)
  `).run(sessionId, req.user.id, roomId);

  res.status(201).json({ sessionId });
});

// ---------------------------------------------------------------------------
// POST /api/hosts/session/end
// Body: { sessionId }
// ---------------------------------------------------------------------------
router.post('/session/end', requireRole('HOST', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = db.prepare(`
    SELECT * FROM room_sessions WHERE id = ? AND host_id = ?
  `).get(sessionId, req.user.id);

  if (!session)          return res.status(404).json({ error: 'Session not found' });
  if (session.ended_at)  return res.status(400).json({ error: 'Session already ended' });

  const now      = Math.floor(Date.now() / 1000);
  const duration = now - session.started_at;

  db.prepare(`
    UPDATE room_sessions SET ended_at = ?, duration = ? WHERE id = ?
  `).run(now, duration, sessionId);

  // Update host cumulative room time
  db.prepare(`
    UPDATE hosts SET total_room_time = total_room_time + ? WHERE id = ?
  `).run(duration, req.user.id);

  // Immediately sync the active_hours target
  syncHostTargets(req.user.id);

  const updatedHost = db.prepare(
    `SELECT total_room_time FROM hosts WHERE id = ?`
  ).get(req.user.id);

  res.json({
    sessionId,
    duration,
    durationHours:    +(duration / 3600).toFixed(4),
    totalRoomTimeHours: +(updatedHost.total_room_time / 3600).toFixed(2),
  });
});

module.exports = router;
module.exports.syncHostTargets = syncHostTargets;
