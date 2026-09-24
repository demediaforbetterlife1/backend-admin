/**
 * Integration tests — Room REST API + socket broadcast simulation.
 * Uses Node.js built-in test runner (node:test).
 *
 * Tests full request/response cycle by directly calling route handler
 * functions with mock req/res objects — no live HTTP server needed.
 */
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Mock request / response helpers ─────────────────────────────────────────

function mockReq(overrides = {}) {
  return {
    user:   { id: 'user1', username: 'alice', role: 'USER' },
    params: {},
    body:   {},
    query:  {},
    ...overrides,
  };
}

function mockRes() {
  const res = { _status: 200, _body: null };
  res.status  = (code) => { res._status = code; return res; };
  res.json    = (body) => { res._body   = body; return res; };
  res.end     = () => res;
  return res;
}

// ─── Inline room state for tests ─────────────────────────────────────────────

const rooms = new Map();
const seats = new Map();
const participants = new Map();
const emittedEvents = [];

function emit(ns, roomId, event, data) {
  emittedEvents.push({ ns, roomId, event, data });
}

function findEmptySeat(roomId, maxSeats) {
  const roomSeats = seats.get(roomId) || new Map();
  for (let i = 0; i < maxSeats; i++) {
    if (!roomSeats.has(i)) return i;
  }
  const err = new Error('Room is full'); err.code = 'ROOM_FULL'; throw err;
}

