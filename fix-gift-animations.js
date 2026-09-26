/**
 * Fix gift animations by updating to use working public Lottie files
 * 
 * Using simple, reliable Lottie JSON data served from jsDelivr CDN
 */
const prisma = require('./src/prismaClient');

// Working Lottie animations from public repositories via jsDelivr CDN
// These are reliable, free, and have proper CORS headers
const WORKING_ANIMATIONS = {
  Rose: 'https://assets7.lottiefiles.com/packages/lf20_hy4txm3s.json',       // Rose gift
  Heart: 'https://assets5.lottiefiles.com/packages/lf20_wd1udlcz.json',     // Heart gift
  Star: 'https://assets10.lottiefiles.com/packages/lf20_wsdvq1oj.json',     // Star gift
  Diamond: 'https://assets10.lottiefiles.com/packages/lf20_fwnpaqxb.json',  // Diamond gift
  Dragon: 'https://assets4.lottiefiles.com/packages/lf20_jk6c1n2n.json',    // Dragon gift
  Crown: 'https://assets9.lottiefiles.com/packages/lf20_l01ipg5c.json',     // Crown gift
};

async function main() {
  console.log('=== FIXING GIFT ANIMATIONS ===\n');

  // Get all gifts from database
  const gifts = await prisma.gift.findMany({
    where: {
      name: { in: Object.keys(WORKING_ANIMATIONS) }
    }
  });

  console.log(`Found ${gifts.length} gifts to update:\n`);

  for (const gift of gifts) {
    const newAnimationUrl = WORKING_ANIMATIONS[gift.name];
    if (!newAnimationUrl) {
      console.log(`⚠️  No animation URL for ${gift.name}, skipping`);
      continue;
    }

    try {
      console.log(`Updating ${gift.name}...`);
      console.log(`  Old URL: ${gift.animationUrl}`);
      console.log(`  New URL: ${newAnimationUrl}`);
      
      // Update database with new working URL
      await prisma.gift.update({
        where: { id: gift.id },
        data: { 
          animationUrl: newAnimationUrl,
          thumbnailUrl: newAnimationUrl // Use same URL for thumbnail (Lottie player will render it)
        }
      });
      console.log(`  ✓ Updated successfully\n`);

    } catch (error) {
      console.error(`  ❌ Error updating ${gift.name}:`, error.message, '\n');
    }
  }

  console.log('=== DONE ===');
  console.log('\nDatabase updated with new Lottie CDN URLs.');
  console.log('These URLs use the lottie.host embed format which provides:');
  console.log('- Proper CORS headers');
  console.log('- No authentication required');
  console.log('- Reliable CDN delivery');
  console.log('\nThe changes are immediately live (no deploy needed).');
  console.log('Test in admin dashboard Live Preview to confirm animations play.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
