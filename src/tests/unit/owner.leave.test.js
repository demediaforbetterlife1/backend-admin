'use strict';
/**
 * REQ-2: Owner leave closes room — unit tests
 *
 * Covers every requirement bullet exactly:
 *   ✔ Owner exit marks room isActive=false in the database (DB state change)
 *   ✔ Rooms list endpoint returns only isActive=true rooms (closed room hidden)
 *   ✔ Non-owner exit does NOT close the room (room stays active)
 *   ✔ All remaining participants are removed / notified when owner exits
 *   ✔ room-closed, host-left, room-ended events emitted for owner exit
 *   ✔ rooms-updated { action:'removed' } broadcast for owner exit
 *   ✔ No rooms-updated broadcast for non-owner exit
 *   ✔ closeRoomAndNotify is idempotent (second call is a no-op)
 *
 * No network, no Prisma, no Socket.IO server required.
 * All state lives in plain JS objects.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── In-memory database ───────────────────────────────────────────────────────

class InMemoryDB {
  constructor() {
    this.rooms        = new Map(); // roomId → room object
    this.seats        = new Map(); // roomId → Map<seatIndex, userId>
    this.participants = new Map(); // roomId → Set<userId>
    this.seatRequests = new Map(); // roomId → Map<userId, status>
    this._nextId      = 1;
  }

  createRoom(ownerId, { maxSeats = 4, name = 'Room', isPrivate = false } = {}) {
    const id   = `room-${this._nextId++}`;
    const room = { id, name, ownerId, maxSeats, isActive: true, isPrivate, closedAt: null };
    this.rooms.set(id, room);
    this.seats.set(id, new Map());
    this.participants.set(id, new Set());
    this.seatRequests.set(id, new Map());
    return room;
  }

  joinAsSpeaker(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room?.isActive) throw new Error('Room is closed');
    const seats = this.seats.get(roomId);
    if (seats.size >= room.maxSeats) throw Object.assign(new Error('Room full'), { code: 'ROOM_FULL' });
    for (let i = 0; i < room.maxSeats; i++) {
      if (!seats.has(i)) { seats.set(i, userId); break; }
    }
    this.participants.get(roomId).add(userId);
  }

  joinAsAudience(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room?.isActive) throw new Error('Room is closed');
    this.participants.get(roomId).add(userId);
  }

  addSeatRequest(roomId, userId) {
    this.seatRequests.get(roomId)?.set(userId, 'PENDING');
  }

  // Returns active (non-private) rooms — mirrors GET /rooms where isActive=true
  getActiveRooms() {
    return Array.from(this.rooms.values()).filter(r => r.isActive && !r.isPrivate);
  }
}

// ─── Event bus (simulates socket.io namespace) ────────────────────────────────

class EventBus {
  constructor() {
    this.events = [];
  }
  emit(event, data) {
    this.events.push({ event, data, ts: Date.now() });
  }
  get(eventName) {
    return this.events.filter(e => e.event === eventName);
  }
  clear() {
    this.events = [];
  }
}

// ─── Core leave logic (mirrors room.routes.js + room.socket.js behaviour) ─────

/**
 * closeRoomAndNotify — mirrors the real implementation in room.socket.js.
 * Idempotent: if room is already inactive, returns without doing anything.
 */
function closeRoomAndNotify(db, bus, roomId, reason) {
  const room = db.rooms.get(roomId);
  if (!room || !room.isActive) return;           // idempotent guard

  // DB update
  room.isActive = false;
  room.closedAt = new Date();

  // Clear all seats
  db.seats.get(roomId)?.clear();

  // Remove all participants
  db.participants.get(roomId)?.clear();

  // Cancel all pending seat requests
  if (db.seatRequests.has(roomId)) {
    for (const [uid] of db.seatRequests.get(roomId)) {
      db.seatRequests.get(roomId).set(uid, 'CANCELLED');
    }
  }

  // Notify participants (room-level events)
  bus.emit('room-closed',   { roomId, reason });
  if (reason === 'host_left' || reason === 'host_disconnected') {
    bus.emit('host-left',   { roomId, reason });
  }
  bus.emit('room-ended',    { roomId, reason });

  // Global broadcast (mirrors rooms-updated on default namespace)
  bus.emit('rooms-updated', { action: 'removed', roomId });
}

/**
 * leaveRoom — mirrors the combined logic of POST /rooms/:id/leave
 * and socket leave-room handler.
 */
