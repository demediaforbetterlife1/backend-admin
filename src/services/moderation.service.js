/**
 * Moderation Service
 *
 * FIX L-02: Banned-word filter now uses Unicode-aware matching for Arabic text.
 * FIX M-01: Report rate-limiting now uses DB count instead of in-memory Map.
 */

const prisma = require('../prismaClient');
const notificationService = require('./notification.service');

const BANNED_WORD_REFRESH_MS = 10 * 60 * 1000;
const REPORT_WINDOW_MS = 60 * 60 * 1000;
const REPORT_LIMIT_PER_HOUR = 5;

let bannedWordsCache = [];
let bannedWordsLastRefresh = 0;

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * FIX L-02: Build a regex that works for both ASCII and Arabic/Unicode words.
 * \b word boundaries only work for ASCII — for Arabic text we skip them.
 */
function buildWordPattern(word) {
  const escaped = escapeRegExp(word);
  // Check if the word contains non-ASCII characters (e.g., Arabic)
  const hasNonAscii = /[^\x00-\x7F]/.test(word);
  if (hasNonAscii) {
    // No \b for Arabic — use a simple case-insensitive match
    return new RegExp(escaped, 'gi');
  }
  return new RegExp(`\\b${escaped}\\b`, 'gi');
}

async function refreshBannedWords(force = false) {
  if (!force && Date.now() - bannedWordsLastRefresh < BANNED_WORD_REFRESH_MS && bannedWordsCache.length) {
    return;
  }

  bannedWordsCache = await prisma.bannedWord.findMany();
  bannedWordsLastRefresh = Date.now();
}

async function getBannedWords() {
  await refreshBannedWords();
  return bannedWordsCache;
}

function getSeverityOrder(severity) {
  if (severity === 'CRITICAL') return 3;
  if (severity === 'SEVERE') return 2;
  return 1;
}

async function filterMessage(text) {
  await refreshBannedWords();

  if (!text || !text.trim()) {
    return { filtered: text, blocked: false };
  }

  let filtered = text;
  let highestSeverity = 'MILD';
  let blocked = false;
  let blockedReason;

  for (const bannedWord of bannedWordsCache) {
    // FIX L-02: use Unicode-aware pattern builder
    const pattern = buildWordPattern(bannedWord.word);

    if (!pattern.test(filtered)) {
      continue;
    }
    // Reset lastIndex after test()
    pattern.lastIndex = 0;

    const severity = bannedWord.severity;
    if (severity === 'MILD') {
      filtered = filtered.replace(pattern, '***');
    }

    if (severity === 'SEVERE' || severity === 'CRITICAL') {
      const existingSeverityValue = getSeverityOrder(highestSeverity);
      const currentSeverityValue = getSeverityOrder(severity);
      if (currentSeverityValue > existingSeverityValue) {
        highestSeverity = severity;
        blocked = true;
        blockedReason = severity === 'SEVERE' ? 'severe' : 'critical';
      }
    }
  }

  return {
    filtered,
    blocked,
    severity: blocked ? highestSeverity : 'MILD',
    reason: blockedReason,
  };
}

async function handleViolation(userId, severity, sourceId) {
  if (severity !== 'SEVERE' && severity !== 'CRITICAL') {
    return;
  }

  const reasonText = severity === 'CRITICAL' ? 'Critical content violation' : 'Severe content violation';
  await prisma.userWarning.create({
    data: {
      userId,
      reason: reasonText,
      sourceId: sourceId || null,
    },
  });

  const warningsCount = await prisma.userWarning.count({
    where: {
      userId,
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    },
  });

  const banExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const banData = {
    isBanned: true,
    banExpiresAt,
  };

  if (severity === 'SEVERE') {
    if (warningsCount >= 3) {
      await prisma.user.update({
        where: { id: userId },
        data: { ...banData, banType: 'ONE_DAY' },
      });

      const authService = require('./authService');
      await authService.revokeAllRefreshTokens(userId);
      const roomSocketService = require('../socket/room.socket');
      await roomSocketService.kickUserFromAllRooms(userId);
      await notificationService.sendPushNotification(
        userId,
        'USER_BANNED',
        'تم تعليق حسابك لمدة يوم بسبب تكرار المخالفات',
        'حاول مرة أخرى بعد انتهاء مدة التعليق.',
      );
    }
  }

  if (severity === 'CRITICAL') {
    await prisma.user.update({
      where: { id: userId },
      data: { ...banData, banType: 'ONE_DAY' },
    });
    const authService = require('./authService');
    await authService.revokeAllRefreshTokens(userId);
    const roomSocketService = require('../socket/room.socket');
    await roomSocketService.kickUserFromAllRooms(userId);
    await notificationService.sendPushNotification(
      userId,
      'USER_BANNED',
      'تم تعليق حسابك بسبب محتوى مخالف',
      'تم تعليق حسابك لمدة يوم بسبب انتهاك سياسات المحتوى.',
    );
  }
}

/**
 * FIX M-01: Rate-limit using DB count instead of in-memory Map.
 * This works correctly across server restarts and multi-instance deployments.
 */
