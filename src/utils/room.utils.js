'use strict';
const prisma = require('../prismaClient');

async function canModerateRoom(actor, room) {
  if (!actor || !room) return false;
  if (room.ownerId === actor.id) return true;
  if (['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(actor.role)) return true;

  const seat = await prisma.seat.findFirst({
    where: { roomId: room.id, userId: actor.id, isModerator: true },
  });
  return !!seat;
}

/**
 * Atomically assign an empty seat to a user inside a Prisma transaction.
 *
 * REQ-1 FIX: The room owner always occupies seat index 0.
 *   - When the owner joins, seat 0 is reserved for them exclusively.
 *     If seat 0 is already occupied by someone else (race at creation time),
 *     that occupant is displaced to the next available seat first.
 *   - For every other user, the first empty seat starting at index 1 is
 *     chosen so that seat 0 stays reserved for the owner.
 *
 * @param {string}      roomId
 * @param {string}      userId    - user being seated
 * @param {number}      maxSeats
 * @param {string|null} ownerId   - room owner id; pass null for legacy callers
 *                                  that do not know the owner (falls back to
 *                                  original first-empty-seat behaviour).
 */
async function assignSeatAtomic(roomId, userId, maxSeats, ownerId = null) {
  return prisma.$transaction(async (tx) => {
    // Already seated? Return existing seat without changes.
    const existing = await tx.seat.findFirst({ where: { roomId, userId } });
    if (existing) return existing;

    const seats = await tx.seat.findMany({
      where: { roomId, seatIndex: { lt: maxSeats } },
      orderBy: { seatIndex: 'asc' },
    });

    // ── Owner path: must always occupy seat index 0 ───────────────────────
    if (ownerId && userId === ownerId) {
      const seat0 = seats.find((s) => s.seatIndex === 0);
      if (!seat0) {
        const err = new Error('Seat 0 not found — room may not be initialised correctly');
        err.code = 'ROOM_FULL';
        throw err;
      }

      // Seat 0 is occupied by another user → displace them to next free seat.
      if (seat0.userId && seat0.userId !== userId) {
        const nextEmpty = seats.find((s) => s.seatIndex > 0 && !s.userId);
        if (nextEmpty) {
          await tx.seat.update({
            where: { id: nextEmpty.id },
            data: { userId: seat0.userId, joinedAt: new Date() },
          });
        }
        // If there is no spare seat the displaced user simply loses their seat;
        // the owner's claim to seat 0 is non-negotiable.
      }

      const updated = await tx.seat.updateMany({
        where: { id: seat0.id },
        data: { userId, joinedAt: new Date() },
      });
      if (updated.count === 0) {
        const err = new Error('Could not claim seat 0 for owner');
        err.code = 'SEAT_RACE';
        throw err;
      }
      return tx.seat.findUnique({ where: { id: seat0.id } });
    }

    // ── Regular user path ─────────────────────────────────────────────────
    // Skip index 0 when ownerId is known so seat 0 stays available for owner.
    const startIdx = ownerId ? 1 : 0;
    const empty = seats.find((s) => s.seatIndex >= startIdx && !s.userId);
    if (!empty) {
      const err = new Error('Room is full');
      err.code = 'ROOM_FULL';
      throw err;
    }

    const updated = await tx.seat.updateMany({
      where: { id: empty.id, userId: null },
      data: { userId, joinedAt: new Date() },
    });
    if (updated.count === 0) {
      const err = new Error('Seat was taken by another user');
      err.code = 'SEAT_RACE';
      throw err;
    }
    return tx.seat.findUnique({ where: { id: empty.id } });
  });
}

module.exports = { canModerateRoom, assignSeatAtomic };
