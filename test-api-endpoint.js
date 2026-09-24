/**
 * Test the /api/icons endpoint to verify it returns correct navigation icon data
 */
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/icons',
  method: 'GET',
};

console.log('Testing /api/icons endpoint...\n');

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers: ${JSON.stringify(res.headers, null, 2)}\n`);

  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Response parsed successfully\n');
      
      // Check navigation icons
      const navKeys = ['nav.home', 'nav.rooms', 'nav.moments', 'nav.profile'];
      
      console.log('=== Navigation Icons Check ===\n');
      for (const key of navKeys) {
        if (json.data && json.data[key]) {
          const icon = json.data[key];
          console.log(`${key}:`);
          console.log(`  URL: ${icon.url}`);
          console.log(`  Default URL: ${icon.defaultUrl}`);
          console.log(`  MIME Type: ${icon.mimeType}`);
          console.log(`  Version: ${icon.version}`);
          console.log('');
        } else {
          console.log(`${key}: NOT FOUND IN API RESPONSE\n`);
        }
      }
    } catch (e) {
      console.error('Error parsing JSON:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.end();
