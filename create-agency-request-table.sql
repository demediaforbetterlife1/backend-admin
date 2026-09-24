-- Create AgencyRequestStatus enum if not exists
DO $$ BEGIN
    CREATE TYPE "AgencyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create agency_requests table
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

-- Create unique constraint on userId
CREATE UNIQUE INDEX IF NOT EXISTS "agency_requests_userId_key" ON "agency_requests"("userId");

-- Create indexes
CREATE INDEX IF NOT EXISTS "agency_requests_userId_idx" ON "agency_requests"("userId");
CREATE INDEX IF NOT EXISTS "agency_requests_status_idx" ON "agency_requests"("status");
CREATE INDEX IF NOT EXISTS "agency_requests_createdAt_idx" ON "agency_requests"("createdAt");

-- Add foreign key constraints
ALTER TABLE "agency_requests" 
    DROP CONSTRAINT IF EXISTS "agency_requests_userId_fkey";

ALTER TABLE "agency_requests" 
    ADD CONSTRAINT "agency_requests_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agency_requests" 
    DROP CONSTRAINT IF EXISTS "agency_requests_reviewedBy_fkey";

ALTER TABLE "agency_requests" 
    ADD CONSTRAINT "agency_requests_reviewedBy_fkey" 
    FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
