'use strict';
/**
 * stale.rooms.cron.js
 *
 * ROOT-CAUSE FIX: After a server restart the in-memory `activeVoiceSessions`
 * map is wiped.  Any room whose owner was connected at restart time will
 * never receive the host-disconnect close logic because:
 *   1. Socket.IO emits 'disconnect' for every orphaned socket.
 *   2. The disconnect handler checks activeVoiceSessions — empty after restart.
 *   3. Falls into audience-cleanup branch, which now has owner detection.
 *      BUT: sockets may not reconnect at all after a hard restart.
 *
 * This cron runs every 5 minutes and closes any room that is still marked
 * isActive=true but whose owner has no RoomParticipant record — meaning the
 * owner is not present, which should be impossible for an active room.
 *
 * It also cleans up rooms older than 24 hours regardless of participant state,
 * acting as a safety net for any edge case the real-time logic misses.
 *
 * Uses the same closeRoomAndNotify() so all downstream effects fire:
 *   - DB marked closed
 *   - Socket events broadcast (room-closed, host-left, rooms-updated)
 *   - Discovery screens update immediately
 */

const cron    = require('node-cron');
const prisma  = require('../prismaClient');

const STALE_AGE_HOURS = 24; // rooms older than this are always closed

async function closeStaleRooms() {
  try {
    const activeRooms = await prisma.room.findMany({
      where: { isActive: true },
      select: {
        id: true,
        ownerId: true,
        createdAt: true,
        participants: { where: {}, select: { userId: true } },
      },
    });

    if (!activeRooms.length) return;

    const { closeRoomAndNotify } = require('../socket/room.socket');
    const io = global.__io;
    const ns = io ? io.of('/room') : null;

    const staleAgeMs = STALE_AGE_HOURS * 60 * 60 * 1000;
    const now        = Date.now();

    for (const room of activeRooms) {
      const isOwnerPresent = room.participants.some((p) => p.userId === room.ownerId);
      const isExpired      = (now - room.createdAt.getTime()) > staleAgeMs;

      if (!isOwnerPresent || isExpired) {
        const reason = isExpired ? 'stale_room_expired' : 'owner_absent';
        console.log(`[stale.rooms.cron] Closing room ${room.id} — reason=${reason}`);

        if (ns) {
          await closeRoomAndNotify(ns, room.id, reason).catch((err) =>
            console.warn(`[stale.rooms.cron] closeRoomAndNotify failed for ${room.id}:`, err.message),
          );
        } else {
          // No socket server yet (e.g. called before HTTP listen) — DB-only close.
          await prisma.room.update({
            where: { id: room.id },
            data: { isActive: false, closedAt: new Date() },
          }).catch(() => {});
          await prisma.seat.updateMany({
            where: { roomId: room.id },
            data: { userId: null, isMuted: false, forceMuted: false, isModerator: false },
          }).catch(() => {});
          await prisma.roomParticipant.deleteMany({ where: { roomId: room.id } }).catch(() => {});
          await prisma.seatRequest
            .updateMany({ where: { roomId: room.id, status: 'PENDING' }, data: { status: 'CANCELLED' } })
            .catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('[stale.rooms.cron] Error:', err.message);
  }
}

// Run every 5 minutes
cron.schedule('*/5 * * * *', () => {
  closeStaleRooms().catch((err) => console.error('[stale.rooms.cron] Unhandled:', err.message));
});

// Also run once immediately at startup to close rooms orphaned by a restart
closeStaleRooms().catch((err) =>
  console.error('[stale.rooms.cron] Startup cleanup failed:', err.message),
);

console.log('[stale.rooms.cron] Scheduled — runs every 5 minutes + once at startup');

module.exports = { closeStaleRooms };
