const jwt = require('jsonwebtoken');

// Generate a test token for user testing
const userId = '06d56726-72d7-4c2f-b78e-1c1e38bd099e'; // dsadad
const username = 'dsadad';
const role = 'USER';

const token = jwt.sign(
  { userId, username, role },
  'a9f3e2c1d8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1',
  { expiresIn: '24h' }
);

console.log('\n✅ Generated test token:');
console.log(token);
console.log('\nUser:', username);
console.log('ID:', userId);
console.log('Role:', role);
console.log('\n');
