const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testIconsApi() {
  const icons = await prisma.appIcon.findMany({
    where: { isActive: true, isPublished: true },
    select: { key: true, url: true, defaultUrl: true }
  });

  console.log('Simulating /api/icons response...\n');

  const manifest = {};
  for (const icon of icons) {
    const filename = icon.url.split('/').pop();
    const proxiedUrl = filename ? `/api/icon-proxy/${filename}` : icon.url;

    manifest[icon.key] = {
      ...icon,
      url: proxiedUrl,
      _originalUrl: icon.url,
    };
  }

  // Print nav icons
  console.log('Nav icons in manifest:');
  for (const key of ['nav_home', 'nav_rooms', 'nav_moments', 'nav_profile']) {
    const icon = manifest[key];
    if (icon) {
      console.log(`  ${key}:`);
      console.log(`    url: ${icon.url}`);
      console.log(`    _originalUrl: ${icon._originalUrl}`);
    } else {
      console.log(`  ${key}: NOT FOUND`);
    }
  }

  await prisma.$disconnect();
}

testIconsApi();
