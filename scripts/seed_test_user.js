/**
 * Creates a test user with a short numeric ID for testing the Add Agent feature.
 * Run with:  node scripts/seed_test_user.js
 */

'use strict';

const bcrypt = require('bcryptjs');
const db     = require('../src/db');

const USER_ID  = '254214';
const USERNAME = 'test_agent_254214';
const EMAIL    = 'testuser254214@test.com';
const PASSWORD = 'test1234';

// Remove existing user with this ID first (clean slate)
const existing = db.prepare(`SELECT id, username FROM users WHERE id = ?`).get(USER_ID);
if (existing) {
  // Clean up related records first (FK constraints)
  db.prepare(`DELETE FROM targets      WHERE user_id = ?`).run(USER_ID);
  db.prepare(`DELETE FROM earnings     WHERE user_id = ?`).run(USER_ID);
  db.prepare(`DELETE FROM invitations  WHERE agent_id = ? OR invitee_id = ?`).run(USER_ID, USER_ID);
  db.prepare(`DELETE FROM agents       WHERE id = ?`).run(USER_ID);
  db.prepare(`DELETE FROM hosts        WHERE id = ?`).run(USER_ID);
  db.prepare(`DELETE FROM users        WHERE id = ?`).run(USER_ID);
  console.log(`🗑️   Removed existing user: ${existing.username} (${USER_ID})`);
}

// Also remove by email/username if they exist with different IDs
db.prepare(`DELETE FROM users WHERE email = ? OR username = ?`).run(EMAIL, USERNAME);

// Create the test user
const hash = bcrypt.hashSync(PASSWORD, 10);
db.prepare(`
  INSERT INTO users (id, username, email, password, role, status)
  VALUES (?, ?, ?, ?, 'user', 'active')
`).run(USER_ID, USERNAME, EMAIL, hash);

const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(USER_ID);

console.log(`\n✅  Test user created:`);
console.log(`    ID       : ${user.id}`);
console.log(`    Username : ${user.username}`);
console.log(`    Email    : ${user.email}`);
console.log(`    Password : ${PASSWORD}`);
console.log(`    Role     : ${user.role}`);
console.log(`\n👉  To add as agent, use ID: ${USER_ID}`);
console.log(`    Or email: ${EMAIL}`);