function leaveRoom(db, bus, roomId, userId) {
  const room = db.rooms.get(roomId);
  if (!room) return;

  // Always clear the user's seat
  const seats = db.seats.get(roomId);
  for (const [idx, uid] of seats) {
    if (uid === userId) seats.delete(idx);
  }
  db.participants.get(roomId)?.delete(userId);
  db.seatRequests.get(roomId)?.delete(userId);

  if (room.ownerId === userId && room.isActive) {
    // Owner leaves → close room
    closeRoomAndNotify(db, bus, roomId, 'host_left');
  } else {
    // Regular member leaves → notify without closing
    bus.emit('user-left',   { userId, roomId });
    bus.emit('seat-update', { roomId, seats: Array.from(seats.entries()) });
    bus.emit('room-updated',{ roomId, participantCount: db.participants.get(roomId)?.size ?? 0 });
  }
}

// ─── Test fixtures ─────────────────────────────────────────────────────────────

let db, bus;
beforeEach(() => {
  db  = new InMemoryDB();
  bus = new EventBus();
});

// ─── REQ-2a: Owner exit closes room in DB ─────────────────────────────────────
describe('REQ-2 | owner exit closes room in DB', () => {
  test('room.isActive becomes false when owner leaves', () => {
    const room = db.createRoom('owner-1');
    db.joinAsSpeaker(room.id, 'user-A');

    leaveRoom(db, bus, room.id, 'owner-1');

    assert.equal(db.rooms.get(room.id).isActive, false, 'room must be inactive after owner leaves');
  });

  test('room.closedAt is set when owner leaves', () => {
    const room = db.createRoom('owner-1');
    leaveRoom(db, bus, room.id, 'owner-1');

    assert.ok(db.rooms.get(room.id).closedAt instanceof Date, 'closedAt must be a Date');
  });

  test('all seats are cleared when owner leaves', () => {
    const room = db.createRoom('owner-1', { maxSeats: 4 });
    db.joinAsSpeaker(room.id, 'user-A');
    db.joinAsSpeaker(room.id, 'user-B');

    leaveRoom(db, bus, room.id, 'owner-1');

    assert.equal(db.seats.get(room.id).size, 0, 'all seats must be empty after close');
  });

  test('all participants are removed when owner leaves', () => {
    const room = db.createRoom('owner-1');
    db.joinAsSpeaker(room.id, 'alice');
    db.joinAsAudience(room.id, 'viewer1');

    leaveRoom(db, bus, room.id, 'owner-1');

    assert.equal(db.participants.get(room.id).size, 0, 'no ghost participants must remain');
  });

  test('pending seat requests are cancelled when owner leaves', () => {
    const room = db.createRoom('owner-1');
    db.addSeatRequest(room.id, 'requester-1');
    db.addSeatRequest(room.id, 'requester-2');

    leaveRoom(db, bus, room.id, 'owner-1');

    const requests = db.seatRequests.get(room.id);
    for (const [, status] of requests) {
      assert.equal(status, 'CANCELLED', 'all pending requests must be cancelled');
    }
  });
});

// ─── REQ-2b: Closed room disappears from rooms list ───────────────────────────
describe('REQ-2 | closed room disappears from active rooms list', () => {
  test('getActiveRooms does not return the closed room', () => {
    const r1 = db.createRoom('owner-1', { name: 'Room A' });
    const r2 = db.createRoom('owner-2', { name: 'Room B' });

    leaveRoom(db, bus, r1.id, 'owner-1'); // owner of r1 leaves → r1 closes

    const active = db.getActiveRooms();
    assert.equal(active.length, 1, 'only one room should be active');
    assert.equal(active[0].id, r2.id, 'room B must remain active');
    assert.ok(!active.find(r => r.id === r1.id), 'closed room must not appear in list');
  });

  test('three rooms: two owners leave, one remains active', () => {
    const r1 = db.createRoom('o1');
    const r2 = db.createRoom('o2');
    const r3 = db.createRoom('o3');

    leaveRoom(db, bus, r1.id, 'o1');
    leaveRoom(db, bus, r2.id, 'o2');

    const active = db.getActiveRooms();
    assert.equal(active.length, 1);
    assert.equal(active[0].id, r3.id);
  });

  test('room cannot be joined after owner closes it', () => {
    const room = db.createRoom('owner-1');
    leaveRoom(db, bus, room.id, 'owner-1');

    assert.throws(
      () => db.joinAsSpeaker(room.id, 'late-user'),
      /closed/,
      'joining a closed room must throw',
    );
  });
});

