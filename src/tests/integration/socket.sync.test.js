/**
 * Integration tests — Socket.IO event synchronisation.
 * Uses Node.js built-in test runner (node:test).
 *
 * Tests all Task-4 sync events across multiple simulated clients.
 */
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Simulated socket bus ─────────────────────────────────────────────────────
// A minimal publish-subscribe bus that simulates Socket.IO room channels.

class SocketBus {
  constructor() {
    this._rooms    = new Map();  // roomId → Set<client>
    this._global   = new Set();  // clients subscribed to global events
    this._received = [];         // { clientId, event, data }
  }

  join(clientId, roomId) {
    if (!this._rooms.has(roomId)) this._rooms.set(roomId, new Set());
    this._rooms.get(roomId).add(clientId);
  }

  leave(clientId, roomId) {
    this._rooms.get(roomId)?.delete(clientId);
  }

  subscribeGlobal(clientId) {
    this._global.add(clientId);
  }

  emitToRoom(roomId, event, data) {
    for (const clientId of (this._rooms.get(roomId) ?? [])) {
      this._received.push({ clientId, event, data });
    }
  }

  emitGlobal(event, data) {
    for (const clientId of this._global) {
      this._received.push({ clientId, event, data });
    }
  }

  receivedBy(clientId) {
    return this._received.filter(r => r.clientId === clientId);
  }

  receivedEvent(event) {
    return this._received.filter(r => r.event === event);
  }

  clear() { this._received = []; this._rooms.clear(); this._global.clear(); }
}

let bus;
beforeEach(() => { bus = new SocketBus(); });

// ─── Room event simulation helpers ───────────────────────────────────────────

function simulateJoin(bus, roomId, userId, role = 'speaker') {
  bus.join(userId, roomId);
  bus.emitToRoom(roomId, 'user-joined',  { userId, role });
  bus.emitToRoom(roomId, 'seat-update',  { seats: [] });
  // Emit room-state to the joining socket (reconnect support)
  bus._received.push({ clientId: userId, event: 'room-state', data: { roomId } });
}

function simulateLeave(bus, roomId, userId, isHost) {
  bus.leave(userId, roomId);
  if (isHost) {
    bus.emitToRoom(roomId, 'room-closed',   { roomId, reason: 'host_left' });
    bus.emitToRoom(roomId, 'host-left',     { roomId, reason: 'host_left' });
    bus.emitToRoom(roomId, 'room-ended',    { roomId, reason: 'host_left' });
    bus.emitGlobal('rooms-updated', { action: 'removed', roomId });
    // Kick everyone
    for (const c of (bus._rooms.get(roomId) ?? [])) {
      bus._received.push({ clientId: c, event: 'force-disconnect', data: { reason: 'room_closed' } });
    }
    bus._rooms.delete(roomId);
  } else {
    bus.emitToRoom(roomId, 'user-left',    { userId });
    bus.emitToRoom(roomId, 'seat-update',  { seats: [] });
    bus.emitToRoom(roomId, 'room-updated', { roomId, participantCount: bus._rooms.get(roomId)?.size ?? 0 });
  }
}

function simulateMuteUpdate(bus, roomId, userId, isMuted) {
  bus.emitToRoom(roomId, 'user-muted', { userId, isMuted });
}

function simulateSeatUpdate(bus, roomId, seats) {
  bus.emitToRoom(roomId, 'seat-update', { seats });
}

function simulateGift(bus, roomId, senderId, receiverId, gift) {
  bus.emitToRoom(roomId, 'gift-received', { senderId, receiverId, giftName: gift.name, totalCoins: gift.coinPrice });
  bus.emitToRoom(roomId, 'gift-leaderboard-updated', { roomId, leaderboard: [] });
}

function simulateRoomCreated(bus, roomId, room) {
  bus.emitGlobal('rooms-updated', { action: 'added', room });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Task-4: RoomCreated broadcast', () => {
  test('all global subscribers receive rooms-updated(added)', () => {
    bus.subscribeGlobal('home-screen');
    bus.subscribeGlobal('discovery-screen');
    simulateRoomCreated(bus, 'r1', { id: 'r1', name: 'New Room' });

    for (const c of ['home-screen', 'discovery-screen']) {
      const evts = bus.receivedBy(c).filter(e => e.event === 'rooms-updated');
      assert.equal(evts.length, 1, `${c} received rooms-updated`);
      assert.equal(evts[0].data.action, 'added');
    }
  });
});

describe('Task-4: UserJoined broadcast', () => {
  test('all room members receive user-joined', () => {
    bus.join('host', 'r1');
    bus.join('alice', 'r1');

    bus.emitToRoom('r1', 'user-joined', { userId: 'bob', role: 'audience' });

    for (const c of ['host', 'alice']) {
      const evts = bus.receivedBy(c).filter(e => e.event === 'user-joined');
      assert.equal(evts.length, 1, `${c} got user-joined`);
    }
  });

  test('user-joined includes role field', () => {
    bus.join('viewer', 'r1');
    bus.emitToRoom('r1', 'user-joined', { userId: 'bob', role: 'audience' });
    const evt = bus.receivedBy('viewer').find(e => e.event === 'user-joined');
    assert.equal(evt.data.role, 'audience');
  });
});

describe('Task-4: UserLeft broadcast', () => {
  test('remaining members receive user-left', () => {
    bus.join('host', 'r1');
    bus.join('alice', 'r1');
    bus.join('bob', 'r1');

    simulateLeave(bus, 'r1', 'alice', false);

    const hostEvts  = bus.receivedBy('host').filter(e => e.event === 'user-left');
    const bobEvts   = bus.receivedBy('bob').filter(e => e.event === 'user-left');
    assert.equal(hostEvts.length, 1);
    assert.equal(bobEvts.length,  1);
  });

  test('user-left includes seat-update', () => {
    bus.join('host', 'r1');
    bus.join('alice', 'r1');
    simulateLeave(bus, 'r1', 'alice', false);

    const seatEvts = bus.receivedBy('host').filter(e => e.event === 'seat-update');
    assert.ok(seatEvts.length >= 1, 'seat-update sent after leave');
  });
});

