const http = require('http');

console.log('\n=== Testing /api/icons endpoint ===\n');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/icons',
  method: 'GET',
  headers: {
    'Accept': 'application/json'
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers:`, JSON.stringify(res.headers, null, 2));
  
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('\nResponse:\n');
      console.log(JSON.stringify(json, null, 2));
      
      // Check for bottom nav icons specifically
      console.log('\n=== Bottom Nav Icons ===\n');
      const bottomNavKeys = ['nav.home', 'nav.rooms', 'nav.moments', 'nav.profile'];
      
      if (json.data) {
        bottomNavKeys.forEach(key => {
          const icon = json.data[key];
          if (icon) {
            console.log(`${key}:`);
            console.log(`  URL: ${icon.url}`);
            console.log(`  Version: ${icon.version}`);
            console.log('');
          } else {
            console.log(`${key}: NOT FOUND`);
          }
        });
      }
    } catch (e) {
      console.log('\nRaw response:');
      console.log(data);
    }
  });
});

req.on('error', (e) => {
  console.error(`Error: ${e.message}`);
  console.log('\nIs the backend running on port 3000?');
});

req.end();
