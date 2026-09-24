/**
 * Room Socket Handler
 *
 * FIX H-04: 'user-muted' socket event only allows self-mute; blocks self-unmute
 *           when force-muted by owner/admin via REST API.
 * FIX HOST-DISCONNECT: When a socket owned by the room host disconnects, the room
 *   is automatically closed, all remaining seats cleared, every participant in
 *   the socket room notified via 'room-closed', then kicked from the channel.
 *   A global 'rooms-updated' broadcast removes the room from discovery/home screens.
 * FIX TASK-4: Emit all required synchronisation events:
 *   RoomCreated, RoomUpdated, RoomClosed, UserJoined, UserLeft, HostLeft,
 *   SeatUpdated, MuteUpdated, RoomEnded, Reconnect.
 * FIX TASK-3: On participant leave — remove from audience, speakers, mic queue,
 *   socket room, and presence list; update room stats; no ghost users.
 * FIX TASK-2: On host leave — end room, disconnect every participant,
 *   broadcast room-closed + rooms-updated, wipe memory + DB.
 * MISSING FEATURE (6): Per-socket rate limiting on send-message events.
 */

const prisma = require('../prismaClient');
const moderationService = require('../services/moderation.service');
const loyaltyService = require('../services/loyalty.service');
const { socketAuthMiddleware } = require('../middleware/socketAuth');
const { serializeSeat } = require('../utils/room.serializer');

// ─── In-memory room state ─────────────────────────────────────────────────────
const roomSockets = new Map();      // roomId → Set<Socket>
const userSockets = new Map();      // userId → Set<Socket>
const activeVoiceSessions = new Map(); // `voice:${userId}` → { startedAt, roomId }

// ─── Per-socket rate limiting ─────────────────────────────────────────────────
const socketRateLimits = new Map();
const RATE_LIMIT_WINDOW_MS  = 10 * 1000;
const RATE_LIMIT_MAX_MESSAGES = 20;

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of socketRateLimits) {
    if (now > entry.resetAt) socketRateLimits.delete(id);
  }
}, 5 * 60 * 1000);

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

// ─── Voice session helpers ────────────────────────────────────────────────────

function getSessionKey(userId) {
  return `voice:${userId}`;
}

async function finalizeVoiceSession(userId, roomId) {
  const key = getSessionKey(userId);
  const session = activeVoiceSessions.get(key);
  if (!session || session.roomId !== roomId) return;

  const durationMs = Date.now() - session.startedAt;
  const minutes = Math.max(1, Math.round(durationMs / 60000));
  activeVoiceSessions.delete(key);

  if (minutes > 0) {
    await loyaltyService
      .awardXp(userId, 'voice_minutes', minutes * 2, { roomId, minutes })
      .catch((e) => console.warn('[socket] finalizeVoiceSession xp failed', e.message));
  }
}

async function clearUserSeat(userId, roomId) {
  await prisma.seat.updateMany({
    where: { roomId, userId },
    data: { userId: null, isMuted: false, forceMuted: false, isModerator: false },
  });
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Build and broadcast the current seat snapshot to all clients in a room.
 * FIX TASK-4 SeatUpdated: called after every join, leave, mute, or kick so
 * clients always have the authoritative seat list without polling.
 * FEATURE: Includes frame and VIP data for each seated user.
 */
async function emitSeatUpdate(roomNamespace, roomId) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
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
    },
  });
  if (!room) return;

  // Enrich seats with frame data
  const framesService = require('../services/frames.service');
  const enrichedSeats = await framesService.enrichSeatsWithFrames(room.seats);

  // FIX: Use serializeSeat for consistency with REST API - ensures defensive fallbacks
  // for isOwner, forceMuted, isModerator to prevent null/undefined issues
  const seats = enrichedSeats.map((s) => serializeSeat(s, room.ownerId));

  // FIX TASK-4 SeatUpdated: named 'seat-update' to match existing Flutter listener.
  roomNamespace.to(roomId).emit('seat-update', { seats });
}

