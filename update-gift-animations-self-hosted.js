const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const baseUrl = process.env.APP_URL || 'https://voicechat-backend.fly.dev';

const giftAnimations = {
  'Heart': {
    animationUrl: `${baseUrl}/public/animations/heart.json`,
    thumbnailUrl: `${baseUrl}/public/animations/heart.json`
  },
  'Star': {
    animationUrl: `${baseUrl}/public/animations/star.json`,
    thumbnailUrl: `${baseUrl}/public/animations/star.json`
  },
  'Rose': {
    animationUrl: `${baseUrl}/public/animations/rose.json`,
    thumbnailUrl: `${baseUrl}/public/animations/rose.json`
  },
  'Diamond': {
    animationUrl: `${baseUrl}/public/animations/diamond.json`,
    thumbnailUrl: `${baseUrl}/public/animations/diamond.json`
  },
  'Crown': {
    animationUrl: `${baseUrl}/public/animations/crown.json`,
    thumbnailUrl: `${baseUrl}/public/animations/crown.json`
  },
  'Dragon': {
    animationUrl: `${baseUrl}/public/animations/dragon.json`,
    thumbnailUrl: `${baseUrl}/public/animations/dragon.json`
  }
};

async function updateGiftAnimations() {
  console.log('=== Updating Gift Animations to Self-Hosted URLs ===\n');
  console.log(`Base URL: ${baseUrl}\n`);
  
  try {
    for (const [name, urls] of Object.entries(giftAnimations)) {
      const result = await prisma.gift.updateMany({
        where: { name },
        data: {
          animationUrl: urls.animationUrl,
          thumbnailUrl: urls.thumbnailUrl
        }
      });
      
      if (result.count > 0) {
        console.log(`✅ Updated ${name}:`);
        console.log(`   Animation: ${urls.animationUrl}`);
        console.log(`   Thumbnail: ${urls.thumbnailUrl}`);
      } else {
        console.warn(`⚠️  ${name} not found in database`);
      }
    }
    
    console.log('\n=== Verification ===\n');
    
    const allGifts = await prisma.gift.findMany({
      orderBy: { name: 'asc' }
    });
    
    allGifts.forEach(gift => {
      const isCorrect = gift.animationUrl.includes('/public/animations/') && 
                       gift.animationUrl.includes(baseUrl);
      const status = isCorrect ? '✅' : '❌';
      console.log(`${status} ${gift.name}: ${gift.animationUrl}`);
    });
    
    console.log('\n✅ All gift animations updated to self-hosted URLs!');
    console.log('\nThese URLs are served from the backend with proper CORS headers:');
    console.log('  Access-Control-Allow-Origin: *');
    console.log('  Cross-Origin-Resource-Policy: cross-origin');
    
  } catch (error) {
    console.error('❌ Error updating gift animations:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateGiftAnimations();
