require('dotenv').config();
const db = require('../src/db');
const authService = require('../src/services/authService');

async function main() {
  const profile = authService.parseProfilePayload({
    displayName: 'Direct Test',
    bio: 'Direct bio',
    gender: 'male',
    countryCode: 'SA',
    interests: ['a', 'b'],
  });

  const base = await authService.registerUser(db, {
    username: `direct_${Date.now()}`,
    email: `direct_${Date.now()}@test.com`,
    phone: null,
    password: 'TestPass1',
    profile,
  });

  const result = await authService.completeRegistration(db, {
    ...base,
    email: `direct_${Date.now()}@test.com`,
    phone: null,
    agentCode: null,
  });

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({
    where: { id: result.userId },
    select: { displayName: true, bio: true, interests: true },
  });
  console.log('SQLite:', db.prepare('SELECT display_name, bio FROM users WHERE id=?').get(result.userId));
  console.log('Prisma:', user);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
