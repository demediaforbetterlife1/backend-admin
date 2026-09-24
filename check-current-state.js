const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('\n=== الحالة الحالية لأيقونات Bottom Nav في Database ===\n');
  
  const icons = await prisma.appIcon.findMany({
    where: { 
      key: { in: ['nav.home', 'nav.rooms', 'nav.moments', 'nav.profile'] } 
    },
    select: { 
      key: true, 
      url: true, 
      version: true, 
      isPublished: true, 
      isActive: true,
      isPending: true,
      updatedAt: true 
    },
    orderBy: { key: 'asc' }
  });

  icons.forEach(icon => {
    console.log(`${icon.key}:`);
    console.log(`  URL: ${icon.url}`);
    console.log(`  Version: ${icon.version}`);
    console.log(`  Published: ${icon.isPublished}`);
    console.log(`  Active: ${icon.isActive}`);
    console.log(`  Pending: ${icon.isPending}`);
    console.log(`  Updated: ${icon.updatedAt}`);
    console.log('');
  });

  await prisma.$disconnect();
})();
