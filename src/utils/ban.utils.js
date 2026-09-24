/**
 * Ban utilities — uses the shared Prisma client (no separate connection pool).
 */

const prisma = require('../prismaClient');

/**
 * Returns true if the user is currently banned.
 * Automatically lifts expired temporary bans.
 */
async function isUserBanned(userId) {
  if (!userId) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isBanned: true, banExpiresAt: true, banType: true },
  });

  if (!user || !user.isBanned) return false;

  // NETWORK bans are permanent
  if (user.banType === 'NETWORK') return true;

  // Lift expired temporary bans
  if (user.banExpiresAt && user.banExpiresAt <= new Date()) {
    await prisma.user.updateMany({
      where: { id: userId, isBanned: true },
      data: { isBanned: false, banExpiresAt: null, banType: null },
    });
    return false;
  }

  return true;
}

async function assertUserNotBanned(userId) {
  if (await isUserBanned(userId)) {
    const err = new Error('Account is suspended');
    err.code = 'USER_BANNED';
    throw err;
  }
}

module.exports = { isUserBanned, assertUserNotBanned };