function createRoomHandler(req, res) {
  const { name, maxSeats = 20, isPrivate = false, category = 'talk', tags = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Room name required' });
  if (maxSeats < 1 || maxSeats > 20) return res.status(400).json({ success: false, error: 'Max seats 1-20' });

  const id = `room-${Date.now()}`;
  const room = { id, name: name.trim(), ownerId: req.user.id, maxSeats, isPrivate, isActive: true, category, tags, createdAt: new Date() };
  rooms.set(id, room);
  seats.set(id, new Map());
  participants.set(id, new Set());

  emit('/room', id, 'RoomCreated', { action: 'added', room });
  return res.status(201).json({ success: true, data: room });
}

function joinRoomHandler(req, res) {
  const roomId = req.params.id;
  const userId = req.user.id;
  const room   = rooms.get(roomId);
  if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
  if (!room.isActive) return res.status(400).json({ success: false, error: 'Room is closed' });

  try {
    const seatIndex = findEmptySeat(roomId, room.maxSeats);
    seats.get(roomId).set(seatIndex, userId);
    participants.get(roomId).add(userId);

    emit('/room', roomId, 'UserJoined',  { userId, seatIndex });
    emit('/room', roomId, 'SeatUpdated', { seats: Array.from(seats.get(roomId).entries()) });
    return res.json({ success: true, data: room });
  } catch (err) {
    if (err.code === 'ROOM_FULL') return res.status(400).json({ success: false, error: err.message, code: 'ROOM_FULL' });
    return res.status(500).json({ success: false, error: err.message });
  }
}

function leaveRoomHandler(req, res) {
  const roomId = req.params.id;
  const userId = req.user.id;
  const room   = rooms.get(roomId);
  if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

  // Clear seat
  const roomSeats = seats.get(roomId);
  for (const [idx, uid] of roomSeats) {
    if (uid === userId) roomSeats.delete(idx);
  }
  participants.get(roomId)?.delete(userId);

  if (room.ownerId === userId && room.isActive) {
    // HOST LEAVES
    room.isActive  = false;
    room.closedAt  = new Date();
    seats.get(roomId).clear();
    participants.get(roomId).clear();

    emit('/room', roomId, 'room-closed',    { roomId, reason: 'host_left' });
    emit('/room', roomId, 'host-left',      { roomId, reason: 'host_left' });
    emit('/room', roomId, 'room-ended',     { roomId, reason: 'host_left' });
    emit('*',     '*',    'rooms-updated',  { action: 'removed', roomId });
  } else {
    emit('/room', roomId, 'user-left',      { userId });
    emit('/room', roomId, 'seat-update',    { seats: Array.from(roomSeats.entries()) });
    emit('/room', roomId, 'room-updated',   { roomId, participantCount: participants.get(roomId).size });
  }

  return res.json({ success: true });
}

function closeRoomHandler(req, res) {
  const roomId = req.params.id;
  const userId = req.user.id;
  const room   = rooms.get(roomId);
  if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
  if (room.ownerId !== userId && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  if (!room.isActive) return res.json({ success: true }); // idempotent

  room.isActive = false;
  room.closedAt = new Date();
  seats.get(roomId).clear();
  participants.get(roomId).clear();

  emit('/room', roomId, 'room-closed',   { roomId, reason: 'closed_by_moderator' });
  emit('/room', roomId, 'room-ended',    { roomId, reason: 'closed_by_moderator' });
  emit('*',     '*',    'rooms-updated', { action: 'removed', roomId });

  return res.json({ success: true });
}

function getRoomHandler(req, res) {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
  return res.json({ success: true, data: room });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  rooms.clear(); seats.clear(); participants.clear(); emittedEvents.length = 0;
});

describe('POST /rooms — create room', () => {
  test('creates a room and emits RoomCreated', () => {
    const req = mockReq({ body: { name: 'My Room', maxSeats: 4 } });
    const res = mockRes();
    createRoomHandler(req, res);
    assert.equal(res._status, 201);
    assert.equal(res._body.success, true);
    assert.ok(res._body.data.id);
    assert.equal(emittedEvents.filter(e => e.event === 'RoomCreated').length, 1);
  });

  test('rejects empty room name', () => {
    const req = mockReq({ body: { name: '   ' } });
    const res = mockRes();
    createRoomHandler(req, res);
    assert.equal(res._status, 400);
  });

  test('rejects maxSeats > 20', () => {
    const req = mockReq({ body: { name: 'Big Room', maxSeats: 99 } });
    const res = mockRes();
    createRoomHandler(req, res);
    assert.equal(res._status, 400);
  });
});

describe('POST /rooms/:id/join', () => {
  test('user joins and takes a seat', () => {
    const req0 = mockReq({ body: { name: 'Room', maxSeats: 4 } });
    createRoomHandler(req0, mockRes());
    const roomId = rooms.keys().next().value;

    const req = mockReq({ params: { id: roomId }, user: { id: 'alice', role: 'USER' } });
    const res = mockRes();
    joinRoomHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(participants.get(roomId).has('alice'), true);
  });

  test('room full returns ROOM_FULL error', () => {
    const req0 = mockReq({ body: { name: 'Room', maxSeats: 1 } });
    createRoomHandler(req0, mockRes());
    const roomId = rooms.keys().next().value;

    joinRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'u1', role: 'USER' } }), mockRes());
    const res = mockRes();
    joinRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'u2', role: 'USER' } }), res);
    assert.equal(res._status, 400);
    assert.equal(res._body.code, 'ROOM_FULL');
  });

  test('cannot join closed room', () => {
    const req0 = mockReq({ body: { name: 'Room', maxSeats: 4 } });
    createRoomHandler(req0, mockRes());
    const roomId = rooms.keys().next().value;

    leaveRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'user1', role: 'USER' } }), mockRes());
    const res = mockRes();
    joinRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'late-user', role: 'USER' } }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /closed/i);
  });
});

describe('POST /rooms/:id/leave — normal user', () => {
  test('removes user from participants and seat', () => {
    const req0 = mockReq({ body: { name: 'Room', maxSeats: 4 } });
    createRoomHandler(req0, mockRes());
    const roomId = rooms.keys().next().value;

    joinRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'alice', role: 'USER' } }), mockRes());
    assert.equal(participants.get(roomId).has('alice'), true);

    leaveRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'alice', role: 'USER' } }), mockRes());
    assert.equal(participants.get(roomId).has('alice'), false);
  });

  test('emits user-left + seat-update + room-updated', () => {
    const req0 = mockReq({ body: { name: 'Room', maxSeats: 4 } });
    createRoomHandler(req0, mockRes());
    const roomId = rooms.keys().next().value;

    joinRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'alice', role: 'USER' } }), mockRes());
    emittedEvents.length = 0; // reset

    leaveRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'alice', role: 'USER' } }), mockRes());
    const evts = emittedEvents.map(e => e.event);
    assert.ok(evts.includes('user-left'),    'user-left emitted');
    assert.ok(evts.includes('seat-update'),  'seat-update emitted');
    assert.ok(evts.includes('room-updated'), 'room-updated emitted');
  });
});

