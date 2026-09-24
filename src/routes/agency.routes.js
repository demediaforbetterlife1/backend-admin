/**
 * Agency Registration Routes
 * 
 * POST   /api/agency/register       - Submit agency registration request (requires auth)
 * GET    /api/agency/my-request     - Get current user's agency request status
 * PATCH  /api/agency/my-request     - Update pending agency request
 * 
 * Admin routes are in admin.core.routes.js:
 * GET    /api/admin/agencies         - List all agency requests
 * PATCH  /api/admin/agencies/:id/approve
 * PATCH  /api/admin/agencies/:id/reject
 */

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/authMiddleware');
const { uploadService, processUpload } = require('../services/uploadService');
const notificationService = require('../services/notification.service');

const router = express.Router();
const prisma = new PrismaClient();

// ══════════════════════════════════════════════════════════════
// SUBMIT AGENCY REGISTRATION REQUEST
// ══════════════════════════════════════════════════════════════

router.post('/register', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      agencyName,
      ownerName,
      phone,
      email,
      country,
      bio,
      teamSize,
      offeredServices,
      profileImage,
      documents, // Array of document URLs
    } = req.body;

    // Validation
    if (!agencyName || !ownerName || !phone) {
      return res.status(400).json({
        success: false,
        error: 'agencyName, ownerName, and phone are required',
      });
    }

    // Check if user already has a request
    const existingRequest = await prisma.agencyRequest.findUnique({
      where: { userId },
    });

    if (existingRequest) {
      if (existingRequest.status === 'PENDING') {
        return res.status(400).json({
          success: false,
          error: 'You already have a pending agency request',
          code: 'REQUEST_EXISTS',
        });
      }
      if (existingRequest.status === 'APPROVED') {
        return res.status(400).json({
          success: false,
          error: 'Your agency request has already been approved',
          code: 'ALREADY_APPROVED',
        });
      }
      // If REJECTED, allow resubmission by updating
    }

    // Create or update request
    const request = await prisma.agencyRequest.upsert({
      where: { userId },
      create: {
        userId,
        agencyName,
        ownerName,
        phone,
        email,
        country,
        bio,
        teamSize,
        offeredServices: offeredServices || [],
        profileImage,
        documents: documents || [],
        status: 'PENDING',
      },
      update: {
        agencyName,
        ownerName,
        phone,
        email,
        country,
        bio,
        teamSize,
        offeredServices: offeredServices || [],
        profileImage,
        documents: documents || [],
        status: 'PENDING',
        rejectionReason: null, // Clear previous rejection reason
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    // Update user accountType to indicate they're applying
    await prisma.user.update({
      where: { id: userId },
      data: {
        accountType: 'AGENCY_OWNER',
        status: 'PENDING_APPROVAL',
        agencyName,
        // ✅ FIXED: Don't overwrite user's displayName with ownerName
        // User's displayName should remain their personal identity
      },
    });

    // Log audit trail
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'AGENCY_REGISTER',
        metadata: { agencyName, ownerName },
      },
    });

    res.json({
      success: true,
      message: 'Agency registration request submitted successfully',
      data: request,
    });
  } catch (err) {
    console.error('[POST /api/agency/register]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET MY AGENCY REQUEST STATUS
// ══════════════════════════════════════════════════════════════

router.get('/my-request', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const request = await prisma.agencyRequest.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            phone: true,
            accountType: true,
            agencyApproved: true,
          },
        },
        reviewedByAdmin: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'No agency request found',
        code: 'NO_REQUEST',
      });
    }

    res.json({
      success: true,
      data: request,
    });
  } catch (err) {
    console.error('[GET /api/agency/my-request]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// UPDATE MY AGENCY REQUEST (only if REJECTED)
// ══════════════════════════════════════════════════════════════

router.patch('/my-request', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      agencyName,
      ownerName,
      phone,
      email,
      country,
      bio,
      teamSize,
      offeredServices,
      profileImage,
      documents,
    } = req.body;

    // Check current status
    const existingRequest = await prisma.agencyRequest.findUnique({
      where: { userId },
    });

    if (!existingRequest) {
      return res.status(404).json({
        success: false,
        error: 'No agency request found',
      });
    }

    if (existingRequest.status === 'PENDING') {
      return res.status(400).json({
        success: false,
        error: 'Cannot update while request is pending review',
        code: 'REQUEST_PENDING',
      });
    }

    if (existingRequest.status === 'APPROVED') {
      return res.status(400).json({
        success: false,
        error: 'Cannot update approved request',
        code: 'ALREADY_APPROVED',
      });
    }

    // Only REJECTED requests can be updated
    const updated = await prisma.agencyRequest.update({
      where: { userId },
      data: {
        ...(agencyName && { agencyName }),
        ...(ownerName && { ownerName }),
        ...(phone && { phone }),
        ...(email !== undefined && { email }),
        ...(country !== undefined && { country }),
        ...(bio !== undefined && { bio }),
        ...(teamSize !== undefined && { teamSize }),
        ...(offeredServices !== undefined && { offeredServices }),
        ...(profileImage !== undefined && { profileImage }),
        ...(documents !== undefined && { documents }),
        status: 'PENDING', // Resubmit for review
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Agency request updated and resubmitted for review',
      data: updated,
    });
  } catch (err) {
    console.error('[PATCH /api/agency/my-request]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// UPLOAD DOCUMENT (multipart/form-data)
// ══════════════════════════════════════════════════════════════

router.post('/upload-document', authenticate, uploadService.single('document'), processUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    // uploadService should save to cloud storage and return URL
    const documentUrl = req.file.url || req.file.path;

    res.json({
      success: true,
      data: {
        url: documentUrl,
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error('[POST /api/agency/upload-document]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
