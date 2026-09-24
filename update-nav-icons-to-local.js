const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('=== Updating Navigation Icons to Local Admin Dashboard Files ===\n');

    // Use APP_URL from environment or default to localhost:3000
    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    // Map navigation keys to local admin dashboard files via backend proxy
    const iconMappings = [
      {
        key: 'nav.home',
        url: `${appUrl}/api/icon-proxy/navhome_1__1787139703087.png`,
        mimeType: 'image/png'
      },
      {
        key: 'nav.rooms', 
        url: `${appUrl}/api/icon-proxy/navvoicerooms_1787139744106.png`,
        mimeType: 'image/png'
      },
      {
        key: 'nav.moments',
        url: `${appUrl}/api/icon-proxy/navmoments_1787056562485.png`, 
        mimeType: 'image/png'
      },
      {
        key: 'nav.profile',
        url: `${appUrl}/api/icon-proxy/navalerts.png`, // Using alerts as profile fallback
        mimeType: 'image/png'
      }
    ];

    for (const mapping of iconMappings) {
      console.log(`Updating ${mapping.key}...`);
      
      const updated = await prisma.appIcon.update({
        where: { key: mapping.key },
        data: {
          url: mapping.url,
          defaultUrl: mapping.url,
          mimeType: mapping.mimeType,
          version: { increment: 1 },
          updatedAt: new Date()
        }
      });

      console.log(`✓ Updated ${mapping.key}: ${updated.url}`);
      console.log(`  MIME Type: ${updated.mimeType}`);
      console.log(`  Version: ${updated.version}\n`);
    }

    console.log('=== Navigation Icons Updated Successfully ===');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();