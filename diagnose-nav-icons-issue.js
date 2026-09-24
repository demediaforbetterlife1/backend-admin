/**
 * تشخيص شامل لمشكلة أيقونات Bottom Navigation
 * 
 * هذا السكربت يفحص:
 * 1. استجابة API من /api/icons
 * 2. تطابق الـ keys (dots vs underscores)
 * 3. وجود URLs وصحتها
 * 4. إمكانية الوصول للملفات
 * 5. mime types للملفات
 */

const { PrismaClient } = require('@prisma/client');
const https = require('https');
const http = require('http');

const prisma = new PrismaClient();

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('🔍 تشخيص شامل لمشكلة أيقونات Bottom Navigation');
console.log('═══════════════════════════════════════════════════════════════\n');

// الأيقونات المتوقعة في Flutter
const EXPECTED_FLUTTER_KEYS = [
  'nav.home',
  'nav.rooms', 
  'nav.moments',
  'nav.profile'
];

async function testUrlAccess(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    
    client.get(url, { timeout: 5000 }, (res) => {
      resolve({
        status: res.statusCode,
        contentType: res.headers['content-type'],
        contentLength: res.headers['content-length']
      });
    }).on('error', (err) => {
      resolve({
        status: 'ERROR',
        error: err.message
      });
    }).on('timeout', () => {
      resolve({
        status: 'TIMEOUT',
        error: 'Request timeout after 5 seconds'
      });
    });
  });
}