async function submitReport(reporterId, reportedUserId, roomId, reason, description) {
  // FIX M-01: DB-backed rate limit
  const recentCount = await prisma.report.count({
    where: {
      reporterId,
      createdAt: { gte: new Date(Date.now() - REPORT_WINDOW_MS) },
    },
  });

  if (recentCount >= REPORT_LIMIT_PER_HOUR) {
    throw new Error('You have reached the report limit. Please try again later.');
  }

  const report = await prisma.report.create({
    data: {
      reporterId,
      reportedUserId,
      roomId,
      reason,
      description,
      status: 'PENDING',
    },
  });

  const pendingCount = await prisma.report.count({
    where: {
      reportedUserId,
      status: 'PENDING',
    },
  });

  if (pendingCount >= 5) {
    const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
    const adminIds = admins.map((admin) => admin.id);
    if (adminIds.length) {
      await notificationService.sendToMultipleUsers(
        adminIds,
        'PRIORITY_REPORT',
        'بلاغ جديد يحتاج مراجعة عاجلة',
        'تجاوز عدد البلاغات المعلقة 5 عن مستخدم واحد.',
        { reportedUserId, pendingCount: `${pendingCount}` },
      );
    }
  }

  return report;
}

async function reviewReport(reportId, adminId, action, adminNote) {
  const allowed = ['dismiss', 'warn', 'ban_1d', 'ban_3d', 'ban_network'];
  if (!allowed.includes(action)) {
    throw new Error('Invalid moderation action');
  }

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) {
    throw new Error('Report not found');
  }

  const status = action === 'dismiss' ? 'DISMISSED' : 'ACTION_TAKEN';
  await prisma.report.update({
    where: { id: reportId },
    data: {
      status,
      adminNote: adminNote || null,
      reviewedById: adminId,
      reviewedAt: new Date(),
    },
  });

  if (action === 'warn') {
    await prisma.userWarning.create({
      data: {
        userId: report.reportedUserId,
        reason: `Report reviewed by admin: ${adminNote || 'warning issued'}`,
        sourceId: report.id,
      },
    });
    await notificationService.sendPushNotification(
      report.reportedUserId,
      'REPORT_WARNING',
      'تم إصدار تحذير لك بعد مراجعة البلاغ',
      'يرجى الالتزام بقواعد المجتمع.',
    );
  }

  if (action === 'ban_1d' || action === 'ban_3d' || action === 'ban_network') {
    const banData = {
      isBanned: true,
      banType: action === 'ban_network' ? 'NETWORK' : action === 'ban_3d' ? 'THREE_DAYS' : 'ONE_DAY',
      banExpiresAt: action === 'ban_network' ? null : new Date(Date.now() + (action === 'ban_3d' ? 3 : 1) * 24 * 60 * 60 * 1000),
    };
    await prisma.user.update({ where: { id: report.reportedUserId }, data: banData });
    const authService = require('./authService');
    await authService.revokeAllRefreshTokens(report.reportedUserId);
    const roomSocketService = require('../socket/room.socket');
    await roomSocketService.kickUserFromAllRooms(report.reportedUserId);
    await prisma.userWarning.create({
      data: {
        userId: report.reportedUserId,
        reason: `Admin review action: ${action}`,
        sourceId: report.id,
      },
    });
    await notificationService.sendPushNotification(
      report.reportedUserId,
      'USER_BANNED',
      'تم تعليق حسابك بعد مراجعة البلاغ',
      'يرجى التواصل مع الدعم إذا كنت بحاجة إلى توضيح.',
    );
  }

  return prisma.report.findUnique({ where: { id: reportId } });
}

async function getReportsForUser(reporterId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const reports = await prisma.report.findMany({
    where: { reporterId },
    include: {
      reporter: { select: { id: true, username: true, avatar: true } },
      reportedUser: { select: { id: true, username: true, avatar: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });
  const total = await prisma.report.count({ where: { reporterId } });
  return { reports, total, page, limit };
}

async function getAllReports(filters = {}, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const where = {};

  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.reason) {
    where.reason = filters.reason;
  }

  const reports = await prisma.report.findMany({
    where,
    include: {
      reporter: { select: { id: true, username: true, avatar: true } },
      reportedUser: { select: { id: true, username: true, avatar: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });
  const total = await prisma.report.count({ where });
  return { reports, total, page, limit };
}

async function addBannedWord(word, severity) {
  const allowed = ['MILD', 'SEVERE', 'CRITICAL'];
  if (!allowed.includes(severity)) throw new Error('Invalid severity');
  const created = await prisma.bannedWord.create({ data: { word: word.trim().toLowerCase(), severity } });
  await refreshBannedWords(true);
  return created;
}

async function removeBannedWord(id) {
  const deleted = await prisma.bannedWord.delete({ where: { id } });
  await refreshBannedWords(true);
  return deleted;
}

async function resetUserProfile(userId) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      username: `user_${userId.slice(0, 8)}`,
      avatar: null,
    },
  });
  const vipCacheService = require('./vip.cache.service');
  await vipCacheService.invalidateVipStatus(userId);
  return user;
}

async function resetRoom(roomId) {
  return prisma.room.update({
    where: { id: roomId },
    data: {
      name: 'Room',
      image: null,
    },
  });
}

async function getWarningsForUser(userId) {
  return prisma.userWarning.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = {
  filterMessage,
  handleViolation,
  submitReport,
  reviewReport,
  getBannedWords,
  addBannedWord,
  removeBannedWord,
  getReportsForUser,
  getAllReports,
  getWarningsForUser,
  resetUserProfile,
  resetRoom,
};
