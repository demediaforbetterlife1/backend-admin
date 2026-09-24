require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixIconUrls() {
  try {
    console.log('🔧 Fixing icon URLs to use local IP (192.168.1.3:3001)...\n');

    // Get all icons with localhost:3001 URLs
    const icons = await prisma.appIcon.findMany({
      where: {
        OR: [
          { url: { contains: 'localhost:3001' } },
          { defaultUrl: { contains: 'localhost:3001' } }
        ]
      }
    });

    console.log(`Found ${icons.length} icons with localhost URLs\n`);

    for (const icon of icons) {
      const newUrl = icon.url?.replace('localhost:3001', '192.168.1.3:3001') || icon.url;
      const newDefaultUrl = icon.defaultUrl?.replace('localhost:3001', '192.168.1.3:3001') || icon.defaultUrl;

      await prisma.appIcon.update({
        where: { id: icon.id },
        data: {
          url: newUrl,
          defaultUrl: newDefaultUrl,
          updatedAt: new Date()
        }
      });

      console.log(`✅ Updated ${icon.key}`);
      console.log(`   Old: ${icon.url}`);
      console.log(`   New: ${newUrl}\n`);
    }

    console.log('✅ All icon URLs updated successfully!');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixIconUrls();
