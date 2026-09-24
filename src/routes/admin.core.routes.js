/**
 * Admin Core Routes — Dashboard-facing endpoints
 *
 * All routes require admin Bearer token (authenticateAdmin).
 * RBAC enforced per-endpoint via requireAdmin / requireModerator / requireSupport.
 *
 * Modules:
 *   Users      GET/PATCH  /api/admin/users
 *   Rooms      GET/PATCH  /api/admin/rooms
 *   Agencies   GET/PATCH  /api/admin/agencies
 *   Moments    GET/PATCH  /api/admin/moments
 *   Reports    GET/PATCH  /api/admin/reports
 *   Banners    GET/POST/PATCH/DELETE /api/admin/banners
 *   Settings   GET/PATCH  /api/admin/settings
 *   Gifts      GET/POST/PATCH/DELETE /api/admin/gifts
 *   Store      GET/POST/PATCH/DELETE /api/admin/store/items
 *   Wallet     GET/POST   /api/admin/wallet
 *   Stats      GET        /api/admin/stats/dashboard
 */
'use strict';

const express   = require('express');
const prisma    = require('../prismaClient');
const { authenticateAdmin, requireAdmin, requireModerator, requireSupport, requireSuperAdmin, getAdminIp } = require('../middleware/adminAuthMiddleware');
const adminAuthService = require('../services/adminAuth.service');
const notificationService = require('../services/notification.service');
const authService         = require('../services/authService');
const { adminApiLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Every route in this file requires an authenticated admin + rate limit
router.use(authenticateAdmin, adminApiLimiter);

// ── helpers ────────────────────────────────────────────────────────────────

function paginate(query) {
  const page     = Math.max(1, parseInt(query.page     || '1',  10));
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || query.limit || '20', 10)));
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

function audit(req, action, resource, resourceId, metadata) {
  return adminAuthService.writeAuditLog(req.admin.id, {
    action, resource, resourceId,
    ipAddress: getAdminIp(req),
    userAgent: req.headers['user-agent'],
    metadata,
  }).catch(() => {});
}

function broadcastAdminEvent(type, payload) {
  if (global.__adminBroadcast) {
    global.__adminBroadcast(type, payload);
  } else {
    // Fallback: direct default-namespace broadcast
    const io = global.__io;
    if (io) io.emit(`admin:${type}`, { type, payload, ts: Date.now() });
  }
}


// ══════════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════════

