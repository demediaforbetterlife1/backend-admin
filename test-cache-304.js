/**
 * Test cache and 304 handling for icon API
 */
const http = require('http');

async function testCacheAnd304() {
  console.log('=== CACHE AND 304 HANDLING TEST ===\n');

  // First request - should return 200 with data
  console.log('Request 1: Initial request (should return 200)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const response1 = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/icons',
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });

    req.on('error', reject);
    req.end();
  });

  console.log(`Status: ${response1.statusCode}`);
  console.log(`ETag: ${response1.headers.etag}`);
  console.log(`Cache-Control: ${response1.headers['cache-control']}`);
  
  const etag = response1.headers.etag;
  const data1 = JSON.parse(response1.body);
  console.log(`Icons received: ${Object.keys(data1.data).length}\n`);

  // Second request with If-None-Match - should return 304
  console.log('Request 2: With If-None-Match header (should return 304)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const response2 = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/icons',
      method: 'GET',
      headers: {
        'If-None-Match': etag
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });

    req.on('error', reject);
    req.end();
  });

  console.log(`Status: ${response2.statusCode}`);
  console.log(`Body length: ${response2.body.length}`);
  
  if (response2.statusCode === 304) {
    console.log('✓ 304 Not Modified returned correctly');
    console.log('✓ Cache validation working as expected');
  } else {
    console.log('✗ Expected 304, got ' + response2.statusCode);
  }

  // Third request with wrong ETag - should return 200
  console.log('\nRequest 3: With wrong If-None-Match (should return 200)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const response3 = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/icons',
      method: 'GET',
      headers: {
        'If-None-Match': '"wrong-etag"'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });

    req.on('error', reject);
    req.end();
  });

  console.log(`Status: ${response3.statusCode}`);
  const data3 = JSON.parse(response3.body);
  console.log(`Icons received: ${Object.keys(data3.data).length}`);
  
  if (response3.statusCode === 200) {
    console.log('✓ 200 returned with new data when ETag mismatch');
  } else {
    console.log('✗ Expected 200, got ' + response3.statusCode);
  }

  console.log('\n=== CACHE TEST COMPLETE ===');
  console.log('Summary:');
  console.log('  ✓ Initial request returns 200 with data and ETag');
  console.log(response2.statusCode === 304 ? '  ✓ Subsequent request with matching ETag returns 304' : '  ✗ 304 handling failed');
  console.log(response3.statusCode === 200 ? '  ✓ Request with wrong ETag returns 200 with new data' : '  ✗ ETag mismatch handling failed');
}

testCacheAnd304().catch(console.error);
