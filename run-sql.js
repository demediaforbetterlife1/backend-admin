const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createTable() {
  console.log('🔧 إنشاء جدول agency_requests...\n');

  try {
    // Create enum
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "AgencyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    // Create table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "agency_requests" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "agencyName" TEXT NOT NULL,
        "ownerName" TEXT NOT NULL,
        "phone" TEXT NOT NULL,
        "email" TEXT,
        "country" TEXT,
        "documents" JSONB,
        "profileImage" TEXT,
        "bio" TEXT,
        "teamSize" TEXT,
        "offeredServices" JSONB,
        "status" "AgencyRequestStatus" NOT NULL DEFAULT 'PENDING',
        "rejectionReason" TEXT,
        "reviewedBy" TEXT,
        "reviewedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "agency_requests_pkey" PRIMARY KEY ("id")
      );
    `;

    // Create indexes
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "agency_requests_userId_key" ON "agency_requests"("userId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "agency_requests_userId_idx" ON "agency_requests"("userId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "agency_requests_status_idx" ON "agency_requests"("status");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "agency_requests_createdAt_idx" ON "agency_requests"("createdAt");`;

    // Add foreign keys
    await prisma.$executeRaw`
      ALTER TABLE "agency_requests" 
      DROP CONSTRAINT IF EXISTS "agency_requests_userId_fkey";
    `;
    await prisma.$executeRaw`
      ALTER TABLE "agency_requests" 
      ADD CONSTRAINT "agency_requests_userId_fkey" 
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    `;

    await prisma.$executeRaw`
      ALTER TABLE "agency_requests" 
      DROP CONSTRAINT IF EXISTS "agency_requests_reviewedBy_fkey";
    `;
    await prisma.$executeRaw`
      ALTER TABLE "agency_requests" 
      ADD CONSTRAINT "agency_requests_reviewedBy_fkey" 
      FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    `;

    console.log('✅ تم إنشاء الجدول بنجاح!\n');

    // Verify
    const count = await prisma.$queryRaw`SELECT COUNT(*) FROM agency_requests`;
    console.log('✅ التحقق: الجدول موجود ويعمل');
    console.log(`   عدد الطلبات: ${count[0].count}\n`);

  } catch (error) {
    console.log(`❌ خطأ: ${error.message}\n`);
    console.log('Stack:', error.stack);
  }

  await prisma.$disconnect();
}

createTable();
