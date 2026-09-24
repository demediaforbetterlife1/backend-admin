const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║  VERIFY ICON FILES EXISTENCE                                ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

const ADMIN_DASHBOARD_PATH = 'E:\\voicechat\\voice-admin-dashboard\\public\\icons';
const BOTTOM_NAV_KEYS = ['nav.home', 'nav.rooms', 'nav.moments', 'nav.profile'];

(async () => {
  try {
    // Get icons from database
    const icons = await prisma.appIcon.findMany({
      where: { key: { in: BOTTOM_NAV_KEYS } },
      select: { key: true, url: true },
      orderBy: { key: 'asc' }
    });

    // Get actual files in directory
    const actualFiles = fs.readdirSync(ADMIN_DASHBOARD_PATH)
      .filter(f => f.endsWith('.png'));

    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('DATABASE REFERENCES vs ACTUAL FILES\n');
    console.log('═══════════════════════════════════════════════════════════════\n');

    for (const icon of icons) {
      const filename = icon.url.split('/').pop();
      const exists = actualFiles.includes(filename);
      
      console.log(`${icon.key}:`);
      console.log(`  Database filename: ${filename}`);
      console.log(`  File exists: ${exists ? '✅ YES' : '❌ NO'}`);
      
      if (!exists) {
        // Try to find similar files
        const baseName = filename.replace(/_\d+\.png$/, '');
        const similar = actualFiles.filter(f => f.startsWith(baseName));
        
        if (similar.length > 0) {
          console.log(`  Similar files found:`);
          similar.forEach(f => {
            const fullPath = path.join(ADMIN_DASHBOARD_PATH, f);
            const stats = fs.statSync(fullPath);
            console.log(`    - ${f} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
          });
        }
      } else {
        const fullPath = path.join(ADMIN_DASHBOARD_PATH, filename);
        const stats = fs.statSync(fullPath);
        console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      }
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('ALL FILES IN ICONS DIRECTORY:\n');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    actualFiles.forEach(f => {
      const fullPath = path.join(ADMIN_DASHBOARD_PATH, f);
      const stats = fs.statSync(fullPath);
      const sizeKB = (stats.size / 1024).toFixed(0);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      
      if (stats.size < 1024 * 10) {
        console.log(`⚠️  ${f} - ${stats.size} bytes (TOO SMALL!)`);
      } else if (stats.size < 1024 * 1024) {
        console.log(`   ${f} - ${sizeKB} KB`);
      } else {
        console.log(`   ${f} - ${sizeMB} MB`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
