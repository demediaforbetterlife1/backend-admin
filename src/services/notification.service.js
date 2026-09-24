/**
 * Notification Service
 *
 * FIX C-04: Added all missing NotificationType enum values used across the codebase.
 *           The service now maps unknown types to 'SYSTEM' to prevent Prisma enum errors.
 * FIX H-05: sendToMultipleUsers uses createMany instead of individual creates.
 * FIX H-07: Cron job moved to jobs/notification.cron.js — removed from this module.
 * FIX L-01: FCM data payload serializes nested objects as JSON strings.
 */

const prisma = require('../prismaClient');
const { messaging } = require('../config/firebase.config');

const BATCH_SIZE = 500;

/**
 * FIX C-04: Map any notification type string to a valid Prisma NotificationType enum value.
 * Types not in the schema are mapped to 'SYSTEM' to prevent runtime Prisma errors.
 */
const VALID_NOTIFICATION_TYPES = new Set([
  'GIFT_RECEIVED',
  'NEW_FOLLOWER',
  'ROOM_INVITE',
  'VIP_EXPIRING',
  'VIP_EXPIRED',
  'VIP_RENEWED',
  'VIP_RENEWAL_FAILED',
  'LEVEL_UP',
  'ROOM_STARTED',
  'SEAT_REQUEST',
  'SEAT_ACCEPTED',
  'SEAT_REJECTED',
  'SYSTEM',
  'USER_BANNED',
  'REPORT_WARNING',
  'PRIORITY_REPORT',
  'AGENT_COMMISSION',
  'AGENT_TIER_UPGRADE',
  'AGENT_REFERRAL_ACTIVE',
  'AGENCY_APPROVED',
  'AGENCY_REJECTED',
  'AGENCY_SUSPENDED',
]);

function safeNotificationType(type) {
  return VALID_NOTIFICATION_TYPES.has(type) ? type : 'SYSTEM';
}

/**
 * FIX L-01: Serialize FCM data values — nested objects become JSON strings.
 */
function serializeFcmData(data = {}) {
  const result = {};
  for (const [k, v] of Object.entries(data)) {
    result[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  }
  return result;
}

async function sendPushNotification(userId, type, titleAr, bodyAr, data = {}) {
  const safeType = safeNotificationType(type);

  const tokens = await prisma.deviceToken
    .findMany({ where: { userId, isActive: true }, select: { token: true } })
    .then((rows) => rows.map((r) => r.token));

  const fcmData = {
    type,
    ...serializeFcmData(data),
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
  };

  if (tokens.length && messaging) {
    const message = {
      notification: { title: titleAr, body: bodyAr },
      data: fcmData,
      android: { priority: 'high', notification: { sound: 'default', channelId: 'main' } },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      tokens,
    };
    try {
      const response = await messaging.sendEachForMulticast(message);
      const invalidTokens = [];
      response.responses.forEach((resp, index) => {
        if (!resp.success) {
          const err = resp.error;
          if (
            err &&
            [
              'messaging/invalid-registration-token',
              'messaging/registration-token-not-registered',
              'messaging/invalid-argument',
            ].includes(err.code)
          ) {
            invalidTokens.push(tokens[index]);
          }
        }
      });
      if (invalidTokens.length) {
        await prisma.deviceToken.updateMany({
          where: { token: { in: invalidTokens } },
          data: { isActive: false },
        });
      }
    } catch (error) {
      console.error('FCM sendEachForMulticast failed:', error.message);
    }
  }

  // FIX C-04: use safeType to prevent Prisma enum error
  return prisma.notification.create({
    data: { userId, type: safeType, titleAr, bodyAr, data },
  });
}

/**
 * FIX H-05: Use createMany instead of individual creates for bulk notifications.
 */
async function sendToMultipleUsers(userIds, type, titleAr, bodyAr, data = {}) {
  const safeType = safeNotificationType(type);
  const chunks = [];
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    chunks.push(userIds.slice(i, i + BATCH_SIZE));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const tokens = await prisma.deviceToken
        .findMany({ where: { userId: { in: chunk }, isActive: true }, select: { token: true } })
        .then((rows) => rows.map((r) => r.token));

      if (tokens.length && messaging) {
        const fcmData = {
          type,
          ...serializeFcmData(data),
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        };
        const payload = {
          notification: { title: titleAr, body: bodyAr },
          data: fcmData,
          android: { priority: 'high', notification: { sound: 'default', channelId: 'main' } },
          apns: { payload: { aps: { sound: 'default', badge: 1 } } },
          tokens,
        };
        try {
          const response = await messaging.sendEachForMulticast(payload);
          const invalidTokens = [];
          response.responses.forEach((resp, index) => {
            if (!resp.success) {
              const err = resp.error;
              if (
                err &&
                [
                  'messaging/invalid-registration-token',
                  'messaging/registration-token-not-registered',
                  'messaging/invalid-argument',
                ].includes(err.code)
              ) {
                invalidTokens.push(tokens[index]);
              }
            }
          });
          if (invalidTokens.length) {
            await prisma.deviceToken.updateMany({
              where: { token: { in: invalidTokens } },
              data: { isActive: false },
            });
          }
        } catch (error) {
          console.error('FCM multicast failed:', error.message);
        }
      }

      // FIX H-05: use createMany instead of individual creates
      await prisma.notification.createMany({
        data: chunk.map((userId) => ({
          userId,
          type: safeType,
          titleAr,
          bodyAr,
          data,
        })),
        skipDuplicates: true,
      });
    })
  );
}

async function getNotifications(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    }),
    prisma.notification.count({ where: { userId } }),
  ]);
  return { rows, total };
}

async function markAsRead(userId, notificationId) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
}

async function markAllAsRead(userId) {
  return prisma.notification.updateMany({ where: { userId }, data: { isRead: true } });
}

async function getUnreadCount(userId) {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

async function deleteExpiredNotifications() {
  const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return prisma.notification.deleteMany({ where: { createdAt: { lt: threshold } } });
}

/**
 * Helper: Send notification with flexible parameters
 */
async function sendNotification({ userId, type, titleAr, bodyAr, data = {} }) {
  return sendPushNotification(userId, type, titleAr, bodyAr, data);
}

module.exports = {
  sendPushNotification,
  sendNotification,
  sendToMultipleUsers,
  getNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  deleteExpiredNotifications,
};
