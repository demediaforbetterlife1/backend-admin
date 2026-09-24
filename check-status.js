const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkStatus() {
  const user = await prisma.user.findUnique({
    where: { email: 'testagency8990@test.com' },
    select: {
      username: true,
      status: true,
      accountType: true,
      agencyApproved: true,
      role: true,
    }
  });
  
  console.log('User Status:', JSON.stringify(user, null, 2));
  await prisma.$disconnect();
}

checkStatus();
