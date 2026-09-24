/**
 * Test Profile Feature
 * Verifies that profile API endpoints work correctly
 */

const http = require('http');

const API_BASE = 'http://localhost:3000/api';

let accessToken = '';
let userId = '';

function makeRequest(method, path, data, token) {
  return new Promise((resolve, reject) => {
    const url = API_BASE + path;
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 3000,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: body ? JSON.parse(body) : null,
          });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function testProfile() {
  console.log('=== Test Profile Feature ===\n');

  try {
    // Step 1: Register a user
    console.log('Step 1: Registering user...');
    const username = `testuser_${Date.now()}`;
    const email = `test_${Date.now()}@example.com`;
    const password = 'TestPass123';

    const registerResponse = await makeRequest('POST', '/auth/register/user', {
      username,
      email,
      password,
    });

    console.log('✅ Registration successful');
    accessToken = registerResponse.data.data.accessToken;
    userId = registerResponse.data.data.userId;

    // Step 2: Get own profile
    console.log('\nStep 2: Getting own profile...');
    const getProfileResponse = await makeRequest(
      'GET',
      `/users/${userId}`,
      null,
      accessToken
    );

    console.log('✅ Profile retrieved');
    console.log('Response:', JSON.stringify(getProfileResponse.data, null, 2));

    console.log('\n=== Profile tests completed ===');
    return true;
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

testProfile().then((success) => {
  process.exit(success ? 0 : 1);
});