/**
 * CRITICAL HOST-EXIT FIX: Authoritative room-close implementation.
 *
 * This function is called when:
 *   1. Host explicitly leaves via POST /rooms/:id/leave
 *   2. Host explicitly closes via POST /rooms/:id/close
 *   3. Host's socket disconnects (close app, refresh, crash, etc.)
 *   4. Host's connection is lost (network timeout)
 *   5. Host's JWT expires and they're kicked
 *
 * BEHAVIOR (100% consistent in ALL cases):
 *   1. Mark room inactive in DB (idempotent — multiple calls are safe)
 *   2. Wipe ALL seats (no partial cleanup)
 *   3. Cancel ALL pending seat requests
 *   4. Delete ALL RoomParticipant records (no ghost users)
 *   5. Emit 'room-closed' to every socket in the room
 *   6. Emit 'host-left' for UI differentiation
 *   7. Emit 'room-ended' as final lifecycle event
 *   8. Kick every socket out of the room channel
 *   9. Remove room from in-memory map
 *   10. Broadcast 'rooms-updated' on BOTH /room and default namespaces
 *       so discovery AND home screens update WITHOUT refresh
 *
 * GUARANTEES:
 *   ✓ No zombie rooms
 *   ✓ No ghost participants
 *   ✓ No memory leaks
 *   ✓ No orphaned seat requests
 *   ✓ All clients notified instantly
 *   ✓ Room disappears from all screens immediately
 *
 * FIX ROOT CAUSE #6: All database operations now wrapped in a TRANSACTION
 * to ensure atomicity. If any step fails, entire operation rolls back.
 */
async function closeRoomAndNotify(roomNamespace, roomId, reason = 'host_left') {
  console.log(`[room-socket] 🔴 CLOSING ROOM: ${roomId} (reason: ${reason})`);

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, ownerId: true, isActive: true },
  });

  // Idempotent: if already closed, do nothing
  if (!room || !room.isActive) {
    console.log(`[room-socket] ⚠️ Room ${roomId} already closed or not found`);
    return;
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP 1: DATABASE CLEANUP (source of truth)
  // FIX ROOT CAUSE #6: All operations in ONE transaction
  // ══════════════════════════════════════════════════════════════════════
  console.log(`[room-socket] 📊 Database cleanup for room ${roomId}...`);

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Mark room as inactive with closed timestamp
      await tx.room.update({
        where: { id: roomId },
        data: { isActive: false, closedAt: new Date() },
      });
      console.log(`[room-socket] ✓ Room marked inactive`);

      // 2. Wipe ALL seats (no partial cleanup)
      await tx.seat.updateMany({
        where: { roomId },
        data: { userId: null, isMuted: false, forceMuted: false, isModerator: false, joinedAt: null },
      });
      console.log(`[room-socket] ✓ All seats cleared`);

      // 3. Cancel ALL pending seat requests
      await tx.seatRequest.updateMany({ 
        where: { roomId, status: 'PENDING' }, 
        data: { status: 'CANCELLED' } 
      });
      console.log(`[room-socket] ✓ Pending seat requests cancelled`);

      // 4. Delete ALL participant records (no ghost users)
      await tx.roomParticipant.deleteMany({ where: { roomId } });
      console.log(`[room-socket] ✓ All participants removed`);
    });
    console.log(`[room-socket] ✓ Transaction completed successfully`);
  } catch (err) {
    console.error(`[room-socket] ✗ Database transaction FAILED for room ${roomId}:`, err);
    // Transaction rolled back automatically - room state unchanged
    return;
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP 2: SOCKET NOTIFICATIONS (real-time updates)
  // ══════════════════════════════════════════════════════════════════════
  console.log(`[room-socket] 📡 Broadcasting socket events...`);

  // Event 1: 'room-closed' — PRIMARY event (Flutter listens to this)
  roomNamespace.to(roomId).emit('room-closed', { 
    roomId, 
    reason,
    message: reason === 'host_left' || reason === 'host_disconnected'
      ? 'The host has left. The room is now closed.'
      : 'The room has been closed.',
    timestamp: new Date().toISOString(),
  });
  console.log(`[room-socket] ✓ 'room-closed' emitted`);

  // Event 2: 'host-left' — HOST-SPECIFIC event for UI differentiation
  if (reason === 'host_left' || reason === 'host_disconnected') {
    roomNamespace.to(roomId).emit('host-left', {
      roomId,
      hostId: room.ownerId,
      reason,
      message: 'The host has left. The room is now closed.',
      timestamp: new Date().toISOString(),
    });
    console.log(`[room-socket] ✓ 'host-left' emitted`);
  }

  // Event 3: 'room-ended' — FINAL lifecycle event
  roomNamespace.to(roomId).emit('room-ended', { 
    roomId, 
    reason,
    roomName: room.name,
    timestamp: new Date().toISOString(),
  });
  console.log(`[room-socket] ✓ 'room-ended' emitted`);

  // ══════════════════════════════════════════════════════════════════════
  // STEP 3: KICK ALL SOCKETS (prevent stale events)
  // ══════════════════════════════════════════════════════════════════════
  console.log(`[room-socket] 👥 Kicking all participants...`);
  const socketsInRoom = await roomNamespace.in(roomId).fetchSockets().catch(() => []);
  console.log(`[room-socket] Found ${socketsInRoom.length} sockets to kick`);

  for (const s of socketsInRoom) {
    s.leave(roomId);
  }
  console.log(`[room-socket] ✓ All sockets kicked from room channel`);

  // ══════════════════════════════════════════════════════════════════════
  // STEP 4: IN-MEMORY CLEANUP (prevent memory leaks)
  // ══════════════════════════════════════════════════════════════════════
  roomSockets.delete(roomId);
  console.log(`[room-socket] ✓ Room removed from in-memory map`);

  // ══════════════════════════════════════════════════════════════════════
  // STEP 5: GLOBAL BROADCAST (update discovery/home screens)
  // ══════════════════════════════════════════════════════════════════════
  console.log(`[room-socket] 🌍 Broadcasting global 'rooms-updated'...`);

  const removedPayload = { 
    action: 'removed', 
    roomId,
    reason,
    timestamp: new Date().toISOString(),
  };

  // Broadcast on /room namespace (discovery screens)
  roomNamespace.emit('rooms-updated', removedPayload);
  console.log(`[room-socket] ✓ 'rooms-updated' emitted on /room namespace`);

  // Broadcast on default namespace (home screens)
  if (global.__io) {
    global.__io.emit('rooms-updated', removedPayload);
    console.log(`[room-socket] ✓ 'rooms-updated' emitted on default namespace`);
  }

  console.log(`[room-socket] ✅ ROOM CLOSED SUCCESSFULLY: ${roomId}`);
}

