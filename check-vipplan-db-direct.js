/**
 * Query VipPlan table directly to check if data exists
 */
const prisma = require('./src/prismaClient');

async function main() {
  console.log("=== Querying VipPlan table directly ===\n");
  
  try {
    const plans = await prisma.vipPlan.findMany({
      orderBy: { createdAt: 'desc' }
    });
    
    console.log(`Found ${plans.length} VIP plans:\n`);
    
    if (plans.length > 0) {
      plans.forEach((plan, index) => {
        console.log(`${index + 1}. ${plan.nameAr} (${plan.tier})`);
        console.log(`   Price: ${plan.priceEGP} EGP / ${plan.priceCoins} coins`);
        console.log(`   Active: ${plan.isActive}`);
        console.log(`   Created: ${plan.createdAt}`);
        console.log('');
      });
    } else {
      console.log("⚠️  NO VIP PLANS FOUND IN DATABASE!");
      console.log("\nThis confirms the backend VipPlan table is empty.");
    }
    
    // Also get the raw count
    const count = await prisma.vipPlan.count();
    console.log(`\nTotal count: ${count}`);
    
  } catch (error) {
    console.error("❌ Error querying database:", error.message);
    console.error(error);
    throw error;
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
