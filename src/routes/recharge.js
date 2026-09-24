/**
 * Multi-Gateway Recharge System routes.
 *
 * POST   /api/recharge/orders/create          — create a recharge order
 * POST   /api/recharge/orders/:id/usdt-submit — submit TxID for USDT order
 * GET    /api/recharge/orders                 — user's order history
 * GET    /api/recharge/orders/all             — admin: all orders
 * PATCH  /api/recharge/orders/:id/status      — admin: update order status
 *
 * USDT Settlement (agent crypto payouts):
 * POST   /api/recharge/usdt-settlements/submit   — agent submits TxID
 * GET    /api/recharge/usdt-settlements           — admin: pending settlements
 * PATCH  /api/recharge/usdt-settlements/:id/approve
 * PATCH  /api/recharge/usdt-settlements/:id/reject
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate: requireAuth, requireRole } = require('../middleware/authMiddleware');
const { parsePagination } = require('../helpers');

const router = express.Router();
router.use(requireAuth);

// Diamond packs (configurable)
const DIAMOND_PACKS = [
  { id: 'p1', diamonds: 100,  priceEgp: 30  },
  { id: 'p2', diamonds: 500,  priceEgp: 120 },
  { id: 'p3', diamonds: 1200, priceEgp: 250 },
  { id: 'p4', diamonds: 3000, priceEgp: 550 },
];

const SUPPORTED_GATEWAYS = ['fawry', 'usdt', 'google_pay', 'card'];

// ---------------------------------------------------------------------------
// GET /api/recharge/packs  — list available Diamond packs
// ---------------------------------------------------------------------------
router.get('/packs', (req, res) => {
  res.json(DIAMOND_PACKS);
});

// ---------------------------------------------------------------------------
// POST /api/recharge/orders/create
// Body: { packId, gateway, fawryRef? }
// ---------------------------------------------------------------------------
router.post('/orders/create', (req, res) => {
  const { packId, gateway } = req.body;

  const pack = DIAMOND_PACKS.find(p => p.id === packId);
  if (!pack) return res.status(400).json({ error: 'Invalid pack ID' });

  if (!SUPPORTED_GATEWAYS.includes(gateway)) {
    return res.status(400).json({
      error: `gateway must be one of: ${SUPPORTED_GATEWAYS.join(', ')}`,
    });
  }

  const id = uuidv4();

  // FIX M-04: validate fawryRef length and format
  const fawryRef = req.body.fawryRef ?? null;
  if (fawryRef !== null) {
    if (typeof fawryRef !== 'string' || fawryRef.length > 100) {
      return res.status(400).json({ error: 'fawryRef must be a string of max 100 characters' });
    }
  }

  db.prepare(`
    INSERT INTO recharge_orders
      (id, user_id, diamond_amount, price_egp, gateway, status, fawry_ref)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id,
    req.user.id,
    pack.diamonds,
    pack.priceEgp,
    gateway,
    fawryRef,
  );

  const response = {
    orderId:       id,
    diamondAmount: pack.diamonds,
    priceEgp:      pack.priceEgp,
    gateway,
    status:        'pending',
  };

  // For USDT, return the platform wallet address
  if (gateway === 'usdt') {
    response.walletAddress = process.env.USDT_WALLET ?? 'TRx_PLATFORM_WALLET_ADDRESS_HERE';
    response.message = 'Send USDT to the wallet address and submit your TxID to complete the order';
  }

  res.status(201).json(response);
});

// ---------------------------------------------------------------------------
// POST /api/recharge/orders/:id/usdt-submit
// Body: { txId }
// ---------------------------------------------------------------------------
router.post('/orders/:id/usdt-submit', (req, res) => {
  const { txId } = req.body;

  if (!txId || typeof txId !== 'string' || txId.trim().length < 10) {
    return res.status(400).json({ error: 'txId must be at least 10 characters' });
  }
  if (!/^[a-zA-Z0-9]+$/.test(txId.trim())) {
    return res.status(400).json({ error: 'txId must be alphanumeric only' });
  }

  const order = db.prepare(`
    SELECT * FROM recharge_orders WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.gateway !== 'usdt') return res.status(400).json({ error: 'Not a USDT order' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'Order is not pending' });
  if (order.tx_id) return res.status(400).json({ error: 'TxID already submitted' });

  db.prepare(`
    UPDATE recharge_orders
    SET tx_id = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(txId.trim(), req.params.id);

  res.json({
    orderId: req.params.id,
    txId:    txId.trim(),
    status:  'pending',
    message: 'TxID submitted. Your order will be verified and Diamonds credited shortly.',
  });
});

// ---------------------------------------------------------------------------
// GET /api/recharge/orders?page=1&limit=20
// ---------------------------------------------------------------------------
router.get('/orders', (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);

  const rows = db.prepare(`
    SELECT * FROM recharge_orders
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM recharge_orders WHERE user_id = ?`).get(req.user.id);
  res.json({ page, limit, total: total.cnt, rows });
});

// ---------------------------------------------------------------------------
// GET /api/recharge/orders/all  — admin
// ---------------------------------------------------------------------------
router.get('/orders/all', requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);
  const { gateway, status } = req.query;

  let where = 'WHERE 1=1';
  const params = [];
  if (gateway) { where += ' AND ro.gateway = ?'; params.push(gateway); }
  if (status)  { where += ' AND ro.status = ?';  params.push(status); }

  const rows = db.prepare(`
    SELECT ro.*, u.username, u.email
    FROM recharge_orders ro
    JOIN users u ON u.id = ro.user_id
    ${where}
    ORDER BY ro.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM recharge_orders ro ${where}`).all(...params)[0];
  res.json({ page, limit, total: total.cnt, rows });
});

// ---------------------------------------------------------------------------
// PATCH /api/recharge/orders/:id/status  — admin
// Body: { status }  — success | failed | refunded
// ---------------------------------------------------------------------------
router.patch('/orders/:id/status', requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'success', 'failed', 'refunded'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }

  const order = db.prepare(`SELECT * FROM recharge_orders WHERE id = ?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  db.prepare(`
    UPDATE recharge_orders SET status = ?, updated_at = unixepoch() WHERE id = ?
  `).run(status, req.params.id);

  res.json({ message: 'Order status updated', status });
});

// ---------------------------------------------------------------------------
// POST /api/recharge/usdt-settlements/submit  — agent submits USDT payout TxID
// Body: { txId, diamondAmount }
// ---------------------------------------------------------------------------
router.post('/usdt-settlements/submit', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { txId, diamondAmount } = req.body;

  if (!txId || typeof txId !== 'string' || txId.trim().length < 10) {
    return res.status(400).json({ error: 'txId must be at least 10 characters' });
  }
  if (!/^[a-zA-Z0-9]+$/.test(txId.trim())) {
    return res.status(400).json({ error: 'txId must be alphanumeric only' });
  }
  if (!diamondAmount || Number(diamondAmount) <= 0) {
    return res.status(400).json({ error: 'diamondAmount must be positive' });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO usdt_settlements (id, agent_id, tx_id, diamond_amount)
    VALUES (?, ?, ?, ?)
  `).run(id, req.user.id, txId.trim(), Number(diamondAmount));

  res.status(201).json({ id, status: 'pending', message: 'USDT settlement submitted for verification' });
});

// ---------------------------------------------------------------------------
// GET /api/recharge/usdt-settlements  — admin
// ---------------------------------------------------------------------------
router.get('/usdt-settlements', requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);
  const { status } = req.query;

  // FIX M-02 pattern: use parameterized query instead of string interpolation
  let where = '';
  const params = [];
  if (status) {
    where = 'WHERE us.status = ?';
    params.push(status);
  }

  const rows = db.prepare(`
    SELECT us.*, u.username, u.email
    FROM usdt_settlements us
    JOIN users u ON u.id = us.agent_id
    ${where}
    ORDER BY us.submitted_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM usdt_settlements us ${where}`).get(...params);
  res.json({ page, limit, total: total.cnt, rows });
});

// ---------------------------------------------------------------------------
// PATCH /api/recharge/usdt-settlements/:id/approve  — admin
// ---------------------------------------------------------------------------
router.patch('/usdt-settlements/:id/approve', requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const s = db.prepare(`SELECT * FROM usdt_settlements WHERE id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Settlement not found' });
  if (s.status !== 'pending') return res.status(400).json({ error: 'Only pending settlements can be approved' });

  db.prepare(`
    UPDATE usdt_settlements
    SET status = 'approved', resolved_at = unixepoch(), resolved_by = ?
    WHERE id = ?
  `).run(req.user.id, req.params.id);

  res.json({ message: 'USDT settlement approved. Diamonds will be credited.' });
});

// ---------------------------------------------------------------------------
// PATCH /api/recharge/usdt-settlements/:id/reject  — admin
// Body: { reason }
// ---------------------------------------------------------------------------
router.patch('/usdt-settlements/:id/reject', requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'rejection reason is required' });
  }

  const s = db.prepare(`SELECT * FROM usdt_settlements WHERE id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Settlement not found' });
  if (s.status !== 'pending') return res.status(400).json({ error: 'Only pending settlements can be rejected' });

  db.prepare(`
    UPDATE usdt_settlements
    SET status = 'rejected', rejection_reason = ?, resolved_at = unixepoch(), resolved_by = ?
    WHERE id = ?
  `).run(reason.trim(), req.user.id, req.params.id);

  res.json({ message: 'USDT settlement rejected' });
});

module.exports = router;
