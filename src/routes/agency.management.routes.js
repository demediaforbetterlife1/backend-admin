/**
 * Agency Management Routes
 * 
 * Handles agency owner operations:
 * - Get agency details with real stats
 * - Member management (invite, remove)
 * - Update agency profile
 * - Get earnings
 * 
 * Handles user operations:
 * - Get invitations
 * - Accept/reject invitations
 */

const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const agencyService = require('../services/agency.service');

const router = express.Router();

// ══════════════════════════════════════════════════════════════
// AGENCY OWNER ENDPOINTS
// ══════════════════════════════════════════════════════════════

/**
 * GET /api/agency/my-agency
 * Get current user's agency (if they own one)
 */
router.get('/my-agency', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const agency = await agencyService.getAgencyByOwnerId(userId);
    
    if (!agency) {
      return res.status(404).json({
        success: false,
        error: 'No agency found for this user',
        code: 'NO_AGENCY',
      });
    }
    
    res.json({
      success: true,
      data: agency,
    });
  } catch (err) {
    console.error('[GET /api/agency/my-agency]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agency/members
 * List all members of current user's agency
 */
router.get('/members', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // First get user's agency
    const agency = await agencyService.getAgencyByOwnerId(userId);
    
    if (!agency) {
      return res.status(404).json({
        success: false,
        error: 'No agency found',
        code: 'NO_AGENCY',
      });
    }
    
    const { status, limit, offset } = req.query;
    
    const members = await agencyService.getAgencyMembers(agency.id, userId, {
      status,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
    
    res.json({
      success: true,
      data: members,
    });
  } catch (err) {
    console.error('[GET /api/agency/members]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agency/invite
 * Invite a user to join the agency
 * Body: { identifier: username|email|userId }
 */
router.post('/invite', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { identifier } = req.body;
    
    if (!identifier || !identifier.trim()) {
      return res.status(400).json({
        success: false,
        error: 'User identifier (username, email, or ID) is required',
      });
    }
    
    // Get user's agency
    const agency = await agencyService.getAgencyByOwnerId(userId);
    
    if (!agency) {
      return res.status(404).json({
        success: false,
        error: 'No agency found',
        code: 'NO_AGENCY',
      });
    }
    
    const membership = await agencyService.inviteMember(
      agency.id,
      userId,
      identifier.trim()
    );
    
    res.json({
      success: true,
      message: 'Invitation sent successfully',
      data: membership,
    });
  } catch (err) {
    console.error('[POST /api/agency/invite]', err);
    
    // Provide specific error codes for common cases
    if (err.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: err.message,
        code: 'USER_NOT_FOUND',
      });
    }
    
    if (err.message.includes('already')) {
      return res.status(400).json({
        success: false,
        error: err.message,
        code: 'ALREADY_MEMBER',
      });
    }
    
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/agency/members/:membershipId
 * Remove a member from the agency
 */
router.delete('/members/:membershipId', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { membershipId } = req.params;
    
    const updated = await agencyService.removeMember(membershipId, userId);
    
    res.json({
      success: true,
      message: 'Member removed successfully',
      data: updated,
    });
  } catch (err) {
    console.error('[DELETE /api/agency/members/:id]', err);
    
    if (err.message === 'Not authorized' || err.message.includes('Only agency owner')) {
      return res.status(403).json({
        success: false,
        error: err.message,
        code: 'NOT_AUTHORIZED',
      });
    }
    
    if (err.message === 'Membership not found') {
      return res.status(404).json({
        success: false,
        error: err.message,
        code: 'NOT_FOUND',
      });
    }
    
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/agency
 * Update agency profile details
 * Body: { description, profileImage, teamSize, offeredServices, country }
 */
router.patch('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's agency
    const agency = await agencyService.getAgencyByOwnerId(userId);
    
    if (!agency) {
      return res.status(404).json({
        success: false,
        error: 'No agency found',
        code: 'NO_AGENCY',
      });
    }
    
    const updated = await agencyService.updateAgency(agency.id, userId, req.body);
    
    res.json({
      success: true,
      message: 'Agency updated successfully',
      data: updated,
    });
  } catch (err) {
    console.error('[PATCH /api/agency]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agency/earnings
 * Get earnings breakdown for the agency
 */
router.get('/earnings', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's agency
    const agency = await agencyService.getAgencyByOwnerId(userId);
    
    if (!agency) {
      return res.status(404).json({
        success: false,
        error: 'No agency found',
        code: 'NO_AGENCY',
      });
    }
    
    const earnings = await agencyService.getAgencyEarnings(agency.id, userId);
    
    res.json({
      success: true,
      data: earnings,
    });
  } catch (err) {
    console.error('[GET /api/agency/earnings]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// USER ENDPOINTS (Invitation Management)
// ══════════════════════════════════════════════════════════════

/**
 * GET /api/agency/invitations
 * Get all pending invitations for current user
 */
router.get('/invitations', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const invitations = await agencyService.getUserInvitations(userId);
    
    res.json({
      success: true,
      data: invitations,
    });
  } catch (err) {
    console.error('[GET /api/agency/invitations]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agency/invitations/:membershipId/accept
 * Accept an agency invitation
 */
router.post('/invitations/:membershipId/accept', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { membershipId } = req.params;
    
    const updated = await agencyService.acceptInvitation(membershipId, userId);
    
    res.json({
      success: true,
      message: 'Invitation accepted successfully',
      data: updated,
    });
  } catch (err) {
    console.error('[POST /api/agency/invitations/:id/accept]', err);
    
    if (err.message === 'Not authorized') {
      return res.status(403).json({
        success: false,
        error: err.message,
        code: 'NOT_AUTHORIZED',
      });
    }
    
    if (err.message === 'Invitation not found') {
      return res.status(404).json({
        success: false,
        error: err.message,
        code: 'NOT_FOUND',
      });
    }
    
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agency/invitations/:membershipId/reject
 * Reject an agency invitation
 */
router.post('/invitations/:membershipId/reject', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { membershipId } = req.params;
    
    const updated = await agencyService.rejectInvitation(membershipId, userId);
    
    res.json({
      success: true,
      message: 'Invitation rejected',
      data: updated,
    });
  } catch (err) {
    console.error('[POST /api/agency/invitations/:id/reject]', err);
    
    if (err.message === 'Not authorized') {
      return res.status(403).json({
        success: false,
        error: err.message,
        code: 'NOT_AUTHORIZED',
      });
    }
    
    if (err.message === 'Invitation not found') {
      return res.status(404).json({
        success: false,
        error: err.message,
        code: 'NOT_FOUND',
      });
    }
    
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