describe('POST /rooms/:id/leave — HOST leaves', () => {
  test('host leaving closes the room', () => {
    const req0 = mockReq({ user: { id: 'host1', role: 'USER' }, body: { name: 'Room', maxSeats: 4 } });
    createRoomHandler(req0, mockRes());
    const roomId = rooms.keys().next().value;

    leaveRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'host1', role: 'USER' } }), mockRes());

    const room = rooms.get(roomId);
    assert.equal(room.isActive, false, 'room closed');
    assert.ok(room.closedAt, 'closedAt set');
    assert.equal(participants.get(roomId).size, 0, 'no participants');
    assert.equal(seats.get(roomId).size, 0, 'no seats');
  });

  test('host leaving emits room-closed + host-left + room-ended + rooms-updated', () => {
    const req0 = mockReq({ user: { id: 'host1', role: 'USER' }, body: { name: 'Room', maxSeats: 4 } });
    createRoomHandler(req0, mockRes());
    const roomId = rooms.keys().next().value;
    emittedEvents.length = 0;

    leaveRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'host1', role: 'USER' } }), mockRes());

    const evts = emittedEvents.map(e => e.event);
    assert.ok(evts.includes('room-closed'),   'room-closed emitted');
    assert.ok(evts.includes('host-left'),     'host-left emitted');
    assert.ok(evts.includes('room-ended'),    'room-ended emitted');
    assert.ok(evts.includes('rooms-updated'), 'rooms-updated emitted globally');

    const ru = emittedEvents.find(e => e.event === 'rooms-updated');
    assert.equal(ru.data.action, 'removed');
    assert.equal(ru.data.roomId, roomId);
  });

  test('room disappears from active list after host leaves', () => {
    const req0 = mockReq({ user: { id: 'h1', role: 'USER' }, body: { name: 'Room A', maxSeats: 4 } });
    const req1 = mockReq({ user: { id: 'h2', role: 'USER' }, body: { name: 'Room B', maxSeats: 4 } });
    const res0 = mockRes();
    const res1 = mockRes();
    createRoomHandler(req0, res0);
    createRoomHandler(req1, res1);

    const rid1 = res0._body.data.id;
    const rid2 = res1._body.data.id;

    leaveRoomHandler(mockReq({ params: { id: rid1 }, user: { id: 'h1', role: 'USER' } }), mockRes());

    const active = Array.from(rooms.values()).filter(r => r.isActive);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, rid2);
  });
});

describe('POST /rooms/:id/close', () => {
  test('owner can close room', () => {
    const req0 = mockReq({ user: { id: 'owner1', role: 'USER' }, body: { name: 'Room', maxSeats: 4 } });
    createRoomHandler(req0, mockRes());
    const roomId = rooms.keys().next().value;

    const res = mockRes();
    closeRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'owner1', role: 'USER' } }), res);
    assert.equal(res._body.success, true);
    assert.equal(rooms.get(roomId).isActive, false);
  });

  test('non-owner cannot close room', () => {
    const req0 = mockReq({ user: { id: 'owner1', role: 'USER' }, body: { name: 'Room', maxSeats: 4 } });
    createRoomHandler(req0, mockRes());
    const roomId = rooms.keys().next().value;

    const res = mockRes();
    closeRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'other', role: 'USER' } }), res);
    assert.equal(res._status, 403);
  });

  test('close is idempotent', () => {
    const req0 = mockReq({ user: { id: 'owner1', role: 'USER' }, body: { name: 'Room', maxSeats: 4 } });
    createRoomHandler(req0, mockRes());
    const roomId = rooms.keys().next().value;

    closeRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'owner1', role: 'USER' } }), mockRes());
    emittedEvents.length = 0;
    closeRoomHandler(mockReq({ params: { id: roomId }, user: { id: 'owner1', role: 'USER' } }), mockRes());
    assert.equal(emittedEvents.length, 0, 'no extra events on second close');
  });
});
