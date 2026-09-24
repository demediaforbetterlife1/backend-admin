const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkPlans() {
  try {
    const plans = await prisma.vipPlan.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' }
    });
    
    console.log('=== VIP PLANS IN DATABASE ===');
    console.log('TOTAL PLANS:', plans.length);
    console.log('');
    
    if (plans.length === 0) {
      console.log('❌ NO PLANS FOUND');
    } else {
      plans.forEach((plan, index) => {
        console.log(`${index + 1}. ${plan.tier}`);
        console.log(`   Name: ${plan.nameAr}`);
        console.log(`   Price: ${plan.priceCoins} coins / ${plan.priceEGP} EGP`);
        console.log(`   Active: ${plan.isActive}`);
        console.log(`   Features: ${plan.features.join(', ')}`);
        console.log('');
      });
    }
  } catch (error) {
    console.error('ERROR:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkPlans();
