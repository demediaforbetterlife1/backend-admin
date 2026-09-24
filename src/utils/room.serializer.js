/**
 * Serialize a Prisma room (with owner + seats includes) for API responses.
 *
 * FIX: serializeRoom now passes room.ownerId to serializeSeat so every seat
 * correctly reflects isOwner = (seat.userId === ownerId).  Previously seats
 * were mapped with Array.prototype.map(serializeSeat) which passed the array
 * index as the second argument, meaning isOwner was always falsy.
 */
function serializeRoom(room, { includePasswordProtected = false } = {}) {
  const occupiedSeats = room.seats?.filter((s) => s.userId) ?? [];
  const audienceCount = room._count?.participants ?? room.participantCount ?? 0;

  return {
    id: room.id,
    name: room.name,
    image: room.image,
    coverImage: room.image,
    isPrivate: room.isPrivate,
    isPasswordProtected: !!room.passwordHash,
    category: room.category || 'talk',
    tags: Array.isArray(room.tags) ? room.tags : [],
    maxSeats: room.maxSeats,
    isActive: room.isActive,
    topic: room.topic,
    description: room.description,
    ownerId: room.ownerId,
    hostId: room.ownerId,
    hostName: room.owner?.username ?? room.ownerName,
    hostAvatar: room.owner?.avatar ?? room.ownerAvatar,
    ownerName: room.owner?.username ?? room.ownerName,
    ownerAvatar: room.owner?.avatar ?? room.ownerAvatar,
    seatsCount: occupiedSeats.length,
    seatCount: occupiedSeats.length,
    listenersCount: occupiedSeats.length + audienceCount,
    listenerCount: occupiedSeats.length + audienceCount,
    type: room.isPrivate ? 'private' : 'public',
    createdAt: room.createdAt,
    closedAt: room.closedAt,
    // FIX: pass ownerId explicitly so each seat can compute isOwner correctly.
    seats: room.seats?.map((seat) => serializeSeat(seat, room.ownerId)) ?? [],
  };
}

function serializeSeat(seat, ownerId) {
  // ═══════════════════════════════════════════════════════════════════════
  // REDUNDANT SAFETY CHECK #8: Defensive isOwner Calculation
  // ═══════════════════════════════════════════════════════════════════════
  // Never let isOwner be undefined or null. Always compute it explicitly.
  // This prevents Flutter from receiving seats without the isOwner flag.
  const isOwnerComputed = ownerId != null && seat.userId != null && seat.userId === ownerId;
  const isOwnerFallback = seat.isOwner ?? false;
  const isOwnerFinal = isOwnerComputed || isOwnerFallback;
  
  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE: Profile Frame & Crown Support
  // ═══════════════════════════════════════════════════════════════════════
  // Include user's active frame and crown status (host/VIP/SVIP/agent)
  // Frame comes from user.activeFrame relation (populated in queries)
  // Crown/badge determined by: isOwner (host), role (VIP/SVIP/AGENT)
  const activeFrame = seat.user?.activeFrame || null;
  const vipTier = seat.user?.vipTier || seat.user?.UserVip?.tier || 'NONE';
  
  // Determine badge type for display
  let badge = null;
  if (isOwnerFinal) {
    badge = 'HOST'; // Host gets crown
  } else if (vipTier.startsWith('SVIP')) {
    badge = 'SVIP';
  } else if (vipTier !== 'NONE' && vipTier !== 'FREE') {
    badge = 'VIP';
  } else if (seat.user?.role === 'AGENT') {
    badge = 'AGENT';
  }
  
  return {
    id: seat.id,
    roomId: seat.roomId,
    seatIndex: seat.seatIndex,
    userId: seat.userId,
    username: seat.user?.username,
    avatar: seat.user?.avatar,
    role: seat.user?.role,
    isMuted: seat.isMuted,
    forceMuted: seat.forceMuted ?? false,
    isModerator: seat.isModerator ?? false,
    // FIX: ownerId is now always the room ownerId string, never an array index.
    // PLUS: Defensive fallback ensures isOwner is never undefined/null.
    isOwner: isOwnerFinal,
    joinedAt: seat.joinedAt,
    // FEATURE: Profile customization
    frameUrl: activeFrame?.imageUrl || null,
    frameName: activeFrame?.name || null,
    badge: badge,
    vipTier: vipTier,
    // Host special treatment
    isHost: isOwnerFinal,
    showCrown: isOwnerFinal,
    showGoldenFrame: isOwnerFinal,
  };
}

module.exports = { serializeRoom, serializeSeat };
