const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testAgencies() {
  try {
    // Get all agencies with membership counts
    const agencies = await prisma.agency.findMany({
      include: {
        _count: {
          select: {
            memberships: {
              where: {
                role: 'MEMBER',
                status: 'ACTIVE',
              },
            },
          },
        },
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
            agencyName: true,
          },
        },
      },
    });

    console.log('=== AGENCIES ===');
    console.log(JSON.stringify(agencies, null, 2));

    // Get all users with accountType = AGENCY_OWNER
    const agencyUsers = await prisma.user.findMany({
      where: { accountType: 'AGENCY_OWNER' },
      select: {
        id: true,
        username: true,
        displayName: true,
        agencyName: true,
        status: true,
        ownedAgency: {
          select: {
            id: true,
            name: true,
            level: true,
            commissionRate: true,
            totalEarnings: true,
            _count: {
              select: {
                memberships: {
                  where: {
                    role: 'MEMBER',
                    status: 'ACTIVE',
                  },
                },
              },
            },
          },
        },
      },
    });

    console.log('\n=== AGENCY USERS ===');
    console.log(JSON.stringify(agencyUsers, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testAgencies();
