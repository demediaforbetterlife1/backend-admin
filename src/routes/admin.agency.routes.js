/**
 * Admin Agency Management Routes
 * 
 * GET    /api/admin/agencies         - List all agency requests
 * GET    /api/admin/agencies/:id     - Get agency request details
 * PATCH  /api/admin/agencies/:id/approve    - Approve agency request
 * PATCH  /api/admin/agencies/:id/reject     - Reject agency request
 * PATCH  /api/admin/agencies/:id/suspend    - Suspend approved agency
 * PATCH  /api/admin/agencies/:id/restore    - Restore suspended agency
 * DELETE /api/admin/agencies/:id            - Delete agency request (soft)
 */

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateAdmin, requireAdmin, requireSupport } = require('../middleware/adminAuthMiddleware');
const notificationService = require('../services/notification.service');

const router = express.Router();
const prisma = new PrismaClient();

// Apply authentication to all routes in this router
router.use((req, res, next) => {
  console.log('🎯 [admin.agency.routes.js] Route hit:', req.method, req.originalUrl);
  next();
});

router.use(authenticateAdmin);

// Helper for pagination
function paginate(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 50));
  const skip = (page - 1) * pageSize;
  return { skip, take: pageSize, page, pageSize };
}

// Helper for audit logging
async function audit(req, action, resource, resourceId, metadata = {}) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId: req.admin.id,
        action,
        resource,
        resourceId,
        metadata,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      },
    });
  } catch (err) {
    console.error('[Audit Log Error]', err);
  }
}

// ══════════════════════════════════════════════════════════════
// LIST AGENCY REQUESTS
// ══════════════════════════════════════════════════════════════

