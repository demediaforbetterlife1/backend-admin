const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifyKeys() {
  const requiredKeys = ['nav.home', 'nav.rooms', 'nav.moments', 'nav.profile'];

  console.log('🔍 Verifying required nav icon keys...\n');

  for (const key of requiredKeys) {
    const icon = await prisma.appIcon.findUnique({
      where: { key },
      select: { key: true, url: true, defaultUrl: true, isPublished: true }
    });

    if (icon) {
      console.log(`✅ ${key}:`);
      console.log(`    url: ${icon.url}`);
      console.log(`    defaultUrl: ${icon.defaultUrl}`);
      console.log(`    isPublished: ${icon.isPublished}`);
    } else {
      console.log(`❌ ${key} NOT FOUND`);
    }
  }

  await prisma.$disconnect();
}

verifyKeys();
