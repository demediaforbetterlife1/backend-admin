const authService = require('../services/authService');
const prisma = require('../prismaClient');
const { normalizeAuthUser } = require('../utils/userNormalize');
const { assertUserNotBanned } = require('../utils/ban.utils');

/**
 * Socket.IO middleware — verify JWT from handshake.auth.token
 */
async function socketAuthMiddleware(socket, next) {
  try {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');

    if (!token) {
      return next(new Error('Authentication required'));
    }

    const payload = authService.verifyAccessToken(token);
    const user = normalizeAuthUser(payload);
    await assertUserNotBanned(user.id);

    socket.data.user = user;
    socket.data.userId = user.id;
    next();
  } catch (err) {
    next(new Error('Invalid or expired token'));
  }
}

module.exports = { socketAuthMiddleware };
