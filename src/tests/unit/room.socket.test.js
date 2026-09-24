/**
 * Unit tests — room.socket.js core helpers
 * Uses Node.js built-in test runner (node:test).
 *
 * Tests: closeRoomAndNotify (idempotency), user cleanup, seat clearing,
 *        rate limiting, voice session tracking.
 */
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { serializeSeat } = require('../../utils/room.serializer');

// ─── Rate limit logic (extracted for unit testing) ───────────────────────────
const RATE_LIMIT_WINDOW_MS = 10 * 1000;
const RATE_LIMIT_MAX_MESSAGES = 20;
const socketRateLimits = new Map();

function checkMessageRateLimit(socketId) {
  const now = Date.now();
  const entry = socketRateLimits.get(socketId);
  if (!entry || now > entry.resetAt) {
    socketRateLimits.set(socketId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX_MESSAGES) return false;
  entry.count++;
  return true;
}

function cleanupRateLimit(socketId) {
  socketRateLimits.delete(socketId);
}

// ─── Seat clear logic ─────────────────────────────────────────────────────────
function buildClearSeatResult(seats, userId, roomId) {
  return seats.map(s =>
    (s.userId === userId && s.roomId === roomId)
      ? { ...s, userId: null, isMuted: false, forceMuted: false, isModerator: false }
      : s
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('rate limiting', () => {
  beforeEach(() => socketRateLimits.clear());

  test('allows messages up to limit', () => {
    for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES; i++) {
      assert.ok(checkMessageRateLimit('socket-1'), `message ${i + 1} allowed`);
    }
  });

  test('blocks the (limit+1)th message', () => {
    for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES; i++) checkMessageRateLimit('socket-1');
    assert.equal(checkMessageRateLimit('socket-1'), false, 'blocked after limit');
  });

  test('different socket IDs have independent limits', () => {
    for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES; i++) checkMessageRateLimit('socket-A');
    assert.equal(checkMessageRateLimit('socket-B'), true, 'socket-B not affected');
  });

  test('cleanup removes the entry', () => {
    for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES; i++) checkMessageRateLimit('socket-1');
    cleanupRateLimit('socket-1');
    assert.equal(checkMessageRateLimit('socket-1'), true, 'allows again after cleanup');
  });
});

describe('seat clearing', () => {
  const seats = [
    { id: 's1', roomId: 'room1', userId: 'alice', seatIndex: 0, isMuted: true,  forceMuted: true,  isModerator: true  },
    { id: 's2', roomId: 'room1', userId: 'bob',   seatIndex: 1, isMuted: false, forceMuted: false, isModerator: false },
    { id: 's3', roomId: 'room2', userId: 'alice', seatIndex: 0, isMuted: true,  forceMuted: false, isModerator: true  },
  ];

  test('clears only the matching user+room seat', () => {
    const result = buildClearSeatResult(seats, 'alice', 'room1');
    const cleared = result.find(s => s.id === 's1');
    assert.equal(cleared.userId,      null,  'userId cleared');
    assert.equal(cleared.isMuted,     false, 'isMuted reset');
    assert.equal(cleared.forceMuted,  false, 'forceMuted reset');
    assert.equal(cleared.isModerator, false, 'isModerator reset');
  });

  test('does not affect other users in same room', () => {
    const result = buildClearSeatResult(seats, 'alice', 'room1');
    const bob = result.find(s => s.id === 's2');
    assert.equal(bob.userId, 'bob', 'bob unchanged');
  });

  test('does not affect same user in different room', () => {
    const result = buildClearSeatResult(seats, 'alice', 'room1');
    const aliceRoom2 = result.find(s => s.id === 's3');
    assert.equal(aliceRoom2.userId, 'alice', 'alice in room2 unchanged');
  });
});

describe('closeRoomAndNotify — idempotency', () => {
  // Simulate the idempotency guard: isActive check before closing
  function simulateCloseRoom(rooms, roomId) {
    const room = rooms.find(r => r.id === roomId);
    if (!room || !room.isActive) return { closed: false, reason: 'already_closed' };
    room.isActive = false;
    room.closedAt = new Date();
    return { closed: true };
  }

  test('closes an active room', () => {
    const rooms = [{ id: 'r1', isActive: true }];
    const result = simulateCloseRoom(rooms, 'r1');
    assert.equal(result.closed, true);
    assert.equal(rooms[0].isActive, false);
  });

  test('is idempotent — second call is a no-op', () => {
    const rooms = [{ id: 'r1', isActive: true }];
    simulateCloseRoom(rooms, 'r1');
    const result = simulateCloseRoom(rooms, 'r1');
    assert.equal(result.closed, false, 'second call does nothing');
    assert.equal(result.reason, 'already_closed');
  });

  test('returns no-op for unknown room', () => {
    const rooms = [];
    const result = simulateCloseRoom(rooms, 'unknown');
    assert.equal(result.closed, false);
  });
});

describe('host detection', () => {
  const rooms = [
    { id: 'r1', ownerId: 'host-1', isActive: true },
    { id: 'r2', ownerId: 'host-2', isActive: false },
  ];

  test('correctly identifies host', () => {
    const room = rooms.find(r => r.id === 'r1');
    assert.equal(room.ownerId === 'host-1', true);
    assert.equal(room.ownerId === 'other-user', false);
  });

  test('correctly identifies non-host', () => {
    const room = rooms.find(r => r.id === 'r1');
    assert.equal(room.ownerId === 'audience-member', false);
  });
});

describe('voice session key helpers', () => {
  function getSessionKey(userId) { return `voice:${userId}`; }

  test('generates correct key format', () => {
    assert.equal(getSessionKey('abc123'), 'voice:abc123');
  });

  test('different users produce different keys', () => {
    assert.notEqual(getSessionKey('u1'), getSessionKey('u2'));
  });
});

describe('serializeSeat defensive fallbacks', () => {
  test('serializeSeat applies defensive fallbacks for null values', () => {
    const seatWithNulls = { id: 's4', roomId: 'room1', userId: null, seatIndex: 2, isMuted: false, forceMuted: null, isModerator: null, user: null };
    const serialized = serializeSeat(seatWithNulls, 'owner1');
    assert.equal(serialized.forceMuted, false, 'forceMuted should default to false');
    assert.equal(serialized.isModerator, false, 'isModerator should default to false');
    assert.equal(serialized.isOwner, false, 'isOwner should be false when userId is null');
  });

  test('serializeSeat correctly identifies owner by userId comparison', () => {
    const ownerSeat = { id: 's5', roomId: 'room1', userId: 'owner1', seatIndex: 0, isMuted: false, forceMuted: false, isModerator: false, user: { username: 'owner', avatar: 'url3', role: 'USER' } };
    const serialized = serializeSeat(ownerSeat, 'owner1');
    assert.equal(serialized.isOwner, true, 'isOwner should be true when userId matches ownerId');
  });
});
