const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Use Material Design Icons PNGs instead of SVGs for Flutter Web compatibility
const navIconUpdates = [
  {
    key: 'nav_home',
    url: 'https://cdn.jsdelivr.net/npm/@mdi/material-design-icons@7.2.96/png/24dp/home.png',
    displayName: 'Home'
  },
  {
    key: 'nav_rooms', 
    url: 'https://cdn.jsdelivr.net/npm/@mdi/material-design-icons@7.2.96/png/24dp/microphone.png',
    displayName: 'Voice Rooms'
  },
  {
    key: 'nav_moments',
    url: 'https://cdn.jsdelivr.net/npm/@mdi/material-design-icons@7.2.96/png/24dp/camera.png',
    displayName: 'Moments'
  },
  {
    key: 'nav_profile',
    url: 'https://cdn.jsdelivr.net/npm/@mdi/material-design-icons@7.2.96/png/24dp/account.png',
    displayName: 'Profile'
  }
];

async function updateNavIcons() {
  console.log('Updating navigation icons with PNG icons for Flutter Web compatibility...\n');
  
  for (const update of navIconUpdates) {
    const existing = await prisma.appIcon.findUnique({
      where: { key: update.key }
    });
    
    if (existing) {
      await prisma.appIcon.update({
        where: { id: existing.id },
        data: {
          url: update.url,
          defaultUrl: update.url,
          displayName: update.displayName,
          mimeType: 'image/png', // Update MIME type to PNG
          version: existing.version + 1,
          isPublished: true,
          isPending: false,
          updatedAt: new Date()
        }
      });
      console.log(`✓ Updated ${update.key}: ${update.url} (PNG)`);
    } else {
      console.log(`✗ ${update.key} not found in database`);
    }
  }
  
  console.log('\nNavigation icon updates complete!');
}

updateNavIcons()
  .catch(e => {
    console.error('Error updating navigation icons:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());