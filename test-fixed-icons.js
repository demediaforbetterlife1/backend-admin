/**
 * اختبار سريع للأيقونات الأربعة بعد الإصلاح
 */

const http = require('http');

const ICONS_TO_TEST = [
  { key: 'nav.home', url: 'http://localhost:3001/icons/navhome_1__1787139703087.png' },
  { key: 'nav.rooms', url: 'http://localhost:3001/icons/navvoicerooms_1787139744106.png' },
  { key: 'nav.moments', url: 'http://localhost:3001/icons/navmoments_1787056562485.png' },
  { key: 'nav.profile', url: 'http://localhost:3001/icons/chatgpt_image_aug_16_2026_09_22_30_am_1787056557889.png' }
];

function testUrl(url) {
  return new Promise((resolve) => {
    http.get(url, { timeout: 3000 }, (res) => {
      resolve({
        status: res.statusCode,
        contentType: res.headers['content-type']
      });
    }).on('error', (err) => {
      resolve({ status: 'ERROR', error: err.message });
    }).on('timeout', () => {
      resolve({ status: 'TIMEOUT' });
    });
  });
}

async function testIcons() {
  console.log('\n🧪 اختبار أيقونات Bottom Navigation بعد الإصلاح\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  let passCount = 0;
  let failCount = 0;

  for (const icon of ICONS_TO_TEST) {
    process.stdout.write(`🔗 ${icon.key}: `);
    
    const result = await testUrl(icon.url);
    
    if (result.status === 200) {
      console.log(`✅ يعمل (${result.contentType})`);
      passCount++;
    } else if (result.status === 'ERROR') {
      console.log(`❌ خطأ: ${result.error}`);
      failCount++;
    } else if (result.status === 'TIMEOUT') {
      console.log(`⏱️ انتهت المهلة`);
      failCount++;
    } else {
      console.log(`❌ HTTP ${result.status}`);
      failCount++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`\n📊 النتيجة: ${passCount}/${ICONS_TO_TEST.length} تعمل بشكل صحيح\n`);

  if (passCount === ICONS_TO_TEST.length) {
    console.log('✅ جميع الأيقونات تعمل! يمكنك الآن تشغيل Flutter app.\n');
  } else {
    console.log('❌ بعض الأيقونات لا تزال لا تعمل. تحقق من:\n');
    console.log('   1. هل voice-admin-dashboard يعمل على http://192.168.1.3:3001?');
    console.log('   2. هل الملفات موجودة في voice-admin-dashboard/public/icons?');
    console.log('   3. هل الشبكة المحلية تعمل بشكل صحيح?\n');
  }
}

testIcons();
