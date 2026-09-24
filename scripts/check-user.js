const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  const username = process.argv[2];
  const user = username
    ? await prisma.user.findUnique({
        where: { username },
        select: {
          username: true,
          email: true,
          displayName: true,
          bio: true,
          gender: true,
          countryCode: true,
          interests: true,
          role: true,
          status: true,
        },
      })
    : await prisma.user.findFirst({
    where: { username: { startsWith: 'testuser_' } },
    select: {
      username: true,
      email: true,
      phone: true,
      displayName: true,
      bio: true,
      gender: true,
      countryCode: true,
      interests: true,
      role: true,
      status: true,
    },
  });
  console.log(JSON.stringify(user, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