router.get('/', requireSupport, async (req, res) => {
  try {
    const { skip, take, page, pageSize } = paginate(req.query);
    const { status, q } = req.query;

    // ✅ FIX: Build where clause for both approved agencies (AGENCY_OWNER) AND pending agencies (USER with PENDING_APPROVAL)
    let userWhere = {
      OR: [
        { accountType: 'AGENCY_OWNER' }, // Approved agencies
        { 
          AND: [
            { status: 'PENDING_APPROVAL' },
            { agencyApproved: false }
          ]
        }, // Pending agencies
      ]
    };
    
    // Apply status filter
    if (status) {
      // Override OR clause with specific status filter
      if (status === 'PENDING') {
        userWhere = { status: 'PENDING_APPROVAL', agencyApproved: false };
      } else if (status === 'APPROVED') {
        userWhere = { accountType: 'AGENCY_OWNER', status: 'ACTIVE' };
      } else if (status === 'REJECTED') {
        userWhere = { status: 'REJECTED', agencyApproved: false };
      } else if (status === 'SUSPENDED') {
        userWhere = { accountType: 'AGENCY_OWNER', status: 'SUSPENDED' };
      } else if (status === 'BANNED') {
        userWhere = { accountType: 'AGENCY_OWNER', status: 'BANNED' };
      }
    }
    
    // Apply search query
    if (q) {
      // If already has specific status filter, add OR to it
      userWhere = {
        AND: [
          userWhere,
          {
            OR: [
              { agencyName: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
              { username: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ]
          }
        ]
      };
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: userWhere,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          displayName: true,
          email: true,
          phone: true,
          agencyName: true,
          teamSize: true,
          offeredServices: true,
          bio: true,
          avatar: true,
          accountType: true,
          agencyApproved: true,
          agencyApprovedAt: true,
          agencyApprovedBy: true,
          status: true,
          role: true,
          agentCode: true,
          createdAt: true,
          agencyRequest: {
            select: {
              id: true,
              status: true,
              rejectionReason: true,
              reviewedAt: true,
              documents: true,
              profileImage: true,
              country: true,
            },
          },
          ownedAgency: {
            select: {
              id: true,
              level: true,
              commissionRate: true,
              totalEarnings: true,
              _count: {
                select: {
                  memberships: {
                    where: {
                      role: 'MEMBER',
                      status: 'ACTIVE',
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.user.count({ where: userWhere }),
    ]);

    // Transform for frontend compatibility
    const data = users.map(u => {
      // Map User.status to AgencyRequest-like status for frontend
      let displayStatus = 'PENDING';
      if (u.status === 'ACTIVE') displayStatus = 'APPROVED';
      else if (u.status === 'REJECTED') displayStatus = 'REJECTED';
      else if (u.status === 'SUSPENDED') displayStatus = 'SUSPENDED';
      else if (u.status === 'BANNED') displayStatus = 'BANNED';
      else if (u.status === 'PENDING_APPROVAL') displayStatus = 'PENDING';

      // Get real agency data if exists
      const agency = u.ownedAgency;
      const hostsCount = agency?._count?.memberships || 0;
      const level = agency?.level || 'STANDARD';
      const commissionRate = agency?.commissionRate || 0;
      const totalEarnings = agency?.totalEarnings || 0;

      // Map AgencyLevel enum to Arabic display names
      const levelMap = {
        'STANDARD': 'عادي',
        'PREMIUM': 'فضي',
        'ELITE': 'ذهبي',
      };

      return {
        id: u.agencyRequest?.id || u.id, // Use AgencyRequest.id if exists, else User.id
        userId: u.id,
        name: u.agencyName || u.displayName || u.username,
        ownerName: u.displayName || u.username,
        phone: u.phone,
        email: u.email,
        country: u.agencyRequest?.country || null,
        bio: u.bio,
        teamSize: u.teamSize,
        offeredServices: u.offeredServices,
        profileImage: u.agencyRequest?.profileImage || u.avatar,
        documents: u.agencyRequest?.documents || [],
        status: displayStatus,
        rejectionReason: u.agencyRequest?.rejectionReason || null,
        notes: u.agencyRequest?.rejectionReason || null,
        createdAt: u.createdAt,
        reviewedAt: u.agencyRequest?.reviewedAt || u.agencyApprovedAt,
        hostsCount,
        level: levelMap[level] || 'عادي',
        commissionRate,
        totalEarnings,
        role: u.role,
        agentCode: u.agentCode,
        user: {
          id: u.id,
          username: u.username,
          email: u.email,
          phone: u.phone,
          accountType: u.accountType,
          agencyApproved: u.agencyApproved,
          status: u.status,
        },
        reviewedBy: null, // TODO: fetch if needed
      };
    });

    res.json({
      success: true,
      data,
      total,
      page,
      pageSize,
      pages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    console.error('[GET /api/admin/agencies]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET AGENCY REQUEST DETAILS
// ══════════════════════════════════════════════════════════════

router.get('/:id', requireSupport, async (req, res) => {
  try {
    const request = await prisma.agencyRequest.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            phone: true,
            avatar: true,
            accountType: true,
            agencyApproved: true,
            status: true,
            createdAt: true,
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
        error: 'Agency request not found',
      });
    }

    res.json({ success: true, data: request });
  } catch (err) {
    console.error('[GET /api/admin/agencies/:id]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// APPROVE AGENCY REQUEST
// ══════════════════════════════════════════════════════════════

router.patch('/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { notes } = req.body;
    const id = req.params.id;

    // Try to find as AgencyRequest first, then as User
    let request = await prisma.agencyRequest.findUnique({
      where: { id },
      include: { user: true },
    });

    let userId;
    if (request) {
      userId = request.userId;
    } else {
      // Not an AgencyRequest, try as User.id directly
      const user = await prisma.user.findUnique({
        where: { id, accountType: 'AGENCY' },
      });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'Agency or agent not found',
        });
      }
      userId = user.id;
    }

    // Check current status
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Prevent duplicate approval
    if (user.status === 'ACTIVE' && user.agencyApproved) {
      return res.status(400).json({
        success: false,
        error: 'Agency/Agent already approved',
      });
    }

    // Prevent approving rejected accounts (should use restore instead)
    if (user.status === 'REJECTED') {
      return res.status(400).json({
        success: false,
        error: 'Cannot approve rejected agency. Use restore endpoint instead.',
      });
    }

    // Start transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Update AgencyRequest if exists
      if (request) {
        await tx.agencyRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            reviewedBy: req.admin.id, // AdminAccount.id stored as string (no FK)
            reviewedAt: new Date(),
            rejectionReason: null,
          },
        });
      }

      // Update user account
      await tx.user.update({
        where: { id: userId },
        data: {
          accountType: 'AGENCY_OWNER', // IMPORTANT: Change to AGENCY_OWNER after approval
          agencyApproved: true,
          agencyApprovedAt: new Date(),
          agencyApprovedBy: null, // Cannot store AdminAccount.id here (no FK support)
          status: 'ACTIVE',
        },
      });

      // Create Agency entity from approved request
      if (request) {
        const existingAgency = await tx.agency.findUnique({
          where: { ownerId: userId },
        });

        if (!existingAgency) {
          await tx.agency.create({
            data: {
              ownerId: userId,
              name: request.agencyName,
              description: request.bio || null,
              country: request.country || null,
              profileImage: request.profileImage || user.avatar || null,
              documents: request.documents || [],
              teamSize: request.teamSize || null,
              offeredServices: request.offeredServices || [],
              level: 'STANDARD',
              commissionRate: 0.0,
              status: 'ACTIVE',
              totalEarnings: 0,
            },
          });
        }
      }
    });

    // Send notification to user
    try {
      await notificationService.sendNotification({
        userId,
        type: 'AGENCY_APPROVED',
        titleAr: 'تمت الموافقة على الحساب',
        bodyAr: user.role === 'AGENT' 
          ? `تم قبول طلبك كوكيل. يمكنك الآن استخدام جميع مزايا الوكالة.`
          : `تم قبول طلب تسجيل وكالة "${request?.agencyName || user.agencyName}". يمكنك الآن استخدام مزايا الوكالة.`,
        data: {
          requestId: id,
          agencyName: request?.agencyName || user.agencyName,
          approvedAt: new Date().toISOString(),
        },
      });
    } catch (notifErr) {
      console.error('[Notification Error]', notifErr);
    }

    // Log audit
    await audit(req, 'APPROVE_AGENCY', 'agency', id, {
      agencyName: request?.agencyName || user.agencyName,
      userId,
      notes,
    });

    res.json({
      success: true,
      message: 'Agency/Agent approved successfully',
    });
  } catch (err) {
    console.error('[PATCH /api/admin/agencies/:id/approve]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// REJECT AGENCY REQUEST
// ══════════════════════════════════════════════════════════════

router.patch('/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const id = req.params.id;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Rejection reason is required',
      });
    }

    // Try to find as AgencyRequest first, then as User
    let request = await prisma.agencyRequest.findUnique({
      where: { id },
    });

    let userId;
    if (request) {
      userId = request.userId;
    } else {
      // Not an AgencyRequest, try as User.id directly
      const user = await prisma.user.findUnique({
        where: { id, accountType: 'AGENCY' },
      });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'Agency or agent not found',
        });
      }
      userId = user.id;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Check if already rejected
    if (user.status === 'REJECTED') {
      return res.status(400).json({
        success: false,
        error: 'Agency/Agent already rejected',
      });
    }

    // Start transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Update AgencyRequest if exists
      if (request) {
        await tx.agencyRequest.update({
          where: { id },
          data: {
            status: 'REJECTED',
            rejectionReason: reason,
            reviewedBy: req.admin.id, // AdminAccount.id stored as string (no FK)
            reviewedAt: new Date(),
          },
        });
      }

      // Update user status
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'REJECTED',
          agencyApproved: false,
        },
      });
    });

    // Send notification to user
    try {
      await notificationService.sendNotification({
        userId,
        type: 'AGENCY_REJECTED',
        titleAr: 'تم رفض الطلب',
        bodyAr: user.role === 'AGENT'
          ? `تم رفض طلبك كوكيل. السبب: ${reason}`
          : `تم رفض طلب تسجيل وكالة "${request?.agencyName || user.agencyName}". السبب: ${reason}`,
        data: {
          requestId: id,
          agencyName: request?.agencyName || user.agencyName,
          rejectionReason: reason,
          rejectedAt: new Date().toISOString(),
        },
      });
    } catch (notifErr) {
      console.error('[Notification Error]', notifErr);
    }

    // Log audit
    await audit(req, 'REJECT_AGENCY', 'agency', id, {
      agencyName: request?.agencyName || user.agencyName,
      userId,
      reason,
    });

    res.json({
      success: true,
      message: 'Agency/Agent rejected successfully',
    });
  } catch (err) {
    console.error('[PATCH /api/admin/agencies/:id/reject]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// SUSPEND APPROVED AGENCY
// ══════════════════════════════════════════════════════════════

router.patch('/:id/suspend', requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const requestId = req.params.id;

    const request = await prisma.agencyRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Agency request not found',
      });
    }

    if (request.status !== 'APPROVED') {
      return res.status(400).json({
        success: false,
        error: 'Can only suspend approved agencies',
      });
    }

    // Update user status
    await prisma.user.update({
      where: { id: request.userId },
      data: {
        status: 'SUSPENDED',
        agencyApproved: false,
      },
    });

    // Send notification
    try {
      await notificationService.sendNotification({
        userId: request.userId,
        type: 'AGENCY_SUSPENDED',
        titleAr: 'تم إيقاف الوكالة',
        bodyAr: `تم إيقاف وكالة "${request.agencyName}" مؤقتاً.${reason ? ` السبب: ${reason}` : ''}`,
        data: {
          agencyRequestId: requestId,
          agencyName: request.agencyName,
          reason,
          suspendedAt: new Date().toISOString(),
        },
      });
    } catch (notifErr) {
      console.error('[Notification Error]', notifErr);
    }

    // Log audit
    await audit(req, 'SUSPEND_AGENCY', 'agency_request', requestId, {
      agencyName: request.agencyName,
      userId: request.userId,
      reason,
    });

    res.json({
      success: true,
      message: 'Agency suspended successfully',
    });
  } catch (err) {
    console.error('[PATCH /api/admin/agencies/:id/suspend]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// RESTORE SUSPENDED/REJECTED AGENCY
// ══════════════════════════════════════════════════════════════

router.patch('/:id/restore', requireAdmin, async (req, res) => {
  try {
    const requestId = req.params.id;

    const request = await prisma.agencyRequest.findUnique({
      where: { id: requestId },
      include: { user: true },
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Agency request not found',
      });
    }

    // Validate that agency is suspended or rejected
    if (!['SUSPENDED', 'REJECTED'].includes(request.user.status)) {
      return res.status(400).json({
        success: false,
        error: 'Can only restore suspended or rejected agencies',
      });
    }

    // Start transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Update request status to APPROVED
      await tx.agencyRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewedBy: req.admin.id, // AdminAccount.id stored as string (no FK)
          reviewedAt: new Date(),
          rejectionReason: null,
        },
      });

      // Update user status
      await tx.user.update({
        where: { id: request.userId },
        data: {
          status: 'ACTIVE',
          agencyApproved: true,
          agencyApprovedAt: new Date(),
          agencyApprovedBy: null, // Cannot store AdminAccount.id (no FK support)
        },
      });

      // Create or update Agency entity if needed
      const existingAgency = await tx.agency.findUnique({
        where: { ownerId: request.userId },
      });

      if (!existingAgency) {
        await tx.agency.create({
          data: {
            ownerId: request.userId,
            name: request.agencyName,
            description: request.bio || null,
            country: request.country || null,
            profileImage: request.profileImage || request.user.avatar || null,
            documents: request.documents || [],
            teamSize: request.teamSize || null,
            offeredServices: request.offeredServices || [],
            level: 'STANDARD',
            commissionRate: 0.0,
            status: 'ACTIVE',
            totalEarnings: 0,
          },
        });
      } else if (existingAgency.status !== 'ACTIVE') {
        // Reactivate suspended agency
        await tx.agency.update({
          where: { id: existingAgency.id },
          data: { status: 'ACTIVE' },
        });
      }
    });

    // Send notification
    try {
      await notificationService.sendNotification({
        userId: request.userId,
        type: 'AGENCY_APPROVED',
        titleAr: 'تم استعادة الوكالة',
        bodyAr: `تم استعادة وكالة "${request.agencyName}" وتفعيلها بنجاح.`,
        data: {
          agencyRequestId: requestId,
          agencyName: request.agencyName,
          restoredAt: new Date().toISOString(),
        },
      });
    } catch (notifErr) {
      console.error('[Notification Error]', notifErr);
    }

    // Log audit
    await audit(req, 'RESTORE_AGENCY', 'agency_request', requestId, {
      agencyName: request.agencyName,
      userId: request.userId,
    });

    res.json({
      success: true,
      message: 'Agency restored successfully',
    });
  } catch (err) {
    console.error('[PATCH /api/admin/agencies/:id/restore]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

module.exports = router;
