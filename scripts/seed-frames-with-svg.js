/**
 * Seed Frames with SVG Data URLs
 * 
 * يضيف الإطارات المؤقتة SVG إلى قاعدة البيانات
 */

const { PrismaClient } = require('@prisma/client');
const frameDataUrls = require('./create-temporary-frames');

const prisma = new PrismaClient();

async function seedFramesWithSVG() {
  console.log('🎨 Seeding frames with temporary SVG data URLs...\n');

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // FRAMES
    // ═══════════════════════════════════════════════════════════════════════
    
    const framesData = [
      {
        id: 'frame-golden-host',
        name: 'Golden Host Frame',
        nameAr: 'إطار المضيف الذهبي',
        imageUrl: frameDataUrls.goldenHost,
        previewUrl: frameDataUrls.goldenHost,
        tier: 'NONE',
        coinPrice: 0,
        isActive: true,
        sortOrder: 1,
      },
      {
        id: 'frame-vip-silver',
        name: 'VIP Silver Frame',
        nameAr: 'إطار VIP فضي',
        imageUrl: frameDataUrls.vipSilver,
        previewUrl: frameDataUrls.vipSilver,
        tier: 'VIP',
        coinPrice: 0,
        isActive: true,
        sortOrder: 2,
      },
      {
        id: 'frame-vip-gold',
        name: 'VIP Gold Frame',
        nameAr: 'إطار VIP ذهبي',
        imageUrl: frameDataUrls.vipGold,
        previewUrl: frameDataUrls.vipGold,
        tier: 'VIP',
        coinPrice: 0,
        isActive: true,
        sortOrder: 3,
      },
      {
        id: 'frame-vip-platinum',
        name: 'VIP Platinum Frame',
        nameAr: 'إطار VIP بلاتيني',
        imageUrl: frameDataUrls.vipPlatinum,
        previewUrl: frameDataUrls.vipPlatinum,
        tier: 'VIP',
        coinPrice: 0,
        isActive: true,
        sortOrder: 4,
      },
      {
        id: 'frame-svip-diamond',
        name: 'SVIP Diamond Frame',
        nameAr: 'إطار SVIP ماسي',
        imageUrl: frameDataUrls.svipDiamond,
        previewUrl: frameDataUrls.svipDiamond,
        tier: 'SVIP_1',
        coinPrice: 0,
        isActive: true,
        sortOrder: 5,
      },
      {
        id: 'frame-agent-bronze',
        name: 'Agent Bronze Frame',
        nameAr: 'إطار الوكيل البرونزي',
        imageUrl: frameDataUrls.agentBronze,
        previewUrl: frameDataUrls.agentBronze,
        tier: 'NONE',
        coinPrice: 1000,
        isActive: true,
        sortOrder: 6,
      },
      {
        id: 'frame-agent-silver',
        name: 'Agent Silver Frame',
        nameAr: 'إطار الوكيل الفضي',
        imageUrl: frameDataUrls.agentSilver,
        previewUrl: frameDataUrls.agentSilver,
        tier: 'NONE',
        coinPrice: 2000,
        isActive: true,
        sortOrder: 7,
      },
      {
        id: 'frame-special-stars',
        name: 'Special Frame - Stars',
        nameAr: 'إطار خاص - النجوم',
        imageUrl: frameDataUrls.specialStars,
        previewUrl: frameDataUrls.specialStars,
        tier: 'NONE',
        coinPrice: 5000,
        isActive: true,
        sortOrder: 8,
      },
      {
        id: 'frame-special-fire',
        name: 'Special Frame - Fire',
        nameAr: 'إطار خاص - النار',
        imageUrl: frameDataUrls.specialFire,
        previewUrl: frameDataUrls.specialFire,
        tier: 'NONE',
        coinPrice: 8000,
        isActive: true,
        sortOrder: 9,
      },
      {
        id: 'frame-special-galaxy',
        name: 'Special Frame - Galaxy',
        nameAr: 'إطار خاص - المجرة',
        imageUrl: frameDataUrls.specialGalaxy,
        previewUrl: frameDataUrls.specialGalaxy,
        tier: 'NONE',
        coinPrice: 10000,
        isActive: true,
        sortOrder: 10,
      },
    ];

    for (const frame of framesData) {
      await prisma.frame.upsert({
        where: { id: frame.id },
        update: frame,
        create: frame,
      });
      console.log(`  ✓ Frame: ${frame.nameAr} (${frame.tier === 'NONE' && frame.coinPrice === 0 ? 'FREE' : frame.tier === 'NONE' ? `${frame.coinPrice} coins` : frame.tier})`);
    }

    console.log('\n✅ Frames seeded successfully!');
    console.log('');
    console.log('📝 Summary:');
    console.log(`   Total frames: ${framesData.length}`);
    console.log(`   Free frames: ${framesData.filter(f => f.coinPrice === 0).length}`);
    console.log(`   Paid frames: ${framesData.filter(f => f.coinPrice > 0).length}`);
    console.log('');
    console.log('🎯 Next steps:');
    console.log('   1. Start the server: npm start');
    console.log('   2. Test frames API: GET /api/frames');
    console.log('   3. Create a room and see the golden frame on seat 0!');
    console.log('');
    console.log('💡 Note: These are SVG data URLs - they work without CDN!');
    
  } catch (error) {
    console.error('❌ Error seeding frames:', error);
    throw error;
  }
}

// Run the seed
seedFramesWithSVG()
  .then(() => {
    console.log('\n✅ Seed complete');
    prisma.$disconnect();
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Seed failed:', error);
    prisma.$disconnect();
    process.exit(1);
  });
