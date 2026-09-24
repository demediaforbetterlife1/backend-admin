/**
 * Agency Type routes — USDT | Recharge | Country | Shipping
 *
 * POST   /api/agency-types/register        — agent registers an agency type
 * GET    /api/agency-types/mine            — agent's own agency type records
 * GET    /api/agency-types                 — admin: all agency type records
 * PATCH  /api/agency-types/:id/status      — admin: approve / suspend / activate
 * DELETE /api/agency-types/:id             — admin: remove agency type record
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { parsePagination } = require('../helpers');

const router = express.Router();
router.use(authenticate);

// Allowed types and their required fields
const TYPE_FIELDS = {
  usdt:     ['wallet_address'],
  recharge: ['diamond_credit_limit'],
  country:  ['region', 'country_code'],
  shipping: ['max_transfer_cap'],
};

// ---------------------------------------------------------------------------
// POST /api/agency-types/register
// Body: { type, wallet_address?, diamond_credit_limit?, region?, country_code?, max_transfer_cap? }
// ---------------------------------------------------------------------------
router.post('/register', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const agentId = req.user.id;
  const { type } = req.body;

  if (!TYPE_FIELDS[type]) {
    return res.status(400).json({
      error: `Invalid type. Must be one of: ${Object.keys(TYPE_FIELDS).join(', ')}`,
    });
  }

  // Validate required fields for this type
  for (const field of TYPE_FIELDS[type]) {
    if (req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
      return res.status(400).json({ error: `Field '${field}' is required for type '${type}'` });
    }
  }

  // Check agent exists and is active
  const agent = db.prepare(`SELECT id FROM agents WHERE id = ? AND status = 'active'`).get(agentId);
  if (!agent) return res.status(403).json({ error: 'Only active agents can register agency types' });

  // Check for duplicate
  const existing = db.prepare(`SELECT id FROM agency_types WHERE agent_id = ? AND type = ?`).get(agentId, type);
  if (existing) return res.status(400).json({ error: `Already registered as ${type} agency` });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO agency_types
      (id, agent_id, type, status, wallet_address, diamond_credit_limit,
       region, country_code, max_transfer_cap)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(
    id, agentId, type,
    req.body.wallet_address        ?? null,
    req.body.diamond_credit_limit  ?? null,
    req.body.region                ?? null,
    req.body.country_code          ?? null,
    req.body.max_transfer_cap      ?? null,
  );

  res.status(201).json({ id, message: 'Agency type registration submitted, pending admin approval' });
});

// ---------------------------------------------------------------------------
// GET /api/agency-types/mine
// ---------------------------------------------------------------------------
router.get('/mine', requireRole('AGENT', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM agency_types WHERE agent_id = ? ORDER BY created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// GET /api/agency-types?type=&status=&page=1
// Admin only
// ---------------------------------------------------------------------------
router.get('/', requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { limit, offset, page } = parsePagination(req.query);
  const { type, status } = req.query;

  let where = 'WHERE 1=1';
  const params = [];
  if (type)   { where += ' AND at.type = ?';   params.push(type); }
  if (status) { where += ' AND at.status = ?'; params.push(status); }

  const rows = db.prepare(`
    SELECT at.*, u.username, u.email
    FROM agency_types at
    JOIN users u ON u.id = at.agent_id
    ${where}
    ORDER BY at.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM agency_types at ${where}`).all(...params)[0];
  res.json({ page, limit, total: total.cnt, rows });
});

// ---------------------------------------------------------------------------
// PATCH /api/agency-types/:id/status
// Body: { status }  — pending | active | suspended
// Admin only
// ---------------------------------------------------------------------------
router.patch('/:id/status', requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'active', 'suspended'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }

  const r = db.prepare(`
    UPDATE agency_types SET status = ?, updated_at = unixepoch() WHERE id = ?
  `).run(status, req.params.id);

  if (r.changes === 0) return res.status(404).json({ error: 'Agency type record not found' });
  res.json({ message: 'Status updated', status });
});

// ---------------------------------------------------------------------------
// DELETE /api/agency-types/:id
// Admin only
// ---------------------------------------------------------------------------
router.delete('/:id', requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const r = db.prepare(`DELETE FROM agency_types WHERE id = ?`).run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Agency type record not found' });
  res.json({ message: 'Agency type record deleted' });
});

module.exports = router;
