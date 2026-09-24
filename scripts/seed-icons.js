/**
 * Icon seeding script - simpler JavaScript version to avoid TypeScript issues
 * Run with: node scripts/seed-icons.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const defaultIcons = [
  // Navigation
  { key: 'nav_home', category: 'NAVIGATION', displayName: 'Home', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_rooms', category: 'NAVIGATION', displayName: 'Rooms', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_moments', category: 'NAVIGATION', displayName: 'Moments', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_messages', category: 'NAVIGATION', displayName: 'Messages', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_notifications', category: 'NAVIGATION', displayName: 'Notifications', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_profile', category: 'NAVIGATION', displayName: 'Profile', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_wallet', category: 'NAVIGATION', displayName: 'Wallet', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_vip', category: 'NAVIGATION', displayName: 'VIP', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_agency', category: 'NAVIGATION', displayName: 'Agency', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_store', category: 'NAVIGATION', displayName: 'Store', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_leaderboard', category: 'NAVIGATION', displayName: 'Leaderboard', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_search', category: 'NAVIGATION', displayName: 'Search', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_settings', category: 'NAVIGATION', displayName: 'Settings', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'nav_friends', category: 'NAVIGATION', displayName: 'Friends', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // Rooms
  { key: 'room_create', category: 'ROOM', displayName: 'Create Room', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'room_join', category: 'ROOM', displayName: 'Join Room', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'room_private', category: 'ROOM', displayName: 'Private Room', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'room_public', category: 'ROOM', displayName: 'Public Room', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'room_lock', category: 'ROOM', displayName: 'Lock', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'room_unlock', category: 'ROOM', displayName: 'Unlock', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'room_background', category: 'ROOM', displayName: 'Room Background', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'room_panel_1', category: 'ROOM', displayName: 'Room Panel 1', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'room_panel_2', category: 'ROOM', displayName: 'Room Panel 2', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'room_panel_3', category: 'ROOM', displayName: 'Room Panel 3', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // Voice
  { key: 'voice_mic', category: 'VOICE', displayName: 'Microphone', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'voice_mute', category: 'VOICE', displayName: 'Mute', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'voice_chat', category: 'VOICE', displayName: 'Voice Chat', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'voice_live', category: 'VOICE', displayName: 'Live', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'voice_streaming', category: 'VOICE', displayName: 'Streaming', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'voice_audio', category: 'VOICE', displayName: 'Audio', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'voice_video', category: 'VOICE', displayName: 'Video', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'voice_call', category: 'VOICE', displayName: 'Call', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'voice_stop', category: 'VOICE', displayName: 'Stop', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // Social
  { key: 'social_gift', category: 'SOCIAL', displayName: 'Gift', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'social_follow', category: 'SOCIAL', displayName: 'Follow', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'social_unfollow', category: 'SOCIAL', displayName: 'Unfollow', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'social_like', category: 'SOCIAL', displayName: 'Like', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'social_comment', category: 'SOCIAL', displayName: 'Comment', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'social_share', category: 'SOCIAL', displayName: 'Share', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'social_copy', category: 'SOCIAL', displayName: 'Copy', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'social_verified', category: 'SOCIAL', displayName: 'Verified', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // Wallet
  { key: 'wallet_coins', category: 'WALLET', displayName: 'Coins', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'wallet_diamonds', category: 'WALLET', displayName: 'Diamonds', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'wallet_recharge', category: 'WALLET', displayName: 'Recharge', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'wallet_withdraw', category: 'WALLET', displayName: 'Withdraw', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // VIP
  { key: 'vip_badge', category: 'VIP', displayName: 'VIP Badge', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'vip_premium', category: 'VIP', displayName: 'Premium', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'vip_svip', category: 'VIP', displayName: 'SVIP', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'vip_level', category: 'VIP', displayName: 'Level', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'vip_badges', category: 'VIP', displayName: 'Badges', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // Media
  { key: 'media_camera', category: 'MEDIA', displayName: 'Camera', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'media_gallery', category: 'MEDIA', displayName: 'Gallery', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'media_upload', category: 'MEDIA', displayName: 'Upload', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'media_download', category: 'MEDIA', displayName: 'Download', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'media_play', category: 'MEDIA', displayName: 'Play', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'media_pause', category: 'MEDIA', displayName: 'Pause', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // Status
  { key: 'status_success', category: 'STATUS', displayName: 'Success', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'status_error', category: 'STATUS', displayName: 'Error', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'status_warning', category: 'STATUS', displayName: 'Warning', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'status_loading', category: 'STATUS', displayName: 'Loading', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'status_offline', category: 'STATUS', displayName: 'Offline', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'status_refresh', category: 'STATUS', displayName: 'Refresh', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // Settings
  { key: 'settings_logout', category: 'SETTINGS', displayName: 'Logout', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'settings_delete_account', category: 'SETTINGS', displayName: 'Delete Account', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'settings_privacy', category: 'SETTINGS', displayName: 'Privacy', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'settings_security', category: 'SETTINGS', displayName: 'Security', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'settings_language', category: 'SETTINGS', displayName: 'Language', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'settings_theme', category: 'SETTINGS', displayName: 'Theme', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'settings_dark_mode', category: 'SETTINGS', displayName: 'Dark Mode', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'settings_light_mode', category: 'SETTINGS', displayName: 'Light Mode', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // Admin
  { key: 'admin_panel', category: 'ADMIN', displayName: 'Admin Panel', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'admin_moderators', category: 'ADMIN', displayName: 'Moderators', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'admin_reports', category: 'ADMIN', displayName: 'Reports', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'admin_ban', category: 'ADMIN', displayName: 'BAN', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'admin_kick', category: 'ADMIN', displayName: 'Kick', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // Actions
  { key: 'action_delete', category: 'ACTIONS', displayName: 'Delete', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  { key: 'action_edit', category: 'ACTIONS', displayName: 'Edit', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // Store
  { key: 'store_shop', category: 'STORE', displayName: 'Shop', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  // Agency
  { key: 'agency_king', category: 'VIP', displayName: 'Agency King', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
];

async function main() {
  console.log('Seeding default icons...');
  
  let created = 0;
  let updated = 0;
  
  for (const icon of defaultIcons) {
    const existing = await prisma.appIcon.findUnique({
      where: { key: icon.key }
    });
    
    if (existing) {
      await prisma.appIcon.update({
        where: { id: existing.id },
        data: {
          displayName: icon.displayName,
          category: icon.category,
          defaultUrl: icon.defaultUrl,
        }
      });
      updated++;
    } else {
      await prisma.appIcon.create({
        data: {
          key: icon.key,
          category: icon.category,
          displayName: icon.displayName,
          url: icon.defaultUrl,
          defaultUrl: icon.defaultUrl,
          storagePath: '',
          mimeType: 'image/svg+xml',
          version: 1,
          isActive: true,
          isPublished: true,
          isPending: false,
        }
      });
      created++;
    }
  }
  
  console.log(`Icon seeding complete: ${created} created, ${updated} updated`);
}

main()
  .catch(e => {
    console.error('Error seeding icons:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
