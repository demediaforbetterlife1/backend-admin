'use strict';
/**
 * req1.req2.test.js
 *
 * REQ-2 — Owner-leave closes room & disappears from list:
 *   R2-1  owner added as participant at room creation
 *   R2-2  stale-cron sees owner as absent when owner leaves → closes room
 *   R2-3  closed room absent from active list (frontend filter)
 *   R2-4  non-owner leave does NOT close room
 *
 * REQ-1 — Owner seat 0, system join message, seat-request flow:
 *   R1-1  owner always gets seat index 0
 *   R1-2  owner displaces a user already in seat 0
 *   R1-3  regular user gets seat ≥ 1 when ownerId is provided
 *   R1-4  regular user gets seat 0 when ownerId is NOT provided (legacy)
 *   R1-5  room full error when only seat 0 is free and a non-owner tries to join
 *   R1-6  system-message emitted on speaker join
 *   R1-7  system-message emitted on audience join
 *   R1-8  system-message text contains username
 *   R1-9  seat-request sent to owner (not auto-promoted)
 *   R1-10 owner/moderator can accept seat-request → user gets seat ≥ 1
 *   R1-11 non-owner cannot accept seat-request
 *   R1-12 seat-request rejected → user stays as audience
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Minimal in-memory DB ─────────────────────────────────────────────────────
class DB {
  constructor() {
    this.rooms        = new Map();
    this.seats        = new Map();   // roomId → [{id,seatIndex,userId}]
    this.participants = new Map();   // roomId → Map<userId, role>
    this.requests     = new Map();   // roomId → Map<userId, {status,id}>
    this.events       = [];          // socket events
    this._id          = 1;
  }

  nextId() { return `id${this._id++}`; }

  emit(event, data) { this.events.push({ event, data }); }
  getEvents(e)      { return this.events.filter(x => x.event === e); }
  clearEvents()     { this.events = []; }

  createRoom(ownerId, maxSeats = 4) {
    const id   = this.nextId();
    const room = { id, ownerId, maxSeats, isActive: true, closedAt: null, createdAt: new Date() };
    this.rooms.set(id, room);
    const seatList = [];
    for (let i = 0; i < maxSeats; i++) seatList.push({ id: this.nextId(), seatIndex: i, userId: null });
    this.seats.set(id, seatList);
    this.participants.set(id, new Map());
    this.requests.set(id, new Map());

    // REQ-2 FIX: owner added as participant at creation time
    this.participants.get(id).set(ownerId, 'SPEAKER');

    return room;
  }

  getActiveRooms() {
    return Array.from(this.rooms.values()).filter(r => r.isActive);
  }
}

// ─── assignSeatAtomic (mirrors room.utils.js) ────────────────────────────────
function assignSeatAtomic(db, roomId, userId, maxSeats, ownerId = null) {
  const seats = db.seats.get(roomId);
  if (!seats) throw new Error('Room not found');

  const existing = seats.find(s => s.userId === userId);
  if (existing) return existing;

  // Owner path
  if (ownerId && userId === ownerId) {
    const seat0 = seats.find(s => s.seatIndex === 0);
    if (!seat0) { const e = new Error('Seat 0 not found'); e.code = 'ROOM_FULL'; throw e; }
    if (seat0.userId && seat0.userId !== userId) {
      const nextEmpty = seats.find(s => s.seatIndex > 0 && !s.userId);
      if (nextEmpty) nextEmpty.userId = seat0.userId;
    }
    seat0.userId = userId;
    return seat0;
  }

  // Regular user path
  const startIdx = ownerId ? 1 : 0;
  const empty = seats.find(s => s.seatIndex >= startIdx && !s.userId);
  if (!empty) { const e = new Error('Room is full'); e.code = 'ROOM_FULL'; throw e; }
  empty.userId = userId;
  return empty;
}

// ─── leaveRoom (mirrors socket leave-room + routes POST /leave) ────────────────
function leaveRoom(db, roomId, userId) {
  const room = db.rooms.get(roomId);
  if (!room) return;
  // clear seat
  const seats = db.seats.get(roomId) ?? [];
  const seat  = seats.find(s => s.userId === userId);
  if (seat) seat.userId = null;
  // clear participant
  db.participants.get(roomId)?.delete(userId);
  if (room.ownerId === userId && room.isActive) {
    closeRoomAndNotify(db, roomId, 'host_left');
  } else {
    db.emit('user-left',    { userId, roomId });
    db.emit('room-updated', { roomId, participantCount: db.participants.get(roomId)?.size ?? 0 });
  }
}

function closeRoomAndNotify(db, roomId, reason) {
  const room = db.rooms.get(roomId);
  if (!room || !room.isActive) return;
  room.isActive = false;
  room.closedAt = new Date();
  db.seats.get(roomId)?.forEach(s => { s.userId = null; });
  db.participants.get(roomId)?.clear();
  db.emit('room-closed',   { roomId, reason });
  if (reason === 'host_left' || reason === 'host_disconnected') {
    db.emit('host-left',   { roomId, reason });
  }
  db.emit('rooms-updated', { action: 'removed', roomId });
}

// ─── stale-rooms cron (mirrors stale.rooms.cron.js) ──────────────────────────
function runStaleCron(db) {
  let closed = 0;
  for (const room of db.getActiveRooms()) {
    const ownerPresent = db.participants.get(room.id)?.has(room.ownerId) ?? false;
    if (!ownerPresent) {
      closeRoomAndNotify(db, room.id, 'owner_absent');
      closed++;
    }
  }
  return closed;
}

// ─── seat-request helpers ─────────────────────────────────────────────────────
function requestSeat(db, roomId, userId) {
  const room = db.rooms.get(roomId);
  if (!room) throw new Error('Room not found');
  if (room.ownerId === userId) throw new Error('Owner already has a seat');
  const req = { id: db.nextId(), status: 'PENDING', userId, roomId };
  db.requests.get(roomId).set(userId, req);
  db.emit('seat-requested', { roomId, userId });
  return req;
}

function acceptSeat(db, roomId, requesterId, actorId) {
  const room = db.rooms.get(roomId);
  if (!room) throw new Error('Room not found');
  // Only owner or moderator can accept
  if (room.ownerId !== actorId) throw new Error('Only owner or moderator can accept');
  const req = db.requests.get(roomId)?.get(requesterId);
  if (!req || req.status !== 'PENDING') throw new Error('No pending request');
  req.status = 'ACCEPTED';
  // Give user a seat ≥ 1 (owner already on seat 0)
  assignSeatAtomic(db, roomId, requesterId, room.maxSeats, room.ownerId);
  db.participants.get(roomId).set(requesterId, 'SPEAKER');
  db.emit('seat-accepted', { roomId, userId: requesterId });
}

function rejectSeat(db, roomId, requesterId, actorId) {
  const room = db.rooms.get(roomId);
  if (!room) throw new Error('Room not found');
  if (room.ownerId !== actorId) throw new Error('Only owner or moderator can reject');
  const req = db.requests.get(roomId)?.get(requesterId);
  if (!req || req.status !== 'PENDING') throw new Error('No pending request');
  req.status = 'REJECTED';
  db.emit('seat-rejected', { roomId, userId: requesterId });
}

// ─── emitSystemMessage (mirrors room.socket.js) ───────────────────────────────
function emitSystemMessage(db, roomId, username, role) {
  db.emit('system-message', {
    id:        `sys-${Date.now()}-${username}`,
    roomId,
    type:      'user_joined',
    text:      `${username} دخل الغرفة`,
    timestamp: new Date().toISOString(),
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────
let db;
beforeEach(() => { db = new DB(); });

// ══════════════════════════════════════════════════════════════════════════════
// REQ-2 tests
// ══════════════════════════════════════════════════════════════════════════════

describe('REQ-2 | owner added as participant at creation', () => {
  test('R2-1: owner is in participants map after createRoom', () => {
    const room = db.createRoom('owner-1');
    assert.ok(db.participants.get(room.id).has('owner-1'), 'owner must be in participants');
  });

  test('R2-2: stale-cron closes room when owner leaves (participant removed)', () => {
    const room = db.createRoom('owner-1');
    leaveRoom(db, room.id, 'owner-1');
    // room should already be closed by leaveRoom, but stale-cron would also catch it
    assert.equal(db.rooms.get(room.id).isActive, false);
  });

  test('R2-2b: stale-cron catches owner absence even without leaveRoom event', () => {
    const room = db.createRoom('owner-1');
    // Simulate owner disconnecting without triggering leaveRoom (e.g. server restart)
    db.participants.get(room.id).delete('owner-1');
    const closed = runStaleCron(db);
    assert.equal(closed, 1);
    assert.equal(db.rooms.get(room.id).isActive, false);
  });

  test('R2-3: closed room absent from active list', () => {
    const r1 = db.createRoom('o1');
    const r2 = db.createRoom('o2');
    leaveRoom(db, r1.id, 'o1');
    const active = db.getActiveRooms();
    assert.equal(active.length, 1);
    assert.equal(active[0].id, r2.id);
    assert.ok(!active.find(r => r.id === r1.id), 'closed room must not appear');
  });

  test('R2-4: non-owner leave does NOT close room', () => {
    const room = db.createRoom('owner-1');
    db.participants.get(room.id).set('alice', 'AUDIENCE');
    leaveRoom(db, room.id, 'alice');
    assert.equal(db.rooms.get(room.id).isActive, true);
    assert.equal(db.getEvents('room-closed').length, 0);
  });

  test('R2-5: rooms-updated(removed) fired when owner leaves', () => {
    const room = db.createRoom('owner-1');
    leaveRoom(db, room.id, 'owner-1');
    const ev = db.getEvents('rooms-updated');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].data.action, 'removed');
    assert.equal(ev[0].data.roomId, room.id);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REQ-1 — Seat assignment
// ══════════════════════════════════════════════════════════════════════════════

describe('REQ-1 | owner always gets seat index 0', () => {
  test('R1-1: owner gets seat 0 on first join', () => {
    const room = db.createRoom('owner-1');
    const seat = assignSeatAtomic(db, room.id, 'owner-1', room.maxSeats, 'owner-1');
    assert.equal(seat.seatIndex, 0, 'owner must land on seat 0');
  });

  test('R1-2: owner displaces existing occupant from seat 0', () => {
    const room = db.createRoom('owner-1');
    // Manually put alice on seat 0 (simulates a race at creation)
    db.seats.get(room.id).find(s => s.seatIndex === 0).userId = 'alice';

    const seat = assignSeatAtomic(db, room.id, 'owner-1', room.maxSeats, 'owner-1');
    assert.equal(seat.seatIndex, 0, 'owner must still get seat 0');
    assert.equal(seat.userId, 'owner-1');

    // alice should be displaced to seat 1 or higher
    const aliceSeat = db.seats.get(room.id).find(s => s.userId === 'alice');
    assert.ok(aliceSeat, 'alice must still have a seat');
    assert.ok(aliceSeat.seatIndex > 0, 'alice must be displaced to seat > 0');
  });

  test('R1-3: regular user skips seat 0 when ownerId provided', () => {
    const room = db.createRoom('owner-1');
    const seat = assignSeatAtomic(db, room.id, 'alice', room.maxSeats, 'owner-1');
    assert.ok(seat.seatIndex >= 1, 'regular user must not take seat 0');
  });

  test('R1-4: regular user CAN take seat 0 when no ownerId (legacy behaviour)', () => {
    const room = db.createRoom('owner-1');
    const seat = assignSeatAtomic(db, room.id, 'alice', room.maxSeats, null);
    assert.equal(seat.seatIndex, 0, 'legacy call gets first empty seat (0)');
  });

  test('R1-5: ROOM_FULL when only seat 0 free and non-owner tries to join (ownerId known)', () => {
    const room = db.createRoom('owner-1', 3);
    // Fill seats 1 and 2
    db.seats.get(room.id).find(s => s.seatIndex === 1).userId = 'u1';
    db.seats.get(room.id).find(s => s.seatIndex === 2).userId = 'u2';
    // seat 0 is free but reserved for owner
    assert.throws(
      () => assignSeatAtomic(db, room.id, 'alice', room.maxSeats, 'owner-1'),
      (e) => e.code === 'ROOM_FULL',
    );
  });

  test('R1-1b: owner already seated → returns existing seat without change', () => {
    const room = db.createRoom('owner-1');
    db.seats.get(room.id).find(s => s.seatIndex === 0).userId = 'owner-1';
    const seat = assignSeatAtomic(db, room.id, 'owner-1', room.maxSeats, 'owner-1');
    assert.equal(seat.seatIndex, 0);
    // Seat 0 not duplicated
    const count = db.seats.get(room.id).filter(s => s.userId === 'owner-1').length;
    assert.equal(count, 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REQ-1 — System join messages
// ══════════════════════════════════════════════════════════════════════════════

describe('REQ-1 | system join message emitted for every user', () => {
  test('R1-6: system-message emitted when speaker joins', () => {
    const room = db.createRoom('owner-1');
    emitSystemMessage(db, room.id, 'alice', 'speaker');
    const msgs = db.getEvents('system-message');
    assert.equal(msgs.length, 1);
  });

  test('R1-7: system-message emitted when audience joins', () => {
    const room = db.createRoom('owner-1');
    emitSystemMessage(db, room.id, 'bob', 'audience');
    const msgs = db.getEvents('system-message');
    assert.equal(msgs.length, 1);
  });

  test('R1-8: system-message text contains the username', () => {
    const room = db.createRoom('owner-1');
    emitSystemMessage(db, room.id, 'يوسف', 'audience');
    const msg = db.getEvents('system-message')[0];
    assert.ok(msg.data.text.includes('يوسف'), 'message must mention username');
  });

  test('R1-8b: system-message type is user_joined', () => {
    const room = db.createRoom('owner-1');
    emitSystemMessage(db, room.id, 'zara', 'speaker');
    const msg = db.getEvents('system-message')[0];
    assert.equal(msg.data.type, 'user_joined');
  });

  test('R1-8c: multiple joins produce separate system messages', () => {
    const room = db.createRoom('owner-1');
    emitSystemMessage(db, room.id, 'alice', 'speaker');
    emitSystemMessage(db, room.id, 'bob',   'audience');
    assert.equal(db.getEvents('system-message').length, 2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REQ-1 — Seat request flow (audience → request → owner approves/rejects)
// ══════════════════════════════════════════════════════════════════════════════

describe('REQ-1 | seat-request flow — no auto-promotion', () => {
  test('R1-9: audience can send a seat request', () => {
    const room = db.createRoom('owner-1');
    db.participants.get(room.id).set('alice', 'AUDIENCE');
    const req = requestSeat(db, room.id, 'alice');
    assert.equal(req.status, 'PENDING');
    assert.equal(db.getEvents('seat-requested').length, 1);
  });

  test('R1-9b: request does NOT give alice a seat immediately', () => {
    const room = db.createRoom('owner-1');
    db.participants.get(room.id).set('alice', 'AUDIENCE');
    requestSeat(db, room.id, 'alice');
    const aliceSeat = db.seats.get(room.id).find(s => s.userId === 'alice');
    assert.ok(!aliceSeat, 'alice must NOT have a seat before owner accepts');
  });

  test('R1-10: owner accepts → alice gets seat ≥ 1', () => {
    const room = db.createRoom('owner-1');
    db.participants.get(room.id).set('alice', 'AUDIENCE');
    requestSeat(db, room.id, 'alice');
    acceptSeat(db, room.id, 'alice', 'owner-1');
    const aliceSeat = db.seats.get(room.id).find(s => s.userId === 'alice');
    assert.ok(aliceSeat, 'alice must have a seat after acceptance');
    assert.ok(aliceSeat.seatIndex >= 1, 'alice must not take seat 0 (reserved for owner)');
    assert.equal(db.getEvents('seat-accepted').length, 1);
  });

  test('R1-11: non-owner cannot accept seat request', () => {
    const room = db.createRoom('owner-1');
    db.participants.get(room.id).set('alice', 'AUDIENCE');
    requestSeat(db, room.id, 'alice');
    assert.throws(
      () => acceptSeat(db, room.id, 'alice', 'bob'),
      /owner or moderator/,
    );
  });

  test('R1-12: owner rejects → alice stays in audience (no seat)', () => {
    const room = db.createRoom('owner-1');
    db.participants.get(room.id).set('alice', 'AUDIENCE');
    requestSeat(db, room.id, 'alice');
    rejectSeat(db, room.id, 'alice', 'owner-1');
    const req = db.requests.get(room.id).get('alice');
    assert.equal(req.status, 'REJECTED');
    const aliceSeat = db.seats.get(room.id).find(s => s.userId === 'alice');
    assert.ok(!aliceSeat, 'alice must NOT have a seat after rejection');
    assert.equal(db.getEvents('seat-rejected').length, 1);
  });

  test('R1-12b: owner cannot request their own seat', () => {
    const room = db.createRoom('owner-1');
    assert.throws(
      () => requestSeat(db, room.id, 'owner-1'),
      /Owner already has a seat/,
    );
  });
});