async function diagnose() {
  try {
    console.log('📊 STEP 1: فحص قاعدة البيانات\n');
    console.log('─────────────────────────────────────────────────────────────\n');

    // جلب جميع أيقونات navigation المنشورة والمفعّلة
    const navIcons = await prisma.appIcon.findMany({
      where: {
        isActive: true,
        isPublished: true,
        key: {
          startsWith: 'nav'
        }
      },
      select: {
        id: true,
        key: true,
        displayName: true,
        category: true,
        url: true,
        defaultUrl: true,
        mimeType: true,
        version: true,
        etag: true,
        isActive: true,
        isPublished: true,
        isPending: true,
        publishedAt: true,
        updatedAt: true
      },
      orderBy: { key: 'asc' }
    });

    console.log(`✅ تم العثور على ${navIcons.length} أيقونة navigation في قاعدة البيانات\n`);

    if (navIcons.length === 0) {
      console.log('❌ المشكلة: لا توجد أيقونات navigation في قاعدة البيانات!');
      console.log('   الحل: يجب رفع الأيقونات من Admin Dashboard\n');
      return;
    }

    // تحليل كل أيقونة
    const analysis = {
      hasCorrectKeys: [],
      hasWrongKeys: [],
      missingUrls: [],
      hasUrls: [],
      matchesFlutter: [],
      notInFlutter: []
    };

    console.log('تفاصيل الأيقونات:\n');
    
    for (const icon of navIcons) {
      console.log(`📌 ${icon.key}`);
      console.log(`   الاسم: ${icon.displayName}`);
      console.log(`   الفئة: ${icon.category}`);
      console.log(`   الإصدار: ${icon.version}`);
      console.log(`   مفعّلة: ${icon.isActive ? '✅' : '❌'}`);
      console.log(`   منشورة: ${icon.isPublished ? '✅' : '❌'}`);
      console.log(`   معلقة: ${icon.isPending ? '⚠️' : '✅'}`);
      
      // فحص الـ key format
      if (icon.key.includes('.')) {
        analysis.hasCorrectKeys.push(icon.key);
        console.log(`   تنسيق المفتاح: ✅ صحيح (يستخدم نقطة)`);
      } else if (icon.key.includes('_')) {
        analysis.hasWrongKeys.push(icon.key);
        console.log(`   تنسيق المفتاح: ❌ خطأ (يستخدم شرطة سفلية بدل نقطة)`);
      }

      // فحص URL
      if (!icon.url || icon.url.trim() === '') {
        analysis.missingUrls.push(icon.key);
        console.log(`   URL: ❌ مفقود!`);
      } else {
        analysis.hasUrls.push(icon.key);
        console.log(`   URL: ✅ ${icon.url}`);
        console.log(`   MIME Type: ${icon.mimeType || 'غير محدد'}`);
      }

      // فحص المطابقة مع Flutter
      if (EXPECTED_FLUTTER_KEYS.includes(icon.key)) {
        analysis.matchesFlutter.push(icon.key);
        console.log(`   مطابقة Flutter: ✅ نعم`);
      } else {
        analysis.notInFlutter.push(icon.key);
        console.log(`   مطابقة Flutter: ⚠️ لا (لن تظهر في Bottom Nav)`);
      }

      console.log('');
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📊 STEP 2: ملخص التحليل\n');
    console.log('─────────────────────────────────────────────────────────────\n');

    console.log(`✅ أيقونات بتنسيق صحيح (.): ${analysis.hasCorrectKeys.length}`);
    if (analysis.hasCorrectKeys.length > 0) {
      console.log(`   ${analysis.hasCorrectKeys.join(', ')}`);
    }

    console.log(`\n❌ أيقونات بتنسيق خاطئ (_): ${analysis.hasWrongKeys.length}`);
    if (analysis.hasWrongKeys.length > 0) {
      console.log(`   ${analysis.hasWrongKeys.join(', ')}`);
      console.log(`   ⚠️ هذه الأيقونات لن تعمل في Flutter!`);
    }

    console.log(`\n✅ أيقونات لديها URLs: ${analysis.hasUrls.length}`);
    console.log(`❌ أيقونات بدون URLs: ${analysis.missingUrls.length}`);
    if (analysis.missingUrls.length > 0) {
      console.log(`   ${analysis.missingUrls.join(', ')}`);
    }

    console.log(`\n✅ أيقونات مطابقة لـ Flutter: ${analysis.matchesFlutter.length}`);
    if (analysis.matchesFlutter.length > 0) {
      console.log(`   ${analysis.matchesFlutter.join(', ')}`);
    }

    console.log(`\n⚠️ أيقونات غير مطابقة لـ Flutter: ${analysis.notInFlutter.length}`);
    if (analysis.notInFlutter.length > 0) {
      console.log(`   ${analysis.notInFlutter.join(', ')}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📊 STEP 3: فحص الأيقونات الأربعة المطلوبة في Flutter\n');
    console.log('─────────────────────────────────────────────────────────────\n');

    const flutterIconsStatus = {};
    
    for (const expectedKey of EXPECTED_FLUTTER_KEYS) {
      const icon = navIcons.find(i => i.key === expectedKey);
      
      console.log(`📱 ${expectedKey}:`);
      
      if (!icon) {
        console.log(`   ❌ غير موجودة في قاعدة البيانات`);
        flutterIconsStatus[expectedKey] = 'MISSING_FROM_DB';
      } else if (!icon.url || icon.url.trim() === '') {
        console.log(`   ❌ موجودة لكن بدون URL`);
        flutterIconsStatus[expectedKey] = 'NO_URL';
      } else if (!icon.isPublished) {
        console.log(`   ⚠️ موجودة لكن غير منشورة`);
        flutterIconsStatus[expectedKey] = 'NOT_PUBLISHED';
      } else if (!icon.isActive) {
        console.log(`   ⚠️ موجودة لكن غير مفعّلة`);
        flutterIconsStatus[expectedKey] = 'NOT_ACTIVE';
      } else {
        console.log(`   ✅ موجودة ومنشورة ومفعّلة`);
        console.log(`   📎 URL: ${icon.url}`);
        flutterIconsStatus[expectedKey] = 'OK';
      }
      console.log('');
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📊 STEP 4: اختبار الوصول للـ URLs\n');
    console.log('─────────────────────────────────────────────────────────────\n');

    const urlTests = [];
    
    for (const icon of navIcons) {
      if (icon.url && icon.url.trim() !== '') {
        console.log(`🔗 اختبار: ${icon.key}`);
        console.log(`   URL: ${icon.url}`);
        
        const result = await testUrlAccess(icon.url);
        
        if (result.status === 200) {
          console.log(`   ✅ HTTP ${result.status} - يعمل بشكل صحيح`);
          console.log(`   📄 Content-Type: ${result.contentType}`);
          console.log(`   📊 Size: ${result.contentLength} bytes`);
          urlTests.push({ key: icon.key, status: 'SUCCESS' });
        } else if (result.status === 'ERROR') {
          console.log(`   ❌ خطأ: ${result.error}`);
          urlTests.push({ key: icon.key, status: 'ERROR', error: result.error });
        } else if (result.status === 'TIMEOUT') {
          console.log(`   ⏱️ انتهت المهلة`);
          urlTests.push({ key: icon.key, status: 'TIMEOUT' });
        } else {
          console.log(`   ❌ HTTP ${result.status} - فشل`);
          urlTests.push({ key: icon.key, status: result.status });
        }
        console.log('');
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('🎯 STEP 5: تحديد السبب الجذري والحل\n');
    console.log('─────────────────────────────────────────────────────────────\n');

    const issues = [];
    const solutions = [];

    // فحص 1: أيقونات مفقودة
    const missingFlutterKeys = EXPECTED_FLUTTER_KEYS.filter(
      key => !navIcons.some(icon => icon.key === key)
    );
    if (missingFlutterKeys.length > 0) {
      issues.push(`❌ أيقونات مفقودة من قاعدة البيانات: ${missingFlutterKeys.join(', ')}`);
      solutions.push(`📝 يجب إضافة هذه الأيقونات من Admin Dashboard`);
    }

    // فحص 2: تنسيق خاطئ للمفاتيح
    if (analysis.hasWrongKeys.length > 0) {
      issues.push(`❌ أيقونات بتنسيق خاطئ (underscore بدل dot): ${analysis.hasWrongKeys.join(', ')}`);
      solutions.push(`🔧 تشغيل سكربت لتحويل _ إلى . في جميع المفاتيح`);
    }

    // فحص 3: أيقونات بدون URLs
    const flutterIconsWithoutUrls = EXPECTED_FLUTTER_KEYS.filter(
      key => {
        const icon = navIcons.find(i => i.key === key);
        return icon && (!icon.url || icon.url.trim() === '');
      }
    );
    if (flutterIconsWithoutUrls.length > 0) {
      issues.push(`❌ أيقونات Flutter بدون URLs: ${flutterIconsWithoutUrls.join(', ')}`);
      solutions.push(`📤 يجب رفع صور لهذه الأيقونات من Admin Dashboard`);
    }

    // فحص 4: أيقونات غير منشورة
    const unpublishedFlutterIcons = EXPECTED_FLUTTER_KEYS.filter(
      key => {
        const icon = navIcons.find(i => i.key === key);
        return icon && !icon.isPublished;
      }
    );
    if (unpublishedFlutterIcons.length > 0) {
      issues.push(`⚠️ أيقونات Flutter غير منشورة: ${unpublishedFlutterIcons.join(', ')}`);
      solutions.push(`✅ نشر الأيقونات من Admin Dashboard`);
    }

    // فحص 5: URLs فاشلة
    const failedUrls = urlTests.filter(t => t.status !== 'SUCCESS');
    if (failedUrls.length > 0) {
      issues.push(`❌ URLs لا يمكن الوصول إليها: ${failedUrls.map(t => t.key).join(', ')}`);
      solutions.push(`🔗 فحص إعدادات الباك اند والتأكد من أن الخادم يعمل على الـ port الصحيح`);
      solutions.push(`🔗 التأكد من أن مسار الملفات صحيح (Cloudinary أو localhost)`);
    }

    if (issues.length === 0) {
      console.log('✅ لم يتم اكتشاف أي مشاكل واضحة!\n');
      console.log('ℹ️ قد تكون المشكلة:');
      console.log('   • Cache قديم في Flutter (جرب force refresh)');
      console.log('   • مشكلة في CachedNetworkImage widget');
      console.log('   • مشكلة في الشبكة بين الجهاز والخادم\n');
    } else {
      console.log('🔴 المشاكل المكتشفة:\n');
      issues.forEach((issue, i) => console.log(`   ${i + 1}. ${issue}`));
      
      console.log('\n💡 الحلول المقترحة:\n');
      solutions.forEach((sol, i) => console.log(`   ${i + 1}. ${sol}`));
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ انتهى التشخيص');
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ خطأ أثناء التشخيص:', error);
  } finally {
    await prisma.$disconnect();
  }
}

diagnose();
