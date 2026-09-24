const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const followService = require('../services/follow.service');

router.post('/:id/follow', authenticate, async (req, res) => {
  try {
    const followerId = req.user.id;
    const followingId = req.params.id;
    const result = await followService.followUser(followerId, followingId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id/follow', authenticate, async (req, res) => {
  try {
    const followerId = req.user.id;
    const followingId = req.params.id;
    await followService.unfollowUser(followerId, followingId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id/followers', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const data = await followService.getFollowers(req.params.id, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id/following', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const data = await followService.getFollowing(req.params.id, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id/follow-status', authenticate, async (req, res) => {
  try {
    const isFollowing = await followService.isFollowing(req.user.id, req.params.id);
    res.json({ success: true, data: { isFollowing } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