// ─── Socket registration ──────────────────────────────────────────────────────

function registerRoomSocket(io) {
  const roomNamespace = io.of('/room');
  roomNamespace.use(socketAuthMiddleware);

  roomNamespace.on('connection', (socket) => {
    const userId = socket.data.userId;
    console.log(`[room-socket] connected: ${socket.id} (userId=${userId})`);

    if (userId) {
      socket.join(`user:${userId}`);
      if (!userSockets.has(userId)) userSockets.set(userId, new Set());
      userSockets.get(userId).add(socket);
    }

    // ── join-room ─────────────────────────────────────────────────────────
    socket.on('join-room', async (data) => {
      const { roomId } = data || {};
      if (!roomId) {
        socket.emit('error', { message: 'Room ID required' });
        return;
      }

      try {
        // ═══════════════════════════════════════════════════════════════════
        // REDUNDANT SAFETY CHECK #5: Room Active Verification
        // ═══════════════════════════════════════════════════════════════════
        // Verify the room is still active before allowing socket join.
        const room = await prisma.room.findUnique({
          where: { id: roomId },
          select: { isActive: true, ownerId: true },
        });

        if (!room || !room.isActive) {
          console.log(`[room-socket] join-room rejected: room ${roomId} is closed or does not exist`);
          socket.emit('error', { message: 'Room is closed or does not exist' });
          socket.emit('room-closed', { roomId, reason: 'room_inactive' });
          return;
        }

        const seat = await prisma.seat.findFirst({
          where: { roomId, userId },
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
        });

        const participant = await prisma.roomParticipant.findUnique({
          where: { roomId_userId: { roomId, userId } },
        });

        if (!seat && !participant) {
          socket.emit('error', { message: 'Join the room first via API' });
          return;
        }

        socket.join(roomId);

        if (!roomSockets.has(roomId)) roomSockets.set(roomId, new Set());
        roomSockets.get(roomId).add(socket);

        if (seat) {
          activeVoiceSessions.set(getSessionKey(userId), {
            startedAt: Date.now(),
            roomId,
          });

          const [activeEntrance, activeFrame, userVip] = await Promise.all([
            prisma.userEntrance.findFirst({
              where: { userId, isActive: true },
              include: { entrance: true },
            }).catch(() => null),
            prisma.userFrame.findFirst({
              where: { userId, isActive: true },
              include: { frame: true },
            }).catch(() => null),
            prisma.userVip.findUnique({ where: { userId } }).catch(() => null),
          ]);

          // FIX TASK-4 UserJoined: emit with full context.
          roomNamespace.to(roomId).emit('user-joined', {
            userId,
            username: seat.user?.username,
            avatar: seat.user?.avatar,
            seatIndex: seat.seatIndex,
            role: 'speaker',
            vipTier: userVip?.tier || 'NONE',
            hasEntrance: !!activeEntrance,
            entranceName: activeEntrance?.entrance?.name ?? null,
            entranceAnimationUrl: activeEntrance?.entrance?.animationUrl ?? null,
            entranceParticleType: activeEntrance?.entrance?.particleType ?? 'sparkle',
            entranceSoundUrl: activeEntrance?.entrance?.soundUrl ?? null,
            activeFrameUrl: activeFrame?.frame?.imageUrl ?? null,
          });

          // REQ-1: broadcast a system chat message so every client shows
          // "[username] joined the room" without any manual refresh.
          roomNamespace.to(roomId).emit('system-message', {
            id: `sys-${Date.now()}-${userId}`,
            roomId,
            type: 'user_joined',
            text: `${seat.user?.username ?? 'Someone'} دخل الغرفة`,
            timestamp: new Date().toISOString(),
          });
        } else {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { username: true, avatar: true },
          });
          roomNamespace.to(roomId).emit('user-joined', {
            userId,
            username: user?.username,
            avatar: user?.avatar,
            seatIndex: null,
            role: 'audience',
          });

          // REQ-1: system message for audience join too.
          roomNamespace.to(roomId).emit('system-message', {
            id: `sys-${Date.now()}-${userId}`,
            roomId,
            type: 'user_joined',
            text: `${user?.username ?? 'Someone'} دخل الغرفة`,
            timestamp: new Date().toISOString(),
          });
        }

        // ═══════════════════════════════════════════════════════════════════
        // REDUNDANT SAFETY CHECK #4: Guaranteed Seat-Update on Join
        // ═══════════════════════════════════════════════════════════════════
        // FIX TASK-4 SeatUpdated: always broadcast seat state after join.
        // This is CRITICAL: Flutter waits up to 10s for this event. If it
        // doesn't arrive, the client times out and force-exits the room.
        console.log(`[room-socket] Emitting guaranteed seat-update for room ${roomId}...`);
        await emitSeatUpdate(roomNamespace, roomId);
        console.log(`[room-socket] ✓ Seat-update emitted for room ${roomId}`);

        // BUG-2 FIX: broadcast updated participant count immediately after join
        // so all clients (including the discovery screen) see the correct count
        // without waiting for a manual refresh.
        const joinCount = await prisma.roomParticipant.count({ where: { roomId } });
        roomNamespace.to(roomId).emit('room-updated', { roomId, participantCount: joinCount });

        // FIX TASK-4 Reconnect: emit current room state to reconnecting socket.
        const fullRoom = await prisma.room.findUnique({
          where: { id: roomId },
          include: {
            owner: { select: { id: true, username: true, avatar: true } },
            _count: { select: { participants: true } },
          },
        });
        if (fullRoom) {
          socket.emit('room-state', {
            roomId,
            name: fullRoom.name,
            ownerId: fullRoom.ownerId,
            ownerName: fullRoom.owner?.username,
            participantCount: fullRoom._count.participants,
            isActive: fullRoom.isActive,
          });
        }
      } catch (error) {
        console.error('[room-socket] join-room error:', error);
        socket.emit('error', { message: error.message });
      }
    });

    // ── leave-room ────────────────────────────────────────────────────────
    // FIX TASK-3: Full cleanup — seats, participants, mic queue, presence.
    socket.on('leave-room', async (data) => {
      const { roomId } = data || {};
      if (!roomId) return;

      try {
        const room = await prisma.room.findUnique({
          where: { id: roomId },
          select: { ownerId: true, isActive: true },
        });

        const seat = await prisma.seat.findFirst({
          where: { roomId, userId },
          include: { user: { select: { username: true } } },
        });

        // FIX TASK-3: Remove from seats, participants, and presence.
        await clearUserSeat(userId, roomId);
        await prisma.roomParticipant.deleteMany({ where: { roomId, userId } });

        // Cancel any pending seat requests from this user.
        await prisma.seatRequest
          .updateMany({ where: { roomId, userId, status: 'PENDING' }, data: { status: 'CANCELLED' } })
          .catch(() => {});

        await finalizeVoiceSession(userId, roomId);

        socket.leave(roomId);
        roomSockets.get(roomId)?.delete(socket);

        if (room && room.ownerId === userId && room.isActive) {
          // FIX TASK-2: Host left via explicit socket event.
          await closeRoomAndNotify(roomNamespace, roomId, 'host_left');
        } else {
          // FIX TASK-3: Regular participant left — FIX TASK-4 UserLeft.
          roomNamespace.to(roomId).emit('user-left', {
            userId,
            username: seat?.user?.username ?? null,
          });
          await emitSeatUpdate(roomNamespace, roomId);

          // Broadcast updated participant count.
          const count = await prisma.roomParticipant.count({ where: { roomId } });
          roomNamespace.to(roomId).emit('room-updated', { roomId, participantCount: count });
        }
      } catch (error) {
        console.error('[room-socket] leave-room error:', error);
      }
    });

    // ── send-message ──────────────────────────────────────────────────────
    socket.on('send-message', async (data) => {
      const { roomId, text } = data || {};
      if (!roomId || !text?.trim()) return;

      if (!checkMessageRateLimit(socket.id)) {
        socket.emit('error', { message: 'Too many messages — please slow down' });
        return;
      }

      try {
        const seated = await prisma.seat.findFirst({ where: { roomId, userId } });
        const audience = await prisma.roomParticipant.findUnique({
          where: { roomId_userId: { roomId, userId } },
        });
        if (!seated && !audience) {
          socket.emit('error', { message: 'Must be in the room to chat' });
          return;
        }

        const moderationResult = await moderationService.filterMessage(text);
        if (moderationResult.blocked) {
          await moderationService.handleViolation(userId, moderationResult.severity, null);
          socket.emit('message-blocked', { reason: moderationResult.reason });
          return;
        }

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, username: true, avatar: true },
        });

        const message = await prisma.roomMessage.create({
          data: { roomId, userId, text: moderationResult.filtered },
        });

        roomNamespace.to(roomId).emit('new-message', {
          id: message.id,
          roomId,
          userId,
          username: user.username,
          avatar: user.avatar,
          text: moderationResult.filtered,
          timestamp: message.createdAt,
        });
      } catch (error) {
        console.error('[room-socket] send-message error:', error);
      }
    });

    // ── user-muted (self-mute only) ────────────────────────────────────────
    // FIX H-04: block self-unmute when force-muted by owner/admin.
    // FIX MICROPHONE BUG: When self-muting, only set isMuted, never forceMuted.
    // forceMuted is exclusively for admin/owner actions to prevent users from
    // unmuting themselves when muted by authority.
    // FIX TASK-4 MuteUpdated: named 'user-muted' to match Flutter listener.
    socket.on('user-muted', async (data) => {
      const { roomId, isMuted } = data || {};
      if (!roomId) return;

      try {
        const seat = await prisma.seat.findFirst({ where: { roomId, userId } });
        if (!seat) return;

        // BLOCK: Cannot unmute yourself if force-muted by admin/owner
        if (!isMuted && seat.forceMuted) {
          socket.emit('error', { message: 'You cannot unmute yourself while force-muted' });
          return;
        }

        // FIX: Self-mute only changes isMuted, never forceMuted
        await prisma.seat.updateMany({
          where: { roomId, userId },
          data: { isMuted: !!isMuted },
        });

        // FIX TASK-4 MuteUpdated: broadcast to all room participants.
        roomNamespace.to(roomId).emit('user-muted', { userId, isMuted: !!isMuted });
      } catch (error) {
        console.error('[room-socket] user-muted error:', error);
      }
    });

    // ── ping (keepalive) ──────────────────────────────────────────────────
    socket.on('ping', () => socket.emit('pong', { ts: Date.now() }));

    // ── disconnect ────────────────────────────────────────────────────────
    // CRITICAL HOST-EXIT FIX: When ANY socket disconnects, we MUST check EVERY
    // room they were in to detect if they are the owner, regardless of whether
    // they have an activeVoiceSession (which can be lost on server restart).
    //
    // WHY: Without this, when the host closes the app/browser/refreshes:
    //   1. activeVoiceSessions might be empty (server restarted)
    //   2. The "else" branch treats them as audience
    //   3. Room ownership check was SKIPPED → room NEVER closes
    //   4. Zombie room persists forever in discovery/home screens
    //
    // FIX: Always check room ownership FIRST via database, NOT memory.
    socket.on('disconnect', async (reason) => {
      console.log(`[room-socket] disconnect: ${socket.id} (userId=${userId}, reason=${reason})`);

      cleanupRateLimit(socket.id);

      // Collect all room IDs this socket was subscribed to
      const socketRoomIds = Array.from(socket.rooms).filter(
        (r) => r !== socket.id && !r.startsWith('user:'),
      );

      // Remove socket from in-memory tracking
      for (const [roomId, sockets] of roomSockets.entries()) {
        if (sockets.has(socket)) sockets.delete(socket);
      }

      if (!userId) return;

      // ═══════════════════════════════════════════════════════════════════
      // CRITICAL FIX: Process EVERY room the user was in
      // Check DATABASE ownership FIRST (not memory)
      // ═══════════════════════════════════════════════════════════════════
      for (const roomId of socketRoomIds) {
        try {
          // STEP 1: Get room from DATABASE (source of truth)
          const room = await prisma.room.findUnique({
            where: { id: roomId },
            select: { ownerId: true, isActive: true },
          });

          // STEP 2: Check if this user is the owner (BEFORE checking session)
          const isOwner = room && room.ownerId === userId;

          // STEP 3: Finalize voice session if exists (XP tracking)
          const session = activeVoiceSessions.get(getSessionKey(userId));
          if (session && session.roomId === roomId) {
            await finalizeVoiceSession(userId, roomId);
          }

          // STEP 4: Clean up user's seat and participant record
          await clearUserSeat(userId, roomId);
          await prisma.roomParticipant.deleteMany({ where: { roomId, userId } }).catch(() => {});
          await prisma.seatRequest
            .updateMany({ where: { roomId, userId, status: 'PENDING' }, data: { status: 'CANCELLED' } })
            .catch(() => {});

          // ═══════════════════════════════════════════════════════════════
          // CRITICAL: HOST DISCONNECT → CLOSE ROOM IMMEDIATELY
          // ═══════════════════════════════════════════════════════════════
          if (isOwner && room.isActive) {
            console.log(`[room-socket] 🔴 HOST DISCONNECT DETECTED → Closing room ${roomId}`);
            await closeRoomAndNotify(roomNamespace, roomId, 'host_disconnected');
            continue; // Skip normal participant cleanup for this room
          }

          // ═══════════════════════════════════════════════════════════════
          // Regular participant disconnect
          // ═══════════════════════════════════════════════════════════════
          roomNamespace.to(roomId).emit('user-left', { userId });
          await emitSeatUpdate(roomNamespace, roomId);
          const count = await prisma.roomParticipant.count({ where: { roomId } });
          roomNamespace.to(roomId).emit('room-updated', { roomId, participantCount: count });

        } catch (err) {
          console.error(`[room-socket] disconnect cleanup failed for room ${roomId}:`, err.message);
        }
      }

      // Clean up per-user socket tracking
      if (userSockets.has(userId)) {
        userSockets.get(userId).delete(socket);
        if (!userSockets.get(userId).size) userSockets.delete(userId);
      }
    });
  });
}

// ─── Admin helpers ────────────────────────────────────────────────────────────

/**
 * Forcibly kick all sockets for a user (used by ban/moderation system).
 */
async function kickUserFromAllRooms(userId) {
  const sockets = userSockets.get(userId);
  if (!sockets || !sockets.size) return;

  for (const socket of sockets) {
    const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id && !r.startsWith('user:'));
    for (const roomId of rooms) {
      socket.leave(roomId);
      socket.to(roomId).emit('user-kicked', { userId });
    }
    socket.emit('force-disconnect', { reason: 'banned' });
    socket.disconnect(true);
  }

  userSockets.delete(userId);
}

/**
 * Expose closeRoomAndNotify so the REST route layer can call it after
 * a /close endpoint call to avoid duplicate close logic.
 */
module.exports = { registerRoomSocket, kickUserFromAllRooms, closeRoomAndNotify };
