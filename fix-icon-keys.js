const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Migration script: Fix icon keys from underscore to dot notation
 * nav_home → nav.home
 * nav_rooms → nav.rooms
 * etc.
 */

const keyMappings = [
  { old: 'nav_home', new: 'nav.home' },
  { old: 'nav_rooms', new: 'nav.rooms' },
  { old: 'nav_moments', new: 'nav.moments' },
  { old: 'nav_messages', new: 'nav.messages' },
  { old: 'nav_notifications', new: 'nav.notifications' },
  { old: 'nav_profile', new: 'nav.profile' },
  { old: 'nav_wallet', new: 'nav.wallet' },
  { old: 'nav_vip', new: 'nav.vip' },
  { old: 'nav_agency', new: 'nav.agency' },
  { old: 'nav_store', new: 'nav.store' },
  { old: 'nav_leaderboard', new: 'nav.leaderboard' },
  { old: 'nav_search', new: 'nav.search' },
  { old: 'nav_settings', new: 'nav.settings' },
  { old: 'nav_friends', new: 'nav.friends' },
];

async function fixKeys() {
  console.log('🔧 Fixing icon keys: underscore → dot notation\n');
  
  let updated = 0;
  let notFound = 0;

  for (const { old, new: newKey } of keyMappings) {
    try {
      const icon = await prisma.appIcon.findUnique({ where: { key: old } });
      
      if (icon) {
        await prisma.appIcon.update({
          where: { key: old },
          data: { key: newKey }
        });
        console.log(`✅ ${old} → ${newKey}`);
        updated++;
      } else {
        console.log(`⚠️  ${old} not found (skipping)`);
        notFound++;
      }
    } catch (error) {
      console.error(`❌ Error updating ${old}:`, error.message);
    }
  }

  console.log(`\n📊 Summary: ${updated} updated, ${notFound} not found`);
  await prisma.$disconnect();
}

fixKeys();
