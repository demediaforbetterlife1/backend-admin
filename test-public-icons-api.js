/**
 * اختبار API /api/icons بعد التعديل
 */

const http = require('http');

const BACKEND_URL = 'http://localhost:3000';

function testIconsApi() {
  return new Promise((resolve) => {
    console.log('🧪 اختبار Backend API: GET /api/icons\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/icons',
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      timeout: 10000,
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log(`📊 Status: ${res.statusCode}`);
        console.log(`📋 Headers: ${JSON.stringify(res.headers, null, 2)}\n`);

        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            console.log('✅ Response parsed successfully\n');
            console.log('📦 Response structure:');
            console.log(`   - success: ${json.success}`);
            console.log(`   - etag: ${json.etag}`);
            console.log(`   - data keys: ${Object.keys(json.data || {}).length}\n`);

            if (json.data) {
              const navIcons = Object.keys(json.data).filter(key => key.startsWith('nav.'));
              console.log('🔍 Navigation icons found:');
              navIcons.forEach(key => {
                const icon = json.data[key];
                console.log(`   - ${key}: ${icon.url ? '✅ has URL' : '❌ no URL'}`);
              });
            }

            console.log('\n═══════════════════════════════════════════════════════════');
            console.log('✅ Backend API يعمل بشكل صحيح!\n');
            resolve({ success: true, data: json });
          } catch (e) {
            console.log('❌ Failed to parse JSON:', e.message);
            console.log('Raw response:', data);
            resolve({ success: false, error: e.message });
          }
        } else if (res.statusCode === 304) {
          console.log('✅ 304 Not Modified - ETag caching working\n');
          resolve({ success: true, status: 304 });
        } else {
          console.log(`❌ Unexpected status: ${res.statusCode}`);
          console.log('Response:', data);
          resolve({ success: false, status: res.statusCode });
        }
      });
    });

    req.on('error', (err) => {
      console.log(`❌ Request failed: ${err.message}`);
      console.log('💡 تأكد من أن Backend يعمل على port 3000\n');
      resolve({ success: false, error: err.message });
    });

    req.on('timeout', () => {
      console.log('❌ Request timeout');
      req.destroy();
      resolve({ success: false, error: 'timeout' });
    });

    req.end();
  });
}

async function runTest() {
  const result = await testIconsApi();
  
  if (result.success) {
    console.log('🎉 الاختبار نجح! يمكنك الآن تشغيل تطبيق Flutter.\n');
  } else {
    console.log('❌ الاختبار فشل. تحقق من:\n');
    console.log('   1. هل Backend يعمل على http://localhost:3000?');
    console.log('   2. هل Admin Dashboard يعمل على http://localhost:3001?');
    console.log('   3. هل تم إضافة ADMIN_DASHBOARD_URL إلى .env?\n');
  }
}

runTest();
