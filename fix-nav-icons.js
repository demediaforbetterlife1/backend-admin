/**
 * Fix navigation icon keys and URLs in Express backend database
 * - Change underscore keys to dot notation (nav_home -> nav.home)
 * - Replace obsolete jsDelivr MDI URLs with valid SVG URLs
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== Fixing Navigation Icon Keys and URLs ===\n');

  // Valid SVG URLs from @mdi (these work)
  const validIconUrls = {
    'nav.home': 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/home.svg',
    'nav.rooms': 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/microphone.svg',
    'nav.moments': 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/camera.svg',
    'nav.profile': 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/account.svg',
  };

  // Map old underscore keys to new dot notation keys
  const keyMappings = {
    'nav_home': 'nav.home',
    'nav_rooms': 'nav.rooms',
    'nav_moments': 'nav.moments',
    'nav_profile': 'nav.profile',
  };

  for (const [oldKey, newKey] of Object.entries(keyMappings)) {
    console.log(`Processing ${oldKey} -> ${newKey}`);
    
    // Check if old key exists
    const oldIcon = await prisma.appIcon.findUnique({
      where: { key: oldKey }
    });

    if (oldIcon) {
      console.log(`  Found existing record with old key: ${oldKey}`);
      
      // Check if new key already exists
      const existingNew = await prisma.appIcon.findUnique({
        where: { key: newKey }
      });

      if (existingNew) {
        console.log(`  New key ${newKey} already exists, deleting old record`);
        await prisma.appIcon.delete({
          where: { key: oldKey }
        });
      } else {
        console.log(`  Updating old record to new key and valid URL`);
        await prisma.appIcon.update({
          where: { key: oldKey },
          data: {
            key: newKey,
            url: validIconUrls[newKey],
            defaultUrl: validIconUrls[newKey],
            mimeType: 'image/svg+xml',
            version: oldIcon.version + 1,
          }
        });
      }
    } else {
      console.log(`  Old key ${oldKey} not found, checking if new key exists`);
      
      const existingNew = await prisma.appIcon.findUnique({
        where: { key: newKey }
      });

      if (!existingNew) {
        console.log(`  Creating new record with valid URL`);
        await prisma.appIcon.create({
          data: {
            key: newKey,
            category: 'NAVIGATION',
            displayName: newKey.split('.')[1].charAt(0).toUpperCase() + newKey.split('.')[1].slice(1),
            url: validIconUrls[newKey],
            defaultUrl: validIconUrls[newKey],
            storagePath: '',
            mimeType: 'image/svg+xml',
            version: 1,
            isActive: true,
            isPublished: true,
            isPending: false,
          }
        });
      } else {
        console.log(`  New key ${newKey} already exists with valid URL`);
        // Ensure it has the correct URL
        await prisma.appIcon.update({
          where: { key: newKey },
          data: {
            url: validIconUrls[newKey],
            defaultUrl: validIconUrls[newKey],
            mimeType: 'image/svg+xml',
          }
        });
      }
    }
    console.log('');
  }

  console.log('=== Verification ===\n');
  
  for (const newKey of Object.keys(validIconUrls)) {
    const icon = await prisma.appIcon.findUnique({
      where: { key: newKey }
    });
    
    if (icon) {
      console.log(`${icon.key}: ${icon.url}`);
    } else {
      console.log(`${newKey}: NOT FOUND`);
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
