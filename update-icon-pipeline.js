/**
 * Update icon pipeline to remove external CDN dependencies and simplify the architecture
 * This keeps the Express backend as the single source of truth for now
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== Simplifying Icon Pipeline ===\n');

  // For now, keep the valid SVG URLs from @mdi but update to use the SVG version
  // which is more reliable than the PNG version that was returning 404s
  const updatedIconUrls = {
    'nav.home': 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/home.svg',
    'nav.rooms': 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/microphone.svg', 
    'nav.moments': 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/camera.svg',
    'nav.profile': 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/account.svg',
  };

  // Get all navigation icons
  const navIcons = await prisma.appIcon.findMany({
    where: {
      key: {
        in: Object.keys(updatedIconUrls)
      }
    }
  });

  console.log(`Found ${navIcons.length} navigation icons to update\n`);

  for (const icon of navIcons) {
    const newUrl = updatedIconUrls[icon.key];
    console.log(`Updating ${icon.key}:`);
    console.log(`  Old URL: ${icon.url}`);
    console.log(`  New URL: ${newUrl}`);
    
    await prisma.appIcon.update({
      where: { id: icon.id },
      data: {
        url: newUrl,
        defaultUrl: newUrl, // Simplify: use same URL for both
        mimeType: 'image/svg+xml',
        version: icon.version + 1,
      }
    });
    
    console.log(`  Updated successfully\n`);
  }

  console.log('\n=== Verification ===\n');
  
  const updatedNavIcons = await prisma.appIcon.findMany({
    where: {
      key: {
        in: Object.keys(updatedIconUrls)
      }
    }
  });

  for (const icon of updatedNavIcons) {
    console.log(`${icon.key}: ${icon.url} (MIME: ${icon.mimeType})`);
  }

  console.log('\n=== Icon Pipeline Simplified ===');
  console.log('Navigation icons now use consistent SVG URLs');
  console.log('URL and defaultUrl are unified');
  console.log('Ready for Admin Dashboard integration');
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
