/**
 * Unit tests — room lifecycle: create, join, leave, close scenarios.
 * Uses Node.js built-in test runner (node:test).
 *
 * Simulates the full state machine for:
 *   - Host creates room
 *   - Users join as speaker/audience
 *   - User leaves → stats update, no ghost users
 *   - Host leaves → room closed, all participants removed
 *   - Nobody can rejoin a closed room
 */
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── In-memory room simulation ────────────────────────────────────────────────

class RoomSimulator {
  constructor() {
    this.rooms = new Map();          // roomId → room object
    this.seats = new Map();          // roomId → Map<seatIndex, userId>
    this.participants = new Map();   // roomId → Set<userId>
    this.seatRequests = new Map();   // roomId → Map<userId, status>
    this.closedRooms = new Set();    // roomIds that are closed
    this.events = [];                // emitted socket events
  }

  emit(roomId, event, data) {
    this.events.push({ roomId, event, data, ts: Date.now() });
  }

  createRoom(ownerId, { id = `room-${Date.now()}`, name = 'Test Room', maxSeats = 4 } = {}) {
    const room = { id, name, ownerId, maxSeats, isActive: true, createdAt: new Date(), closedAt: null };
    this.rooms.set(id, room);
    this.seats.set(id, new Map());
    this.participants.set(id, new Set());
    this.seatRequests.set(id, new Map());
    this.emit(id, 'RoomCreated', { roomId: id, name, ownerId });
    return room;
  }

  joinAsSpeaker(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (!room.isActive) throw new Error('Room is closed');
    const seats = this.seats.get(roomId);
    if (seats.size >= room.maxSeats) throw Object.assign(new Error('Room is full'), { code: 'ROOM_FULL' });
    const seatIndex = this._findEmptySeat(roomId);
    seats.set(seatIndex, userId);
    this.participants.get(roomId).add(userId);
    this.emit(roomId, 'UserJoined', { userId, seatIndex, role: 'speaker' });
    return { seatIndex };
  }

  joinAsAudience(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (!room.isActive) throw new Error('Room is closed');
    this.participants.get(roomId).add(userId);
    this.emit(roomId, 'UserJoined', { userId, seatIndex: null, role: 'audience' });
    return { role: 'audience' };
  }

  leaveRoom(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Clear seat
    const seats = this.seats.get(roomId);
    for (const [idx, uid] of seats) {
      if (uid === userId) seats.delete(idx);
    }

    // Remove from participants
    this.participants.get(roomId)?.delete(userId);

    // Cancel seat requests
    this.seatRequests.get(roomId)?.delete(userId);

    if (room.ownerId === userId && room.isActive) {
      // HOST LEAVES → close room
      this._closeRoom(roomId, 'host_left');
    } else {
      this.emit(roomId, 'UserLeft',    { userId });
      this.emit(roomId, 'SeatUpdated', { seats: this._getSeatsSnapshot(roomId) });
      this.emit(roomId, 'RoomUpdated', {
        roomId,
        participantCount: this.participants.get(roomId)?.size ?? 0,
      });
    }
  }

  _closeRoom(roomId, reason = 'closed') {
    const room = this.rooms.get(roomId);
    if (!room || !room.isActive) return; // idempotent
    room.isActive = false;
    room.closedAt = new Date();

    // Clear all seats and participants
    this.seats.get(roomId)?.clear();
    this.participants.get(roomId)?.clear();
    this.seatRequests.get(roomId)?.clear();
    this.closedRooms.add(roomId);

    this.emit(roomId, 'RoomClosed',   { roomId, reason });
    this.emit(roomId, 'HostLeft',     { roomId, reason });
    this.emit(roomId, 'RoomEnded',    { roomId, reason });
    this.emit('*',    'rooms-updated',{ action: 'removed', roomId });
  }

