const prisma = require('../src/prismaClient');

async function main() {
  console.log('Adding missing columns to gifts table...');

  try {
    // Add missing columns
    await prisma.$executeRaw`
      ALTER TABLE gifts 
      ADD COLUMN IF NOT EXISTS "isVipOnly" BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS "isLegendary" BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS "comboCount" INTEGER DEFAULT 3,
      ADD COLUMN IF NOT EXISTS "minTier" TEXT;
    `;
    console.log('✅ Successfully added missing columns');
  } catch (error) {
    console.error('❌ Failed to add columns:', error.message);
    process.exit(1);
  }
}

main()
  .catch(e => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
