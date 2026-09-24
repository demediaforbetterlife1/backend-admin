const http = require('http');

async function testIconsApi() {
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/icons',
    method: 'GET',
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Headers:');
        console.log('  ETag:', res.headers['etag']);
        console.log('  Cache-Control:', res.headers['cache-control']);
        console.log('  X-Icon-Source:', res.headers['x-icon-source']);
        
        try {
          const json = JSON.parse(data);
          console.log('\nResponse keys:', Object.keys(json));
          
          if (json.success && json.data) {
            console.log('\nNavigation icons in response:');
            for (const key of ['nav_home', 'nav_rooms', 'nav_moments', 'nav_profile']) {
              const icon = json.data[key];
              if (icon) {
                console.log(`  ${key}:`);
                console.log(`    url: ${icon.url}`);
                console.log(`    fallback: ${icon._fallback || false}`);
              } else {
                console.log(`  ${key}: NOT FOUND`);
              }
            }
          }
          resolve({ status: res.statusCode, headers: res.headers, data: json });
        } catch (e) {
          console.error('Error parsing JSON:', e.message);
          reject(e);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Request error:', error.message);
      reject(error);
    });

    req.end();
  });
}

testIconsApi()
  .then(() => console.log('\n✓ API test complete'))
  .catch(err => console.error('✗ API test failed:', err.message));