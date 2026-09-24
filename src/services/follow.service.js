const prisma = require('../prismaClient');
const notificationService = require('./notification.service');

async function followUser(followerId, followingId) {
  if (followerId === followingId) {
    throw new Error('Cannot follow yourself');
  }

  const existing = await prisma.follow.findUnique({ where: { followerId_followingId: { followerId, followingId } } });
  if (existing) {
    return existing;
  }

  const follow = await prisma.follow.create({ data: { followerId, followingId } });
  const follower = await prisma.user.findUnique({ where: { id: followerId }, select: { username: true } });

  if (follower) {
    await notificationService.sendPushNotification(
      followingId,
      'NEW_FOLLOWER',
      '👤 متابع جديد',
      `${follower.username} بدأ يتابعك`,
      { followerId },
    );
  }

  return follow;
}

async function unfollowUser(followerId, followingId) {
  return prisma.follow.deleteMany({ where: { followerId, followingId } });
}

async function getFollowers(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const rows = await prisma.follow.findMany({
    where: { followingId: userId },
    include: { follower: { select: { id: true, username: true, avatar: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip,
  });
  const total = await prisma.follow.count({ where: { followingId: userId } });
  return { rows, total };
}

async function getFollowing(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const rows = await prisma.follow.findMany({
    where: { followerId: userId },
    include: { following: { select: { id: true, username: true, avatar: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip,
  });
  const total = await prisma.follow.count({ where: { followerId: userId } });
  return { rows, total };
}

async function isFollowing(followerId, followingId) {
  const follow = await prisma.follow.findUnique({ where: { followerId_followingId: { followerId, followingId } } });
  return !!follow;
}

async function getFollowerIds(userId) {
  const rows = await prisma.follow.findMany({ where: { followingId: userId }, select: { followerId: true } });
  return rows.map((row) => row.followerId);
}

module.exports = {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  isFollowing,
  getFollowerIds,
};
