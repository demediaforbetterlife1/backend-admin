const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateDefaultUrls() {
  const updates = [
    { key: 'nav.notifications', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/bell.svg' },
    { key: 'nav.wallet', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/wallet.svg' },
    { key: 'nav.vip', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/crown.svg' },
    { key: 'nav.agency', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/domain.svg' },
    { key: 'nav.store', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/store.svg' },
    { key: 'nav.leaderboard', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/trophy.svg' },
    { key: 'nav.search', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/magnify.svg' },
    { key: 'nav.friends', defaultUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/account-group.svg' },
  ];

  console.log('🔧 Updating default URLs for nav icons...\n');

  let updated = 0;
  let notFound = 0;

  for (const { key, defaultUrl } of updates) {
    try {
      const icon = await prisma.appIcon.findUnique({ where: { key } });

      if (icon) {
        await prisma.appIcon.update({
          where: { key },
          data: { defaultUrl }
        });
        console.log(`✅ ${key}: ${defaultUrl}`);
        updated++;
      } else {
        console.log(`⚠️  ${key} not found (skipping)`);
        notFound++;
      }
    } catch (error) {
      console.error(`❌ Error updating ${key}:`, error.message);
    }
  }

  console.log(`\n📊 Summary: ${updated} updated, ${notFound} not found`);
  await prisma.$disconnect();
}

updateDefaultUrls();
