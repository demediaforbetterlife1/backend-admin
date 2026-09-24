const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('=== Updating Banner Images to Local Admin Dashboard Files ===\n');

    // First, let's check current banners
    const currentBanners = await prisma.banner.findMany();
    console.log('Current banners:', JSON.stringify(currentBanners, null, 2));

    // Use the same local icons for banners (they are PNG files)
    const bannerMappings = [
      {
        title: 'Voice Rooms',
        imageUrl: 'http://localhost:3000/api/icon-proxy/navvoicerooms_1787139744106.png',
        linkUrl: '/app/rooms-discovery',
        screen: 'home',
        position: 1
      },
      {
        title: 'Start Your Room', 
        imageUrl: 'http://localhost:3000/api/icon-proxy/navhome_1__1787139703087.png',
        linkUrl: '/app/create-room',
        screen: 'home',
        position: 2
      },
      {
        title: 'VIP Privileges',
        imageUrl: 'http://localhost:3000/api/icon-proxy/navalerts.png',
        linkUrl: '/app/main-shell',
        screen: 'home', 
        position: 3
      }
    ];

    // Update or create banners
    for (const mapping of bannerMappings) {
      console.log(`Processing banner: ${mapping.title}`);
      
      // Check if banner exists
      const existing = await prisma.banner.findFirst({
        where: { title: mapping.title }
      });

      if (existing) {
        const updated = await prisma.banner.update({
          where: { id: existing.id },
          data: {
            imageUrl: mapping.imageUrl,
            linkUrl: mapping.linkUrl,
            screen: mapping.screen,
            position: mapping.position,
            enabled: true,
            updatedAt: new Date()
          }
        });
        console.log(`✓ Updated banner: ${updated.title} -> ${updated.imageUrl}`);
      } else {
        const created = await prisma.banner.create({
          data: {
            title: mapping.title,
            imageUrl: mapping.imageUrl,
            linkUrl: mapping.linkUrl,
            screen: mapping.screen,
            position: mapping.position,
            enabled: true
          }
        });
        console.log(`✓ Created banner: ${created.title} -> ${created.imageUrl}`);
      }
    }

    console.log('\n=== Banner Images Updated Successfully ===');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();