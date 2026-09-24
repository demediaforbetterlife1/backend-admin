-- CreateEnum for new enums
CREATE TYPE "AgencyLevel" AS ENUM ('STANDARD', 'PREMIUM', 'ELITE');
CREATE TYPE "AgencyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');
CREATE TYPE "AgencyMemberRole" AS ENUM ('MEMBER', 'MANAGER', 'OWNER');
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'LEFT', 'REMOVED');

-- Step 1: Add new AGENCY_OWNER value to AccountType enum
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'AGENCY_OWNER';

-- Existing AGENCY rows are migrated by the application after this enum change
-- is committed; PostgreSQL does not allow using a newly added enum value in
-- the same transaction that adds it.

-- AgencyRequest was present in the Prisma schema but missing from the earlier
-- migration history. Create it before the agency backfill reads from it.
DO $$
BEGIN
    CREATE TYPE "AgencyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agency_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agency_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "agency_requests_userId_key" ON "agency_requests"("userId");
CREATE INDEX IF NOT EXISTS "agency_requests_userId_idx" ON "agency_requests"("userId");
CREATE INDEX IF NOT EXISTS "agency_requests_status_idx" ON "agency_requests"("status");
CREATE INDEX IF NOT EXISTS "agency_requests_createdAt_idx" ON "agency_requests"("createdAt");

-- Step 3: CreateTable: agencies
CREATE TABLE "agencies" (
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
);

-- Step 4: CreateTable: agency_memberships
CREATE TABLE "agency_memberships" (
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
);

-- Step 5: CreateIndex
CREATE UNIQUE INDEX "agencies_ownerId_key" ON "agencies"("ownerId");
CREATE UNIQUE INDEX "agencies_name_key" ON "agencies"("name");
CREATE INDEX "agencies_ownerId_idx" ON "agencies"("ownerId");
CREATE INDEX "agencies_status_idx" ON "agencies"("status");
CREATE INDEX "agencies_name_idx" ON "agencies"("name");

-- Step 6: CreateIndex for agency_memberships
CREATE UNIQUE INDEX "agency_memberships_agencyId_userId_key" ON "agency_memberships"("agencyId", "userId");
CREATE INDEX "agency_memberships_agencyId_status_idx" ON "agency_memberships"("agencyId", "status");
CREATE INDEX "agency_memberships_userId_status_idx" ON "agency_memberships"("userId", "status");

-- Step 7: AddForeignKey
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 8: AddForeignKey for agency_memberships
ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON UPDATE CASCADE;

-- Step 9: AddForeignKey for Conversation.agencyId (if column doesn't exist, add it first)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'conversations' AND column_name = 'agencyId'
    ) THEN
        ALTER TABLE "conversations" ADD COLUMN "agencyId" TEXT;
    END IF;
END $$;

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 10: Migrate existing approved agencies to new Agency model
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
WHERE u."accountType"::text = 'AGENCY_OWNER'
  AND u."agencyApproved" = true
ON CONFLICT ("ownerId") DO NOTHING;

-- Note: We keep User.offeredServices and User.teamSize temporarily for backward compatibility
-- They will be removed in a future migration after all code is updated

