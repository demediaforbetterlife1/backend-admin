const prisma = require('./src/prismaClient');

(async () => {
  try {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('DATABASE USERS SAMPLE');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const users = await prisma.user.findMany({
      take: 5,
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
        isBanned: false,
      },
    });

    if (users.length === 0) {
      console.log('❌ No users found in database\n');
    } else {
      console.log(`Found ${users.length} users:\n`);
      users.forEach((u, i) => {
        console.log(`${i + 1}. ${u.username} (${u.displayName || 'no display name'})`);
        console.log(`   ID: ${u.id}`);
        console.log(`   Role: ${u.role}`);
        console.log(`   Status: ${u.status}`);
        console.log('');
      });
    }

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('TESTING USER SEARCH');
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (users.length > 0) {
      const searchTerm = users[0].username.substring(0, 3);
      console.log(`Searching for: "${searchTerm}"\n`);

      const results = await prisma.user.findMany({
        where: {
          isBanned: false,
          OR: [
            { username: { contains: searchTerm, mode: 'insensitive' } },
            { displayName: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatar: true,
        },
        take: 10,
      });

      console.log(`✅ Found ${results.length} results:\n`);
      results.forEach((r, i) => {
        console.log(`${i + 1}. ${r.username} (${r.displayName || 'N/A'})`);
      });
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('TESTING ROOM SEARCH');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const rooms = await prisma.room.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        ownerId: true,
      },
      take: 5,
    });

    if (rooms.length === 0) {
      console.log('❌ No active rooms found in database\n');
    } else {
      console.log(`Found ${rooms.length} active rooms:\n`);
      rooms.forEach((r, i) => {
        console.log(`${i + 1}. ${r.name}`);
        console.log(`   ID: ${r.id}`);
        console.log('');
      });

      if (rooms.length > 0) {
        const searchTerm = rooms[0].name.substring(0, 3);
        console.log(`\nSearching rooms for: "${searchTerm}"\n`);

        const roomResults = await prisma.room.findMany({
          where: {
            isActive: true,
            OR: [
              { name: { contains: searchTerm, mode: 'insensitive' } },
              { topic: { contains: searchTerm, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            name: true,
            topic: true,
          },
          take: 10,
        });

        console.log(`✅ Found ${roomResults.length} room results:\n`);
        roomResults.forEach((r, i) => {
          console.log(`${i + 1}. ${r.name}`);
        });
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════\n');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
