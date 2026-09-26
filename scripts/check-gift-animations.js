const prisma = require('../src/prismaClient');

async function main() {
  console.log('=== CHECKING GIFT ANIMATION URLS ===\n');
  
  const gifts = await prisma.gift.findMany({
    where: { animationUrl: { not: '' } },
    select: { id: true, name: true, animationUrl: true }
  });
  
  console.log(`Gifts with animation URLs: ${gifts.length}\n`);
  
  if (gifts.length === 0) {
    console.log('No gifts with animation URLs found');
  } else {
    gifts.forEach((gift, index) => {
      console.log(`${index + 1}. ${gift.name}`);
      console.log(`   URL: ${gift.animationUrl}\n`);
    });
  }
}

main()
  .catch(e => console.error('Error:', e.message))
  .finally(() => prisma.$disconnect());
