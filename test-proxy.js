const http = require('http');

console.log('\n=== Testing Icon Proxy ===\n');

// Test 1: API response
http.get('http://localhost:3000/api/icons', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    console.log('1. API Response for nav.home:');
    console.log('   URL:', json.data['nav.home'].url);
    console.log('   Original URL:', json.data['nav.home']._originalUrl);
    console.log('');
    
    // Test 2: Proxy endpoint
    const filename = json.data['nav.home']._originalUrl.split('/').pop();
    console.log('2. Testing proxy endpoint:');
    console.log('   Filename:', filename);
    console.log('   Proxy URL: /api/icon-proxy/' + filename);
    console.log('');
    
    http.get(`http://localhost:3000/api/icon-proxy/${filename}`, (proxyRes) => {
      console.log('3. Proxy Response:');
      console.log('   Status:', proxyRes.statusCode);
      console.log('   Content-Type:', proxyRes.headers['content-type']);
      console.log('   Access-Control-Allow-Origin:', proxyRes.headers['access-control-allow-origin']);
      console.log('');
      
      if (proxyRes.statusCode === 200) {
        console.log('✅ Proxy works!');
      } else {
        console.log('❌ Proxy failed');
      }
    }).on('error', err => {
      console.log('❌ Proxy error:', err.message);
    });
  });
}).on('error', err => {
  console.log('❌ API error:', err.message);
});
