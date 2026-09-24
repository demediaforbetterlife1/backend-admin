const prisma = require('../prismaClient');

/**
 * Log an audit event.
 * @param {Object} params
 * @param {string} params.action - AuditAction enum value
 * @param {string|null} params.userId
 * @param {Object|null} params.metadata
 * @param {string|null} params.ipAddress
 * @param {string|null} params.userAgent
 * @returns {Promise<Object>} Created audit log
 */
async function logAudit({
  action,
  userId = null,
  metadata = null,
  ipAddress = null,
  userAgent = null,
}) {
  try {
    const auditLog = await prisma.auditLog.create({
      data: {
        action,
        userId,
        metadata: metadata || {},
        ipAddress,
        userAgent,
      },
    });
    console.log(`[audit] logged ${action} for user ${userId}`);
    return auditLog;
  } catch (error) {
    console.error('[audit] failed to log event', error);
    // Don't fail the request because audit logging fails
  }
}

module.exports = {
  logAudit,
};
