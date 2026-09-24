/**
 * Agency Service
 * 
 * Handles agency business logic including:
 * - Fetching agency details with real stats
 * - Member management (invite, accept, reject, remove)
 * - Earnings calculations
 * - Authorization checks
 */

const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

/**
 * Get agency owned by a specific user
 * @param {string} userId - User ID of the agency owner
 * @returns {Promise<Object|null>} Agency with computed stats
 */
async function getAgencyByOwnerId(userId) {
  const agency = await prisma.agency.findUnique({
    where: { ownerId: userId },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
          email: true,
          phone: true,
        },
      },
      memberships: {
        where: { status: 'ACTIVE' },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
              role: true,
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
      },
    },
  });

  if (!agency) {
    return null;
  }

  // Calculate real stats
  const activeMembersCount = agency.memberships.length;
  const pendingMembersCount = await prisma.agencyMembership.count({
    where: { agencyId: agency.id, status: 'PENDING' },
  });
  const totalMembersCount = activeMembersCount + pendingMembersCount;

  // Get agency level info
  const levelInfo = {
    STANDARD: { name: 'Standard', tier: 1, color: '#808080' },
    PREMIUM: { name: 'Premium', tier: 2, color: '#C0C0C0' },
    ELITE: { name: 'Elite', tier: 3, color: '#FFD700' },
  };

  return {
    ...agency,
    stats: {
      activeMembersCount,
      pendingMembersCount,
      totalMembersCount,
      level: levelInfo[agency.level] || levelInfo.STANDARD,
    },
  };
}

/**
 * Get agency by ID (with authorization check)
 * @param {string} agencyId - Agency ID
 * @param {string} requestingUserId - User making the request
 * @returns {Promise<Object>} Agency with stats
 */
async function getAgencyById(agencyId, requestingUserId) {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
        },
      },
    },
  });

  if (!agency) {
    throw new Error('Agency not found');
  }

  // Check authorization: only owner can view full details
  if (agency.ownerId !== requestingUserId) {
    throw new Error('Not authorized to view this agency');
  }

  return getAgencyByOwnerId(agency.ownerId);
}

/**
 * List all members of an agency
 * @param {string} agencyId - Agency ID
 * @param {string} requestingUserId - User making the request
 * @param {Object} options - Query options (status filter, pagination)
 * @returns {Promise<Array>} List of members
 */
async function getAgencyMembers(agencyId, requestingUserId, options = {}) {
  // Verify ownership
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
  });

  if (!agency) {
    throw new Error('Agency not found');
  }

  if (agency.ownerId !== requestingUserId) {
    throw new Error('Not authorized to view agency members');
  }

  const { status, limit = 50, offset = 0 } = options;

  const where = { agencyId };
  if (status) {
    where.status = status;
  }

  const memberships = await prisma.agencyMembership.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
          role: true,
          email: true,
          phone: true,
        },
      },
      inviter: {
        select: {
          id: true,
          username: true,
          displayName: true,
        },
      },
    },
    orderBy: [
      { status: 'asc' }, // PENDING first
      { invitedAt: 'desc' },
    ],
    take: limit,
    skip: offset,
  });

  return memberships;
}

/**
 * Invite a user to join an agency
 * @param {string} agencyId - Agency ID
 * @param {string} inviterId - User ID of person sending invite
 * @param {string} identifier - Username, email, or userId of person to invite
 * @returns {Promise<Object>} Created membership
 */
async function inviteMember(agencyId, inviterId, identifier) {
  // Verify agency exists and inviter is owner
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
  });

  if (!agency) {
    throw new Error('Agency not found');
  }

  if (agency.ownerId !== inviterId) {
    throw new Error('Only agency owner can invite members');
  }

  // Find user by username, email, or ID
  const targetUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: identifier },
        { email: identifier },
        { id: identifier },
      ],
    },
  });

  if (!targetUser) {
    throw new Error('User not found');
  }

  // Check if user is the owner
  if (targetUser.id === agency.ownerId) {
    throw new Error('Cannot invite agency owner as member');
  }

  // Check if membership already exists
  const existingMembership = await prisma.agencyMembership.findUnique({
    where: {
      agencyId_userId: {
        agencyId,
        userId: targetUser.id,
      },
    },
  });

  if (existingMembership) {
    if (existingMembership.status === 'PENDING') {
      throw new Error('Invitation already sent to this user');
    }
    if (existingMembership.status === 'ACTIVE') {
      throw new Error('User is already a member');
    }
    if (existingMembership.status === 'REJECTED') {
      // Allow re-invitation after rejection
      const updated = await prisma.agencyMembership.update({
        where: { id: existingMembership.id },
        data: {
          status: 'PENDING',
          invitedAt: new Date(),
          invitedBy: inviterId,
          joinedAt: null,
          leftAt: null,
        },
      });
      
      // Send notification
      await sendInvitationNotification(targetUser.id, agency, inviterId);
      
      return updated;
    }
  }

  // Create new membership invitation
  const membership = await prisma.agencyMembership.create({
    data: {
      agencyId,
      userId: targetUser.id,
      invitedBy: inviterId,
      role: 'MEMBER',
      status: 'PENDING',
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
        },
      },
    },
  });

  // Send notification to invited user
  await sendInvitationNotification(targetUser.id, agency, inviterId);

  // Log audit trail
  await prisma.auditLog.create({
    data: {
      userId: inviterId,
      action: 'AGENCY_MEMBER_INVITED',
      metadata: {
        agencyId,
        agencyName: agency.name,
        invitedUserId: targetUser.id,
        invitedUsername: targetUser.username,
      },
    },
  });

  return membership;
}

