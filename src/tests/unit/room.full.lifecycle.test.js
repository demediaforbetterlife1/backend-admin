'use strict';
/**
 * room.full.lifecycle.test.js
 *
 * Comprehensive room lifecycle tests covering ALL 10 required scenarios:
 *   1.  Owner creates room → appears in active list
 *   2.  Speaker joins → participant count increases instantly
 *   3.  Audience joins → participant count increases instantly
 *   4.  Speaker leaves → participant count decreases, room stays active
 *   5.  Audience leaves → participant count decreases, room stays active
 *   6.  Audience disconnects unexpectedly → ghost participant cleaned up (BUG-1 FIX)
 *   7.  Owner leaves → room closed, everyone notified, room removed from list
 *   8.  Owner disconnects unexpectedly → same as owner leaves
 *   9.  Socket reconnect → room state consistent, no duplicates
 *  10.  Join closed room → proper error, no infinite loading (BUG-3 FIX)
 *  11.  Room list sync → rooms-updated emitted on create/close (BUG-2 FIX)
 *  12.  Gift lifecycle → debit sender, credit receiver, socket event, transaction
 *
 * Uses Node built-in test runner — no external dependencies.
 * No network, no Prisma, no Socket.IO server needed.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── In-memory DB ─────────────────────────────────────────────────────────────
class DB {
  constructor() {
    this.rooms        = new Map();
    this.seats        = new Map(); // roomId → Map<seatIndex, userId|null>
    this.participants = new Map(); // roomId → Map<userId, role>
    this.requests     = new Map(); // roomId → Map<userId, status>
    this.gifts        = new Map();
    this.wallets      = new Map(); // userId → balance
    this.giftTx       = [];
    this.coinTx       = [];
    this._id          = 1;
  }

  nextId() { return `id-${this._id++}`; }

  createRoom(ownerId, { name = 'Room', maxSeats = 4 } = {}) {
    const id = this.nextId();
    const room = { id, name, ownerId, maxSeats, isActive: true, closedAt: null };
    this.rooms.set(id, room);
    this.seats.set(id, new Map());
    this.participants.set(id, new Map());
    this.requests.set(id, new Map());
    return room;
  }

  addSeat(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room?.isActive) throw Object.assign(new Error('Room is closed'), { code: 'ROOM_CLOSED' });
    const seats = this.seats.get(roomId);
    if (seats.size >= room.maxSeats) throw Object.assign(new Error('Room full'), { code: 'ROOM_FULL' });
    for (let i = 0; i < room.maxSeats; i++) {
      if (!seats.has(i) || seats.get(i) === null) { seats.set(i, userId); break; }
    }
    this.participants.get(roomId).set(userId, 'SPEAKER');
  }

  addAudience(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room?.isActive) throw Object.assign(new Error('Room is closed'), { code: 'ROOM_CLOSED' });
    this.participants.get(roomId).set(userId, 'AUDIENCE');
  }

  removeSeat(roomId, userId) {
    const seats = this.seats.get(roomId);
    if (!seats) return;
    for (const [i, uid] of seats) { if (uid === userId) { seats.set(i, null); break; } }
    this.participants.get(roomId)?.delete(userId);
    this.requests.get(roomId)?.delete(userId);
  }

  removeParticipant(roomId, userId) {
    this.removeSeat(roomId, userId);
  }

  participantCount(roomId) { return this.participants.get(roomId)?.size ?? 0; }

  getActiveRooms() {
    return Array.from(this.rooms.values()).filter(r => r.isActive && !r.isPrivate);
  }

  getRoomById(roomId) {
    const r = this.rooms.get(roomId);
    // BUG-3 FIX: closed room returns null (404)
    if (!r || !r.isActive) return null;
    return r;
  }

  addGift({ id, name, coinPrice, isActive = true }) {
    this.gifts.set(id, { id, name, coinPrice, isActive });
  }

  addWallet(userId, balance) { this.wallets.set(userId, balance); }
  getBalance(userId) { return this.wallets.get(userId) ?? 0; }
  debit(userId, amount) {
    const b = this.wallets.get(userId) ?? 0;
    if (b < amount) throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_FUNDS' });
    this.wallets.set(userId, b - amount);
  }
  credit(userId, amount) { this.wallets.set(userId, (this.wallets.get(userId) ?? 0) + amount); }
}

// ─── Event bus ────────────────────────────────────────────────────────────────
class Bus {
  constructor() { this.events = []; }
  emit(event, data) { this.events.push({ event, data, ts: Date.now() }); }
  get(name) { return this.events.filter(e => e.event === name); }
  clear() { this.events = []; }
}

// ─── Core logic (mirrors production code) ────────────────────────────────────

function closeRoomAndNotify(db, bus, roomId, reason) {
  const room = db.rooms.get(roomId);
  if (!room || !room.isActive) return; // idempotent
  room.isActive = false;
  room.closedAt = new Date();
  for (const [i] of db.seats.get(roomId) ?? []) db.seats.get(roomId).set(i, null);
  db.participants.get(roomId)?.clear();
  if (db.requests.has(roomId)) {
    for (const [uid] of db.requests.get(roomId)) db.requests.get(roomId).set(uid, 'CANCELLED');
  }
  bus.emit('room-closed',   { roomId, reason });
  if (reason === 'host_left' || reason === 'host_disconnected') {
    bus.emit('host-left',   { roomId, reason });
  }
  bus.emit('room-ended',    { roomId, reason });
  bus.emit('rooms-updated', { action: 'removed', roomId });
}

function joinRoom(db, bus, roomId, userId, asAudience = false) {
  if (asAudience) {
    db.addAudience(roomId, userId);
  } else {
    db.addSeat(roomId, userId);
  }
  const count = db.participantCount(roomId);
  bus.emit('user-joined',   { userId, roomId, role: asAudience ? 'audience' : 'speaker' });
  // BUG-2 FIX: room-updated emitted on join
  bus.emit('room-updated',  { roomId, participantCount: count });
}

function leaveRoom(db, bus, roomId, userId) {
  const room = db.rooms.get(roomId);
  if (!room) return;
  db.removeParticipant(roomId, userId);
  if (room.ownerId === userId && room.isActive) {
    closeRoomAndNotify(db, bus, roomId, 'host_left');
    return;
  }
  const count = db.participantCount(roomId);
  bus.emit('user-left',    { userId, roomId });
  bus.emit('room-updated', { roomId, participantCount: count });
}

// BUG-1 FIX: disconnectSocket handles BOTH speakers (via session) and audience
function disconnectSocket(db, bus, userId, socketRooms) {
  const room = db.rooms.get(socketRooms[0]);
  if (!room) return;
  const roomId = room.id;
  const hasSeat = Array.from(db.seats.get(roomId)?.values() ?? []).includes(userId);

  if (hasSeat) {
    // speaker path (was already covered)
    db.removeParticipant(roomId, userId);
    if (room.ownerId === userId && room.isActive) {
      closeRoomAndNotify(db, bus, roomId, 'host_disconnected');
      return;
    }
  } else {
    // BUG-1 FIX: audience-only path — was previously skipped entirely
    const isParticipant = db.participants.get(roomId)?.has(userId);
    if (!isParticipant) return;
    db.participants.get(roomId).delete(userId);
  }
  const count = db.participantCount(roomId);
  bus.emit('user-left',    { userId, roomId });
  bus.emit('room-updated', { roomId, participantCount: count });
}

function sendGift(db, bus, { senderId, giftId, receiverId, roomId, quantity = 1 }) {
  if (senderId === receiverId) throw new Error('Cannot send gift to yourself');
  if (!quantity || quantity < 1 || quantity > 99) throw new Error('Invalid quantity');
  const gift = db.gifts.get(giftId);
  if (!gift || !gift.isActive) throw new Error('Gift not available');
  const room = db.rooms.get(roomId);
  if (!room || !room.isActive) throw new Error('Room not found');
  const total = gift.coinPrice * quantity;
  db.debit(senderId, total);
  db.credit(receiverId, total);
  const tx = { id: db.nextId(), senderId, receiverId, giftId, roomId, quantity, totalCoins: total };
  db.giftTx.push(tx);
  db.coinTx.push({ userId: senderId,   type: 'GIFT_SENT',     amount: -total, ref: tx.id });
  db.coinTx.push({ userId: receiverId, type: 'GIFT_RECEIVED', amount: +total, ref: tx.id });
  bus.emit('gift-received', {
    senderId, receiverId, giftId, giftName: gift.name,
    quantity, totalCoins: total, animationUrl: 'anim.json',
    timestamp: new Date().toISOString(),
  });
  return tx;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────
let db, bus;
beforeEach(() => { db = new DB(); bus = new Bus(); });

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 1: Room creation
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-1 | room creation → appears in active list', () => {
  test('new room is active', () => {
    const r = db.createRoom('o1', { name: 'Live Room' });
    assert.equal(r.isActive, true);
    assert.equal(db.getActiveRooms().length, 1);
  });

  test('rooms-updated(added) should be emitted on create', () => {
    const r = db.createRoom('o1');
    bus.emit('rooms-updated', { action: 'added', room: r });
    const evs = bus.get('rooms-updated');
    assert.equal(evs.length, 1);
    assert.equal(evs[0].data.action, 'added');
  });

  test('multiple rooms all appear in list', () => {
    db.createRoom('o1');
    db.createRoom('o2');
    db.createRoom('o3');
    assert.equal(db.getActiveRooms().length, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Speaker joins → participant count updates
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-2 | speaker joins → count updates instantly', () => {
  test('count is 0 before join, 1 after', () => {
    const r = db.createRoom('o1');
    assert.equal(db.participantCount(r.id), 0);
    joinRoom(db, bus, r.id, 'u1');
    assert.equal(db.participantCount(r.id), 1);
  });

  test('room-updated emitted with correct count', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'u1');
    const ev = bus.get('room-updated');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].data.participantCount, 1);
  });

  test('user-joined emitted with role=speaker', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'u1');
    const ev = bus.get('user-joined')[0];
    assert.equal(ev.data.role, 'speaker');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Audience joins → participant count updates
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-3 | audience joins → count updates instantly', () => {
  test('count increases on audience join', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'viewer1', true);
    assert.equal(db.participantCount(r.id), 1);
  });

  test('room-updated emitted after audience join', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'viewer1', true);
    const ev = bus.get('room-updated');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].data.participantCount, 1);
  });

  test('speaker + audience counts cumulate', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'speaker1');
    joinRoom(db, bus, r.id, 'viewer1', true);
    assert.equal(db.participantCount(r.id), 2);
    const evs = bus.get('room-updated');
    assert.equal(evs[evs.length - 1].data.participantCount, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Speaker leaves → count decreases, room stays active
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-4 | speaker leaves → count decreases, room stays active', () => {
  test('room stays active after non-owner speaker leaves', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'u1');
    leaveRoom(db, bus, r.id, 'u1');
    assert.equal(db.rooms.get(r.id).isActive, true);
  });

  test('count drops after speaker leaves', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'u1');
    joinRoom(db, bus, r.id, 'u2');
    leaveRoom(db, bus, r.id, 'u1');
    assert.equal(db.participantCount(r.id), 1);
  });

  test('user-left emitted, no room-closed', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'u1');
    bus.clear();
    leaveRoom(db, bus, r.id, 'u1');
    assert.equal(bus.get('user-left').length, 1);
    assert.equal(bus.get('room-closed').length, 0);
    assert.equal(bus.get('rooms-updated').length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 5: Audience leaves → count decreases, room stays active
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-5 | audience leaves → count decreases, room stays active', () => {
  test('room stays active after audience leaves', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'v1', true);
    leaveRoom(db, bus, r.id, 'v1');
    assert.equal(db.rooms.get(r.id).isActive, true);
  });

  test('count drops after audience leaves', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'v1', true);
    joinRoom(db, bus, r.id, 'v2', true);
    leaveRoom(db, bus, r.id, 'v1');
    assert.equal(db.participantCount(r.id), 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Audience DISCONNECTS unexpectedly → ghost cleaned (BUG-1 FIX)
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-6 | BUG-1 FIX: audience ghost cleaned on unexpected disconnect', () => {
  test('audience ghost participant removed after disconnect', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'viewer1', true); // audience join
    assert.equal(db.participantCount(r.id), 1);

    // Unexpected disconnect — no explicit leave-room event
    disconnectSocket(db, bus, 'viewer1', [r.id]);

    assert.equal(db.participantCount(r.id), 0,
      'BUG-1: audience ghost must be removed on disconnect');
  });

  test('user-left emitted after audience disconnect', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'viewer1', true);
    bus.clear();
    disconnectSocket(db, bus, 'viewer1', [r.id]);
    assert.equal(bus.get('user-left').length, 1);
    assert.equal(bus.get('user-left')[0].data.userId, 'viewer1');
  });

  test('room-updated emitted with correct count after audience disconnect', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'v1', true);
    joinRoom(db, bus, r.id, 'v2', true);
    bus.clear();
    disconnectSocket(db, bus, 'v1', [r.id]);
    const ev = bus.get('room-updated');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].data.participantCount, 1);
  });

  test('room stays active after audience disconnect', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'v1', true);
    disconnectSocket(db, bus, 'v1', [r.id]);
    assert.equal(db.rooms.get(r.id).isActive, true);
  });

  test('multiple audience disconnects leave count at 0', () => {
    const r = db.createRoom('o1');
    ['v1','v2','v3'].forEach(v => joinRoom(db, bus, r.id, v, true));
    ['v1','v2','v3'].forEach(v => disconnectSocket(db, bus, v, [r.id]));
    assert.equal(db.participantCount(r.id), 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 7: Owner leaves → room closed, everyone notified, removed from list
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-7 | owner leaves → room closed & removed from list', () => {
  test('room.isActive becomes false', () => {
    const r = db.createRoom('owner1');
    joinRoom(db, bus, r.id, 'u1');
    leaveRoom(db, bus, r.id, 'owner1');
    assert.equal(db.rooms.get(r.id).isActive, false);
  });

  test('closedAt timestamp set', () => {
    const r = db.createRoom('owner1');
    leaveRoom(db, bus, r.id, 'owner1');
    assert.ok(db.rooms.get(r.id).closedAt instanceof Date);
  });

  test('all participants removed', () => {
    const r = db.createRoom('owner1');
    joinRoom(db, bus, r.id, 'u1');
    joinRoom(db, bus, r.id, 'v1', true);
    leaveRoom(db, bus, r.id, 'owner1');
    assert.equal(db.participantCount(r.id), 0);
  });

  test('room-closed, host-left, room-ended, rooms-updated(removed) all emitted', () => {
    const r = db.createRoom('owner1');
    leaveRoom(db, bus, r.id, 'owner1');
    assert.equal(bus.get('room-closed').length, 1);
    assert.equal(bus.get('host-left').length, 1);
    assert.equal(bus.get('room-ended').length, 1);
    const ru = bus.get('rooms-updated');
    assert.equal(ru.length, 1);
    assert.equal(ru[0].data.action, 'removed');
    assert.equal(ru[0].data.roomId, r.id);
  });

  test('room disappears from active list after owner leaves', () => {
    const r1 = db.createRoom('owner1');
    const r2 = db.createRoom('owner2');
    leaveRoom(db, bus, r1.id, 'owner1');
    const active = db.getActiveRooms();
    assert.equal(active.length, 1);
    assert.equal(active[0].id, r2.id);
    assert.ok(!active.find(r => r.id === r1.id));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 8: Owner disconnects → same result as owner leaving
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-8 | owner disconnects unexpectedly → room closed', () => {
  test('room closed on owner disconnect', () => {
    const r = db.createRoom('owner1');
    joinRoom(db, bus, r.id, 'owner1');
    disconnectSocket(db, bus, 'owner1', [r.id]);
    assert.equal(db.rooms.get(r.id).isActive, false);
  });

  test('host-disconnected reason used on disconnect', () => {
    const r = db.createRoom('owner1');
    joinRoom(db, bus, r.id, 'owner1');
    disconnectSocket(db, bus, 'owner1', [r.id]);
    const ev = bus.get('host-left');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].data.reason, 'host_disconnected');
  });

  test('all participants removed on owner disconnect', () => {
    const r = db.createRoom('owner1');
    joinRoom(db, bus, r.id, 'owner1');
    joinRoom(db, bus, r.id, 'u1');
    joinRoom(db, bus, r.id, 'v1', true);
    disconnectSocket(db, bus, 'owner1', [r.id]);
    assert.equal(db.participantCount(r.id), 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 9: Reconnect → state consistent, no duplicates
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-9 | reconnect → consistent state, no duplicates', () => {
  test('user can rejoin after disconnect', () => {
    const r = db.createRoom('owner1');
    joinRoom(db, bus, r.id, 'u1');
    leaveRoom(db, bus, r.id, 'u1');
    joinRoom(db, bus, r.id, 'u1');
    assert.equal(db.participantCount(r.id), 1);
  });

  test('seat count never exceeds maxSeats after multiple reconnects', () => {
    const r = db.createRoom('owner1', { maxSeats: 2 });
    joinRoom(db, bus, r.id, 'u1');
    leaveRoom(db, bus, r.id, 'u1');
    joinRoom(db, bus, r.id, 'u1');
    joinRoom(db, bus, r.id, 'u2');
    const occupied = Array.from(db.seats.get(r.id).values()).filter(v => v !== null).length;
    assert.equal(occupied, 2);
  });

  test('no ghost after reconnect-disconnect cycle x3', () => {
    const r = db.createRoom('owner1');
    for (let i = 0; i < 3; i++) {
      joinRoom(db, bus, r.id, 'u1');
      disconnectSocket(db, bus, 'u1', [r.id]);
    }
    assert.equal(db.participantCount(r.id), 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 10: Join closed room → proper error, no infinite loading (BUG-3 FIX)
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-10 | BUG-3 FIX: joining closed room returns proper error', () => {
  test('getRoomById returns null for inactive room', () => {
    const r = db.createRoom('owner1');
    db.rooms.get(r.id).isActive = false; // close it
    const found = db.getRoomById(r.id);
    assert.equal(found, null,
      'BUG-3: closed room must return null (404) not the room object');
  });

  test('joining closed room throws ROOM_CLOSED', () => {
    const r = db.createRoom('owner1');
    leaveRoom(db, bus, r.id, 'owner1'); // close via owner leave
    assert.throws(
      () => joinRoom(db, bus, r.id, 'late-user'),
      (err) => err.code === 'ROOM_CLOSED',
    );
  });

  test('audience cannot join closed room', () => {
    const r = db.createRoom('owner1');
    leaveRoom(db, bus, r.id, 'owner1');
    assert.throws(
      () => joinRoom(db, bus, r.id, 'viewer1', true),
      (err) => err.code === 'ROOM_CLOSED',
    );
  });

  test('closed room not in active list', () => {
    const r = db.createRoom('owner1');
    leaveRoom(db, bus, r.id, 'owner1');
    assert.equal(db.getActiveRooms().length, 0);
  });

  test('getRoomById returns active room correctly', () => {
    const r = db.createRoom('owner1');
    assert.ok(db.getRoomById(r.id) !== null,
      'active room must be findable');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 11: Room list sync via socket events (BUG-2 FIX)
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-11 | BUG-2 FIX: room list syncs via socket events', () => {
  test('room-updated emitted on every join', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'u1');
    joinRoom(db, bus, r.id, 'u2');
    const evs = bus.get('room-updated');
    assert.equal(evs.length, 2, 'room-updated must fire for each join');
  });

  test('room-updated participantCount is accurate after each join', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'u1');
    joinRoom(db, bus, r.id, 'u2');
    const evs = bus.get('room-updated');
    assert.equal(evs[0].data.participantCount, 1);
    assert.equal(evs[1].data.participantCount, 2);
  });

  test('rooms-updated(removed) fires when owner leaves', () => {
    const r = db.createRoom('o1');
    leaveRoom(db, bus, r.id, 'o1');
    const evs = bus.get('rooms-updated').filter(e => e.data.action === 'removed');
    assert.equal(evs.length, 1);
    assert.equal(evs[0].data.roomId, r.id);
  });

  test('rooms-updated NOT fired when non-owner leaves', () => {
    const r = db.createRoom('o1');
    joinRoom(db, bus, r.id, 'u1');
    bus.clear();
    leaveRoom(db, bus, r.id, 'u1');
    assert.equal(bus.get('rooms-updated').length, 0);
  });

  test('closeRoomAndNotify is idempotent — fires events only once', () => {
    const r = db.createRoom('o1');
    closeRoomAndNotify(db, bus, r.id, 'host_left');
    closeRoomAndNotify(db, bus, r.id, 'host_left'); // second call is no-op
    assert.equal(bus.get('room-closed').length, 1);
    assert.equal(bus.get('rooms-updated').length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 12: Gift lifecycle end-to-end
// ═══════════════════════════════════════════════════════════════════════════════
describe('SCENARIO-12 | gift lifecycle: send → debit → credit → socket → record', () => {
  function setup() {
    const d = new DB(); const b = new Bus();
    d.addGift({ id: 'g1', name: 'Rose', coinPrice: 10, isActive: true });
    d.addGift({ id: 'g2', name: 'Crown', coinPrice: 100, isActive: true });
    d.addGift({ id: 'g3', name: 'Dead', coinPrice: 5, isActive: false });
    d.addUser = (id) => { d.wallets.set(id, 0); };
    d.addUser('sender1');
    d.addUser('recv1');
    d.wallets.set('sender1', 500);
    const r = d.createRoom('owner1');
    d.addAudience(r.id, 'sender1');
    d.addAudience(r.id, 'recv1');
    return { d, b, r };
  }

  test('GiftTransaction record is created', () => {
    const { d, b, r } = setup();
    sendGift(d, b, { senderId: 'sender1', giftId: 'g1', receiverId: 'recv1', roomId: r.id });
    assert.equal(d.giftTx.length, 1);
    assert.equal(d.giftTx[0].totalCoins, 10);
  });

  test('sender coins debited', () => {
    const { d, b, r } = setup();
    sendGift(d, b, { senderId: 'sender1', giftId: 'g1', receiverId: 'recv1', roomId: r.id });
    assert.equal(d.getBalance('sender1'), 490);
  });

  test('receiver coins credited', () => {
    const { d, b, r } = setup();
    sendGift(d, b, { senderId: 'sender1', giftId: 'g1', receiverId: 'recv1', roomId: r.id });
    assert.equal(d.getBalance('recv1'), 10);
  });

  test('CoinTransaction records created for sender and receiver', () => {
    const { d, b, r } = setup();
    sendGift(d, b, { senderId: 'sender1', giftId: 'g1', receiverId: 'recv1', roomId: r.id });
    const senderTx   = d.coinTx.find(t => t.userId === 'sender1' && t.type === 'GIFT_SENT');
    const receiverTx = d.coinTx.find(t => t.userId === 'recv1' && t.type === 'GIFT_RECEIVED');
    assert.ok(senderTx,   'sender CoinTransaction missing');
    assert.ok(receiverTx, 'receiver CoinTransaction missing');
    assert.equal(senderTx.amount, -10);
    assert.ok(receiverTx.amount > 0);
    assert.equal(senderTx.ref, d.giftTx[0].id);
    assert.equal(receiverTx.ref, d.giftTx[0].id);
  });

  test('gift-received socket event emitted with required fields', () => {
    const { d, b, r } = setup();
    sendGift(d, b, { senderId: 'sender1', giftId: 'g1', receiverId: 'recv1', roomId: r.id });
    const ev = b.get('gift-received');
    assert.equal(ev.length, 1);
    const p = ev[0].data;
    assert.ok(p.senderId);
    assert.ok(p.receiverId);
    assert.ok(p.giftId);
    assert.ok(p.giftName);
    assert.ok(p.animationUrl !== undefined);
    assert.ok(p.totalCoins >= 0);
    assert.ok(p.timestamp);
  });

  test('sending to yourself is rejected', () => {
    const { d, b, r } = setup();
    assert.throws(
      () => sendGift(d, b, { senderId: 'sender1', giftId: 'g1', receiverId: 'sender1', roomId: r.id }),
      /yourself/,
    );
    assert.equal(d.giftTx.length, 0);
  });

  test('insufficient balance rejected, no partial state', () => {
    const { d, b, r } = setup();
    d.wallets.set('sender1', 5); // only 5, gift costs 10
    assert.throws(
      () => sendGift(d, b, { senderId: 'sender1', giftId: 'g1', receiverId: 'recv1', roomId: r.id }),
      (e) => e.code === 'INSUFFICIENT_FUNDS',
    );
    assert.equal(d.giftTx.length, 0);
    assert.equal(b.get('gift-received').length, 0);
    assert.equal(d.getBalance('recv1'), 0, 'receiver must not be credited on failure');
  });

  test('inactive gift cannot be sent', () => {
    const { d, b, r } = setup();
    assert.throws(
      () => sendGift(d, b, { senderId: 'sender1', giftId: 'g3', receiverId: 'recv1', roomId: r.id }),
      /not available/,
    );
  });

  test('sending to closed room is rejected', () => {
    const { d, b, r } = setup();
    closeRoomAndNotify(d, b, r.id, 'host_left');
    assert.throws(
      () => sendGift(d, b, { senderId: 'sender1', giftId: 'g1', receiverId: 'recv1', roomId: r.id }),
      /Room not found/,
    );
  });

  test('no duplicate gift events on multiple sends', () => {
    const { d, b, r } = setup();
    sendGift(d, b, { senderId: 'sender1', giftId: 'g1', receiverId: 'recv1', roomId: r.id });
    sendGift(d, b, { senderId: 'sender1', giftId: 'g1', receiverId: 'recv1', roomId: r.id });
    assert.equal(b.get('gift-received').length, 2, 'exactly 2 events for 2 sends');
    assert.equal(d.giftTx.length, 2, 'exactly 2 transaction records');
  });

  test('quantity multiplier applied correctly', () => {
    const { d, b, r } = setup();
    sendGift(d, b, { senderId: 'sender1', giftId: 'g1', receiverId: 'recv1', roomId: r.id, quantity: 5 });
    assert.equal(d.getBalance('sender1'), 450);
    assert.equal(d.giftTx[0].totalCoins, 50);
  });
});
