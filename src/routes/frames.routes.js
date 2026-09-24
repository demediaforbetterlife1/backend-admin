/**
 * Frames & Entrances Routes
 * 
 * API endpoints for profile customization
 */

const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const framesService = require('../services/frames.service');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════
// FRAMES ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /frames - Get all available frames
 */
router.get('/frames', authenticate, asyncHandler(async (req, res) => {
  const frames = await framesService.getAvailableFrames();
  sendSuccess(res, frames);
}));

/**
 * GET /frames/my - Get user's owned frames
 */
router.get('/frames/my', authenticate, asyncHandler(async (req, res) => {
  const frames = await framesService.getUserFrames(req.user.id);
  sendSuccess(res, frames);
}));

/**
 * POST /frames/:id/purchase - Purchase a frame
 */
router.post('/frames/:id/purchase', authenticate, asyncHandler(async (req, res) => {
  try {
    const userFrame = await framesService.purchaseFrame(req.user.id, req.params.id);
    sendSuccess(res, userFrame, 200, 'Frame purchased successfully');
  } catch (error) {
    if (error.message.includes('Insufficient')) {
      return sendError(res, 'Insufficient coins', 400);
    }
    if (error.message.includes('already own')) {
      return sendError(res, 'You already own this frame', 400);
    }
    throw error;
  }
}));

/**
 * POST /frames/:id/activate - Activate a frame
 */
router.post('/frames/:id/activate', authenticate, asyncHandler(async (req, res) => {
  try {
    const userFrame = await framesService.activateFrame(req.user.id, req.params.id);
    sendSuccess(res, userFrame, 200, 'Frame activated');
  } catch (error) {
    if (error.message.includes('do not own')) {
      return sendError(res, 'You do not own this frame', 403);
    }
    throw error;
  }
}));

/**
 * POST /frames/deactivate - Deactivate active frame
 */
router.post('/frames/deactivate', authenticate, asyncHandler(async (req, res) => {
  await framesService.deactivateFrame(req.user.id);
  sendSuccess(res, null, 200, 'Frame deactivated');
}));

// ═══════════════════════════════════════════════════════════════════════
// ENTRANCES ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /entrances - Get all available entrances
 */
router.get('/entrances', authenticate, asyncHandler(async (req, res) => {
  const entrances = await framesService.getAvailableEntrances();
  sendSuccess(res, entrances);
}));

/**
 * GET /entrances/my - Get user's owned entrances
 */
router.get('/entrances/my', authenticate, asyncHandler(async (req, res) => {
  const entrances = await framesService.getUserEntrances(req.user.id);
  sendSuccess(res, entrances);
}));

/**
 * POST /entrances/:id/purchase - Purchase an entrance
 */
router.post('/entrances/:id/purchase', authenticate, asyncHandler(async (req, res) => {
  try {
    const userEntrance = await framesService.purchaseEntrance(req.user.id, req.params.id);
    sendSuccess(res, userEntrance, 200, 'Entrance purchased successfully');
  } catch (error) {
    if (error.message.includes('Insufficient')) {
      return sendError(res, 'Insufficient coins', 400);
    }
    if (error.message.includes('already own')) {
      return sendError(res, 'You already own this entrance', 400);
    }
    throw error;
  }
}));

/**
 * POST /entrances/:id/activate - Activate an entrance
 */
router.post('/entrances/:id/activate', authenticate, asyncHandler(async (req, res) => {
  try {
    const userEntrance = await framesService.activateEntrance(req.user.id, req.params.id);
    sendSuccess(res, userEntrance, 200, 'Entrance activated');
  } catch (error) {
    if (error.message.includes('do not own')) {
      return sendError(res, 'You do not own this entrance', 403);
    }
    throw error;
  }
}));

/**
 * POST /entrances/deactivate - Deactivate active entrance
 */
router.post('/entrances/deactivate', authenticate, asyncHandler(async (req, res) => {
  await framesService.deactivateEntrance(req.user.id);
  sendSuccess(res, null, 200, 'Entrance deactivated');
}));

module.exports = router;
