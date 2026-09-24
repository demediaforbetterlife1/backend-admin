const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function runMigration() {
  try {
    console.log('🚀 Starting Agency System Migration...\n');
    
    // Step 1: Create enums
    console.log('[1/11] Creating enums...');
    try {
      await prisma.$executeRawUnsafe(`CREATE TYPE "AgencyLevel" AS ENUM ('STANDARD', 'PREMIUM', 'ELITE')`);
      await prisma.$executeRawUnsafe(`CREATE TYPE "AgencyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED')`);
      await prisma.$executeRawUnsafe(`CREATE TYPE "AgencyMemberRole" AS ENUM ('MEMBER', 'MANAGER', 'OWNER')`);
      await prisma.$executeRawUnsafe(`CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'LEFT', 'REMOVED')`);
      console.log('  ✓ Enums created\n');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('  ⚠ Enums already exist (skipped)\n');
      } else {
        throw err;
      }
    }
    
    // Step 2: Add AGENCY_OWNER to AccountType
    console.log('[2/11] Updating AccountType enum...');
    try {
      await prisma.$executeRawUnsafe(`ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'AGENCY_OWNER'`);
      console.log('  ✓ AccountType updated\n');
    } catch (err) {
      console.log('  ⚠ Value might already exist (continuing)\n');
    }
    
    // Step 3: Migrate existing AGENCY to AGENCY_OWNER
    console.log('[3/11] Migrating accountType values...');
    const updated = await prisma.$executeRawUnsafe(`UPDATE "User" SET "accountType" = 'AGENCY_OWNER' WHERE "accountType" = 'AGENCY'`);
    console.log(`  ✓ Updated ${updated} users\n`);
    
    // Step 4: Create agencies table
    console.log('[4/11] Creating agencies table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "agencies" (
        "id" TEXT NOT NULL,
        "ownerId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "country" TEXT,
        "profileImage" TEXT,
        "documents" JSONB,
        "teamSize" TEXT,
        "offeredServices" JSONB,
        "level" "AgencyLevel" NOT NULL DEFAULT 'STANDARD',
        "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        "status" "AgencyStatus" NOT NULL DEFAULT 'ACTIVE',
        "totalEarnings" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
      )
    `);
    console.log('  ✓ agencies table created\n');
    
    // Step 5: Create agency_memberships table
    console.log('[5/11] Creating agency_memberships table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "agency_memberships" (
        "id" TEXT NOT NULL,
        "agencyId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "role" "AgencyMemberRole" NOT NULL DEFAULT 'MEMBER',
        "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING',
        "invitedBy" TEXT NOT NULL,
        "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "joinedAt" TIMESTAMP(3),
        "leftAt" TIMESTAMP(3),
        CONSTRAINT "agency_memberships_pkey" PRIMARY KEY ("id")
      )
    `);
    console.log('  ✓ agency_memberships table created\n');
    
    // Step 6: Create indexes for agencies
    console.log('[6/11] Creating indexes for agencies...');
    try {
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "agencies_ownerId_key" ON "agencies"("ownerId")`);
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "agencies_name_key" ON "agencies"("name")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agencies_ownerId_idx" ON "agencies"("ownerId")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agencies_status_idx" ON "agencies"("status")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agencies_name_idx" ON "agencies"("name")`);
      console.log('  ✓ Indexes created\n');
    } catch (err) {
      console.log('  ⚠ Some indexes might already exist\n');
    }
    
    // Step 7: Create indexes for agency_memberships
    console.log('[7/11] Creating indexes for agency_memberships...');
    try {
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "agency_memberships_agencyId_userId_key" ON "agency_memberships"("agencyId", "userId")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agency_memberships_agencyId_status_idx" ON "agency_memberships"("agencyId", "status")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agency_memberships_userId_status_idx" ON "agency_memberships"("userId", "status")`);
      console.log('  ✓ Indexes created\n');
    } catch (err) {
      console.log('  ⚠ Some indexes might already exist\n');
    }
    
    // Step 8: Add foreign keys for agencies
    console.log('[8/11] Adding foreign keys for agencies...');
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "agencies" ADD CONSTRAINT "agencies_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
      console.log('  ✓ Foreign keys added\n');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('  ⚠ Foreign keys already exist\n');
      } else {
        throw err;
      }
    }
    
    // Step 9: Add foreign keys for agency_memberships
    console.log('[9/11] Adding foreign keys for agency_memberships...');
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON UPDATE CASCADE`);
      console.log('  ✓ Foreign keys added\n');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('  ⚠ Foreign keys already exist\n');
      } else {
        throw err;
      }
    }
    
    // Step 10: Add agencyId foreign key to conversations
    console.log('[10/11] Adding agencyId foreign key to conversations...');
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
      console.log('  ✓ Foreign key added\n');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('  ⚠ Foreign key already exists\n');
      } else {
        console.log('  ⚠ Foreign key not added (conversations.agencyId column might not exist yet)\n');
      }
    }
    
    // Step 11: Migrate existing approved agencies
    console.log('[11/11] Migrating existing approved agencies...');
    const migrated = await prisma.$executeRawUnsafe(`
      INSERT INTO "agencies" (
        "id",
        "ownerId",
        "name",
        "description",
        "country",
        "profileImage",
        "documents",
        "teamSize",
        "offeredServices",
        "level",
        "commissionRate",
        "status",
        "totalEarnings",
        "createdAt",
        "updatedAt"
      )
      SELECT 
        gen_random_uuid()::text,
        u.id,
        COALESCE(u."agencyName", u.username) as name,
        ar.bio as description,
        ar.country,
        COALESCE(ar."profileImage", u.avatar) as profileImage,
        COALESCE(ar.documents, '[]'::jsonb) as documents,
        ar."teamSize",
        COALESCE(ar."offeredServices", '[]'::jsonb) as offeredServices,
        'STANDARD'::"AgencyLevel" as level,
        0.0 as "commissionRate",
        CASE 
          WHEN u.status = 'ACTIVE' THEN 'ACTIVE'::"AgencyStatus"
          WHEN u.status = 'SUSPENDED' THEN 'SUSPENDED'::"AgencyStatus"
          ELSE 'ACTIVE'::"AgencyStatus"
        END as status,
        0 as "totalEarnings",
        COALESCE(u."agencyApprovedAt", u."createdAt") as "createdAt",
        CURRENT_TIMESTAMP as "updatedAt"
      FROM "User" u
      LEFT JOIN "agency_requests" ar ON ar."userId" = u.id
      WHERE u."accountType" = 'AGENCY_OWNER' 
        AND u."agencyApproved" = true
      ON CONFLICT ("ownerId") DO NOTHING
    `);
    console.log(`  ✓ Migrated ${migrated} agencies\n`);
    
    console.log('✅ Migration completed successfully!\n');
    
    // Verify
    console.log('📊 Verification:');
    const agenciesCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM agencies`;
    const membershipsCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM agency_memberships`;
    console.log(`  - agencies table: ${agenciesCount[0].count} rows`);
    console.log(`  - agency_memberships table: ${membershipsCount[0].count} rows\n`);
    
    // Show sample data
    const sampleAgencies = await prisma.$queryRaw`
      SELECT a.id, a.name, a.level, a.status, u.username as owner
      FROM agencies a
      JOIN "User" u ON a."ownerId" = u.id
      LIMIT 5
    `;
    
    if (sampleAgencies.length > 0) {
      console.log('📋 Sample agencies:');
      sampleAgencies.forEach(a => {
        console.log(`  - ${a.name} (${a.level}, ${a.status}) - owner: ${a.owner}`);
      });
    } else {
      console.log('ℹ️  No agencies found (none existed before migration)');
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
