/**
 * فحص الأيقونات الموجودة في قاعدة البيانات
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkIcons() {
  console.log('🔍 فحص الأيقونات في قاعدة البيانات...\n');

  const icons = await prisma.appIcon.findMany({
    where: {
      key: {
        startsWith: 'nav.'
      }
    },
    orderBy: {
      key: 'asc'
    }
  });

  console.log(`Found ${icons.length} navigation icons:\n`);

  for (const icon of icons) {
    console.log(`📌 ${icon.key}:`);
    console.log(`   URL: ${icon.url}`);
    console.log(`   Version: v${icon.version}`);
    console.log(`   Published: ${icon.publishedAt}\n`);
  }

  if (icons.length === 0) {
    console.log('❌ لا توجد أيقونات navigation في قاعدة البيانات!');
    console.log('💡 تحتاج إلى إضافة الأيقونات من Admin Dashboard\n');
  }

  await prisma.$disconnect();
}

checkIcons();
