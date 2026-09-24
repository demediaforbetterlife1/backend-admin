/**
 * Test Mute/Unmute Feature
 * Verifies that mute/unmute API endpoint works correctly
 */

const http = require('http');

const API_BASE = 'http://localhost:3000/api';

let accessToken = '';
let userId = '';
let roomId = '';

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

async function testMuteUnmute() {
  console.log('=== Test Mute/Unmute Feature ===\n');

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

    // Step 2: Create a room
    console.log('\nStep 2: Creating room...');
    const roomResponse = await makeRequest(
      'POST',
      '/rooms',
      {
        title: 'Test Room for Mute',
        description: 'Testing mute feature',
        maxSeats: 20,
        tags: ['test'],
      },
      accessToken
    );

    console.log('✅ Room created');
    roomId = roomResponse.data.data.id;

    // Step 3: Join the room
    console.log('\nStep 3: Joining the room...');
    const joinResponse = await makeRequest(
      'POST',
      `/rooms/${roomId}/join`,
      {},
      accessToken
    );

    console.log('✅ Room joined');

    // Step 4: Mute the user
    console.log('\nStep 4: Muting the user...');
    const muteResponse = await makeRequest(
      'POST',
      `/rooms/${roomId}/mute`,
      {
        userId: userId,
        isMuted: true,
      },
      accessToken
    );

    console.log('✅ User muted');
    console.log('Response:', JSON.stringify(muteResponse.data, null, 2));

    // Step 5: Get room to check mute status
    console.log('\nStep 5: Getting room to check mute status...');
    const getRoomResponse = await makeRequest(
      'GET',
      `/rooms/${roomId}`,
      null,
      accessToken
    );

    console.log('✅ Room retrieved');
    console.log('Response:', JSON.stringify(getRoomResponse.data, null, 2));

    // Step 6: Unmute the user
    console.log('\nStep 6: Unmuting the user...');
    const unmuteResponse = await makeRequest(
      'POST',
      `/rooms/${roomId}/mute`,
      {
        userId: userId,
        isMuted: false,
      },
      accessToken
    );

    console.log('✅ User unmuted');
    console.log('Response:', JSON.stringify(unmuteResponse.data, null, 2));

    // Step 7: Get room to check unmute status
    console.log('\nStep 7: Getting room to check unmute status...');
    const getRoomResponse2 = await makeRequest(
      'GET',
      `/rooms/${roomId}`,
      null,
      accessToken
    );

    console.log('✅ Room retrieved');
    console.log('Response:', JSON.stringify(getRoomResponse2.data, null, 2));

    console.log('\n=== All Mute/Unmute tests completed successfully ===');
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

testMuteUnmute().then((success) => {
  process.exit(success ? 0 : 1);
});
