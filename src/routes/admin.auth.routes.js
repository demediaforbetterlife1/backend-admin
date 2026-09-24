/**
 * Admin Authentication Routes
 *
 * POST /api/admin/auth/login          — email + password → accessToken + refreshToken
 * POST /api/admin/auth/refresh        — refresh → new token pair
 * POST /api/admin/auth/logout         — revoke refresh token
 * POST /api/admin/auth/logout-all     — revoke all sessions
 * GET  /api/admin/auth/me             — return current admin profile
 *
 * GET  /api/admin/admins              — list admins (SUPER_ADMIN)
 * POST /api/admin/admins              — create admin (SUPER_ADMIN)
 * PATCH /api/admin/admins/:id         — update admin (SUPER_ADMIN)
 * DELETE /api/admin/admins/:id        — soft-delete admin (SUPER_ADMIN)
 * PATCH /api/admin/admins/:id/password — reset admin password (SUPER_ADMIN)
 */

'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const adminAuthService = require('../services/adminAuth.service');
const { authenticateAdmin, requireSuperAdmin, getAdminIp } = require('../middleware/adminAuthMiddleware');

const router = express.Router();

// Rate limit for login endpoint — 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs:    15 * 60 * 1000,
  max:         10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:     { success: false, error: 'Too many login attempts — please try again in 15 minutes' },
});

// ── Auth endpoints ─────────────────────────────────────────────────────────

// POST /api/admin/auth/login
router.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await adminAuthService.login(email, password);

    // Audit log
    await adminAuthService.writeAuditLog(result.admin.id, {
      action:    'ADMIN_LOGIN',
      ipAddress: getAdminIp(req),
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// POST /api/admin/auth/refresh
router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const result = await adminAuthService.refresh(refreshToken);
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// POST /api/admin/auth/logout
router.post('/auth/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    await adminAuthService.logout(refreshToken);
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/auth/logout-all
router.post('/auth/logout-all', authenticateAdmin, async (req, res) => {
  try {
    await adminAuthService.logoutAll(req.admin.id);

    await adminAuthService.writeAuditLog(req.admin.id, {
      action:    'ADMIN_LOGOUT_ALL',
      ipAddress: getAdminIp(req),
    });

    res.json({ success: true, message: 'All sessions revoked' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/auth/me
router.get('/auth/me', authenticateAdmin, (req, res) => {
  res.json({ success: true, data: req.admin });
});

// ── Admin account management (SUPER_ADMIN only) ────────────────────────────

// GET /api/admin/admins
router.get('/admins', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const admins = await adminAuthService.listAdmins();
    res.json({ success: true, data: admins });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/admins
router.post('/admins', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { email, name, password, role } = req.body;
    const admin = await adminAuthService.createAdmin({ email, name, password, role });

    await adminAuthService.writeAuditLog(req.admin.id, {
      action:     'CREATE_ADMIN',
      resource:   'admin_account',
      resourceId: admin.id,
      ipAddress:  getAdminIp(req),
      metadata:   { email, role },
    });

    res.status(201).json({ success: true, data: { id: admin.id, email: admin.email, name: admin.name, role: admin.role, createdAt: admin.createdAt } });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/admins/:id
router.patch('/admins/:id', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { name, role, isActive } = req.body;

    // Prevent demoting yourself
    if (req.params.id === req.admin.id && role && role !== req.admin.role) {
      return res.status(400).json({ success: false, error: 'Cannot change your own role' });
    }

    const updated = await adminAuthService.updateAdmin(req.params.id, { name, role, isActive });

    await adminAuthService.writeAuditLog(req.admin.id, {
      action:     'UPDATE_ADMIN',
      resource:   'admin_account',
      resourceId: req.params.id,
      ipAddress:  getAdminIp(req),
      metadata:   { name, role, isActive },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// DELETE /api/admin/admins/:id
router.delete('/admins/:id', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  try {
    if (req.params.id === req.admin.id) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }
    await adminAuthService.deleteAdmin(req.params.id);

    await adminAuthService.writeAuditLog(req.admin.id, {
      action:     'DELETE_ADMIN',
      resource:   'admin_account',
      resourceId: req.params.id,
      ipAddress:  getAdminIp(req),
    });

    res.json({ success: true, message: 'Admin account deleted' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/admins/:id/password
router.patch('/admins/:id/password', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    await adminAuthService.resetAdminPassword(req.params.id, newPassword);

    await adminAuthService.writeAuditLog(req.admin.id, {
      action:     'RESET_ADMIN_PASSWORD',
      resource:   'admin_account',
      resourceId: req.params.id,
      ipAddress:  getAdminIp(req),
    });

    res.json({ success: true, message: 'Password reset and all sessions revoked' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
