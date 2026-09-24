/**
 * Admin Socket — /admin namespace
 *
 * The Next.js dashboard connects here to receive live admin events.
 * Flutter clients listen on the default namespace and the /room namespace.
 * When the dashboard changes something important, this module broadcasts
 * the change to BOTH the admin namespace AND the Flutter namespaces.
 *
 * Auth: admin Bearer token (same JWT_SECRET, type='admin_access').
 *
 * Inbound events (dashboard → server):
 *   admin:join         — register as admin viewer
 *   admin:event        — emit an event to Flutter clients
 *
 * Outbound events (server → Flutter default namespace):
 *   icon:updated, icon:cache_cleared, agency:updated,
 *   user:banned, user:unbanned, user:vip_changed,
 *   room:banned, room:deleted, banner:updated, settings:updated,
 *   notification:sent, moment:hidden, vip:changed
 */

'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

/** Broadcast an admin event to all Flutter clients on the default namespace. */
function broadcastToFlutter(io, type, payload) {
  io.emit(`admin:${type}`, { type, payload, ts: Date.now() });
}

/** Broadcast to the /admin namespace (dashboards watching live). */
function broadcastToAdmins(io, type, payload) {
  io.of('/admin').emit('admin:event', { type, payload, ts: Date.now() });
}

function registerAdminSocket(io) {
  const adminNs = io.of('/admin');

  // Admin token authentication middleware
  adminNs.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.slice(7);
      if (!token) return next(new Error('Admin token required'));

      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.type !== 'admin_access') return next(new Error('Not an admin token'));

      socket.data.adminId   = payload.sub || payload.id;
      socket.data.adminRole = payload.role;
      return next();
    } catch {
      return next(new Error('Invalid or expired admin token'));
    }
  });

  adminNs.on('connection', (socket) => {
    const adminId = socket.data.adminId;
    console.log(`[admin-socket] connected: ${socket.id} (adminId=${adminId})`);

    socket.join('admins');

    // Dashboard registers as active viewer
    socket.on('admin:join', () => {
      socket.join('admins');
      socket.emit('admin:joined', { adminId, ts: Date.now() });
    });

    // Dashboard emits an event — relay it to Flutter clients
    socket.on('admin:event', (event) => {
      if (!event?.type) return;
      broadcastToFlutter(io, event.type, event.payload || {});
      // Also echo to other connected admins so all dashboards see it
      socket.to('admins').emit('admin:event', event);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[admin-socket] disconnected: ${socket.id} (reason=${reason})`);
    });
  });

  // Expose the broadcast helpers on global.__io for use by routes
  global.__adminBroadcast = (type, payload) => {
    broadcastToFlutter(io, type, payload);
    broadcastToAdmins(io, type, payload);
  };

  console.log('[admin-socket] /admin namespace registered');
}

module.exports = { registerAdminSocket };
