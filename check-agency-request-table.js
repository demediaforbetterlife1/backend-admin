const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTable() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔍 فحص جدول AgencyRequest');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Try to query the table
    const count = await prisma.agencyRequest.count();
    console.log(`✅ الجدول موجود!`);
    console.log(`   عدد الطلبات: ${count}\n`);

    if (count > 0) {
      const requests = await prisma.agencyRequest.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, username: true, email: true, phone: true }
          }
        }
      });
      console.log('آخر 5 طلبات:\n');
      requests.forEach((req, i) => {
        console.log(`${i + 1}. ${req.agencyName} (${req.ownerName})`);
        console.log(`   Status: ${req.status}`);
        console.log(`   User: ${req.user.username}`);
        console.log(`   Created: ${req.createdAt}`);
        console.log('');
      });
    }
  } catch (error) {
    if (error.code === 'P2021') {
      console.log('❌ الجدول غير موجود في قاعدة البيانات');
      console.log('   يجب تشغيل migration');
    } else {
      console.log(`❌ خطأ: ${error.message}`);
    }
  }

  await prisma.$disconnect();
}

checkTable();
