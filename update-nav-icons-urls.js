/**
 * تحديث URLs الأيقونات في قاعدة البيانات لاستخدام localhost بدلاً من IP
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const iconUpdates = [
  {
    key: 'nav.home',
    newUrl: 'http://localhost:3001/icons/navhome_1__1787139703087.png'
  },
  {
    key: 'nav.rooms',
    newUrl: 'http://localhost:3001/icons/navvoicerooms_1787139744106.png'
  },
  {
    key: 'nav.moments',
    newUrl: 'http://localhost:3001/icons/navmoments_1787056562485.png'
  },
  {
    key: 'nav.profile',
    newUrl: 'http://localhost:3001/icons/chatgpt_image_aug_16_2026_09_22_30_am_1787056557889.png'
  }
];

async function updateIcons() {
  console.log('� تحديث URLs الأيقونات في قاعدة البيانات...\n');

  for (const update of iconUpdates) {
    try {
      const icon = await prisma.appIcon.findUnique({
        where: { key: update.key }
      });

      if (!icon) {
        console.log(`❌ ${update.key}: غير موجود في قاعدة البيانات`);
        continue;
      }

      const updated = await prisma.appIcon.update({
        where: { key: update.key },
        data: {
          url: update.newUrl,
          version: icon.version + 1,
          publishedAt: new Date()
        }
      });

      console.log(`✅ ${update.key}: تم التحديث من v${icon.version} إلى v${updated.version}`);
      console.log(`   Old URL: ${icon.url}`);
      console.log(`   New URL: ${updated.url}\n`);
    } catch (error) {
      console.log(`❌ ${update.key}: فشل التحديث - ${error.message}\n`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ تم تحديث جميع الأيقونات بنجاح!\n');

  await prisma.$disconnect();
}

updateIcons();