/**
 * Accept agency invitation (user action)
 * @param {string} membershipId - Membership ID
 * @param {string} userId - User accepting the invitation
 * @returns {Promise<Object>} Updated membership
 */
async function acceptInvitation(membershipId, userId) {
  const membership = await prisma.agencyMembership.findUnique({
    where: { id: membershipId },
    include: { agency: true },
  });

  if (!membership) {
    throw new Error('Invitation not found');
  }

  if (membership.userId !== userId) {
    throw new Error('Not authorized to accept this invitation');
  }

  if (membership.status !== 'PENDING') {
    throw new Error('Invitation is not pending');
  }

  const updated = await prisma.agencyMembership.update({
    where: { id: membershipId },
    data: {
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });

  // Notify agency owner
  await prisma.notification.create({
    data: {
      id: uuidv4(),
      userId: membership.agency.ownerId,
      type: 'SYSTEM',
      titleAr: 'عضو جديد انضم للوكالة',
      bodyAr: `قبل المستخدم @${membership.agency.owner?.username || 'user'} الانضمام إلى وكالة "${membership.agency.name}"`,
      data: { agencyId: membership.agencyId, membershipId },
    },
  });

  // Log audit trail
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'AGENCY_MEMBER_JOINED',
      metadata: {
        agencyId: membership.agencyId,
        membershipId,
      },
    },
  });

  return updated;
}

/**
 * Reject agency invitation (user action)
 * @param {string} membershipId - Membership ID
 * @param {string} userId - User rejecting the invitation
 * @returns {Promise<Object>} Updated membership
 */
async function rejectInvitation(membershipId, userId) {
  const membership = await prisma.agencyMembership.findUnique({
    where: { id: membershipId },
    include: { agency: true },
  });

  if (!membership) {
    throw new Error('Invitation not found');
  }

  if (membership.userId !== userId) {
    throw new Error('Not authorized to reject this invitation');
  }

  if (membership.status !== 'PENDING') {
    throw new Error('Invitation is not pending');
  }

  const updated = await prisma.agencyMembership.update({
    where: { id: membershipId },
    data: {
      status: 'REJECTED',
    },
  });

  // Notify agency owner (optional, might be too noisy)
  // Can be enabled if needed

  return updated;
}

/**
 * Remove member from agency (owner action)
 * @param {string} membershipId - Membership ID
 * @param {string} ownerId - Agency owner ID
 * @returns {Promise<Object>} Updated membership
 */
async function removeMember(membershipId, ownerId) {
  const membership = await prisma.agencyMembership.findUnique({
    where: { id: membershipId },
    include: { agency: true, user: true },
  });

  if (!membership) {
    throw new Error('Membership not found');
  }

  if (membership.agency.ownerId !== ownerId) {
    throw new Error('Only agency owner can remove members');
  }

  if (membership.status !== 'ACTIVE' && membership.status !== 'PENDING') {
    throw new Error('Cannot remove this member');
  }

  const updated = await prisma.agencyMembership.update({
    where: { id: membershipId },
    data: {
      status: 'REMOVED',
      leftAt: new Date(),
    },
  });

  // Notify removed user
  await prisma.notification.create({
    data: {
      id: uuidv4(),
      userId: membership.userId,
      type: 'SYSTEM',
      titleAr: 'تمت إزالتك من الوكالة',
      bodyAr: `تمت إزالتك من وكالة "${membership.agency.name}"`,
      data: { agencyId: membership.agencyId },
    },
  });

  // Log audit trail
  await prisma.auditLog.create({
    data: {
      userId: ownerId,
      action: 'AGENCY_MEMBER_REMOVED',
      metadata: {
        agencyId: membership.agencyId,
        removedUserId: membership.userId,
        removedUsername: membership.user.username,
      },
    },
  });

  return updated;
}

/**
 * Get user's agency invitations (pending invites sent to them)
 * @param {string} userId - User ID
 * @returns {Promise<Array>} List of pending invitations
 */
