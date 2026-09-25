const prisma = require('../src/prismaClient');

async function main() {
  console.log('Seeding gifts (basic - no isVipOnly field)...');

  const gifts = [
    {
      name: 'Rose',
      nameAr: 'وردة',
      animationUrl: 'https://lottie.host/1a6f3e5e-7a1f-4b6c-8d9e-0f1a2b3c4d5e/7a6f3e5e-7a1f-4b6c-8d9e-0f1a2b3c4d5e.json',
      thumbnailUrl: 'https://lottie.host/1a6f3e5e-7a1f-4b6c-8d9e-0f1a2b3c4d5e/thumbnail_rose.png',
      coinPrice: 10,
      category: 'flowers',
      isActive: true,
    },
    {
      name: 'Heart',
      nameAr: 'قلب',
      animationUrl: 'https://lottie.host/1b7g4f6f-8b2g-5c7d-9e0f-1g2h3i4j5k6l/6b7g4f6f-8b2g-5c7d-9e0f-1g2h3i4j5k6l.json',
      thumbnailUrl: 'https://lottie.host/1b7g4f6f-8b2g-5c7d-9e0f-1g2h3i4j5k6l/thumbnail_heart.png',
      coinPrice: 5,
      category: 'love',
      isActive: true,
    },
    {
      name: 'Star',
      nameAr: 'نجمة',
      animationUrl: 'https://lottie.host/1c8h5g7g-9c3h-6d8e-0f1g-2h3i4j5k6l7m/7c8h5g7g-9c3h-6d8e-0f1g-2h3i4j5k6l7m.json',
      thumbnailUrl: 'https://lottie.host/1c8h5g7g-9c3h-6d8e-0f1g-2h3i4j5k6l7m/thumbnail_star.png',
      coinPrice: 15,
      category: 'special',
      isActive: true,
    },
    {
      name: 'Diamond',
      nameAr: 'ماسة',
      animationUrl: 'https://lottie.host/1d9i6h8h-0d4i-7e9f-1g2h-3i4j5k6l7m8n/8d9i6h8h-0d4i-7e9f-1g2h-3i4j5k6l7m8n.json',
      thumbnailUrl: 'https://lottie.host/1d9i6h8h-0d4i-7e9f-1g2h-3i4j5k6l7m8n/thumbnail_diamond.png',
      coinPrice: 50,
      category: 'premium',
      isActive: true,
    },
    {
      name: 'Dragon',
      nameAr: 'تنين',
      animationUrl: 'https://lottie.host/1e0j7i9i-1e5j-8f0g-2h3i-4j5k6l7m8n9o/9e0j7i9i-1e5j-8f0g-2h3i-4j5k6l7m8n9o.json',
      thumbnailUrl: 'https://lottie.host/1e0j7i9i-1e5j-8f0g-2h3i-4j5k6l7m8n9o/thumbnail_dragon.png',
      coinPrice: 100,
      category: 'legendary',
      isActive: true,
    },
    {
      name: 'Crown',
      nameAr: 'تاج',
      animationUrl: 'https://lottie.host/1f1k8j0j-2f6k-9g1h-3i4j-5k6l7m8n9o0p/0f1k8j0j-2f6k-9g1h-3i4j-5k6l7m8n9o0p.json',
      thumbnailUrl: 'https://lottie.host/1f1k8j0j-2f6k-9g1h-3i4j-5k6l7m8n9o0p/thumbnail_crown.png',
      coinPrice: 75,
      category: 'royal',
      isActive: true,
    },
  ];

  for (const gift of gifts) {
    try {
      // Check using only fields that exist in old schema
      const existing = await prisma.$queryRaw`SELECT * FROM gifts WHERE name = ${gift.name} LIMIT 1`;
      if (existing && existing.length > 0) {
        await prisma.$executeRaw`
          UPDATE gifts 
          SET "nameAr" = ${gift.nameAr},
              "animationUrl" = ${gift.animationUrl},
              "thumbnailUrl" = ${gift.thumbnailUrl},
              "coinPrice" = ${gift.coinPrice},
              category = ${gift.category},
              "isActive" = ${gift.isActive}
          WHERE name = ${gift.name}
        `;
        console.log(`✅ Updated gift: ${gift.name}`);
      } else {
        await prisma.$executeRaw`
          INSERT INTO gifts (id, name, "nameAr", "animationUrl", "thumbnailUrl", "coinPrice", category, "isActive", "createdAt")
          VALUES (${require('crypto').randomUUID()}, ${gift.name}, ${gift.nameAr}, ${gift.animationUrl}, ${gift.thumbnailUrl}, ${gift.coinPrice}, ${gift.category}, ${gift.isActive}, ${new Date()})
        `;
        console.log(`✅ Created gift: ${gift.name}`);
      }
    } catch (error) {
      console.error(`❌ Failed to process gift ${gift.name}:`, error.message);
    }
  }

  console.log('\n✅ Gift seeding complete');
}

main()
  .catch(e => {
    console.error('❌ Error seeding gifts:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
