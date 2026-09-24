/**
 * Chat Routes
 * Handles all REST API endpoints for chat functionality
 */

const express = require('express');
const prisma = require('../prismaClient');
const { authenticate, requireAgencyApproved } = require('../middleware/authMiddleware');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');

const router = express.Router();

// ------------------------------
// Conversations
// ------------------------------

// Get all conversations for current user
router.get('/conversations', authenticate, requireAgencyApproved, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const conversations = await prisma.conversation.findMany({
    where: {
      members: {
        some: { userId },
      },
      isActive: true,
    },
    include: {
      members: {
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  sendSuccess(res, conversations, 200, 'Conversations retrieved');
}));

// Get a single conversation
router.get('/conversations/:id', authenticate, requireAgencyApproved, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          sender: { select: { id: true, username: true, avatar: true } },
          attachments: true,
          reads: { select: { userId: true, readAt: true } },
          reactions: {
            include: { user: { select: { id: true, username: true } } },
          },
          replyTo: {
            include: { sender: { select: { id: true, username: true } } },
          },
        },
      },
    },
  });

  // Verify user is a member
  const isMember = conversation?.members.some(m => m.userId === userId);
  if (!isMember) {
    return sendError(res, 'Not a member of this conversation', 403);
  }

  sendSuccess(res, conversation, 200, 'Conversation retrieved');
}));

// Create a new conversation
router.post('/conversations', authenticate, requireAgencyApproved, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { type, name, description, memberIds, roomId, agencyId } = req.body;

  // Validate required fields
  if (!type) {
    return sendError(res, 'Conversation type is required', 400);
  }

  // For private chats, we need exactly 2 members (including self)
  if (type === 'PRIVATE' && (!memberIds || memberIds.length !== 1)) {
    return sendError(res, 'Private chats require exactly one other user', 400);
  }

  // If room chat, validate roomId
  if (type === 'ROOM' && !roomId) {
    return sendError(res, 'Room ID is required for room chats', 400);
  }

  // Prepare members array
  const allMemberIds = [...new Set([userId, ...(memberIds || [])])];

  const conversation = await prisma.conversation.create({
    data: {
      type,
      name,
      description,
      roomId,
      agencyId,
      members: {
        create: allMemberIds.map((mid, index) => ({
          userId: mid,
          role: index === 0 ? 'OWNER' : 'MEMBER',
        })),
      },
    },
    include: {
      members: {
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
      },
    },
  });

  sendSuccess(res, conversation, 201, 'Conversation created');
}));

// ------------------------------
// Messages
// ------------------------------

// Get messages for a conversation (paginated)
router.get('/conversations/:id/messages', authenticate, requireAgencyApproved, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { limit = 50, before } = req.query;

  // Verify user is a member
  const member = await prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId: id,
        userId,
      },
    },
  });

  if (!member) {
    return sendError(res, 'Not a member of this conversation', 403);
  }

  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId: id,
      isDeleted: false,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    include: {
      sender: { select: { id: true, username: true, avatar: true } },
      attachments: true,
      reads: { select: { userId: true, readAt: true } },
      reactions: {
        include: { user: { select: { id: true, username: true } } },
      },
      replyTo: {
        include: { sender: { select: { id: true, username: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });

  sendSuccess(res, messages.reverse(), 200, 'Messages retrieved'); // Reverse to get ascending order
}));

// Send a message (REST fallback, socket is preferred)
router.post('/conversations/:id/messages', authenticate, requireAgencyApproved, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { text, type = 'TEXT', replyToId, attachments = [] } = req.body;

  // Verify user is a member
  const member = await prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId: id,
        userId,
      },
    },
  });

  if (!member) {
    return sendError(res, 'Not a member of this conversation', 403);
  }

  const message = await prisma.chatMessage.create({
    data: {
      conversationId: id,
      senderId: userId,
      text,
      type,
      replyToId,
      attachments: attachments.length > 0 ? {
        createMany: {
          data: attachments.map(att => ({
            type: att.type,
            url: att.url,
            thumbnail: att.thumbnail,
            sizeBytes: att.sizeBytes,
            durationSecs: att.durationSecs,
          })),
        },
      } : undefined,
    },
    include: {
      sender: { select: { id: true, username: true, avatar: true } },
      attachments: true,
      replyTo: {
        include: { sender: { select: { id: true, username: true } } },
      },
    },
  });

  // Update conversation last updated
  await prisma.conversation.update({
    where: { id },
    data: { updatedAt: new Date() },
  });

  sendSuccess(res, message, 201, 'Message sent');
}));

// ------------------------------
// Block Users
// ------------------------------

// Block a user
router.post('/block/:userId', authenticate, requireAgencyApproved, asyncHandler(async (req, res) => {
  const blockerId = req.user.id;
  const { userId: blockedId } = req.params;

  if (blockerId === blockedId) {
    return sendError(res, 'Cannot block yourself', 400);
  }

  const blockedUser = await prisma.blockedUser.upsert({
    where: {
      blockerId_blockedId: { blockerId, blockedId },
    },
    create: { blockerId, blockedId },
    update: {},
  });

  sendSuccess(res, blockedUser, 200, 'User blocked');
}));

// Unblock a user
router.delete('/block/:userId', authenticate, requireAgencyApproved, asyncHandler(async (req, res) => {
  const blockerId = req.user.id;
  const { userId: blockedId } = req.params;

  await prisma.blockedUser.deleteMany({
    where: { blockerId, blockedId },
  });

  sendSuccess(res, {}, 200, 'User unblocked');
}));

// Get blocked users
router.get('/blocked', authenticate, requireAgencyApproved, asyncHandler(async (req, res) => {
  const blockerId = req.user.id;

  const blockedUsers = await prisma.blockedUser.findMany({
    where: { blockerId },
    include: {
      blocked: { select: { id: true, username: true, avatar: true } },
    },
  });

  sendSuccess(res, blockedUsers, 200, 'Blocked users retrieved');
}));

module.exports = router;
