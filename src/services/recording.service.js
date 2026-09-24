/**
 * Recording Service
 *
 * MISSING FEATURE: getUploadSignature now checks vipPrivileges.canRecord
 *                  before issuing a Cloudinary signature.
 */

const prisma = require('../prismaClient');

async function getUploadSignature(userId, roomId) {
  // Check user is seated in the room
  const seat = await prisma.seat.findFirst({ where: { roomId, userId } });
  if (!seat) {
    throw new Error('You must be seated in the room to start a recording');
  }

  // MISSING FEATURE: check VIP canRecord permission
  const vipRecalcService = require('./vip.recalc.service');
  const vipStatus = await vipRecalcService.getCachedVipStatus(userId);
  if (!vipStatus.canRecord) {
    const err = new Error('Recording requires a VIP subscription with recording privileges');
    err.code = 'VIP_REQUIRED';
    throw err;
  }

  const timestamp = Math.round(Date.now() / 1000);
  const folder = `recordings/${roomId}`;
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder, resource_type: 'video' },
    process.env.CLOUDINARY_API_SECRET,
  );

  const recording = await prisma.roomRecording.create({
    data: {
      roomId,
      recorderId: userId,
      cloudinaryId: `pending-${roomId}-${userId}-${timestamp}`,
      audioUrl: '',
      durationSecs: 0,
      sizeBytes: 0,
      status: 'PROCESSING',
    },
  });

  return {
    signature,
    timestamp,
    folder,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    recordingId: recording.id,
  };
}

async function confirmUpload(recordingId, userId, cloudinaryId, audioUrl, durationSecs, sizeBytes) {
  const recording = await prisma.roomRecording.findUnique({
    where: { id: recordingId },
    include: { recorder: { select: { id: true, username: true, avatar: true } } },
  });

  if (!recording) throw new Error('Recording not found');
  if (recording.recorderId !== userId) {
    throw new Error('You are not authorized to confirm this recording');
  }

  if (cloudinaryId.startsWith('pending-')) {
    throw new Error('Invalid Cloudinary ID for confirmed recording');
  }

  try {
    await cloudinary.api.resource(cloudinaryId, { resource_type: 'video' });
  } catch (verifyError) {
    throw new Error('Cloudinary asset verification failed: ' + verifyError.message);
  }

  const updated = await prisma.roomRecording.update({
    where: { id: recordingId },
    data: { cloudinaryId, audioUrl, durationSecs, sizeBytes, status: 'READY', sharedAt: new Date() },
  });

  try {
    if (global.__io) {
      global.__io.of('/room').to(recording.roomId).emit('recording-shared', {
        recordingId: updated.id,
        recorderId: recording.recorderId,
        recorderName: recording.recorder.username,
        recorderAvatar: recording.recorder.avatar,
        audioUrl: updated.audioUrl,
        durationSecs: updated.durationSecs,
        createdAt: updated.sharedAt.toISOString(),
      });
    }
  } catch (emitError) {
    console.error('Failed to emit recording-shared event:', emitError);
  }

  return updated;
}

async function getRoomRecordings(roomId, page = 1, limit = 20) {
  const skip = Math.max(0, page - 1) * limit;
  const [recordings, total] = await Promise.all([
    prisma.roomRecording.findMany({
      where: { roomId, status: 'READY' },
      include: { recorder: { select: { id: true, username: true, avatar: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.roomRecording.count({ where: { roomId, status: 'READY' } }),
  ]);
  return { recordings, page, limit, total };
}

async function deleteRecording(recordingId, userId) {
  const recording = await prisma.roomRecording.findUnique({
    where: { id: recordingId },
    include: { room: { select: { ownerId: true } } },
  });

  if (!recording) throw new Error('Recording not found');

  const isOwner = recording.recorderId === userId;
  const isRoomOwner = recording.room.ownerId === userId;
  if (!isOwner && !isRoomOwner) {
    throw new Error('You do not have permission to delete this recording');
  }

  try {
    await cloudinary.uploader.destroy(recording.cloudinaryId, { resource_type: 'video' });
  } catch (destroyError) {
    console.warn('Cloudinary destroy failed, continuing with DB delete:', destroyError.message);
  }

  await prisma.roomRecording.delete({ where: { id: recordingId } });
  return { success: true };
}

async function getRecording(recordingId) {
  return prisma.roomRecording.findUnique({
    where: { id: recordingId },
    include: {
      recorder: { select: { id: true, username: true, avatar: true } },
      room: { select: { id: true, ownerId: true } },
    },
  });
}

async function canAccessRecording(recording, userId) {
  if (!recording) return false;
  if (recording.recorderId === userId) return true;
  if (recording.room?.ownerId === userId) return true;
  const seat = await prisma.seat.findFirst({ where: { roomId: recording.roomId, userId } });
  return !!seat;
}

async function getRecordingForUser(recordingId, userId) {
  const recording = await getRecording(recordingId);
  if (!recording) return null;
  const allowed = await canAccessRecording(recording, userId);
  if (!allowed) {
    const err = new Error('Not authorized to view this recording');
    err.code = 'FORBIDDEN';
    throw err;
  }
  return recording;
}

module.exports = {
  getUploadSignature,
  confirmUpload,
  getRoomRecordings,
  deleteRecording,
  getRecording,
  getRecordingForUser,
};
