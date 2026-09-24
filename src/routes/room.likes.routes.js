/**
 * Room Likes Routes
 * 
 * Handles liking/unliking voice rooms
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { rateLimit } = require('express-rate-limit');
const prisma = require('../prismaClient');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');

// Rate limit: 10 likes per minute per user to prevent spam
const likeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many likes — please slow down' },
  skip: (req) => !req.user,
});

// GET /rooms/:roomId/likes - Check if current user liked the room and get like count
router.get('/:roomId/likes', authenticate, asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const userId = req.user.id;

  // Check if room exists
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, isActive: true },
  });

  if (!room) {
    return sendError(res, 'Room not found', 404);
  }

  if (!room.isActive) {
    return sendError(res, 'Room is closed', 400);
  }

  // Check if user liked the room
  const userLike = await prisma.roomLike.findUnique({
    where: {
      roomId_userId: { roomId, userId },
    },
  });

  // Get total like count
  const likeCount = await prisma.roomLike.count({
    where: { roomId },
  });

  sendSuccess(res, {
    liked: !!userLike,
    likeCount,
  });
}));

// POST /rooms/:roomId/like - Like a room
router.post('/:roomId/like', authenticate, likeLimiter, asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const userId = req.user.id;

  // Check if room exists
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, isActive: true },
  });

  if (!room) {
    return sendError(res, 'Room not found', 404);
  }

  if (!room.isActive) {
    return sendError(res, 'Room is closed', 400);
  }

  // Check if already liked
  const existingLike = await prisma.roomLike.findUnique({
    where: {
      roomId_userId: { roomId, userId },
    },
  });

  if (existingLike) {
    return sendError(res, 'Already liked', 409, 'ALREADY_LIKED');
  }

  // Create like
  await prisma.roomLike.create({
    data: {
      roomId,
      userId,
    },
  });

  // Get updated like count
  const likeCount = await prisma.roomLike.count({
    where: { roomId },
  });

  // Emit socket event to room participants
  const io = global.__io;
  if (io) {
    const roomNs = io.of('/room');
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, avatar: true },
    });

    roomNs.to(roomId).emit('room-liked', {
      roomId,
      userId,
      username: user?.username,
      avatar: user?.avatar,
      likeCount,
      timestamp: new Date().toISOString(),
    });
  }

  sendSuccess(res, {
    liked: true,
    likeCount,
  });
}));

// DELETE /rooms/:roomId/like - Unlike a room
router.delete('/:roomId/like', authenticate, asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const userId = req.user.id;

  // Check if room exists
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, isActive: true },
  });

  if (!room) {
    return sendError(res, 'Room not found', 404);
  }

  // Delete like (if exists)
  await prisma.roomLike.deleteMany({
    where: {
      roomId,
      userId,
    },
  });

  // Get updated like count
  const likeCount = await prisma.roomLike.count({
    where: { roomId },
  });

  // Emit socket event to room participants
  const io = global.__io;
  if (io) {
    const roomNs = io.of('/room');
    roomNs.to(roomId).emit('room-unliked', {
      roomId,
      userId,
      likeCount,
      timestamp: new Date().toISOString(),
    });
  }

  sendSuccess(res, {
    liked: false,
    likeCount,
  });
}));

module.exports = router;