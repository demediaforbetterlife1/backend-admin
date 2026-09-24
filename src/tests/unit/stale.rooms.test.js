'use strict';
/**
 * stale.rooms.test.js
 *
 * Tests for the root-cause fixes:
 *   ROOT-FIX-1: Owner detected in else-branch (session-loss / server-restart)
 *   ROOT-FIX-2: stale.rooms.cron closes rooms with absent owner
 *   ROOT-FIX-3: Rooms-updated broadcast fires even without a socket session
 *   ROOT-FIX-4: Regular participant in else-branch does NOT close the room
 *
 * No network, Prisma, or Socket.IO required.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Minimal in-memory DB ─────────────────────────────────────────────────────
class DB {
  constructor() {
    this.rooms        = new Map();
    this.seats        = new Map();
    this.participants = new Map();
    this.requests     = new Map();
    this._id          = 1;
  }

  createRoom(ownerId, { name = 'Room', maxSeats = 4 } = {}) {
    const id   = `r${this._id++}`;
    const room = { id, name, ownerId, maxSeats, isActive: true, closedAt: null, createdAt: new Date() };
    this.rooms.set(id, room);
    this.seats.set(id, new Map());          // seatIndex → userId
    this.participants.set(id, new Map());   // userId    → role
    this.requests.set(id, new Map());       // userId    → status
    return room;
  }

  joinSpeaker(roomId, userId) {
    const r = this.rooms.get(roomId);
    if (!r?.isActive) throw new Error('Room closed');
    const seats = this.seats.get(roomId);
    let idx = 0;
    while (seats.has(idx)) idx++;
    if (idx >= r.maxSeats) throw Object.assign(new Error('Full'), { code: 'ROOM_FULL' });
    seats.set(idx, userId);
    this.participants.get(roomId).set(userId, 'SPEAKER');
  }

  joinAudience(roomId, userId) {
    const r = this.rooms.get(roomId);
    if (!r?.isActive) throw new Error('Room closed');
    this.participants.get(roomId).set(userId, 'AUDIENCE');
  }

  isOwnerPresent(roomId) {
    const r = this.rooms.get(roomId);
    if (!r) return false;
    return this.participants.get(roomId)?.has(r.ownerId) ?? false;
  }

  getActiveRooms() {
    return Array.from(this.rooms.values()).filter((r) => r.isActive && !r.closedAt);
  }
}

// ─── EventBus ─────────────────────────────────────────────────────────────────
class Bus {
  constructor() { this.events = []; }
  emit(e, d)   { this.events.push({ event: e, data: d }); }
  get(e)       { return this.events.filter((x) => x.event === e); }
  clear()      { this.events = []; }
}

// ─── closeRoomAndNotify (mirrors room.socket.js) ──────────────────────────────
function closeRoomAndNotify(db, bus, roomId, reason) {
  const room = db.rooms.get(roomId);
  if (!room || !room.isActive) return;
  room.isActive = false;
  room.closedAt = new Date();
  db.seats.get(roomId)?.clear();
  db.participants.get(roomId)?.clear();
  for (const [uid] of (db.requests.get(roomId) ?? [])) {
    db.requests.get(roomId).set(uid, 'CANCELLED');
  }
  bus.emit('room-closed',   { roomId, reason });
  if (reason === 'host_left' || reason === 'host_disconnected') {
    bus.emit('host-left',   { roomId, reason });
  }
  bus.emit('room-ended',    { roomId, reason });
  bus.emit('rooms-updated', { action: 'removed', roomId });
}

// ─── Simulated disconnect handler (mirrors the fixed else-branch) ─────────────
function handleDisconnect(db, bus, userId, socketRoomIds, activeVoiceSessions) {
  const sessionKey = `voice:${userId}`;
  const session    = activeVoiceSessions.get(sessionKey);

  if (session) {
    // Speaker path (session present — normal case)
    const { roomId } = session;
    activeVoiceSessions.delete(sessionKey);

    // Clear seat & participant
    const seats = db.seats.get(roomId);
    if (seats) for (const [idx, uid] of seats) { if (uid === userId) seats.delete(idx); }
    db.participants.get(roomId)?.delete(userId);

    const room = db.rooms.get(roomId);
    if (room && room.ownerId === userId && room.isActive) {
      closeRoomAndNotify(db, bus, roomId, 'host_disconnected');
    } else {
      bus.emit('user-left',    { userId, roomId });
      bus.emit('room-updated', { roomId, participantCount: db.participants.get(roomId)?.size ?? 0 });
    }
  } else {
    // Else-branch: no session — handles audience AND session-loss owner
    for (const roomId of socketRoomIds) {
      const participant = db.participants.get(roomId)?.has(userId);
      const hasSeat     = Array.from(db.seats.get(roomId)?.values() ?? []).includes(userId);
      const room        = db.rooms.get(roomId);
      const isOwner     = room?.ownerId === userId;

      if (!participant && !hasSeat && !isOwner) continue;

      // ROOT-FIX-1: Owner detected without an activeVoiceSession
      if (room && isOwner && room.isActive) {
        const seats = db.seats.get(roomId);
        if (seats) for (const [idx, uid] of seats) { if (uid === userId) seats.delete(idx); }
        db.participants.get(roomId)?.delete(userId);
        closeRoomAndNotify(db, bus, roomId, 'host_disconnected');
        continue;
      }

      // Regular participant cleanup
      const seats = db.seats.get(roomId);
      if (seats) for (const [idx, uid] of seats) { if (uid === userId) seats.delete(idx); }
      db.participants.get(roomId)?.delete(userId);

      bus.emit('user-left',    { userId, roomId });
      bus.emit('room-updated', { roomId, participantCount: db.participants.get(roomId)?.size ?? 0 });
    }
  }
}

// ─── Simulated stale-rooms cron ───────────────────────────────────────────────
function runStaleRoomsCron(db, bus) {
  const STALE_HOURS = 24;
  const now         = Date.now();
  let   closed      = 0;

  for (const room of db.getActiveRooms()) {
    const ownerPresent = db.participants.get(room.id)?.has(room.ownerId) ?? false;
    const expired      = (now - room.createdAt.getTime()) > STALE_HOURS * 3600 * 1000;

    if (!ownerPresent || expired) {
      const reason = expired ? 'stale_room_expired' : 'owner_absent';
      closeRoomAndNotify(db, bus, room.id, reason);
      closed++;
    }
  }
  return closed;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let db, bus;
beforeEach(() => { db = new DB(); bus = new Bus(); });

// ── ROOT-FIX-1: session-loss owner still closes room ─────────────────────────
describe('ROOT-FIX-1 | owner detected without activeVoiceSession (session-loss)', () => {
  test('owner in else-branch closes room when session map is empty', () => {
    const room = db.createRoom('owner-1');
    db.joinSpeaker(room.id, 'owner-1');
    db.joinAudience(room.id, 'alice');

    const emptySessions = new Map(); // simulates server-restart wiped sessions

    handleDisconnect(db, bus, 'owner-1', [room.id], emptySessions);

    assert.equal(db.rooms.get(room.id).isActive, false, 'room must be closed');
    assert.ok(db.rooms.get(room.id).closedAt instanceof Date, 'closedAt must be set');
  });

  test('room-closed + host-left + rooms-updated emitted on session-loss owner disconnect', () => {
    const room = db.createRoom('owner-1');
    db.joinSpeaker(room.id, 'owner-1');

    handleDisconnect(db, bus, 'owner-1', [room.id], new Map());

    assert.equal(bus.get('room-closed').length,   1);
    assert.equal(bus.get('host-left').length,      1);
    assert.equal(bus.get('rooms-updated').length,  1);
    assert.equal(bus.get('rooms-updated')[0].data.action, 'removed');
  });

  test('all participants removed when owner disconnects without session', () => {
    const room = db.createRoom('owner-1');
    db.joinSpeaker(room.id, 'owner-1');
    db.joinAudience(room.id, 'bob');
    db.joinAudience(room.id, 'carol');

    handleDisconnect(db, bus, 'owner-1', [room.id], new Map());

    assert.equal(db.participants.get(room.id).size, 0, 'all participants must be removed');
  });

  test('regular speaker does NOT close room when session is absent', () => {
    const room = db.createRoom('owner-1');
    db.joinSpeaker(room.id, 'owner-1');
    db.joinSpeaker(room.id, 'alice');

    handleDisconnect(db, bus, 'alice', [room.id], new Map());

    assert.equal(db.rooms.get(room.id).isActive, true, 'room must stay active');
    assert.equal(bus.get('room-closed').length, 0, 'room-closed must NOT fire for non-owner');
    assert.equal(bus.get('rooms-updated').length, 0, 'rooms-updated must NOT fire for non-owner');
  });

  test('audience member does NOT close room in else-branch', () => {
    const room = db.createRoom('owner-1');
    db.joinSpeaker(room.id, 'owner-1');
    db.joinAudience(room.id, 'viewer');

    handleDisconnect(db, bus, 'viewer', [room.id], new Map());

    assert.equal(db.rooms.get(room.id).isActive, true);
    assert.equal(bus.get('room-closed').length, 0);
    assert.equal(bus.get('user-left').length, 1);
  });

  test('normal owner disconnect WITH session still closes room', () => {
    const room = db.createRoom('owner-1');
    db.joinSpeaker(room.id, 'owner-1');

    const sessions = new Map([['voice:owner-1', { roomId: room.id }]]);
    handleDisconnect(db, bus, 'owner-1', [room.id], sessions);

    assert.equal(db.rooms.get(room.id).isActive, false);
    assert.equal(bus.get('room-closed').length, 1);
  });
});

// ── ROOT-FIX-2: stale-rooms cron closes orphaned rooms ───────────────────────
describe('ROOT-FIX-2 | stale-rooms cron closes owner-absent rooms', () => {
  test('cron closes room when owner has no participant record', () => {
    const room = db.createRoom('owner-1');
    // Owner never joins (or left without triggering close)
    db.joinAudience(room.id, 'alice');

    const closed = runStaleRoomsCron(db, bus);

    assert.equal(closed, 1, 'one room must be closed');
    assert.equal(db.rooms.get(room.id).isActive, false);
    assert.equal(bus.get('rooms-updated').length, 1);
    assert.equal(bus.get('rooms-updated')[0].data.action, 'removed');
  });

  test('cron does NOT close room when owner is present', () => {
    const room = db.createRoom('owner-1');
    db.joinSpeaker(room.id, 'owner-1');

    const closed = runStaleRoomsCron(db, bus);

    assert.equal(closed, 0, 'no room should be closed');
    assert.equal(db.rooms.get(room.id).isActive, true);
  });

  test('cron closes expired room even if owner is still listed', () => {
    const room = db.createRoom('owner-1');
    // Backdate creation time by 25 hours
    db.rooms.get(room.id).createdAt = new Date(Date.now() - 25 * 3600 * 1000);
    db.joinSpeaker(room.id, 'owner-1');

    const closed = runStaleRoomsCron(db, bus);

    assert.equal(closed, 1, 'expired room must be closed regardless of owner presence');
  });

  test('cron clears all participants when closing stale room', () => {
    const room = db.createRoom('owner-1');
    db.joinAudience(room.id, 'alice');
    db.joinAudience(room.id, 'bob');
    // Owner not present

    runStaleRoomsCron(db, bus);

    assert.equal(db.participants.get(room.id).size, 0);
  });

  test('cron is idempotent — running twice does not double-emit', () => {
    const room = db.createRoom('owner-1');
    // Owner absent

    runStaleRoomsCron(db, bus);
    const afterFirst = bus.get('rooms-updated').length;

    runStaleRoomsCron(db, bus); // room is already closed
    assert.equal(bus.get('rooms-updated').length, afterFirst, 'no duplicate events');
  });

  test('cron handles multiple stale rooms independently', () => {
    const r1 = db.createRoom('o1'); // owner absent
    const r2 = db.createRoom('o2'); // owner present
    const r3 = db.createRoom('o3'); // owner absent
    db.joinSpeaker(r2.id, 'o2');

    const closed = runStaleRoomsCron(db, bus);

    assert.equal(closed, 2);
    assert.equal(db.rooms.get(r1.id).isActive, false);
    assert.equal(db.rooms.get(r2.id).isActive, true);
    assert.equal(db.rooms.get(r3.id).isActive, false);
  });
});

// ── ROOT-FIX-3: rooms-updated fires for all close paths ──────────────────────
describe('ROOT-FIX-3 | rooms-updated broadcast on every close path', () => {
  test('direct leave (session present) emits rooms-updated', () => {
    const room = db.createRoom('owner-1');
    db.joinSpeaker(room.id, 'owner-1');
    const sessions = new Map([['voice:owner-1', { roomId: room.id }]]);

    handleDisconnect(db, bus, 'owner-1', [room.id], sessions);

    assert.equal(bus.get('rooms-updated').length, 1);
    assert.equal(bus.get('rooms-updated')[0].data.action, 'removed');
    assert.equal(bus.get('rooms-updated')[0].data.roomId, room.id);
  });

  test('session-loss disconnect emits rooms-updated', () => {
    const room = db.createRoom('owner-1');
    db.joinSpeaker(room.id, 'owner-1');

    handleDisconnect(db, bus, 'owner-1', [room.id], new Map());

    assert.equal(bus.get('rooms-updated').length, 1);
    assert.equal(bus.get('rooms-updated')[0].data.action, 'removed');
  });

  test('stale-rooms cron emits rooms-updated', () => {
    db.createRoom('owner-1'); // owner absent

    runStaleRoomsCron(db, bus);

    assert.equal(bus.get('rooms-updated').length, 1);
  });

  test('non-owner leave does NOT emit rooms-updated', () => {
    const room = db.createRoom('owner-1');
    db.joinSpeaker(room.id, 'owner-1');
    db.joinAudience(room.id, 'viewer');

    handleDisconnect(db, bus, 'viewer', [room.id], new Map());

    assert.equal(bus.get('rooms-updated').length, 0);
  });
});

// ── Scenario: 0-listener stale room ──────────────────────────────────────────
describe('SCENARIO | 0-listener room with absent owner gets closed', () => {
  test('room with 0 participants and absent owner is closed by cron', () => {
    const room = db.createRoom('owner-1');
    // No participants at all — owner never joined or already left
    assert.equal(db.participants.get(room.id).size, 0);
    assert.equal(db.isOwnerPresent(room.id), false);

    const closed = runStaleRoomsCron(db, bus);

    assert.equal(closed, 1);
    assert.equal(db.rooms.get(room.id).isActive, false);
    assert.equal(db.getActiveRooms().length, 0);
  });

  test('room with 2 participants but absent owner is closed by cron', () => {
    const room = db.createRoom('owner-1');
    db.joinAudience(room.id, 'alice');
    db.joinAudience(room.id, 'bob');
    // owner-1 not in participants

    assert.equal(db.isOwnerPresent(room.id), false);

    runStaleRoomsCron(db, bus);

    assert.equal(db.rooms.get(room.id).isActive, false);
    assert.equal(bus.get('room-closed')[0]?.data.reason, 'owner_absent');
  });

  test('room with 2 participants and present owner stays active', () => {
    const room = db.createRoom('owner-1');
    db.joinSpeaker(room.id, 'owner-1');
    db.joinAudience(room.id, 'alice');

    assert.equal(db.isOwnerPresent(room.id), true);

    const closed = runStaleRoomsCron(db, bus);

    assert.equal(closed, 0);
    assert.equal(db.rooms.get(room.id).isActive, true);
  });
});
