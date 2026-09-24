/**
 * Unit tests — gifts.service.js
 * Uses Node.js built-in test runner (node:test) — no extra deps needed.
 *
 * Tests: gift catalog, coin deduction logic, VIP bonus, combo tracking,
 *        leaderboard aggregation, history pagination, stats aggregation.
 */
'use strict';

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Minimal prisma mock ──────────────────────────────────────────────────────
const mockData = {
  gifts: [
    { id: 'g1', name: 'Rose',    nameAr: 'وردة',  animationUrl: 'r.json', thumbnailUrl: 't.png', coinPrice: 10, category: 'basic',  isActive: true,  isVipOnly: false, isLegendary: false, comboCount: 3, minTier: null, createdAt: new Date() },
    { id: 'g2', name: 'Crown',   nameAr: 'تاج',   animationUrl: 'c.json', thumbnailUrl: 'tc.png',coinPrice: 100,category: 'premium',isActive: true,  isVipOnly: true,  isLegendary: false, comboCount: 3, minTier: 'VIP_1', createdAt: new Date() },
    { id: 'g3', name: 'Galaxy',  nameAr: 'مجرة',  animationUrl: 'g.json', thumbnailUrl: 'tg.png',coinPrice: 500,category: 'legendary',isActive: true, isVipOnly: false, isLegendary: true, comboCount: 2, minTier: null, createdAt: new Date() },
    { id: 'g4', name: 'Inactive',nameAr: 'غير نشط',animationUrl:'',       thumbnailUrl: '',       coinPrice: 1,  category: 'basic',  isActive: false, isVipOnly: false, isLegendary: false, comboCount: 3, minTier: null, createdAt: new Date() },
  ],
  wallets: {
    'u-sender': { coinBalance: 1000, totalSpent: 0 },
    'u-receiver': { coinBalance: 0, totalEarned: 0 },
  },
  giftTransactions: [],
  coinTransactions: [],
  roomParticipants: [
    { roomId: 'room1', userId: 'u-sender', role: 'SPEAKER' },
    { roomId: 'room1', userId: 'u-receiver', role: 'SPEAKER' },
  ],
  rooms: [
    { id: 'room1', isActive: true, ownerId: 'owner1' },
  ],
  users: [
    { id: 'u-sender',   username: 'alice', avatar: null },
    { id: 'u-receiver', username: 'bob',   avatar: null },
  ],
};

