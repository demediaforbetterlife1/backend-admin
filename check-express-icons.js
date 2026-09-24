/**
 * Check navigation icon records in Express backend database
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== Checking Express Backend AppIcon Records ===\n');

  const navKeys = ['nav.home', 'nav.rooms', 'nav.moments', 'nav.profile'];
  
  for (const key of navKeys) {
    const icon = await prisma.appIcon.findUnique({
      where: { key },
    });
    
    if (icon) {
      console.log(`Key: ${icon.key}`);
      console.log(`  Display Name: ${icon.displayName}`);
      console.log(`  Category: ${icon.category}`);
      console.log(`  URL: ${icon.url}`);
      console.log(`  Default URL: ${icon.defaultUrl}`);
      console.log(`  Storage Path: ${icon.storagePath}`);
      console.log(`  MIME Type: ${icon.mimeType}`);
      console.log(`  Active: ${icon.isActive}`);
      console.log(`  Published: ${icon.isPublished}`);
      console.log(`  Version: ${icon.version}`);
      console.log(`  ETag: ${icon.etag || 'NULL'}`);
      console.log(`  Published At: ${icon.publishedAt || 'NULL'}`);
      console.log('');
    } else {
      console.log(`Key: ${key} - NOT FOUND IN DATABASE\n`);
    }
  }

  // Also check if there are any other navigation icons
  console.log('=== All Navigation Category Icons ===\n');
  const allNavIcons = await prisma.appIcon.findMany({
    orderBy: { key: 'asc' }
  });

  console.log(`Found ${allNavIcons.length} navigation icons:\n`);
  for (const icon of allNavIcons) {
    console.log(`${icon.key}: ${icon.displayName}`);
    console.log(`  URL: ${icon.url}`);
    console.log(`  Default URL: ${icon.defaultUrl}`);
    console.log(`  Active: ${icon.isActive}, Published: ${icon.isPublished}\n`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
