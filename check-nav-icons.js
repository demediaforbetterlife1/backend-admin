const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const navIcons = await prisma.appIcon.findMany({ 
      where: { category: 'NAVIGATION' } 
    });
    console.log('Navigation Icons:', JSON.stringify(navIcons, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();