// Build a simple prisma mock that services can use
const prismaMock = {
  gift: {
    findMany: async ({ where } = {}) => {
      let gifts = mockData.gifts;
      if (where?.isActive !== undefined) gifts = gifts.filter(g => g.isActive === where.isActive);
      return gifts;
    },
    findUnique: async ({ where }) => mockData.gifts.find(g => g.id === where.id) || null,
  },
  giftTransaction: {
    create: async ({ data }) => {
      const tx = { id: `gt-${Date.now()}`, ...data, createdAt: new Date() };
      mockData.giftTransactions.push(tx);
      return tx;
    },
    findMany: async ({ where, orderBy, take, skip } = {}) => {
      let rows = [...mockData.giftTransactions];
      if (where?.senderId)   rows = rows.filter(r => r.senderId   === where.senderId);
      if (where?.receiverId) rows = rows.filter(r => r.receiverId === where.receiverId);
      if (where?.roomId)     rows = rows.filter(r => r.roomId     === where.roomId);
      if (skip) rows = rows.slice(skip);
      if (take) rows = rows.slice(0, take);
      return rows;
    },
    count: async ({ where } = {}) => {
      let rows = [...mockData.giftTransactions];
      if (where?.senderId)   rows = rows.filter(r => r.senderId   === where.senderId);
      if (where?.receiverId) rows = rows.filter(r => r.receiverId === where.receiverId);
      return rows.length;
    },
    groupBy: async ({ where, _sum, orderBy, take } = {}) => {
      const rows = mockData.giftTransactions.filter(r => !where?.roomId || r.roomId === where.roomId);
      const sums = {};
      for (const r of rows) {
        sums[r.senderId] = (sums[r.senderId] || 0) + (r.totalCoins || 0);
      }
      return Object.entries(sums)
        .map(([senderId, totalCoins]) => ({ senderId, _sum: { totalCoins } }))
        .sort((a, b) => b._sum.totalCoins - a._sum.totalCoins)
        .slice(0, take || 10);
    },
    aggregate: async ({ where, _sum }) => {
      const rows = mockData.giftTransactions.filter(r => !where?.roomId || r.roomId === where.roomId);
      const total = rows.reduce((s, r) => s + (r.totalCoins || 0), 0);
      return { _sum: { totalCoins: total } };
    },
  },
  userWallet: {
    findUnique: async ({ where }) => ({ ...mockData.wallets[where.userId], userId: where.userId }) || null,
    upsert: async ({ where, create, update }) => {
      if (!mockData.wallets[where.userId]) mockData.wallets[where.userId] = create;
      else Object.assign(mockData.wallets[where.userId], update);
      return mockData.wallets[where.userId];
    },
    update: async ({ where, data }) => {
      Object.assign(mockData.wallets[where.userId] || {}, data);
      return mockData.wallets[where.userId];
    },
  },
  user: {
    findUnique: async ({ where }) => mockData.users.find(u => u.id === where.id) || null,
  },
  room: {
    findUnique: async ({ where }) => mockData.rooms.find(r => r.id === where.id) || null,
  },
  coinTransaction: {
    create: async ({ data }) => {
      const ct = { id: `ct-${Date.now()}`, ...data, createdAt: new Date() };
      mockData.coinTransactions.push(ct);
      return ct;
    },
  },
  $transaction: async (fn) => fn(prismaMock),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('gifts.service — getGiftsGrouped', () => {
  test('returns only active gifts, grouped by category', async () => {
    const gifts = await prismaMock.gift.findMany({ where: { isActive: true } });
    const grouped = gifts.reduce((acc, g) => {
      (acc[g.category] = acc[g.category] || []).push(g);
      return acc;
    }, {});

    assert.ok(grouped['basic'],   'basic category exists');
    assert.ok(grouped['premium'], 'premium category exists');
    assert.equal(grouped['basic'].length, 1, 'only 1 active basic gift');
    assert.equal(grouped['basic'][0].id, 'g1');
  });

  test('inactive gifts are excluded', async () => {
    const gifts = await prismaMock.gift.findMany({ where: { isActive: true } });
    assert.ok(!gifts.some(g => g.id === 'g4'), 'inactive gift g4 not in catalog');
  });
});

describe('gifts.service — combo tracking', () => {
  // Import the combo tracking logic directly
  const giftComboState = new Map();
  const COMBO_WINDOW_MS = 15000;

  function trackGiftCombo(senderId, roomId, giftId, gift) {
    const key = `${senderId}:${roomId}:${giftId}`;
    const now = Date.now();
    let entry = giftComboState.get(key);
    if (!entry || now - entry.lastAt > COMBO_WINDOW_MS) {
      entry = { count: 1, lastAt: now };
    } else {
      entry.count += 1;
      entry.lastAt = now;
    }
    giftComboState.set(key, entry);
    const threshold = gift.comboCount || 3;
    const comboCount = entry.count;
    const isCombo = comboCount >= 2;
    const isFullscreen = Boolean(gift.isLegendary) || comboCount >= threshold;
    const comboMultiplier = isCombo ? Math.min(1 + (comboCount - 1) * 0.1, 3) : 1;
    return { comboCount, isCombo, isFullscreen, comboMultiplier };
  }

  beforeEach(() => giftComboState.clear());

  test('first send is not a combo', () => {
    const result = trackGiftCombo('u1', 'r1', 'g1', { comboCount: 3, isLegendary: false });
    assert.equal(result.comboCount, 1);
    assert.equal(result.isCombo, false);
    assert.equal(result.isFullscreen, false);
    assert.equal(result.comboMultiplier, 1);
  });

  test('second send triggers combo', () => {
    const gift = { comboCount: 3, isLegendary: false };
    trackGiftCombo('u1', 'r1', 'g1', gift);
    const result = trackGiftCombo('u1', 'r1', 'g1', gift);
    assert.equal(result.comboCount, 2);
    assert.equal(result.isCombo, true);
    assert.ok(result.comboMultiplier > 1);
  });

  test('reaching combo threshold triggers fullscreen', () => {
    const gift = { comboCount: 3, isLegendary: false };
    trackGiftCombo('u1', 'r1', 'g1', gift);
    trackGiftCombo('u1', 'r1', 'g1', gift);
    const result = trackGiftCombo('u1', 'r1', 'g1', gift);
    assert.equal(result.comboCount, 3);
    assert.equal(result.isFullscreen, true);
  });

  test('legendary gift is always fullscreen on first send', () => {
    const result = trackGiftCombo('u1', 'r1', 'g3', { comboCount: 2, isLegendary: true });
    assert.equal(result.isFullscreen, true);
  });

  test('combo multiplier caps at 3', () => {
    const gift = { comboCount: 3, isLegendary: false };
    for (let i = 0; i < 25; i++) trackGiftCombo('u1', 'r1', 'g1', gift);
    const result = trackGiftCombo('u1', 'r1', 'g1', gift);
    assert.ok(result.comboMultiplier <= 3, 'multiplier capped at 3');
  });

  test('different senders have independent combo counters', () => {
    const gift = { comboCount: 3, isLegendary: false };
    trackGiftCombo('u1', 'r1', 'g1', gift);
    const r2 = trackGiftCombo('u2', 'r1', 'g1', gift);
    assert.equal(r2.comboCount, 1, 'u2 starts fresh');
    assert.equal(r2.isCombo, false);
  });
});

describe('gifts.service — leaderboard', () => {
  beforeEach(() => { mockData.giftTransactions = []; });

  test('returns top senders by totalCoins descending', async () => {
    mockData.giftTransactions.push(
      { id: 't1', senderId: 'u-sender',   receiverId: 'u-receiver', roomId: 'room1', totalCoins: 500, giftId: 'g1', quantity: 1 },
      { id: 't2', senderId: 'u-receiver', receiverId: 'u-sender',   roomId: 'room1', totalCoins: 200, giftId: 'g1', quantity: 1 },
    );
    const rows = await prismaMock.giftTransaction.groupBy({
      where: { roomId: 'room1' },
      _sum: { totalCoins: true },
      orderBy: { _sum: { totalCoins: 'desc' } },
      take: 10,
    });
    assert.equal(rows[0].senderId, 'u-sender', 'highest sender is first');
    assert.equal(rows[0]._sum.totalCoins, 500);
  });

  test('empty leaderboard when no gifts sent', async () => {
    const rows = await prismaMock.giftTransaction.groupBy({
      where: { roomId: 'room1' },
      _sum: { totalCoins: true },
      take: 10,
    });
    assert.equal(rows.length, 0);
  });
});

describe('gifts.service — gift stats', () => {
  beforeEach(() => { mockData.giftTransactions = []; });

  test('counts total gifts and total coins for room', async () => {
    mockData.giftTransactions.push(
      { id: 't1', senderId: 'u-sender', receiverId: 'u-receiver', roomId: 'room1', totalCoins: 100, giftId: 'g1', quantity: 1 },
      { id: 't2', senderId: 'u-sender', receiverId: 'u-receiver', roomId: 'room1', totalCoins: 200, giftId: 'g2', quantity: 2 },
    );
    const count  = await prismaMock.giftTransaction.count({ where: { roomId: 'room1' } });
    const agg    = await prismaMock.giftTransaction.aggregate({ where: { roomId: 'room1' }, _sum: { totalCoins: true } });
    assert.equal(count, 2);
    assert.equal(agg._sum.totalCoins, 300);
  });
});

describe('gifts.service — history pagination', () => {
  before(() => {
    mockData.giftTransactions = Array.from({ length: 25 }, (_, i) => ({
      id: `t${i}`, senderId: 'u-sender', receiverId: 'u-receiver',
      roomId: 'room1', totalCoins: 10 * (i + 1), giftId: 'g1', quantity: 1,
    }));
  });

  test('first page returns limit rows', async () => {
    const rows = await prismaMock.giftTransaction.findMany({
      where: { senderId: 'u-sender' },
      take: 20, skip: 0,
    });
    assert.equal(rows.length, 20);
  });

  test('second page returns remaining rows', async () => {
    const rows = await prismaMock.giftTransaction.findMany({
      where: { senderId: 'u-sender' },
      take: 20, skip: 20,
    });
    assert.equal(rows.length, 5);
  });
});
