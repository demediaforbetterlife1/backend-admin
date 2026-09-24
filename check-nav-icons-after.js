const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkIcons() {
  const icons = await prisma.appIcon.findMany({
    where: { key: { startsWith: 'nav.' } },
    select: { key: true, url: true, defaultUrl: true }
  });

  console.log('Nav icons in database:');
  icons.forEach(i => {
    console.log(`  ${i.key}:`);
    console.log(`    url: ${i.url}`);
    console.log(`    defaultUrl: ${i.defaultUrl}`);
  });

  await prisma.$disconnect();
}

checkIcons();
