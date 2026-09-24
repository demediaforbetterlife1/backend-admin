const prisma = require('./src/prismaClient');
const fs = require('fs');

(async () => {
  try {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('APPLYING SEARCH INDEXES');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const indexes = [
      {
        name: 'User_username_idx',
        sql: 'CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username")'
      },
      {
        name: 'User_displayName_idx',
        sql: 'CREATE INDEX IF NOT EXISTS "User_displayName_idx" ON "User"("displayName")'
      },
      {
        name: 'User_username_displayName_idx',
        sql: 'CREATE INDEX IF NOT EXISTS "User_username_displayName_idx" ON "User"("username", "displayName")'
      },
      {
        name: 'User_isBanned_status_idx',
        sql: 'CREATE INDEX IF NOT EXISTS "User_isBanned_status_idx" ON "User"("isBanned", "status")'
      },
      {
        name: 'rooms_name_idx',
        sql: 'CREATE INDEX IF NOT EXISTS "rooms_name_idx" ON "rooms"("name")'
      },
      {
        name: 'rooms_topic_idx',
        sql: 'CREATE INDEX IF NOT EXISTS "rooms_topic_idx" ON "rooms"("topic")'
      },
      {
        name: 'rooms_isActive_name_idx',
        sql: 'CREATE INDEX IF NOT EXISTS "rooms_isActive_name_idx" ON "rooms"("isActive", "name")'
      },
      {
        name: 'rooms_isActive_topic_idx',
        sql: 'CREATE INDEX IF NOT EXISTS "rooms_isActive_topic_idx" ON "rooms"("isActive", "topic")'
      },
    ];

    for (const index of indexes) {
      console.log(`Creating: ${index.name}...`);
      try {
        await prisma.$executeRawUnsafe(index.sql);
        console.log(`✅ ${index.name} created`);
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`⚠️  ${index.name} already exists`);
        } else {
          throw err;
        }
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('✅ ALL SEARCH INDEXES APPLIED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════════════════════════\n');

    await prisma.$disconnect();
  } catch (error) {
    console.error('\n❌ Error applying indexes:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
})();
