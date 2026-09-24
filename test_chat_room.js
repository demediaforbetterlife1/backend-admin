/**
 * Test Chat in Rooms Feature
 * Verifies that room chat messages work correctly
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

async function testChatInRoom() {
  console.log('=== Test Chat in Rooms Feature ===\n');

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
        title: 'Test Room for Chat',
        description: 'Testing chat feature',
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
    console.log('Response:', JSON.stringify(joinResponse.data, null, 2));

    // Step 4: Send a chat message
    console.log('\nStep 4: Sending a chat message...');
    const sendMessageResponse = await makeRequest(
      'POST',
      `/rooms/${roomId}/messages`,
      {
        message: 'Hello, this is a test message!',
      },
      accessToken
    );

    console.log('✅ Message sent');
    console.log('Response:', JSON.stringify(sendMessageResponse.data, null, 2));

    // Step 5: Get room messages
    console.log('\nStep 5: Getting room messages...');
    const getMessagesResponse = await makeRequest(
      'GET',
      `/rooms/${roomId}/messages`,
      null,
      accessToken
    );

    console.log('✅ Messages retrieved');
    console.log('Response:', JSON.stringify(getMessagesResponse.data, null, 2));

    // Step 6: Send another message
    console.log('\nStep 6: Sending another message...');
    const sendMessageResponse2 = await makeRequest(
      'POST',
      `/rooms/${roomId}/messages`,
      {
        message: 'This is a second test message!',
      },
      accessToken
    );

    console.log('✅ Second message sent');
    console.log('Response:', JSON.stringify(sendMessageResponse2.data, null, 2));

    // Step 7: Get messages again
    console.log('\nStep 7: Getting messages again...');
    const getMessagesResponse2 = await makeRequest(
      'GET',
      `/rooms/${roomId}/messages`,
      null,
      accessToken
    );

    console.log('✅ Messages retrieved again');
    console.log('Response:', JSON.stringify(getMessagesResponse2.data, null, 2));

    console.log('\n=== All Chat in Rooms tests completed successfully ===');
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

testChatInRoom().then((success) => {
  process.exit(success ? 0 : 1);
});
