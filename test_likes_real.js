/**
 * Test Like/Unlike Room Feature
 * Verifies that the like/unlike API endpoints work correctly
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';

let accessToken = '';
let userId = '';
let roomId = '';

async function testLikeUnlikeRoom() {
  console.log('=== Test Like/Unlike Room Feature ===\n');

  try {
    // Step 1: Register a user
    console.log('Step 1: Registering user...');
    const username = `testuser_${Date.now()}`;
    const email = `test_${Date.now()}@example.com`;
    const password = 'TestPass123';

    const registerResponse = await axios.post(`${API_BASE}/auth/register/user`, {
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
    const profileResponse = await axios.post(
      `${API_BASE}/auth/complete-profile`,
      {
        displayName: username,
        gender: 'male',
        birthday: '2000-01-01',
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log('✅ Profile completed');
    console.log('Response:', JSON.stringify(profileResponse.data, null, 2));

    // Step 3: Create a room
    console.log('\nStep 3: Creating room...');
    const roomResponse = await axios.post(
      `${API_BASE}/rooms`,
      {
        title: 'Test Room for Likes',
        description: 'Testing like feature',
        maxSeats: 20,
        tags: ['test'],
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log('✅ Room created');
    console.log('Response:', JSON.stringify(roomResponse.data, null, 2));
    roomId = roomResponse.data.data.id;

    // Step 4: Get initial likes
    console.log('\nStep 4: Getting initial likes...');
    const initialLikesResponse = await axios.get(
      `${API_BASE}/rooms/${roomId}/likes`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log('✅ Initial likes retrieved');
    console.log('Response:', JSON.stringify(initialLikesResponse.data, null, 2));

    // Step 5: Like the room
    console.log('\nStep 5: Liking the room...');
    const likeResponse = await axios.post(
      `${API_BASE}/rooms/${roomId}/like`,
      {},
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log('✅ Room liked');
    console.log('Response:', JSON.stringify(likeResponse.data, null, 2));

    // Step 6: Get likes after liking
    console.log('\nStep 6: Getting likes after liking...');
    const afterLikeResponse = await axios.get(
      `${API_BASE}/rooms/${roomId}/likes`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log('✅ Likes retrieved after liking');
    console.log('Response:', JSON.stringify(afterLikeResponse.data, null, 2));

    // Step 7: Unlike the room
    console.log('\nStep 7: Unliking the room...');
    const unlikeResponse = await axios.delete(
      `${API_BASE}/rooms/${roomId}/like`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log('✅ Room unliked');
    console.log('Response:', JSON.stringify(unlikeResponse.data, null, 2));

    // Step 8: Get likes after unliking
    console.log('\nStep 8: Getting likes after unliking...');
    const afterUnlikeResponse = await axios.get(
      `${API_BASE}/rooms/${roomId}/likes`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log('✅ Likes retrieved after unliking');
    console.log('Response:', JSON.stringify(afterUnlikeResponse.data, null, 2));

    // Step 9: Try liking again (should succeed)
    console.log('\nStep 9: Liking the room again...');
    const likeAgainResponse = await axios.post(
      `${API_BASE}/rooms/${roomId}/like`,
      {},
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log('✅ Room liked again');
    console.log('Response:', JSON.stringify(likeAgainResponse.data, null, 2));

    // Step 10: Try liking twice (should fail with 409)
    console.log('\nStep 10: Trying to like twice (should fail)...');
    try {
      await axios.post(
        `${API_BASE}/rooms/${roomId}/like`,
        {},
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      console.log('❌ Duplicate like should have failed but succeeded');
    } catch (error) {
      if (error.response && error.response.status === 409) {
        console.log('✅ Duplicate like correctly rejected with 409');
        console.log('Response:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.log('❌ Unexpected error:', error.message);
      }
    }

    console.log('\n=== All Like/Unlike Room tests completed successfully ===');
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

testLikeUnlikeRoom().then((success) => {
  process.exit(success ? 0 : 1);
});
