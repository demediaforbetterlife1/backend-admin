/**
 * إصلاح URLs أيقونات Bottom Navigation
 * 
 * المشكلة: URLs في قاعدة البيانات تشير لملفات غير موجودة (404)
 * الحل: تحديث URLs لتشير للملفات الموجودة فعلياً في voice-admin-dashboard/public/icons
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('🔧 إصلاح URLs أيقونات Bottom Navigation');
console.log('═══════════════════════════════════════════════════════════════\n');

// التعيينات الصحيحة بناءً على الملفات الموجودة فعلياً
const iconFixes = [
  {
    key: 'nav.home',
    oldUrl: 'http://192.168.1.3:3001/icons/chatgpt_image_aug_6_2026_05_23_01_am_1786369926054.png',
    newUrl: 'http://192.168.1.3:3001/icons/navhome_1__1786989519863.png',
    reason: 'الملف القديم غير موجود، استخدام navhome_1__1786989519863.png'
  },
  {
    key: 'nav.moments',
    oldUrl: 'http://192.168.1.3:3001/icons/chatgpt_image_aug_6_2026_05_22_54_am_1786284315499.png',
    newUrl: 'http://192.168.1.3:3001/icons/navmoments_1787056562485.png',
    reason: 'الملف القديم غير موجود، استخدام navmoments_1787056562485.png'
  },
  {
    key: 'nav.profile',
    oldUrl: 'http://192.168.1.3:3001/icons/chatgpt_image_aug_16_2026_09_22_30_am_1786861365405.png',
    newUrl: 'http://192.168.1.3:3001/icons/chatgpt_image_aug_16_2026_09_22_30_am_1787056557889.png',
    reason: 'الملف القديم غير موجود، استخدام الملف المشابه المتاح'
  }
];

async function fixIconUrls() {
  try {
    console.log('📋 الإصلاحات المخطط لها:\n');
    
    for (const fix of iconFixes) {
      console.log(`🔹 ${fix.key}`);
      console.log(`   قديم: ${fix.oldUrl}`);
      console.log(`   جديد: ${fix.newUrl}`);
      console.log(`   السبب: ${fix.reason}`);
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('⚙️ بدء التحديث...\n');

    let updatedCount = 0;
    let failedCount = 0;

    for (const fix of iconFixes) {
      try {
        // البحث عن الأيقونة
        const icon = await prisma.appIcon.findUnique({
          where: { key: fix.key }
        });

        if (!icon) {
          console.log(`⚠️ ${fix.key}: غير موجودة في قاعدة البيانات`);
          failedCount++;
          continue;
        }

        // تحديث URL
        const updated = await prisma.appIcon.update({
          where: { key: fix.key },
          data: {
            url: fix.newUrl,
            version: icon.version + 1,
            isPending: false,
            isPublished: true,
            isActive: true,
            publishedAt: new Date(),
            updatedAt: new Date()
          }
        });

        console.log(`✅ ${fix.key}: تم التحديث بنجاح`);
        console.log(`   الإصدار: ${icon.version} → ${updated.version}`);
        updatedCount++;
        
      } catch (error) {
        console.log(`❌ ${fix.key}: فشل التحديث`);
        console.log(`   الخطأ: ${error.message}`);
        failedCount++;
      }
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 ملخص الإصلاح\n');
    console.log(`✅ تم التحديث بنجاح: ${updatedCount}`);
    console.log(`❌ فشل: ${failedCount}`);
    console.log(`📝 الإجمالي: ${iconFixes.length}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (updatedCount > 0) {
      console.log('🎯 الخطوة التالية:');
      console.log('   1. تشغيل سكربت التحقق: node diagnose-nav-icons-issue.js');
      console.log('   2. تشغيل Flutter app للتحقق من الأيقونات');
      console.log('   3. قد تحتاج لعمل force refresh في التطبيق لتحديث cache\n');
    }

  } catch (error) {
    console.error('❌ خطأ عام:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixIconUrls();
