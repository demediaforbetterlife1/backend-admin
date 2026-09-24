const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkNavIconUrls() {
  console.log('=== Navigation Icon URLs ===\n');
  
  const icons = await prisma.appIcon.findMany({
    where: { key: { startsWith: 'nav' } },
    select: { key: true, url: true, mimeType: true, version: true }
  });
  
  console.log('Navigation Icons in database:');
  icons.forEach(icon => {
    console.log(`${icon.key}:`);
    console.log(`  URL: ${icon.url}`);
    console.log(`  MIME Type: ${icon.mimeType}`);
    console.log(`  Version: ${icon.version}`);
    console.log('');
  });
  
  await prisma.$disconnect();
}

checkNavIconUrls().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});