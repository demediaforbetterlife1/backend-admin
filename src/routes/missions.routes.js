const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const missionService = require('../services/mission.service');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const data = await missionService.getMissionsStatus(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:id/claim', authenticate, async (req, res) => {
  try {
    const data = await missionService.claimMission(req.user.id, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    const status = error.code === 'ALREADY_CLAIMED' || error.code === 'NOT_COMPLETED' ? 400 : 500;
    res.status(status).json({ success: false, error: error.message, code: error.code });
  }
});

module.exports = router;
