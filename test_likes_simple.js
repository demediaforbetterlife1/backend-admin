/**
 * Simple test for Like/Unlike Room Feature using Node.js built-in http module
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

async function testLikeUnlikeRoom() {
  console.log('=== Test Like/Unlike Room Feature ===\n');

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
    console.log('Response:', JSON.stringify(registerResponse.data, null, 2));
    accessToken = registerResponse.data.data.accessToken;
    userId = registerResponse.data.data.userId;

    // Step 2: Complete profile
    console.log('\nStep 2: Completing profile...');
    const profileResponse = await makeRequest(
      'POST',
      '/auth/complete-profile',
      {
        displayName: username,
        gender: 'male',
        birthday: '2000-01-01',
      },
      accessToken
    );

    console.log('✅ Profile completed');
    console.log('Response:', JSON.stringify(profileResponse.data, null, 2));

    // Step 3: Create a room
    console.log('\nStep 3: Creating room...');
    const roomResponse = await makeRequest(
      'POST',
      '/rooms',
      {
        title: 'Test Room for Likes',
        description: 'Testing like feature',
        maxSeats: 20,
        tags: ['test'],
      },
      accessToken
    );

    console.log('✅ Room created');
    console.log('Response:', JSON.stringify(roomResponse.data, null, 2));
    roomId = roomResponse.data.data.id;

    // Step 4: Get initial likes
    console.log('\nStep 4: Getting initial likes...');
    const initialLikesResponse = await makeRequest(
      'GET',
      `/rooms/${roomId}/likes`,
      null,
      accessToken
    );

    console.log('✅ Initial likes retrieved');
    console.log('Response:', JSON.stringify(initialLikesResponse.data, null, 2));

    // Step 5: Like the room
    console.log('\nStep 5: Liking the room...');
    const likeResponse = await makeRequest(
      'POST',
      `/rooms/${roomId}/like`,
      {},
      accessToken
    );

    console.log('✅ Room liked');
    console.log('Response:', JSON.stringify(likeResponse.data, null, 2));

    // Step 6: Get likes after liking
    console.log('\nStep 6: Getting likes after liking...');
    const afterLikeResponse = await makeRequest(
      'GET',
      `/rooms/${roomId}/likes`,
      null,
      accessToken
    );

    console.log('✅ Likes retrieved after liking');
    console.log('Response:', JSON.stringify(afterLikeResponse.data, null, 2));

    // Step 7: Unlike the room
    console.log('\nStep 7: Unliking the room...');
    const unlikeResponse = await makeRequest(
      'DELETE',
      `/rooms/${roomId}/like`,
      null,
      accessToken
    );

    console.log('✅ Room unliked');
    console.log('Response:', JSON.stringify(unlikeResponse.data, null, 2));

    // Step 8: Get likes after unliking
    console.log('\nStep 8: Getting likes after unliking...');
    const afterUnlikeResponse = await makeRequest(
      'GET',
      `/rooms/${roomId}/likes`,
      null,
      accessToken
    );

    console.log('✅ Likes retrieved after unliking');
    console.log('Response:', JSON.stringify(afterUnlikeResponse.data, null, 2));

    // Step 9: Try liking again (should succeed)
    console.log('\nStep 9: Liking the room again...');
    const likeAgainResponse = await makeRequest(
      'POST',
      `/rooms/${roomId}/like`,
      {},
      accessToken
    );

    console.log('✅ Room liked again');
    console.log('Response:', JSON.stringify(likeAgainResponse.data, null, 2));

    // Step 10: Try liking twice (should fail with 409)
    console.log('\nStep 10: Trying to like twice (should fail)...');
    try {
      const duplicateLikeResponse = await makeRequest(
        'POST',
        `/rooms/${roomId}/like`,
        {},
        accessToken
      );
      if (duplicateLikeResponse.status === 409) {
        console.log('✅ Duplicate like correctly rejected with 409');
        console.log('Response:', JSON.stringify(duplicateLikeResponse.data, null, 2));
      } else {
        console.log('❌ Duplicate like should have failed but succeeded');
      }
    } catch (error) {
      console.log('❌ Unexpected error:', error.message);
    }

    console.log('\n=== All Like/Unlike Room tests completed successfully ===');
    return true;
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    return false;
  }
}

testLikeUnlikeRoom().then((success) => {
  process.exit(success ? 0 : 1);
});
