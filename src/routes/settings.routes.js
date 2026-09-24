const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const bcrypt = require('bcryptjs');
const { authenticate } = require('../middleware/authMiddleware');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');
const authService = require('../services/authService');
const cloudinary = require('../config/cloudinary.config');

// ---------------------------------------------------------------------------
// GET /api/settings
// Fetch all user settings
// ---------------------------------------------------------------------------
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      settings: true,
    }
  });

  const vipSettings = await prisma.userVip.findUnique({
    where: { userId },
    select: {
      ghostMode: true,
      invisibleMode: true
    }
  });

  // Default settings
  const defaultSettings = {
    privacy: {
      ghostMode: vipSettings?.ghostMode || false,
      invisibleMode: vipSettings?.invisibleMode || false,
      showOnlineStatus: true,
      allowMessages: 'everyone',
      allowGifts: true,
    },
    notifications: {
      pushEnabled: true,
      soundEnabled: true,
      vibrationEnabled: true,
    }
  };

  const settings = user.settings ? { ...defaultSettings, ...user.settings } : defaultSettings;
  
  res.json({
    success: true,
    data: settings
  });
}));

// ---------------------------------------------------------------------------
// PUT /api/settings
// Update user settings
// ---------------------------------------------------------------------------
router.put('/', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const newSettings = req.body;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const currentSettings = user.settings || {};

  const updatedSettings = {
    ...currentSettings,
    ...newSettings,
    // Deep merge for nested objects like privacy and notifications
    privacy: {
      ...(currentSettings.privacy || {}),
      ...(newSettings.privacy || {})
    },
    notifications: {
      ...(currentSettings.notifications || {}),
      ...(newSettings.notifications || {})
    }
  };

  await prisma.user.update({
    where: { id: userId },
    data: { settings: updatedSettings }
  });

  sendSuccess(res, updatedSettings, 200, 'Settings updated successfully');
}));

// ---------------------------------------------------------------------------
// POST /api/settings/password
// Change password
// ---------------------------------------------------------------------------
router.post('/password', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return sendError(res, 'Current and new password are required', 400);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.passwordHash) {
    return sendError(res, 'User not found or password not set', 404);
  }

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) {
    return sendError(res, 'Incorrect current password', 401);
  }

  const salt = await bcrypt.genSalt(12);
  const newHash = await bcrypt.hash(newPassword, salt);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash }
  });

  // Revoke all other sessions after password change
  await authService.revokeAllRefreshTokens(userId);

  sendSuccess(res, null, 200, 'Password updated successfully. Please log in again.');
}));

// ---------------------------------------------------------------------------
// DELETE /api/settings/account
// Permanent account deletion
// ---------------------------------------------------------------------------
router.delete('/account', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { password, confirmation } = req.body;

  if (confirmation !== 'DELETE') {
    return sendError(res, 'Please type DELETE to confirm', 400);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return sendError(res, 'User not found', 404);

  // If user has a password, verify it
  if (user.passwordHash) {
    if (!password) return sendError(res, 'Password is required for deletion', 400);
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return sendError(res, 'Incorrect password', 401);
  }

  // Perform deletion of all user-related data
  await prisma.$transaction([
    prisma.refreshToken.deleteMany({ where: { userId } }),
    prisma.deviceToken.deleteMany({ where: { userId } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.blockedUser.deleteMany({
      where: {
        OR: [
          { userId: userId },
          { blockedId: userId }
        ]
      }
    }),
    prisma.friendship.deleteMany({
      where: {
        OR: [
          { userId: userId },
          { friendId: userId }
        ]
      }
    }),
    prisma.follower.deleteMany({
      where: {
        OR: [
          { followerId: userId },
          { followingId: userId }
        ]
      }
    }),
    prisma.roomMember.deleteMany({ where: { userId } }),
    prisma.userVip.deleteMany({ where: { userId } }),
    prisma.wallet.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } })
  ]);

  // Cloudinary cleanup for avatar if it exists
  if (user.avatar && user.avatar.includes('cloudinary')) {
    try {
      const parts = user.avatar.split('/');
      const lastPart = parts[parts.length - 1];
      const publicId = lastPart.split('.')[0];
      await cloudinary.uploader.destroy(`avatars/${publicId}`);
    } catch (err) {
      console.warn('Failed to delete avatar from Cloudinary:', err.message);
    }
  }

  sendSuccess(res, null, 200, 'Account permanently deleted');
}));

// ---------------------------------------------------------------------------
// GET /api/settings/upload-signature
// Get signature for avatar upload to Cloudinary
// ---------------------------------------------------------------------------
router.get('/upload-signature', authenticate, asyncHandler(async (req, res) => {
  const timestamp = Math.round(new Date().getTime() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    {
      timestamp: timestamp,
      folder: 'avatars',
    },
    process.env.CLOUDINARY_API_SECRET
  );

  sendSuccess(res, {
    signature,
    timestamp,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    folder: 'avatars',
  });
}));

// ---------------------------------------------------------------------------
// POST /api/settings/avatar
// Update avatar URL after successful Cloudinary upload
// ---------------------------------------------------------------------------
router.post('/avatar', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { avatarUrl } = req.body;

  if (!avatarUrl) return sendError(res, 'avatarUrl is required', 400);

  await prisma.user.update({
    where: { id: userId },
    data: { avatar: avatarUrl }
  });

  sendSuccess(res, { avatar: avatarUrl }, 200, 'Avatar updated successfully');
}));

// ---------------------------------------------------------------------------
// DELETE /api/settings/avatar
// Remove avatar
// ---------------------------------------------------------------------------
router.delete('/avatar', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { avatar: true } });
  if (user?.avatar && user.avatar.includes('cloudinary')) {
     try {
      const parts = user.avatar.split('/');
      const lastPart = parts[parts.length - 1];
      const publicId = lastPart.split('.')[0];
      await cloudinary.uploader.destroy(`avatars/${publicId}`);
    } catch (err) {
      console.warn('Cloudinary delete failed:', err.message);
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { avatar: null }
  });

  sendSuccess(res, null, 200, 'Avatar removed successfully');
}));

module.exports = router;
