/**
 * Unit tests — room state serialization, room model validation.
 * Uses Node.js built-in test runner (node:test).
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Inline the serializer logic so the test has no external deps
function serializeRoom(room) {
  return {
    id: room.id,
    name: room.name,
    image: room.image ?? null,
    isPrivate: room.isPrivate ?? false,
    isPasswordProtected: Boolean(room.passwordHash),
    maxSeats: room.maxSeats ?? 20,
    isActive: room.isActive ?? true,
    topic: room.topic ?? null,
    description: room.description ?? null,
    ownerId: room.ownerId,
    ownerName: room.owner?.username ?? null,
    ownerAvatar: room.owner?.avatar ?? null,
    seatCount: room.seats?.filter(s => s.userId).length ?? 0,
    listenersCount: (room._count?.participants ?? 0) - (room.seats?.filter(s => s.userId).length ?? 0),
    createdAt: room.createdAt?.toISOString?.() ?? room.createdAt,
    closedAt: room.closedAt?.toISOString?.() ?? room.closedAt ?? null,
    category: room.category ?? 'talk',
    tags: Array.isArray(room.tags) ? room.tags : [],
  };
}

const baseRoom = {
  id: 'r1',
  name: 'Test Room',
  image: null,
  isPrivate: false,
  passwordHash: null,
  maxSeats: 20,
  isActive: true,
  topic: null,
  description: null,
  ownerId: 'owner1',
  owner: { username: 'alice', avatar: 'https://cdn.example.com/alice.png' },
  seats: [],
  _count: { participants: 0 },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  closedAt: null,
  category: 'talk',
  tags: [],
};

describe('serializeRoom', () => {
  test('serializes all core fields correctly', () => {
    const result = serializeRoom(baseRoom);
    assert.equal(result.id,        'r1');
    assert.equal(result.name,      'Test Room');
    assert.equal(result.ownerId,   'owner1');
    assert.equal(result.ownerName, 'alice');
    assert.equal(result.isActive,  true);
    assert.equal(result.isPasswordProtected, false);
    assert.equal(result.seatCount,      0);
    assert.equal(result.listenersCount, 0);
  });

  test('isPasswordProtected is true when passwordHash is set', () => {
    const result = serializeRoom({ ...baseRoom, passwordHash: '$2a$10$hash' });
    assert.equal(result.isPasswordProtected, true);
  });

  test('seatCount counts only occupied seats', () => {
    const room = {
      ...baseRoom,
      seats: [
        { userId: 'u1', seatIndex: 0 },
        { userId: null, seatIndex: 1 },
        { userId: 'u2', seatIndex: 2 },
      ],
      _count: { participants: 5 },
    };
    const result = serializeRoom(room);
    assert.equal(result.seatCount,      2);
    assert.equal(result.listenersCount, 3, 'audience = total participants minus seated speakers');
  });

  test('tags defaults to empty array when null/undefined', () => {
    const result = serializeRoom({ ...baseRoom, tags: null });
    assert.deepEqual(result.tags, []);
  });

  test('closed room has closedAt set', () => {
    const closedAt = new Date('2026-06-01T12:00:00.000Z');
    const result = serializeRoom({ ...baseRoom, isActive: false, closedAt });
    assert.equal(result.isActive, false);
    assert.equal(result.closedAt, closedAt.toISOString());
  });

  test('ownerName is null when owner is not included', () => {
    const result = serializeRoom({ ...baseRoom, owner: null });
    assert.equal(result.ownerName,   null);
    assert.equal(result.ownerAvatar, null);
  });
});

describe('room active state', () => {
  test('active room: isActive == true', () => {
    const room = { ...baseRoom, isActive: true, closedAt: null };
    assert.equal(room.isActive, true);
    assert.equal(room.closedAt, null);
  });

  test('closed room: isActive == false and closedAt is set', () => {
    const room = { ...baseRoom, isActive: false, closedAt: new Date() };
    assert.equal(room.isActive, false);
    assert.ok(room.closedAt instanceof Date);
  });
});
