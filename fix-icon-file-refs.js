const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║  FIX ICON FILE REFERENCES                                   ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

const ADMIN_DASHBOARD_PATH = 'E:\\voicechat\\voice-admin-dashboard\\public\\icons';
const BASE_URL = 'http://192.168.1.3:3001/icons';

// Map of icon keys to their correct filenames
const corrections = {
  'nav.home': 'navhome_1__1787139703087.png',
  'nav.rooms': 'navvoicerooms_1787139744106.png', // Using the newer file
};

(async () => {
  try {
    console.log('Applying corrections...\n');

    for (const [key, filename] of Object.entries(corrections)) {
      // Verify file exists
      const filePath = path.join(ADMIN_DASHBOARD_PATH, filename);
      if (!fs.existsSync(filePath)) {
        console.log(`❌ ${key}: File ${filename} not found, skipping`);
        continue;
      }

      const stats = fs.statSync(filePath);
      const newUrl = `${BASE_URL}/${filename}`;

      // Update database
      const result = await prisma.appIcon.update({
        where: { key },
        data: {
          url: newUrl,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      console.log(`✅ ${key}:`);
      console.log(`   New URL: ${newUrl}`);
      console.log(`   File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Version: ${result.version}`);
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('Verification:\n');

    // Verify all bottom nav icons
    const icons = await prisma.appIcon.findMany({
      where: { key: { in: ['nav.home', 'nav.rooms', 'nav.moments', 'nav.profile'] } },
      select: { key: true, url: true, version: true },
      orderBy: { key: 'asc' }
    });

    for (const icon of icons) {
      const filename = icon.url.split('/').pop();
      const filePath = path.join(ADMIN_DASHBOARD_PATH, filename);
      const exists = fs.existsSync(filePath);

      console.log(`${icon.key} (v${icon.version}):`);
      console.log(`  File: ${filename}`);
      console.log(`  Exists: ${exists ? '✅' : '❌'}`);
      
      if (exists) {
        const stats = fs.statSync(filePath);
        console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      }
      console.log('');
    }

    console.log('✅ All corrections applied successfully\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
})();
