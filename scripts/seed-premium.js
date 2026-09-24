/**
 * Seed VIP/SVIP Assets for Option A (Loyalty XP System)
 * 
 * This enhanced seed creates:
 * - 15 VIP plans mapped to loyalty levels 1-15
 * - 15 frames (one per loyalty level)
 * - 15 entrances (one per loyalty level)
 * - Placeholder assets (actual assets to be created by design team)
 * 
 * Run: node scripts/seed-premium.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Loyalty level color palette (1-15)
const LOYALTY_COLORS = [
  '#CD7F32', // Level 1 - Bronze
  '#CD7F32', // Level 2 - Bronze
  '#C0A060', // Level 3 - Silver
  '#C0A060', // Level 4 - Silver
  '#FFD700', // Level 5 - Gold
  '#FFD700', // Level 6 - Gold
  '#F5C842', // Level 7 - Royal Gold
  '#9B59B6', // Level 8 - SVIP Sapphire
  '#9B59B6', // Level 9 - SVIP Sapphire
  '#3498DB', // Level 10 - SVIP Diamond
  '#3498DB', // Level 11 - SVIP Diamond
  '#1ABC9C', // Level 12 - SVIP Platinum
  '#1ABC9C', // Level 13 - SVIP Platinum
  '#E67E22', // Level 14 - SVIP Legend
  '#FF007F', // Level 15 - SVIP Emperor
];

const LOYALTY_LABELS_AR = [
  'برونزي VIP', 'برونزي VIP', 'فضي VIP', 'فضي VIP',
  'ذهبي VIP', 'ذهبي VIP', 'ملكي VIP',
  'SVIP ياقوت', 'SVIP ياقوت', 'SVIP ماسي', 'SVIP ماسي',
  'SVIP بلاتيني', 'SVIP بلاتيني', 'SVIP أسطوري', 'SVIP إمبراطوري'
];

async function seedPlans() {
  console.log('Seeding VIP Plans for 15 Loyalty Levels...');
  
  // Create base plans for loyalty levels 1-15
  // These act as display templates and benefit definitions
  for (let level = 1; level <= 15; level++) {
    const isVip = level <= 7;
    const tier = isVip ? 'VIP' : `SVIP_${Math.min(Math.ceil((level - 7) / 2), 5)}`;
    
    // Note: These are display templates, not purchasable subscriptions
    // Actual subscription tiers (VIP, SVIP_1-5) remain separate
    await prisma.vipPlan.upsert({
      where: { tier: `LOYALTY_${level}` }, // Special tier for loyalty system
      update: {},
      create: {
        tier: `LOYALTY_${level}`,
        nameAr: `${LOYALTY_LABELS_AR[level - 1]} - المستوى ${level}`,
        priceCoins: 0, // Not purchasable directly - earned through XP
        priceEGP: 0,
        durationDays: 0, // Permanent (loyalty doesn't expire, only downgrades with inactivity)
        maxRooms: Math.min(2 + Math.floor(level / 3), 13),
        seatPriority: true,
        earningBonus: level <= 2 ? 1.05 :
                      level <= 4 ? 1.08 :
                      level <= 6 ? 1.12 :
                      level === 7 ? 1.15 :
                      level <= 9 ? 1.20 :
                      level <= 11 ? 1.24 :
                      level <= 13 ? 1.28 :
                      level === 14 ? 1.35 : 1.45,
        canRecord: level >= 3,
        canGoPrivate: level >= 7,
        badgeColor: LOYALTY_COLORS[level - 1],
        glowColor: LOYALTY_COLORS[level - 1],
        nicknameColor: level >= 2 ? LOYALTY_COLORS[level - 1] : null,
        features: [
          `Loyalty Level ${level}`,
          level >= 2 ? 'Colored Nickname' : null,
          level >= 3 ? 'Profile Frame' : null,
          level >= 4 ? 'Chat Bubble Style' : null,
          level >= 5 ? 'VIP Mic Effect' : null,
          level >= 6 ? 'Exclusive Emojis' : null,
          level >= 7 ? 'Private Rooms' : null,
          level >= 8 ? 'VIP-only Gifts' : null,
          level >= 9 ? 'Welcome Message' : null,
          level >= 10 ? 'Anti-kick Protection' : null,
          level >= 11 ? 'Priority Support' : null,
          level >= 12 ? 'Custom Room Theme' : null,
          level >= 13 ? 'Fast Track Support' : null,
          level >= 14 ? 'Concierge Support' : null,
          level === 15 ? 'Legendary Emperor Crown' : null,
        ].filter(Boolean),
        sortOrder: level,
        isActive: true,
      },
    });
  }
  
  console.log('✅ Created 15 loyalty level plan templates');
}

async function seedEntrances() {
  console.log('Seeding 15 Entrance Effects...');
  
  const ENTRANCE_TEMPLATES = [
    { level: 1, name: 'Basic Shimmer', nameAr: 'تلميع بسيط', particle: 'sparkle', rarity: 'common' },
    { level: 2, name: 'Bronze Glow', nameAr: 'توهج برونزي', particle: 'glow', rarity: 'common' },
    { level: 3, name: 'Silver Trail', nameAr: 'أثر فضي', particle: 'trail', rarity: 'uncommon' },
    { level: 4, name: 'Silver Burst', nameAr: 'انفجار فضي', particle: 'burst', rarity: 'uncommon' },
    { level: 5, name: 'Golden Pulse', nameAr: 'نبض ذهبي', particle: 'pulse', rarity: 'rare' },
    { level: 6, name: 'Golden Crown', nameAr: 'تاج ذهبي', particle: 'crown', rarity: 'rare' },
    { level: 7, name: 'Royal Portal', nameAr: 'بوابة ملكية', particle: 'portal', rarity: 'epic' },
    { level: 8, name: 'Sapphire Ring', nameAr: 'حلقة ياقوت', particle: 'ring', rarity: 'epic' },
    { level: 9, name: 'Sapphire Halo', nameAr: 'هالة ياقوت', particle: 'halo', rarity: 'epic' },
    { level: 10, name: 'Diamond Prism', nameAr: 'موشور ماسي', particle: 'prism', rarity: 'legendary' },
    { level: 11, name: 'Diamond Beam', nameAr: 'شعاع ماسي', particle: 'beam', rarity: 'legendary' },
    { level: 12, name: 'Platinum Wave', nameAr: 'موجة بلاتينية', particle: 'wave', rarity: 'legendary' },
    { level: 13, name: 'Platinum Storm', nameAr: 'عاصفة بلاتينية', particle: 'storm', rarity: 'legendary' },
    { level: 14, name: 'Legendary Spotlight', nameAr: 'كشاف أسطوري', particle: 'spotlight', rarity: 'mythic' },
    { level: 15, name: 'Emperor Cinematic', nameAr: 'سينمائي إمبراطوري', particle: 'cinematic', rarity: 'mythic' },
  ];
  
  for (const entrance of ENTRANCE_TEMPLATES) {
    const tier = entrance.level <= 7 ? 'VIP' : `SVIP_${Math.min(Math.ceil((entrance.level - 7) / 2), 5)}`;
    
    await prisma.entrance.upsert({
      where: { name: entrance.name },
      update: {},
      create: {
        name: entrance.name,
        nameAr: entrance.nameAr,
        tier,
        // Placeholder URLs - Design team should create actual assets
        animationUrl: `/assets/entrances/level_${entrance.level}_${entrance.particle}.json`,
        previewUrl: `/assets/entrances/level_${entrance.level}_preview.png`,
        coinPrice: 0, // Earned through loyalty, not purchased
        isActive: true,
      },
    });
  }
  
  console.log('✅ Created 15 entrance effects');
}

async function seedFrames() {
  console.log('Seeding 15 Profile Frames...');
  
  const FRAME_TEMPLATES = [
    { level: 1, name: 'Bronze Frame', nameAr: 'إطار برونزي', style: 'simple' },
    { level: 2, name: 'Bronze Elite', nameAr: 'برونزي نخبة', style: 'simple' },
    { level: 3, name: 'Silver Frame', nameAr: 'إطار فضي', style: 'elegant' },
    { level: 4, name: 'Silver Elite', nameAr: 'فضي نخبة', style: 'elegant' },
    { level: 5, name: 'Gold Frame', nameAr: 'إطار ذهبي', style: 'ornate' },
    { level: 6, name: 'Gold Elite', nameAr: 'ذهبي نخبة', style: 'ornate' },
    { level: 7, name: 'Royal Frame', nameAr: 'إطار ملكي', style: 'royal' },
    { level: 8, name: 'Sapphire Frame', nameAr: 'إطار ياقوت', style: 'animated' },
    { level: 9, name: 'Sapphire Elite', nameAr: 'ياقوت نخبة', style: 'animated' },
    { level: 10, name: 'Diamond Frame', nameAr: 'إطار ماسي', style: 'animated' },
    { level: 11, name: 'Diamond Elite', nameAr: 'ماسي نخبة', style: 'animated' },
    { level: 12, name: 'Platinum Frame', nameAr: 'إطار بلاتيني', style: 'legendary' },
    { level: 13, name: 'Platinum Elite', nameAr: 'بلاتيني نخبة', style: 'legendary' },
    { level: 14, name: 'Legend Frame', nameAr: 'إطار أسطوري', style: 'mythic' },
    { level: 15, name: 'Emperor Frame', nameAr: 'إطار إمبراطوري', style: 'mythic' },
  ];
  
  for (const frame of FRAME_TEMPLATES) {
    const tier = frame.level <= 7 ? 'VIP' : `SVIP_${Math.min(Math.ceil((frame.level - 7) / 2), 5)}`;
    
    await prisma.frame.upsert({
      where: { name: frame.name },
      update: {},
      create: {
        name: frame.name,
        nameAr: frame.nameAr,
        tier,
        // Placeholder URLs - Design team should create actual assets
        imageUrl: `/assets/frames/level_${frame.level}_${frame.style}.png`,
        previewUrl: `/assets/frames/level_${frame.level}_${frame.style}_preview.png`,
        coinPrice: 0, // Earned through loyalty, not purchased
        isActive: true,
      },
    });
  }
  
  console.log('✅ Created 15 profile frames');
}

async function main() {
  console.log('🚀 Starting VIP/SVIP Option A (Loyalty System) Asset Seeding...\n');
  
  try {
    await seedPlans();
    await seedFrames();
    await seedEntrances();
    
    console.log('\n✅ All VIP assets seeded successfully!');
    console.log('\n📋 Summary:');
    console.log('  - 15 loyalty level plan templates');
    console.log('  - 15 profile frames');
    console.log('  - 15 entrance effects');
    console.log('\n⚠️  NOTE: Asset URLs are placeholders.');
    console.log('   Design team must create actual assets and place them in:');
    console.log('   - /public/assets/frames/');
    console.log('   - /public/assets/entrances/');
    console.log('\n🔧 Next steps:');
    console.log('  1. Run Prisma migration: npx prisma migrate dev');
    console.log('  2. Verify assets: node scripts/verify-vip-assets.js');
    console.log('  3. Backfill loyalty levels: node scripts/recalculate-loyalty-levels.js');
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
        previewUrl: `/assets/frames/frame_${i}_preview.png`,
        animationUrl: cat === 'animated' || cat === 'legendary' ? `/assets/frames/frame_${i}.json` : null,
        category: cat,
        tier,
        coinPrice: i * 80,
        sortOrder: i,
        isLimited: i >= 8,
      },
    });
  }
}

async function seedGifts() {
  const gifts = [
    { name: 'Rose', nameAr: 'وردة', coinPrice: 10, category: 'basic' },
    { name: 'Crown', nameAr: 'تاج', coinPrice: 50, category: 'popular', isVipOnly: false },
    { name: 'Diamond', nameAr: 'ماسة', coinPrice: 200, category: 'premium', isLegendary: false },
    { name: 'Rocket', nameAr: 'صاروخ', coinPrice: 500, category: 'premium', comboCount: 1 },
    { name: 'Galaxy', nameAr: 'مجرة', coinPrice: 5000, category: 'legendary', isLegendary: true, minTier: 'SVIP_3' },
    { name: 'Dragon', nameAr: 'تنين', coinPrice: 10000, category: 'legendary', isLegendary: true, minTier: 'SVIP_5', isVipOnly: true },
  ];
  for (const g of gifts) {
    const existing = await prisma.gift.findFirst({ where: { name: g.name } });
    if (existing) {
      await prisma.gift.update({ where: { id: existing.id }, data: g });
    } else {
      await prisma.gift.create({
        data: {
          ...g,
          animationUrl: `/assets/gifts/${g.name.toLowerCase()}.json`,
          thumbnailUrl: `/assets/gifts/${g.name.toLowerCase()}_thumb.png`,
        },
      });
    }
  }
}

async function main() {
  await seedPlans();
  await seedFrames();
  await seedEntrances();
  await seedGifts();
  console.log('Premium ecosystem seed complete');
}

main().catch(console.error).finally(() => prisma.$disconnect());
