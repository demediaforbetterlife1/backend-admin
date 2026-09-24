import { PrismaClient, VipTier } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  const plans = [
    { tier: 'VIP' as VipTier, nameAr: 'VIP', priceCoins: 500, priceEGP: 50, maxRooms: 2, seatPriority: true, earningBonus: 1.1, badgeColor: '#FFD700', glowColor: '#FFD700', features: ['شارات VIP', 'أولوية المقعد'], isActive: true },
    { tier: 'SVIP_1' as VipTier, nameAr: 'SVIP المستوى 1', priceCoins: 1000, priceEGP: 100, maxRooms: 3, seatPriority: true, earningBonus: 1.2, badgeColor: '#9B59B6', glowColor: '#9B59B6', features: ['إطار خاص', 'تأثير دخول'], isActive: true },
    { tier: 'SVIP_2' as VipTier, nameAr: 'SVIP المستوى 2', priceCoins: 2000, priceEGP: 200, maxRooms: 4, seatPriority: true, earningBonus: 1.3, badgeColor: '#3498DB', glowColor: '#3498DB', features: ['زيادة الأرباح 30%'], isActive: true },
    { tier: 'SVIP_3' as VipTier, nameAr: 'SVIP المستوى 3', priceCoins: 3500, priceEGP: 350, maxRooms: 5, seatPriority: true, earningBonus: 1.5, badgeColor: '#1ABC9C', glowColor: '#1ABC9C', features: ['تسجيل الغرف', 'خصوصية'], isActive: true },
    { tier: 'SVIP_4' as VipTier, nameAr: 'SVIP المستوى 4', priceCoins: 5000, priceEGP: 500, maxRooms: 7, seatPriority: true, earningBonus: 1.7, badgeColor: '#E67E22', glowColor: '#E67E22', features: ['مزايا عرضية'], isActive: true },
    { tier: 'SVIP_5' as VipTier, nameAr: 'SVIP المستوى 5', priceCoins: 8000, priceEGP: 800, maxRooms: 10, seatPriority: true, earningBonus: 2.0, badgeColor: '#FF007F', glowColor: '#FF007F', features: ['أسطوري: مميزات مؤثرة'], isActive: true },
    // Test plans - only active in development
    { tier: 'TEST_VIP' as VipTier, nameAr: 'Test VIP', priceCoins: 0, priceEGP: 0, maxRooms: 2, seatPriority: true, earningBonus: 1.1, badgeColor: '#FFD700', glowColor: '#FFD700', features: ['شارات VIP', 'أولوية المقعد'], isActive: !isProd, durationDays: 30 },
    { tier: 'TEST_SVIP' as VipTier, nameAr: 'Test SVIP', priceCoins: 0, priceEGP: 0, maxRooms: 3, seatPriority: true, earningBonus: 1.2, badgeColor: '#9B59B6', glowColor: '#9B59B6', features: ['إطار خاص', 'تأثير دخول'], isActive: !isProd, durationDays: 30 },
  ];

  for (const p of plans) {
    await prisma.vipPlan.upsert({ where: { tier: p.tier }, update: p, create: p });
  }

  // Seed a few frames
  const frames = [
    { name: 'Gold Frame', nameAr: 'إطار ذهبي', imageUrl: '/assets/frames/gold.png', previewUrl: '/assets/frames/gold_preview.png', tier: 'VIP' as VipTier, coinPrice: 0, isActive: true },
    { name: 'Purple Aura', nameAr: 'هالة بنفسجية', imageUrl: '/assets/frames/purple.png', previewUrl: '/assets/frames/purple_preview.png', tier: 'SVIP_1' as VipTier, coinPrice: 0, isActive: true },
    { name: 'Blue Neon', nameAr: 'نيون أزرق', imageUrl: '/assets/frames/blue.png', previewUrl: '/assets/frames/blue_preview.png', tier: 'SVIP_2' as VipTier, coinPrice: 0, isActive: true },
    { name: 'Teal Glow', nameAr: 'توهج أخضر', imageUrl: '/assets/frames/teal.png', previewUrl: '/assets/frames/teal_preview.png', tier: 'SVIP_3' as VipTier, coinPrice: 0, isActive: true },
    { name: 'Orange Blaze', nameAr: 'توهج برتقالي', imageUrl: '/assets/frames/orange.png', previewUrl: '/assets/frames/orange_preview.png', tier: 'SVIP_4' as VipTier, coinPrice: 0, isActive: true },
    { name: 'Legendary Rainbow', nameAr: 'قوس قزح أسطوري', imageUrl: '/assets/frames/rainbow.png', previewUrl: '/assets/frames/rainbow_preview.png', tier: 'SVIP_5' as VipTier, coinPrice: 0, isActive: true },
  ];

  for (const f of frames) {
    const existing = await prisma.frame.findFirst({ where: { name: f.name } });
    if (existing) {
      await prisma.frame.update({ where: { id: existing.id }, data: f });
    } else {
      await prisma.frame.create({ data: f });
    }
  }

  // Seed entrances
  const entrances = [
    { name: 'Sparkles', nameAr: 'شرارات', animationUrl: '/assets/entrances/sparkles.json', previewUrl: '/assets/entrances/sparkles_preview.png', tier: 'VIP' as VipTier, coinPrice: 0, isActive: true },
    { name: 'Confetti', nameAr: 'كونفيتي', animationUrl: '/assets/entrances/confetti.json', previewUrl: '/assets/entrances/confetti_preview.png', tier: 'SVIP_1' as VipTier, coinPrice: 0, isActive: true },
    { name: 'Fireworks', nameAr: 'ألعاب نارية', animationUrl: '/assets/entrances/fireworks.json', previewUrl: '/assets/entrances/fireworks_preview.png', tier: 'SVIP_2' as VipTier, coinPrice: 0, isActive: true },
  ];

  for (const e of entrances) {
    const existing = await prisma.entrance.findFirst({ where: { name: e.name } });
    if (existing) {
      await prisma.entrance.update({ where: { id: existing.id }, data: e });
    } else {
      await prisma.entrance.create({ data: e });
    }
  }

  console.log('VIP seed complete');

  // Seed default icons
  const defaultIcons = [
    // Navigation - FIX: Use dot notation to match Flutter expectations
    // FIX: Use unique default URLs to avoid cache collision
    { key: 'nav.home', category: 'NAVIGATION', displayName: 'Home', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/home.svg' },
    { key: 'nav.rooms', category: 'NAVIGATION', displayName: 'Rooms', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/microphone.svg' },
    { key: 'nav.moments', category: 'NAVIGATION', displayName: 'Moments', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/camera.svg' },
    { key: 'nav.messages', category: 'NAVIGATION', displayName: 'Messages', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/message-text.svg' },
    { key: 'nav.notifications', category: 'NAVIGATION', displayName: 'Notifications', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/bell.svg' },
    { key: 'nav.profile', category: 'NAVIGATION', displayName: 'Profile', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/account.svg' },
    { key: 'nav.wallet', category: 'NAVIGATION', displayName: 'Wallet', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/wallet.svg' },
    { key: 'nav.vip', category: 'NAVIGATION', displayName: 'VIP', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/crown.svg' },
    { key: 'nav.agency', category: 'NAVIGATION', displayName: 'Agency', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/domain.svg' },
    { key: 'nav.store', category: 'NAVIGATION', displayName: 'Store', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/store.svg' },
    { key: 'nav.leaderboard', category: 'NAVIGATION', displayName: 'Leaderboard', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/trophy.svg' },
    { key: 'nav.search', category: 'NAVIGATION', displayName: 'Search', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/magnify.svg' },
    { key: 'nav.settings', category: 'NAVIGATION', displayName: 'Settings', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/cog.svg' },
    { key: 'nav.friends', category: 'NAVIGATION', displayName: 'Friends', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/account-group.svg' },
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
    { key: 'admin_ban', category: 'ADMIN', displayName: 'Ban', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
    { key: 'admin_kick', category: 'ADMIN', displayName: 'Kick', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
    // Actions
    { key: 'action_delete', category: 'ACTIONS', displayName: 'Delete', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
    { key: 'action_edit', category: 'ACTIONS', displayName: 'Edit', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
    // Store
    { key: 'store_shop', category: 'STORE', displayName: 'Shop', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
    // Agency
    { key: 'agency_king', category: 'VIP', displayName: 'Agency King', defaultUrl: 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@6.6.6/flags/4x3/us.svg' },
  ];

  for (const icon of defaultIcons) {
    await prisma.appIcon.upsert({
      where: { key: icon.key },
      update: {},
      create: {
        key: icon.key,
        category: icon.category as any,
        displayName: icon.displayName,
        url: icon.defaultUrl,
        defaultUrl: icon.defaultUrl,
        storagePath: '',
        mimeType: 'image/svg+xml',
        version: 1,
        isActive: true,
        isPublished: true,
        isPending: false,
      },
    });
  }

  console.log('Icon seed complete');
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
