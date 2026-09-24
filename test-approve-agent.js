const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testApprovalFlow() {
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
      console.log(`   Agency Request: ${agency.agencyRequest ? 'YES' : 'NO'}`);
      if (agency.agencyRequest) {
        console.log(`   Request Status: ${agency.agencyRequest.status}`);
        console.log(`   Agency Name: ${agency.agencyRequest.agencyName}`);
      }
    });

    if (pendingAgencies.length > 0) {
      const agency = pendingAgencies[0];
      console.log(`\n✅ Approving agency: ${agency.username}...`);
      
      // Update AgencyRequest
      await prisma.agencyRequest.update({
        where: { userId: agency.id },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
        },
      });

      // Update User
      await prisma.user.update({
        where: { id: agency.id },
        data: {
          status: 'ACTIVE',
          agencyApproved: true,
          agencyApprovedAt: new Date(),
          role: 'AGENT',
        },
      });

      console.log('✅ Agency approved successfully!');
      
      // Verify
      const updated = await prisma.user.findUnique({
        where: { id: agency.id },
        include: { agencyRequest: true }
      });
      
      console.log('\n📊 Updated status:');
      console.log(`   User Status: ${updated.status}`);
      console.log(`   User Role: ${updated.role}`);
      console.log(`   Agency Approved: ${updated.agencyApproved}`);
      console.log(`   Request Status: ${updated.agencyRequest.status}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testApprovalFlow();
