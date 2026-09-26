const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkGifts() {
  try {
    const gifts = await prisma.gift.findMany({
      orderBy: { id: 'asc' }
    });
    
    console.log('=== Current Gift Animation URLs ===\n');
    gifts.forEach(gift => {
      console.log(`ID: ${gift.id}`);
      console.log(`Name: ${gift.name}`);
      console.log(`Name AR: ${gift.nameAr}`);
      console.log(`Animation URL: ${gift.animationUrl}`);
      console.log(`Thumbnail URL: ${gift.thumbnailUrl}`);
      console.log('---\n');
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkGifts();
