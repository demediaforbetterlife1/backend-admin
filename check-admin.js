const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAdmin() {
  const admin = await prisma.admin.findFirst();
  console.log(admin);
  await prisma.$disconnect();
}

checkAdmin();
