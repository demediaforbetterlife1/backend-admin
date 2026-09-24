const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('\n=== Navigation Icons in Database ===\n');
  
  const icons = await prisma.appIcon.findMany({
    where: { 
      key: { startsWith: 'nav' } 
    },
    select: { 
      key: true, 
      url: true, 
      isPublished: true, 
      isActive: true,
      isPending: true
    },
    orderBy: { key: 'asc' }
  });

  if (icons.length === 0) {
    console.log('No navigation icons found in database!');
  } else {
    icons.forEach(icon => {
      console.log(`${icon.key}:`);
      console.log(`  URL: ${icon.url || 'NULL'}`);
      console.log(`  Published: ${icon.isPublished}`);
      console.log(`  Active: ${icon.isActive}`);
      console.log(`  Pending: ${icon.isPending}`);
      console.log('');
    });
  }

  await prisma.$disconnect();
})();