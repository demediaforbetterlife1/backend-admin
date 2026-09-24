/**
 * فحص جميع الأيقونات في قاعدة البيانات
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAllIcons() {
  console.log('🔍 فحص جميع الأيقونات في قاعدة البيانات...\n');

  const icons = await prisma.appIcon.findMany({
    orderBy: {
      key: 'asc'
    }
  });

  console.log(`Found ${icons.length} icons total:\n`);

  for (const icon of icons) {
    console.log(`📌 ${icon.key}:`);
    console.log(`   URL: ${icon.url}`);
    console.log(`   Version: v${icon.version}`);
    console.log(`   Published: ${icon.publishedAt}\n`);
  }

  if (icons.length === 0) {
    console.log('❌ جدول appIcon فارغ تماماً!');
    console.log('💡 تحتاج إلى رفع الأيقونات من Admin Dashboard\n');
  }

  await prisma.$disconnect();
}

checkAllIcons();
