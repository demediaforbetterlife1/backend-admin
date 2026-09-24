const prisma = require('../src/prismaClient');

async function main() {
  const email = process.argv[2];
  const amount = parseInt(process.argv[3]) || 1000;

  if (!email) {
    console.error('Usage: node add-test-coins.js <email> [amount]');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error('User not found');
    process.exit(1);
  }

  let wallet = await prisma.userWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) {
    wallet = await prisma.userWallet.create({
      data: {
        userId: user.id,
        coinBalance: amount,
        totalEarned: amount,
      },
    });
    console.log(`Created wallet for ${email} with ${amount} coins`);
  } else {
    wallet = await prisma.userWallet.update({
      where: { userId: user.id },
      data: {
        coinBalance: { increment: amount },
        totalEarned: { increment: amount },
      },
    });
    console.log(`Added ${amount} coins to ${email}. New balance: ${wallet.coinBalance}`);
  }

  // Record transaction
  await prisma.coinTransaction.create({
    data: {
      userId: user.id,
      type: 'BONUS',
      amount,
      balanceAfter: wallet.coinBalance,
      description: 'Test coins added',
    },
  });

  console.log('Transaction recorded');
}

main()
  .catch(e => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());