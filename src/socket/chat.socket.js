/**
 * Chat Socket Handler
 *
 * Handles real-time chat events:
 * - Typing indicators
 * - Online status
 * - Message delivery/read receipts
 * - Message reactions
 */

const prisma = require('../prismaClient');
const { socketAuthMiddleware } = require('../middleware/socketAuth');
const moderationService = require('../services/moderation.service');

// Track online users
const onlineUsers = new Map();
// Track user sockets
const userSockets = new Map();
// Track typing status per conversation
const typingUsers = new Map();

// Rate limiting
const socketRateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 10 * 1000; // 10 seconds
const RATE_LIMIT_MAX_MESSAGES = 30; // max 30 messages per 10 seconds

// Cleanup stale rate-limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [socketId, entry] of socketRateLimits.entries()) {
    if (now > entry.resetAt) socketRateLimits.delete(socketId);
  }
}, 5 * 60 * 1000);

function checkMessageRateLimit(socketId) {
  const now = Date.now();
  const entry = socketRateLimits.get(socketId);

  if (!entry || now > entry.resetAt) {
    socketRateLimits.set(socketId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_MESSAGES) {
    return false;
  }

  entry.count++;
  return true;
}

function registerChatSocket(io) {
  const chatNamespace = io.of('/chat');
  chatNamespace.use(socketAuthMiddleware);

  chatNamespace.on('connection', (socket) => {
    const userId = socket.data.userId;
    console.log(`User connected to /chat: ${socket.id} (${userId})`);

    // Add user to online users and track their socket
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
      onlineUsers.set(userId, {
        online: true,
        lastSeen: new Date(),
      });
      // Notify all that user is online
      chatNamespace.emit('user-online', { userId, online: true, lastSeen: new Date() });
    }
    userSockets.get(userId).add(socket);

    // ── join-conversation ─────────────────────────────────────────────────────────
    socket.on('join-conversation', async (data) => {
      const { conversationId } = data || {};
      if (!conversationId) {
        socket.emit('error', { message: 'Conversation ID required' });
        return;
      }

      try {
        // Verify user is a member of the conversation
        const member = await prisma.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId,
              userId,
            },
          },
        });

        if (!member) {
          socket.emit('error', { message: 'Not a member of this conversation' });
          return;
        }

        socket.join(`conversation:${conversationId}`);
        console.log(`User ${userId} joined conversation ${conversationId}`);

        // Mark messages as read up to now (optional, can be removed or handled differently)
        // For now, skip this to avoid errors, we can add it properly later if needed
        console.log(`User ${userId} joined conversation ${conversationId}`);
      } catch (error) {
        console.error('Error joining conversation:', error);
        socket.emit('error', { message: error.message });
      }
    });

    // ── leave-conversation ────────────────────────────────────────────────────────
    socket.on('leave-conversation', async (data) => {
      const { conversationId } = data || {};
      if (!conversationId) return;

      socket.leave(`conversation:${conversationId}`);
      console.log(`User ${userId} left conversation ${conversationId}`);
    });

    // ── typing-start ─────────────────────────────────────────────────────────────
    socket.on('typing-start', async (data) => {
      const { conversationId } = data || {};
      if (!conversationId) return;

      const key = `${conversationId}:${userId}`;
      typingUsers.set(key, { userId, startedAt: Date.now() });

      socket.to(`conversation:${conversationId}`).emit('typing-indicator', {
        userId,
        isTyping: true,
      });
    });

    // ── typing-stop ──────────────────────────────────────────────────────────────
    socket.on('typing-stop', async (data) => {
      const { conversationId } = data || {};
      if (!conversationId) return;

      const key = `${conversationId}:${userId}`;
      typingUsers.delete(key);

      socket.to(`conversation:${conversationId}`).emit('typing-indicator', {
        userId,
        isTyping: false,
      });
    });

    // ── send-message ─────────────────────────────────────────────────────────────
    socket.on('send-message', async (data) => {
      const { conversationId, text, type = 'TEXT', replyToId, attachments = [] } = data || {};
      if (!conversationId) {
        socket.emit('error', { message: 'Conversation ID required' });
        return;
      }

      // Rate limit
      if (!checkMessageRateLimit(socket.id)) {
        socket.emit('error', { message: 'Too many messages — please slow down' });
        return;
      }

      try {
        // Verify user is a member
        const member = await prisma.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId,
              userId,
            },
          },
        });

        if (!member) {
          socket.emit('error', { message: 'Not a member of this conversation' });
          return;
        }

        // Moderate text if provided
        let filteredText = text;
        if (text) {
          const moderationResult = await moderationService.filterMessage(text);
          if (moderationResult.blocked) {
            await moderationService.handleViolation(userId, moderationResult.severity, null);
            socket.emit('message-blocked', { reason: moderationResult.reason });
            return;
          }
          filteredText = moderationResult.filtered;
        }

        // Create message in DB
        const message = await prisma.chatMessage.create({
          data: {
            conversationId,
            senderId: userId,
            text: filteredText,
            type,
            replyToId,
            status: 'SENT',
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
            replyTo: { include: { sender: { select: { id: true, username: true } } } },
          },
        });

        // Broadcast message to conversation
        chatNamespace.to(`conversation:${conversationId}`).emit('new-message', {
          id: message.id,
          conversationId,
          senderId: message.senderId,
          sender: message.sender,
          text: message.text,
          type: message.type,
          replyTo: message.replyTo,
          attachments: message.attachments,
          status: message.status,
          createdAt: message.createdAt,
        });

        // Update last message on conversation
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: error.message });
      }
    });

    // ── mark-read ─────────────────────────────────────────────────────────────────
    socket.on('mark-read', async (data) => {
      const { conversationId, messageId } = data || {};
      if (!conversationId) return;

      try {
        // Mark all unread messages up to this one as read
        const latestMessage = messageId
          ? await prisma.chatMessage.findUnique({ where: { id: messageId } })
          : await prisma.chatMessage.findFirst({
              where: { conversationId },
              orderBy: { createdAt: 'desc' },
            });

        if (!latestMessage) return;

        // Get all messages not yet read by user in conversation
        const unreadMessages = await prisma.chatMessage.findMany({
          where: {
            conversationId,
            createdAt: { lte: latestMessage.createdAt },
            senderId: { not: userId },
            reads: { none: { userId } },
          },
          select: { id: true },
        });

        if (unreadMessages.length > 0) {
          await prisma.messageRead.createMany({
            data: unreadMessages.map(m => ({
              messageId: m.id,
              userId,
            })),
            skipDuplicates: true,
          });

          // Broadcast read receipt
          chatNamespace.to(`conversation:${conversationId}`).emit('message-read', {
            userId,
            messageIds: unreadMessages.map(m => m.id),
            readAt: new Date(),
          });
        }
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    });

    // ── add-reaction ─────────────────────────────────────────────────────────────
    socket.on('add-reaction', async (data) => {
      const { messageId, emoji } = data || {};
      if (!messageId || !emoji) return;

      try {
        const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
        if (!message) return;

        // Verify user is a member of the conversation
        const member = await prisma.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId: message.conversationId,
              userId,
            },
          },
        });

        if (!member) return;

        // Create or update reaction
        const reaction = await prisma.messageReaction.upsert({
          where: {
            messageId_userId_emoji: { messageId, userId, emoji },
          },
          create: { messageId, userId, emoji },
          update: {},
        });

        chatNamespace.to(`conversation:${message.conversationId}`).emit('reaction-added', {
          id: reaction.id,
          messageId,
          userId,
          emoji,
          createdAt: reaction.createdAt,
        });
      } catch (error) {
        console.error('Error adding reaction:', error);
      }
    });

    // ── remove-reaction ──────────────────────────────────────────────────────────
    socket.on('remove-reaction', async (data) => {
      const { messageId, emoji } = data || {};
      if (!messageId || !emoji) return;

      try {
        const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
        if (!message) return;

        await prisma.messageReaction.deleteMany({
          where: { messageId, userId, emoji },
        });

        chatNamespace.to(`conversation:${message.conversationId}`).emit('reaction-removed', {
          messageId,
          userId,
          emoji,
        });
      } catch (error) {
        console.error('Error removing reaction:', error);
      }
    });

    // ── delete-message ───────────────────────────────────────────────────────────
    socket.on('delete-message', async (data) => {
      const { messageId } = data || {};
      if (!messageId) return;

      try {
        const message = await prisma.chatMessage.findUnique({
          where: { id: messageId },
          include: { conversation: true },
        });

        if (!message) return;

        // Verify user is sender or has admin permissions
        const member = await prisma.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId: message.conversationId,
              userId,
            },
          },
        });

        const isSender = message.senderId === userId;
        const isAdmin = member && (member.role === 'ADMIN' || member.role === 'OWNER');

        if (!isSender && !isAdmin) {
          socket.emit('error', { message: 'Not authorized to delete this message' });
          return;
        }

        await prisma.chatMessage.update({
          where: { id: messageId },
          data: { isDeleted: true, deletedAt: new Date() },
        });

        chatNamespace.to(`conversation:${message.conversationId}`).emit('message-deleted', {
          messageId,
          deletedAt: new Date(),
        });
      } catch (error) {
        console.error('Error deleting message:', error);
      }
    });

    // ── disconnect ────────────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`User disconnected from /chat: ${socket.id}`);

      // Clean up rate limit entry
      socketRateLimits.delete(socket.id);

      // Remove socket from user sockets
      if (userSockets.has(userId)) {
        userSockets.get(userId).delete(socket);

        // If user has no more sockets, mark them as offline
        if (userSockets.get(userId).size === 0) {
          userSockets.delete(userId);
          onlineUsers.set(userId, {
            online: false,
            lastSeen: new Date(),
          });
          chatNamespace.emit('user-online', {
            userId,
            online: false,
            lastSeen: new Date(),
          });
        }
      }
    });
  });
}

module.exports = { registerChatSocket };