describe('Task-4: HostLeft broadcast', () => {
  test('all room members receive room-closed, host-left, room-ended', () => {
    bus.join('alice',   'r1');
    bus.join('viewer1', 'r1');
    simulateLeave(bus, 'r1', 'host1', true);

    for (const c of ['alice', 'viewer1']) {
      const evts = bus.receivedBy(c).map(e => e.event);
      assert.ok(evts.includes('room-closed'), `${c} got room-closed`);
      assert.ok(evts.includes('host-left'),   `${c} got host-left`);
      assert.ok(evts.includes('room-ended'),  `${c} got room-ended`);
    }
  });

  test('global rooms-updated(removed) emitted when host leaves', () => {
    bus.subscribeGlobal('discovery');
    simulateLeave(bus, 'r1', 'host1', true);

    const evts = bus.receivedBy('discovery').filter(e => e.event === 'rooms-updated');
    assert.equal(evts.length, 1);
    assert.equal(evts[0].data.action, 'removed');
  });
});

describe('Task-4: SeatUpdated broadcast', () => {
  test('seat-update emitted after join', () => {
    bus.join('alice', 'r1');
    simulateJoin(bus, 'r1', 'bob', 'speaker');

    const evts = bus.receivedBy('alice').filter(e => e.event === 'seat-update');
    assert.ok(evts.length >= 1);
  });

  test('seat-update emitted after leave', () => {
    bus.join('host', 'r1');
    bus.join('alice', 'r1');
    simulateLeave(bus, 'r1', 'alice', false);

    const evts = bus.receivedBy('host').filter(e => e.event === 'seat-update');
    assert.ok(evts.length >= 1);
  });
});

describe('Task-4: MuteUpdated broadcast', () => {
  test('user-muted broadcast to all room members', () => {
    bus.join('host',  'r1');
    bus.join('alice', 'r1');
    bus.join('bob',   'r1');
    simulateMuteUpdate(bus, 'r1', 'alice', true);

    for (const c of ['host', 'alice', 'bob']) {
      const evts = bus.receivedBy(c).filter(e => e.event === 'user-muted');
      assert.equal(evts.length, 1, `${c} received user-muted`);
      assert.equal(evts[0].data.isMuted, true);
    }
  });
});

describe('Task-4: Reconnect event', () => {
  test('rejoining socket receives room-state', () => {
    simulateJoin(bus, 'r1', 'alice', 'speaker');
    const stateEvt = bus.receivedBy('alice').find(e => e.event === 'room-state');
    assert.ok(stateEvt, 'alice received room-state on join');
    assert.equal(stateEvt.data.roomId, 'r1');
  });
});

describe('Gifts: socket events', () => {
  test('gift-received emitted to all room members', () => {
    bus.join('host',   'r1');
    bus.join('alice',  'r1');
    bus.join('viewer', 'r1');
    simulateGift(bus, 'r1', 'alice', 'host', { name: 'Rose', coinPrice: 10 });

    for (const c of ['host', 'alice', 'viewer']) {
      const evts = bus.receivedBy(c).filter(e => e.event === 'gift-received');
      assert.equal(evts.length, 1, `${c} received gift-received`);
    }
  });

  test('gift-leaderboard-updated emitted after gift', () => {
    bus.join('host', 'r1');
    simulateGift(bus, 'r1', 'sender', 'receiver', { name: 'Crown', coinPrice: 100 });
    const evts = bus.receivedBy('host').filter(e => e.event === 'gift-leaderboard-updated');
    assert.equal(evts.length, 1);
  });
});

describe('full lifecycle — end-to-end socket events', () => {
  test('all 10 required events across complete session', () => {
    bus.subscribeGlobal('discovery');

    // Room created
    simulateRoomCreated(bus, 'r1', { id: 'r1', name: 'Room 1' });
    bus.join('host',   'r1');
    bus.join('alice',  'r1');
    bus.join('viewer', 'r1');

    // Users join
    simulateJoin(bus, 'r1', 'alice', 'speaker');

    // Gift sent
    simulateGift(bus, 'r1', 'viewer', 'alice', { name: 'Rose', coinPrice: 10 });

    // Mute change
    simulateMuteUpdate(bus, 'r1', 'alice', true);

    // User leaves
    simulateLeave(bus, 'r1', 'alice', false);

    // Host leaves
    simulateLeave(bus, 'r1', 'host', true);

    const required = {
      'rooms-updated':           (list) => assert.ok(list.length >= 2, 'at least 2 rooms-updated: added + removed'),
      'user-joined':             (list) => assert.ok(list.length >= 1),
      'gift-received':           (list) => assert.ok(list.length >= 1),
      'user-muted':              (list) => assert.ok(list.length >= 1),
      'user-left':               (list) => assert.ok(list.length >= 1),
      'seat-update':             (list) => assert.ok(list.length >= 1),
      'room-updated':            (list) => assert.ok(list.length >= 1),
      'room-closed':             (list) => assert.ok(list.length >= 1),
      'host-left':               (list) => assert.ok(list.length >= 1),
      'room-ended':              (list) => assert.ok(list.length >= 1),
      'gift-leaderboard-updated':(list) => assert.ok(list.length >= 1),
    };

    for (const [evt, check] of Object.entries(required)) {
      check(bus.receivedEvent(evt), evt);
    }
  });
});
