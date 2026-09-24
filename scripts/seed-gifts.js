const prisma = require('../src/prismaClient');

async function main() {
  console.log('Seeding gifts...');

  const gifts = [
    {
      name: 'Rose',
      nameAr: 'وردة',
      animationUrl: 'https://lottie.host/6a6f3e5e-7a1f-4b6c-8d9e-0f1a2b3c4d5e/7a6f3e5e-7a1f-4b6c-8d9e-0f1a2b3c4d5e.json',
      thumbnailUrl: 'https://lottie.host/6a6f3e5e-7a1f-4b6c-8d9e-0f1a2b3c4d5e/thumbnail_rose.png',
      coinPrice: 10,
      category: 'flowers',
      isActive: true,
      isVipOnly: false,
      isLegendary: false,
      comboCount: 3,
    },
    {
      name: 'Heart',
      nameAr: 'قلب',
      animationUrl: 'https://lottie.host/6b7g4f6f-8b2g-5c7d-9e0f-1g2h3i4j5k6l/6b7g4f6f-8b2g-5c7d-9e0f-1g2h3i4j5k6l.json',
      thumbnailUrl: 'https://lottie.host/6b7g4f6f-8b2g-5c7d-9e0f-1g2h3i4j5k6l/thumbnail_heart.png',
      coinPrice: 5,
      category: 'love',
      isActive: true,
      isVipOnly: false,
      isLegendary: false,
      comboCount: 5,
    },
    {
      name: 'Star',
      nameAr: 'نجمة',
      animationUrl: 'https://lottie.host/7c8h5g7g-9c3h-6d8e-0f1g-2h3i4j5k6l7m/7c8h5g7g-9c3h-6d8e-0f1g-2h3i4j5k6l7m.json',
      thumbnailUrl: 'https://lottie.host/7c8h5g7g-9c3h-6d8e-0f1g-2h3i4j5k6l7m/thumbnail_star.png',
      coinPrice: 15,
      category: 'special',
      isActive: true,
      isVipOnly: false,
      isLegendary: false,
      comboCount: 3,
    },
    {
      name: 'Diamond',
      nameAr: 'ماسة',
      animationUrl: 'https://lottie.host/8d9i6h8h-0d4i-7e9f-1g2h-3i4j5k6l7m8n/8d9i6h8h-0d4i-7e9f-1g2h-3i4j5k6l7m8n.json',
      thumbnailUrl: 'https://lottie.host/8d9i6h8h-0d4i-7e9f-1g2h-3i4j5k6l7m8n/thumbnail_diamond.png',
      coinPrice: 50,
      category: 'premium',
      isActive: true,
      isVipOnly: true,
      isLegendary: false,
      comboCount: 3,
      minTier: 'VIP',
    },
    {
      name: 'Dragon',
      nameAr: 'تنين',
      animationUrl: 'https://lottie.host/9e0j7i9i-1e5j-8f0g-2h3i-4j5k6l7m8n9o/9e0j7i9i-1e5j-8f0g-2h3i-4j5k6l7m8n9o.json',
      thumbnailUrl: 'https://lottie.host/9e0j7i9i-1e5j-8f0g-2h3i-4j5k6l7m8n9o/thumbnail_dragon.png',
      coinPrice: 100,
      category: 'legendary',
      isActive: true,
      isVipOnly: false,
      isLegendary: true,
      comboCount: 3,
    },
    {
      name: 'Crown',
      nameAr: 'تاج',
      animationUrl: 'https://lottie.host/0f1k8j0j-2f6k-9g1h-3i4j-5k6l7m8n9o0p/0f1k8j0j-2f6k-9g1h-3i4j-5k6l7m8n9o0p.json',
      thumbnailUrl: 'https://lottie.host/0f1k8j0j-2f6k-9g1h-3i4j-5k6l7m8n9o0p/thumbnail_crown.png',
      coinPrice: 75,
      category: 'royal',
      isActive: true,
      isVipOnly: true,
      isLegendary: false,
      comboCount: 3,
      minTier: 'SVIP_1',
    },
  ];

  for (const gift of gifts) {
    const existing = await prisma.gift.findFirst({ where: { name: gift.name } });
    if (existing) {
      await prisma.gift.update({ where: { id: existing.id }, data: gift });
      console.log(`Updated gift: ${gift.name}`);
    } else {
      await prisma.gift.create({ data: gift });
      console.log(`Created gift: ${gift.name}`);
    }
  }

  console.log('Gift seeding complete');
}

main()
  .catch(e => {
    console.error('Error seeding gifts:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());