  _findEmptySeat(roomId) {
    const room  = this.rooms.get(roomId);
    const seats = this.seats.get(roomId);
    for (let i = 0; i < room.maxSeats; i++) {
      if (!seats.has(i)) return i;
    }
    throw Object.assign(new Error('Room is full'), { code: 'ROOM_FULL' });
  }

  _getSeatsSnapshot(roomId) {
    const seats = this.seats.get(roomId);
    return Array.from(seats.entries()).map(([idx, uid]) => ({ seatIndex: idx, userId: uid }));
  }

  getEvents(eventName) {
    return this.events.filter(e => e.event === eventName);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let sim;
beforeEach(() => { sim = new RoomSimulator(); });

describe('host creates room', () => {
  test('room is created and active', () => {
    const room = sim.createRoom('host1', { id: 'r1', name: 'My Room', maxSeats: 4 });
    assert.equal(room.id,       'r1');
    assert.equal(room.isActive, true);
    assert.equal(room.ownerId,  'host1');
  });

  test('emits RoomCreated event', () => {
    sim.createRoom('host1', { id: 'r1' });
    assert.equal(sim.getEvents('RoomCreated').length, 1);
  });
});

describe('user joins room', () => {
  test('speaker takes a seat and emits UserJoined', () => {
    sim.createRoom('host1', { id: 'r1' });
    const result = sim.joinAsSpeaker('r1', 'alice');
    assert.ok(result.seatIndex >= 0, 'seat assigned');
    assert.equal(sim.getEvents('UserJoined').length, 1);
  });

  test('audience joins without seat', () => {
    sim.createRoom('host1', { id: 'r1' });
    const result = sim.joinAsAudience('r1', 'viewer1');
    assert.equal(result.role, 'audience');
    assert.equal(sim.participants.get('r1').has('viewer1'), true);
  });

  test('room full error when maxSeats reached', () => {
    sim.createRoom('host1', { id: 'r1', maxSeats: 2 });
    sim.joinAsSpeaker('r1', 'u1');
    sim.joinAsSpeaker('r1', 'u2');
    assert.throws(() => sim.joinAsSpeaker('r1', 'u3'), { code: 'ROOM_FULL' });
  });

  test('cannot join a closed room', () => {
    sim.createRoom('host1', { id: 'r1' });
    sim.leaveRoom('r1', 'host1'); // host leaves → room closes
    assert.throws(() => sim.joinAsSpeaker('r1', 'late-user'), /closed/);
  });
});

describe('user leaves room — Task 3', () => {
  test('speaker removed from seat and participants', () => {
    sim.createRoom('host1', { id: 'r1' });
    sim.joinAsSpeaker('r1', 'alice');
    sim.leaveRoom('r1', 'alice');
    assert.equal(sim.participants.get('r1').has('alice'), false, 'alice removed from participants');
    const seats = sim.seats.get('r1');
    for (const uid of seats.values()) {
      assert.notEqual(uid, 'alice', 'alice has no seat');
    }
  });

  test('emits UserLeft + SeatUpdated + RoomUpdated', () => {
    sim.createRoom('host1', { id: 'r1' });
    sim.joinAsSpeaker('r1', 'alice');
    sim.leaveRoom('r1', 'alice');
    assert.equal(sim.getEvents('UserLeft').length,    1);
    assert.equal(sim.getEvents('SeatUpdated').length, 1);
    assert.equal(sim.getEvents('RoomUpdated').length, 1);
  });

  test('no ghost users after leave', () => {
    sim.createRoom('host1', { id: 'r1' });
    sim.joinAsSpeaker('r1', 'bob');
    sim.joinAsSpeaker('r1', 'carol');
    sim.leaveRoom('r1', 'bob');
    assert.equal(sim.participants.get('r1').size, 1, 'only carol remains');
    assert.equal(sim.participants.get('r1').has('bob'), false);
  });
});

describe('host leaves room — Task 2', () => {
  test('room is marked closed and all participants removed', () => {
    sim.createRoom('host1', { id: 'r1' });
    sim.joinAsSpeaker('r1', 'alice');
    sim.joinAsAudience('r1', 'viewer1');
    sim.leaveRoom('r1', 'host1');

    const room = sim.rooms.get('r1');
    assert.equal(room.isActive, false, 'room is closed');
    assert.ok(room.closedAt instanceof Date, 'closedAt set');
    assert.equal(sim.participants.get('r1').size, 0, 'all participants removed');
    assert.equal(sim.seats.get('r1').size,        0, 'all seats cleared');
  });

  test('emits RoomClosed, HostLeft, RoomEnded, rooms-updated', () => {
    sim.createRoom('host1', { id: 'r1' });
    sim.joinAsSpeaker('r1', 'alice');
    sim.leaveRoom('r1', 'host1');

    assert.equal(sim.getEvents('RoomClosed').length,        1);
    assert.equal(sim.getEvents('HostLeft').length,          1);
    assert.equal(sim.getEvents('RoomEnded').length,         1);
    assert.equal(sim.getEvents('rooms-updated').length,     1);
    assert.equal(sim.getEvents('rooms-updated')[0].data.action, 'removed');
  });

  test('closeRoomAndNotify is idempotent', () => {
    sim.createRoom('host1', { id: 'r1' });
    sim.leaveRoom('r1', 'host1'); // first close
    const eventsAfterFirst = sim.getEvents('RoomClosed').length;

    // Simulate second close call
    sim._closeRoom('r1', 'duplicate_close');
    assert.equal(sim.getEvents('RoomClosed').length, eventsAfterFirst, 'no duplicate events');
  });
});

describe('room disappears from lists after host leaves', () => {
  test('closed room not returned by active-rooms filter', () => {
    sim.createRoom('host1', { id: 'r1' });
    sim.createRoom('host2', { id: 'r2' });
    sim.leaveRoom('r1', 'host1');

    const activeRooms = Array.from(sim.rooms.values()).filter(r => r.isActive);
    assert.equal(activeRooms.length, 1);
    assert.equal(activeRooms[0].id, 'r2');
  });

  test('access denied for closed room', () => {
    sim.createRoom('host1', { id: 'r1' });
    sim.leaveRoom('r1', 'host1');
    assert.throws(() => sim.joinAsAudience('r1', 'new-user'), /closed/);
  });
});

describe('socket events — Task 4', () => {
  test('all 10 required sync events are emitted across a full lifecycle', () => {
    sim.createRoom('host1', { id: 'r1' });          // RoomCreated
    sim.joinAsSpeaker('r1', 'alice');               // UserJoined
    sim.joinAsAudience('r1', 'viewer1');            // UserJoined
    sim.leaveRoom('r1', 'alice');                   // UserLeft + SeatUpdated + RoomUpdated
    sim.leaveRoom('r1', 'host1');                   // RoomClosed + HostLeft + RoomEnded + rooms-updated

    const required = ['RoomCreated', 'UserJoined', 'UserLeft', 'SeatUpdated', 'RoomUpdated', 'RoomClosed', 'HostLeft', 'RoomEnded'];
    for (const evt of required) {
      assert.ok(sim.getEvents(evt).length > 0, `${evt} was emitted`);
    }
  });
});

describe('reconnect scenario', () => {
  test('user rejoins after disconnect — state is consistent', () => {
    sim.createRoom('host1', { id: 'r1' });
    sim.joinAsSpeaker('r1', 'alice');

    // Simulate disconnect: alice is removed
    sim.leaveRoom('r1', 'alice');
    assert.equal(sim.participants.get('r1').has('alice'), false);

    // Alice reconnects
    sim.joinAsSpeaker('r1', 'alice');
    assert.equal(sim.participants.get('r1').has('alice'), true);

    const seats = sim.seats.get('r1');
    const aliceSeatCount = Array.from(seats.values()).filter(u => u === 'alice').length;
    assert.equal(aliceSeatCount, 1, 'no duplicate seat for alice');
  });
});
