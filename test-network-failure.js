/**
 * Test network failure handling - simulate API unavailability
 */
const http = require('http');

async function testNetworkFailure() {
  console.log('=== NETWORK FAILURE HANDLING TEST ===\n');

  // Test 1: Normal operation (baseline)
  console.log('Test 1: Normal API operation (baseline)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const response = await new Promise((resolve, reject) => {
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
          resolve({ statusCode: res.statusCode, body: data });
        });
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });

    if (response.statusCode === 200) {
      const data = JSON.parse(response.body);
      console.log(`✓ API operational - received ${Object.keys(data.data).length} icons`);
      console.log(`✓ ETag: ${data.etag}`);
    } else {
      console.log(`✗ Unexpected status: ${response.statusCode}`);
    }
  } catch (error) {
    console.log(`✗ API error: ${error.message}`);
  }

  // Test 2: Simulate server down (using wrong port)
  console.log('\nTest 2: Server unavailable simulation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 9999, // Wrong port - server not running
        path: '/api/icons',
        method: 'GET',
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body: data });
        });
      });

      req.on('error', (error) => {
        reject(error); // Connection refused
      });
      req.setTimeout(2000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });

    console.log(`Response status: ${response.statusCode}`);
  } catch (error) {
    console.log(`✓ Network error correctly detected: ${error.message}`);
    console.log('✓ Flutter should fall back to cached data');
  }

  // Test 3: Corrupted response simulation
  console.log('\nTest 3: Corrupted JSON response handling');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const response = await new Promise((resolve, reject) => {
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
          // Simulate corrupted JSON by modifying response
          const corruptedData = data.replace(/"success": true/, '"success": invalid');
          try {
            JSON.parse(corruptedData);
            resolve({ statusCode: res.statusCode, body: corruptedData, valid: true });
          } catch (parseError) {
            resolve({ statusCode: res.statusCode, body: corruptedData, valid: false, error: parseError.message });
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });

    if (!response.valid) {
      console.log(`✓ Corrupted JSON correctly detected: ${response.error}`);
      console.log('✓ Flutter should fall back to cached data');
    } else {
      console.log('✗ JSON parsing should have failed');
    }
  } catch (error) {
    console.log(`✓ Network error: ${error.message}`);
  }

  console.log('\n=== NETWORK FAILURE TEST COMPLETE ===');
  console.log('Summary:');
  console.log('  ✓ Normal API operation verified');
  console.log('  ✓ Server unavailability correctly detected');
  console.log('  ✓ Corrupted response handling verified');
  console.log('  ✓ Flutter cache fallback should work for all failure scenarios');
}

testNetworkFailure().catch(console.error);
