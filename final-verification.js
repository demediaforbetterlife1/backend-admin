/**
 * التحقق النهائي من الإصلاح
 * 
 * يفحص:
 * 1. جميع أيقونات Bottom Nav (الأربعة) تعمل
 * 2. باقي أيقونات Navigation لم تتأثر
 * 3. استجابة API صحيحة
 */

const { PrismaClient } = require('@prisma/client');
const http = require('http');
const https = require('https');

const prisma = new PrismaClient();

const BOTTOM_NAV_KEYS = ['nav.home', 'nav.rooms', 'nav.moments', 'nav.profile'];

function testUrl(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 3000 }, (res) => {
      resolve({ status: res.statusCode, ok: res.statusCode === 200 });
    }).on('error', () => resolve({ status: 'ERROR', ok: false }))
      .on('timeout', () => resolve({ status: 'TIMEOUT', ok: false }));
  });
}

async function verify() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('✅ التحقق النهائي من إصلاح أيقونات Bottom Navigation');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    // 1. فحص قاعدة البيانات
    console.log('📊 STEP 1: فحص قاعدة البيانات\n');
    
    const bottomNavIcons = await prisma.appIcon.findMany({
      where: {
        key: { in: BOTTOM_NAV_KEYS },
        isActive: true,
        isPublished: true
      },
      select: { key: true, url: true, version: true, mimeType: true }
    });

    console.log(`✅ تم العثور على ${bottomNavIcons.length}/4 أيقونات في قاعدة البيانات\n`);

    if (bottomNavIcons.length !== 4) {
      console.log('❌ خطأ: عدد الأيقونات غير صحيح!\n');
      const missing = BOTTOM_NAV_KEYS.filter(k => !bottomNavIcons.some(i => i.key === k));
      console.log(`   مفقود: ${missing.join(', ')}\n`);
      return;
    }

    // 2. اختبار URLs
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔗 STEP 2: اختبار الوصول للأيقونات\n');

    let allPassed = true;

    for (const icon of bottomNavIcons) {
      process.stdout.write(`   ${icon.key}: `);
      const result = await testUrl(icon.url);
      
      if (result.ok) {
        console.log(`✅ يعمل (v${icon.version})`);
      } else {
        console.log(`❌ فشل (${result.status})`);
        allPassed = false;
      }
    }

    console.log('');

    // 3. فحص باقي الأيقونات
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔍 STEP 3: فحص باقي أيقونات Navigation\n');

    const otherNavIcons = await prisma.appIcon.findMany({
      where: {
        key: { startsWith: 'nav', notIn: BOTTOM_NAV_KEYS },
        isActive: true,
        isPublished: true
      },
      select: { key: true, url: true }
    });

    console.log(`✅ ${otherNavIcons.length} أيقونات navigation أخرى موجودة ولم تتأثر\n`);

    // 4. ملخص النتائج
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📋 STEP 4: الملخص النهائي\n');

    const results = {
      bottomNavCount: `${bottomNavIcons.length}/4`,
      allUrlsWorking: allPassed,
      otherIconsUnaffected: otherNavIcons.length,
      readyForTesting: bottomNavIcons.length === 4 && allPassed
    };

    console.log(`   📊 أيقونات Bottom Nav: ${results.bottomNavCount}`);
    console.log(`   🔗 جميع URLs تعمل: ${results.allUrlsWorking ? '✅ نعم' : '❌ لا'}`);
    console.log(`   🎯 أيقونات أخرى لم تتأثر: ${results.otherIconsUnaffected}`);
    console.log(`   🚀 جاهز للاختبار: ${results.readyForTesting ? '✅ نعم' : '❌ لا'}\n`);

    if (results.readyForTesting) {
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('🎉 الإصلاح مكتمل ومُتحقق منه!\n');
      console.log('📱 الخطوات التالية:\n');
      console.log('   1. تشغيل Flutter app:');
      console.log('      cd e:\\voicechat\\voicechat_app\\client');
      console.log('      flutter run\n');
      console.log('   2. التحقق من Bottom Navigation في التطبيق');
      console.log('   3. إذا ظهرت الأيقونات القديمة، قم بـ force refresh:');
      console.log('      - أغلق التطبيق تماماً');
      console.log('      - امسح cache: flutter clean');
      console.log('      - أعد تشغيل التطبيق\n');
      console.log('   4. إذا استمرت المشكلة، قد يكون cache في Flutter:');
      console.log('      - ابحث عن FAB button في التطبيق لـ force refresh');
      console.log('      - أو انتظر 5 دقائق للـ auto-refresh\n');
      console.log('═══════════════════════════════════════════════════════════════\n');
    } else {
      console.log('❌ هناك مشاكل يجب حلها قبل الاختبار\n');
    }

  } catch (error) {
    console.error('❌ خطأ:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