// GET /api/admin/users
router.get('/users', requireSupport, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const { q, status, role } = req.query;
    const where = {};
    if (status) where.status = status;
    if (role)   where.role   = role;
    if (q) {
      where.OR = [
        { username:    { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
        { email:       { contains: q, mode: 'insensitive' } },
        { phone:       { contains: q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take,
        orderBy: { createdAt: 'desc' },
        include: { UserVip: { select: { tier: true, status: true, expiresAt: true } }, wallet: { select: { coinBalance: true } } },
      }),
      prisma.user.count({ where }),
    ]);
    const data = rows.map(u => ({
      id: u.id, username: u.username, displayName: u.displayName, email: u.email, phone: u.phone,
      avatar: u.avatar, role: u.role, status: u.status, isBanned: u.isBanned,
      banType: u.banType, banExpiresAt: u.banExpiresAt, accountType: u.accountType,
      agencyApproved: u.agencyApproved, coins: u.wallet?.coinBalance ?? 0,
      vipTier: u.UserVip?.tier ?? 'NONE', createdAt: u.createdAt,
    }));
    res.json({ success: true, data, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/users/:id
router.get('/users/:id', requireSupport, async (req, res) => {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { UserVip: true, wallet: true, agentProfile: true, warnings: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    if (!u) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: u });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/users/:id/ban
router.patch('/users/:id/ban', requireModerator, async (req, res) => {
  try {
    const { id } = req.params;
    const { banType = 'ONE_DAY', banReason } = req.body;
    const allowed = ['ONE_DAY', 'THREE_DAYS', 'NETWORK'];
    if (!allowed.includes(banType)) return res.status(400).json({ success: false, error: 'Invalid banType' });

    const days = banType === 'THREE_DAYS' ? 3 : banType === 'NETWORK' ? null : 1;
    const banExpiresAt = days ? new Date(Date.now() + days * 86400000) : null;

    await prisma.user.update({ where: { id }, data: { isBanned: true, banType, banExpiresAt, status: 'BANNED' } });
    if (banReason) await prisma.userWarning.create({ data: { userId: id, reason: banReason } });
    await authService.revokeAllRefreshTokens(id).catch(() => {});

    const { kickUserFromAllRooms } = require('../socket/room.socket');
    await kickUserFromAllRooms(id).catch(() => {});

    broadcastAdminEvent('user:banned', { userId: id, banType });
    await audit(req, 'BAN_USER', 'user', id, { banType, banReason });

    res.json({ success: true, message: 'User banned', banType, banExpiresAt });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/users/:id/unban
router.patch('/users/:id/unban', requireModerator, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.user.update({ where: { id }, data: { isBanned: false, banExpiresAt: null, banType: null, status: 'ACTIVE' } });
    broadcastAdminEvent('user:unbanned', { userId: id });
    await audit(req, 'UNBAN_USER', 'user', id);
    res.json({ success: true, message: 'User unbanned' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', requireModerator, async (req, res) => {
  try {
    const { displayName, avatarUrl } = req.body;
    const data = {};
    if (displayName !== undefined) data.displayName = displayName;
    if (avatarUrl   !== undefined) data.avatar       = avatarUrl;
    const u = await prisma.user.update({ where: { id: req.params.id }, data });
    await audit(req, 'UPDATE_USER', 'user', req.params.id, data);
    res.json({ success: true, data: u });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});


// ══════════════════════════════════════════════════════════════
// ROOMS
// ══════════════════════════════════════════════════════════════

// GET /api/admin/rooms
router.get('/rooms', requireSupport, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const { q, status } = req.query;
    const where = {};
    if (status === 'ACTIVE') where.isActive = true;
    else if (status === 'CLOSED') where.isActive = false;
    if (q) where.OR = [
      { name:  { contains: q, mode: 'insensitive' } },
      { topic: { contains: q, mode: 'insensitive' } },
    ];
    const [rows, total] = await Promise.all([
      prisma.room.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
        include: { owner: { select: { id: true, username: true, displayName: true } }, _count: { select: { participants: true } } },
      }),
      prisma.room.count({ where }),
    ]);
    const data = rows.map(r => ({
      id: r.id, name: r.name, image: r.image, isPrivate: r.isPrivate, isActive: r.isActive,
      category: r.category, maxSeats: r.maxSeats, ownerId: r.ownerId,
      owner: r.owner, activeUsers: r._count.participants, createdAt: r.createdAt,
    }));
    res.json({ success: true, data, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/rooms/:id
router.get('/rooms/:id', requireSupport, async (req, res) => {
  try {
    const room = await prisma.room.findUnique({
      where: { id: req.params.id },
      include: { owner: true, seats: { include: { user: { select: { id: true, username: true } } } }, _count: { select: { participants: true, messages: true } } },
    });
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
    res.json({ success: true, data: room });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/admin/rooms/:id
router.delete('/rooms/:id', requireAdmin, async (req, res) => {
  try {
    const room = await prisma.room.findUnique({ where: { id: req.params.id } });
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

    if (room.isActive) {
      const io = global.__io;
      const ns = io ? io.of('/room') : null;
      if (ns) {
        const { closeRoomAndNotify } = require('../socket/room.socket');
        await closeRoomAndNotify(ns, room.id, 'closed_by_admin');
      } else {
        await prisma.room.update({ where: { id: room.id }, data: { isActive: false, closedAt: new Date() } });
      }
    }

    broadcastAdminEvent('room:deleted', { roomId: room.id });
    await audit(req, 'DELETE_ROOM', 'room', room.id, { name: room.name });
    res.json({ success: true, message: 'Room deleted' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/rooms/:id/ban
router.patch('/rooms/:id/ban', requireModerator, async (req, res) => {
  try {
    const { reason } = req.body;
    await prisma.room.update({ where: { id: req.params.id }, data: { isActive: false, closedAt: new Date() } });
    broadcastAdminEvent('room:banned', { roomId: req.params.id });
    await audit(req, 'BAN_ROOM', 'room', req.params.id, { reason });
    res.json({ success: true, message: 'Room banned' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/rooms/:id/kick  — kick a user from a specific room
router.post('/rooms/:roomId/kick', requireModerator, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;
    await prisma.seat.updateMany({ where: { roomId, userId }, data: { userId: null } });
    await prisma.roomParticipant.deleteMany({ where: { roomId, userId } });
    const io = global.__io;
    if (io) io.of('/room').to(roomId).emit('user-kicked', { userId });
    await audit(req, 'KICK_USER_FROM_ROOM', 'room', roomId, { userId });
    res.json({ success: true, message: 'User kicked from room' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});


// ══════════════════════════════════════════════════════════════
// AGENCIES
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// AGENCIES (DEPRECATED — use /api/admin/agencies from admin.agency.routes.js)
// ══════════════════════════════════════════════════════════════

// These routes have been moved to src/routes/admin.agency.routes.js
// They are commented out here to avoid conflicts.
// DELETE THESE AFTER CONFIRMING THE NEW ROUTES WORK.

/*
// GET /api/admin/agencies
router.get('/agencies', requireSupport, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const { status } = req.query;
    const where = { accountType: 'AGENCY_OWNER' };
    if (status) where.status = status;
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, select: { id: true, username: true, displayName: true, email: true, phone: true, agencyName: true, status: true, agencyApproved: true, agencyApprovedAt: true, createdAt: true } }),
      prisma.user.count({ where }),
    ]);
    res.json({ success: true, data: rows, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/agencies/:id
router.get('/agencies/:id', requireSupport, async (req, res) => {
  try {
    const u = await prisma.user.findFirst({ where: { id: req.params.id, accountType: 'AGENCY_OWNER' } });
    if (!u) return res.status(404).json({ success: false, error: 'Agency not found' });
    res.json({ success: true, data: u });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/agencies/:id/approve
router.patch('/agencies/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { notes } = req.body;
    await authService.approveAgency(req.params.id, req.admin.id);
    broadcastAdminEvent('agency:updated', { agencyId: req.params.id, status: 'APPROVED' });
    await audit(req, 'APPROVE_AGENCY', 'agency', req.params.id, { notes });
    res.json({ success: true, message: 'Agency approved' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/agencies/:id/reject
router.patch('/agencies/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    await authService.rejectAgency(req.params.id, reason);
    broadcastAdminEvent('agency:updated', { agencyId: req.params.id, status: 'REJECTED' });
    await audit(req, 'REJECT_AGENCY', 'agency', req.params.id, { reason });
    res.json({ success: true, message: 'Agency rejected' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/agencies/:id/suspend
router.patch('/agencies/:id/suspend', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    await authService.suspendAgency(req.params.id);
    broadcastAdminEvent('agency:updated', { agencyId: req.params.id, status: 'SUSPENDED' });
    await audit(req, 'SUSPEND_AGENCY', 'agency', req.params.id, { reason });
    res.json({ success: true, message: 'Agency suspended' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/agencies/:id/ban
router.patch('/agencies/:id/ban', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    await prisma.user.update({ where: { id: req.params.id }, data: { status: 'BANNED', isBanned: true, agencyApproved: false } });
    broadcastAdminEvent('agency:updated', { agencyId: req.params.id, status: 'BANNED' });
    await audit(req, 'BAN_AGENCY', 'agency', req.params.id, { reason });
    res.json({ success: true, message: 'Agency banned' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/agencies/:id/restore
router.patch('/agencies/:id/restore', requireAdmin, async (req, res) => {
  try {
    await prisma.user.update({ where: { id: req.params.id }, data: { status: 'ACTIVE', isBanned: false, agencyApproved: true } });
    broadcastAdminEvent('agency:updated', { agencyId: req.params.id, status: 'RESTORED' });
    await audit(req, 'RESTORE_AGENCY', 'agency', req.params.id);
    res.json({ success: true, message: 'Agency restored' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
*/


// ══════════════════════════════════════════════════════════════
// MOMENTS (Posts)
// ══════════════════════════════════════════════════════════════

// GET /api/admin/moments
router.get('/moments', requireModerator, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const { q, status } = req.query;
    const where = {};
    if (status === 'HIDDEN') where.visibility = 'PRIVATE';
    else if (status === 'PUBLIC') where.visibility = 'PUBLIC';
    if (q) where.OR = [{ content: { contains: q, mode: 'insensitive' } }];

    const [rows, total] = await Promise.all([
      prisma.post.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, username: true, displayName: true, avatar: true } },
          _count: { select: { likes: true, comments: true, reports: true } },
        },
      }),
      prisma.post.count({ where }),
    ]);
    const data = rows.map(p => ({
      id: p.id, content: p.content, mediaUrls: p.mediaUrls, visibility: p.visibility,
      viewsCount: p.viewsCount, createdAt: p.createdAt, userId: p.userId, user: p.user,
      likesCount: p._count.likes, commentsCount: p._count.comments, reportsCount: p._count.reports,
      status: p.visibility === 'PRIVATE' ? 'HIDDEN' : 'ACTIVE',
    }));
    res.json({ success: true, data, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/moments/:id/hide
router.patch('/moments/:id/hide', requireModerator, async (req, res) => {
  try {
    await prisma.post.update({ where: { id: req.params.id }, data: { visibility: 'PRIVATE' } });
    broadcastAdminEvent('moment:hidden', { momentId: req.params.id });
    await audit(req, 'HIDE_MOMENT', 'post', req.params.id, { reason: req.body.reason });
    res.json({ success: true, message: 'Moment hidden' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/moments/:id/restore
router.patch('/moments/:id/restore', requireModerator, async (req, res) => {
  try {
    await prisma.post.update({ where: { id: req.params.id }, data: { visibility: 'PUBLIC' } });
    await audit(req, 'RESTORE_MOMENT', 'post', req.params.id);
    res.json({ success: true, message: 'Moment restored' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/admin/moments/:id
router.delete('/moments/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.post.delete({ where: { id: req.params.id } });
    await audit(req, 'DELETE_MOMENT', 'post', req.params.id);
    res.json({ success: true, message: 'Moment deleted' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════

// GET /api/admin/reports
router.get('/reports', requireSupport, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const { status } = req.query;
    const where = status ? { status } : {};
    const [rows, total] = await Promise.all([
      prisma.report.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
        include: { reporter: { select: { id: true, username: true } }, reportedUser: { select: { id: true, username: true } } },
      }),
      prisma.report.count({ where }),
    ]);
    res.json({ success: true, data: rows, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/reports/:id/resolve
router.patch('/reports/:id/resolve', requireModerator, async (req, res) => {
  try {
    const { resolution } = req.body;
    const report = await prisma.report.update({
      where: { id: req.params.id },
      data: { status: 'ACTION_TAKEN', adminNote: resolution, reviewedById: req.admin.id, reviewedAt: new Date() },
    });
    await audit(req, 'RESOLVE_REPORT', 'report', req.params.id, { resolution });
    res.json({ success: true, data: report });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/reports/:id/dismiss
router.patch('/reports/:id/dismiss', requireModerator, async (req, res) => {
  try {
    const { reason } = req.body;
    const report = await prisma.report.update({
      where: { id: req.params.id },
      data: { status: 'DISMISSED', adminNote: reason, reviewedById: req.admin.id, reviewedAt: new Date() },
    });
    await audit(req, 'DISMISS_REPORT', 'report', req.params.id, { reason });
    res.json({ success: true, data: report });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});


// ══════════════════════════════════════════════════════════════
// BANNERS
// ══════════════════════════════════════════════════════════════

// GET /api/admin/banners
router.get('/banners', requireAdmin, async (req, res) => {
  try {
    const banners = await prisma.banner.findMany({ orderBy: { position: 'asc' } });
    res.json({ success: true, data: banners });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/admin/banners
router.post('/banners', requireAdmin, async (req, res) => {
  try {
    const { title, imageUrl, linkUrl, screen, position, enabled, startAt, endAt } = req.body;
    if (!title || !imageUrl) return res.status(400).json({ success: false, error: 'title and imageUrl are required' });
    const banner = await prisma.banner.create({ data: { title, imageUrl, linkUrl, screen, position: position ?? 0, enabled: enabled ?? true, startAt: startAt ? new Date(startAt) : null, endAt: endAt ? new Date(endAt) : null } });
    broadcastAdminEvent('banner:updated', { action: 'created', bannerId: banner.id });
    await audit(req, 'CREATE_BANNER', 'banner', banner.id, { title });
    res.status(201).json({ success: true, data: banner });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/banners/:id
router.patch('/banners/:id', requireAdmin, async (req, res) => {
  try {
    const { title, imageUrl, linkUrl, screen, position, enabled, startAt, endAt } = req.body;
    const data = {};
    if (title     !== undefined) data.title    = title;
    if (imageUrl  !== undefined) data.imageUrl = imageUrl;
    if (linkUrl   !== undefined) data.linkUrl  = linkUrl;
    if (screen    !== undefined) data.screen   = screen;
    if (position  !== undefined) data.position = position;
    if (enabled   !== undefined) data.enabled  = enabled;
    if (startAt   !== undefined) data.startAt  = startAt ? new Date(startAt) : null;
    if (endAt     !== undefined) data.endAt    = endAt   ? new Date(endAt)   : null;
    const banner = await prisma.banner.update({ where: { id: req.params.id }, data });
    broadcastAdminEvent('banner:updated', { action: 'updated', bannerId: banner.id });
    await audit(req, 'UPDATE_BANNER', 'banner', req.params.id, data);
    res.json({ success: true, data: banner });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/admin/banners/:id
router.delete('/banners/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.banner.delete({ where: { id: req.params.id } });
    broadcastAdminEvent('banner:updated', { action: 'deleted', bannerId: req.params.id });
    await audit(req, 'DELETE_BANNER', 'banner', req.params.id);
    res.json({ success: true, message: 'Banner deleted' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/admin/banners/reorder
router.post('/banners/reorder', requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ success: false, error: 'ids must be an array' });
    await Promise.all(ids.map((id, index) => prisma.banner.update({ where: { id }, data: { position: index } })));
    broadcastAdminEvent('banner:updated', { action: 'reordered' });
    res.json({ success: true, message: 'Banners reordered' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});


// ══════════════════════════════════════════════════════════════
// APP SETTINGS
// ══════════════════════════════════════════════════════════════

// GET /api/admin/settings
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const rows = await prisma.appSetting.findMany();
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json({ success: true, data: settings });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/settings
router.patch('/settings', requireSuperAdmin, async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, error: 'Request body must be an object of settings' });
    }
    await Promise.all(
      Object.entries(updates).map(([key, value]) =>
        prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
      )
    );
    broadcastAdminEvent('settings:updated', updates);
    await audit(req, 'UPDATE_SETTINGS', 'settings', null, { keys: Object.keys(updates) });
    const rows = await prisma.appSetting.findMany();
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json({ success: true, data: settings });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/admin/settings/cache/flush
router.post('/settings/cache/flush', requireSuperAdmin, async (req, res) => {
  try {
    broadcastAdminEvent('settings:updated', { cache_flushed: true });
    await audit(req, 'FLUSH_SETTINGS_CACHE', 'settings', null);
    res.json({ success: true, message: 'Settings cache flushed' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

// GET /api/admin/notifications
router.get('/notifications', requireAdmin, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const notifications = await prisma.notification.findMany({ skip, take, orderBy: { createdAt: 'desc' } });
    const total = await prisma.notification.count();
    res.json({ success: true, data: notifications, total, page, pageSize });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/admin/notifications/send
router.post('/notifications/send', requireAdmin, async (req, res) => {
  try {
    const { title, body, targetType, targetId } = req.body;
    if (!title || !body) return res.status(400).json({ success: false, error: 'title and body are required' });

    let userIds = [];
    if (targetType === 'ALL') {
      const users = await prisma.user.findMany({ select: { id: true } });
      userIds = users.map(u => u.id);
    } else if (targetType === 'USER' && targetId) {
      userIds = [targetId];
    } else if (targetType === 'ROLE' && targetId) {
      const users = await prisma.user.findMany({ where: { role: targetId }, select: { id: true } });
      userIds = users.map(u => u.id);
    } else if (targetType === 'AGENCY') {
      const users = await prisma.user.findMany({ where: { accountType: 'AGENCY_OWNER', agencyApproved: true }, select: { id: true } });
      userIds = users.map(u => u.id);
    }

    if (userIds.length > 0) {
      await notificationService.sendToMultipleUsers(userIds, 'SYSTEM', title, body, {}).catch(console.warn);
    }

    broadcastAdminEvent('notification:sent', { title, body, targetType, recipientsCount: userIds.length });
    await audit(req, 'SEND_NOTIFICATION', 'notification', null, { title, targetType, targetId, recipientsCount: userIds.length });

    res.json({ success: true, message: `Notification sent to ${userIds.length} user(s)` });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});


// ══════════════════════════════════════════════════════════════
// GIFTS
// ══════════════════════════════════════════════════════════════

// GET /api/admin/gifts
router.get('/gifts', requireAdmin, async (req, res) => {
  try {
    const { category, enabled } = req.query;
    const where = {};
    if (category) where.category = category;
    if (enabled !== undefined) where.isActive = enabled === 'true';
    const gifts = await prisma.gift.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: gifts });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/admin/gifts
router.post('/gifts', requireAdmin, async (req, res) => {
  try {
    const { name, nameAr, animationUrl, thumbnailUrl, coinPrice, category, isActive, isVipOnly, isLegendary, comboCount, minTier } = req.body;
    if (!name || !nameAr || !coinPrice) return res.status(400).json({ success: false, error: 'name, nameAr, coinPrice required' });
    const gift = await prisma.gift.create({ data: { name, nameAr, animationUrl: animationUrl ?? '', thumbnailUrl: thumbnailUrl ?? '', coinPrice, category: category ?? 'regular', isActive: isActive ?? true, isVipOnly: isVipOnly ?? false, isLegendary: isLegendary ?? false, comboCount: comboCount ?? 3, minTier: minTier ?? null } });
    await audit(req, 'CREATE_GIFT', 'gift', gift.id, { name });
    res.status(201).json({ success: true, data: gift });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/gifts/:id
router.patch('/gifts/:id', requireAdmin, async (req, res) => {
  try {
    const { name, nameAr, animationUrl, thumbnailUrl, coinPrice, category, isActive, isVipOnly } = req.body;
    const data = {};
    if (name          !== undefined) data.name          = name;
    if (nameAr        !== undefined) data.nameAr        = nameAr;
    if (animationUrl  !== undefined) data.animationUrl  = animationUrl;
    if (thumbnailUrl  !== undefined) data.thumbnailUrl  = thumbnailUrl;
    if (coinPrice     !== undefined) data.coinPrice     = coinPrice;
    if (category      !== undefined) data.category      = category;
    if (isActive      !== undefined) data.isActive      = isActive;
    if (isVipOnly     !== undefined) data.isVipOnly     = isVipOnly;
    const gift = await prisma.gift.update({ where: { id: req.params.id }, data });
    await audit(req, 'UPDATE_GIFT', 'gift', req.params.id, data);
    res.json({ success: true, data: gift });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/admin/gifts/:id
router.delete('/gifts/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.gift.update({ where: { id: req.params.id }, data: { isActive: false } });
    await audit(req, 'DELETE_GIFT', 'gift', req.params.id);
    res.json({ success: true, message: 'Gift disabled' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// STORE ITEMS (Frames / Entrances / Coin Bundles)
// ══════════════════════════════════════════════════════════════

// GET /api/admin/store/items
router.get('/store/items', requireAdmin, async (req, res) => {
  try {
    const { type } = req.query;
    const [frames, entrances, coinPackages] = await Promise.all([
      (!type || type === 'FRAME')        ? prisma.frame.findMany()       : Promise.resolve([]),
      (!type || type === 'ENTRANCE')     ? prisma.entrance.findMany()    : Promise.resolve([]),
      (!type || type === 'COIN_BUNDLE')  ? prisma.coinPackage.findMany() : Promise.resolve([]),
    ]);
    const data = [
      ...frames.map(f      => ({ ...f, type: 'FRAME' })),
      ...entrances.map(e   => ({ ...e, type: 'ENTRANCE' })),
      ...coinPackages.map(c => ({ ...c, type: 'COIN_BUNDLE' })),
    ];
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// WALLET / ECONOMY
// ══════════════════════════════════════════════════════════════

// GET /api/admin/wallet
router.get('/wallet', requireAdmin, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const { q } = req.query;
    const where = q ? { user: { OR: [{ username: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } } : {};
    const [rows, total] = await Promise.all([
      prisma.userWallet.findMany({ where, skip, take, include: { user: { select: { id: true, username: true, displayName: true } } } }),
      prisma.userWallet.count({ where }),
    ]);
    res.json({ success: true, data: rows, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/wallet/:userId
router.get('/wallet/:userId', requireAdmin, async (req, res) => {
  try {
    const wallet = await prisma.userWallet.findUnique({ where: { userId: req.params.userId }, include: { user: { select: { id: true, username: true, displayName: true } } } });
    if (!wallet) return res.status(404).json({ success: false, error: 'Wallet not found' });
    res.json({ success: true, data: wallet });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/wallet/:userId/transactions
router.get('/wallet/:userId/transactions', requireAdmin, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const [rows, total] = await Promise.all([
      prisma.coinTransaction.findMany({ where: { userId: req.params.userId }, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.coinTransaction.count({ where: { userId: req.params.userId } }),
    ]);
    res.json({ success: true, data: rows, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/admin/wallet/:userId/adjust
router.post('/wallet/:userId/adjust', requireSuperAdmin, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const userId = req.params.userId;
    if (!amount || !reason) return res.status(400).json({ success: false, error: 'amount and reason are required' });
    const coinsService = require('../services/coins.service');
    const type = amount > 0 ? 'BONUS' : 'WITHDRAWAL';
    await coinsService.creditCoins(userId, Math.abs(amount), type, null, reason);
    broadcastAdminEvent('wallet:adjusted', { userId, amount, reason });
    await audit(req, 'ADJUST_WALLET', 'wallet', userId, { amount, reason });
    res.json({ success: true, message: `Wallet adjusted by ${amount} coins` });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});


// ══════════════════════════════════════════════════════════════
// PAYMENTS
// ══════════════════════════════════════════════════════════════

// GET /api/admin/payments
router.get('/payments', requireAdmin, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const { status, type } = req.query;
    const where = {};
    if (status) where.status = status;
    if (type)   where.type   = type;
    const [rows, total] = await Promise.all([
      prisma.paymentOrder.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, username: true, email: true } } } }),
      prisma.paymentOrder.count({ where }),
    ]);
    res.json({ success: true, data: rows, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/payments/stats
router.get('/payments/stats', requireAdmin, async (req, res) => {
  try {
    const [grandTotal, byStatus, byType] = await Promise.all([
      prisma.paymentOrder.aggregate({ where: { status: 'SUCCESS' }, _sum: { amountEGP: true }, _count: { id: true } }),
      prisma.paymentOrder.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.paymentOrder.groupBy({ by: ['type'],   _count: { id: true } }),
    ]);
    res.json({ success: true, data: { grandTotal: grandTotal._sum.amountEGP ?? 0, totalTransactions: grandTotal._count.id, byStatus, byType } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// VIP
// ══════════════════════════════════════════════════════════════

// GET /api/admin/vip/users
router.get('/vip/users', requireAdmin, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const { tier } = req.query;
    const where = tier ? { tier } : { tier: { not: 'NONE' } };
    const [rows, total] = await Promise.all([
      prisma.userVip.findMany({ where, skip, take, orderBy: { startedAt: 'desc' }, include: { User: { select: { id: true, username: true, displayName: true, avatar: true } } } }),
      prisma.userVip.count({ where }),
    ]);
    res.json({ success: true, data: rows, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/vip/configs
router.get('/vip/configs', requireAdmin, async (req, res) => {
  try {
    const plans = await prisma.vipPlan.findMany({ orderBy: { createdAt: 'asc' } });
    res.json({ success: true, data: plans });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ══════════════════════════════════════════════════════════════

// GET /api/admin/stats/dashboard
router.get('/stats/dashboard', requireSupport, async (req, res) => {
  try {
    const [
      totalUsers, activeUsers, bannedUsers,
      totalRooms, activeRooms,
      pendingAgencies, activeAgencies,
      totalRevenue, openReports,
      recentPayments,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { isBanned: true } }),
      prisma.room.count(),
      prisma.room.count({ where: { isActive: true } }),
      prisma.user.count({ where: { accountType: 'AGENCY_OWNER', status: 'PENDING_APPROVAL' } }),
      prisma.user.count({ where: { accountType: 'AGENCY_OWNER', agencyApproved: true } }),
      prisma.paymentOrder.aggregate({ where: { status: 'SUCCESS' }, _sum: { amountEGP: true } }),
      prisma.report.count({ where: { status: 'PENDING' } }),
      prisma.paymentOrder.findMany({ where: { status: 'SUCCESS' }, take: 5, orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, username: true } } } }),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers, activeUsers, bannedUsers,
        totalRooms, activeRooms,
        activeAgencies, pendingAgencies,
        totalRevenue: totalRevenue._sum.amountEGP ?? 0,
        openReports,
        recentPayments,
      },
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/stats/revenue
router.get('/stats/revenue', requireAdmin, async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const now = new Date();
    let from;
    if      (period === 'day')   from = new Date(now.getTime() - 86400000);
    else if (period === 'week')  from = new Date(now.getTime() - 7 * 86400000);
    else if (period === 'year')  from = new Date(now.getTime() - 365 * 86400000);
    else                         from = new Date(now.getTime() - 30 * 86400000);

    const rows = await prisma.paymentOrder.findMany({
      where: { status: 'SUCCESS', createdAt: { gte: from } },
      select: { amountEGP: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const byDay = {};
    for (const r of rows) {
      const day = r.createdAt.toISOString().slice(0, 10);
      byDay[day] = (byDay[day] ?? 0) + r.amountEGP;
    }
    const labels = Object.keys(byDay).sort();
    const values = labels.map(d => byDay[d]);

    res.json({ success: true, data: { labels, values } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// INTERNAL EVENT RELAY — mounted BEFORE the auth middleware
// This route uses a service token, not an admin JWT.
// ══════════════════════════════════════════════════════════════

// POST /api/admin/events/emit
// NOTE: This route is registered before router.use(authenticateAdmin)
// in index.js by mounting it on a separate router. We export it separately.
const internalRouter = express.Router();

internalRouter.post('/events/emit', (req, res) => {
  // Verify internal service token
  const token    = req.headers['x-service-token'];
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  if (!expected || token !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const { type, payload } = req.body;
  if (!type) return res.status(400).json({ success: false, error: 'type is required' });

  broadcastAdminEvent(type, payload || {});
  res.json({ success: true, message: `Event ${type} emitted` });
});

module.exports = { router, internalRouter };

// ══════════════════════════════════════════════════════════════
// VIP — admin-JWT-protected wrappers around existing vip logic
// ══════════════════════════════════════════════════════════════

// POST /api/admin/vip/grant
router.post('/vip/grant', requireAdmin, async (req, res) => {
  try {
    const { userId, level, tier, durationDays = 30 } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

    // Accept either numeric level (dashboard) or VipTier string (legacy)
    let resolvedTier = tier;
    if (!resolvedTier && level !== undefined) {
      const n = parseInt(level, 10);
      if (n === 0)       resolvedTier = 'NONE';
      else if (n === 1)  resolvedTier = 'VIP';
      else if (n <= 5)   resolvedTier = `SVIP_${n - 1}`;
      else               resolvedTier = `SVIP_${n - 1}`;
    }
    if (!resolvedTier) return res.status(400).json({ success: false, error: 'level or tier is required' });

    const now = new Date();
    const expiresAt = resolvedTier === 'NONE' ? null : new Date(now.getTime() + durationDays * 86400000);

    const existing = await prisma.userVip.findUnique({ where: { userId } });
    await prisma.$transaction(async (tx) => {
      const newStatus = resolvedTier === 'NONE' ? 'NONE' : 'ACTIVE';
      if (existing) {
        await tx.userVip.update({ where: { userId }, data: { tier: resolvedTier, status: newStatus, startedAt: now, expiresAt, autoRenew: false } });
      } else {
        await tx.userVip.create({ data: { userId, tier: resolvedTier, status: newStatus, startedAt: now, expiresAt, autoRenew: false } });
      }
      await tx.vipTransaction.create({ data: { userId, fromTier: existing?.tier ?? 'NONE', toTier: resolvedTier, durationDays } });
      const newRole = resolvedTier === 'NONE' ? 'USER' : (String(resolvedTier).startsWith('SVIP') ? 'SVIP' : 'VIP');
      const svipLevel = String(resolvedTier).startsWith('SVIP_') ? Number(String(resolvedTier).replace('SVIP_', '')) : null;
      await tx.user.update({ where: { id: userId }, data: { role: newRole, svipLevel } });
    });

    try {
      const vipCacheService = require('../services/vip.cache.service');
      await vipCacheService.invalidateVipStatus(userId);
    } catch { /* cache not configured — skip */ }

    broadcastAdminEvent('user:vip_changed', { userId, tier: resolvedTier, level });
    await audit(req, 'VIP_GRANT', 'user', userId, { tier: resolvedTier, durationDays });
    res.json({ success: true, message: `VIP ${resolvedTier} granted for ${durationDays} days` });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/admin/vip/revoke
router.post('/vip/revoke', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

    const existing = await prisma.userVip.findUnique({ where: { userId } });
    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.userVip.update({ where: { userId }, data: { tier: 'NONE', status: 'CANCELLED', expiresAt: null, autoRenew: false } });
        await tx.vipTransaction.create({ data: { userId, fromTier: existing.tier, toTier: 'NONE', durationDays: 0 } });
      }
      await tx.user.update({ where: { id: userId }, data: { role: 'USER', svipLevel: null } });
    });

    try {
      const vipCacheService = require('../services/vip.cache.service');
      await vipCacheService.invalidateVipStatus(userId);
    } catch { /* skip */ }

    broadcastAdminEvent('user:vip_changed', { userId, tier: 'NONE' });
    await audit(req, 'VIP_REVOKE', 'user', userId);
    res.json({ success: true, message: 'VIP revoked' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/rooms/:id  (update name / image)
router.patch('/rooms/:id', requireModerator, async (req, res) => {
  try {
    const { name, image } = req.body;
    const data = {};
    if (name  !== undefined) data.name  = name;
    if (image !== undefined) data.image = image;
    const room = await prisma.room.update({ where: { id: req.params.id }, data });
    await audit(req, 'UPDATE_ROOM', 'room', req.params.id, data);
    res.json({ success: true, data: room });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/rooms/:id/unban
router.patch('/rooms/:id/unban', requireModerator, async (req, res) => {
  try {
    await prisma.room.update({ where: { id: req.params.id }, data: { isActive: true, closedAt: null } });
    broadcastAdminEvent('room:unbanned', { roomId: req.params.id });
    await audit(req, 'UNBAN_ROOM', 'room', req.params.id);
    res.json({ success: true, message: 'Room unbanned' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/admin/agencies  (create a new agency application)
router.post('/agencies', requireAdmin, async (req, res) => {
  try {
    const { name, ownerName, phone, email, notes } = req.body;
    if (!name || !ownerName || !phone) {
      return res.status(400).json({ success: false, error: 'name, ownerName, phone required' });
    }
    // Agencies are users with accountType=AGENCY + PENDING_APPROVAL status
    const username = `agency_${phone.replace(/\D/g, '').slice(-8)}_${Date.now().toString(36)}`;
    const user = await prisma.user.create({
      data: { username, displayName: ownerName, agencyName: name, phone, email: email ?? null, accountType: 'AGENCY', status: 'PENDING_APPROVAL', agencyApproved: false },
    });
    await audit(req, 'CREATE_AGENCY', 'agency', user.id, { name, ownerName, phone });
    res.status(201).json({ success: true, data: user });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/admin/agencies/:id/level  (update agency level / commission)
router.patch('/agencies/:id/level', requireAdmin, async (req, res) => {
  try {
    const { level, commissionRate } = req.body;
    // Store level as a note in agencyName suffix until a dedicated column exists
    const u = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...(level !== undefined ? { bio: `level:${level}` } : {}) },
    });
    await audit(req, 'UPDATE_AGENCY_LEVEL', 'agency', req.params.id, { level, commissionRate });
    res.json({ success: true, data: u });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', requireAdmin, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const { adminId, resource } = req.query;
    const where = {};
    if (adminId)  where.adminId  = adminId;
    if (resource) where.resource = resource;
    const [rows, total] = await Promise.all([
      prisma.adminAuditLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { admin: { select: { id: true, name: true, email: true } } } }),
      prisma.adminAuditLog.count({ where }),
    ]);
    res.json({ success: true, data: rows, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/admin/banners/public  — served to Flutter (no auth required)
// NOTE: This is mounted on the internalRouter, not router, so it has no auth