async function getUserInvitations(userId) {
  const invitations = await prisma.agencyMembership.findMany({
    where: {
      userId,
      status: 'PENDING',
    },
    include: {
      agency: {
        select: {
          id: true,
          name: true,
          description: true,
          profileImage: true,
          level: true,
          owner: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
      },
      inviter: {
        select: {
          id: true,
          username: true,
          displayName: true,
        },
      },
    },
    orderBy: { invitedAt: 'desc' },
  });

  return invitations;
}

/**
 * Update agency details (owner only)
 * @param {string} agencyId - Agency ID
 * @param {string} ownerId - Owner user ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated agency
 */
async function updateAgency(agencyId, ownerId, updates) {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
  });

  if (!agency) {
    throw new Error('Agency not found');
  }

  if (agency.ownerId !== ownerId) {
    throw new Error('Only agency owner can update details');
  }

  const allowedFields = [
    'description',
    'profileImage',
    'teamSize',
    'offeredServices',
    'country',
  ];

  const updateData = {};
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      updateData[field] = updates[field];
    }
  }

  const updated = await prisma.agency.update({
    where: { id: agencyId },
    data: updateData,
  });

  return updated;
}

/**
 * Get agency earnings breakdown with real calculations
 * @param {string} agencyId - Agency ID
 * @param {string} ownerId - Owner user ID
 * @returns {Promise<Object>} Earnings data
 */
async function getAgencyEarnings(agencyId, ownerId) {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    include: {
      memberships: {
        where: { status: 'ACTIVE' },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
      },
    },
  });

  if (!agency) {
    throw new Error('Agency not found');
  }

  if (agency.ownerId !== ownerId) {
    throw new Error('Not authorized to view earnings');
  }

  // Get all member user IDs
  const memberUserIds = agency.memberships.map(m => m.userId);

  // Calculate earnings from gifts received by agency members
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  // Get gift transactions where receiver is an agency member
  const [
    totalGifts,
    monthlyGifts,
    lastMonthGifts,
    giftsByMember,
  ] = await Promise.all([
    // Total all-time gifts
    prisma.giftTransaction.aggregate({
      where: {
        receiverId: { in: memberUserIds },
      },
      _sum: { totalCoins: true },
    }),

    // Current month gifts
    prisma.giftTransaction.aggregate({
      where: {
        receiverId: { in: memberUserIds },
        createdAt: { gte: startOfMonth },
      },
      _sum: { totalCoins: true },
    }),

    // Last month gifts
    prisma.giftTransaction.aggregate({
      where: {
        receiverId: { in: memberUserIds },
        createdAt: {
          gte: startOfLastMonth,
          lte: endOfLastMonth,
        },
      },
      _sum: { totalCoins: true },
    }),

    // Breakdown by member
    prisma.giftTransaction.groupBy({
      by: ['receiverId'],
      where: {
        receiverId: { in: memberUserIds },
      },
      _sum: { totalCoins: true },
      _count: { id: true },
    }),
  ]);

  // Calculate agency commission
  const rate = agency.commissionRate;
  const totalEarnings = totalGifts._sum.totalCoins || 0;
  const monthlyEarnings = monthlyGifts._sum.totalCoins || 0;
  const lastMonthEarnings = lastMonthGifts._sum.totalCoins || 0;

  const totalCommission = Math.floor(totalEarnings * rate);
  const monthlyCommission = Math.floor(monthlyEarnings * rate);
  const lastMonthCommission = Math.floor(lastMonthEarnings * rate);

  // Map member earnings
  const byMember = giftsByMember.map(item => {
    const member = agency.memberships.find(m => m.userId === item.receiverId);
    const memberEarnings = item._sum.totalCoins || 0;
    const memberCommission = Math.floor(memberEarnings * rate);

    return {
      userId: item.receiverId,
      username: member?.user.username || 'Unknown',
      displayName: member?.user.displayName || member?.user.username || 'Unknown',
      avatar: member?.user.avatar,
      totalEarnings: memberEarnings,
      agencyCommission: memberCommission,
      giftsCount: item._count.id,
    };
  }).sort((a, b) => b.totalEarnings - a.totalEarnings);

  return {
    total: totalCommission,
    monthly: monthlyCommission,
    lastMonth: lastMonthCommission,
    commission_rate: rate,
    totalGrossEarnings: totalEarnings,
    monthlyGrossEarnings: monthlyEarnings,
    byMember,
  };
}

/**
 * Send invitation notification (internal helper)
 */
async function sendInvitationNotification(userId, agency, inviterId) {
  const inviter = await prisma.user.findUnique({
    where: { id: inviterId },
    select: { username: true, displayName: true },
  });

  await prisma.notification.create({
    data: {
      id: uuidv4(),
      userId,
      type: 'SYSTEM',
      titleAr: 'دعوة للانضمام إلى وكالة',
      bodyAr: `دعاك ${inviter?.displayName || inviter?.username || 'مستخدم'} للانضمام إلى وكالة "${agency.name}"`,
      data: {
        agencyId: agency.id,
        agencyName: agency.name,
        inviterId,
      },
    },
  });
}

module.exports = {
  getAgencyByOwnerId,
  getAgencyById,
  getAgencyMembers,
  inviteMember,
  acceptInvitation,
  rejectInvitation,
  removeMember,
  getUserInvitations,
  updateAgency,
  getAgencyEarnings,
};
