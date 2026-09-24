/**
 * Seed Default Frames & Entrances
 * 
 * Creates default frames including the golden host frame
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedDefaultFrames() {
  console.log('🎨 Seeding default frames and entrances...');

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // DEFAULT FRAMES
    // ═══════════════════════════════════════════════════════════════════════
    
    const frames = [
      {
        id: 'frame-golden-host',
        name: 'Golden Host Frame',
        nameAr: 'إطار المضيف الذهبي',
        imageUrl: 'https://i.imgur.com/golden-host-frame.png', // Replace with actual URL
        previewUrl: 'https://i.imgur.com/golden-host-frame-preview.png',
        tier: 'NONE', // Available for all
        coinPrice: 0, // Free for hosts
        isActive: true,
        sortOrder: 1,
      },
      {
        id: 'frame-vip-silver',
        name: 'VIP Silver Frame',
        nameAr: 'إطار VIP فضي',
        imageUrl: 'https://i.imgur.com/vip-silver-frame.png',
        previewUrl: 'https://i.imgur.com/vip-silver-frame-preview.png',
        tier: 'VIP_1',
        coinPrice: 0, // Free for VIP
        isActive: true,
        sortOrder: 2,
      },
      {
        id: 'frame-vip-gold',
        name: 'VIP Gold Frame',
        nameAr: 'إطار VIP ذهبي',
        imageUrl: 'https://i.imgur.com/vip-gold-frame.png',
        previewUrl: 'https://i.imgur.com/vip-gold-frame-preview.png',
        tier: 'VIP_2',
        coinPrice: 0,
        isActive: true,
        sortOrder: 3,
      },
      {
        id: 'frame-vip-platinum',
        name: 'VIP Platinum Frame',
        nameAr: 'إطار VIP بلاتيني',
        imageUrl: 'https://i.imgur.com/vip-platinum-frame.png',
        previewUrl: 'https://i.imgur.com/vip-platinum-frame-preview.png',
        tier: 'VIP_3',
        coinPrice: 0,
        isActive: true,
        sortOrder: 4,
      },
      {
        id: 'frame-svip-diamond',
        name: 'SVIP Diamond Frame',
        nameAr: 'إطار SVIP ماسي',
        imageUrl: 'https://i.imgur.com/svip-diamond-frame.png',
        previewUrl: 'https://i.imgur.com/svip-diamond-frame-preview.png',
        tier: 'SVIP_1',
        coinPrice: 0,
        isActive: true,
        sortOrder: 5,
      },
      {
        id: 'frame-agent-bronze',
        name: 'Agent Bronze Frame',
        nameAr: 'إطار الوكيل البرونزي',
        imageUrl: 'https://i.imgur.com/agent-bronze-frame.png',
        previewUrl: 'https://i.imgur.com/agent-bronze-frame-preview.png',
        tier: 'NONE',
        coinPrice: 1000, // Purchasable
        isActive: true,
        sortOrder: 6,
      },
      {
        id: 'frame-agent-silver',
        name: 'Agent Silver Frame',
        nameAr: 'إطار الوكيل الفضي',
        imageUrl: 'https://i.imgur.com/agent-silver-frame.png',
        previewUrl: 'https://i.imgur.com/agent-silver-frame-preview.png',
        tier: 'NONE',
        coinPrice: 2000,
        isActive: true,
        sortOrder: 7,
      },
      {
        id: 'frame-special-1',
        name: 'Special Frame - Stars',
        nameAr: 'إطار خاص - النجوم',
        imageUrl: 'https://i.imgur.com/special-stars-frame.png',
        previewUrl: 'https://i.imgur.com/special-stars-frame-preview.png',
        tier: 'NONE',
        coinPrice: 5000,
        isActive: true,
        sortOrder: 8,
      },
      {
        id: 'frame-special-2',
        name: 'Special Frame - Fire',
        nameAr: 'إطار خاص - النار',
        imageUrl: 'https://i.imgur.com/special-fire-frame.png',
        previewUrl: 'https://i.imgur.com/special-fire-frame-preview.png',
        tier: 'NONE',
        coinPrice: 8000,
        isActive: true,
        sortOrder: 9,
      },
      {
        id: 'frame-special-3',
        name: 'Special Frame - Galaxy',
        nameAr: 'إطار خاص - المجرة',
        imageUrl: 'https://i.imgur.com/special-galaxy-frame.png',
        previewUrl: 'https://i.imgur.com/special-galaxy-frame-preview.png',
        tier: 'NONE',
        coinPrice: 10000,
        isActive: true,
        sortOrder: 10,
      },
    ];

    for (const frame of frames) {
      await prisma.frame.upsert({
        where: { id: frame.id },
        update: frame,
        create: frame,
      });
      console.log(`  ✓ Frame: ${frame.nameAr}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DEFAULT ENTRANCES
    // ═══════════════════════════════════════════════════════════════════════
    
    const entrances = [
      {
        id: 'entrance-vip-sparkles',
        name: 'VIP Sparkles',
        nameAr: 'دخول VIP بريق',
        animationUrl: 'https://i.imgur.com/vip-sparkles.json',
        previewUrl: 'https://i.imgur.com/vip-sparkles-preview.png',
        soundUrl: 'https://i.imgur.com/vip-sound.mp3',
        particleType: 'sparkle',
        tier: 'VIP_1',
        coinPrice: 0,
        isActive: true,
        sortOrder: 1,
      },
      {
        id: 'entrance-vip-fireworks',
        name: 'VIP Fireworks',
        nameAr: 'دخول VIP ألعاب نارية',
        animationUrl: 'https://i.imgur.com/vip-fireworks.json',
        previewUrl: 'https://i.imgur.com/vip-fireworks-preview.png',
        soundUrl: 'https://i.imgur.com/vip-fireworks-sound.mp3',
        particleType: 'firework',
        tier: 'VIP_2',
        coinPrice: 0,
        isActive: true,
        sortOrder: 2,
      },
      {
        id: 'entrance-svip-royal',
        name: 'SVIP Royal Entry',
        nameAr: 'دخول SVIP ملكي',
        animationUrl: 'https://i.imgur.com/svip-royal.json',
        previewUrl: 'https://i.imgur.com/svip-royal-preview.png',
        soundUrl: 'https://i.imgur.com/svip-royal-sound.mp3',
        particleType: 'royal',
        tier: 'SVIP_1',
        coinPrice: 0,
        isActive: true,
        sortOrder: 3,
      },
      {
        id: 'entrance-special-1',
        name: 'Special Entrance - Lightning',
        nameAr: 'دخول خاص - البرق',
        animationUrl: 'https://i.imgur.com/lightning-entrance.json',
        previewUrl: 'https://i.imgur.com/lightning-entrance-preview.png',
        soundUrl: 'https://i.imgur.com/lightning-sound.mp3',
        particleType: 'lightning',
        tier: 'NONE',
        coinPrice: 5000,
        isActive: true,
        sortOrder: 4,
      },
      {
        id: 'entrance-special-2',
        name: 'Special Entrance - Hearts',
        nameAr: 'دخول خاص - القلوب',
        animationUrl: 'https://i.imgur.com/hearts-entrance.json',
        previewUrl: 'https://i.imgur.com/hearts-entrance-preview.png',
        soundUrl: 'https://i.imgur.com/hearts-sound.mp3',
        particleType: 'hearts',
        tier: 'NONE',
        coinPrice: 7000,
        isActive: true,
        sortOrder: 5,
      },
    ];

    for (const entrance of entrances) {
      await prisma.entrance.upsert({
        where: { id: entrance.id },
        update: entrance,
        create: entrance,
      });
      console.log(`  ✓ Entrance: ${entrance.nameAr}`);
    }

    console.log('✅ Default frames and entrances seeded successfully!');
    console.log('');
    console.log('📝 NOTE: Update the imageUrl/animationUrl fields with actual asset URLs');
    console.log('   These are placeholder URLs and need to be replaced with real assets');
    
  } catch (error) {
    console.error('❌ Error seeding frames:', error);
    throw error;
  }
}

// Run the seed
seedDefaultFrames()
  .then(() => {
    console.log('✅ Seed complete');
    prisma.$disconnect();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Seed failed:', error);
    prisma.$disconnect();
    process.exit(1);
  });
