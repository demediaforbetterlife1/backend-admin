const express = require('express');
const router = express.Router();
const recordingService = require('../services/recording.service');
const { authenticate } = require('../middleware/authMiddleware');
const prisma = require('../prismaClient');

router.post('/signature', authenticate, async (req, res) => {
  try {
    const { roomId } = req.body;
    if (!roomId) {
      return res.status(400).json({ success: false, error: 'roomId is required' });
    }

    const data = await recordingService.getUploadSignature(req.user.id, roomId);
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/confirm', authenticate, async (req, res) => {
  try {
    const { recordingId, cloudinaryId, audioUrl, durationSecs, sizeBytes } = req.body;

    if (!recordingId || !cloudinaryId || !audioUrl || durationSecs == null || sizeBytes == null) {
      return res.status(400).json({
        success: false,
        error: 'recordingId, cloudinaryId, audioUrl, durationSecs, and sizeBytes are required',
      });
    }

    const recording = await recordingService.confirmUpload(
      recordingId,
      req.user.id,
      cloudinaryId,
      audioUrl,
      Number(durationSecs),
      Number(sizeBytes),
    );

    res.json({ success: true, data: recording });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// FIX H-05: restrict room recording list to the room owner or admin/super_admin
router.get('/room/:roomId', authenticate, async (req, res) => {
  try {
    const room = await prisma.room.findUnique({ where: { id: req.params.roomId }, select: { ownerId: true } });
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }
    if (room.ownerId !== req.user.id && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Only the room owner or admin can view recordings' });
    }
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const data = await recordingService.getRoomRecordings(req.params.roomId, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const recording = await recordingService.getRecordingForUser(req.params.id, req.user.id);
    res.json({ success: true, data: recording });
  } catch (err) {
    const status = err.code === 'FORBIDDEN' ? 403 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    await recordingService.deleteRecording(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(403).json({ success: false, error: err.message });
  }
});

module.exports = router;
