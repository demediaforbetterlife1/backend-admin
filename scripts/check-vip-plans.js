const prisma = require('../src/prismaClient');

async function main() {
  console.log('=== CHECKING VIP PLANS IN DATABASE ===\n');
  
  const plans = await prisma.vipPlan.findMany({
    orderBy: { tier: 'asc' }
  });
  
  console.log(`Total VIP plans found: ${plans.length}\n`);
  
  if (plans.length === 0) {
    console.log('❌ NO VIP PLANS IN DATABASE');
  } else {
    console.log('✅ VIP PLANS FOUND:');
    plans.forEach((plan, index) => {
      console.log(`\n${index + 1}. ${plan.tier}`);
      console.log(`   Name: ${plan.name}`);
      console.log(`   Price: ${plan.coinPrice} coins`);
      console.log(`   Active: ${plan.isActive}`);
    });
  }
}

main()
  .catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