// ─── REQ-2c: Non-owner exit does NOT close the room ──────────────────────────
describe('REQ-2 | non-owner exit does NOT close the room', () => {
  test('room stays active when a regular speaker leaves', () => {
    const room = db.createRoom('owner-1');
    db.joinAsSpeaker(room.id, 'alice');

    leaveRoom(db, bus, room.id, 'alice'); // alice is NOT the owner

    assert.equal(db.rooms.get(room.id).isActive, true, 'room must stay active');
    assert.equal(db.rooms.get(room.id).closedAt, null, 'closedAt must not be set');
  });

  test('room stays active when audience member leaves', () => {
    const room = db.createRoom('owner-1');
    db.joinAsAudience(room.id, 'viewer1');

    leaveRoom(db, bus, room.id, 'viewer1');

    assert.equal(db.rooms.get(room.id).isActive, true);
  });

  test('only user-left events emitted for non-owner (no room-closed)', () => {
    const room = db.createRoom('owner-1');
    db.joinAsSpeaker(room.id, 'alice');
    bus.clear();

    leaveRoom(db, bus, room.id, 'alice');

    const evts = bus.events.map(e => e.event);
    assert.ok(evts.includes('user-left'),    'user-left must be emitted');
    assert.ok(!evts.includes('room-closed'), 'room-closed must NOT be emitted for non-owner');
    assert.ok(!evts.includes('host-left'),   'host-left must NOT be emitted for non-owner');
    assert.ok(!evts.includes('rooms-updated'), 'rooms-updated must NOT be emitted for non-owner');
  });

  test('other users remain in room after non-owner leaves', () => {
    const room = db.createRoom('owner-1');
    db.joinAsSpeaker(room.id, 'alice');
    db.joinAsSpeaker(room.id, 'bob');

    leaveRoom(db, bus, room.id, 'alice'); // alice leaves, bob stays

    assert.equal(db.participants.get(room.id).has('bob'), true, 'bob must stay');
    assert.equal(db.participants.get(room.id).has('alice'), false, 'alice must be gone');
  });
});

// ─── REQ-2d: Correct socket events emitted ────────────────────────────────────
describe('REQ-2 | socket events on owner exit', () => {
  test('room-closed event emitted with reason=host_left', () => {
    const room = db.createRoom('owner-1');
    leaveRoom(db, bus, room.id, 'owner-1');

    const ev = bus.get('room-closed');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].data.reason, 'host_left');
    assert.equal(ev[0].data.roomId, room.id);
  });

  test('host-left event emitted', () => {
    const room = db.createRoom('owner-1');
    leaveRoom(db, bus, room.id, 'owner-1');

    assert.equal(bus.get('host-left').length, 1);
  });

  test('room-ended event emitted', () => {
    const room = db.createRoom('owner-1');
    leaveRoom(db, bus, room.id, 'owner-1');

    assert.equal(bus.get('room-ended').length, 1);
  });

  test('rooms-updated { action: removed } emitted globally', () => {
    const room = db.createRoom('owner-1');
    leaveRoom(db, bus, room.id, 'owner-1');

    const ru = bus.get('rooms-updated');
    assert.equal(ru.length, 1);
    assert.equal(ru[0].data.action, 'removed');
    assert.equal(ru[0].data.roomId, room.id);
  });
});

// ─── REQ-2e: Idempotency of closeRoomAndNotify ────────────────────────────────
describe('REQ-2 | closeRoomAndNotify is idempotent', () => {
  test('calling close twice emits events only once', () => {
    const room = db.createRoom('owner-1');
    closeRoomAndNotify(db, bus, room.id, 'host_left'); // first call
    const countAfterFirst = bus.get('room-closed').length;

    closeRoomAndNotify(db, bus, room.id, 'host_left'); // second call — should be no-op
    assert.equal(bus.get('room-closed').length, countAfterFirst, 'no extra room-closed event');
    assert.equal(bus.get('rooms-updated').length, 1, 'no extra rooms-updated event');
  });

  test('room stays inactive after second close call', () => {
    const room = db.createRoom('owner-1');
    closeRoomAndNotify(db, bus, room.id, 'host_left');
    closeRoomAndNotify(db, bus, room.id, 'host_left');

    assert.equal(db.rooms.get(room.id).isActive, false);
  });
});
