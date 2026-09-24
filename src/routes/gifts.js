/**
 * Gifts routes — sending a gift atomically:
 *   1. Records the gift
 *   2. Credits host earnings (commission_rate % of amount)
 *   3. Credits agent earnings if sender was invited by an active agent
 *   4. Syncs host targets immediately
 *
 * POST  /api/gifts/send    — send a gift to a host
 * GET   /api/gifts/history — sender's gift history (paginated)
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate } = require('../middleware/authMiddleware');
const { parsePagination } = require('../helpers');

const router = express.Router();
router.use(authenticate);

// ---------------------------------------------------------------------------
// POST /api/gifts/send
// Body: { receiverId, amount, roomId? }
// ---------------------------------------------------------------------------
router.post('/send', (req, res) => {
  const senderId = req.user.id;
  const { receiverId, amount, roomId } = req.body;

  if (!receiverId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'receiverId and a positive amount are required' });
  }

  const coinAmount = Number(amount);

  // Receiver must be an active host
  const host = db.prepare(`
    SELECT h.id, h.commission_rate
    FROM hosts h
    JOIN users u ON u.id = h.id
    WHERE h.id = ? AND h.status = 'active' AND u.status = 'active'
  `).get(receiverId);

  if (!host) {
    return res.status(404).json({ error: 'Receiver is not an active host' });
  }

  const giftId = uuidv4();

  const sendGift = db.transaction(() => {
    // 1. Record the gift
    db.prepare(`
      INSERT INTO gifts (id, sender_id, receiver_id, room_id, amount)
      VALUES (?, ?, ?, ?, ?)
    `).run(giftId, senderId, receiverId, roomId ?? null, coinAmount);

    // 2. Host commission
    const hostCut = +(coinAmount * host.commission_rate).toFixed(4);

    db.prepare(`
      INSERT INTO earnings (id, user_id, type, amount, ref_id)
      VALUES (?, ?, 'host_commission', ?, ?)
    `).run(uuidv4(), receiverId, hostCut, giftId);

    // total_gifts = cumulative coin volume received
    // total_earnings = cumulative commission earned
    db.prepare(`
      UPDATE hosts
      SET total_gifts    = total_gifts    + ?,
          total_earnings = total_earnings + ?
      WHERE id = ?
    `).run(coinAmount, hostCut, receiverId);

    // 3. Agent commission — only if sender was invited by an active agent
    const sender = db.prepare(`SELECT invited_by FROM users WHERE id = ?`).get(senderId);
    let agentCut = 0;
    if (sender?.invited_by) {
      const agent = db.prepare(`
        SELECT id, commission_rate FROM agents WHERE id = ? AND status = 'active'
      `).get(sender.invited_by);

      if (agent) {
        agentCut = +(coinAmount * agent.commission_rate).toFixed(4);
        db.prepare(`
          INSERT INTO earnings (id, user_id, type, amount, ref_id)
          VALUES (?, ?, 'agent_commission', ?, ?)
        `).run(uuidv4(), agent.id, agentCut, giftId);

        db.prepare(`
          UPDATE agents SET total_earnings = total_earnings + ? WHERE id = ?
        `).run(agentCut, agent.id);
      }
    }

    return { hostCut, agentCut };
  });

  const { hostCut, agentCut } = sendGift();

  // Sync host targets immediately after the gift lands
  // (lazy-require to avoid circular deps at module load time)
  try {
    const { syncHostTargetsPublic } = require('./hosts_sync');
    syncHostTargetsPublic(receiverId);
  } catch (_) {
    // hosts_sync is optional — targets are also synced on every GET /targets
  }

  res.status(201).json({
    giftId,
    amount:     coinAmount,
    hostEarned: hostCut,
    agentEarned: agentCut,
    message:    'Gift sent successfully',
  });
});

// ---------------------------------------------------------------------------
// GET /api/gifts/history?page=1&limit=20
// ---------------------------------------------------------------------------
router.get('/history', (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);

  const rows = db.prepare(`
    SELECT g.*, u.username AS receiver_username
    FROM gifts g
    JOIN users u ON u.id = g.receiver_id
    WHERE g.sender_id = ?
    ORDER BY g.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, limit, offset);

  const total = db.prepare(
    `SELECT COUNT(*) AS cnt FROM gifts WHERE sender_id = ?`
  ).get(req.user.id);

  res.json({ page, limit, total: total.cnt, rows });
});

module.exports = router;
