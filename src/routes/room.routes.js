/**
 * Room Routes
 *
 * FIX H-02: GET / and GET /:id now require authentication.
 * FIX H-03: POST /:id/mute emits socket event after DB update.
 * FIX H-05: GET /room/:roomId recordings restricted to owner/admin.
 * FIX H-08: POST /:id/join vacates any existing seat in another active room.
 * FIX M-03: Room creation creates exactly seatCap seats (not always 20).
 * FIX M-05: POST /:id/accept-seat uses canModerateRoom instead of owner-only check.
 * FIX L-01: LiveKit default credentials validated via env.js.
 * FIX L-03: POST /:id/leave emits socket events to notify room participants.
 * FIX HOST-LEAVE: When room owner leaves via POST /:id/leave the room is
 *   automatically closed, all seats cleared, every socket participant notified
 *   via 'room-closed', and a global 'rooms-updated' event is broadcast so
 *   the discovery/home screens remove the room without needing a pull-to-refresh.
 * FIX CLOSE-BROADCAST: POST /:id/close also broadcasts 'rooms-updated' globally.
 * MISSING:  POST /:id/reject-seat added to complete the private room flow.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../prismaClient');
const followService = require('../services/follow.service');
const notificationService = require('../services/notification.service');
const vipService = require('../services/vip.service');
const moderationService = require('../services/moderation.service');
const { authenticate } = require('../middleware/authMiddleware');
const { roomLimiter } = require('../middleware/rateLimit');
const { canModerateRoom, assignSeatAtomic } = require('../utils/room.utils');
const { serializeRoom, serializeSeat } = require('../utils/room.serializer');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');
// FIX TASK-2/TASK-5: Shared close function keeps in-memory map in sync and
// broadcasts all required events (room-closed, host-left, room-ended,
// rooms-updated) from a single authoritative implementation.
const { closeRoomAndNotify } = require('../socket/room.socket');

const roomInclude = {
  owner: { select: { id: true, username: true, avatar: true } },
  seats: {
    include: { 
      user: { 
        select: { 
          id: true, 
          username: true, 
          avatar: true, 
          role: true,
          UserVip: { select: { tier: true } },
        } 
      } 
    },
    orderBy: { seatIndex: 'asc' },
  },
  _count: { select: { participants: true } },
};

async function verifyRoomPassword(room, password) {
  if (!room.passwordHash) return true;
  if (!password) return false;
  return bcrypt.compare(password, room.passwordHash);
}

function sendRoomError(res, error) {
  if (error.code === 'ROOM_FULL') {
    return res.status(400).json({ success: false, error: error.message, code: 'ROOM_FULL' });
  }
  if (error.code === 'SEAT_RACE') {
    return res.status(409).json({ success: false, error: error.message, code: 'SEAT_RACE' });
  }
  return res.status(500).json({ success: false, error: error.message });
}

const router = express.Router();

// Helper: Log room actions
function logRoomAction(action, userId, roomId = null, details = {}) {
  console.log(`[ROOM] ${action}`, {
    userId,
    roomId,
    timestamp: new Date().toISOString(),
    ...details,
  });
}

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      success: true,
      database: 'connected',
      roomsRoute: 'working'
    });
  } catch (error) {
    console.error('Rooms health check failed:', error);
    res.status(500).json({
      success: false,
      database: 'disconnected',
      roomsRoute: 'working',
      error: error.message
    });
  }
});

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';

// ---------------------------------------------------------------------------
// GET /rooms  — FIX H-02: requires authentication
// FIX ROOT CAUSE #7: Filter inactive rooms from response.
// Inactive rooms (isActive: false) should NEVER appear in any list endpoint.
// This prevents Flutter from showing "zombie rooms" that can't be joined.
// ---------------------------------------------------------------------------
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { category, tag, page = 1, limit = 20 } = req.query;
  const take = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * take;

  // FIX ROOT CAUSE #7: Always filter isActive: true AND isPrivate: false
  const where = { isActive: true, isPrivate: false };
  if (category) where.category = String(category);

  const rooms = await prisma.room.findMany({
    where,
    include: roomInclude,
    orderBy: { createdAt: 'desc' },
    skip,
    take: tag ? 100 : take,
  });

  const filtered = tag
    ? rooms.filter((r) => {
        const tags = Array.isArray(r.tags) ? r.tags : [];
        return tags.some((t) => String(t).toLowerCase() === String(tag).toLowerCase());
      }).slice(0, take)
    : rooms;

  sendSuccess(res, filtered.map((room) => serializeRoom(room)));
}));

// ---------------------------------------------------------------------------
// GET /rooms/trending — active rooms ranked by occupancy
// FIX ROOT CAUSE #7: Filter inactive rooms from trending list.
// ---------------------------------------------------------------------------
router.get('/trending', authenticate, asyncHandler(async (req, res) => {
  const { country, tag } = req.query;
  
  // FIX ROOT CAUSE #7: Always filter isActive: true AND isPrivate: false
  const rooms = await prisma.room.findMany({
    where: {
      isActive: true,
      isPrivate: false,
    },
    include: roomInclude,
    take: 100,
  });

  const tagged = tag
    ? rooms.filter((r) => {
        const tags = Array.isArray(r.tags) ? r.tags : [];
        return tags.some((t) => String(t).toLowerCase() === String(tag).toLowerCase());
      })
    : rooms;

  const ranked = tagged
    .map((room) => serializeRoom(room))
    .sort((a, b) => b.listenersCount - a.listenersCount);

  const filtered = country
    ? ranked.filter((r) => r.tags?.some((t) => String(t).toLowerCase().includes(String(country).toLowerCase())))
    : ranked;

  sendSuccess(res, filtered.slice(0, 30));
}));

// ---------------------------------------------------------------------------
// GET /rooms/search — search by name, topic, host
// FIX ROOT CAUSE #7: Filter inactive rooms from search results.
// ---------------------------------------------------------------------------
router.get('/search', authenticate, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    return sendSuccess(res, []);
  }

  // FIX ROOT CAUSE #7: Always filter isActive: true in search
  const rooms = await prisma.room.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { topic: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { owner: { username: { contains: q, mode: 'insensitive' } } },
      ],
    },
    include: roomInclude,
    take: 30,
    orderBy: { createdAt: 'desc' },
  });

  sendSuccess(res, rooms.map((room) => serializeRoom(room)));
}));

// ---------------------------------------------------------------------------
// GET /rooms/:id  — FIX H-02: requires authentication
// BUG-3 FIX: return 404 for inactive/closed rooms so Flutter never starts
// a join flow against a dead room (which previously caused infinite loading
// or a silent "Room is closed" 400 that the UI didn't handle).
// ---------------------------------------------------------------------------
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const room = await prisma.room.findUnique({
    where: { id: req.params.id },
    include: roomInclude,
  });

  if (!room) {
    return sendError(res, 'Room not found', 404);
  }

  // BUG-3 FIX: treat inactive rooms as not-found for clients trying to join.
  // The room record is retained in the DB for history/analytics purposes, but
  // clients should see a clean 404 rather than attempting to join a closed room
  // and receiving a cryptic 400 "Room is closed" mid-join-pipeline.
  if (!room.isActive) {
    return sendError(res, 'Room not found', 404, 'ROOM_NOT_FOUND');
  }

  sendSuccess(res, serializeRoom(room));
}));

// ---------------------------------------------------------------------------
// POST /rooms  — create a room
// FIX M-03: creates exactly seatCap seats, not always 20
// ---------------------------------------------------------------------------
router.post('/', authenticate, roomLimiter, asyncHandler(async (req, res) => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║ ROOM CREATION ENDPOINT - POST /api/rooms                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  
  const userId = req.user?.id;
  const requestBody = { ...req.body };
  delete requestBody.password;

  console.log('[CREATE ROOM] Authenticated user:', {
    userId: userId,
    username: req.user?.username,
    role: req.user?.role
  });
  console.log('[CREATE ROOM] Request body:', requestBody);
  console.log('[CREATE ROOM] Request headers:', {
    authorization: req.headers.authorization ? 'Bearer ***' : 'MISSING',
    contentType: req.headers['content-type'],
    origin: req.headers.origin,
    host: req.headers.host
  });

  const name = String(req.body.name || req.body.title || '').trim();
  const type = String(req.body.type || '').toLowerCase();
  const isPrivate = req.body.isPrivate === true || type === 'private';
  const image = req.body.image;
  const topic = req.body.topic;
  const description = req.body.description;
  const password = req.body.password;
  const category = req.body.category;
  const tags = req.body.tags;
  const maxSeats = req.body.maxSeats ?? req.body.seats;

  console.log('[CREATE ROOM] Parsed fields:', {
    name,
    type: isPrivate ? 'private' : 'public',
    seats: maxSeats,
    topic,
    description,
    hasImage: Boolean(image),
    hasPassword: Boolean(password)
  });

  if (!name) {
    console.error('[CREATE ROOM] ✗ Validation failed: name is required');
    return sendError(res, 'Room name required', 400, 'VALIDATION_ERROR');
  }

  const seatCap = maxSeats != null ? Number(maxSeats) : 20;
  if (Number.isNaN(seatCap) || seatCap < 1 || seatCap > 20) {
    console.error('[CREATE ROOM] ✗ Validation failed: invalid maxSeats:', maxSeats);
    return sendError(res, 'Max seats must be 1-20', 400, 'VALIDATION_ERROR');
  }

  console.log('[CREATE ROOM] Starting moderation check for room name...');
  const nameCheck = await moderationService.filterMessage(name.trim());
  if (nameCheck.blocked) {
    console.error('[CREATE ROOM] ✗ Moderation failed: prohibited content in name');
    return sendError(res, 'Room name contains prohibited content', 400);
  }
  console.log('[CREATE ROOM] ✓ Room name passed moderation');

  let filteredTopic = topic || null;
  let filteredDescription = description || null;

  if (topic) {
    console.log('[CREATE ROOM] Checking topic moderation...');
    const topicCheck = await moderationService.filterMessage(topic.trim());
    if (topicCheck.blocked) {
      console.error('[CREATE ROOM] ✗ Moderation failed: prohibited content in topic');
      return sendError(res, 'Room topic contains prohibited content', 400);
    }
    filteredTopic = topicCheck.filtered.trim();
    console.log('[CREATE ROOM] ✓ Topic passed moderation');
  }

  if (description) {
    console.log('[CREATE ROOM] Checking description moderation...');
    const descCheck = await moderationService.filterMessage(description.trim());
    if (descCheck.blocked) {
      console.error('[CREATE ROOM] ✗ Moderation failed: prohibited content in description');
      return sendError(res, 'Room description contains prohibited content', 400);
    }
    filteredDescription = descCheck.filtered.trim();
    console.log('[CREATE ROOM] ✓ Description passed moderation');
  }

  let passwordHash = null;
  if (password && String(password).trim().length > 0) {
    console.log('[CREATE ROOM] Hashing password...');
    passwordHash = await bcrypt.hash(String(password).trim(), 10);
  }

  console.log('[CREATE ROOM] Starting database transaction...');
  const room = await prisma.$transaction(async (tx) => {
    console.log('[CREATE ROOM] Creating room record...');
    const createdRoom = await tx.room.create({
      data: {
        name: nameCheck.filtered.trim(),
        image,
        isPrivate: isPrivate || false,
        passwordHash,
        category: category ? String(category).toLowerCase() : 'talk',
        tags: Array.isArray(tags) ? tags : tags ? [String(tags)] : [],
        maxSeats: seatCap,
        topic: filteredTopic,
        description: filteredDescription,
        ownerId: userId,
      },
      include: { owner: { select: { id: true, username: true, avatar: true } } },
    });
    console.log('[CREATE ROOM] ✓ Room record created:', {
      roomId: createdRoom.id,
      name: createdRoom.name,
      ownerId: createdRoom.ownerId
    });

    // PART 1 FIX: Create all seats. Seat #0 is immediately assigned to the
    // owner so they are always on stage when the room is created — no second
    // POST /join call needed.  Every other seat starts empty.
    console.log(`[CREATE ROOM] Creating ${seatCap} seats (owner auto-assigned to seat 0)...`);
    const seatsToCreate = [];
    for (let i = 0; i < seatCap; i++) {
      seatsToCreate.push({
        roomId:      createdRoom.id,
        seatIndex:   i,
        // Owner auto-occupies seat 0 at creation time.
        userId:      i === 0 ? userId : null,
        isMuted:     false,
        forceMuted:  false,
        isModerator: false,
        joinedAt:    i === 0 ? new Date() : null,
      });
    }
    await tx.seat.createMany({ data: seatsToCreate });
    console.log(`[CREATE ROOM] ✓ Created ${seatCap} seats`);

    // Owner is both a seat occupant AND a RoomParticipant (SPEAKER role).
    console.log('[CREATE ROOM] Creating RoomParticipant record for owner...');
    await tx.roomParticipant.upsert({
      where:  { roomId_userId: { roomId: createdRoom.id, userId } },
      create: { roomId: createdRoom.id, userId, role: 'SPEAKER' },
      update: { role: 'SPEAKER' },
    });
    console.log('[CREATE ROOM] ✓ Owner added as SPEAKER participant');

    return createdRoom;
  });

  console.log('[CREATE ROOM] ✓ Transaction completed successfully');
  console.log('[CREATE ROOM] Sending notifications to followers...');
  const followerIds = await followService.getFollowerIds(userId);
  if (followerIds.length > 0) {
    await notificationService.sendToMultipleUsers(
      followerIds,
      'ROOM_STARTED',
      '🎙️ غرفة جديدة',
      `${room.owner.username} فتح غرفة: ${room.name}`,
      { roomId: room.id },
    ).catch(console.warn);
    console.log(`[CREATE ROOM] ✓ Notified ${followerIds.length} followers`);
  } else {
    console.log('[CREATE ROOM] No followers to notify');
  }

  console.log('[CREATE ROOM] Fetching complete room data...');
  const created = await prisma.room.findUnique({
    where: { id: room.id },
    include: roomInclude,
  });

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║ ROOM CREATION SUCCESSFUL                                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log('[CREATE ROOM] Success:', {
    roomId: created.id,
    roomName: created.name,
    ownerId: userId,
    ownerUsername: created.owner.username,
    seats: created.maxSeats,
    permission: 'allowed'
  });

  sendSuccess(res, serializeRoom(created), 201, 'Room created successfully');

  // Broadcast globally so discovery/home screens add the new room.
  const ioCreate = global.__io;
  if (ioCreate) {
    ioCreate.of('/room').emit('rooms-updated', { action: 'added', room: serializeRoom(created) });
    ioCreate.emit('rooms-updated', { action: 'added', room: serializeRoom(created) });
    console.log('[CREATE ROOM] ✓ Socket broadcast sent');
  }
  console.log('\n');
}));

// ---------------------------------------------------------------------------
// POST /rooms/:id/join
// FIX H-08: vacate any existing seat in another active room before joining
// ---------------------------------------------------------------------------
router.post('/:id/join', authenticate, roomLimiter, asyncHandler(async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;
  const { password } = req.body || {};

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { seats: true },
  });

  if (!room) {
    return sendError(res, 'Room not found', 404);
  }

  if (!room.isActive) {
    return sendError(res, 'Room is closed', 400);
  }

  if (room.passwordHash && room.ownerId !== userId) {
    const ok = await verifyRoomPassword(room, password);
    if (!ok) {
      return sendError(res, 'Incorrect room password', 403, 'ROOM_PASSWORD_REQUIRED');
    }
  }

  if (room.isPrivate && room.ownerId !== userId) {
    return sendError(res, 'Private room — request a seat from the owner', 403, 'PRIVATE_ROOM');
  }

  const existingSeats = await prisma.seat.findMany({
    where: { userId, roomId: { not: roomId } },
    include: { room: { select: { isActive: true } } },
  });
  const otherActiveSeats = existingSeats.filter((s) => s.room?.isActive);
  if (otherActiveSeats.length > 0) {
    const otherRoomIds = [...new Set(otherActiveSeats.map((s) => s.roomId))];
    await prisma.seat.updateMany({
      where: { userId, roomId: { in: otherRoomIds } },
      data: { userId: null, isMuted: false, forceMuted: false, isModerator: false },
    });
  }

  try {
    // REQ-1: pass ownerId so owner always gets seat 0, others skip seat 0.
    await assignSeatAtomic(roomId, userId, room.maxSeats || 20, room.ownerId);
  } catch (err) {
    if (err.code === 'ROOM_FULL') return sendError(res, err.message, 400, 'ROOM_FULL');
    if (err.code === 'SEAT_RACE') return sendError(res, err.message, 409, 'SEAT_RACE');
    throw err;
  }

  const updated = await prisma.room.findUnique({
    where: { id: roomId },
    include: roomInclude,
  });

  await prisma.roomParticipant.upsert({
    where: { roomId_userId: { roomId, userId } },
    create: { roomId, userId, role: 'SPEAKER' },
    update: { role: 'SPEAKER' },
  });

  const vipStatus = await vipService.getVipPrivileges(userId);
  sendSuccess(res, { ...serializeRoom(updated), vipStatus });
}));

// ---------------------------------------------------------------------------
// POST /rooms/:id/join-audience — listen without taking a speaker seat
// ---------------------------------------------------------------------------
router.post('/:id/join-audience', authenticate, roomLimiter, asyncHandler(async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;
  const { password } = req.body || {};

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return sendError(res, 'Room not found', 404);
  if (!room.isActive) return sendError(res, 'Room is closed', 400);

  if (room.passwordHash && room.ownerId !== userId) {
    const ok = await verifyRoomPassword(room, password);
    if (!ok) {
      return sendError(res, 'Incorrect room password', 403, 'ROOM_PASSWORD_REQUIRED');
    }
  }

  if (room.isPrivate && room.ownerId !== userId) {
    return sendError(res, 'Private room — invitation required', 403, 'PRIVATE_ROOM');
  }

  await prisma.roomParticipant.upsert({
    where: { roomId_userId: { roomId, userId } },
    create: { roomId, userId, role: 'AUDIENCE' },
    update: { role: 'AUDIENCE' },
  });

  const updated = await prisma.room.findUnique({
    where: { id: roomId },
    include: roomInclude,
  });

  sendSuccess(res, serializeRoom(updated));
}));

// ---------------------------------------------------------------------------
// POST /rooms/:id/request-seat
// ---------------------------------------------------------------------------
router.post('/:id/request-seat', authenticate, roomLimiter, asyncHandler(async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { owner: { select: { id: true, username: true } } },
  });

  if (!room) return sendError(res, 'Room not found', 404);
  if (room.ownerId === userId) return sendError(res, 'Owner already has a seat', 400);

  const alreadySeated = await prisma.seat.findFirst({ where: { roomId, userId } });
  if (alreadySeated) return sendError(res, 'Already seated in this room', 400);

  await prisma.seatRequest.updateMany({
    where: { roomId, userId, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });

  await prisma.seatRequest.create({
    data: { roomId, userId, status: 'PENDING' },
  });

  await notificationService.sendPushNotification(
    room.ownerId,
    'SEAT_REQUEST',
    '🔔 طلب مقعد',
    `${req.user.username} يريد الانضمام إلى مقعد في غرفتك`,
    { roomId, requesterId: userId },
  ).catch(console.warn);

  sendSuccess(res, null, 200, 'Seat request sent to room owner');
}));

// ---------------------------------------------------------------------------
// POST /rooms/:id/accept-seat
// FIX M-05: uses canModerateRoom so admins/moderators can also accept
// ---------------------------------------------------------------------------
router.post('/:id/accept-seat', authenticate, asyncHandler(async (req, res) => {
  const roomId = req.params.id;
  const requesterId = req.body.userId;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return sendError(res, 'Room not found', 404);

  if (!(await canModerateRoom(req.user, room))) {
    return sendError(res, 'Only owner or admin can accept seat requests', 403);
  }

  if (!requesterId) return sendError(res, 'userId is required', 400);

  const pending = await prisma.seatRequest.findFirst({
    where: { roomId, userId: requesterId, status: 'PENDING' },
  });
  if (!pending) return sendError(res, 'No pending seat request for this user', 400);

  try {
    // REQ-1: pass ownerId so accepted seat request also respects seat-0 reservation.
    await assignSeatAtomic(roomId, requesterId, room.maxSeats || 20, room.ownerId);
  } catch (err) {
    if (err.code === 'ROOM_FULL') return sendError(res, err.message, 400, 'ROOM_FULL');
    if (err.code === 'SEAT_RACE') return sendError(res, err.message, 409, 'SEAT_RACE');
    throw err;
  }

  await prisma.seatRequest.update({
    where: { id: pending.id },
    data: { status: 'ACCEPTED' },
  });

  await notificationService.sendPushNotification(
    requesterId,
    'SEAT_ACCEPTED',
    '✅ قبول طلب مقعد',
    'تم قبول طلبك، لقد انضممت إلى المقعد',
    { roomId },
  ).catch(console.warn);

  sendSuccess(res, null, 200, 'Seat accepted and user notified');
}));

// ---------------------------------------------------------------------------
// GET /rooms/:id/seat-requests  — MISSING FEATURE: owner lists pending requests
// ---------------------------------------------------------------------------
router.get('/:id/seat-requests', authenticate, asyncHandler(async (req, res) => {
  const roomId = req.params.id;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return sendError(res, 'Room not found', 404);

  if (!(await canModerateRoom(req.user, room))) {
    return sendError(res, 'Only owner or admin can view seat requests', 403);
  }

  const requests = await prisma.seatRequest.findMany({
    where: { roomId, status: 'PENDING' },
    include: {
      user: { select: { id: true, username: true, avatar: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  sendSuccess(res, requests);
}));

// ---------------------------------------------------------------------------
// POST /rooms/:id/reject-seat  — MISSING FEATURE: reject a seat request
// ---------------------------------------------------------------------------
router.post('/:id/reject-seat', authenticate, asyncHandler(async (req, res) => {
  const roomId = req.params.id;
  const requesterId = req.body.userId;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return sendError(res, 'Room not found', 404);

  if (!(await canModerateRoom(req.user, room))) {
    return sendError(res, 'Only owner or admin can reject seat requests', 403);
  }

  if (!requesterId) return sendError(res, 'userId is required', 400);

  const pending = await prisma.seatRequest.findFirst({
    where: { roomId, userId: requesterId, status: 'PENDING' },
  });
  if (!pending) return sendError(res, 'No pending seat request for this user', 400);

  await prisma.seatRequest.update({
    where: { id: pending.id },
    data: { status: 'REJECTED' },
  });

  await notificationService.sendPushNotification(
    requesterId,
    'SEAT_REJECTED',
    '❌ رفض طلب مقعد',
    'تم رفض طلب انضمامك للمقعد',
    { roomId },
  ).catch(console.warn);

  sendSuccess(res, null, 200, 'Seat request rejected');
}));

// ---------------------------------------------------------------------------
// POST /rooms/:id/leave
// FIX L-03: emit socket events so other participants see the user leave.
// FIX HOST-LEAVE: if the leaving user is the room owner, automatically close
//   the room, disconnect every socket participant, and broadcast 'rooms-updated'
//   globally so discovery/home screens remove it without a pull-to-refresh.
// ---------------------------------------------------------------------------
router.post('/:id/leave', authenticate, asyncHandler(async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, ownerId: true, isActive: true },
  });

  const seat = await prisma.seat.findFirst({
    where: { roomId, userId },
    include: { user: { select: { username: true } } },
  });

  // Always clear seat + participant record regardless of host/member status.
  await prisma.seat.updateMany({
    where: { roomId, userId },
    data: { userId: null, isMuted: false, forceMuted: false, isModerator: false },
  });
  await prisma.roomParticipant.deleteMany({ where: { roomId, userId } });

  const io = global.__io;
  const ns = io ? io.of('/room') : null;

  // ── HOST LEAVES ─────────────────────────────────────────────────────────
  // FIX TASK-2: Delegate entirely to the shared closeRoomAndNotify so the
  // in-memory roomSockets map, DB records, all socket broadcasts (room-closed,
  // host-left, room-ended, rooms-updated) and participant cleanup are all
  // handled atomically in one place.
  if (room && room.ownerId === userId && room.isActive) {
    // ═══════════════════════════════════════════════════════════════════════
    // REDUNDANT SAFETY CHECK #6: Double-Check Owner Exit Detection
    // ═══════════════════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('[ROOM CLOSURE] OWNER LEAVING VIA POST /leave');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`[ROOM CLOSURE] Room ID: ${roomId}`);
    console.log(`[ROOM CLOSURE] Owner ID: ${userId}`);
    console.log(`[ROOM CLOSURE] Room is active: ${room.isActive}`);
    console.log(`[ROOM CLOSURE] Triggering closeRoomAndNotify...`);
    console.log('═══════════════════════════════════════════════════════════');
    
    if (ns) {
      await closeRoomAndNotify(ns, roomId, 'host_left');
      console.log('[ROOM CLOSURE] ✓ closeRoomAndNotify completed successfully');
    } else {
      console.log('[ROOM CLOSURE] ⚠️ No socket namespace - performing DB-only cleanup');
      // No socket server available — do DB-only cleanup.
      await prisma.room.update({ where: { id: roomId }, data: { isActive: false, closedAt: new Date() } });
      await prisma.seat.updateMany({ where: { roomId }, data: { userId: null, isMuted: false, forceMuted: false, isModerator: false } });
      await prisma.seatRequest.updateMany({ where: { roomId, status: 'PENDING' }, data: { status: 'CANCELLED' } }).catch(() => {});
      await prisma.roomParticipant.deleteMany({ where: { roomId } }).catch(() => {});
      console.log('[ROOM CLOSURE] ✓ DB-only cleanup completed');
    }

    logRoomAction('HOST_LEFT_ROOM_CLOSED', userId, roomId);
    return sendSuccess(res, null);
  }

  // ── NORMAL MEMBER LEAVES ─────────────────────────────────────────────────
  // FIX TASK-3: Participant is already removed from seats + participants above.
  // Now broadcast seat-update + room-updated so all clients see the change.
  if (ns && seat) {
    ns.to(roomId).emit('user-left', { userId, username: seat.user?.username });

    const updatedRoom = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        seats: {
          include: { user: { select: { username: true, avatar: true, role: true } } },
          orderBy: { seatIndex: 'asc' },
        },
      },
    });
    if (updatedRoom) {
      // FIX: Use serializeSeat for consistency with socket events - ensures defensive fallbacks
      const seatData = updatedRoom.seats.map((s) => serializeSeat(s, updatedRoom.ownerId));
      ns.to(roomId).emit('seat-update', { seats: seatData });

      // FIX TASK-4 RoomUpdated: broadcast updated participant count.
      const participantCount = await prisma.roomParticipant.count({ where: { roomId } });
      ns.to(roomId).emit('room-updated', { roomId, participantCount });
    }
  } else if (ns) {
    // Audience member (no seat) — still update participant count.
    const participantCount = await prisma.roomParticipant.count({ where: { roomId } });
    ns.to(roomId).emit('user-left', { userId, username: null });
    ns.to(roomId).emit('room-updated', { roomId, participantCount });
  }

  sendSuccess(res, null);
}));

// ---------------------------------------------------------------------------
// POST /rooms/:id/close
// FIX TASK-2/TASK-5: Use shared closeRoomAndNotify so in-memory map is
// cleaned up and all required socket events are broadcast.
// ---------------------------------------------------------------------------
router.post('/:id/close', authenticate, asyncHandler(async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return sendError(res, 'Room not found', 404);

  if (!(await canModerateRoom(req.user, room))) {
    return sendError(res, 'Only owner or admin can close room', 403);
  }

  const io = global.__io;
  const ns = io ? io.of('/room') : null;

  if (ns) {
    // closeRoomAndNotify handles DB update, seat wipe, socket broadcasts,
    // in-memory map cleanup, and rooms-updated global broadcast.
    await closeRoomAndNotify(ns, roomId, 'closed_by_moderator');
  } else {
    // Fallback: no socket server.
    await prisma.room.update({ where: { id: roomId }, data: { isActive: false, closedAt: new Date() } });
    await prisma.seat.updateMany({ where: { roomId }, data: { userId: null, isMuted: false, forceMuted: false, isModerator: false } });
    await prisma.seatRequest.updateMany({ where: { roomId, status: 'PENDING' }, data: { status: 'CANCELLED' } }).catch(() => {});
    await prisma.roomParticipant.deleteMany({ where: { roomId } }).catch(() => {});
  }

  sendSuccess(res, null);
}));

// ---------------------------------------------------------------------------
// POST /rooms/:id/mute
// FIX H-03: emit socket event after DB update so clients are notified
// FIX MICROPHONE BUG: Self-mute should only set isMuted, not forceMuted.
// forceMuted should only be set by admin/owner actions to prevent users from
// unmuting themselves when they've been muted by a moderator.
// ---------------------------------------------------------------------------
router.post('/:id/mute', authenticate, asyncHandler(async (req, res) => {
  const { userId: targetUserId, isMuted } = req.body;
  const roomId = req.params.id;

  if (typeof isMuted !== 'boolean') {
    return sendError(res, 'isMuted boolean is required', 400);
  }

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return sendError(res, 'Room not found', 404);
  if (!(await canModerateRoom(req.user, room))) {
    return sendError(res, 'Only room owner or admin can mute/unmute', 403);
  }

  const seat = await prisma.seat.findFirst({ where: { roomId, userId: targetUserId } });
  if (!seat) {
    return sendError(res, 'User not in room', 404);
  }

  // FIX: When muting via API (admin/owner action), set both isMuted and forceMuted
  // This prevents the user from unmuting themselves via socket
  // However, we need to distinguish between self-mute and admin mute
  // Since this endpoint requires canModerateRoom, it's always an admin/owner action
  await prisma.seat.update({
    where: { id: seat.id },
    data: { isMuted: isMuted, forceMuted: isMuted },
  });

  const io = global.__io;
  if (io) {
    io.of('/room').to(roomId).emit('user-muted', { userId: targetUserId, isMuted });
  }

  sendSuccess(res, null);
}));

// ---------------------------------------------------------------------------
// POST /rooms/:id/kick
// ---------------------------------------------------------------------------
router.post('/:id/kick', authenticate, asyncHandler(async (req, res) => {
  const { userId: targetUserId } = req.body;
  const roomId = req.params.id;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return sendError(res, 'Room not found', 404);
  if (!(await canModerateRoom(req.user, room))) {
    return sendError(res, 'Only room owner or admin can kick users', 403);
  }

  await prisma.seat.updateMany({
    where: { roomId, userId: targetUserId },
    data: { userId: null, isMuted: false, forceMuted: false, isModerator: false },
  });

  const io = global.__io;
  if (io) {
    const ns = io.of('/room');
    ns.to(roomId).emit('user-kicked', { userId: targetUserId });
  }

  sendSuccess(res, null);
}));

// ---------------------------------------------------------------------------
// POST /rooms/:id/assign-moderator  — MISSING FEATURE: assign moderator role
// Only room owner or SUPER_ADMIN can assign moderators
// ---------------------------------------------------------------------------
router.post('/:id/assign-moderator', authenticate, asyncHandler(async (req, res) => {
  const { userId: targetUserId } = req.body;
  const roomId = req.params.id;

  if (!targetUserId) {
    return sendError(res, 'userId is required', 400);
  }

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return sendError(res, 'Room not found', 404);

  const isOwner = room.ownerId === req.user.id;
  const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
  if (!isOwner && !isSuperAdmin) {
    return sendError(res, 'Only room owner or super admin can assign moderators', 403);
  }

  const seat = await prisma.seat.findFirst({ where: { roomId, userId: targetUserId } });
  if (!seat) {
    return sendError(res, 'User not in room', 404);
  }

  await prisma.seat.update({
    where: { id: seat.id },
    data: { isModerator: true },
  });

  const io = global.__io;
  if (io) {
    io.of('/room').to(roomId).emit('moderator-assigned', { userId: targetUserId, roomId });
  }

  sendSuccess(res, null, 200, 'Moderator assigned');
}));

// ── ROOM MESSAGES ─────────────────────────────────────────────────────────
// GET /api/rooms/:roomId/messages - Get room message history
router.get('/:roomId/messages', authenticate, asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const userId = req.user.id;
  const { limit = 50, before } = req.query;

  // Verify room exists and is active
  const room = await prisma.room.findUnique({
    where: { id: roomId },
  });

  if (!room) {
    return sendError(res, 'Room not found', 404);
  }

  if (!room.isActive) {
    return sendError(res, 'Room is closed', 400);
  }

  // Verify user has access to the room (seated or audience)
  const seated = await prisma.seat.findFirst({
    where: { roomId, userId },
  });
  const audience = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } },
  });

  if (!seated && !audience) {
    return sendError(res, 'You must be in the room to view messages', 403);
  }

  // Load messages with pagination
  const messages = await prisma.roomMessage.findMany({
    where: {
      roomId,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    include: {
      user: {
        select: { id: true, username: true, avatar: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });

  // Convert to frontend format
  const formattedMessages = messages.map(msg => ({
    id: msg.id,
    roomId: msg.roomId,
    userId: msg.userId,
    username: msg.user?.username || 'مجهول',
    avatar: msg.user?.avatar,
    text: msg.text,
    timestamp: msg.createdAt,
    isSystem: false,
  })).reverse(); // Reverse to get ascending order

  sendSuccess(res, formattedMessages, 200, 'Messages retrieved');
}));

// POST /api/rooms/:roomId/messages - Send a message via REST (fallback)
router.post('/:roomId/messages', authenticate, asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const userId = req.user.id;
  const { text } = req.body;

  // Validate input
  if (!text || typeof text !== 'string') {
    return sendError(res, 'Message text is required', 400);
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return sendError(res, 'Message cannot be empty', 400);
  }

  if (trimmed.length > 500) {
    return sendError(res, 'Message is too long (max 500 characters)', 400);
  }

  // Verify room exists and is active
  const room = await prisma.room.findUnique({
    where: { id: roomId },
  });

  if (!room) {
    return sendError(res, 'Room not found', 404);
  }

  if (!room.isActive) {
    return sendError(res, 'Room is closed', 400);
  }

  // Verify user has access to the room (seated or audience)
  const seated = await prisma.seat.findFirst({
    where: { roomId, userId },
  });
  const audience = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } },
  });

  if (!seated && !audience) {
    return sendError(res, 'You must be the room to send messages', 403);
  }

  // Content moderation
  const moderationService = require('../services/moderation.service');
  const moderationResult = await moderationService.filterMessage(trimmed);

  if (moderationResult.blocked) {
    await moderationService.handleViolation(userId, moderationResult.severity, null);
    return sendError(res, moderationResult.reason, 403, 'CONTENT_BLOCKED');
  }

  // Create message
  const message = await prisma.roomMessage.create({
    data: {
      roomId,
      userId,
      text: moderationResult.filtered,
    },
    include: {
      user: {
        select: { id: true, username: true, avatar: true },
      },
    },
  });

  // Broadcast to room via socket
  const io = global.__io;
  if (io) {
    const roomNs = io.of('/room');
    roomNs.to(roomId).emit('new-message', {
      id: message.id,
      roomId,
      userId,
      username: message.user?.username || 'مجهول',
      avatar: message.user?.avatar,
      text: moderationResult.filtered,
      timestamp: message.createdAt,
    });
  }

  // Return formatted message
  const formattedMessage = {
    id: message.id,
    roomId: message.roomId,
    userId: message.userId,
    username: message.user?.username || 'مجهول',
    avatar: message.user?.avatar,
    text: message.text,
    timestamp: message.createdAt,
    isSystem: false,
  };

  sendSuccess(res, formattedMessage, 201, 'Message sent');
}));

// ---------------------------------------------------------------------------
// GET /rooms/:id/livekit-token
// FIX L-01: warn if default LiveKit credentials are in use
// ---------------------------------------------------------------------------
router.get('/:id/livekit-token', authenticate, asyncHandler(async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;
  const username = req.user.username;

  console.log('[livekit-token] Starting token generation for room:', roomId, 'user:', userId);

  if (LIVEKIT_API_SECRET === 'secret' || LIVEKIT_API_KEY === 'devkey') {
    console.warn('[livekit] Using default API credentials — set LIVEKIT_API_KEY and LIVEKIT_API_SECRET in production');
  }

  console.log('[livekit-token] Checking database for seat/participant...');
  const seat = await prisma.seat.findFirst({ where: { roomId, userId } });
  console.log('[livekit-token] Seat found:', !!seat);
  
  const participant = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } },
  });
  console.log('[livekit-token] Participant found:', !!participant);

  if (!seat && !participant) {
    console.log('[livekit-token] User not in room - returning 403');
    return sendError(res, 'User not in room', 403);
  }

  const canPublish = seat ? !seat.isMuted && !seat.forceMuted : false;
  console.log('[livekit-token] canPublish:', canPublish);

  console.log('[livekit-token] Loading livekit-server-sdk...');
  const { AccessToken } = require('livekit-server-sdk');
  console.log('[livekit-token] Creating AccessToken with API_KEY:', LIVEKIT_API_KEY?.substring(0, 4) + '...');
  
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  at.identity = userId;
  at.name = username;
  at.addGrant({
    room: roomId,
    roomJoin: true,
    canPublish,
    canPublishData: true,
    canSubscribe: true,
  });

  console.log('[livekit-token] Generating JWT token...');
  const token = at.toJwt();
  console.log('[livekit-token] Token generated successfully');
  console.log('[livekit-token] Token length:', token.length);
  console.log('[livekit-token] LiveKit URL being sent:', LIVEKIT_URL);

  sendSuccess(res, { token, livekitUrl: LIVEKIT_URL });
  console.log('[livekit-token] Response sent successfully');
}));

module.exports = router;
