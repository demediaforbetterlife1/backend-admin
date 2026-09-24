/**
 * Frames & Entrances Service
 * 
 * Handles profile customization features:
 * - Frames (إطارات البروفايل)
 * - Entrances (مداخل مميزة)
 * - Purchase and activation
 */

const prisma = require('../prismaClient');
const coinsService = require('./coins.service');

/**
 * Get user's active frame
 */
async function getUserActiveFrame(userId) {
  const activeFrame = await prisma.userFrame.findFirst({
    where: { userId, isActive: true },
    include: { frame: true },
  });
  return activeFrame?.frame || null;
}

/**
 * Get user's active entrance
 */
async function getUserActiveEntrance(userId) {
  const activeEntrance = await prisma.userEntrance.findFirst({
    where: { userId, isActive: true },
    include: { entrance: true },
  });
  return activeEntrance?.entrance || null;
}

/**
 * Get all available frames for purchase
 */
async function getAvailableFrames() {
  return prisma.frame.findMany({
    where: { isActive: true },
    orderBy: { tier: 'asc' },
  });
}

/**
 * Get all available entrances for purchase
 */
async function getAvailableEntrances() {
  return prisma.entrance.findMany({
    where: { isActive: true },
    orderBy: { tier: 'asc' },
  });
}

/**
 * Purchase a frame with coins
 */
async function purchaseFrame(userId, frameId) {
  return prisma.$transaction(async (tx) => {
    // Check if frame exists and is active
    const frame = await tx.frame.findUnique({ where: { id: frameId } });
    if (!frame || !frame.isActive) {
      throw new Error('Frame not found or not available');
    }

    // Check if user already owns this frame
    const existing = await tx.userFrame.findUnique({
      where: { userId_frameId: { userId, frameId } },
    });
    if (existing) {
      throw new Error('You already own this frame');
    }

    // Deduct coins
    if (frame.coinPrice > 0) {
      await coinsService.debitCoins(
        userId,
        frame.coinPrice,
        'FRAME_PURCHASE',
        frameId,
        `Purchased frame: ${frame.name}`,
        tx
      );
    }

    // Grant frame to user
    const userFrame = await tx.userFrame.create({
      data: {
        userId,
        frameId,
        isActive: false, // User needs to activate it manually
      },
      include: { frame: true },
    });

    return userFrame;
  });
}

/**
 * Purchase an entrance with coins
 */
async function purchaseEntrance(userId, entranceId) {
  return prisma.$transaction(async (tx) => {
    // Check if entrance exists and is active
    const entrance = await tx.entrance.findUnique({ where: { id: entranceId } });
    if (!entrance || !entrance.isActive) {
      throw new Error('Entrance not found or not available');
    }

    // Check if user already owns this entrance
    const existing = await tx.userEntrance.findUnique({
      where: { userId_entranceId: { userId, entranceId } },
    });
    if (existing) {
      throw new Error('You already own this entrance');
    }

    // Deduct coins
    if (entrance.coinPrice > 0) {
      await coinsService.debitCoins(
        userId,
        entrance.coinPrice,
        'ENTRANCE_PURCHASE',
        entranceId,
        `Purchased entrance: ${entrance.name}`,
        tx
      );
    }

    // Grant entrance to user
    const userEntrance = await tx.userEntrance.create({
      data: {
        userId,
        entranceId,
        isActive: false, // User needs to activate it manually
      },
      include: { entrance: true },
    });

    return userEntrance;
  });
}

/**
 * Activate a frame (deactivate others)
 */
async function activateFrame(userId, frameId) {
  return prisma.$transaction(async (tx) => {
    // Check if user owns this frame
    const userFrame = await tx.userFrame.findUnique({
      where: { userId_frameId: { userId, frameId } },
    });
    if (!userFrame) {
      throw new Error('You do not own this frame');
    }

    // Deactivate all other frames
    await tx.userFrame.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    // Activate this frame
    await tx.userFrame.update({
      where: { userId_frameId: { userId, frameId } },
      data: { isActive: true },
    });

    return tx.userFrame.findUnique({
      where: { userId_frameId: { userId, frameId } },
      include: { frame: true },
    });
  });
}

/**
 * Activate an entrance (deactivate others)
 */
async function activateEntrance(userId, entranceId) {
  return prisma.$transaction(async (tx) => {
    // Check if user owns this entrance
    const userEntrance = await tx.userEntrance.findUnique({
      where: { userId_entranceId: { userId, entranceId } },
    });
    if (!userEntrance) {
      throw new Error('You do not own this entrance');
    }

    // Deactivate all other entrances
    await tx.userEntrance.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    // Activate this entrance
    await tx.userEntrance.update({
      where: { userId_entranceId: { userId, entranceId } },
      data: { isActive: true },
    });

    return tx.userEntrance.findUnique({
      where: { userId_entranceId: { userId, entranceId } },
      include: { entrance: true },
    });
  });
}

/**
 * Deactivate active frame
 */
async function deactivateFrame(userId) {
  await prisma.userFrame.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false },
  });
}

/**
 * Deactivate active entrance
 */
async function deactivateEntrance(userId) {
  await prisma.userEntrance.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false },
  });
}

/**
 * Get user's owned frames
 */
async function getUserFrames(userId) {
  return prisma.userFrame.findMany({
    where: { userId },
    include: { frame: true },
    orderBy: { purchasedAt: 'desc' },
  });
}

/**
 * Get user's owned entrances
 */
async function getUserEntrances(userId) {
  return prisma.userEntrance.findMany({
    where: { userId },
    include: { entrance: true },
    orderBy: { purchasedAt: 'desc' },
  });
}

/**
 * Enrich seat data with frame information
 * Used in room queries to add frame data to seats
 */
async function enrichSeatsWithFrames(seats) {
  if (!seats || seats.length === 0) return seats;

  const userIds = seats
    .filter(s => s.userId)
    .map(s => s.userId);

  if (userIds.length === 0) return seats;

  // Fetch all active frames for these users
  const activeFrames = await prisma.userFrame.findMany({
    where: {
      userId: { in: userIds },
      isActive: true,
    },
    include: { frame: true },
  });

  // Create a map: userId -> frame
  const frameMap = new Map();
  activeFrames.forEach(uf => {
    frameMap.set(uf.userId, uf.frame);
  });

  // Enrich seats with frame data
  return seats.map(seat => {
    if (!seat.userId) return seat;
    
    const frame = frameMap.get(seat.userId);
    return {
      ...seat,
      user: seat.user ? {
        ...seat.user,
        activeFrame: frame || null,
      } : null,
    };
  });
}

module.exports = {
  getUserActiveFrame,
  getUserActiveEntrance,
  getAvailableFrames,
  getAvailableEntrances,
  purchaseFrame,
  purchaseEntrance,
  activateFrame,
  activateEntrance,
  deactivateFrame,
  deactivateEntrance,
  getUserFrames,
  getUserEntrances,
  enrichSeatsWithFrames,
};
