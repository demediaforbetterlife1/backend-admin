const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testRejectionFlow() {
  try {
    // Get pending agencies
    console.log('\n📋 Fetching pending agency requests...');
    const pendingAgencies = await prisma.user.findMany({
      where: { 
        accountType: 'AGENCY', 
        status: 'PENDING_APPROVAL' 
      },
      include: {
        agencyRequest: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    console.log(`\nFound ${pendingAgencies.length} pending agencies:`);
    pendingAgencies.forEach((agency, i) => {
      console.log(`\n${i + 1}. ${agency.username}`);
      console.log(`   User ID: ${agency.id}`);
      console.log(`   Email: ${agency.email}`);
      console.log(`   Status: ${agency.status}`);
      if (agency.agencyRequest) {
        console.log(`   Request Status: ${agency.agencyRequest.status}`);
        console.log(`   Agency Name: ${agency.agencyRequest.agencyName}`);
      }
    });

    if (pendingAgencies.length > 0) {
      const agency = pendingAgencies[0];
      const rejectionReason = 'المعلومات المقدمة غير كافية. يرجى تقديم المزيد من التفاصيل حول الوكالة.';
      
      console.log(`\n❌ Rejecting agency: ${agency.username}...`);
      console.log(`   Reason: ${rejectionReason}`);
      
      // Update AgencyRequest
      if (agency.agencyRequest) {
        await prisma.agencyRequest.update({
          where: { userId: agency.id },
          data: {
            status: 'REJECTED',
            rejectionReason: rejectionReason,
            reviewedAt: new Date(),
          },
        });
      }

      // Update User
      await prisma.user.update({
        where: { id: agency.id },
        data: {
          status: 'REJECTED',
          agencyApproved: false,
        },
      });

      console.log('✅ Agency rejected successfully!');
      
      // Verify
      const updated = await prisma.user.findUnique({
        where: { id: agency.id },
        include: { agencyRequest: true }
      });
      
      console.log('\n📊 Updated status:');
      console.log(`   User Status: ${updated.status}`);
      console.log(`   Agency Approved: ${updated.agencyApproved}`);
      if (updated.agencyRequest) {
        console.log(`   Request Status: ${updated.agencyRequest.status}`);
        console.log(`   Rejection Reason: ${updated.agencyRequest.rejectionReason}`);
      }
      
      // Return credentials for testing
      console.log('\n🔐 Test credentials:');
      console.log(`   Email: ${updated.email}`);
      console.log(`   Password: TestPass123!`);
      console.log(`   User ID: ${updated.id}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

testRejectionFlow();
